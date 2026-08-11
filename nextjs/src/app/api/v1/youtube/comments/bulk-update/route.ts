import { NextRequest, NextResponse } from "next/server";
import {
  withApiKey,
  requireWriteAccess,
  apiSuccess,
  apiError,
  logRequest,
} from "@/lib/api-auth";
import { commentContext, serviceErrorResponse } from "@/lib/api-comments";
import { BULK_MAX_ITEMS, bulkUpdateComments } from "@/lib/services/comments";
import { bulkUpdateInputSchema } from "@/lib/comment-schemas";

/**
 * A full batch is 40 reconcile reads + 40 snapshot reads + 40 writes — about
 * 48s of YouTube round-trips. Pinned to the same ceiling the MCP handler uses.
 */
export const maxDuration = 60;

const ENDPOINT = "/youtube/comments/bulk-update";

/** Shared with the MCP tool and the dashboard mutation — see comment-schemas.ts. */
const BodySchema = bulkUpdateInputSchema;

/**
 * POST /api/v1/youtube/comments/bulk-update
 *
 * Rewrites the text of up to 40 comments authored by one channel in a single
 * call — the way to replace a link everywhere it appears. Comments are edited
 * in place; delete-and-repost would unpin them and discard their likes.
 *
 * Every item's prior text is snapshotted before any write. If any comment is
 * missing or was not authored by `channelId`, the batch aborts and nothing is
 * written to YouTube. A YouTube quota halt stops the batch: earlier items stay
 * applied, the rest come back as `skipped` — resend those IDs to resume.
 *
 * Body: { channelId, items: [{ id, videoId?, text }] }
 * Quota cost: 51 units per item (1 snapshot read + 50 write), plus 1 per stale
 * row reconciled from an interrupted earlier batch. Only attempted items bill.
 */
export async function POST(request: NextRequest) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;
  const writeCheck = requireWriteAccess(ctx);
  if (writeCheck) return writeCheck;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    logRequest(ctx, ENDPOINT, "POST", 400, 0);
    return NextResponse.json(
      apiError(
        "INVALID_BODY",
        "Request body must be valid JSON",
        `Send a JSON body with { channelId, items: [{ id, text }] } — at most ${BULK_MAX_ITEMS} items`,
        400
      ),
      { status: 400 }
    );
  }

  const parsed = BodySchema.safeParse(rawBody);
  if (!parsed.success) {
    logRequest(ctx, ENDPOINT, "POST", 400, 0);
    return NextResponse.json(
      apiError(
        "VALIDATION_ERROR",
        parsed.error.message,
        `Required: channelId (UC...) and items, an array of 1-${BULK_MAX_ITEMS} objects { id, text, videoId? }. Split larger sweeps into batches and loop.`,
        400
      ),
      { status: 400 }
    );
  }

  const { channelId, items } = parsed.data;
  const comments = commentContext(ctx);
  const result = await bulkUpdateComments(channelId, items, comments);
  if ("error" in result) return serviceErrorResponse(ctx, comments, ENDPOINT, "POST", result);

  const { results, reconciled, resetsAt } = result.data;
  const quotaUnits = comments.meter.total;
  logRequest(ctx, ENDPOINT, "POST", 200, quotaUnits);
  return NextResponse.json(
    apiSuccess({ results, reconciled, ...(resetsAt ? { resetsAt } : {}) }, { quotaUnits })
  );
}
