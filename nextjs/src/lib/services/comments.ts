import { and, asc, count, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { commentEdits } from "@/db/schema";
import { getChannelTokens } from "@/lib/api-auth";
import { consumeCredits, refundCredits } from "@/lib/plan-limits";
import {
  listCommentThreads as ytListCommentThreads,
  searchChannelCommentThreads as ytSearchChannelCommentThreads,
  getCommentById as ytGetCommentById,
  listCommentReplies as ytListCommentReplies,
  postCommentThread as ytPostCommentThread,
  replyToComment as ytReplyToComment,
  updateComment as ytUpdateComment,
  deleteComment as ytDeleteComment,
  isDefinitiveYouTubeRejection,
  isYouTubeQuotaError,
  isYouTubeRateLimitError,
  YOUTUBE_CALL_TIMEOUT_MS,
  type YouTubeComment,
  type YouTubeCommentThread,
} from "@/lib/clients/youtube";
import { mapYouTubeServiceError, youTubeErrorDetail } from "@/lib/youtube-errors";
import { markYouTubeQuotaExhausted, nextQuotaResetAt } from "./quota-guard";
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isEncodedCompositeCursor,
  isValidCursorId,
} from "./cursors";
import type { ServiceResult, JsonValue, PaginationMeta, PaginationOpts } from "./types";

/**
 * Comment service — the sole owner of comment credits and `comment_edits`
 * snapshots (issue #135, invariants I2/I9/I10).
 *
 * Every surface (MCP, REST, dashboard tRPC) calls these functions; none of them
 * consume credits or talk to the YouTube client themselves. Credits are charged
 * per item *as attempted*, never up front, so an aborted or quota-halted batch
 * only bills the work it actually did. The running total rides on the caller's
 * `CommentContext.meter`, so a surface can log what a call really cost even when
 * the call ends in an error.
 *
 * Credit costs: reads 1, writes 50, snapshotted writes 51 (1 read + 50 write).
 */

const READ_CREDITS = 1;
const WRITE_CREDITS = 50;

/** I5: a bulk batch never exceeds 40 items — the runtime budget depends on it. */
export const BULK_MAX_ITEMS = 40;

/** I11: only `pending` rows older than this are reconciled by phase 0. */
const STALE_PENDING_MS = 10 * 60 * 1000;

/**
 * Wall clock a bulk batch allows itself, against the `maxDuration = 60` that
 * every surface pins. A batch stops *starting* new YouTube calls once the next
 * one could not finish inside the budget.
 *
 * This exists because of what a platform timeout kill costs here: the process
 * dies mid-phase-2 with no code left running, so nothing finalizes the rows of
 * items that were never sent and they are left `pending` — a state that claims
 * a write might have happened when it provably did not. Stopping ourselves,
 * one call's timeout short of the ceiling, turns that into an ordinary halt
 * with `skipped` results and honestly `failed` rows.
 */
const BULK_BUDGET_MS = 55_000;

/**
 * ── The `comment_edits` status machine ──────────────────────────────────────
 *
 * `comment_edits` is the only surviving copy of a comment's prior text, so the
 * one thing it must never do is claim a write happened when it did not — and
 * the second thing is strand a row in a state nothing can ever resolve. Every
 * transition in this file comes from exactly one of these rules (I8: status is
 * the only column that ever changes).
 *
 *  `pending`  — inserted before the YouTube call, and left only when something
 *               can still settle it: a phase-2 bulk row, which the next batch
 *               for the same org+channel sweeps in phase 0 (I11).
 *  `applied`  — the write returned success, or phase 0 found the live text
 *               equal to `afterText` / the comment gone under `verb='delete'`.
 *  `failed`   — the write provably never reached YouTube: it was never issued
 *               (credit refusal, an abort before phase 2, a halt), or YouTube
 *               answered 4xx (`isDefinitiveYouTubeRejection`), or phase 0 found
 *               the live text still equal to `beforeText`.
 *  `unknown`  — terminal "we cannot tell". Reached when a write's outcome is
 *               ambiguous (timeout, 5xx, dropped socket) on a path no phase 0
 *               will ever visit — the single-item verbs, since phase 0 runs
 *               only inside `bulkUpdateComments` and there is no bulk delete —
 *               and when phase 0 itself cannot decide.
 *
 * Where the evidence is genuinely ambiguous the answer is always `unknown`,
 * never a status that asserts something. `unknown` is honest; a wrong `applied`
 * hides a lost write, and a wrong `failed` feeds the restore path a `beforeText`
 * that would push stale content back over a comment YouTube really did change.
 */

/** Whether a later phase 0 can still settle a row left `pending`. */
type Reconcilable = "reconcilable" | "terminal";

const DEFAULT_EDITS_LIMIT = 50;
const MAX_EDITS_LIMIT = 100;

/**
 * The edit-log columns every surface may see — exactly the fields `openapi.yaml`
 * documents for `GET /youtube/comments/edits`.
 *
 * Selected explicitly rather than with a bare `select()`: the row also carries
 * `organizationId` and `userId`, which the published schema does not list and
 * no caller needs, and a `select()` would leak whatever column is added next.
 */
const EDIT_LOG_COLUMNS = {
  id: commentEdits.id,
  channelId: commentEdits.channelId,
  commentId: commentEdits.commentId,
  videoId: commentEdits.videoId,
  verb: commentEdits.verb,
  textSource: commentEdits.textSource,
  beforeText: commentEdits.beforeText,
  afterText: commentEdits.afterText,
  status: commentEdits.status,
  source: commentEdits.source,
  createdAt: commentEdits.createdAt,
} as const;

const UC_CHANNEL_ID = /^UC[\w-]{22}$/;

/**
 * Tally of the credits one service call actually consumed. The service charges
 * it next to every `consumeCredits`, so the number is what was really billed —
 * including on error paths, where a call can bill for reads and then fail.
 *
 * Each surface creates one per request and reads `meter.total` when it logs.
 */
export interface CreditMeter {
  charge(credits: number): void;
  /**
   * Takes a charge back off the tally after the ledger returned it. Every
   * surface logs `meter.total` into `apiRequestLog.quotaUnits`, so without this
   * the log would report credits the caller was not billed for.
   */
  refund(credits: number): void;
  readonly total: number;
}

export function createCreditMeter(): CreditMeter {
  let total = 0;
  return {
    charge(credits: number) {
      total += credits;
    },
    refund(credits: number) {
      total -= credits;
    },
    get total() {
      return total;
    },
  };
}

/** Who is acting, and through which surface — recorded on every snapshot row. */
export interface CommentContext {
  userId: string;
  organizationId: string;
  source: "mcp" | "rest" | "dashboard";
  meter: CreditMeter;
}

export interface BulkUpdateItem {
  id: string;
  videoId?: string;
  text: string;
}

export interface BulkItemResult {
  id: string;
  status: "ok" | "error" | "skipped";
  error?: { code: string; message: string };
}

/**
 * Phase-0 tally. A type alias rather than an interface so it carries an implicit
 * index signature and drops straight into an error's `JsonValue` meta bag.
 */
export type ReconcileCounts = {
  /** Stale `pending` rows examined by phase 0. */
  scanned: number;
  applied: number;
  failed: number;
  unknown: number;
};

/**
 * Why a batch stopped before it reached the end of its items. Three genuinely
 * different conditions that a single "quota" bucket would conflate:
 *
 *  - `quota`      — the *daily* Data API quota is exhausted. Nothing succeeds
 *                   until Pacific midnight, so this trips the breaker and is
 *                   the only reason that carries `resetsAt`.
 *  - `rateLimit`  — a transient per-100-second throttle (429 /
 *                   `rateLimitExceeded` / `userRateLimitExceeded`). Retrying in
 *                   about a minute works, so it must not trip the daily breaker
 *                   and must not quote a midnight reset. The batch still stops:
 *                   a tight write loop cannot outlast the throttle window and
 *                   would burn 50 credits per doomed item (I7/I10).
 *  - `credits`    — the *workspace's* plan credits ran out (or the ledger was
 *                   unreachable). Nothing to do with YouTube; kept separate so
 *                   "wait for the Pacific reset" is never the advice for it.
 *  - `timeBudget` — the batch ran out of wall clock and stopped itself rather
 *                   than be killed mid-write by the platform.
 */
export type BulkHaltReason = "quota" | "rateLimit" | "credits" | "timeBudget";

export interface BulkUpdateResult {
  results: BulkItemResult[];
  reconciled: ReconcileCounts;
  /** Kept on this one result because the workbench renders it. */
  creditsConsumed: number;
  /** Present only when the batch stopped early; `skipped` items were never sent. */
  halted?: BulkHaltReason;
  /** Present only for a `quota` halt — a daily exhaustion is the only one with a reset. */
  resetsAt?: string;
}

type ServiceError = Extract<ServiceResult<unknown>, { error: unknown }>["error"];

function fail(
  code: string,
  message: string,
  suggestion: string,
  status: number,
  meta?: Record<string, JsonValue>
): { error: ServiceError } {
  return { error: { code, message, suggestion, status, ...(meta ? { meta } : {}) } };
}

function invalidChannel(channelId: string): { error: ServiceError } {
  return fail(
    "INVALID_CHANNEL",
    `'${channelId}' is not a YouTube channel ID`,
    "Pass the UC... channel ID of a channel connected to this workspace (list_channels returns it)",
    400
  );
}

/** Translates a `getChannelTokens` failure into a service error. */
function tokenError(result: {
  error: { error: { code: string; message: string; suggestion?: string } };
  status: number;
}): { error: ServiceError } {
  return fail(
    result.error.error.code,
    result.error.error.message,
    result.error.error.suggestion ?? "",
    result.status
  );
}

function insufficientCredits(): { error: ServiceError } {
  return fail(
    "QUOTA_EXCEEDED",
    "Insufficient credits",
    "Upgrade your plan or wait for the next billing cycle",
    429
  );
}

/**
 * The envelope for our own failures — a token decrypt that threw, a credit
 * ledger that was unreachable. Every surface contracts to return
 * `{data, error, meta}`; letting one of these escape as a bare 500 breaks that
 * contract *and* skips the caller's request log.
 */
function internalError(): { error: ServiceError } {
  return fail(
    "INTERNAL_ERROR",
    "The comment service could not complete the request",
    "Nothing was written to YouTube. Try again in a moment.",
    500
  );
}

/** `ok` billed, `insufficient` the balance is out, `error` the ledger threw. */
type ChargeOutcome = "ok" | "insufficient" | "error";

/**
 * What one charge did. `refundable` is what may be given back if the call it
 * paid for turns out to have done nothing — 0 whenever nothing was really
 * deducted, so a refund can never invent credits.
 */
interface Charge {
  outcome: ChargeOutcome;
  refundable: number;
}

/**
 * Consumes credits and records them on the caller's meter in one step, so the
 * two can never drift. A throw from the ledger is folded into `error` rather
 * than propagated: callers have snapshot rows to finalize before they return.
 *
 * `consumeCredits` *fails open*: on a DB error it reports success with an
 * infinite `remaining` having deducted nothing at all. That path must never be
 * refunded, so a finite `remaining` — the balance the UPDATE actually returned
 * — is what marks a charge as genuinely deducted.
 */
async function chargeCredits(ctx: CommentContext, cost: number): Promise<Charge> {
  let success: boolean;
  let remaining: number;
  try {
    ({ success, remaining } = await consumeCredits(ctx.organizationId, cost));
  } catch (err) {
    console.error("comments: credit ledger unavailable", err);
    return { outcome: "error", refundable: 0 };
  }
  if (!success) return { outcome: "insufficient", refundable: 0 };
  ctx.meter.charge(cost);
  return { outcome: "ok", refundable: Number.isFinite(remaining) ? cost : 0 };
}

/**
 * Gives a charge back after the call it paid for provably did no work, and
 * takes it off the meter so the request log reports the net.
 *
 * Only ever called where the evidence is definitive. An ambiguous write —
 * a timeout, a 5xx, a dropped socket — may have landed on YouTube, and
 * refunding one would bill nothing for work that really happened; the
 * `comment_edits` status machine draws the same line (`failed` vs `unknown`).
 */
async function refundCharge(ctx: CommentContext, charge: Charge): Promise<void> {
  if (charge.refundable <= 0) return;
  // Only decrement the meter if the ledger really credited it back: an
  // unreachable ledger means the caller stays billed, and the log must say so.
  if (await refundCredits(ctx.organizationId, charge.refundable)) {
    ctx.meter.refund(charge.refundable);
  }
}

/** Maps a charge failure onto the envelope it deserves. */
function chargeError(outcome: "insufficient" | "error"): { error: ServiceError } {
  return outcome === "insufficient" ? insufficientCredits() : internalError();
}

/**
 * Which YouTube call failed, and on whose behalf. Carried only so a failure
 * can name itself in the logs — nothing branches on it.
 */
interface YouTubeCallContext {
  /** The service operation, plus the step within it: `updateComment:write`. */
  operation: string;
  channelId: string;
  organizationId: string;
}

/**
 * Records why a YouTube call failed. Every throw in this file passes through
 * here, so a bare 400 in the platform logs stops being the whole story.
 *
 * `reason` is the field that names the cause — `processingFailure`,
 * `insufficientPermissions`, `quotaExceeded` — and it is read off the raw throw
 * rather than the mapped envelope, which carries `reasons` on quota errors
 * alone. A 403 is exactly the case where the envelope has dropped it.
 *
 * Never logs a token or any comment text: the operation, the ids, and
 * YouTube's own message about its own refusal.
 */
function logYouTubeFailure(err: unknown, context: YouTubeCallContext): void {
  const mapped = mapYouTubeServiceError(err);
  const detail = youTubeErrorDetail(err);
  console.error("comments: YouTube call failed", {
    operation: context.operation,
    channelId: context.channelId,
    organizationId: context.organizationId,
    code: mapped.code,
    status: mapped.status,
    upstreamStatus: detail.upstreamStatus,
    reasons: detail.reasons,
    upstreamMessage: detail.message,
  });
}

/** Maps a thrown YouTube error into the service envelope, and logs the cause. */
function youtubeError(err: unknown, context: YouTubeCallContext): { error: ServiceError } {
  logYouTubeFailure(err, context);
  const mapped = mapYouTubeServiceError(err);
  const meta: Record<string, JsonValue> = {};
  if (mapped.meta?.upstreamStatus !== undefined) meta.upstreamStatus = mapped.meta.upstreamStatus;
  if (mapped.meta?.reasons) meta.reasons = mapped.meta.reasons;
  return {
    error: {
      code: mapped.code,
      message: mapped.message,
      suggestion: mapped.suggestion,
      status: mapped.status,
      ...(Object.keys(meta).length > 0 ? { meta } : {}),
    },
  };
}

/**
 * Resolves the channel token for a call: rejects anything that is not a UC...
 * ID (I9 — no `getAnyUserToken` fallback, so a read can never authenticate as
 * an arbitrary connected channel).
 *
 * `getChannelTokens` decrypts the stored token, and `decrypt` throws outright
 * on a rotated `ENCRYPTION_KEY`. That throw is caught here rather than left to
 * escape, because every caller's contract is an envelope: an uncaught throw
 * would surface as a bare 500 with no `suggestion` and no request-log row.
 */
async function resolveChannelToken(
  channelId: string,
  ctx: CommentContext
): Promise<{ accessToken: string } | { error: ServiceError }> {
  if (!UC_CHANNEL_ID.test(channelId)) return invalidChannel(channelId);
  let tokens: Awaited<ReturnType<typeof getChannelTokens>>;
  try {
    tokens = await getChannelTokens(channelId, ctx.userId, ctx.organizationId);
  } catch (err) {
    console.error("comments: failed to resolve the channel token", err);
    return internalError();
  }
  if ("error" in tokens) return tokenError(tokens);
  return { accessToken: tokens.accessToken };
}

/**
 * The shape every plain YouTube call in this file shares: resolve the acting
 * channel's token, bill the credits, run the call, translate a throw.
 *
 * `noteQuotaHalt` runs on *every* failure, reads included — a read that hits the
 * daily quota trips the breaker exactly as a write does (I7).
 *
 * Snapshotted writes do not use this: they interleave a read, an insert and a
 * write, and `snapshottedWrite` below owns that sequence.
 */
async function meteredCall<T>(
  spec: {
    /** Names the failing call in the logs. */
    operation: string;
    channelId: string;
    /** Sets the cost, and what a throw is allowed to refund. */
    effect: "read" | "write";
  },
  ctx: CommentContext,
  call: (accessToken: string) => Promise<T>
): Promise<ServiceResult<T>> {
  const { operation, channelId, effect } = spec;
  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;

  const charge = await chargeCredits(ctx, effect === "read" ? READ_CREDITS : WRITE_CREDITS);
  if (charge.outcome !== "ok") return chargeError(charge.outcome);

  try {
    return { data: await call(token.accessToken) };
  } catch (err) {
    // A read that threw returned nothing and changed nothing, so its credit
    // bought the caller no work at all — a channel whose token lacks the
    // `youtube.force-ssl` scope 403s on every comment call, and without this
    // it would drain a balance one retry at a time.
    //
    // A write is only refundable on the same evidence `comment_edits` demands
    // for `failed`: YouTube answered 4xx, so the comment provably never
    // changed. A timeout or a 5xx may have landed, and these two verbs post
    // new content with no snapshot row to reconcile it against later.
    if (effect === "read" || isDefinitiveYouTubeRejection(err)) {
      await refundCharge(ctx, charge);
    }
    await noteQuotaHalt(err);
    return youtubeError(err, {
      operation,
      channelId,
      organizationId: ctx.organizationId,
    });
  }
}

// ── list_comment_threads ─────────────────────────────────────

/**
 * Lists top-level comment threads on one video. 1 credit per page.
 */
export async function listCommentThreads(
  channelId: string,
  videoId: string,
  ctx: CommentContext,
  opts: { maxResults?: number; order?: string; pageToken?: string } = {}
): Promise<ServiceResult<{ items: YouTubeCommentThread[]; nextPageToken?: string }>> {
  return meteredCall(
    { operation: "listCommentThreads", channelId, effect: "read" },
    ctx,
    (accessToken) => ytListCommentThreads(accessToken, videoId, opts)
  );
}

// ── search_channel_comments ──────────────────────────────────

/**
 * Searches every comment thread related to a channel, optionally narrowed by
 * `searchTerms` — the primary discovery step of a course-link sweep (I1: state
 * is never stored, comments are re-found live). 1 credit per page.
 *
 * Results always come back newest-first. YouTube cannot order a channel-wide
 * search by relevance — see `searchChannelCommentThreads` — so there is no
 * `order` option to pass through; per-video listing keeps one.
 */
export async function searchChannelComments(
  channelId: string,
  ctx: CommentContext,
  opts: { searchTerms?: string; maxResults?: number; pageToken?: string } = {}
): Promise<ServiceResult<{ items: YouTubeCommentThread[]; nextPageToken?: string }>> {
  return meteredCall(
    { operation: "searchChannelComments", channelId, effect: "read" },
    ctx,
    (accessToken) => ytSearchChannelCommentThreads(accessToken, channelId, opts)
  );
}

// ── get_comment_replies ──────────────────────────────────────

/**
 * Lists the full reply set of a thread — `commentThreads.list` inlines only a
 * partial subset. 1 credit per page.
 */
export async function getCommentReplies(
  channelId: string,
  parentId: string,
  ctx: CommentContext,
  opts: { maxResults?: number; pageToken?: string } = {}
): Promise<ServiceResult<{ items: YouTubeComment[]; nextPageToken?: string }>> {
  return meteredCall(
    { operation: "getCommentReplies", channelId, effect: "read" },
    ctx,
    (accessToken) => ytListCommentReplies(accessToken, parentId, opts)
  );
}

// ── list_comment_edits ───────────────────────────────────────

/**
 * Reads the `comment_edits` audit trail for the organization. No YouTube call,
 * so 0 credits. Only `textSource: 'original'` rows are restorable (I2a) — a
 * `'display'` row is HTML-marked-up and is an audit record only.
 *
 * Returns the documented columns only, never the whole row: `organizationId`
 * and `userId` are scope, not payload.
 */
export async function listCommentEdits(
  ctx: CommentContext,
  opts: PaginationOpts & { channelId?: string; commentId?: string } = {}
): Promise<ServiceResult<{ data: unknown[]; meta: PaginationMeta }>> {
  try {
    // Clamp both ends and coerce to an integer: `limit: 0` would otherwise
    // return an unpageable dead end (`hasMore: true` with no cursor), and a
    // negative or fractional limit would fail in the driver.
    const requested = Number.isFinite(opts.limit)
      ? Math.trunc(opts.limit as number)
      : DEFAULT_EDITS_LIMIT;
    const limit = Math.min(Math.max(requested, 1), MAX_EDITS_LIMIT);

    const scopeFilters: SQL[] = [eq(commentEdits.organizationId, ctx.organizationId)];
    if (opts.channelId) scopeFilters.push(eq(commentEdits.channelId, opts.channelId));
    if (opts.commentId) scopeFilters.push(eq(commentEdits.commentId, opts.commentId));

    const filters: SQL[] = [...scopeFilters];
    if (opts.cursor) {
      if (!isEncodedCompositeCursor(opts.cursor)) return invalidCursor();
      const cursor = decodeCompositeCursor(opts.cursor);
      if (!cursor || cursor.scope !== "comment_edits" || !isValidCursorId(cursor.id)) {
        return invalidCursor();
      }
      const cursorDate = cursor.key === null ? null : new Date(cursor.key);
      if (!cursorDate || Number.isNaN(cursorDate.getTime())) return invalidCursor();
      // The cursor key can only ever carry millisecond precision: node-postgres
      // truncates the µs-precision timestamptz when it reads it, so the exact
      // stored value is not available to put in a cursor at all. The filter
      // therefore buckets by millisecond — `created_at < cursorDate` is exactly
      // "truncates below the cursor", and the half-open window
      // [cursorDate, cursorDate+1ms) is exactly "truncates equal to it", where
      // the id tiebreaker applies. Typed operators keep the Date encoders in
      // play, and both comparisons stay index-friendly.
      //
      // `ORDER BY` below truncates to the same millisecond for exactly this
      // reason. Ordering by the raw µs value would sort rows *within* a
      // millisecond bucket by timestamp while the filter tiebreaks them by id —
      // two disagreeing orders, under which a row can be skipped by every page
      // or returned by two.
      const cursorDateNextMs = new Date(cursorDate.getTime() + 1);
      filters.push(
        or(
          lt(commentEdits.createdAt, cursorDate),
          and(
            gte(commentEdits.createdAt, cursorDate),
            lt(commentEdits.createdAt, cursorDateNextMs),
            lt(commentEdits.id, cursor.id)
          )
        )!
      );
    }

    const rows = await db
      .select(EDIT_LOG_COLUMNS)
      .from(commentEdits)
      .where(and(...filters))
      // Millisecond-truncated, to agree with the cursor filter above. No value
      // is interpolated here, so no encoder is bypassed.
      .orderBy(
        sql`date_trunc('milliseconds', ${commentEdits.createdAt}) desc`,
        desc(commentEdits.id)
      )
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCompositeCursor({
            scope: "comment_edits",
            key: last.createdAt.toISOString(),
            id: last.id,
          })
        : undefined;

    const [totalResult] = await db
      .select({ total: count() })
      .from(commentEdits)
      .where(and(...scopeFilters));

    return {
      data: {
        data: items,
        meta: { cursor: nextCursor, hasMore, total: totalResult?.total ?? 0 },
      },
    };
  } catch {
    return fail("INTERNAL_ERROR", "Failed to list comment edits", "Try again later", 500);
  }
}

function invalidCursor(): { error: ServiceError } {
  return fail(
    "INVALID_CURSOR",
    "Invalid cursor format",
    "Omit the cursor to start from the first page",
    400
  );
}

// ── reply_to_comment ─────────────────────────────────────────

/**
 * Replies to an existing comment. New content, so no snapshot row (I2).
 * 50 credits.
 */
export async function replyToComment(
  channelId: string,
  parentId: string,
  text: string,
  ctx: CommentContext
): Promise<ServiceResult<{ comment: YouTubeComment }>> {
  return meteredCall(
    { operation: "replyToComment", channelId, effect: "write" },
    ctx,
    async (accessToken) => ({
      comment: await ytReplyToComment(accessToken, parentId, text),
    })
  );
}

// ── post_comment ─────────────────────────────────────────────

/**
 * Posts a new top-level comment on a video. New content, so no snapshot row.
 * 50 credits.
 */
export async function postComment(
  channelId: string,
  videoId: string,
  text: string,
  ctx: CommentContext
): Promise<ServiceResult<{ thread: YouTubeCommentThread }>> {
  return meteredCall(
    { operation: "postComment", channelId, effect: "write" },
    ctx,
    async (accessToken) => ({
      thread: await ytPostCommentThread(accessToken, videoId, text),
    })
  );
}

// ── update_comment ───────────────────────────────────────────

/**
 * The 403 an unauthored comment earns from YouTube. A single-item update does
 * not pre-check authorship the way a batch does, so this is the only place the
 * caller learns why the edit was refused.
 */
const AUTHORSHIP_403_SUGGESTION =
  "You can only edit comments authored by the connected channel. Confirm the channelId matches the channel that wrote the comment.";

/**
 * Edits a comment in place (I3 — never delete-and-repost, which silently
 * unpins). Snapshots the prior text first (I2): 1 credit for the read, 50 for
 * the write.
 *
 * Unlike a bulk batch this does not pre-check authorship — a comment the
 * channel did not write surfaces YouTube's own 403.
 */
export async function updateComment(
  channelId: string,
  commentId: string,
  text: string,
  ctx: CommentContext,
  opts: { videoId?: string } = {}
): Promise<ServiceResult<{ comment: YouTubeComment; editId: string }>> {
  // `youtube-errors.ts` maps every 403 by status alone, so "FORBIDDEN" on its
  // own does not mean the authorship rule bit — a missing `youtube.force-ssl`
  // scope earns the same code. The snapshot read has already told us who wrote
  // the comment, for free, so only rewrite the suggestion when authorship
  // really is the mismatch; otherwise sending the agent to re-check a channelId
  // that was never the problem costs it another 51 credits.
  let authoredByChannel: boolean | undefined;

  const result = await snapshottedWrite(channelId, commentId, ctx, {
    verb: "update",
    afterText: text,
    videoId: opts.videoId,
    inspect: (comment) => {
      const author = comment.snippet.authorChannelId?.value;
      if (typeof author === "string") authoredByChannel = author === channelId;
    },
    write: async (accessToken) => {
      const comment = await ytUpdateComment(accessToken, commentId, text);
      return { comment };
    },
  });

  if ("error" in result && result.error.code === "FORBIDDEN" && authoredByChannel === false) {
    return { error: { ...result.error, suggestion: AUTHORSHIP_403_SUGGESTION } };
  }
  return result;
}

// ── delete_comment ───────────────────────────────────────────

/**
 * Deletes a comment permanently (I4 — one verb, no moderation queue). The
 * snapshot is the only surviving copy; for a third-party comment it is
 * `textDisplay` and is an audit record, not a restore source (I2a).
 * 1 credit for the read, 50 for the write.
 */
export async function deleteComment(
  channelId: string,
  commentId: string,
  ctx: CommentContext,
  opts: { videoId?: string } = {}
): Promise<ServiceResult<{ deleted: true; editId: string }>> {
  return snapshottedWrite(channelId, commentId, ctx, {
    verb: "delete",
    afterText: null,
    videoId: opts.videoId,
    write: async (accessToken) => {
      await ytDeleteComment(accessToken, commentId);
      return { deleted: true as const };
    },
  });
}

/**
 * Read-snapshot-write for the two destructive single-item verbs. The row is
 * inserted `pending` before the YouTube call and transitions afterwards — the
 * only column that ever changes (I8).
 */
async function snapshottedWrite<T>(
  channelId: string,
  commentId: string,
  ctx: CommentContext,
  spec: {
    verb: "update" | "delete";
    afterText: string | null;
    videoId?: string;
    /** Runs on the snapshot read's comment, before anything is written. */
    inspect?: (comment: YouTubeComment) => void;
    write: (accessToken: string) => Promise<T>;
  }
): Promise<ServiceResult<T & { editId: string }>> {
  const operation = spec.verb === "update" ? "updateComment" : "deleteComment";
  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;

  const readCharge = await chargeCredits(ctx, READ_CREDITS);
  if (readCharge.outcome !== "ok") return chargeError(readCharge.outcome);

  let comment: YouTubeComment | null;
  try {
    comment = await ytGetCommentById(token.accessToken, commentId);
  } catch (err) {
    // The snapshot read returned nothing, so nothing was snapshotted and
    // nothing was written — the same refund a plain read gets.
    await refundCharge(ctx, readCharge);
    await noteQuotaHalt(err);
    return youtubeError(err, {
      operation: `${operation}:snapshotRead`,
      channelId,
      organizationId: ctx.organizationId,
    });
  }
  if (!comment) return snapshotFailed(commentId);
  spec.inspect?.(comment);

  const snapshot = snapshotOf(comment);
  let editId: string;
  try {
    const [row] = await db
      .insert(commentEdits)
      .values({
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        channelId,
        commentId,
        videoId: spec.videoId ?? null,
        verb: spec.verb,
        textSource: snapshot.textSource,
        beforeText: snapshot.beforeText,
        afterText: spec.afterText,
        status: "pending",
        source: ctx.source,
      })
      .returning({ id: commentEdits.id });
    editId = row!.id;
  } catch {
    return fail(
      "SNAPSHOT_FAILED",
      "Could not record the comment's prior text",
      "Nothing was written to YouTube. Try again — every destructive comment write is snapshotted first.",
      500,
      { commentId }
    );
  }

  const writeCharge = await chargeCredits(ctx, WRITE_CREDITS);
  if (writeCharge.outcome !== "ok") {
    // A known-unattempted write: the row can be finalized now.
    await setEditStatus(editId, "failed");
    return chargeError(writeCharge.outcome);
  }

  try {
    const data = await spec.write(token.accessToken);
    await setEditStatus(editId, "applied");
    return { data: { ...data, editId } };
  } catch (err) {
    // "terminal": phase 0 runs only inside `bulkUpdateComments`, so no sweep
    // will ever visit a row this path leaves behind — least of all a `delete`
    // row, since there is no bulk delete at all.
    await settleFailedWrite(editId, err, "terminal");
    // Refund the write on exactly the evidence that just finalized the row
    // `failed`: YouTube answered 4xx, so the comment provably never changed.
    // A row left `unknown` is never refunded — the write may have landed, and
    // billing nothing for a write that really happened is the worse error.
    //
    // The read charge stands either way: that call succeeded and spent real
    // YouTube quota to produce the snapshot.
    if (isDefinitiveYouTubeRejection(err)) await refundCharge(ctx, writeCharge);
    await noteQuotaHalt(err);
    return youtubeError(err, {
      operation: `${operation}:write`,
      channelId,
      organizationId: ctx.organizationId,
    });
  }
}

// ── update_comments (bulk) ───────────────────────────────────

/**
 * Applies up to 40 per-item replacement texts to one channel's comments.
 *
 * Runs in three phases (I6):
 *  - **phase 0** reconciles this channel's stale `pending` rows (I11);
 *  - **phase 1** snapshots and validates every item — any read failure,
 *    authorship mismatch or insert failure aborts the batch with *nothing*
 *    written to YouTube;
 *  - **phase 2** performs the writes, one item at a time.
 *
 * Credits: 1 per reconciled row, then 51 per item (1 snapshot + 50 write),
 * charged as each item is attempted. A halt in phase 2 leaves earlier items
 * applied and returns the rest as `skipped` — resend those IDs to resume.
 * `halted` says which of the three conditions stopped it (`BulkHaltReason`);
 * a halt in phase 0 or 1 aborts with nothing written at all.
 */
export async function bulkUpdateComments(
  channelId: string,
  items: BulkUpdateItem[],
  ctx: CommentContext
): Promise<ServiceResult<BulkUpdateResult>> {
  if (items.length === 0) {
    return fail(
      "INVALID_ITEMS",
      "items must contain at least one comment",
      "Send { channelId, items: [{ id, text }] } with 1-40 items",
      400
    );
  }
  if (items.length > BULK_MAX_ITEMS) {
    return fail(
      "INVALID_ITEMS",
      `A batch carries at most ${BULK_MAX_ITEMS} comments (received ${items.length})`,
      `Split the IDs into batches of ${BULK_MAX_ITEMS} and loop`,
      400
    );
  }
  const uniqueIds = new Set(items.map((item) => item.id));
  if (uniqueIds.size !== items.length) {
    return fail(
      "INVALID_ITEMS",
      "items contains duplicate comment IDs",
      "Send each comment ID once, with the final replacement text",
      400
    );
  }

  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;
  const { accessToken } = token;

  const reconciled: ReconcileCounts = { scanned: 0, applied: 0, failed: 0, unknown: 0 };

  // Stop starting YouTube calls once the next one could not finish inside the
  // budget. Being killed by the platform mid-phase-2 is the failure this avoids.
  const budgetExpiresAt = Date.now() + BULK_BUDGET_MS;
  const canStartCall = () => Date.now() + YOUTUBE_CALL_TIMEOUT_MS <= budgetExpiresAt;

  // ── Phase 0: reconcile stale pending rows (I11) ────────────
  let staleRows: Array<typeof commentEdits.$inferSelect>;
  try {
    staleRows = await db
      .select()
      .from(commentEdits)
      .where(
        and(
          eq(commentEdits.organizationId, ctx.organizationId),
          eq(commentEdits.channelId, channelId),
          eq(commentEdits.status, "pending"),
          lt(commentEdits.createdAt, new Date(Date.now() - STALE_PENDING_MS))
        )
      )
      .orderBy(asc(commentEdits.createdAt))
      .limit(BULK_MAX_ITEMS);
  } catch {
    return fail(
      "INTERNAL_ERROR",
      "Failed to read pending comment edits",
      "Try again later",
      500
    );
  }

  for (const row of staleRows) {
    // The sweep is best-effort work the caller did not ask for, so it never
    // eats the budget the batch itself needs.
    if (!canStartCall()) break;

    const charge = await chargeCredits(ctx, READ_CREDITS);
    if (charge.outcome !== "ok") return chargeError(charge.outcome);
    reconciled.scanned += 1;

    let live: YouTubeComment | null;
    try {
      // A comment that is gone comes back as null, whether YouTube reports it
      // as an empty item list or as a 404 — the client normalizes both.
      live = await ytGetCommentById(accessToken, row.commentId);
    } catch (err) {
      // The read told the sweep nothing, so it bills nothing. `scanned` still
      // counts the row: it was examined, and its status below depends on it.
      await refundCharge(ctx, charge);
      // The sweep swallows this failure rather than returning an envelope, so
      // it logs the cause itself — otherwise a row that no batch can ever read
      // fails invisibly, every batch, forever.
      logYouTubeFailure(err, {
        operation: "bulkUpdateComments:reconcileRead",
        channelId,
        organizationId: ctx.organizationId,
      });
      const halt = haltReason(err);
      if (halt) {
        await noteBulkHalt(halt);
        return haltedError(halt, reconciled);
      }
      // A row this sweep cannot read is settled rather than left behind. The
      // select is `oldest first, limit 40` with nowhere to record an attempt
      // (I8 allows no other column to change), so a permanently unreadable row
      // — a 403 on a comment whose video went private — would otherwise sit at
      // the head of every future batch: re-read, re-billed 1 credit, and
      // blocking 1/40th of the sweep from ever reaching newer rows.
      //
      // A 4xx is YouTube's decision and will not change, so the truth about
      // that row is permanently unavailable: `unknown`. A 5xx or a timeout is
      // transient, so that one really can wait for the next batch.
      if (isDefinitiveYouTubeRejection(err)) {
        await setEditStatus(row.id, "unknown");
        reconciled.unknown += 1;
      }
      continue;
    }

    const status = reconcileStatus(row, live);
    await setEditStatus(row.id, status);
    reconciled[status] += 1;
  }

  // ── Phase 1: snapshot and validate every item ──────────────
  //
  // Nothing in this phase reaches YouTube, so every snapshot already inserted
  // records a write that never happened. Each abort below finalizes those rows
  // `failed` before it returns: a row left `pending` would be swept by a later
  // phase 0, which bills a read for it and — if a retry has since written the
  // same `afterText` — would flip it to `applied`, inventing a write this call
  // never made. `comment_edits` is the only surviving copy of the prior text,
  // so it must never claim a write that did not happen.
  const snapshots: Array<{ item: BulkUpdateItem; editId: string }> = [];
  const abort = async (result: { error: ServiceError }): Promise<{ error: ServiceError }> => {
    await markEditsFailed(snapshots.map((snapshot) => snapshot.editId));
    return result;
  };

  for (const item of items) {
    if (!canStartCall()) return abort(outOfTimeError(reconciled));

    const charge = await chargeCredits(ctx, READ_CREDITS);
    if (charge.outcome !== "ok") return abort(chargeError(charge.outcome));

    let comment: YouTubeComment | null;
    try {
      comment = await ytGetCommentById(accessToken, item.id);
    } catch (err) {
      // No snapshot, so no write: the read bills nothing.
      await refundCharge(ctx, charge);
      const halt = haltReason(err);
      if (halt) {
        await noteBulkHalt(halt);
        return abort(haltedError(halt, reconciled));
      }
      return abort(
        youtubeError(err, {
          operation: "bulkUpdateComments:snapshotRead",
          channelId,
          organizationId: ctx.organizationId,
        })
      );
    }

    if (!comment) return abort(snapshotFailed(item.id, reconciled));

    if (comment.snippet.authorChannelId?.value !== channelId) {
      return abort(
        fail(
          "AUTHORSHIP_MISMATCH",
          `Comment ${item.id} was not written by channel ${channelId}`,
          "A bulk update edits only comments the acting channel authored. Drop that ID and resend the batch — nothing was written to YouTube.",
          403,
          { commentId: item.id, reconciled }
        )
      );
    }

    const snapshot = snapshotOf(comment);
    try {
      const [row] = await db
        .insert(commentEdits)
        .values({
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          channelId,
          commentId: item.id,
          videoId: item.videoId ?? null,
          verb: "update",
          textSource: snapshot.textSource,
          beforeText: snapshot.beforeText,
          afterText: item.text,
          status: "pending",
          source: ctx.source,
        })
        .returning({ id: commentEdits.id });
      snapshots.push({ item, editId: row!.id });
    } catch {
      return abort(
        fail(
          "SNAPSHOT_FAILED",
          `Could not record the prior text of comment ${item.id}`,
          "Nothing was written to YouTube. Try again — every destructive comment write is snapshotted first.",
          500,
          { commentId: item.id, reconciled }
        )
      );
    }
  }

  // ── Phase 2: write ─────────────────────────────────────────
  //
  // Every stop below is a real stop. A throttle is as much a reason to stop as
  // daily exhaustion: the remaining items would each pay 50 credits into a
  // window this loop is far too fast to outlast (I7/I10). What differs is what
  // the halt *means*, which is what `BulkHaltReason` carries back.
  const results: BulkItemResult[] = [];
  /** Rows for items the halt stopped us from ever sending. */
  const unattempted: string[] = [];
  let resetsAt: string | undefined;
  let halted: BulkHaltReason | undefined;

  for (const { item, editId } of snapshots) {
    if (!halted && !canStartCall()) halted = "timeBudget";

    if (halted) {
      unattempted.push(editId);
      results.push({ id: item.id, status: "skipped" });
      continue;
    }

    const charge = await chargeCredits(ctx, WRITE_CREDITS);
    if (charge.outcome !== "ok") {
      // Every remaining item costs the same, so the balance cannot recover;
      // and a ledger that just threw will not answer the next item either.
      await setEditStatus(editId, "failed");
      results.push({
        id: item.id,
        status: "error",
        error:
          charge.outcome === "insufficient"
            ? { code: "QUOTA_EXCEEDED", message: "Insufficient credits" }
            : { code: "INTERNAL_ERROR", message: "The credit ledger was unavailable" },
      });
      halted = "credits";
      continue;
    }

    try {
      await ytUpdateComment(accessToken, item.id, item.text);
      await setEditStatus(editId, "applied");
      results.push({ id: item.id, status: "ok" });
    } catch (err) {
      // "reconcilable": this row is a bulk `update` for `channelId`, which is
      // exactly what phase 0 of the next batch for this org and channel sweeps.
      await settleFailedWrite(editId, err, "reconcilable");
      // Same rule as the single-item write: refund only what YouTube provably
      // refused. A row left `pending` for phase 0 stays billed — it may have
      // landed, and the sweep that settles it must not have to unbill it.
      if (isDefinitiveYouTubeRejection(err)) await refundCharge(ctx, charge);

      const halt = haltReason(err);
      if (halt) {
        await noteBulkHalt(halt);
        halted = halt;
        if (halt === "quota") resetsAt = nextQuotaResetAt().toISOString();
        results.push({
          id: item.id,
          status: "error",
          error:
            halt === "quota"
              ? { code: "QUOTA_EXCEEDED", message: "YouTube Data API daily quota exceeded" }
              : {
                  code: "RATE_LIMITED",
                  message:
                    "YouTube API rate limit exceeded — a short-term throttle, not the daily quota. Resend the skipped IDs in about a minute.",
                },
        });
        continue;
      }

      // Through `youtubeError` rather than the mapper directly, so a per-item
      // failure inside a batch names its cause in the logs like any other.
      const { error: mapped } = youtubeError(err, {
        operation: "bulkUpdateComments:write",
        channelId,
        organizationId: ctx.organizationId,
      });
      results.push({
        id: item.id,
        status: "error",
        error: { code: mapped.code, message: mapped.message },
      });
    }
  }
  await markEditsFailed(unattempted);

  return {
    data: {
      results,
      reconciled,
      creditsConsumed: ctx.meter.total,
      ...(halted ? { halted } : {}),
      ...(resetsAt ? { resetsAt } : {}),
    },
  };
}

/**
 * Phase 1 ran out of wall clock. Nothing has been written, and every snapshot
 * row taken so far is finalized `failed` by the caller's `abort`. (Phase 0 has
 * no items to abort, so it just stops sweeping and lets phase 1 proceed.)
 */
function outOfTimeError(reconciled: ReconcileCounts): { error: ServiceError } {
  return fail(
    "TIME_BUDGET_EXCEEDED",
    "The batch ran out of time before any comment was written",
    "Nothing was written to YouTube. Send a smaller batch — YouTube was answering more slowly than a full batch of 40 allows.",
    504,
    { reconciled }
  );
}

// ── snapshot helpers ─────────────────────────────────────────

/**
 * I2a: YouTube returns `textOriginal` only to the comment's author, so a
 * third-party comment can only be snapshotted from the HTML-marked-up
 * `textDisplay`. `textSource` records which one was captured.
 */
function snapshotOf(comment: YouTubeComment): {
  textSource: "original" | "display";
  beforeText: string;
} {
  const original = comment.snippet.textOriginal;
  return original
    ? { textSource: "original", beforeText: original }
    : { textSource: "display", beforeText: comment.snippet.textDisplay };
}

/**
 * I11: decides what a stranded `pending` row really was. Always returns a
 * status — every stale row phase 0 reads is settled, never re-left `pending`.
 *
 * Live text matching `afterText` means the write landed; matching `beforeText`
 * means it did not; a comment that is gone under `verb='delete'` also landed.
 * Anything else is terminally `unknown` — a later manual edit is
 * indistinguishable from a partial write.
 *
 * The ambiguity is resolved *against* asserting a write. Where `afterText` and
 * `beforeText` are the same string — a "rewrite" whose replacement text equals
 * what was already there — the live text matches both and proves nothing, so
 * neither branch may claim it; testing `afterText` first would silently stamp
 * such a row `applied` for a write this invocation never issued.
 *
 * Both live texts are candidates because the snapshot read keeps YouTube's HTML
 * `textFormat` (see `getCommentById`), so `textDisplay` would not match the
 * plain text a write sent, while `textOriginal` would.
 */
function reconcileStatus(
  row: typeof commentEdits.$inferSelect,
  live: YouTubeComment | null
): "applied" | "failed" | "unknown" {
  if (!live) return row.verb === "delete" ? "applied" : "unknown";

  // Indistinguishable before and after: the live text is evidence for neither.
  if (row.afterText !== null && row.afterText === row.beforeText) return "unknown";

  const candidates = [live.snippet.textOriginal, live.snippet.textDisplay].filter(
    (text): text is string => typeof text === "string"
  );
  if (candidates.includes(row.beforeText)) return "failed";
  if (row.afterText !== null && candidates.includes(row.afterText)) return "applied";
  return "unknown";
}

/**
 * Settles a snapshot row after its YouTube write threw.
 *
 * Only a definitive rejection — YouTube answered with a 4xx — proves the
 * comment is untouched, and that is the one case that may be stamped `failed`.
 * A timeout, a dropped connection or a 5xx may have arrived and been applied,
 * so the outcome is genuinely unknown, and what happens next depends on whether
 * anything can still find out:
 *
 *  - `reconcilable` (a phase-2 row of a bulk batch) — leave it `pending`. Phase
 *    0 of the next batch for the same org and channel reads the live text and
 *    settles it properly (I11).
 *  - `terminal` (the single-item verbs) — record `unknown`. Phase 0 runs only
 *    inside `bulkUpdateComments`, filtered to one org and channel, and there is
 *    no bulk delete and no scheduled sweep; `listCommentEdits` has no status
 *    filter either, so a row left `pending` here would not even be findable.
 *    Promising a reconciliation that cannot arrive is worse than admitting the
 *    outcome is unknown.
 *
 * Guessing `failed` instead would be the worst of the three: it is terminal,
 * and it feeds the restore path a `beforeText` to push back over a comment
 * YouTube really did change.
 */
async function settleFailedWrite(
  editId: string,
  err: unknown,
  reconcilable: Reconcilable
): Promise<void> {
  if (isDefinitiveYouTubeRejection(err)) {
    await setEditStatus(editId, "failed");
    return;
  }
  if (reconcilable === "terminal") await setEditStatus(editId, "unknown");
}

async function setEditStatus(
  editId: string,
  status: "applied" | "failed" | "unknown"
): Promise<void> {
  try {
    await db.update(commentEdits).set({ status }).where(eq(commentEdits.id, editId));
  } catch (err) {
    // The YouTube call already happened; losing the status transition must not
    // mask its outcome. Phase 0 of the next batch reconciles the row.
    console.error("Failed to update comment_edits status:", err);
  }
}

/**
 * Finalizes rows for writes that provably never reached YouTube. Status-only,
 * like every other transition (I8).
 */
async function markEditsFailed(editIds: string[]): Promise<void> {
  if (editIds.length === 0) return;
  try {
    await db
      .update(commentEdits)
      .set({ status: "failed" })
      .where(inArray(commentEdits.id, editIds));
  } catch (err) {
    console.error("Failed to finalize unattempted comment_edits rows:", err);
  }
}

function snapshotFailed(
  commentId: string,
  reconciled?: ReconcileCounts
): { error: ServiceError } {
  return fail(
    "SNAPSHOT_FAILED",
    `Comment ${commentId} was not found`,
    "Verify the comment ID from a search result — a deleted comment cannot be edited. Nothing was written to YouTube.",
    404,
    {
      commentId,
      ...(reconciled ? { reconciled } : {}),
    }
  );
}

/**
 * Classifies a throw as one of the two conditions that must stop a batch, or
 * neither. The order matters: daily exhaustion is checked first so it can never
 * be mistaken for the throttle it outranks.
 */
function haltReason(err: unknown): "quota" | "rateLimit" | null {
  if (isYouTubeQuotaError(err)) return "quota";
  if (isYouTubeRateLimitError(err)) return "rateLimit";
  return null;
}

/**
 * Records a halt. Only *daily* exhaustion trips the breaker (I7) — a transient
 * throttle clears in about a minute, and blocking every background sync until
 * Pacific midnight over one is a far larger outage than the throttle itself.
 *
 * Never throws: it runs on error paths that still have snapshot rows to settle.
 */
async function noteBulkHalt(reason: "quota" | "rateLimit"): Promise<void> {
  if (reason !== "quota") return;
  try {
    await markYouTubeQuotaExhausted();
  } catch (err) {
    console.error("comments: failed to record the YouTube quota halt", err);
  }
}

/** The envelope for a halt that stopped a batch before any write landed. */
function haltedError(
  reason: "quota" | "rateLimit",
  reconciled: ReconcileCounts
): { error: ServiceError } {
  if (reason === "quota") {
    return fail(
      "QUOTA_EXCEEDED",
      "YouTube Data API daily quota exceeded",
      "Nothing was written to YouTube. Retry after the quota resets.",
      429,
      { reconciled, resetsAt: nextQuotaResetAt().toISOString() }
    );
  }
  // Deliberately no `resetsAt`: this is a rolling ~100-second throttle, not the
  // daily quota, and reporting a midnight reset would send the caller away for
  // hours over something that clears in a minute.
  return fail(
    "RATE_LIMITED",
    "YouTube API rate limit exceeded",
    "Nothing was written to YouTube. This is a short-term throttle, not the daily quota — wait about a minute and send the batch again.",
    429,
    { reconciled }
  );
}

/** Trips the breaker when a single call hits the daily quota (I7). */
async function noteQuotaHalt(err: unknown): Promise<void> {
  if (isYouTubeQuotaError(err)) await noteBulkHalt("quota");
}
