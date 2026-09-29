/**
 * Comment moderation tRPC router — the dashboard surface of issue #156.
 *
 * Two tiers (spec permissions table, I9):
 *  - `orgProcedure`      — every read, and `suggestCorrection`, the one verb a
 *                          member may use. A suggestion only enters the next
 *                          draft once an owner or admin accepts it.
 *  - `orgAdminProcedure` — every other mutation: automation on/off and resume,
 *                          rules, rubric draft / dry run / publish, example
 *                          review, release and manual actions. A member gets
 *                          FORBIDDEN from the procedure itself; hiding a button
 *                          in the UI is cosmetic only.
 *
 * `npm run test:org-guards` parses this file (Proof #9): every mutation must be
 * `orgAdminProcedure` except `suggestCorrection`, and the mutation list is
 * pinned there. A new mutation fails that check until its role is decided.
 *
 * Nothing here talks to YouTube, Jev or credits directly. Every procedure
 * delegates to `lib/moderation/service.ts` (writes) or `queries.ts` (reads),
 * which resolve `channelId` — the `youtube_channels.id` uuid — inside
 * `ctx.organizationId`, so a channel of another org is NOT_FOUND. Every hold,
 * reject, ban, delete and release reaches YouTube only through
 * `applyModerationDecision` (I1).
 *
 * `dryRunRubric` is a mutation, not a query: it spends 1 credit per comment it
 * scores, and a query could be refetched on focus.
 */

import { z } from "zod";
import { db } from "@/db";
import { apiRequestLog } from "@/db/schema";
import { orgProcedure, orgAdminProcedure, router } from "@/server/trpc/init";
import {
  acceptExample,
  applyManualAction,
  dryRunRubric,
  MAX_INSTRUCTIONS_CHARS,
  MAX_MANUAL_COMMENT_IDS,
  MAX_RULES,
  publishRubric,
  rejectExample,
  releaseHeldComment,
  resumeAutomation,
  saveRubricDraft,
  setChannelAutomation,
  setModerationRules,
  suggestCorrection,
  type ModerationCtx,
} from "@/lib/moderation/service";
import {
  getModerationOverview,
  getRubrics,
  getRules,
  LIST_MAX_LIMIT,
  listActionLog,
  listExamples,
  listMaybeRelease,
  listReviewQueue,
  listScoredComments,
} from "@/lib/moderation/queries";
import { DRY_RUN_MAX_COMMENTS } from "@/lib/moderation/core";
import type { ServiceResult } from "@/lib/services/types";
import { throwCommentServiceError } from "./comments";

type OrgCtx = { user: { id: string }; organizationId: string };

function moderationCtx(ctx: OrgCtx): ModerationCtx {
  return { organizationId: ctx.organizationId, userId: ctx.user.id };
}

/** Unwraps a service result; a service error becomes a TRPCError (404 → NOT_FOUND, 409 → CONFLICT, …). */
function unwrap<T>(result: ServiceResult<T>): T {
  if ("error" in result) throwCommentServiceError(result.error);
  return result.data;
}

/**
 * Records the credits a dashboard moderation call spent, like the comments
 * router does, so `apiKeys.getUsage` sees them. Only the three procedures that
 * can spend credits log (dry run, manual action, release); reads and settings
 * changes cost nothing and are not logged. Fire-and-forget.
 */
function logCredits(ctx: OrgCtx, procedure: string, credits: number, statusCode: number): void {
  db.insert(apiRequestLog)
    .values({
      apiKeyId: null,
      userId: ctx.user.id,
      organizationId: ctx.organizationId,
      endpoint: `moderation.${procedure}`,
      method: "TRPC",
      statusCode,
      quotaUnits: credits,
      source: "dashboard",
    })
    .then(() => {})
    .catch((err) => console.error("Failed to log dashboard moderation request:", err));
}

/** Net credits of a chokepoint call: the sum of each outcome's charge after refunds. */
function applyCredits(result: ServiceResult<{ outcomes: { creditsCharged: number }[] }>): number {
  return "error" in result ? 0 : result.data.outcomes.reduce((sum, o) => sum + o.creditsCharged, 0);
}

const MODERATION_ACTION = z.enum(["flag", "hold", "reject", "ban", "delete"]);
const MODERATION_STATE = z.enum(["none", "flagged", "held", "rejected", "banned", "deleted", "released"]);

/** `youtube_channels.id`, resolved inside the active org by the service. */
const channelInput = { channelId: z.string().uuid() };
const listInput = {
  ...channelInput,
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
};

/** Rule shape only; range, label and enum checks are the service's (clean per-rule messages). */
const ruleInput = z.object({
  label: z.string(),
  threshold: z.number(),
  action: z.string(),
});
const commentIdsInput = z.array(z.string().uuid()).min(1).max(MAX_MANUAL_COMMENT_IDS);

export const moderationRouter = router({
  // ==================== Reads (any member) ====================

  /** Automation state, cap status and pause flags, model version, counts per state. */
  overview: orgProcedure
    .input(z.object(channelInput))
    .query(async ({ ctx, input }) => unwrap(await getModerationOverview(ctx.organizationId, input.channelId))),

  /** Stored comments with their published-version score, newest first. */
  comments: orgProcedure
    .input(
      z.object({
        ...listInput,
        label: z.string().min(1).optional(),
        moderationStates: z.array(MODERATION_STATE).optional(),
      })
    )
    .query(async ({ ctx, input }) =>
      unwrap(
        await listScoredComments(ctx.organizationId, input.channelId, {
          cursor: input.cursor,
          limit: input.limit,
          label: input.label,
          moderationStates: input.moderationStates,
        })
      )
    ),

  /** Held and flagged comments waiting for a person. */
  reviewQueue: orgProcedure
    .input(z.object({ ...listInput, label: z.string().min(1).optional() }))
    .query(async ({ ctx, input }) =>
      unwrap(
        await listReviewQueue(ctx.organizationId, input.channelId, {
          cursor: input.cursor,
          limit: input.limit,
          label: input.label,
        })
      )
    ),

  /** Held comments whose current score matches no rule (I4 "maybe release"). */
  maybeRelease: orgProcedure
    .input(z.object({ ...channelInput, limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional() }))
    .query(async ({ ctx, input }) =>
      unwrap(await listMaybeRelease(ctx.organizationId, input.channelId, { limit: input.limit }))
    ),

  /** Automatic and manual actions, newest first. */
  actionLog: orgProcedure
    .input(z.object(listInput))
    .query(async ({ ctx, input }) =>
      unwrap(
        await listActionLog(ctx.organizationId, input.channelId, { cursor: input.cursor, limit: input.limit })
      )
    ),

  rules: orgProcedure
    .input(z.object(channelInput))
    .query(async ({ ctx, input }) => unwrap(await getRules(ctx.organizationId, input.channelId))),

  /** The published and draft rubrics, plus the last `history` superseded ones. */
  rubrics: orgProcedure
    .input(z.object({ ...channelInput, history: z.number().int().min(0).max(20).optional() }))
    .query(async ({ ctx, input }) =>
      unwrap(await getRubrics(ctx.organizationId, input.channelId, { history: input.history }))
    ),

  examples: orgProcedure
    .input(
      z.object({
        ...channelInput,
        status: z.enum(["suggested", "accepted", "rejected"]).optional(),
        limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
      })
    )
    .query(async ({ ctx, input }) =>
      unwrap(
        await listExamples(ctx.organizationId, input.channelId, { status: input.status, limit: input.limit })
      )
    ),

  // ==================== Member mutation ====================

  /** Any member suggests the right label for a stored comment. It enters no rubric until accepted. */
  suggestCorrection: orgProcedure
    .input(z.object({ ...channelInput, commentId: z.string().uuid(), label: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => unwrap(await suggestCorrection(moderationCtx(ctx), input))),

  // ==================== Owner / admin mutations (I9) ====================

  /** Turns automatic moderation on or off. First enable seeds and publishes rubric v1. */
  setChannelAutomation: orgAdminProcedure
    .input(z.object({ ...channelInput, enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => unwrap(await setChannelAutomation(moderationCtx(ctx), input))),

  /** Clears the cap pause flags (both classes when `classes` is omitted). */
  resumeAutomation: orgAdminProcedure
    .input(z.object({ ...channelInput, classes: z.array(z.enum(["rejectBan", "delete"])).optional() }))
    .mutation(async ({ ctx, input }) => unwrap(await resumeAutomation(moderationCtx(ctx), input))),

  /** Replaces the channel's rules atomically. Returns warnings (e.g. threshold 0). */
  setModerationRules: orgAdminProcedure
    .input(z.object({ ...channelInput, rules: z.array(ruleInput).max(MAX_RULES) }))
    .mutation(async ({ ctx, input }) => unwrap(await setModerationRules(moderationCtx(ctx), input))),

  saveRubricDraft: orgAdminProcedure
    .input(
      z.object({
        ...channelInput,
        labels: z.array(z.object({ name: z.string(), description: z.string().default("") })),
        instructions: z.string().max(MAX_INSTRUCTIONS_CHARS),
        removeExampleIds: z.array(z.string().uuid()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => unwrap(await saveRubricDraft(moderationCtx(ctx), input))),

  /** Scores up to 40 stored comments with the draft. 1 credit per comment scored; no YouTube call. */
  dryRunRubric: orgAdminProcedure
    .input(
      z.object({
        ...channelInput,
        rules: z.array(ruleInput).max(MAX_RULES).optional(),
        limit: z.number().int().min(1).max(DRY_RUN_MAX_COMMENTS).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await dryRunRubric(moderationCtx(ctx), input);
      logCredits(
        ctx,
        "dryRunRubric",
        "error" in result ? 0 : result.data.creditsCharged,
        "error" in result ? result.error.status : 200
      );
      return unwrap(result);
    }),

  /** Makes the draft the live version and starts a reclassify run (production only). */
  publishRubric: orgAdminProcedure
    .input(z.object(channelInput))
    .mutation(async ({ ctx, input }) => unwrap(await publishRubric(moderationCtx(ctx), input))),

  acceptExample: orgAdminProcedure
    .input(z.object({ ...channelInput, exampleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => unwrap(await acceptExample(moderationCtx(ctx), input))),

  rejectExample: orgAdminProcedure
    .input(z.object({ ...channelInput, exampleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => unwrap(await rejectExample(moderationCtx(ctx), input))),

  /** Held comments back to published, through the chokepoint. Up to 50 ids. */
  releaseHeldComment: orgAdminProcedure
    .input(z.object({ ...channelInput, commentIds: commentIdsInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await releaseHeldComment(moderationCtx(ctx), input);
      logCredits(ctx, "releaseHeldComment", applyCredits(result), "error" in result ? result.error.status : 200);
      return unwrap(result);
    }),

  /** A person's flag / hold / reject / ban / delete from the review queue. 50 credits per YouTube write. */
  applyManualAction: orgAdminProcedure
    .input(z.object({ ...channelInput, commentIds: commentIdsInput, action: MODERATION_ACTION }))
    .mutation(async ({ ctx, input }) => {
      const result = await applyManualAction(moderationCtx(ctx), input);
      logCredits(ctx, "applyManualAction", applyCredits(result), "error" in result ? result.error.status : 200);
      return unwrap(result);
    }),
});
