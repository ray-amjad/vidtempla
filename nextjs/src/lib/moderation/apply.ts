/**
 * `applyModerationDecision` — the single moderation chokepoint (#156 I1).
 *
 * Every hold, reject, ban, delete, release and flag this feature makes goes
 * through here: the sweep, reclassify, and the dashboard review queue. The
 * rules (I2 caps, I3 collapse, I4 refusals, I6 snapshots, credits, batching,
 * the quota breaker, the production gate, the time budget) live in the pure
 * `applyDecisions` in `core.ts`; this file only builds its ports on the real
 * database, credit ledger and YouTube client.
 *
 * It is the only importer of `setCommentModerationStatus`, and the only
 * importer of the client's `deleteComment` besides the pre-existing manual
 * delete in `services/comments.ts` (scripts/unit/moderation-chokepoint.mjs).
 *
 * Authorization is the caller's job: a tRPC procedure must already have
 * checked that the channel belongs to the caller's organization and that the
 * caller is an owner or admin (I9).
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  commentAutomation,
  commentEdits,
  commentModerationActions,
  commentModerationCounters,
  youtubeChannels,
  youtubeComments,
} from "@/db/schema";
import {
  deleteComment as ytDeleteComment,
  getChannelAccessToken,
  isDefinitiveYouTubeRejection,
  isYouTubeQuotaError,
  isYouTubeRateLimitError,
  setCommentModerationStatus,
  YOUTUBE_CALL_TIMEOUT_MS,
} from "@/lib/clients/youtube";
import { chargeCommentCredits, refundCommentCharge } from "@/lib/services/comments";
import { isYouTubeQuotaExhausted, markYouTubeQuotaExhausted } from "@/lib/services/quota-guard";
import { youTubeErrorDetail } from "@/lib/youtube-errors";
import { applyDecisions } from "./core";
import type {
  ApplyDeps,
  ApplyOutcome,
  ApplyResult,
  CapClass,
  ChannelRef,
  ModerationActor,
  ModerationCounters,
  ModerationDecision,
  ModerationState,
  ModerationStore,
  RequestedAction,
  StoredComment,
  YouTubeErrorClass,
  YouTubeModerationPort,
} from "./types";

/** One decision as a caller names it: the stored comment's row id. */
export interface ModerationDecisionInput {
  /** youtube_comments.id (uuid) */
  commentId: string;
  action: RequestedAction;
  ruleId?: string | null;
  rubricVersion?: number | null;
}

export interface ApplyModerationOptions {
  /**
   * Epoch ms after which no new YouTube call starts. A workflow step passes
   * its own step deadline; the default is now + APPLY_BUDGET_MS.
   */
  deadlineMs?: number;
}

/**
 * Applies moderation decisions to one channel's stored comments.
 *
 * - `youtubeChannelUuid` is `youtube_channels.id`.
 * - `actor` is `{ source: "auto", userId: null }` for the sweep and
 *   reclassify, or `{ source: "dashboard", userId }` for a person.
 * - Comments are re-read here, scoped to the channel, so the I4 check uses
 *   the current `moderation_state`, never a caller's stale copy. An id that
 *   is not a stored comment of this channel is refused as `not_found`.
 *
 * Never throws for a per-comment failure: every comment ends in `outcomes`
 * (logged to comment_moderation_actions) or `refused` (not logged).
 */
export async function applyModerationDecision(
  youtubeChannelUuid: string,
  decisions: readonly ModerationDecisionInput[],
  actor: ModerationActor,
  opts: ApplyModerationOptions = {}
): Promise<ApplyResult> {
  const empty: ApplyResult = { outcomes: [], refused: [], halted: null, paused: [], youtubeCalls: 0 };
  if (decisions.length === 0) return empty;
  if (actor.source === "dashboard" && !actor.userId) {
    throw new Error("applyModerationDecision: a dashboard action needs the acting userId");
  }
  // I6: automatic actions always carry a null userId.
  const who: ModerationActor = actor.source === "auto" ? { source: "auto", userId: null } : actor;

  const [channelRow] = await db
    .select({
      id: youtubeChannels.id,
      channelId: youtubeChannels.channelId,
      organizationId: youtubeChannels.organizationId,
    })
    .from(youtubeChannels)
    .where(eq(youtubeChannels.id, youtubeChannelUuid));
  if (!channelRow) {
    return {
      ...empty,
      refused: decisions.map((d) => ({ commentId: d.commentId, action: d.action, reason: "not_found" as const })),
    };
  }
  const channel: ChannelRef = channelRow;

  const ids = [...new Set(decisions.map((d) => d.commentId))];
  const rows = await db
    .select({
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
    })
    .from(youtubeComments)
    .where(and(eq(youtubeComments.youtubeChannelId, channel.id), inArray(youtubeComments.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r as StoredComment]));

  const known: ModerationDecision[] = [];
  const notFound: ApplyResult["refused"] = [];
  for (const d of decisions) {
    const comment = byId.get(d.commentId);
    if (!comment) {
      notFound.push({ commentId: d.commentId, action: d.action, reason: "not_found" });
      continue;
    }
    known.push({
      comment,
      action: d.action,
      ruleId: d.ruleId ?? null,
      rubricVersion: d.rubricVersion ?? null,
    });
  }

  const result = await applyDecisions(moderationDeps(channel), {
    channel,
    actor: who,
    decisions: known,
    deadlineMs: opts.deadlineMs,
  });
  result.refused.push(...notFound);
  return result;
}

// ─── Ports ───────────────────────────────────────────────────────────────────

/** A token that could not be resolved: nothing was sent, so it is definitive. */
class ModerationTokenError extends Error {
  constructor(cause: unknown) {
    super("Could not resolve the channel access token");
    this.name = "ModerationTokenError";
    this.cause = cause;
  }
}

function moderationDeps(channel: ChannelRef): ApplyDeps {
  return {
    clock: { now: () => new Date() },
    callTimeoutMs: YOUTUBE_CALL_TIMEOUT_MS,
    // I10 / amendment: automatic actions only in production. Manual dashboard
    // actions are not gated (core only consults this for the auto actor).
    isProduction: () => process.env.VERCEL_ENV === "production",
    credits: {
      charge: (organizationId, amount) => chargeCommentCredits(organizationId, amount),
      async refund(organizationId, charge) {
        try {
          await refundCommentCharge(organizationId, charge);
        } catch (err) {
          console.error("moderation: refund failed", err);
        }
      },
    },
    quota: {
      async isTripped() {
        try {
          return await isYouTubeQuotaExhausted();
        } catch (err) {
          // Cannot read the breaker: an automatic write must not guess.
          console.error("moderation: could not read the quota breaker", err);
          return true;
        }
      },
      trip: () => markYouTubeQuotaExhausted(),
    },
    youtube: youtubePort(channel),
    counters: drizzleCounters,
    store: drizzleStore,
    classifyError(err): YouTubeErrorClass {
      if (err instanceof ModerationTokenError) {
        console.error("moderation: token resolution failed", {
          channelId: channel.channelId,
          error: err.cause instanceof Error ? err.cause.name : "unknown",
        });
        return { definitive: true, halt: "auth" };
      }
      const detail = youTubeErrorDetail(err);
      // Ids and YouTube's own reason only — never comment text or a token.
      console.error("moderation: YouTube call failed", {
        channelId: channel.channelId,
        upstreamStatus: detail.upstreamStatus,
        reasons: detail.reasons,
      });
      return {
        definitive: isDefinitiveYouTubeRejection(err),
        halt: isYouTubeQuotaError(err) ? "quota" : isYouTubeRateLimitError(err) ? "rateLimit" : null,
      };
    },
  };
}

/** The YouTube side, with the token resolved lazily (a flag-only call needs none). */
function youtubePort(channel: ChannelRef): YouTubeModerationPort {
  let token: Promise<string> | null = null;
  const accessToken = () =>
    (token ??= getChannelAccessToken(channel.id).catch((err: unknown) => {
      throw new ModerationTokenError(err);
    }));
  return {
    async setModerationStatus(commentIds, status, opts) {
      await setCommentModerationStatus(await accessToken(), commentIds, status, opts);
    },
    async deleteComment(commentId) {
      await ytDeleteComment(await accessToken(), commentId);
    },
  };
}

const COUNT_COLUMN = {
  rejectBan: commentModerationCounters.rejectBanCount,
  delete: commentModerationCounters.deleteCount,
} as const;

function counterKey(youtubeChannelId: string, pacificDay: string) {
  return and(
    eq(commentModerationCounters.youtubeChannelId, youtubeChannelId),
    eq(commentModerationCounters.pacificDay, pacificDay)
  );
}

/**
 * I2 counters. `reserve` is a row-locked read-modify-write in one
 * transaction: concurrent sweeps for one channel serialize on the row, so the
 * sum of grants can never pass the cap.
 */
const drizzleCounters: ModerationCounters = {
  async reserve(youtubeChannelId, pacificDay, capClass, requested, cap) {
    if (requested <= 0) return 0;
    return db.transaction(async (tx) => {
      await tx
        .insert(commentModerationCounters)
        .values({ youtubeChannelId, pacificDay })
        .onConflictDoNothing();
      const [row] = await tx
        .select({ count: COUNT_COLUMN[capClass] })
        .from(commentModerationCounters)
        .where(counterKey(youtubeChannelId, pacificDay))
        .for("update");
      const current = row?.count ?? cap;
      const granted = Math.max(0, Math.min(requested, cap - current));
      if (granted > 0) {
        const next = current + granted;
        await tx
          .update(commentModerationCounters)
          .set(
            capClass === "rejectBan"
              ? { rejectBanCount: next, updatedAt: new Date() }
              : { deleteCount: next, updatedAt: new Date() }
          )
          .where(counterKey(youtubeChannelId, pacificDay));
      }
      return granted;
    });
  },
  async release(youtubeChannelId, pacificDay, capClass, count) {
    if (count <= 0) return;
    const col = COUNT_COLUMN[capClass];
    // Arithmetic in SET — a documented raw-sql exception; `count` is a number.
    const decremented = sql`GREATEST(${col} - ${count}, 0)`;
    try {
      await db
        .update(commentModerationCounters)
        .set(
          capClass === "rejectBan"
            ? { rejectBanCount: decremented, updatedAt: new Date() }
            : { deleteCount: decremented, updatedAt: new Date() }
        )
        .where(counterKey(youtubeChannelId, pacificDay));
    } catch (err) {
      // Keeping a slot we could have released only makes the cap stricter.
      console.error("moderation: could not release cap slots", err);
    }
  },
};

const STATE_AFTER: Record<RequestedAction, ModerationState> = {
  flag: "flagged",
  hold: "held",
  reject: "rejected",
  ban: "banned",
  delete: "deleted",
  release: "released",
};

/** Actions that mark a comment actioned (I4); flag and release do not. */
const ACTIONING = new Set<RequestedAction>(["hold", "reject", "ban", "delete"]);

const drizzleStore: ModerationStore = {
  async getPauseFlags(youtubeChannelId) {
    const [row] = await db
      .select({
        rejectBan: commentAutomation.pausedRejectBan,
        delete: commentAutomation.pausedDelete,
      })
      .from(commentAutomation)
      .where(eq(commentAutomation.youtubeChannelId, youtubeChannelId));
    return { rejectBan: row?.rejectBan ?? false, delete: row?.delete ?? false };
  },

  async setPaused(youtubeChannelId, capClass: CapClass) {
    const set =
      capClass === "rejectBan"
        ? { pausedRejectBan: true, updatedAt: new Date() }
        : { pausedDelete: true, updatedAt: new Date() };
    try {
      await db
        .insert(commentAutomation)
        .values({ youtubeChannelId, ...set })
        .onConflictDoUpdate({ target: commentAutomation.youtubeChannelId, set });
    } catch (err) {
      // The match itself already degraded to hold; a lost flag only means the
      // next run reserves again and degrades again.
      console.error("moderation: could not set the cap pause", err);
    }
  },

  async insertSnapshot(row) {
    const [inserted] = await db
      .insert(commentEdits)
      .values({
        organizationId: row.organizationId,
        userId: row.userId,
        channelId: row.channelId,
        commentId: row.commentId,
        videoId: row.videoId,
        verb: row.verb,
        textSource: row.textSource,
        beforeText: row.beforeText,
        afterText: null,
        status: "pending",
        source: row.source,
      })
      .returning({ id: commentEdits.id });
    if (!inserted) throw new Error("comment_edits insert returned no row");
    return inserted.id;
  },

  async settleSnapshot(editId, status) {
    try {
      await db.update(commentEdits).set({ status }).where(eq(commentEdits.id, editId));
    } catch (err) {
      console.error("moderation: could not settle comment_edits status", err);
    }
  },

  async recordOutcomes(channel, actor, outcomes: readonly ApplyOutcome[], at) {
    if (outcomes.length === 0) return;
    try {
      await db.insert(commentModerationActions).values(
        outcomes.map((o) => ({
          youtubeChannelId: channel.id,
          commentId: o.commentId,
          requestedAction: o.requestedAction,
          appliedAction: o.appliedAction,
          degradedReason: o.degradedReason,
          source: actor.source,
          userId: actor.userId,
          ruleId: o.ruleId,
          rubricVersion: o.rubricVersion,
          status: o.status,
          error: o.error,
          createdAt: at,
        }))
      );
    } catch (err) {
      console.error("moderation: could not write the action log", err);
    }

    // moderation_state follows only what YouTube confirmed.
    const byState = new Map<RequestedAction, string[]>();
    for (const o of outcomes) {
      if (o.status !== "applied") continue;
      const list = byState.get(o.appliedAction) ?? [];
      list.push(o.commentId);
      byState.set(o.appliedAction, list);
    }
    for (const [action, commentIds] of byState) {
      try {
        await db
          .update(youtubeComments)
          .set({
            moderationState: STATE_AFTER[action],
            updatedAt: at,
            // The first hold/reject/ban/delete stamps actioned_at; later ones keep it.
            ...(ACTIONING.has(action)
              ? { actionedAt: sql`COALESCE(${youtubeComments.actionedAt}, NOW())` }
              : {}),
          })
          .where(
            and(
              eq(youtubeComments.youtubeChannelId, channel.id),
              inArray(youtubeComments.id, commentIds)
            )
          );
      } catch (err) {
        console.error("moderation: could not update moderation_state", err);
      }
    }
  },
};
