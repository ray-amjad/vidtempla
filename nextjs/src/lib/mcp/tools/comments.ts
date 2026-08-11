import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcp, mcpError, getSessionUserId, getSessionOrgId, logMcpRequest, READ, WRITE, DESTRUCTIVE } from "../helpers";
import {
  BULK_MAX_ITEMS,
  bulkUpdateComments,
  createCreditMeter,
  deleteComment,
  getCommentReplies,
  listCommentEdits,
  listCommentThreads,
  postComment,
  replyToComment,
  searchChannelComments,
  updateComment,
  type CommentContext,
} from "@/lib/services/comments";
import { bulkUpdateInputShape } from "@/lib/comment-schemas";
import type { ServiceResult } from "@/lib/services/types";

/**
 * Comment tools are a thin wrapper: credits, snapshots and the bulk batch all
 * live in `services/comments.ts` (I9). Tools only shape arguments, log the
 * credits the service metered, and convert the result.
 */

function ctx(): CommentContext {
  return {
    userId: getSessionUserId(),
    organizationId: getSessionOrgId(),
    source: "mcp",
    meter: createCreditMeter(),
  };
}

/** Logs the credits the service actually consumed, then converts the result. */
function finish<T>(
  userId: string,
  toolName: string,
  context: CommentContext,
  result: ServiceResult<T>
) {
  logMcpRequest(
    userId,
    toolName,
    context.meter.total,
    "error" in result ? result.error.status : 200
  );
  return toMcp(result);
}

export function registerCommentTools(server: McpServer) {
  server.tool(
    "list_comment_threads",
    "List or search top-level comment threads. Pass videoId for one video's threads, or searchTerms to search every comment across the channel (the way to find comments containing a given URL). Returns up to 100 threads per page with pagination support. Costs 1 credit per page.",
    {
      channelId: z.string().describe("YouTube channel ID to read as (UC... — the channel connected to this workspace)"),
      videoId: z.string().optional().describe("YouTube video ID (e.g. 'dQw4w9WgXcQ') — omit to search channel-wide with searchTerms"),
      searchTerms: z.string().optional().describe("Search channel-wide for threads whose text matches, e.g. an old course URL. Ignored when videoId is set."),
      maxResults: z.number().optional().describe("Number of threads to return (1-100, default 20)"),
      order: z.enum(["relevance", "time"]).optional().describe("Sort order: 'relevance' (default) or 'time' (newest first)"),
      pageToken: z.string().optional().describe("Pagination token from a previous response's nextPageToken"),
    },
    READ,
    async ({ channelId, videoId, searchTerms, maxResults, order, pageToken }) => {
      const userId = getSessionUserId();
      if (!videoId && !searchTerms) {
        logMcpRequest(userId, "list_comment_threads", 0, 400);
        return mcpError(
          "MISSING_PARAMETER",
          "Pass videoId or searchTerms",
          "Use videoId to read one video's threads, or searchTerms to search the whole channel"
        );
      }
      const context = ctx();
      const result = videoId
        ? await listCommentThreads(channelId, videoId, context, { maxResults, order, pageToken })
        : await searchChannelComments(channelId, context, {
            searchTerms,
            maxResults,
            order,
            pageToken,
          });
      return finish(userId, "list_comment_threads", context, result);
    }
  );

  server.tool(
    "get_comment_replies",
    "List the replies to a top-level comment. list_comment_threads inlines only a partial subset of replies, so use this for a full thread. Costs 1 credit per page.",
    {
      channelId: z.string().describe("YouTube channel ID to read as (UC...)"),
      parentId: z.string().describe("The top-level comment ID whose replies to list"),
      maxResults: z.number().optional().describe("Number of replies to return (1-100, default 20)"),
      pageToken: z.string().optional().describe("Pagination token from a previous response's nextPageToken"),
    },
    READ,
    async ({ channelId, parentId, maxResults, pageToken }) => {
      const userId = getSessionUserId();
      const context = ctx();
      const result = await getCommentReplies(channelId, parentId, context, {
        maxResults,
        pageToken,
      });
      return finish(userId, "get_comment_replies", context, result);
    }
  );

  server.tool(
    "list_comment_edits",
    "List the audit trail of comment edits and deletions made through VidTempla, newest first. Each row records the text as it was before the write. Only rows with textSource 'original' hold restorable text; 'display' rows are HTML-marked-up audit records. Free — no YouTube call.",
    {
      channelId: z.string().optional().describe("Only rows for this YouTube channel ID"),
      commentId: z.string().optional().describe("Only rows for this comment ID"),
      cursor: z.string().optional().describe("Pagination cursor"),
      limit: z.number().optional().describe("Results per page (max 100, default 50)"),
    },
    READ,
    async ({ channelId, commentId, cursor, limit }) => {
      const userId = getSessionUserId();
      const context = ctx();
      const result = await listCommentEdits(context, { channelId, commentId, cursor, limit });
      return finish(userId, "list_comment_edits", context, result);
    }
  );

  server.tool(
    "reply_to_comment",
    "Post a reply to an existing YouTube comment. The reply appears as a child of the specified parent comment thread. Costs 50 credits.",
    {
      channelId: z.string().describe("YouTube channel ID to reply as (UC...)"),
      parentId: z.string().describe("The comment ID to reply to (from list_comment_threads results)"),
      text: z.string().min(1).describe("Reply text content (supports YouTube markdown: *bold*, _italic_)"),
    },
    WRITE,
    async ({ channelId, parentId, text }) => {
      const userId = getSessionUserId();
      const context = ctx();
      const result = await replyToComment(channelId, parentId, text, context);
      // The service wraps the new comment in `{ comment }` for its own callers;
      // this tool has always handed back the YouTube comment resource at the
      // root, and the REST route unwraps it the same way. Serializing the
      // envelope here instead would silently move every field one level deeper.
      return finish(
        userId,
        "reply_to_comment",
        context,
        "error" in result ? result : { data: result.data.comment }
      );
    }
  );

  server.tool(
    "post_comment",
    "Post a new top-level comment on a video. Costs 50 credits.",
    {
      channelId: z.string().describe("YouTube channel ID to comment as (UC...)"),
      videoId: z.string().describe("YouTube video ID to comment on"),
      text: z.string().min(1).describe("Comment text (supports YouTube markdown: *bold*, _italic_)"),
    },
    WRITE,
    async ({ channelId, videoId, text }) => {
      const userId = getSessionUserId();
      const context = ctx();
      const result = await postComment(channelId, videoId, text, context);
      return finish(userId, "post_comment", context, result);
    }
  );

  server.tool(
    "update_comment",
    "Edit the text of a YouTube comment you authored (e.g. a pinned comment). Editing is believed to preserve pin status; unverified. Always edit in place — deleting and reposting unpins the comment and loses its likes. The prior text is snapshotted first (see list_comment_edits). You can only edit comments your connected channel wrote. Costs 51 credits.",
    {
      channelId: z.string().describe("YouTube channel ID that authored the comment (the channel to act as)"),
      commentId: z.string().describe("The comment ID to edit (from list_comment_threads results — use the topLevelComment id for a pinned comment)"),
      text: z.string().min(1).describe("New comment text (supports YouTube markdown: *bold*, _italic_)"),
      videoId: z.string().optional().describe("Video the comment sits on, recorded on the snapshot row"),
    },
    WRITE,
    async ({ channelId, commentId, text, videoId }) => {
      const userId = getSessionUserId();
      const context = ctx();
      const result = await updateComment(channelId, commentId, text, context, { videoId });
      return finish(userId, "update_comment", context, result);
    }
  );

  server.tool(
    "update_comments",
    `Edit up to ${BULK_MAX_ITEMS} comments of one channel in a single call — the way to rewrite a course link everywhere it appears. Find the comments with list_comment_threads + searchTerms, pick the ones to change, then send them here with their new text. Every comment must have been authored by channelId; if one was not, the batch aborts and nothing is written. Each item's prior text is snapshotted first (see list_comment_edits). Costs 51 credits per item. For more than ${BULK_MAX_ITEMS} comments, loop over batches.`,
    bulkUpdateInputShape,
    WRITE,
    async ({ channelId, items }) => {
      const userId = getSessionUserId();
      const context = ctx();
      const result = await bulkUpdateComments(channelId, items, context);
      return finish(userId, "update_comments", context, result);
    }
  );

  server.tool(
    "delete_comment",
    "Permanently delete a YouTube comment. This cannot be undone. The prior text is snapshotted first (see list_comment_edits), but for a comment your channel did not write the snapshot is an audit record, not restorable text. You can only delete comments on videos you own or comments you authored. Costs 51 credits.",
    {
      channelId: z.string().describe("YouTube channel ID that owns the video (UC...)"),
      commentId: z.string().describe("The comment ID to delete (from list_comment_threads results)"),
      videoId: z.string().optional().describe("Video the comment sits on, recorded on the snapshot row"),
    },
    DESTRUCTIVE,
    async ({ channelId, commentId, videoId }) => {
      const userId = getSessionUserId();
      const context = ctx();
      const result = await deleteComment(channelId, commentId, context, { videoId });
      return finish(userId, "delete_comment", context, result);
    }
  );
}
