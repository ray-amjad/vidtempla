import { NextRequest, NextResponse } from "next/server";
import {
  withApiKey,
  requireWriteAccess,
  requireOrgAdmin,
  apiSuccess,
  apiError,
  getChannelTokens,
  logRequest,
} from "@/lib/api-auth";
import { mapYouTubeError } from "@/lib/youtube-errors";
import axios from "axios";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

/**
 * DELETE /api/v1/youtube/playlists/[id]/items/[itemId]?channelId=...
 * Remove an item from a playlist
 * Requires the owner or admin role — same as the dashboard.
 * Quota cost: 50 units
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;
  const writeCheck = requireWriteAccess(ctx);
  if (writeCheck) return writeCheck;

  const { id, itemId } = await params;
  const roleCheck = requireOrgAdmin(
    ctx,
    `/youtube/playlists/${id}/items/${itemId}`,
    "DELETE"
  );
  if (roleCheck) return roleCheck;

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");

  if (!channelId) {
    await logRequest(
      ctx,
      `/youtube/playlists/${id}/items/${itemId}`,
      "DELETE",
      400,
      0
    );
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

  const tokens = await getChannelTokens(channelId, ctx.userId, ctx.organizationId);
  if ("error" in tokens) {
    await logRequest(
      ctx,
      `/youtube/playlists/${id}/items/${itemId}`,
      "DELETE",
      tokens.status,
      0
    );
    return NextResponse.json(tokens.error, { status: tokens.status });
  }

  try {
    await axios.delete(`${YOUTUBE_API_BASE}/playlistItems`, {
      params: { id: itemId },
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    await logRequest(
      ctx,
      `/youtube/playlists/${id}/items/${itemId}`,
      "DELETE",
      200,
      50
    );
    return NextResponse.json(apiSuccess({ deleted: true }, { quotaUnits: 50 }));
  } catch (error) {
    const mapped = mapYouTubeError(error);
    await logRequest(
      ctx,
      `/youtube/playlists/${id}/items/${itemId}`,
      "DELETE",
      mapped.status,
      50
    );
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
