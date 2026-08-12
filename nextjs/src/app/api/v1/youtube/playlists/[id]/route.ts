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
 * GET /api/v1/youtube/playlists/[id]?channelId=...
 * Get playlist details
 * Quota cost: 1 unit
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");

  if (!channelId) {
    await logRequest(ctx, `/youtube/playlists/${id}`, "GET", 400, 0);
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

  const tokens = await getChannelTokens(channelId, ctx.userId, ctx.organizationId);
  if ("error" in tokens) {
    await logRequest(ctx, `/youtube/playlists/${id}`, "GET", tokens.status, 0);
    return NextResponse.json(tokens.error, { status: tokens.status });
  }

  try {
    const response = await axios.get(`${YOUTUBE_API_BASE}/playlists`, {
      params: {
        part: "snippet,contentDetails,status",
        id,
      },
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    const playlist = response.data.items?.[0];
    if (!playlist) {
      await logRequest(ctx, `/youtube/playlists/${id}`, "GET", 404, 1);
      return NextResponse.json(
        apiError(
          "NOT_FOUND",
          "Playlist not found",
          "Check the playlist ID is correct",
          404
        ),
        { status: 404 }
      );
    }

    await logRequest(ctx, `/youtube/playlists/${id}`, "GET", 200, 1);
    return NextResponse.json(apiSuccess(playlist, { quotaUnits: 1 }));
  } catch (error) {
    const mapped = mapYouTubeError(error);
    await logRequest(ctx, `/youtube/playlists/${id}`, "GET", mapped.status, 1);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/**
 * PATCH /api/v1/youtube/playlists/[id]
 * Update a playlist
 * Body: { channelId, title?, description?, privacyStatus? }
 * Quota cost: 50 units
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;
  const writeCheck = requireWriteAccess(ctx);
  if (writeCheck) return writeCheck;

  const { id } = await params;

  let body: {
    channelId?: string;
    title?: string;
    description?: string;
    privacyStatus?: string;
  };
  try {
    body = await request.json();
  } catch {
    await logRequest(ctx, `/youtube/playlists/${id}`, "PATCH", 400, 0);
    return NextResponse.json(
      apiError(
        "INVALID_BODY",
        "Request body must be valid JSON",
        "Send a JSON body with { channelId, title?, description?, privacyStatus? }",
        400
      ),
      { status: 400 }
    );
  }

  const { channelId, title, description, privacyStatus } = body;

  if (!channelId) {
    await logRequest(ctx, `/youtube/playlists/${id}`, "PATCH", 400, 0);
    return NextResponse.json(
      apiError(
        "MISSING_PARAMETER",
        "channelId is required",
        "Provide channelId in the request body",
        400
      ),
      { status: 400 }
    );
  }

  const tokens = await getChannelTokens(channelId, ctx.userId, ctx.organizationId);
  if ("error" in tokens) {
    await logRequest(ctx, `/youtube/playlists/${id}`, "PATCH", tokens.status, 0);
    return NextResponse.json(tokens.error, { status: tokens.status });
  }

  // First fetch the current playlist to preserve fields not being updated
  try {
    const current = await axios.get(`${YOUTUBE_API_BASE}/playlists`, {
      params: { part: "snippet,status", id },
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    const existing = current.data.items?.[0];
    if (!existing) {
      await logRequest(ctx, `/youtube/playlists/${id}`, "PATCH", 404, 1);
      return NextResponse.json(
        apiError(
          "NOT_FOUND",
          "Playlist not found",
          "Check the playlist ID is correct",
          404
        ),
        { status: 404 }
      );
    }

    const response = await axios.put(
      `${YOUTUBE_API_BASE}/playlists`,
      {
        id,
        snippet: {
          title: title || existing.snippet.title,
          description:
            description !== undefined
              ? description
              : existing.snippet.description,
        },
        status: {
          privacyStatus: privacyStatus || existing.status.privacyStatus,
        },
      },
      {
        params: { part: "snippet,status" },
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    await logRequest(ctx, `/youtube/playlists/${id}`, "PATCH", 200, 50);
    return NextResponse.json(apiSuccess(response.data, { quotaUnits: 50 }));
  } catch (error) {
    const mapped = mapYouTubeError(error);
    await logRequest(ctx, `/youtube/playlists/${id}`, "PATCH", mapped.status, 50);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

/**
 * DELETE /api/v1/youtube/playlists/[id]?channelId=...
 * Delete a playlist
 * Requires the owner or admin role — same as the dashboard.
 * Quota cost: 50 units
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await withApiKey(request);
  if (ctx instanceof NextResponse) return ctx;
  const writeCheck = requireWriteAccess(ctx);
  if (writeCheck) return writeCheck;

  const { id } = await params;
  const roleCheck = requireOrgAdmin(ctx, `/youtube/playlists/${id}`, "DELETE");
  if (roleCheck) return roleCheck;

  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channelId");

  if (!channelId) {
    await logRequest(ctx, `/youtube/playlists/${id}`, "DELETE", 400, 0);
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
    await logRequest(ctx, `/youtube/playlists/${id}`, "DELETE", tokens.status, 0);
    return NextResponse.json(tokens.error, { status: tokens.status });
  }

  try {
    await axios.delete(`${YOUTUBE_API_BASE}/playlists`, {
      params: { id },
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    await logRequest(ctx, `/youtube/playlists/${id}`, "DELETE", 200, 50);
    return NextResponse.json(apiSuccess({ deleted: true }, { quotaUnits: 50 }));
  } catch (error) {
    const mapped = mapYouTubeError(error);
    await logRequest(ctx, `/youtube/playlists/${id}`, "DELETE", mapped.status, 50);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
