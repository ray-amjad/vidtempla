import { and, asc, count, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { commentEdits } from "@/db/schema";
import { getChannelTokens } from "@/lib/api-auth";
import { consumeCredits } from "@/lib/plan-limits";
import {
  listCommentThreads as ytListCommentThreads,
  searchChannelCommentThreads as ytSearchChannelCommentThreads,
  getCommentById as ytGetCommentById,
  listCommentReplies as ytListCommentReplies,
  postCommentThread as ytPostCommentThread,
  replyToComment as ytReplyToComment,
  updateComment as ytUpdateComment,
  deleteComment as ytDeleteComment,
  isYouTubeQuotaError,
  type YouTubeComment,
  type YouTubeCommentThread,
} from "@/lib/clients/youtube";
import { mapYouTubeServiceError } from "@/lib/youtube-errors";
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
 * only bills the work it actually did.
 *
 * Credit costs: reads 1, writes 50, snapshotted writes 51 (1 read + 50 write).
 */

const READ_CREDITS = 1;
const WRITE_CREDITS = 50;

/** I5: a bulk batch never exceeds 40 items — the runtime budget depends on it. */
export const BULK_MAX_ITEMS = 40;

/** I11: only `pending` rows older than this are reconciled by phase 0. */
const STALE_PENDING_MS = 10 * 60 * 1000;

const UC_CHANNEL_ID = /^UC[\w-]{22}$/;

/** Who is acting, and through which surface — recorded on every snapshot row. */
export interface CommentContext {
  userId: string;
  organizationId: string;
  source: "mcp" | "rest" | "dashboard";
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

export interface ReconcileCounts {
  /** Stale `pending` rows examined by phase 0. */
  scanned: number;
  applied: number;
  failed: number;
  unknown: number;
}

export interface BulkUpdateResult {
  results: BulkItemResult[];
  reconciled: ReconcileCounts;
  creditsConsumed: number;
  /** Present only when a YouTube quota halt stopped the batch. */
  resetsAt?: string;
}

type ServiceError = Extract<ServiceResult<unknown>, { error: unknown }>["error"];

/**
 * Credits actually consumed by a service call — the number surfaces should log
 * as quota units. Errors carry it in `meta` because a call can bill for reads
 * and then fail.
 */
export function creditsConsumedOf(
  result: ServiceResult<{ creditsConsumed?: number }>
): number {
  if ("error" in result) {
    const consumed = result.error.meta?.creditsConsumed;
    return typeof consumed === "number" ? consumed : 0;
  }
  return result.data.creditsConsumed ?? 0;
}

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

function insufficientCredits(creditsConsumed: number): { error: ServiceError } {
  return fail(
    "QUOTA_EXCEEDED",
    "Insufficient credits",
    "Upgrade your plan or wait for the next billing cycle",
    429,
    { creditsConsumed }
  );
}

/** Maps a thrown YouTube error, tagging on the credits already billed. */
function youtubeError(err: unknown, creditsConsumed: number): { error: ServiceError } {
  const mapped = mapYouTubeServiceError(err);
  const meta: Record<string, JsonValue> = { creditsConsumed };
  if (mapped.meta?.upstreamStatus !== undefined) meta.upstreamStatus = mapped.meta.upstreamStatus;
  if (mapped.meta?.reasons) meta.reasons = mapped.meta.reasons;
  return {
    error: {
      code: mapped.code,
      message: mapped.message,
      suggestion: mapped.suggestion,
      status: mapped.status,
      meta,
    },
  };
}

/**
 * Resolves the channel token for a call: rejects anything that is not a UC...
 * ID (I9 — no `getAnyUserToken` fallback, so a read can never authenticate as
 * an arbitrary connected channel).
 */
async function resolveChannelToken(
  channelId: string,
  ctx: CommentContext
): Promise<{ accessToken: string } | { error: ServiceError }> {
  if (!UC_CHANNEL_ID.test(channelId)) return invalidChannel(channelId);
  const tokens = await getChannelTokens(channelId, ctx.userId, ctx.organizationId);
  if ("error" in tokens) return tokenError(tokens);
  return { accessToken: tokens.accessToken };
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
): Promise<ServiceResult<{ items: YouTubeCommentThread[]; nextPageToken?: string; creditsConsumed: number }>> {
  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;

  const credits = await consumeCredits(ctx.organizationId, READ_CREDITS);
  if (!credits.success) return insufficientCredits(0);

  try {
    const result = await ytListCommentThreads(token.accessToken, videoId, opts);
    return { data: { ...result, creditsConsumed: READ_CREDITS } };
  } catch (err) {
    return youtubeError(err, READ_CREDITS);
  }
}

// ── search_channel_comments ──────────────────────────────────

/**
 * Searches every comment thread related to a channel, optionally narrowed by
 * `searchTerms` — the primary discovery step of a course-link sweep (I1: state
 * is never stored, comments are re-found live). 1 credit per page.
 */
export async function searchChannelComments(
  channelId: string,
  ctx: CommentContext,
  opts: { searchTerms?: string; maxResults?: number; order?: string; pageToken?: string } = {}
): Promise<ServiceResult<{ items: YouTubeCommentThread[]; nextPageToken?: string; creditsConsumed: number }>> {
  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;

  const credits = await consumeCredits(ctx.organizationId, READ_CREDITS);
  if (!credits.success) return insufficientCredits(0);

  try {
    const result = await ytSearchChannelCommentThreads(token.accessToken, channelId, opts);
    return { data: { ...result, creditsConsumed: READ_CREDITS } };
  } catch (err) {
    return youtubeError(err, READ_CREDITS);
  }
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
): Promise<ServiceResult<{ items: YouTubeComment[]; nextPageToken?: string; creditsConsumed: number }>> {
  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;

  const credits = await consumeCredits(ctx.organizationId, READ_CREDITS);
  if (!credits.success) return insufficientCredits(0);

  try {
    const result = await ytListCommentReplies(token.accessToken, parentId, opts);
    return { data: { ...result, creditsConsumed: READ_CREDITS } };
  } catch (err) {
    return youtubeError(err, READ_CREDITS);
  }
}

// ── list_comment_edits ───────────────────────────────────────

/**
 * Reads the `comment_edits` audit trail for the organization. No YouTube call,
 * so 0 credits. Only `textSource: 'original'` rows are restorable (I2a) — a
 * `'display'` row is HTML-marked-up and is an audit record only.
 */
export async function listCommentEdits(
  ctx: CommentContext,
  opts: PaginationOpts & { channelId?: string; commentId?: string } = {}
): Promise<ServiceResult<{ data: unknown[]; meta: PaginationMeta; creditsConsumed: number }>> {
  try {
    const limit = Math.min(opts.limit ?? 50, 100);
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
      const parsedDate = cursor.key === null ? null : new Date(cursor.key);
      if (!parsedDate || Number.isNaN(parsedDate.getTime())) return invalidCursor();
      filters.push(
        or(
          lt(commentEdits.createdAt, parsedDate),
          and(eq(commentEdits.createdAt, parsedDate), lt(commentEdits.id, cursor.id))
        )!
      );
    }

    const rows = await db
      .select()
      .from(commentEdits)
      .where(and(...filters))
      .orderBy(desc(commentEdits.createdAt), desc(commentEdits.id))
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
        creditsConsumed: 0,
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
): Promise<ServiceResult<{ comment: YouTubeComment; creditsConsumed: number }>> {
  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;

  const credits = await consumeCredits(ctx.organizationId, WRITE_CREDITS);
  if (!credits.success) return insufficientCredits(0);

  try {
    const comment = await ytReplyToComment(token.accessToken, parentId, text);
    return { data: { comment, creditsConsumed: WRITE_CREDITS } };
  } catch (err) {
    await noteQuotaHalt(err);
    return youtubeError(err, WRITE_CREDITS);
  }
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
): Promise<ServiceResult<{ thread: YouTubeCommentThread; creditsConsumed: number }>> {
  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;

  const credits = await consumeCredits(ctx.organizationId, WRITE_CREDITS);
  if (!credits.success) return insufficientCredits(0);

  try {
    const thread = await ytPostCommentThread(token.accessToken, videoId, text);
    return { data: { thread, creditsConsumed: WRITE_CREDITS } };
  } catch (err) {
    await noteQuotaHalt(err);
    return youtubeError(err, WRITE_CREDITS);
  }
}

// ── update_comment ───────────────────────────────────────────

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
): Promise<ServiceResult<{ comment: YouTubeComment; editId: string; creditsConsumed: number }>> {
  return snapshottedWrite(channelId, commentId, ctx, {
    verb: "update",
    afterText: text,
    videoId: opts.videoId,
    write: async (accessToken) => {
      const comment = await ytUpdateComment(accessToken, commentId, text);
      return { comment };
    },
  });
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
): Promise<ServiceResult<{ deleted: true; editId: string; creditsConsumed: number }>> {
  const result = await snapshottedWrite(channelId, commentId, ctx, {
    verb: "delete",
    afterText: null,
    videoId: opts.videoId,
    write: async (accessToken) => {
      await ytDeleteComment(accessToken, commentId);
      return { deleted: true as const };
    },
  });
  return result;
}

/**
 * Read-snapshot-write for the two destructive single-item verbs. The row is
 * inserted `pending` before the YouTube call and transitions to `applied` or
 * `failed` after it — the only column that ever changes (I8).
 */
async function snapshottedWrite<T>(
  channelId: string,
  commentId: string,
  ctx: CommentContext,
  spec: {
    verb: "update" | "delete";
    afterText: string | null;
    videoId?: string;
    write: (accessToken: string) => Promise<T>;
  }
): Promise<ServiceResult<T & { editId: string; creditsConsumed: number }>> {
  const token = await resolveChannelToken(channelId, ctx);
  if ("error" in token) return token;

  const readCredits = await consumeCredits(ctx.organizationId, READ_CREDITS);
  if (!readCredits.success) return insufficientCredits(0);
  let consumed = READ_CREDITS;

  let comment: YouTubeComment | null;
  try {
    comment = await ytGetCommentById(token.accessToken, commentId);
  } catch (err) {
    await noteQuotaHalt(err);
    return youtubeError(err, consumed);
  }
  if (!comment) return snapshotFailed(commentId, consumed);

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
      { commentId, creditsConsumed: consumed }
    );
  }

  const writeCredits = await consumeCredits(ctx.organizationId, WRITE_CREDITS);
  if (!writeCredits.success) {
    await setEditStatus(editId, "failed");
    return insufficientCredits(consumed);
  }
  consumed += WRITE_CREDITS;

  try {
    const data = await spec.write(token.accessToken);
    await setEditStatus(editId, "applied");
    return { data: { ...data, editId, creditsConsumed: consumed } };
  } catch (err) {
    await setEditStatus(editId, "failed");
    await noteQuotaHalt(err);
    return youtubeError(err, consumed);
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
 * charged as each item is attempted. A quota halt in phase 2 leaves earlier
 * items applied and returns the rest as `skipped` — resend those IDs to resume.
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

  let creditsConsumed = 0;
  const reconciled: ReconcileCounts = { scanned: 0, applied: 0, failed: 0, unknown: 0 };

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
      500,
      { creditsConsumed }
    );
  }

  for (const row of staleRows) {
    const credits = await consumeCredits(ctx.organizationId, READ_CREDITS);
    if (!credits.success) return insufficientCredits(creditsConsumed);
    creditsConsumed += READ_CREDITS;
    reconciled.scanned += 1;

    let live: YouTubeComment | null;
    try {
      live = await ytGetCommentById(accessToken, row.commentId);
    } catch (err) {
      if (isYouTubeQuotaError(err)) {
        await markYouTubeQuotaExhausted();
        return quotaHalted(creditsConsumed, reconciled);
      }
      // A non-quota read failure leaves the row pending for a later batch.
      continue;
    }

    const status = reconcileStatus(row, live);
    if (!status) continue;
    await setEditStatus(row.id, status);
    reconciled[status] += 1;
  }

  // ── Phase 1: snapshot and validate every item ──────────────
  const snapshots: Array<{ item: BulkUpdateItem; editId: string }> = [];
  for (const item of items) {
    const credits = await consumeCredits(ctx.organizationId, READ_CREDITS);
    if (!credits.success) return insufficientCredits(creditsConsumed);
    creditsConsumed += READ_CREDITS;

    let comment: YouTubeComment | null;
    try {
      comment = await ytGetCommentById(accessToken, item.id);
    } catch (err) {
      if (isYouTubeQuotaError(err)) {
        await markYouTubeQuotaExhausted();
        return quotaHalted(creditsConsumed, reconciled);
      }
      return youtubeError(err, creditsConsumed);
    }

    if (!comment) return snapshotFailed(item.id, creditsConsumed, reconciled);

    if (comment.snippet.authorChannelId?.value !== channelId) {
      return fail(
        "AUTHORSHIP_MISMATCH",
        `Comment ${item.id} was not written by channel ${channelId}`,
        "A bulk update edits only comments the acting channel authored. Drop that ID and resend the batch — nothing was written to YouTube.",
        403,
        { commentId: item.id, creditsConsumed, reconciled: toJson(reconciled) }
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
      return fail(
        "SNAPSHOT_FAILED",
        `Could not record the prior text of comment ${item.id}`,
        "Nothing was written to YouTube. Try again — every destructive comment write is snapshotted first.",
        500,
        { commentId: item.id, creditsConsumed, reconciled: toJson(reconciled) }
      );
    }
  }

  // ── Phase 2: write ─────────────────────────────────────────
  const results: BulkItemResult[] = [];
  let resetsAt: string | undefined;
  let halted = false;

  for (const { item, editId } of snapshots) {
    if (halted) {
      results.push({ id: item.id, status: "skipped" });
      continue;
    }

    const credits = await consumeCredits(ctx.organizationId, WRITE_CREDITS);
    if (!credits.success) {
      // Every remaining item costs the same, so the balance cannot recover.
      await setEditStatus(editId, "failed");
      results.push({
        id: item.id,
        status: "error",
        error: { code: "QUOTA_EXCEEDED", message: "Insufficient credits" },
      });
      halted = true;
      continue;
    }
    creditsConsumed += WRITE_CREDITS;

    try {
      await ytUpdateComment(accessToken, item.id, item.text);
      await setEditStatus(editId, "applied");
      results.push({ id: item.id, status: "ok" });
    } catch (err) {
      await setEditStatus(editId, "failed");
      if (isYouTubeQuotaError(err)) {
        await markYouTubeQuotaExhausted();
        resetsAt = nextQuotaResetAt().toISOString();
        halted = true;
        results.push({
          id: item.id,
          status: "error",
          error: { code: "QUOTA_EXCEEDED", message: "YouTube Data API daily quota exceeded" },
        });
        continue;
      }
      const mapped = mapYouTubeServiceError(err);
      results.push({
        id: item.id,
        status: "error",
        error: { code: mapped.code, message: mapped.message },
      });
    }
  }

  return { data: { results, reconciled, creditsConsumed, ...(resetsAt ? { resetsAt } : {}) } };
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
 * I11: decides what a stranded `pending` row really was.
 *
 * Live text matching `afterText` means the write landed; matching `beforeText`
 * means it did not; a comment that is gone under `verb='delete'` also landed.
 * Anything else is terminally `unknown` — a later manual edit is
 * indistinguishable from a partial write.
 *
 * Both live texts are candidates because `comments.list` is fetched without
 * `textFormat`, so `textDisplay` comes back HTML-marked-up and would not match
 * the plain text a write sent. Returns null to leave the row `pending`.
 */
function reconcileStatus(
  row: typeof commentEdits.$inferSelect,
  live: YouTubeComment | null
): "applied" | "failed" | "unknown" | null {
  if (!live) return row.verb === "delete" ? "applied" : "unknown";

  const candidates = [live.snippet.textOriginal, live.snippet.textDisplay].filter(
    (text): text is string => typeof text === "string"
  );
  if (row.afterText !== null && candidates.includes(row.afterText)) return "applied";
  if (candidates.includes(row.beforeText)) return "failed";
  return "unknown";
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

function snapshotFailed(
  commentId: string,
  creditsConsumed: number,
  reconciled?: ReconcileCounts
): { error: ServiceError } {
  return fail(
    "SNAPSHOT_FAILED",
    `Comment ${commentId} was not found`,
    "Verify the comment ID from a search result — a deleted comment cannot be edited. Nothing was written to YouTube.",
    404,
    {
      commentId,
      creditsConsumed,
      ...(reconciled ? { reconciled: toJson(reconciled) } : {}),
    }
  );
}

function quotaHalted(
  creditsConsumed: number,
  reconciled: ReconcileCounts
): { error: ServiceError } {
  return fail(
    "QUOTA_EXCEEDED",
    "YouTube Data API daily quota exceeded",
    "Nothing was written to YouTube. Retry after the quota resets.",
    429,
    {
      creditsConsumed,
      reconciled: toJson(reconciled),
      resetsAt: nextQuotaResetAt().toISOString(),
    }
  );
}

/** Trips the breaker when a single-item write hits the daily quota (I7). */
async function noteQuotaHalt(err: unknown): Promise<void> {
  if (isYouTubeQuotaError(err)) await markYouTubeQuotaExhausted();
}

function toJson(counts: ReconcileCounts): JsonValue {
  return { ...counts };
}
