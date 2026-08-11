/**
 * Comments tRPC router — the dashboard surface of issue #135.
 *
 * Two tiers, and the tier boundary tracks irreversibility:
 *  - `orgProcedure`  — search, per-video listing, replies, reply. Additive or
 *                      reversible work any member may do.
 *  - `orgAdminProcedure` — bulk update and delete. Destructive and permanent,
 *                      so the *server* gates them; hiding the button in the UI
 *                      is cosmetic only and is never the enforcement.
 *
 * I9: nothing here talks to the YouTube client or `consumeCredits` directly.
 * Every procedure delegates to `services/comments.ts`, which owns credits and
 * `comment_edits` snapshots, and receives `source: 'dashboard'`.
 *
 * Org isolation: the service resolves the channel token through
 * `getChannelTokens(channelId, userId, organizationId)`, which filters on the
 * active organization — a `UC…` id outside the workspace fails 404 before any
 * YouTube call. `listForVideo` additionally resolves its video from the
 * database so a member cannot aim it at a video the workspace does not own.
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "@/db";
import { youtubeChannels, youtubeVideos } from "@/db/schema";
import { orgProcedure, orgAdminProcedure, router } from "@/server/trpc/init";
import {
  bulkUpdateComments,
  createCreditMeter,
  deleteComment,
  getCommentReplies,
  listCommentThreads,
  replyToComment,
  searchChannelComments,
  type CommentContext,
} from "@/lib/services/comments";
import { bulkUpdateInputSchema } from "@/lib/comment-schemas";
import type { ServiceResult } from "@/lib/services/types";

type ServiceError = Extract<ServiceResult<unknown>, { error: unknown }>["error"];

/**
 * Maps a service error onto a tRPC code. `429` matters here in a way it does
 * not elsewhere in the dashboard: it is how an exhausted credit balance or a
 * tripped YouTube quota breaker surfaces. The `suggestion` is appended because
 * it is the only self-correcting instruction the user gets in a toast.
 */
function throwCommentServiceError(error: ServiceError): never {
  const code =
    error.status === 404
      ? "NOT_FOUND"
      : error.status === 403
        ? "FORBIDDEN"
        : error.status === 429
          ? "TOO_MANY_REQUESTS"
          : error.status === 409
            ? "CONFLICT"
            : error.status >= 500
              ? "INTERNAL_SERVER_ERROR"
              : "BAD_REQUEST";
  throw new TRPCError({
    code,
    message: error.suggestion ? `${error.message}. ${error.suggestion}` : error.message,
  });
}

function commentContext(ctx: { user: { id: string }; organizationId: string }): CommentContext {
  return {
    userId: ctx.user.id,
    organizationId: ctx.organizationId,
    source: "dashboard",
    meter: createCreditMeter(),
  };
}

/**
 * Resolves a managed video to the pair the service needs — the YouTube video id
 * and its channel's `UC…` id — while proving the workspace owns it.
 */
async function resolveManagedVideo(videoRowId: string, organizationId: string) {
  const [row] = await db
    .select({
      videoId: youtubeVideos.videoId,
      channelId: youtubeChannels.channelId,
    })
    .from(youtubeVideos)
    .innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.id))
    .where(and(eq(youtubeVideos.id, videoRowId), eq(youtubeChannels.organizationId, organizationId)));

  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Video not found" });
  return row;
}

const channelIdSchema = z.string().min(1);
/**
 * `cursor` is YouTube's `pageToken` under the dashboard's own name — the field
 * has to be called `cursor` for `useInfiniteQuery` to page on it, and the rest
 * of the dashboard already spells it that way.
 */
const pageSchema = {
  maxResults: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
};

export const commentsRouter = router({
  // ==================== Member tier ====================

  /** Channel-wide comment search — the discovery step of a course-link sweep. 1 credit per page. */
  search: orgProcedure
    .input(
      z.object({
        channelId: channelIdSchema,
        searchTerms: z.string().optional(),
        order: z.enum(["time", "relevance"]).optional(),
        ...pageSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await searchChannelComments(input.channelId, commentContext(ctx), {
        searchTerms: input.searchTerms,
        order: input.order,
        maxResults: input.maxResults,
        pageToken: input.cursor,
      });
      if ("error" in result) throwCommentServiceError(result.error);
      return result.data;
    }),

  /** Top-level threads on one managed video. 1 credit per page. */
  listForVideo: orgProcedure
    .input(
      z.object({
        videoId: z.string().uuid(),
        order: z.enum(["time", "relevance"]).optional(),
        ...pageSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const video = await resolveManagedVideo(input.videoId, ctx.organizationId);
      const result = await listCommentThreads(video.channelId, video.videoId, commentContext(ctx), {
        order: input.order,
        maxResults: input.maxResults,
        pageToken: input.cursor,
      });
      if ("error" in result) throwCommentServiceError(result.error);
      return { ...result.data, channelId: video.channelId };
    }),

  /** Full reply set of a thread — `commentThreads.list` inlines only a subset. 1 credit per page. */
  getReplies: orgProcedure
    .input(
      z.object({
        channelId: channelIdSchema,
        parentId: z.string().min(1),
        ...pageSchema,
      })
    )
    .query(async ({ ctx, input }) => {
      const result = await getCommentReplies(input.channelId, input.parentId, commentContext(ctx), {
        maxResults: input.maxResults,
        pageToken: input.cursor,
      });
      if ("error" in result) throwCommentServiceError(result.error);
      return result.data;
    }),

  /** Replies to a comment. New content, so no snapshot row. 50 credits. */
  reply: orgProcedure
    .input(
      z.object({
        channelId: channelIdSchema,
        parentId: z.string().min(1),
        text: z.string().min(1).max(10000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await replyToComment(
        input.channelId,
        input.parentId,
        input.text,
        commentContext(ctx)
      );
      if ("error" in result) throwCommentServiceError(result.error);
      return result.data;
    }),

  // ==================== Admin tier (destructive) ====================

  /**
   * Rewrites up to 40 comments in one batch (I5). The service runs phases
   * 0/1/2 and snapshots every prior text before any write (I2/I6).
   * 51 credits per item, plus 1 per reconciled stale row.
   */
  bulkUpdate: orgAdminProcedure
    .input(bulkUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await bulkUpdateComments(input.channelId, input.items, commentContext(ctx));
      if ("error" in result) throwCommentServiceError(result.error);
      return result.data;
    }),

  /** Deletes a comment permanently (I4). Snapshotted first (I2). 51 credits. */
  delete: orgAdminProcedure
    .input(
      z.object({
        channelId: channelIdSchema,
        commentId: z.string().min(1),
        videoId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await deleteComment(input.channelId, input.commentId, commentContext(ctx), {
        videoId: input.videoId,
      });
      if ("error" in result) throwCommentServiceError(result.error);
      return result.data;
    }),
});
