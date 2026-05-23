import { NextRequest, NextResponse } from "next/server";
import { eq, and, ne } from "drizzle-orm";
import { db } from "@/db";
import { apiKeys, apiRequestLog, member, youtubeChannels, youtubeVideos } from "@/db/schema";
import { hashApiKey } from "@/lib/api-keys";
import { decrypt } from "@/utils/encryption";
import {
  isYouTubeInvalidGrantError,
  refreshAccessToken,
} from "@/lib/clients/youtube";
import { encrypt } from "@/utils/encryption";

export interface ApiContext {
  userId: string;
  organizationId: string;
  apiKeyId: string;
  permission: "read" | "read-write";
}

/**
 * Authenticates a request using a Bearer API key.
 * Returns ApiContext on success, or a NextResponse error on failure.
 */
export async function withApiKey(
  request: NextRequest
): Promise<ApiContext | NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json(
      apiError(
        "MISSING_API_KEY",
        "Authorization header with Bearer token is required",
        "Include header: Authorization: Bearer vtk_your_key",
        401
      ),
      { status: 401 }
    );
  }

  const token = authHeader.slice(7);
  if (!token.startsWith("vtk_")) {
    return NextResponse.json(
      apiError(
        "INVALID_API_KEY",
        "API key must start with vtk_",
        "Generate a new key from Settings > API Keys",
        401
      ),
      { status: 401 }
    );
  }

  const keyHash = hashApiKey(token);

  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash));

  if (!key) {
    return NextResponse.json(
      apiError(
        "INVALID_API_KEY",
        "API key not found or has been revoked",
        "Generate a new key from Settings > API Keys",
        401
      ),
      { status: 401 }
    );
  }

  if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    return NextResponse.json(
      apiError(
        "API_KEY_EXPIRED",
        "This API key has expired",
        "Generate a new key from Settings > API Keys",
        401
      ),
      { status: 401 }
    );
  }

  // Defense in depth: after the backfill migration (0013) every key should
  // have a real organizationId. Reject rather than fall back to userId — a
  // userId UUID would never match a real organization id and would silently
  // 404 every request.
  if (!key.organizationId) {
    return NextResponse.json(
      apiError(
        "API_KEY_REISSUE_REQUIRED",
        "API key is not organization-scoped.",
        "Recreate this API key from your dashboard.",
        401
      ),
      { status: 401 }
    );
  }

  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.userId, key.userId),
        eq(member.organizationId, key.organizationId)
      )
    )
    .limit(1);

  if (!membership) {
    return NextResponse.json(
      apiError(
        "API_KEY_REISSUE_REQUIRED",
        "API key is orphaned from its organization.",
        "Ask an organization admin to reissue this API key.",
        401
      ),
      { status: 401 }
    );
  }

  // Fire-and-forget: update lastUsedAt only after the key is accepted.
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .then(() => {})
    .catch((err: unknown) => {
      console.error("Failed to update API key lastUsedAt:", err);
    });

  return {
    userId: key.userId,
    organizationId: key.organizationId,
    apiKeyId: key.id,
    permission: key.permission as "read" | "read-write",
  };
}

/**
 * Logs an API request to the apiRequestLog table (fire-and-forget).
 */
export function logRequest(
  ctx: ApiContext,
  endpoint: string,
  method: string,
  statusCode: number,
  quotaUnits: number = 0
): void {
  db.insert(apiRequestLog)
    .values({
      apiKeyId: ctx.apiKeyId,
      userId: ctx.userId,
      endpoint,
      method,
      statusCode,
      quotaUnits,
      source: "rest",
    })
    .then(() => {})
    .catch((err) => {
      console.error("Failed to log API request:", err);
    });
}

/**
 * Standard success response envelope.
 */
export function apiSuccess<T>(data: T, meta?: Record<string, unknown>) {
  return {
    data,
    error: null,
    ...(meta && { meta }),
  };
}

/**
 * Standard error response envelope.
 */
export function apiError(
  code: string,
  message: string,
  suggestion?: string,
  status: number = 400,
  meta?: Record<string, unknown>
) {
  return {
    data: null,
    error: {
      code,
      message,
      suggestion,
      status,
      ...(meta ? { meta } : {}),
    },
  };
}

/**
 * Returns a 403 response if the API key lacks write permission, or null if allowed.
 */
export function requireWriteAccess(ctx: ApiContext): NextResponse | null {
  if (ctx.permission === "read-write") return null;
  return NextResponse.json(
    apiError(
      "INSUFFICIENT_PERMISSIONS",
      "This API key has read-only access",
      "Create a new API key with read-write permission from Settings > API Keys",
      403
    ),
    { status: 403 }
  );
}

/**
 * Fetches a channel's OAuth tokens, decrypts them, and refreshes if expired.
 * Follows the same pattern as syncChannelVideos.ts.
 * Returns { accessToken, channelId } or an error response body.
 */
export async function getChannelTokens(
  channelId: string,
  userId: string,
  organizationId?: string
): Promise<
  | { accessToken: string; channelId: string; channelDbId: string }
  | { error: ReturnType<typeof apiError>; status: number }
> {
  const channelFilter = organizationId
    ? and(eq(youtubeChannels.channelId, channelId), eq(youtubeChannels.organizationId, organizationId))
    : and(eq(youtubeChannels.channelId, channelId), eq(youtubeChannels.userId, userId));
  const [channel] = await db
    .select()
    .from(youtubeChannels)
    .where(channelFilter);

  if (!channel) {
    return {
      error: apiError(
        "CHANNEL_NOT_FOUND",
        "Channel not found or not connected to your account",
        "Connect a YouTube channel from the dashboard first",
        404
      ),
      status: 404,
    };
  }

  if (!channel.accessTokenEncrypted || !channel.refreshTokenEncrypted) {
    return {
      error: apiError(
        "CHANNEL_NO_TOKENS",
        "Channel OAuth tokens are missing",
        "Reconnect your YouTube channel from the dashboard",
        400
      ),
      status: 400,
    };
  }

  if (channel.tokenStatus === "invalid") {
    return {
      error: apiError(
        "CHANNEL_TOKEN_INVALID",
        "Channel OAuth token has been revoked or expired",
        "Reconnect your YouTube channel from the dashboard",
        401
      ),
      status: 401,
    };
  }

  let accessToken = decrypt(channel.accessTokenEncrypted);
  const expiresAt = channel.tokenExpiresAt
    ? new Date(channel.tokenExpiresAt)
    : null;
  const now = new Date();
  const bufferTime = 5 * 60 * 1000; // 5 minutes

  // Refresh if expired or about to expire
  if (expiresAt && expiresAt.getTime() - now.getTime() < bufferTime) {
    const refreshToken = decrypt(channel.refreshTokenEncrypted);

    try {
      const newTokens = await refreshAccessToken(refreshToken);

      const newExpiresAt = new Date();
      newExpiresAt.setSeconds(
        newExpiresAt.getSeconds() + newTokens.expires_in
      );

      await db
        .update(youtubeChannels)
        .set({
          accessTokenEncrypted: encrypt(newTokens.access_token),
          tokenExpiresAt: newExpiresAt,
        })
        .where(eq(youtubeChannels.id, channel.id));

      accessToken = newTokens.access_token;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      const isTokenError =
        isYouTubeInvalidGrantError(error) ||
        errorMessage.includes("invalid_grant") ||
        errorMessage.includes("Token has been expired or revoked") ||
        errorMessage.includes("status 400");

      if (isTokenError) {
        await db
          .update(youtubeChannels)
          .set({ tokenStatus: "invalid" })
          .where(eq(youtubeChannels.id, channel.id));

        return {
          error: apiError(
            "CHANNEL_TOKEN_INVALID",
            "Channel OAuth token has been revoked. Please reconnect.",
            "Reconnect your YouTube channel from the dashboard",
            401
          ),
          status: 401,
        };
      }

      return {
        error: apiError(
          "TOKEN_REFRESH_FAILED",
          `Failed to refresh access token: ${errorMessage}`,
          "Try again later or reconnect your channel",
          500
        ),
        status: 500,
      };
    }
  }

  return { accessToken, channelId: channel.channelId, channelDbId: channel.id };
}

/**
 * Returns a valid OAuth token from ANY channel the user/org owns.
 * Used when we need YouTube API access but don't require ownership of a specific channel.
 */
export async function getAnyUserToken(
  userId: string,
  organizationId?: string
): Promise<
  | { accessToken: string; channelId: string; channelDbId: string }
  | { error: ReturnType<typeof apiError>; status: number }
> {
  const ownerFilter = organizationId
    ? eq(youtubeChannels.organizationId, organizationId)
    : eq(youtubeChannels.userId, userId);

  const [channel] = await db
    .select({ channelId: youtubeChannels.channelId })
    .from(youtubeChannels)
    .where(and(ownerFilter, ne(youtubeChannels.tokenStatus, "invalid")))
    .limit(1);

  if (!channel) {
    return {
      error: apiError(
        "NO_CONNECTED_CHANNEL",
        "No connected YouTube channel found",
        "Connect at least one YouTube channel from the dashboard to use this feature",
        400
      ),
      status: 400,
    };
  }

  // Delegate to getChannelTokens for decrypt + refresh logic
  return getChannelTokens(channel.channelId, userId, organizationId);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a video by either VidTempla UUID or YouTube video ID.
 * Returns a discriminated result:
 * - `{ found: true, video }` — owned by the caller
 * - `{ found: false, reason: "not_owned" }` — exists but on an unconnected channel
 * - `{ found: false, reason: "not_found" }` — doesn't exist in the DB at all
 */
export type ResolveVideoResult =
  | { found: true; video: { id: string; videoId: string; channelId: string; containerId: string | null; channelYoutubeId: string } }
  | { found: false; reason: "not_owned" | "not_found" };

export async function resolveVideo(
  id: string,
  userId: string,
  organizationId?: string
): Promise<ResolveVideoResult> {
  const isUUID = UUID_REGEX.test(id);
  const idFilter = isUUID ? eq(youtubeVideos.id, id) : eq(youtubeVideos.videoId, id);

  const ownerFilter = organizationId
    ? eq(youtubeChannels.organizationId, organizationId)
    : eq(youtubeChannels.userId, userId);

  const selectCols = {
    id: youtubeVideos.id,
    videoId: youtubeVideos.videoId,
    channelId: youtubeVideos.channelId,
    containerId: youtubeVideos.containerId,
    channelYoutubeId: youtubeChannels.channelId,
  };

  const [video] = await db
    .select(selectCols)
    .from(youtubeVideos)
    .innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.id))
    .where(and(idFilter, ownerFilter));

  if (video) return { found: true, video };

  // Only on failure path: check if the video exists on any channel
  const [exists] = await db
    .select({ id: youtubeVideos.id })
    .from(youtubeVideos)
    .where(idFilter)
    .limit(1);

  return { found: false, reason: exists ? "not_owned" : "not_found" };
}

/**
 * Returns a standard error object for resolveVideo failures.
 */
export function videoNotFoundError(reason: "not_owned" | "not_found") {
  if (reason === "not_owned") {
    return {
      code: "VIDEO_NOT_OWNED" as const,
      message: "This video belongs to a channel not connected to your account",
      suggestion: "Connect the channel that owns this video to access other features.",
      status: 403,
    };
  }
  return {
    code: "VIDEO_NOT_FOUND" as const,
    message: "Video not found",
    suggestion: "Check the video ID is correct, or the video may not have been synced yet — try syncing the channel first.",
    status: 404,
  };
}
