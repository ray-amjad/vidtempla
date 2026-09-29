/**
 * Moderation reads (#156) for the dashboard, REST and MCP. Read-only: no
 * credits, no YouTube calls. Every query is scoped to a channel of the
 * caller's org.
 *
 * Dashboard reads take `youtube_channels.id` (uuid). `listClassifications`
 * (REST + MCP) takes the UC… channel id, as the other public comment reads.
 */

import { and, count, desc, eq, gte, inArray, lt, or, sql, type AnyColumn } from "drizzle-orm";
import { db } from "@/db";
import {
  commentAutomation,
  commentModerationActions,
  commentModerationCounters,
  commentRubricExamples,
  commentRubrics,
  commentScores,
  youtubeChannels,
  youtubeComments,
} from "@/db/schema";
import { decodeCompositeCursor, encodeCompositeCursor, isValidCursorId } from "@/lib/services/cursors";
import type { ServiceResult } from "@/lib/services/types";
import {
  DAILY_DELETE_CAP,
  DAILY_REJECT_BAN_CAP,
  isMaybeRelease,
  pacificDayKey,
} from "./core";
import { drizzleSweepStore, parseRubricLabels } from "./store";
import type { ModerationRule, ModerationState, RubricLabel } from "./types";

export const LIST_DEFAULT_LIMIT = 50;
export const LIST_MAX_LIMIT = 100;

type Err = Extract<ServiceResult<never>, { error: unknown }>;

function fail(code: string, message: string, suggestion: string, status: number): Err {
  return { error: { code, message, suggestion, status } };
}

const channelNotFound = () =>
  fail("NOT_FOUND", "Channel not found in this organization.", "List the organization's channels and pass one of their ids.", 404);
const badCursor = () => fail("INVALID_CURSOR", "The cursor is not valid for this list.", "Omit the cursor to start from the first page.", 400);

function clampLimit(limit: number | undefined): number {
  if (!limit || !Number.isFinite(limit)) return LIST_DEFAULT_LIMIT;
  return Math.max(1, Math.min(LIST_MAX_LIMIT, Math.floor(limit)));
}

async function channelByUuid(organizationId: string, channelId: string) {
  const [row] = await db
    .select({ id: youtubeChannels.id, channelId: youtubeChannels.channelId, organizationId: youtubeChannels.organizationId })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.id, channelId), eq(youtubeChannels.organizationId, organizationId)));
  return row ?? null;
}

/**
 * Keyset filter over (time desc, id desc), bucketed by millisecond exactly as
 * listCommentEdits (services/comments.ts): node-postgres reads a timestamptz
 * at millisecond precision, so the cursor key can only carry milliseconds.
 * Pair it with `msDesc(col)` in ORDER BY so filter and order agree.
 */
function before(col: AnyColumn, idCol: AnyColumn, cursor: { key: string | null; id: string } | null) {
  if (!cursor || cursor.key === null) return undefined;
  const at = new Date(cursor.key);
  const next = new Date(at.getTime() + 1);
  return or(lt(col, at), and(gte(col, at), lt(col, next), lt(idCol, cursor.id)));
}

/** Millisecond-truncated ORDER BY key; no value is interpolated. */
const msDesc = (col: AnyColumn) => sql`date_trunc('milliseconds', ${col}) desc`;

function readCursor(raw: string | undefined, scope: string): { key: string | null; id: string } | null | "bad" {
  if (!raw) return null;
  const c = decodeCompositeCursor(raw);
  if (!c || c.scope !== scope || !isValidCursorId(c.id) || c.key === null || Number.isNaN(Date.parse(c.key))) {
    return "bad";
  }
  return { key: c.key, id: c.id };
}

// ─── Overview ────────────────────────────────────────────────────────────────

export interface ModerationOverview {
  enabled: boolean;
  enabledAt: Date | null;
  cursor: Date | null;
  pausedRejectBan: boolean;
  pausedDelete: boolean;
  lastRunStatus: string | null;
  lastRunAt: Date | null;
  /** Resolved Jev model of the most recent score. */
  lastModel: string | null;
  publishedVersion: number | null;
  draftVersion: number | null;
  today: { pacificDay: string; rejectBan: number; rejectBanCap: number; delete: number; deleteCap: number };
  /** Stored comments per score status. */
  scoreStatus: Record<string, number>;
  /** Stored comments per moderation state. */
  moderationState: Record<string, number>;
  /**
   * Stored comments a dry run may score: scored and not deleted (the filter of
   * store.listForDryRun). The dashboard shows min(this, DRY_RUN_MAX_COMMENTS)
   * as the credit cost before it runs (Ray answer 5).
   */
  dryRunCandidates: number;
}

export async function getModerationOverview(
  organizationId: string,
  channelId: string
): Promise<ServiceResult<ModerationOverview>> {
  const channel = await channelByUuid(organizationId, channelId);
  if (!channel) return channelNotFound();
  const day = pacificDayKey(new Date());

  const [[auto], rubrics, [counters], statuses] = await Promise.all([
    db
      .select({
        enabled: commentAutomation.enabled,
        enabledAt: commentAutomation.enabledAt,
        cursor: commentAutomation.cursor,
        pausedRejectBan: commentAutomation.pausedRejectBan,
        pausedDelete: commentAutomation.pausedDelete,
        lastRunStatus: commentAutomation.lastRunStatus,
        lastRunAt: commentAutomation.lastRunAt,
        lastModel: commentAutomation.lastModel,
      })
      .from(commentAutomation)
      .where(eq(commentAutomation.youtubeChannelId, channel.id)),
    db
      .select({ version: commentRubrics.version, status: commentRubrics.status })
      .from(commentRubrics)
      .where(and(eq(commentRubrics.youtubeChannelId, channel.id), inArray(commentRubrics.status, ["draft", "published"]))),
    db
      .select({ rejectBan: commentModerationCounters.rejectBanCount, del: commentModerationCounters.deleteCount })
      .from(commentModerationCounters)
      .where(and(eq(commentModerationCounters.youtubeChannelId, channel.id), eq(commentModerationCounters.pacificDay, day))),
    db
      .select({ scoreStatus: youtubeComments.scoreStatus, moderationState: youtubeComments.moderationState, n: count() })
      .from(youtubeComments)
      .where(eq(youtubeComments.youtubeChannelId, channel.id))
      .groupBy(youtubeComments.scoreStatus, youtubeComments.moderationState),
  ]);

  const scoreStatus: Record<string, number> = {};
  const moderationState: Record<string, number> = {};
  let dryRunCandidates = 0;
  for (const s of statuses) {
    scoreStatus[s.scoreStatus] = (scoreStatus[s.scoreStatus] ?? 0) + s.n;
    moderationState[s.moderationState] = (moderationState[s.moderationState] ?? 0) + s.n;
    if (s.scoreStatus === "scored" && s.moderationState !== "deleted") dryRunCandidates += s.n;
  }

  return {
    data: {
      enabled: auto?.enabled ?? false,
      enabledAt: auto?.enabledAt ?? null,
      cursor: auto?.cursor ?? null,
      pausedRejectBan: auto?.pausedRejectBan ?? false,
      pausedDelete: auto?.pausedDelete ?? false,
      lastRunStatus: auto?.lastRunStatus ?? null,
      lastRunAt: auto?.lastRunAt ?? null,
      lastModel: auto?.lastModel ?? null,
      publishedVersion: rubrics.find((r) => r.status === "published")?.version ?? null,
      draftVersion: rubrics.find((r) => r.status === "draft")?.version ?? null,
      today: {
        pacificDay: day,
        rejectBan: counters?.rejectBan ?? 0,
        rejectBanCap: DAILY_REJECT_BAN_CAP,
        delete: counters?.del ?? 0,
        deleteCap: DAILY_DELETE_CAP,
      },
      scoreStatus,
      moderationState,
      dryRunCandidates,
    },
  };
}

// ─── Scored comments / review queue ──────────────────────────────────────────

export interface ScoredCommentRow {
  id: string;
  commentId: string;
  parentId: string | null;
  videoId: string;
  authorChannelId: string | null;
  authorDisplayName: string;
  text: string;
  publishedAt: Date;
  scoreStatus: string;
  moderationState: ModerationState;
  /** Score for the published version, or null (pending, unscored, not yet reclassified). */
  score: { rubricVersion: number; model: string; choice: string; probabilities: Record<string, number>; confidence: number | null } | null;
}

export interface CommentListOpts {
  cursor?: string;
  limit?: number;
  /** Filter by moderation state (e.g. `held` for the review queue). */
  moderationStates?: ModerationState[];
  /** Filter by the winning label of the published-version score. */
  label?: string;
}

async function publishedVersion(channelUuid: string): Promise<number | null> {
  const [row] = await db
    .select({ version: commentRubrics.version })
    .from(commentRubrics)
    .where(and(eq(commentRubrics.youtubeChannelId, channelUuid), eq(commentRubrics.status, "published")));
  return row?.version ?? null;
}

async function listComments(
  channelUuid: string,
  scope: string,
  opts: CommentListOpts
): Promise<ServiceResult<{ items: ScoredCommentRow[]; cursor: string | null; hasMore: boolean }>> {
  const cursor = readCursor(opts.cursor, scope);
  if (cursor === "bad") return badCursor();
  const limit = clampLimit(opts.limit);
  const version = await publishedVersion(channelUuid);

  const rows = await db
    .select({
      id: youtubeComments.id,
      commentId: youtubeComments.commentId,
      parentId: youtubeComments.parentId,
      videoId: youtubeComments.videoId,
      authorChannelId: youtubeComments.authorChannelId,
      authorDisplayName: youtubeComments.authorDisplayName,
      text: youtubeComments.text,
      publishedAt: youtubeComments.publishedAt,
      scoreStatus: youtubeComments.scoreStatus,
      moderationState: youtubeComments.moderationState,
      scoreVersion: commentScores.rubricVersion,
      model: commentScores.model,
      choice: commentScores.choice,
      probabilities: commentScores.probabilities,
      confidence: commentScores.confidence,
    })
    .from(youtubeComments)
    .leftJoin(
      commentScores,
      and(eq(commentScores.commentId, youtubeComments.id), eq(commentScores.rubricVersion, version ?? -1))
    )
    .where(
      and(
        eq(youtubeComments.youtubeChannelId, channelUuid),
        opts.moderationStates && opts.moderationStates.length > 0
          ? inArray(youtubeComments.moderationState, opts.moderationStates)
          : undefined,
        opts.label ? eq(commentScores.choice, opts.label) : undefined,
        before(youtubeComments.publishedAt, youtubeComments.id, cursor)
      )
    )
    .orderBy(msDesc(youtubeComments.publishedAt), desc(youtubeComments.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: {
      items: page.map((r) => ({
        id: r.id,
        commentId: r.commentId,
        parentId: r.parentId,
        videoId: r.videoId,
        authorChannelId: r.authorChannelId,
        authorDisplayName: r.authorDisplayName,
        text: r.text,
        publishedAt: r.publishedAt,
        scoreStatus: r.scoreStatus,
        moderationState: r.moderationState as ModerationState,
        score:
          r.scoreVersion === null || r.model === null || r.choice === null
            ? null
            : {
                rubricVersion: r.scoreVersion,
                model: r.model,
                choice: r.choice,
                probabilities: (r.probabilities ?? {}) as Record<string, number>,
                confidence: r.confidence,
              },
      })),
      cursor:
        hasMore && last
          ? encodeCompositeCursor({ scope, key: last.publishedAt.toISOString(), id: last.id })
          : null,
      hasMore,
    },
  };
}

/** Stored comments, newest first, with their published-version score. */
export async function listScoredComments(organizationId: string, channelId: string, opts: CommentListOpts = {}) {
  const channel = await channelByUuid(organizationId, channelId);
  if (!channel) return channelNotFound();
  return listComments(channel.id, `moderation-comments:${channel.id}`, opts);
}

/** Held and flagged comments waiting for a person. */
export async function listReviewQueue(
  organizationId: string,
  channelId: string,
  opts: Omit<CommentListOpts, "moderationStates"> = {}
) {
  const channel = await channelByUuid(organizationId, channelId);
  if (!channel) return channelNotFound();
  return listComments(channel.id, `moderation-review:${channel.id}`, { ...opts, moderationStates: ["held", "flagged"] });
}

/**
 * Held comments whose published-version score no longer earns a hold or
 * stronger: no rule matches, or only a flag rule wins (core `isMaybeRelease`),
 * typically after a reclassify. Never acted on automatically (I4); a
 * person may release them. Computed on read, capped at `limit` (≤ 100).
 */
export async function listMaybeRelease(
  organizationId: string,
  channelId: string,
  opts: { limit?: number } = {}
): Promise<ServiceResult<{ items: ScoredCommentRow[] }>> {
  const channel = await channelByUuid(organizationId, channelId);
  if (!channel) return channelNotFound();
  const rules = await drizzleSweepStore.getRules(channel.id);
  const limit = clampLimit(opts.limit);
  const items: ScoredCommentRow[] = [];
  let cursor: string | undefined;
  // Walk held comments a page at a time until `limit` candidates are found.
  for (let page = 0; page < 20 && items.length < limit; page++) {
    const res = await listComments(channel.id, `moderation-held:${channel.id}`, {
      cursor,
      limit: LIST_MAX_LIMIT,
      moderationStates: ["held"],
    });
    if ("error" in res) return res;
    for (const c of res.data.items) {
      if (c.score && isMaybeRelease("held", rules, c.score.probabilities)) items.push(c);
      if (items.length >= limit) break;
    }
    if (!res.data.hasMore || !res.data.cursor) break;
    cursor = res.data.cursor;
  }
  return { data: { items } };
}

// ─── Action log ──────────────────────────────────────────────────────────────

export interface ActionLogRow {
  id: string;
  commentId: string;
  youtubeCommentId: string;
  requestedAction: string;
  appliedAction: string;
  degradedReason: string | null;
  source: string;
  userId: string | null;
  ruleId: string | null;
  rubricVersion: number | null;
  status: string;
  error: string | null;
  createdAt: Date;
}

/** Newest first. Composite cursor over (createdAt desc, id desc). */
export async function listActionLog(
  organizationId: string,
  channelId: string,
  opts: { cursor?: string; limit?: number } = {}
): Promise<ServiceResult<{ items: ActionLogRow[]; cursor: string | null; hasMore: boolean }>> {
  const channel = await channelByUuid(organizationId, channelId);
  if (!channel) return channelNotFound();
  const scope = `moderation-actions:${channel.id}`;
  const cursor = readCursor(opts.cursor, scope);
  if (cursor === "bad") return badCursor();
  const limit = clampLimit(opts.limit);
  const rows = await db
    .select({
      id: commentModerationActions.id,
      commentId: commentModerationActions.commentId,
      youtubeCommentId: youtubeComments.commentId,
      requestedAction: commentModerationActions.requestedAction,
      appliedAction: commentModerationActions.appliedAction,
      degradedReason: commentModerationActions.degradedReason,
      source: commentModerationActions.source,
      userId: commentModerationActions.userId,
      ruleId: commentModerationActions.ruleId,
      rubricVersion: commentModerationActions.rubricVersion,
      status: commentModerationActions.status,
      error: commentModerationActions.error,
      createdAt: commentModerationActions.createdAt,
    })
    .from(commentModerationActions)
    .innerJoin(youtubeComments, eq(youtubeComments.id, commentModerationActions.commentId))
    .where(
      and(
        eq(commentModerationActions.youtubeChannelId, channel.id),
        before(commentModerationActions.createdAt, commentModerationActions.id, cursor)
      )
    )
    .orderBy(msDesc(commentModerationActions.createdAt), desc(commentModerationActions.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    data: {
      items: page,
      cursor: hasMore && last ? encodeCompositeCursor({ scope, key: last.createdAt.toISOString(), id: last.id }) : null,
      hasMore,
    },
  };
}

// ─── Rules, rubrics, examples ────────────────────────────────────────────────

export async function getRules(organizationId: string, channelId: string): Promise<ServiceResult<ModerationRule[]>> {
  const channel = await channelByUuid(organizationId, channelId);
  if (!channel) return channelNotFound();
  return { data: await drizzleSweepStore.getRules(channel.id) };
}

export interface RubricView {
  version: number;
  status: "draft" | "published" | "superseded";
  labels: RubricLabel[];
  instructions: string;
  examples: { exampleId: string | null; text: string; label: string }[];
  publishedAt: Date | null;
  publishedBy: string | null;
  updatedAt: Date;
}

/** The draft and published rubrics (and the last `history` superseded ones). */
export async function getRubrics(
  organizationId: string,
  channelId: string,
  opts: { history?: number } = {}
): Promise<ServiceResult<{ published: RubricView | null; draft: RubricView | null; superseded: RubricView[] }>> {
  const channel = await channelByUuid(organizationId, channelId);
  if (!channel) return channelNotFound();
  const rows = await db
    .select({
      version: commentRubrics.version,
      status: commentRubrics.status,
      labels: commentRubrics.labels,
      instructions: commentRubrics.instructions,
      examples: commentRubrics.examples,
      publishedAt: commentRubrics.publishedAt,
      publishedBy: commentRubrics.publishedBy,
      updatedAt: commentRubrics.updatedAt,
    })
    .from(commentRubrics)
    .where(eq(commentRubrics.youtubeChannelId, channel.id))
    .orderBy(desc(commentRubrics.version))
    .limit(2 + Math.max(0, Math.min(opts.history ?? 5, 20)));
  const view = (r: (typeof rows)[number]): RubricView => ({
    version: r.version,
    status: r.status as RubricView["status"],
    labels: parseRubricLabels(r.labels),
    instructions: r.instructions,
    examples: Array.isArray(r.examples)
      ? (r.examples as Record<string, unknown>[])
          .filter((e) => e && typeof e.text === "string" && typeof e.label === "string")
          .map((e) => ({
            exampleId: typeof e.exampleId === "string" ? e.exampleId : null,
            text: e.text as string,
            label: e.label as string,
          }))
      : [],
    publishedAt: r.publishedAt,
    publishedBy: r.publishedBy,
    updatedAt: r.updatedAt,
  });
  const published = rows.find((r) => r.status === "published");
  const draft = rows.find((r) => r.status === "draft");
  return {
    data: {
      published: published ? view(published) : null,
      draft: draft ? view(draft) : null,
      superseded: rows.filter((r) => r.status === "superseded").map(view),
    },
  };
}

export interface ExampleView {
  id: string;
  commentId: string | null;
  text: string;
  label: string;
  status: "suggested" | "accepted" | "rejected";
  suggestedBy: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  includedInVersion: number | null;
  createdAt: Date;
}

export async function listExamples(
  organizationId: string,
  channelId: string,
  opts: { status?: ExampleView["status"]; limit?: number } = {}
): Promise<ServiceResult<ExampleView[]>> {
  const channel = await channelByUuid(organizationId, channelId);
  if (!channel) return channelNotFound();
  const rows = await db
    .select({
      id: commentRubricExamples.id,
      commentId: commentRubricExamples.commentId,
      text: commentRubricExamples.text,
      label: commentRubricExamples.label,
      status: commentRubricExamples.status,
      suggestedBy: commentRubricExamples.suggestedBy,
      reviewedBy: commentRubricExamples.reviewedBy,
      reviewedAt: commentRubricExamples.reviewedAt,
      includedInVersion: commentRubricExamples.includedInVersion,
      createdAt: commentRubricExamples.createdAt,
    })
    .from(commentRubricExamples)
    .where(
      and(
        eq(commentRubricExamples.youtubeChannelId, channel.id),
        opts.status ? eq(commentRubricExamples.status, opts.status) : undefined
      )
    )
    .orderBy(desc(commentRubricExamples.createdAt))
    .limit(clampLimit(opts.limit));
  return { data: rows.map((r) => ({ ...r, status: r.status as ExampleView["status"] })) };
}

// ─── REST / MCP ──────────────────────────────────────────────────────────────

export interface ClassificationItem {
  /** YouTube comment id. */
  commentId: string;
  parentId: string | null;
  videoId: string;
  authorChannelId: string | null;
  publishedAt: string;
  moderationState: ModerationState;
  /** Null when the comment has no score for the published version. */
  label: string | null;
  probabilities: Record<string, number> | null;
  confidence: number | null;
  rubricVersion: number | null;
  model: string | null;
  scoreStatus: string;
}

/**
 * `GET /api/v1/youtube/comments/classifications` and MCP
 * `list_comment_classifications`. `channelId` is the UC… id; it must belong to
 * the org (else NOT_FOUND 404). Comment text is not returned (the dashboard
 * shows it; agents get ids + scores). 0 quota units.
 */
export async function listClassifications(
  organizationId: string,
  input: { channelId: string; label?: string; cursor?: string; limit?: number }
): Promise<ServiceResult<{ items: ClassificationItem[]; cursor: string | null; hasMore: boolean }>> {
  const [channel] = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(and(eq(youtubeChannels.channelId, input.channelId), eq(youtubeChannels.organizationId, organizationId)));
  if (!channel) {
    return fail(
      "NOT_FOUND",
      `Channel ${input.channelId} is not connected to this organization.`,
      "List your channels with GET /api/v1/youtube/channels and pass a channelId from it.",
      404
    );
  }
  const res = await listComments(channel.id, `classifications:${channel.id}`, {
    cursor: input.cursor,
    limit: input.limit,
    label: input.label,
  });
  if ("error" in res) return res;
  return {
    data: {
      items: res.data.items.map((c) => ({
        commentId: c.commentId,
        parentId: c.parentId,
        videoId: c.videoId,
        authorChannelId: c.authorChannelId,
        publishedAt: c.publishedAt.toISOString(),
        moderationState: c.moderationState,
        label: c.score?.choice ?? null,
        probabilities: c.score?.probabilities ?? null,
        confidence: c.score?.confidence ?? null,
        rubricVersion: c.score?.rubricVersion ?? null,
        model: c.score?.model ?? null,
        scoreStatus: c.scoreStatus,
      })),
      cursor: res.data.cursor,
      hasMore: res.data.hasMore,
    },
  };
}
