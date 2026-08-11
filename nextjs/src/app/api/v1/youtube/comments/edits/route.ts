import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withApiKey, apiSuccess, apiError, logRequest } from "@/lib/api-auth";
import { commentContext, serviceErrorResponse } from "@/lib/api-comments";
import { listCommentEdits } from "@/lib/services/comments";

const ENDPOINT = "/youtube/comments/edits";

const QuerySchema = z.object({
  channelId: z.string().min(1).optional(),
  commentId: z.string().min(1).optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/**
 * GET /api/v1/youtube/comments/edits?channelId=...&commentId=...&cursor=...&limit=50
 *
 * The audit trail of every comment update and deletion made through VidTempla,
 * newest first. Each row holds the comment's text as it was before the write —
 * the only surviving copy, because YouTube keeps no comment version history.
 *
 * Only rows with `textSource: "original"` hold restorable text; `"display"`
 * rows are HTML-marked-up records of a third-party comment and are an audit
 * record only. Restoring is a normal write (51 units), not a free rollback.
 *
 * Quota cost: 0 units (no YouTube call)
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
        "All parameters are optional: channelId, commentId, cursor, limit (1-100, default 50).",
        400
      ),
      { status: 400 }
    );
  }

  const result = await listCommentEdits(commentContext(ctx), parsed.data);
  if ("error" in result) return serviceErrorResponse(ctx, ENDPOINT, "GET", result);

  logRequest(ctx, ENDPOINT, "GET", 200, 0);
  return NextResponse.json(
    apiSuccess(result.data.data, {
      cursor: result.data.meta.cursor ?? null,
      hasMore: result.data.meta.hasMore,
      total: result.data.meta.total,
      quotaUnits: 0,
    })
  );
}
