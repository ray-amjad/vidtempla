import { NextRequest, NextResponse } from "next/server";
import {
  withApiKey,
  requireWriteAccess,
  apiSuccess,
  apiError,
  logRequest,
} from "@/lib/api-auth";
import { commentContext, serviceErrorResponse } from "@/lib/api-comments";
import { creditsConsumedOf, replyToComment } from "@/lib/services/comments";

const ENDPOINT = "/youtube/comments/reply";

/**
 * POST /api/v1/youtube/comments/reply
 * Reply to a comment. New content, so no `comment_edits` snapshot is written.
 * Body: { channelId, parentId, text }
 * Quota cost: 50 units
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;
  const writeCheck = requireWriteAccess(ctx);
  if (writeCheck) return writeCheck;

  let body: { channelId?: string; parentId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    logRequest(ctx, ENDPOINT, "POST", 400, 0);
    return NextResponse.json(
      apiError(
        "INVALID_BODY",
        "Request body must be valid JSON",
        "Send a JSON body with { channelId, parentId, text }",
        400
      ),
      { status: 400 }
    );
  }

  const { channelId, parentId, text } = body;

  if (!channelId || !parentId || !text) {
    logRequest(ctx, ENDPOINT, "POST", 400, 0);
    return NextResponse.json(
      apiError(
        "MISSING_PARAMETER",
        "channelId, parentId, and text are required",
        "Provide channelId, parentId (the comment ID to reply to), and text in the body",
        400
      ),
      { status: 400 }
    );
  }

  const result = await replyToComment(channelId, parentId, text, commentContext(ctx));
  if ("error" in result) return serviceErrorResponse(ctx, ENDPOINT, "POST", result);

  const quotaUnits = creditsConsumedOf(result);
  logRequest(ctx, ENDPOINT, "POST", 200, quotaUnits);
  return NextResponse.json(apiSuccess(result.data.comment, { quotaUnits }));
}
