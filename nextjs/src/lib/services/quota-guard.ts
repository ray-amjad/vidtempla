import { eq } from "drizzle-orm";
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

/**
 * Next midnight Pacific as a UTC instant, DST-correct, without a tz library.
 * Computes the wall-clock duration from `now` to the next Los Angeles midnight
 * and adds it to `now` — timezone-independent of the server's own clock.
 */
function nextPacificMidnight(now: Date): Date {
  const laNow = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  const laMidnight = new Date(laNow);
  laMidnight.setHours(24, 0, 0, 0); // next local midnight in laNow's frame
  const msUntilMidnight = laMidnight.getTime() - laNow.getTime();
  return new Date(now.getTime() + msUntilMidnight);
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

  const [row] = await db
    .select()
    .from(appState)
    .where(eq(appState.key, NOTIFIED_KEY));
  if (readUntil(row?.value) === target) return; // already alerted this window

  const value: UntilValue = { until: target };
  await db
    .insert(appState)
    .values({ key: NOTIFIED_KEY, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appState.key,
      set: { value, updatedAt: new Date() },
    });

  try {
    await sendQuotaExhaustedEmail({ resetsAt: until });
  } catch (err) {
    console.error("[quota-guard] failed to send quota alert email", { err });
  }
}
