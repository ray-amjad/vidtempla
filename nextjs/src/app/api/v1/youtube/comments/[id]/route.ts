import { NextRequest, NextResponse } from "next/server";
import {
  withApiKey,
  requireWriteAccess,
  apiSuccess,
  apiError,
  logRequest,
} from "@/lib/api-auth";
import { commentContext, serviceErrorResponse } from "@/lib/api-comments";
import { creditsConsumedOf, deleteComment, listCommentThreads } from "@/lib/services/comments";

/**
 * GET /api/v1/youtube/comments/[id]?channelId=...&maxResults=100&order=relevance|time&cursor=...
 * List comment threads for a video (id = videoId)
 * Quota cost: 1 unit
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;

  const { id: videoId } = await params;
  const endpoint = `/youtube/comments/${videoId}`;
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const pageToken = searchParams.get("cursor") || searchParams.get("pageToken") || undefined;
  const maxResultsParam = searchParams.get("maxResults");
  const maxResults = maxResultsParam
    ? Math.min(Math.max(parseInt(maxResultsParam, 10) || 20, 1), 100)
    : undefined;
  const order = searchParams.get("order") || "relevance";

  if (!channelId) {
    logRequest(ctx, endpoint, "GET", 400, 0);
    return NextResponse.json(
      apiError(
        "MISSING_PARAMETER",
        "channelId is required",
        "Provide a channelId query parameter to identify the channel",
        400
      ),
      { status: 400 }
    );
  }

  if (!["relevance", "time"].includes(order)) {
    logRequest(ctx, endpoint, "GET", 400, 0);
    return NextResponse.json(
      apiError(
        "INVALID_PARAMETER",
        "order must be 'relevance' or 'time'",
        "Use order=relevance for top comments or order=time for newest first",
        400
      ),
      { status: 400 }
    );
  }

  const result = await listCommentThreads(channelId, videoId, commentContext(ctx), {
    maxResults,
    order,
    pageToken,
  });
  if ("error" in result) return serviceErrorResponse(ctx, endpoint, "GET", result);

  const quotaUnits = creditsConsumedOf(result);
  logRequest(ctx, endpoint, "GET", 200, quotaUnits);
  return NextResponse.json(
    apiSuccess(result.data.items, {
      cursor: result.data.nextPageToken ?? null,
      hasMore: Boolean(result.data.nextPageToken),
      total: null,
      quotaUnits,
    })
  );
}

/**
 * DELETE /api/v1/youtube/comments/[id]?channelId=...&videoId=...
 * Delete a comment permanently (id = commentId)
 * Quota cost: 51 units (1 snapshot read + 50 write)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;
  const writeCheck = requireWriteAccess(ctx);
  if (writeCheck) return writeCheck;

  const { id: commentId } = await params;
  const endpoint = `/youtube/comments/${commentId}`;
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");
  const videoId = searchParams.get("videoId") || undefined;

  if (!channelId) {
    logRequest(ctx, endpoint, "DELETE", 400, 0);
    return NextResponse.json(
      apiError(
        "MISSING_PARAMETER",
        "channelId is required",
        "Provide a channelId query parameter",
        400
      ),
      { status: 400 }
    );
  }

  const result = await deleteComment(channelId, commentId, commentContext(ctx), { videoId });
  if ("error" in result) return serviceErrorResponse(ctx, endpoint, "DELETE", result);

  const quotaUnits = creditsConsumedOf(result);
  logRequest(ctx, endpoint, "DELETE", 200, quotaUnits);
  return NextResponse.json(
    apiSuccess({ deleted: true, editId: result.data.editId }, { quotaUnits })
  );
}
