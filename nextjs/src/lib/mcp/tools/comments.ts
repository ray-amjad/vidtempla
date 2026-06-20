import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcp, mcpQuotaExceeded, getSessionUserId, getSessionOrgId, logMcpRequest, READ, WRITE, DESTRUCTIVE } from "../helpers";
import { consumeCredits } from "@/lib/plan-limits";
import { listCommentThreads, replyToComment, updateComment, deleteComment } from "@/lib/services/comments";

export function registerCommentTools(server: McpServer) {
  server.tool(
    "list_comment_threads",
    "List top-level comment threads on a YouTube video, including replies. Returns up to 100 threads per page with pagination support.",
    {
      videoId: z.string().describe("YouTube video ID (e.g. 'dQw4w9WgXcQ')"),
      channelId: z.string().optional().describe("YouTube channel ID, @handle, or channel URL (optional — if omitted, reads comments using any connected channel's token)"),
      maxResults: z.number().optional().describe("Number of threads to return (1-100, default 20)"),
      order: z.enum(["relevance", "time"]).optional().describe("Sort order: 'relevance' (default) or 'time' (newest first)"),
      pageToken: z.string().optional().describe("Pagination token from a previous response's nextPageToken"),
    },
    READ,
    async ({ videoId, channelId, maxResults, order, pageToken }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 1);
      if (!credits.success) return mcpQuotaExceeded(userId, "list_comment_threads");
      const result = await listCommentThreads(videoId, channelId, userId, { maxResults, order, pageToken, organizationId: orgId });
      logMcpRequest(userId, "list_comment_threads", 1, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "reply_to_comment",
    "Post a reply to an existing YouTube comment. The reply appears as a child of the specified parent comment thread.",
    {
      channelId: z.string().describe("YouTube channel ID to reply as"),
      parentId: z.string().describe("The comment ID to reply to (from list_comment_threads results)"),
      text: z.string().describe("Reply text content (supports YouTube markdown: *bold*, _italic_)"),
    },
    WRITE,
    async ({ channelId, parentId, text }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 50);
      if (!credits.success) return mcpQuotaExceeded(userId, "reply_to_comment");
      const result = await replyToComment(channelId, parentId, text, userId, orgId);
      logMcpRequest(userId, "reply_to_comment", 50, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "update_comment",
    "Edit the text of a YouTube comment you authored (e.g. a pinned comment). Editing keeps a pinned comment pinned. You can only edit comments your connected channel wrote.",
    {
      channelId: z.string().describe("YouTube channel ID that authored the comment (the channel to act as)"),
      commentId: z.string().describe("The comment ID to edit (from list_comment_threads results — use the topLevelComment id for a pinned comment)"),
      text: z.string().describe("New comment text (supports YouTube markdown: *bold*, _italic_)"),
    },
    WRITE,
    async ({ channelId, commentId, text }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 50);
      if (!credits.success) return mcpQuotaExceeded(userId, "update_comment");
      const result = await updateComment(channelId, commentId, text, userId, orgId);
      logMcpRequest(userId, "update_comment", 50, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "delete_comment",
    "Permanently delete a YouTube comment. This cannot be undone. You can only delete comments on videos you own or comments you authored.",
    {
      channelId: z.string().describe("YouTube channel ID that owns the video"),
      commentId: z.string().describe("The comment ID to delete (from list_comment_threads results)"),
    },
    DESTRUCTIVE,
    async ({ channelId, commentId }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 50);
      if (!credits.success) return mcpQuotaExceeded(userId, "delete_comment");
      const result = await deleteComment(channelId, commentId, userId, orgId);
      logMcpRequest(userId, "delete_comment", 50, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );
}
