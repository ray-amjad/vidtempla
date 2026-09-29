/**
 * Drizzle adapter for the sweep, reclassify and dry run (`SweepStore`, #156).
 *
 * The sweep is the only writer of stored comment text and scores; reclassify
 * writes scores only (spec "Single owner"). Moderation state, the action log,
 * the cap counters and snapshots belong to `apply.ts`.
 *
 * Every query is scoped by `youtube_channel_id`. Comment text is only ever a
 * bound parameter of an insert (I7) — never part of a SQL string.
 */

import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, notExists, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  commentAutomation,
  commentModerationActions,
  commentModerationRules,
  commentRubrics,
  commentScores,
  youtubeComments,
  youtubeVideos,
} from "@/db/schema";
import type {
  LabelProbabilities,
  ModerationAction,
  ModerationRule,
  ModerationState,
  RubricExample,
  RubricLabel,
  ScoreStatus,
  ScoringComment,
  ScoringRubric,
  StoredComment,
  SweepStore,
  TextSource,
} from "./types";

const COMMENT_COLUMNS = {
  id: youtubeComments.id,
  youtubeChannelId: youtubeComments.youtubeChannelId,
  commentId: youtubeComments.commentId,
  parentId: youtubeComments.parentId,
  videoId: youtubeComments.videoId,
  authorChannelId: youtubeComments.authorChannelId,
  text: youtubeComments.text,
  textSource: youtubeComments.textSource,
  scoreStatus: youtubeComments.scoreStatus,
  moderationState: youtubeComments.moderationState,
} as const;

type CommentRow = {
  id: string;
  youtubeChannelId: string;
  commentId: string;
  parentId: string | null;
  videoId: string;
  authorChannelId: string | null;
  text: string;
  textSource: string;
  scoreStatus: string;
  moderationState: string;
};

function toStored(r: CommentRow): StoredComment {
  return {
    ...r,
    textSource: r.textSource as TextSource,
    scoreStatus: r.scoreStatus as ScoreStatus,
    moderationState: r.moderationState as ModerationState,
  };
}

/** Joins each comment's video title (state for Jev) from youtube_videos. */
async function withVideoTitles(youtubeChannelId: string, rows: CommentRow[]): Promise<ScoringComment[]> {
  if (rows.length === 0) return [];
  const videoIds = [...new Set(rows.map((r) => r.videoId))];
  const videos = await db
    .select({ videoId: youtubeVideos.videoId, title: youtubeVideos.title })
    .from(youtubeVideos)
    .where(and(eq(youtubeVideos.channelId, youtubeChannelId), inArray(youtubeVideos.videoId, videoIds)));
  const titles = new Map(videos.map((v) => [v.videoId, v.title ?? null]));
  return rows.map((r) => ({ ...toStored(r), videoTitle: titles.get(r.videoId) ?? null }));
}

/** Parses the rubric's jsonb columns defensively; bad entries are dropped. */
export function parseRubricLabels(value: unknown): RubricLabel[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (l): l is { name: string; description?: unknown } =>
        Boolean(l) && typeof l === "object" && typeof (l as { name?: unknown }).name === "string"
    )
    .map((l) => ({ name: l.name, description: typeof l.description === "string" ? l.description : "" }));
}

export function parseRubricExamples(value: unknown): RubricExample[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (e): e is RubricExample =>
        Boolean(e) &&
        typeof e === "object" &&
        typeof (e as { text?: unknown }).text === "string" &&
        typeof (e as { label?: unknown }).label === "string"
    )
    .map((e) => ({ text: e.text, label: e.label }));
}

const channelComments = (youtubeChannelId: string) =>
  eq(youtubeComments.youtubeChannelId, youtubeChannelId);

export const drizzleSweepStore: SweepStore = {
  async getAutomation(youtubeChannelId) {
    const [row] = await db
      .select({
        enabled: commentAutomation.enabled,
        enabledAt: commentAutomation.enabledAt,
        cursor: commentAutomation.cursor,
        listingPageToken: commentAutomation.listingPageToken,
        listingNewest: commentAutomation.listingNewest,
      })
      .from(commentAutomation)
      .where(eq(commentAutomation.youtubeChannelId, youtubeChannelId));
    return row ?? null;
  },

  async getPublishedRubric(youtubeChannelId) {
    const [row] = await db
      .select({
        version: commentRubrics.version,
        labels: commentRubrics.labels,
        instructions: commentRubrics.instructions,
        examples: commentRubrics.examples,
      })
      .from(commentRubrics)
      .where(and(eq(commentRubrics.youtubeChannelId, youtubeChannelId), eq(commentRubrics.status, "published")));
    if (!row) return null;
    const rubric: ScoringRubric = {
      version: row.version,
      labels: parseRubricLabels(row.labels),
      instructions: row.instructions,
      examples: parseRubricExamples(row.examples),
    };
    return rubric.labels.length > 0 ? rubric : null;
  },

  async getRules(youtubeChannelId) {
    const rows = await db
      .select({
        id: commentModerationRules.id,
        label: commentModerationRules.label,
        threshold: commentModerationRules.threshold,
        action: commentModerationRules.action,
      })
      .from(commentModerationRules)
      .where(eq(commentModerationRules.youtubeChannelId, youtubeChannelId));
    return rows.map((r): ModerationRule => ({ ...r, action: r.action as ModerationAction }));
  },

  async advanceCursor(youtubeChannelId, to) {
    await db
      .update(commentAutomation)
      .set({ cursor: to, updatedAt: new Date() })
      .where(
        and(
          eq(commentAutomation.youtubeChannelId, youtubeChannelId),
          or(isNull(commentAutomation.cursor), lt(commentAutomation.cursor, to))
        )
      );
  },

  async setListingResume(youtubeChannelId, resume) {
    await db
      .update(commentAutomation)
      .set({
        listingPageToken: resume ? resume.pageToken : null,
        listingNewest: resume ? resume.newest : null,
        updatedAt: new Date(),
      })
      .where(eq(commentAutomation.youtubeChannelId, youtubeChannelId));
  },

  async insertComments(youtubeChannelId, comments) {
    if (comments.length === 0) return 0;
    const now = new Date();
    const inserted = await db
      .insert(youtubeComments)
      .values(
        comments.map((c) => ({
          youtubeChannelId,
          commentId: c.commentId,
          parentId: c.parentId,
          videoId: c.videoId,
          authorChannelId: c.authorChannelId,
          authorDisplayName: c.authorDisplayName,
          text: c.text,
          textSource: c.textSource,
          publishedAt: c.publishedAt,
          scoreStatus: "pending",
          moderationState: "none",
          updatedAt: now,
        }))
      )
      .onConflictDoNothing({ target: [youtubeComments.youtubeChannelId, youtubeComments.commentId] })
      .returning({ id: youtubeComments.id });
    return inserted.length;
  },

  async expireStaleScoring(youtubeChannelId, claimedBefore) {
    const rows = await db
      .update(youtubeComments)
      .set({ scoreStatus: "unscored", updatedAt: new Date() })
      .where(
        and(
          channelComments(youtubeChannelId),
          eq(youtubeComments.scoreStatus, "scoring"),
          lt(youtubeComments.updatedAt, claimedBefore)
        )
      )
      .returning({ id: youtubeComments.id });
    return rows.length;
  },

  async claimPending(youtubeChannelId, limit) {
    if (limit <= 0) return [];
    // Row-locked, skip-locked pick, so two overlapping steps never claim the
    // same comment (and so never charge or score it twice).
    const pick = db
      .select({ id: youtubeComments.id })
      .from(youtubeComments)
      .where(and(channelComments(youtubeChannelId), eq(youtubeComments.scoreStatus, "pending")))
      .orderBy(asc(youtubeComments.publishedAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    const rows = await db
      .update(youtubeComments)
      .set({ scoreStatus: "scoring", updatedAt: new Date() })
      .where(
        and(
          channelComments(youtubeChannelId),
          eq(youtubeComments.scoreStatus, "pending"),
          inArray(youtubeComments.id, pick)
        )
      )
      .returning(COMMENT_COLUMNS);
    return withVideoTitles(youtubeChannelId, rows);
  },

  async unclaim(youtubeChannelId, commentIds) {
    if (commentIds.length === 0) return;
    await db
      .update(youtubeComments)
      .set({ scoreStatus: "pending", updatedAt: new Date() })
      .where(
        and(
          channelComments(youtubeChannelId),
          eq(youtubeComments.scoreStatus, "scoring"),
          inArray(youtubeComments.id, [...commentIds])
        )
      );
  },

  async saveScore(youtubeChannelId, score) {
    await db.transaction(async (tx) => {
      await tx
        .insert(commentScores)
        .values({
          youtubeChannelId,
          commentId: score.commentId,
          rubricVersion: score.rubricVersion,
          model: score.model,
          choice: score.choice,
          probabilities: score.probabilities,
          confidence: score.confidence,
          inputTokens: score.inputTokens,
          outputTokens: score.outputTokens,
        })
        .onConflictDoNothing({ target: [commentScores.commentId, commentScores.rubricVersion] });
      await tx
        .update(youtubeComments)
        .set({ scoreStatus: "scored", updatedAt: new Date() })
        .where(
          and(
            channelComments(youtubeChannelId),
            eq(youtubeComments.id, score.commentId),
            eq(youtubeComments.scoreStatus, "scoring")
          )
        );
      await tx
        .update(commentAutomation)
        .set({ lastModel: score.model, updatedAt: new Date() })
        .where(
          and(
            eq(commentAutomation.youtubeChannelId, youtubeChannelId),
            or(isNull(commentAutomation.lastModel), ne(commentAutomation.lastModel, score.model))
          )
        );
    });
  },

  async markUnscored(youtubeChannelId, commentIds) {
    if (commentIds.length === 0) return;
    await db
      .update(youtubeComments)
      .set({ scoreStatus: "unscored", updatedAt: new Date() })
      .where(
        and(
          channelComments(youtubeChannelId),
          inArray(youtubeComments.id, [...commentIds]),
          inArray(youtubeComments.scoreStatus, ["pending", "scoring"])
        )
      );
  },

  async dropPending(youtubeChannelId) {
    const rows = await db
      .update(youtubeComments)
      .set({ scoreStatus: "unscored", updatedAt: new Date() })
      .where(and(channelComments(youtubeChannelId), eq(youtubeComments.scoreStatus, "pending")))
      .returning({ id: youtubeComments.id });
    return rows.length;
  },

  async listForReclassify(youtubeChannelId, version, afterId, limit) {
    const rows = await db
      .select(COMMENT_COLUMNS)
      .from(youtubeComments)
      .where(
        and(
          channelComments(youtubeChannelId),
          eq(youtubeComments.scoreStatus, "scored"),
          inArray(youtubeComments.moderationState, ["none", "flagged", "held"]),
          afterId ? gt(youtubeComments.id, afterId) : undefined,
          notExists(
            db
              .select({ one: sql`1` })
              .from(commentScores)
              .where(
                and(eq(commentScores.commentId, youtubeComments.id), eq(commentScores.rubricVersion, version))
              )
          )
        )
      )
      .orderBy(asc(youtubeComments.id))
      .limit(limit);
    return withVideoTitles(youtubeChannelId, rows);
  },

  async listUndecided(youtubeChannelId, version, limit) {
    if (limit <= 0) return [];
    const rows = await db
      .select({ ...COMMENT_COLUMNS, probabilities: commentScores.probabilities })
      .from(commentScores)
      .innerJoin(youtubeComments, eq(youtubeComments.id, commentScores.commentId))
      .where(
        and(
          eq(commentScores.youtubeChannelId, youtubeChannelId),
          eq(commentScores.rubricVersion, version),
          isNull(commentScores.decidedAt),
          // Another run is taking this decision (or one that cannot be
          // recorded is left for a person): never take it up twice.
          isNull(commentScores.decisionClaimedAt),
          channelComments(youtubeChannelId),
          eq(youtubeComments.scoreStatus, "scored"),
          inArray(youtubeComments.moderationState, ["none", "flagged"]),
          // An attempt for this version that landed or may have landed: never
          // redo it (I4), even if decided_at was never stamped (killed step).
          notExists(
            db
              .select({ one: sql`1` })
              .from(commentModerationActions)
              .where(
                and(
                  eq(commentModerationActions.youtubeChannelId, youtubeChannelId),
                  eq(commentModerationActions.commentId, youtubeComments.id),
                  eq(commentModerationActions.rubricVersion, version),
                  inArray(commentModerationActions.status, ["applied", "unknown"])
                )
              )
          )
        )
      )
      .orderBy(asc(commentScores.createdAt))
      .limit(limit);
    const comments = await withVideoTitles(
      youtubeChannelId,
      rows.map(({ probabilities: _p, ...r }) => r)
    );
    return comments.map((comment, i) => ({
      comment,
      probabilities: (rows[i]!.probabilities ?? {}) as LabelProbabilities,
    }));
  },

  async markDecided(youtubeChannelId, commentIds, version) {
    if (commentIds.length === 0) return;
    await db
      .update(commentScores)
      .set({ decidedAt: new Date() })
      .where(
        and(
          eq(commentScores.youtubeChannelId, youtubeChannelId),
          eq(commentScores.rubricVersion, version),
          inArray(commentScores.commentId, [...commentIds]),
          isNull(commentScores.decidedAt)
        )
      );
  },

  async claimDecisions(youtubeChannelId, version, commentIds, at) {
    if (commentIds.length === 0) return [];
    // One UPDATE … RETURNING: of two overlapping runs, exactly one wins a row.
    const won = await db
      .update(commentScores)
      .set({ decisionClaimedAt: at })
      .where(
        and(
          eq(commentScores.youtubeChannelId, youtubeChannelId),
          eq(commentScores.rubricVersion, version),
          inArray(commentScores.commentId, [...commentIds]),
          isNull(commentScores.decidedAt),
          isNull(commentScores.decisionClaimedAt)
        )
      )
      .returning({ commentId: commentScores.commentId });
    return won.map((r) => r.commentId);
  },

  async releaseDecisionClaims(youtubeChannelId, version, commentIds) {
    if (commentIds.length === 0) return;
    await db
      .update(commentScores)
      .set({ decisionClaimedAt: null })
      .where(
        and(
          eq(commentScores.youtubeChannelId, youtubeChannelId),
          eq(commentScores.rubricVersion, version),
          inArray(commentScores.commentId, [...commentIds]),
          isNull(commentScores.decidedAt)
        )
      );
  },

  async listForDryRun(youtubeChannelId, limit) {
    const rows = await db
      .select(COMMENT_COLUMNS)
      .from(youtubeComments)
      .where(
        and(
          channelComments(youtubeChannelId),
          eq(youtubeComments.scoreStatus, "scored"),
          ne(youtubeComments.moderationState, "deleted")
        )
      )
      .orderBy(desc(youtubeComments.publishedAt))
      .limit(limit);
    return withVideoTitles(youtubeChannelId, rows);
  },

  async setRunStatus(youtubeChannelId, status, at) {
    await db
      .update(commentAutomation)
      .set({ lastRunStatus: status, lastRunAt: at, updatedAt: new Date() })
      .where(eq(commentAutomation.youtubeChannelId, youtubeChannelId));
  },
};
