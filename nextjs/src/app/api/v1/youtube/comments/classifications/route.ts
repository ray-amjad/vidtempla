import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiKey, apiSuccess, apiError, logRequest } from "@/lib/api-auth";
import { listClassifications } from "@/lib/moderation/queries";

const ENDPOINT = "/youtube/comments/classifications";

const QuerySchema = z.object({
  channelId: z.string().min(1),
  label: z.string().min(1).max(40).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /api/v1/youtube/comments/classifications?channelId=UC...&label=spam&cursor=...&limit=50
 *
 * Stored comment moderation scores (#156) for one channel, newest comment
 * first: the published rubric's winning label, per-label probabilities, the
 * resolved Jev model, and the comment's moderation state. Read-only — rules,
 * rubrics and actions are edited in the dashboard only. Comment text is not
 * returned; read it with the comment-thread endpoints.
 *
 * Any key tier. An org-less (legacy) key gets withApiKey's 401
 * API_KEY_REISSUE_REQUIRED; a channel not connected to the key's org is 404.
 * Shares `listClassifications` with MCP `list_comment_classifications`.
 *
 * Quota cost: 0 units (no YouTube call, no credits)
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
        "channelId (UC...) is required; label, cursor and limit (1-100, default 50) are optional.",
        400
      ),
      { status: 400 }
    );
  }

  const result = await listClassifications(ctx.organizationId, parsed.data);
  if ("error" in result) {
    const { code, message, suggestion, status, meta } = result.error;
    logRequest(ctx, ENDPOINT, "GET", status, 0);
    return NextResponse.json(apiError(code, message, suggestion, status, meta), { status });
  }

  logRequest(ctx, ENDPOINT, "GET", 200, 0);
  return NextResponse.json(
    apiSuccess(result.data.items, {
      cursor: result.data.cursor,
      hasMore: result.data.hasMore,
      quotaUnits: 0,
    })
  );
}
