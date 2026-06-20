import axios from "axios";
import { getChannelTokens, getAnyUserToken } from "@/lib/api-auth";
import {
  listCommentThreads as ytListCommentThreads,
  replyToComment as ytReplyToComment,
  updateComment as ytUpdateComment,
  deleteComment as ytDeleteComment,
  resolveChannelId,
} from "@/lib/clients/youtube";
import type { ServiceResult } from "./types";

// ── list_comment_threads ─────────────────────────────────────

export async function listCommentThreads(
  videoId: string,
  channelId: string | undefined,
  userId: string,
  opts: { maxResults?: number; order?: string; pageToken?: string; organizationId?: string } = {}
): Promise<ServiceResult<{ items: unknown[]; nextPageToken?: string }>> {
  try {
    // Resolve @handle or URL to UC... channel ID
    if (channelId && !/^UC[\w-]{22}$/.test(channelId)) {
      const anyToken = await getAnyUserToken(userId, opts.organizationId);
      if ("error" in anyToken) {
        return { error: { code: anyToken.error.error.code, message: anyToken.error.error.message, suggestion: anyToken.error.error.suggestion ?? "", status: anyToken.status } };
      }
      try {
        channelId = await resolveChannelId(channelId, anyToken.accessToken);
      } catch (e) {
        return { error: { code: "INVALID_CHANNEL", message: e instanceof Error ? e.message : "Failed to resolve channel", suggestion: "Pass a UC... channel ID, @handle, or YouTube channel URL", status: 400 } };
      }
    }

    // Try specific channel token if provided, fall back to any connected channel
    const specificResult = channelId
      ? await getChannelTokens(channelId, userId, opts.organizationId)
      : undefined;

    const tokenResult = specificResult && !("error" in specificResult)
      ? specificResult
      : await getAnyUserToken(userId, opts.organizationId);

    if ("error" in tokenResult) {
      return { error: { code: tokenResult.error.error.code, message: tokenResult.error.error.message, suggestion: tokenResult.error.error.suggestion ?? "", status: tokenResult.status } };
    }

    const accessToken = tokenResult.accessToken;

    const result = await ytListCommentThreads(accessToken, videoId, opts);
    return { data: result };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to list comment threads", suggestion: "Try again later", status: 500 } };
  }
}

// ── reply_to_comment ─────────────────────────────────────────

export async function replyToComment(
  channelId: string,
  parentId: string,
  text: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<unknown>> {
  try {
    const tokens = await getChannelTokens(channelId, userId, organizationId);
    if ("error" in tokens) {
      return { error: { code: tokens.error.error.code, message: tokens.error.error.message, suggestion: tokens.error.error.suggestion ?? "", status: tokens.status } };
    }

    const comment = await ytReplyToComment(tokens.accessToken, parentId, text);
    return { data: comment };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to reply to comment", suggestion: "Try again later", status: 500 } };
  }
}

// ── update_comment ───────────────────────────────────────────

export async function updateComment(
  channelId: string,
  commentId: string,
  text: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<unknown>> {
  try {
    const tokens = await getChannelTokens(channelId, userId, organizationId);
    if ("error" in tokens) {
      return { error: { code: tokens.error.error.code, message: tokens.error.error.message, suggestion: tokens.error.error.suggestion ?? "", status: tokens.status } };
    }

    const comment = await ytUpdateComment(tokens.accessToken, commentId, text);
    return { data: comment };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response) {
      const status = error.response.status || 500;
      const message = error.response.data?.error?.message || error.message;
      return {
        error: {
          code: "YOUTUBE_API_ERROR",
          message,
          suggestion: status === 403
            ? "You can only edit comments authored by the connected channel. Confirm the channelId matches the channel that wrote the comment."
            : "Check the commentId is valid and try again.",
          status,
        },
      };
    }
    return { error: { code: "INTERNAL_ERROR", message: "Failed to update comment", suggestion: "Try again later", status: 500 } };
  }
}

// ── delete_comment ───────────────────────────────────────────

export async function deleteComment(
  channelId: string,
  commentId: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<{ deleted: true }>> {
  try {
    const tokens = await getChannelTokens(channelId, userId, organizationId);
    if ("error" in tokens) {
      return { error: { code: tokens.error.error.code, message: tokens.error.error.message, suggestion: tokens.error.error.suggestion ?? "", status: tokens.status } };
    }

    await ytDeleteComment(tokens.accessToken, commentId);
    return { data: { deleted: true } };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to delete comment", suggestion: "Try again later", status: 500 } };
  }
}
