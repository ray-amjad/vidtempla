import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiKey, apiSuccess, apiError, logRequest } from "@/lib/api-auth";
import { commentContext, serviceErrorResponse } from "@/lib/api-comments";
import { searchChannelComments } from "@/lib/services/comments";

const ENDPOINT = "/youtube/comments";

const QuerySchema = z.object({
  channelId: z.string().min(1),
  searchTerms: z.string().min(1).optional(),
  maxResults: z.coerce.number().int().min(1).max(100).optional(),
  // `time` only. YouTube rejects relevance ordering for a channel-wide search
  // (see `searchChannelCommentThreads`), so `relevance` is refused here with a
  // suggestion rather than accepted and silently dropped.
  order: z.literal("time").optional(),
  cursor: z.string().min(1).optional(),
});

/**
 * GET /api/v1/youtube/comments?channelId=...&searchTerms=...&maxResults=100&order=time&cursor=...
 *
 * Searches every comment thread related to a channel — the discovery step of a
 * link sweep. Comment state is never stored, so the matches are re-found live
 * on every call.
 *
 * Always ordered newest-first; `order` accepts only `time`. For relevance
 * ordering, list one video's threads via `/youtube/comments/{videoId}`.
 *
 * Quota cost: 1 unit per page
 */
export async function GET(request: NextRequest) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(request.url);
  const parsed = QuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    logRequest(ctx, ENDPOINT, "GET", 400, 0);
    return NextResponse.json(
      apiError(
        "VALIDATION_ERROR",
        parsed.error.message,
        "Required: channelId (UC... of a connected channel). Optional: searchTerms, maxResults (1-100), cursor. Channel-wide search is always newest-first — order accepts only 'time'; for relevance ordering, list one video via /youtube/comments/{videoId}.",
        400
      ),
      { status: 400 }
    );
  }

  const { channelId, searchTerms, maxResults, cursor } = parsed.data;
  const comments = commentContext(ctx);
  const result = await searchChannelComments(channelId, comments, {
    searchTerms,
    maxResults,
    pageToken: cursor,
  });
  if ("error" in result) return serviceErrorResponse(ctx, comments, ENDPOINT, "GET", result);

  const quotaUnits = comments.meter.total;
  logRequest(ctx, ENDPOINT, "GET", 200, quotaUnits);
  return NextResponse.json(
    apiSuccess(result.data.items, {
      cursor: result.data.nextPageToken ?? null,
      hasMore: Boolean(result.data.nextPageToken),
      total: null,
      quotaUnits,
    })
  );
}
