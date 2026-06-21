import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appState } from "@/db/schema";
import { sendQuotaExhaustedEmail } from "@/lib/email/senders/sendQuotaExhaustedEmail";

/**
 * YouTube Data API quota circuit breaker.
 *
 * The Data API daily quota resets at midnight Pacific. Once any call hits
 * `quotaExceeded`, every subsequent call 403s until reset — so re-discovering
 * that per workflow (and firing dozens of doomed background syncs) is pure
 * waste. When a workflow hits quota it calls `markYouTubeQuotaExhausted()`,
 * which records an `until` instant; background syncs check
 * `isYouTubeQuotaExhausted()` and short-circuit until the quota resets.
 *
 * User-initiated writes deliberately do NOT pre-check the breaker — writes are
 * higher priority than background reads, so they still attempt (and set the
 * breaker themselves if they hit quota).
 */

const EXHAUSTED_KEY = "youtube_quota_exhausted_until";
const NOTIFIED_KEY = "youtube_quota_notified_for";
// Small cushion past the reset boundary so we don't un-break right as the quota
// is resetting (avoids a thundering retry at exactly midnight Pacific).
const RESET_BUFFER_MS = 10 * 60 * 1000;

interface UntilValue {
  until: string;
}

function readUntil(value: unknown): string | null {
  if (value && typeof value === "object" && "until" in value) {
    const u = (value as UntilValue).until;
    return typeof u === "string" ? u : null;
  }
  return null;
}

const PACIFIC_TZ = "America/Los_Angeles";

/** Offset (zone wall-clock minus UTC) in ms for `date` in `timeZone`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);
  const asUtc = Date.UTC(
    f.year!,
    f.month! - 1,
    f.day!,
    f.hour! === 24 ? 0 : f.hour!,
    f.minute!,
    f.second!
  );
  return asUtc - date.getTime();
}

/**
 * Next midnight Pacific as a UTC instant, DST-correct, without a tz library.
 * Finds the Los Angeles calendar day for `now`, advances to the next day, and
 * resolves that day's 00:00 wall-clock to a UTC instant using the zone offset
 * *at that instant*. Re-checking the offset once settles DST-transition days
 * (e.g. the 25-hour "fall back" day), where a wall-clock-duration approach
 * would land an hour early and clear the breaker before quota actually resets.
 * Midnight always exists and is unambiguous in LA (transitions happen at 02:00),
 * so no skipped/ambiguous-hour handling is needed. The instant is whole-second
 * by construction, keeping the notification dedupe key stable across a cycle.
 */
function nextPacificMidnight(now: Date): Date {
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: PACIFIC_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const p: Record<string, number> = {};
  for (const part of dateParts)
    if (part.type !== "literal") p[part.type] = Number(part.value);

  // Next LA calendar day (UTC date math handles month/year rollover).
  const nextDay = new Date(Date.UTC(p.year!, p.month! - 1, p.day! + 1));
  const guess = Date.UTC(
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth(),
    nextDay.getUTCDate()
  );

  // Treat the target wall-clock as UTC, correct by the offset, then re-correct
  // once in case a DST transition sits between the guess and the result.
  let result = guess - zoneOffsetMs(new Date(guess), PACIFIC_TZ);
  result = guess - zoneOffsetMs(new Date(result), PACIFIC_TZ);
  return new Date(result);
}

export async function isYouTubeQuotaExhausted(): Promise<boolean> {
  const [row] = await db
    .select()
    .from(appState)
    .where(eq(appState.key, EXHAUSTED_KEY));
  const until = readUntil(row?.value);
  return until !== null && new Date(until).getTime() > Date.now();
}

export async function markYouTubeQuotaExhausted(): Promise<void> {
  const now = new Date();
  const until = new Date(
    nextPacificMidnight(now).getTime() + RESET_BUFFER_MS
  );
  const value: UntilValue = { until: until.toISOString() };

  await db
    .insert(appState)
    .values({ key: EXHAUSTED_KEY, value, updatedAt: now })
    .onConflictDoUpdate({
      target: appState.key,
      set: { value, updatedAt: now },
    });

  await notifyQuotaExhaustedOnce(until);
}

/**
 * Email the operator at most once per exhaustion window. Reserves the dedup slot
 * before sending so a burst of concurrent workflow steps doesn't fan out into
 * dozens of identical alerts.
 */
async function notifyQuotaExhaustedOnce(until: Date): Promise<void> {
  const target = until.toISOString();
  const value: UntilValue = { until: target };

  // Atomically claim the alert slot for this window. The upsert only writes (and
  // therefore only RETURNs a row) when the stored `until` differs from the
  // current target: a fresh insert, or a window that hasn't been alerted yet.
  // A concurrent caller that already wrote this window's target hits the
  // setWhere guard, updates nothing, and gets an empty result — so exactly one
  // racer sends the email. (A SELECT-then-upsert here is not atomic: concurrent
  // callers both read "no match" and both send.)
  const claimed = await db
    .insert(appState)
    .values({ key: NOTIFIED_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appState.key,
      set: { value, updatedAt: new Date() },
      setWhere: sql`(${appState.value} ->> 'until') is distinct from ${target}`,
    })
    .returning({ key: appState.key });

  if (claimed.length === 0) return; // already alerted this window

  try {
    await sendQuotaExhaustedEmail({ resetsAt: until });
  } catch (err) {
    console.error("[quota-guard] failed to send quota alert email", { err });
  }
}
