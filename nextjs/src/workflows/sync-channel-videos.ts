import { FatalError } from "workflow";
import { db } from "@/db";
import {
  youtubeChannels,
  youtubeVideos,
  descriptionHistory,
} from "@/db/schema";
import { eq, and, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { decrypt, encrypt } from "@/utils/encryption";
import {
  isYouTubeInvalidGrantError,
  isYouTubeQuotaError,
  refreshAccessToken,
  fetchChannelVideos,
  fetchChannelInfo,
  getUploadsPlaylistId,
} from "@/lib/clients/youtube";
import { detectAndRecordDrift } from "@/lib/services/drift";
import {
  isYouTubeQuotaExhausted,
  markYouTubeQuotaExhausted,
} from "@/lib/services/quota-guard";

const DESCRIPTION_PUSH_DELETE_GRACE_MS = 2 * 60 * 1000;
const SYNC_LOCK_STALE_AFTER_MS = 6 * 60 * 60 * 1000;
const SYNC_LOCK_HEARTBEAT_EVERY_VIDEOS = 50;

export async function syncChannelVideosWorkflow(
  channelId: string,
  userId: string,
  organizationId?: string
) {
  "use workflow";

  return await runSyncChannelVideos(channelId, userId, organizationId);
}

async function markSyncFailed(
  channelId: string,
  userId: string,
  err: unknown,
  organizationId?: string
) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  console.error("[sync-channel-videos] failed", { channelId, error: errorMessage });

  const isTokenError =
    isYouTubeInvalidGrantError(err) ||
    errorMessage.includes("invalid_grant") ||
    errorMessage.includes("Token has been expired or revoked") ||
    errorMessage.includes("Failed to refresh access token");

  const ownerFilter = organizationId
    ? eq(youtubeChannels.organizationId, organizationId)
    : eq(youtubeChannels.userId, userId);

  await db
    .update(youtubeChannels)
    .set({
      syncStatus: "idle",
      ...(isTokenError && { tokenStatus: "invalid" }),
    })
    .where(
      and(
        eq(youtubeChannels.id, channelId),
        ownerFilter,
        eq(youtubeChannels.syncStatus, "syncing")
      )
    );
}

async function runSyncChannelVideos(
  channelId: string,
  userId: string,
  organizationId?: string
) {
  "use step";

  // Quota circuit breaker: a sync is a background read and the lowest-priority
  // consumer. If the quota is already known-exhausted, skip without touching
  // YouTube so we don't burn the remaining headroom (reserved for user writes).
  if (await isYouTubeQuotaExhausted()) {
    console.log(
      `[sync-channel-videos] YouTube quota exhausted — skipping sync for channel ${channelId}`
    );
    return {
      success: true,
      skipped: true,
      reason: "quota_exhausted",
      channelId,
      videosProcessed: 0,
      newVideos: 0,
      deletedVideos: 0,
    };
  }

  const syncStartedAt = new Date();
  const deleteUpdatedBefore = new Date(
    syncStartedAt.getTime() - DESCRIPTION_PUSH_DELETE_GRACE_MS
  );
  const staleSyncCutoff = new Date(
    Date.now() - SYNC_LOCK_STALE_AFTER_MS
  );
  const ownerFilter = organizationId
    ? eq(youtubeChannels.organizationId, organizationId)
    : eq(youtubeChannels.userId, userId);

  // Atomic compare-and-set: claim the channel only if it's not already syncing.
  // Prevents two overlapping runs (cron retry, deploy-time double-fire, or
  // cron + manual trigger) from both proceeding and double-inserting drift /
  // history rows and burning YouTube quota twice. updatedAt is trigger-managed,
  // so it is safe as a stale-age signal but not as a lock token.
  const claimed = await db
    .update(youtubeChannels)
    .set({ syncStatus: "syncing" })
    .where(
      and(
        eq(youtubeChannels.id, channelId),
        ownerFilter,
        or(
          ne(youtubeChannels.syncStatus, "syncing"),
          lt(youtubeChannels.updatedAt, staleSyncCutoff)
        )
      )
    )
    .returning({ id: youtubeChannels.id });

  if (claimed.length === 0) {
    const [channel] = await db
      .select({ id: youtubeChannels.id })
      .from(youtubeChannels)
      .where(
        and(
          eq(youtubeChannels.id, channelId),
          ownerFilter
        )
      );

    if (!channel) {
      throw new Error("Channel not found");
    }

    console.log(
      `[sync-channel-videos] Sync already in progress for channel ${channelId}, skipping`
    );
    return {
      success: true,
      skipped: true,
      channelId,
      videosProcessed: 0,
      newVideos: 0,
      deletedVideos: 0,
    };
  }

  try {
    return await syncClaimedChannelVideos(
      channelId,
      userId,
      ownerFilter,
      deleteUpdatedBefore
    );
  } catch (err) {
    await markSyncFailed(channelId, userId, err, organizationId);
    // Daily quota exhaustion can never succeed on retry — trip the breaker
    // (which alerts the operator once) and stop the 3x workflow retries.
    if (isYouTubeQuotaError(err)) {
      await markYouTubeQuotaExhausted();
      throw new FatalError(
        "YouTube Data API daily quota exhausted — not retrying until reset"
      );
    }
    throw err;
  }
}

async function syncClaimedChannelVideos(
  channelId: string,
  userId: string,
  ownerFilter: ReturnType<typeof eq>,
  deleteUpdatedBefore: Date
) {
  const [channel] = await db
    .select()
    .from(youtubeChannels)
    .where(
      and(
        eq(youtubeChannels.id, channelId),
        ownerFilter
      )
    );

  if (!channel) {
    throw new Error("Channel not found");
  }

  let accessToken: string;
  if (!channel.accessTokenEncrypted || !channel.refreshTokenEncrypted) {
    throw new Error("Channel tokens not found");
  }

  const currentAccessToken = decrypt(channel.accessTokenEncrypted);
  const expiresAt = channel.tokenExpiresAt
    ? new Date(channel.tokenExpiresAt)
    : null;
  const now = new Date();
  const bufferTime = 5 * 60 * 1000;

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
        .where(eq(youtubeChannels.id, channelId));

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
          .set({
            tokenStatus: "invalid",
            syncStatus: "idle",
          })
          .where(
            and(
              eq(youtubeChannels.id, channelId),
              ownerFilter,
              eq(youtubeChannels.syncStatus, "syncing")
            )
          );

        throw new FatalError(
          `Token invalid for channel ${channel.channelId} (${channel.title || "Unknown"}). ` +
            `Please re-authenticate. Error: ${errorMessage}`
        );
      }

      throw new Error(
        `Failed to refresh access token for channel ${channel.channelId} (DB ID: ${channelId}). ` +
          `Channel: ${channel.title || "Unknown"}. ` +
          `Error: ${errorMessage}`
      );
    }
  } else {
    accessToken = currentAccessToken;
  }

  try {
    const channelInfo = await fetchChannelInfo(accessToken);

    await db
      .update(youtubeChannels)
      .set({
        title: channelInfo.snippet.title,
        thumbnailUrl: channelInfo.snippet.thumbnails.default.url,
        subscriberCount: parseInt(
          channelInfo.statistics.subscriberCount || "0",
          10
        ),
      })
      .where(eq(youtubeChannels.id, channelId));
  } catch (error) {
    console.error("[sync-channel-videos] failed to update channel info", { error });
  }

  const uploadsPlaylistId = await getUploadsPlaylistId(
    channel.channelId,
    accessToken
  );

  const allVideos: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      publishedAt: string;
    };
  }> = [];
  let pageToken: string | undefined = undefined;

  do {
    const response = await fetchChannelVideos(
      channel.channelId,
      accessToken,
      pageToken,
      uploadsPlaylistId
    );

    allVideos.push(...response.videos);
    pageToken = response.nextPageToken;
    await heartbeatSyncLock(channelId, ownerFilter);
  } while (pageToken);

  const videoIds = allVideos.map((v) => v.id);
  const isBaseline = channel.driftBaselinedAt === null;

  const existingVideos = await db
    .select({
      id: youtubeVideos.id,
      videoId: youtubeVideos.videoId,
      renderVersion: youtubeVideos.renderVersion,
      updatedAt: youtubeVideos.updatedAt,
      descriptionPushReservedUntil: youtubeVideos.descriptionPushReservedUntil,
    })
    .from(youtubeVideos)
    .where(eq(youtubeVideos.channelId, channelId));

  const existingVideoMap = new Map(existingVideos.map((v) => [v.videoId, v]));

  let newVideosAdded = 0;
  let videosSinceHeartbeat = 0;

  for (const ytVideo of allVideos) {
    const videoId = ytVideo.id;
    const existingVideo = existingVideoMap.get(videoId);

    if (!existingVideo) {
      const [insertedVideo] = await db
        .insert(youtubeVideos)
        .values({
          channelId: channelId,
          videoId: videoId,
          title: ytVideo.snippet.title,
          currentDescription: ytVideo.snippet.description,
          publishedAt: new Date(ytVideo.snippet.publishedAt),
        })
        .returning();

      if (insertedVideo) {
        newVideosAdded++;
        await db.insert(descriptionHistory).values({
          videoId: insertedVideo.id,
          description: ytVideo.snippet.description || "",
          versionNumber: 1,
          renderSnapshot: null,
          createdBy: userId,
          source: "initial_sync",
        });
      }
      videosSinceHeartbeat++;
      if (videosSinceHeartbeat >= SYNC_LOCK_HEARTBEAT_EVERY_VIDEOS) {
        await heartbeatSyncLock(channelId, ownerFilter);
        videosSinceHeartbeat = 0;
      }
      continue;
    }

    await db
      .update(youtubeVideos)
      .set({
        title: ytVideo.snippet.title,
        publishedAt: new Date(ytVideo.snippet.publishedAt),
        updatedAt: new Date(),
      })
      .where(eq(youtubeVideos.id, existingVideo.id));

    if (isBaseline) {
      await db
        .update(youtubeVideos)
        .set({ currentDescription: ytVideo.snippet.description, updatedAt: new Date() })
        .where(eq(youtubeVideos.id, existingVideo.id));
    } else {
      await db.transaction(async (tx) => {
        await detectAndRecordDrift(existingVideo.id, ytVideo.snippet.description, userId, tx);
      });
    }

    videosSinceHeartbeat++;
    if (videosSinceHeartbeat >= SYNC_LOCK_HEARTBEAT_EVERY_VIDEOS) {
      await heartbeatSyncLock(channelId, ownerFilter);
      videosSinceHeartbeat = 0;
    }
  }

  const videosToDelete = Array.from(existingVideoMap.values()).filter(
    (video) => !videoIds.includes(video.videoId)
  );

  if (videosToDelete.length > 0) {
    for (const video of videosToDelete) {
      const deleted = await db
        .delete(youtubeVideos)
        .where(
          and(
            eq(youtubeVideos.videoId, video.videoId),
            eq(youtubeVideos.channelId, channelId),
            eq(youtubeVideos.renderVersion, video.renderVersion),
            lt(youtubeVideos.updatedAt, deleteUpdatedBefore),
            sql`(${youtubeVideos.descriptionPushReservedUntil} is null or ${youtubeVideos.descriptionPushReservedUntil} <= now())`
          )
        )
        .returning({ id: youtubeVideos.id });

      if (deleted.length === 0) {
        console.warn("[sync-channel-videos] skipped deleting changed video row", {
          channelId,
          videoId: video.videoId,
          renderVersion: video.renderVersion,
          updatedAt: video.updatedAt,
          descriptionPushReservedUntil: video.descriptionPushReservedUntil,
        });
      }
    }
  }

  if (isBaseline) {
    await db
      .update(youtubeChannels)
      .set({ driftBaselinedAt: new Date() })
      .where(
        and(
          eq(youtubeChannels.id, channelId),
          isNull(youtubeChannels.driftBaselinedAt)
        )
      );
  }

  await db
    .update(youtubeChannels)
    .set({
      lastSyncedAt: new Date(),
      syncStatus: "idle",
    })
    .where(
      and(
        eq(youtubeChannels.id, channelId),
        ownerFilter,
        eq(youtubeChannels.syncStatus, "syncing")
      )
    );

  return {
    success: true,
    channelId,
    videosProcessed: allVideos.length,
    newVideos: newVideosAdded,
    deletedVideos: videosToDelete.length,
  };
}

async function heartbeatSyncLock(
  channelId: string,
  ownerFilter: ReturnType<typeof eq>
) {
  // Keep trigger-managed updatedAt fresh while a long sync is still making
  // progress, so the stale-lock escape only recovers genuinely abandoned runs.
  const touched = await db
    .update(youtubeChannels)
    .set({ syncStatus: "syncing" })
    .where(
      and(
        eq(youtubeChannels.id, channelId),
        ownerFilter,
        eq(youtubeChannels.syncStatus, "syncing")
      )
    )
    .returning({ id: youtubeChannels.id });

  if (touched.length === 0) {
    throw new Error(`Sync lock lost for channel ${channelId}`);
  }
}
