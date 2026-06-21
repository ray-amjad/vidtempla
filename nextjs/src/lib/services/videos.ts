import {
  eq,
  and,
  or,
  desc,
  asc,
  ilike,
  isNull,
  isNotNull,
  lt,
  gt,
  count,
  inArray,
  sql,
  getTableColumns,
  type SQL,
} from "drizzle-orm";
import { db, DB_POOL_MAX } from "@/db";
import {
  youtubeVideos,
  youtubeChannels,
  containers,
  templates,
  videoVariables,
  videoVariableEvents,
  descriptionHistory,
} from "@/db/schema";
import {
  getChannelTokens,
  getAnyUserToken,
  resolveVideo,
  videoNotFoundError,
} from "@/lib/api-auth";
import {
  fetchChannelVideos,
  fetchVideoDetails,
  fetchVideoAnalytics,
  fetchVideoRetention,
  resolveChannelId,
  updateVideoDescription,
  getChannelAccessToken,
} from "@/lib/clients/youtube";
import { parseUserVariables, buildDescription } from "@/utils/templateParser";
import { checkVideoLimit } from "@/lib/plan-limits";
import { start } from "workflow/api";
import { updateVideoDescriptionsWorkflow, type PushPayload } from "@/workflows/update-video-descriptions";
import type { ServiceResult, PaginationMeta } from "./types";
import { assertNoDrift, detectAndRecordDrift } from "./drift";
import {
  decodeCompositeCursor,
  encodeCompositeCursor,
  isEncodedCompositeCursor,
  isValidCursorId,
} from "./cursors";

const DESCRIPTION_PUSH_RESERVATION_MS = 2 * 60 * 1000;

export interface ListVideosOpts {
  channelId?: string;
  containerId?: string;
  search?: string;
  unassigned?: boolean;
  sort?: string;
  cursor?: string;
  limit?: number;
  hasDrift?: boolean;
}

async function syncOwnedChannelVideos(
  channelYoutubeId: string,
  userId: string,
  organizationId?: string,
  lockedChannelDbId?: string
) {
  try {
    const tokens = await getChannelTokens(channelYoutubeId, userId, organizationId);
    if ("error" in tokens) {
      return false;
    }

    const [channel] = await db
      .select({
        id: youtubeChannels.id,
        driftBaselinedAt: youtubeChannels.driftBaselinedAt,
      })
      .from(youtubeChannels)
      .where(eq(youtubeChannels.id, tokens.channelDbId));

    if (!channel) return true;

    const isBaseline = channel.driftBaselinedAt === null;
    let nextPageToken: string | undefined;

    do {
      const page = await fetchChannelVideos(channelYoutubeId, tokens.accessToken, nextPageToken);

      if (page.videos.length > 0) {
        const pageVideoIds = page.videos.map((v) => v.id);

        // Batch-fetch all existing videos for this page in a single query (replaces the per-video SELECT).
        const existingRows = await db
          .select({ id: youtubeVideos.id, videoId: youtubeVideos.videoId })
          .from(youtubeVideos)
          .where(
            and(
              eq(youtubeVideos.channelId, tokens.channelDbId),
              inArray(youtubeVideos.videoId, pageVideoIds)
            )
          );
        const byVideoId = new Map(existingRows.map((row) => [row.videoId, row]));

        // Classify each video in the page into inserts vs. updates (drift handling stays inside the txn).
        const toInsert: (typeof youtubeVideos.$inferInsert)[] = [];
        const toUpdate: Array<{
          id: string;
          title: string;
          description: string;
          publishedAt: Date;
        }> = [];
        for (const v of page.videos) {
          const existing = byVideoId.get(v.id);
          if (!existing) {
            toInsert.push({
              channelId: tokens.channelDbId,
              videoId: v.id,
              title: v.snippet.title,
              currentDescription: v.snippet.description,
              publishedAt: new Date(v.snippet.publishedAt),
            });
          } else {
            toUpdate.push({
              id: existing.id,
              title: v.snippet.title,
              description: v.snippet.description,
              publishedAt: new Date(v.snippet.publishedAt),
            });
          }
        }

        // Single transaction per page: batched insert for new videos, then per-existing update + drift detection.
        await db.transaction(async (tx) => {
          if (toInsert.length > 0) {
            const insertedRows = await tx
              .insert(youtubeVideos)
              .values(toInsert)
              .returning({ id: youtubeVideos.id, description: youtubeVideos.currentDescription });

            if (insertedRows.length > 0) {
              await tx.insert(descriptionHistory).values(
                insertedRows.map((row) => ({
                  videoId: row.id,
                  description: row.description ?? "",
                  versionNumber: 1,
                  renderSnapshot: null,
                  createdBy: userId,
                  source: "initial_sync" as const,
                }))
              );
            }
          }

          const now = new Date();
          for (const u of toUpdate) {
            await tx
              .update(youtubeVideos)
              .set({
                title: u.title,
                publishedAt: u.publishedAt,
                updatedAt: now,
              })
              .where(eq(youtubeVideos.id, u.id));

            if (isBaseline) {
              await tx
                .update(youtubeVideos)
                .set({ currentDescription: u.description, updatedAt: now })
                .where(eq(youtubeVideos.id, u.id));
            } else {
              await detectAndRecordDrift(u.id, u.description, userId, tx);
            }
          }
        });
      }

      nextPageToken = page.nextPageToken;
    } while (nextPageToken);

    const syncedAt = new Date();
    if (isBaseline) {
      await db
        .update(youtubeChannels)
        .set({ driftBaselinedAt: syncedAt })
        .where(
          and(
            eq(youtubeChannels.id, tokens.channelDbId),
            isNull(youtubeChannels.driftBaselinedAt)
          )
        );
    }

    await db
      .update(youtubeChannels)
      .set({ lastSyncedAt: syncedAt })
      .where(eq(youtubeChannels.id, tokens.channelDbId));
  } catch (err) {
    // YouTube sync failed — fall through to DB query with stale data
    console.warn("[videos] syncOwnedChannelVideos failed (serving stale data):", err);
  } finally {
    if (lockedChannelDbId) {
      await db
        .update(youtubeChannels)
        .set({ syncStatus: "idle" })
        .where(
          and(
            eq(youtubeChannels.id, lockedChannelDbId),
            eq(youtubeChannels.syncStatus, LIST_VIDEOS_SYNC_STATUS)
          )
        );
    }
  }

  return true;
}

// Throttle inline sync inside listVideos so each REST call doesn't repaginate
// the entire YouTube uploads playlist. The cron + manual triggers handle freshness.
const LIST_VIDEOS_SYNC_STALE_MS = 5 * 60 * 1000;
const LIST_VIDEOS_SYNC_STATUS = "list_syncing";

async function tryAcquireListVideosSyncLock(channelDbId: string) {
  const staleBefore = new Date(Date.now() - LIST_VIDEOS_SYNC_STALE_MS);
  const [lockedChannel] = await db
    .update(youtubeChannels)
    .set({ syncStatus: LIST_VIDEOS_SYNC_STATUS })
    .where(
      and(
        eq(youtubeChannels.id, channelDbId),
        eq(youtubeChannels.syncStatus, "idle"),
        or(
          isNull(youtubeChannels.lastSyncedAt),
          lt(youtubeChannels.lastSyncedAt, staleBefore)
        )
      )
    )
    .returning({ id: youtubeChannels.id });

  return !!lockedChannel;
}

export async function listVideos(
  userId: string,
  opts: ListVideosOpts,
  organizationId?: string
): Promise<ServiceResult<{ data: any[]; meta: PaginationMeta; source: "db" | "youtube" }>> {
  try {
    if (opts.channelId && !/^UC[\w-]{22}$/.test(opts.channelId)) {
      const anyToken = await getAnyUserToken(userId, organizationId);
      if ("error" in anyToken) {
        return {
          error: {
            code: anyToken.error.error.code,
            message: anyToken.error.error.message,
            suggestion: anyToken.error.error.suggestion ?? "",
            status: anyToken.status,
          },
        };
      }
      try {
        opts.channelId = await resolveChannelId(opts.channelId, anyToken.accessToken);
      } catch (e) {
        return {
          error: {
            code: "INVALID_CHANNEL",
            message: e instanceof Error ? e.message : "Failed to resolve channel",
            suggestion: "Pass a UC... channel ID, @handle, or YouTube channel URL",
            status: 400,
          },
        };
      }
    }

    let isOwned = false;
    if (opts.channelId) {
      // Look up the connected channel row scoped to user/org. Existence here
      // implies ownership; we then decide whether to refresh from YouTube based
      // on lastSyncedAt and syncStatus instead of syncing on every list call.
      const channelOwnerFilter = organizationId
        ? and(
            eq(youtubeChannels.channelId, opts.channelId),
            eq(youtubeChannels.organizationId, organizationId)
          )
        : and(
            eq(youtubeChannels.channelId, opts.channelId),
            eq(youtubeChannels.userId, userId)
          );

      const [ownedChannel] = await db
        .select({
          id: youtubeChannels.id,
          lastSyncedAt: youtubeChannels.lastSyncedAt,
          syncStatus: youtubeChannels.syncStatus,
        })
        .from(youtubeChannels)
        .where(channelOwnerFilter)
        .limit(1);

      if (ownedChannel) {
        const stale =
          !ownedChannel.lastSyncedAt ||
          Date.now() - ownedChannel.lastSyncedAt.getTime() > LIST_VIDEOS_SYNC_STALE_MS;
        const syncIdle = ownedChannel.syncStatus === "idle";

        if (stale && syncIdle) {
          const lockAcquired = await tryAcquireListVideosSyncLock(
            ownedChannel.id
          );
          if (lockAcquired) {
            await syncOwnedChannelVideos(
              opts.channelId,
              userId,
              organizationId,
              ownedChannel.id
            );
          }
        }

        // Connected channel ownership does not depend on whether the opportunistic
        // refresh succeeded; token/Youtube failures should still serve cached DB data.
        isOwned = true;
      }
    }

    if (opts.channelId && !isOwned) {
      const anyToken = await getAnyUserToken(userId, organizationId);
      if ("error" in anyToken) {
        return {
          error: {
            code: anyToken.error.error.code,
            message: anyToken.error.error.message,
            suggestion: anyToken.error.error.suggestion ?? "",
            status: anyToken.status,
          },
        };
      }

      const limit = Math.min(opts.limit ?? 50, 100);
      const videos: Array<{
        videoId: string;
        title: string;
        currentDescription: string;
        publishedAt: string;
        driftDetectedAt: null;
        containerId: null;
        container: null;
        channel: { id: null; channelId: string; title: null };
      }> = [];
      let nextPageToken: string | undefined;

      do {
        const page = await fetchChannelVideos(opts.channelId, anyToken.accessToken, nextPageToken);
        for (const v of page.videos) {
          videos.push({
            videoId: v.id,
            title: v.snippet.title,
            currentDescription: v.snippet.description,
            publishedAt: v.snippet.publishedAt,
            driftDetectedAt: null,
            containerId: null,
            container: null,
            channel: { id: null, channelId: opts.channelId, title: null },
          });
        }
        nextPageToken = page.nextPageToken;
      } while (nextPageToken && videos.length < limit);

      const items = videos.slice(0, limit);
      const hasMore = videos.length > limit || !!nextPageToken;

      return {
        data: {
          data: items,
          meta: { cursor: undefined, hasMore, total: null },
          source: "youtube",
        },
      };
    }

    const limit = Math.min(opts.limit ?? 50, 100);
    const sortParam = opts.sort ?? "publishedAt:desc";
    const ownerFilter = organizationId
      ? eq(youtubeChannels.organizationId, organizationId)
      : eq(youtubeChannels.userId, userId);
    const filters = [ownerFilter] as any[];

    if (opts.channelId) filters.push(eq(youtubeChannels.channelId, opts.channelId));
    if (opts.containerId) filters.push(eq(youtubeVideos.containerId, opts.containerId));
    if (opts.search) filters.push(ilike(youtubeVideos.title, `%${opts.search}%`));
    if (opts.unassigned) filters.push(isNull(youtubeVideos.containerId));
    if (opts.hasDrift === true) filters.push(isNotNull(youtubeVideos.driftDetectedAt));
    if (opts.hasDrift === false) filters.push(isNull(youtubeVideos.driftDetectedAt));

    const [sortField, sortDir] = sortParam.split(":");
    const activeSortField = sortField === "title" ? "title" : "publishedAt";
    const activeSortDir = sortDir === "asc" ? "asc" : "desc";
    const isAsc = activeSortDir === "asc";
    const isTitleSort = activeSortField === "title";

    if (opts.cursor) {
      if (isEncodedCompositeCursor(opts.cursor)) {
        const cursor = decodeCompositeCursor(opts.cursor);
        if (
          !cursor ||
          cursor.scope !== "videos" ||
          cursor.sort !== activeSortField ||
          cursor.dir !== activeSortDir ||
          !isValidCursorId(cursor.id)
        ) {
          return invalidCursor();
        }

        const idCmp = isAsc ? gt : lt;
        let primary: SQL | undefined;
        let tieEq: SQL;
        if (isTitleSort) {
          if (cursor.key === null) {
            filters.push(and(isNull(youtubeVideos.title), idCmp(youtubeVideos.id, cursor.id))!);
            primary = undefined;
          } else {
            primary = isAsc
              ? gt(youtubeVideos.title, cursor.key)
              : lt(youtubeVideos.title, cursor.key);
            tieEq = eq(youtubeVideos.title, cursor.key);
            filters.push(
              or(primary, isNull(youtubeVideos.title), and(tieEq, idCmp(youtubeVideos.id, cursor.id)))!
            );
          }
        } else {
          const cursorDate = parseCursorDate(cursor.key);
          if (cursor.key !== null && !cursorDate) {
            return invalidCursor();
          }
          if (cursorDate === null) {
            filters.push(and(isNull(youtubeVideos.publishedAt), idCmp(youtubeVideos.id, cursor.id))!);
            primary = undefined;
          } else {
            primary = isAsc
              ? gt(youtubeVideos.publishedAt, cursorDate)
              : lt(youtubeVideos.publishedAt, cursorDate);
            tieEq = eq(youtubeVideos.publishedAt, cursorDate);
            filters.push(
              or(
                primary,
                isNull(youtubeVideos.publishedAt),
                and(tieEq, idCmp(youtubeVideos.id, cursor.id))
              )!
            );
          }
        }
      } else if (opts.cursor.includes("|")) {
        // Pre-versioned composite cursor from this PR: `${sortKey}|${id}`.
        const sepIdx = opts.cursor.lastIndexOf("|");
        const cursorKey = opts.cursor.slice(0, sepIdx);
        const cursorId = opts.cursor.slice(sepIdx + 1);
        if (!cursorKey || !cursorId || !isValidCursorId(cursorId)) {
          return invalidCursor();
        }

        const idCmp = isAsc ? gt : lt;
        let primary: SQL;
        let tieEq: SQL;
        if (isTitleSort) {
          primary = isAsc
            ? gt(youtubeVideos.title, cursorKey)
            : lt(youtubeVideos.title, cursorKey);
          tieEq = eq(youtubeVideos.title, cursorKey);
        } else {
          const cursorDate = parseCursorDate(cursorKey);
          if (!cursorDate) {
            return invalidCursor();
          }
          primary = isAsc
            ? gt(youtubeVideos.publishedAt, cursorDate)
            : lt(youtubeVideos.publishedAt, cursorDate);
          tieEq = eq(youtubeVideos.publishedAt, cursorDate);
        }
        filters.push(or(primary, and(tieEq, idCmp(youtubeVideos.id, cursorId)))!);
      } else {
        // Legacy cursor: bare publishedAt ISO string (pre-composite-cursor deploy).
        const cursorDate = parseCursorDate(opts.cursor);
        if (!cursorDate) {
          return invalidCursor();
        }
        // Title-sort pages briefly emitted this legacy publishedAt cursor during
        // rollout; accept it as a best-effort compatibility filter.
        if (isAsc) {
          filters.push(gt(youtubeVideos.publishedAt, cursorDate));
        } else {
          filters.push(lt(youtubeVideos.publishedAt, cursorDate));
        }
      }
    }

    const idTiebreaker = isAsc ? asc(youtubeVideos.id) : desc(youtubeVideos.id);
    const primaryOrder = isTitleSort
      ? isAsc
        ? sql`${youtubeVideos.title} asc nulls last`
        : sql`${youtubeVideos.title} desc nulls last`
      : isAsc
        ? sql`${youtubeVideos.publishedAt} asc nulls last`
        : sql`${youtubeVideos.publishedAt} desc nulls last`;

    const results = await db
      .select({
        ...getTableColumns(youtubeVideos),
        channel: {
          id: youtubeChannels.id,
          channelId: youtubeChannels.channelId,
          title: youtubeChannels.title,
        },
        container: { id: containers.id, name: containers.name },
      })
      .from(youtubeVideos)
      .innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.id))
      .leftJoin(containers, eq(youtubeVideos.containerId, containers.id))
      .where(and(...filters))
      .orderBy(primaryOrder, idTiebreaker)
      .limit(limit + 1);

    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const last = items[items.length - 1];
    let nextCursor: string | undefined;
    if (hasMore && last) {
      if (isTitleSort) {
        nextCursor = encodeCompositeCursor({
          scope: "videos",
          sort: activeSortField,
          dir: activeSortDir,
          key: last.title,
          id: last.id,
        });
      } else {
        nextCursor = encodeCompositeCursor({
          scope: "videos",
          sort: activeSortField,
          dir: activeSortDir,
          key: last.publishedAt?.toISOString() ?? null,
          id: last.id,
        });
      }
    }

    const baseFilters = [ownerFilter] as any[];
    if (opts.channelId) baseFilters.push(eq(youtubeChannels.channelId, opts.channelId));
    if (opts.containerId) baseFilters.push(eq(youtubeVideos.containerId, opts.containerId));
    if (opts.search) baseFilters.push(ilike(youtubeVideos.title, `%${opts.search}%`));
    if (opts.unassigned) baseFilters.push(isNull(youtubeVideos.containerId));
    if (opts.hasDrift === true) baseFilters.push(isNotNull(youtubeVideos.driftDetectedAt));
    if (opts.hasDrift === false) baseFilters.push(isNull(youtubeVideos.driftDetectedAt));

    const [totalResult] = await db
      .select({ total: count() })
      .from(youtubeVideos)
      .innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.id))
      .where(and(...baseFilters));

    return {
      data: {
        data: items,
        meta: { cursor: nextCursor, hasMore, total: totalResult?.total ?? 0 },
        source: "db",
      },
    };
  } catch (err) {
    console.error("[videos] listVideos failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch videos",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

function invalidCursor(): ServiceResult<{ data: any[]; meta: PaginationMeta; source: "db" | "youtube" }> {
  return {
    error: {
      code: "INVALID_CURSOR",
      message: "Invalid cursor format",
      suggestion: "Omit the cursor to start from the first page",
      status: 400,
    },
  };
}

function parseCursorDate(value: string | null): Date | null {
  if (value === null) return null;
  const parsedDate = new Date(value);
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
}

export async function getVideo(
  id: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<any>> {
  try {
    const result = await resolveVideo(id, userId, organizationId);
    if (!result.found) return { error: videoNotFoundError(result.reason) };
    const resolved = result.video;

    const [video] = await db
      .select({
        ...getTableColumns(youtubeVideos),
        channel: {
          id: youtubeChannels.id,
          channelId: youtubeChannels.channelId,
          title: youtubeChannels.title,
          userId: youtubeChannels.userId,
        },
        container: { id: containers.id, name: containers.name, separator: containers.separator, templateOrder: containers.templateOrder },
      })
      .from(youtubeVideos)
      .innerJoin(youtubeChannels, eq(youtubeVideos.channelId, youtubeChannels.id))
      .leftJoin(containers, eq(youtubeVideos.containerId, containers.id))
      .where(eq(youtubeVideos.id, resolved.id));

    if (!video) {
      return {
        error: {
          code: "VIDEO_NOT_FOUND",
          message: "Video not found",
          suggestion: "Pass a VidTempla UUID or YouTube video ID",
          status: 404,
        },
      };
    }

    const tokens = await getChannelTokens(video.channel.channelId, userId, organizationId);
    let youtubeData = null;
    if (!("error" in tokens)) {
      try {
        const details = await fetchVideoDetails(tokens.accessToken, [video.videoId]);
        youtubeData = details[0] ?? null;
      } catch (err) {
        // ignore live fetch failure
        console.warn("[videos] getVideo live fetchVideoDetails failed:", err);
      }
    }

    return { data: { ...video, youtube: youtubeData } };
  } catch (err) {
    console.error("[videos] getVideo failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch video details",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export interface VideoAnalyticsOpts {
  startDate?: string;
  endDate?: string;
  metrics?: string;
  dimensions?: string;
}

export async function getVideoAnalytics(
  id: string,
  userId: string,
  opts: VideoAnalyticsOpts,
  organizationId?: string
): Promise<ServiceResult<any>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found) return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    const now = new Date();
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const startDate = opts.startDate ?? twentyEightDaysAgo.toISOString().split("T")[0]!;
    const endDate = opts.endDate ?? now.toISOString().split("T")[0]!;
    const metrics = opts.metrics ?? "views,estimatedMinutesWatched,averageViewDuration";
    const dimensions = opts.dimensions ?? "day";

    const tokens = await getChannelTokens(video.channelYoutubeId, userId, organizationId);
    if ("error" in tokens) {
      return {
        error: {
          code: tokens.error.error.code,
          message: tokens.error.error.message,
          suggestion: tokens.error.error.suggestion ?? "",
          status: tokens.status,
        },
      };
    }

    const data = await fetchVideoAnalytics(tokens.accessToken, video.videoId, metrics, dimensions, startDate, endDate);
    return { data };
  } catch (err) {
    console.error("[videos] getVideoAnalytics failed:", err);
    return {
      error: {
        code: "ANALYTICS_ERROR",
        message: "Failed to fetch video analytics",
        suggestion: "Ensure your channel has analytics access",
        status: 500,
      },
    };
  }
}

export async function getVideoRetention(
  id: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<any>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found) return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    const tokens = await getChannelTokens(video.channelYoutubeId, userId, organizationId);
    if ("error" in tokens) {
      return {
        error: {
          code: tokens.error.error.code,
          message: tokens.error.error.message,
          suggestion: tokens.error.error.suggestion ?? "",
          status: tokens.status,
        },
      };
    }

    const rawData = await fetchVideoRetention(tokens.accessToken, video.videoId);
    const retentionCurve = (rawData.rows ?? []).map((row: Array<string | number>) => ({
      position: row[0] as number,
      watchRatio: row[1] as number,
      relativePerformance: row[2] as number,
    }));

    return { data: retentionCurve };
  } catch (err) {
    console.error("[videos] getVideoRetention failed:", err);
    return {
      error: {
        code: "ANALYTICS_ERROR",
        message: "Failed to fetch retention data",
        suggestion: "Ensure your channel has analytics access and the video has sufficient views",
        status: 500,
      },
    };
  }
}

export async function getVideoVariables(
  id: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<any>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found) return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    const variables = await db
      .select({
        ...getTableColumns(videoVariables),
        template: { id: templates.id, name: templates.name, content: templates.content },
      })
      .from(videoVariables)
      .leftJoin(templates, eq(videoVariables.templateId, templates.id))
      .where(eq(videoVariables.videoId, video.id));

    const [videoData] = await db
      .select({
        videoId: youtubeVideos.videoId,
        container: {
          id: containers.id,
          templateOrder: containers.templateOrder,
          separator: containers.separator,
        },
      })
      .from(youtubeVideos)
      .leftJoin(containers, eq(youtubeVideos.containerId, containers.id))
      .where(eq(youtubeVideos.id, video.id));

    return { data: { variables, video: videoData || null } };
  } catch (err) {
    console.error("[videos] getVideoVariables failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch variables",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export async function assignVideo(
  id: string,
  containerId: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<{ success: true }>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found)
      return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    if (video.containerId) {
      return {
        error: {
          code: "ALREADY_ASSIGNED",
          message: "Video is already assigned to a container",
          suggestion: "Unassign the video first or use a different video",
          status: 400,
        },
      };
    }

    const channelOwnerFilter = organizationId
      ? eq(youtubeChannels.organizationId, organizationId)
      : eq(youtubeChannels.userId, userId);
    const channels = await db
      .select({ id: youtubeChannels.id })
      .from(youtubeChannels)
      .where(channelOwnerFilter);
    const channelIds = channels.map((c) => c.id);

    // Pre-fetch the plan limit (not race-sensitive — the value rarely changes
    // mid-request). The actual race-sensitive check (current assigned count vs.
    // limit) is performed inside the transaction below under an advisory lock.
    const limitCheck = await checkVideoLimit(organizationId ?? userId, db);

    const containerOwnerFilter = organizationId
      ? eq(containers.organizationId, organizationId)
      : eq(containers.userId, userId);
    const [container] = await db
      .select({ id: containers.id, templateOrder: containers.templateOrder })
      .from(containers)
      .where(and(eq(containers.id, containerId), containerOwnerFilter));

    if (!container) {
      return {
        error: {
          code: "CONTAINER_NOT_FOUND",
          message: "Container not found",
          suggestion: "Check the container ID",
          status: 404,
        },
      };
    }

    const templatesData =
      container.templateOrder && container.templateOrder.length > 0
        ? await db
            .select({ id: templates.id, content: templates.content })
            .from(templates)
            .where(inArray(templates.id, container.templateOrder))
        : [];

    const variablesToCreate: Array<{
      videoId: string;
      templateId: string;
      variableName: string;
      variableValue: string;
    }> = [];
    const eventsToRecord: Array<{
      videoId: string;
      templateId: string;
      variableName: string;
    }> = [];
    for (const template of templatesData) {
      for (const varName of parseUserVariables(template.content)) {
        variablesToCreate.push({
          videoId: video.id,
          templateId: template.id,
          variableName: varName,
          variableValue: "",
        });
        eventsToRecord.push({
          videoId: video.id,
          templateId: template.id,
          variableName: varName,
        });
      }
    }

    const ASSIGN_CONFLICT = Symbol("assign_conflict");
    const LIMIT_REACHED = Symbol("limit_reached");
    const VIDEO_MISSING = Symbol("video_missing");
    try {
      await db.transaction(async (tx) => {
        // Serialize owner-level assignments so post-update limit checks cannot
        // interleave and commit over the plan cap.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${organizationId ?? userId}))`,
        );

        await tx.execute(
          sql`select 1 from youtube_videos where id = ${video.id} for update`,
        );
        const [lockedVideo] = await tx
          .select({ containerId: youtubeVideos.containerId })
          .from(youtubeVideos)
          .where(eq(youtubeVideos.id, video.id));

        if (!lockedVideo) {
          throw VIDEO_MISSING;
        }

        if (lockedVideo.containerId) {
          throw ASSIGN_CONFLICT;
        }

        if (channelIds.length > 0) {
          const [countResult] = await tx
            .select({ assignedCount: count() })
            .from(youtubeVideos)
            .where(
              and(
                inArray(youtubeVideos.channelId, channelIds),
                isNotNull(youtubeVideos.containerId),
              ),
            );

          if ((countResult?.assignedCount ?? 0) >= limitCheck.limit) {
            throw LIMIT_REACHED;
          }
        }

        // CAS update: only assign if container_id is still NULL. If a concurrent
        // assign already won, this returns 0 rows and we abort the transaction
        // to avoid silently overwriting the first assignment (and creating
        // duplicate videoVariables rows).
        const updated = await tx
          .update(youtubeVideos)
          .set({ containerId, driftDetectedAt: null })
          .where(
            and(
              eq(youtubeVideos.id, video.id),
              isNull(youtubeVideos.containerId),
            ),
          )
          .returning({ id: youtubeVideos.id });

        if (updated.length === 0) {
          throw ASSIGN_CONFLICT;
        }

        if (variablesToCreate.length > 0) {
          await tx.insert(videoVariables).values(variablesToCreate);
          await tx.insert(videoVariableEvents).values(
            eventsToRecord.map((e) => ({
              videoId: e.videoId,
              templateId: e.templateId,
              variableName: e.variableName,
              oldValue: null,
              newValue: "",
              changeType: "assignment_init" as const,
              changedBy: userId,
              organizationId: organizationId ?? null,
            })),
          );
        }
      });
    } catch (txErr) {
      if (txErr === VIDEO_MISSING) {
        return { error: videoNotFoundError("not_found") };
      }
      if (txErr === ASSIGN_CONFLICT) {
        return {
          error: {
            code: "ALREADY_ASSIGNED",
            message: "Video was just assigned to another container",
            suggestion: "Refresh and try again — another request won the race",
            status: 409,
          },
        };
      }
      if (txErr === LIMIT_REACHED) {
        return {
          error: {
            code: "VIDEO_LIMIT_REACHED",
            message: `Assigned video limit reached (${limitCheck.limit} on ${
              limitCheck.planTier
            } plan)`,
            suggestion: "Upgrade your plan to assign more videos",
            status: 403,
          },
        };
      }
      throw txErr;
    }

    return { data: { success: true } };
  } catch (err) {
    console.error("[videos] assignVideo failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to assign video",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export interface VariableUpdate {
  templateId: string;
  name: string;
  value: string;
}

/**
 * Builds a frozen render payload for a single video under a per-video lock.
 * Bumps renderVersion inside the lock so any stale payload enqueued earlier
 * (with a smaller stamp) will be discarded by the worker.
 * Returns null if the video has nothing to render or if the rendered description
 * matches what's already on the video (no-op).
 */
async function buildPushPayload(
  tx: any,
  videoId: string,
  userId: string
): Promise<PushPayload | null> {
  await tx.execute(
    sql`select 1 from youtube_videos where id = ${videoId} for update`
  );

  const rows = await tx.query.youtubeVideos.findMany({
    where: eq(youtubeVideos.id, videoId),
    with: {
      youtubeChannel: true,
      container: true,
      videoVariables: true,
    },
    limit: 1,
  });
  const video = rows[0];
  if (!video) return null;

  if (!video.container || !video.container.templateOrder?.length) {
    return null;
  }

  const templatesList = video.container.organizationId
    ? await tx
        .select({ id: templates.id, content: templates.content })
        .from(templates)
        .where(
          and(
            inArray(templates.id, video.container.templateOrder),
            eq(templates.organizationId, video.container.organizationId)
          )
        )
    : await tx
        .select({ id: templates.id, content: templates.content })
        .from(templates)
        .where(inArray(templates.id, video.container.templateOrder));

  if (templatesList.length === 0) return null;

  const orderedTemplates = video.container.templateOrder
    .map((templateId: string) =>
      templatesList.find((t: { id: string }) => t.id === templateId)
    )
    .filter((t: unknown): t is { id: string; content: string } => Boolean(t));

  const flatSnapshot: Record<string, string> = {};
  const perTemplateSnapshot: Record<string, Record<string, string>> = {};
  for (const v of video.videoVariables ?? []) {
    const value = v.variableValue ?? "";
    flatSnapshot[v.variableName] = value;
    if (!perTemplateSnapshot[v.templateId]) {
      perTemplateSnapshot[v.templateId] = {};
    }
    perTemplateSnapshot[v.templateId]![v.variableName] = value;
  }

  const newDescription = buildDescription(
    orderedTemplates,
    flatSnapshot,
    video.container.separator,
    video.videoId
  );

  if (newDescription === video.currentDescription) {
    return null;
  }

  const bumpedRows = await tx.execute(sql<{
    renderVersion: number;
  }>`
    update youtube_videos
    set render_version = render_version + 1,
        updated_at = now()
    where id = ${videoId}
    returning render_version as "renderVersion"
  `);
  const renderVersion = Number(bumpedRows[0]?.renderVersion ?? 0);

  return {
    videoId: video.id,
    videoIdYouTube: video.videoId,
    channelId: video.channelId,
    newDescription,
    renderSnapshot: perTemplateSnapshot,
    renderVersion,
    userId,
    organizationId: video.youtubeChannel?.organizationId ?? null,
  };
}

// Max in-flight DB transactions / workflow enqueues when fanning out a push.
// Derived from the shared pool size with reserved headroom (POOL_RESERVE) so a
// single large push can never claim every connection and stall other requests
// in the same process, while still collapsing the serial per-video latency
// that made large template edits block the save request.
const PUSH_POOL_RESERVE = 4;
const PUSH_CONCURRENCY = Math.max(1, DB_POOL_MAX - PUSH_POOL_RESERVE);

type Settled<R> =
  | { status: "fulfilled"; value: R }
  | { status: "rejected"; reason: unknown };

/**
 * Map `items` through `fn` with at most `limit` promises in flight at once,
 * preserving input order in the result. A worker-pool (not chunked batches),
 * so a slow item doesn't stall the whole batch.
 *
 * Each item is settled independently: a thrown `fn` is captured as a rejected
 * result rather than rejecting the pool. This keeps an early failure from
 * abandoning the other in-flight workers mid-commit — every item runs to
 * completion and every outcome is observable, so a side effect already
 * committed by one worker (e.g. a bumped `render_version`) is never silently
 * orphaned by another worker's throw.
 */
async function mapWithConcurrencySettled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<Settled<R>[]> {
  const results: Settled<R>[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await fn(items[index]!) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    () => worker()
  );
  await Promise.all(workers);

  return results;
}

export async function pushVideoDescriptions(
  videoIds: string[],
  userId: string,
  opts: { force?: boolean } = {}
): Promise<ServiceResult<{ success: true }>> {
  const blocked = await assertNoDrift(videoIds, opts);
  if (blocked) {
    return {
      error: {
        code: "VIDEO_HAS_DRIFT",
        message: `Video was edited on YouTube on ${blocked.blocked.driftDetectedAt ?? "an unknown date"}`,
        suggestion:
          "Review the edit with get_description_history, then retry with force: true to overwrite OR call resolve_drift with strategy 'keep_youtube_edit' to preserve it",
        status: 409,
        meta: {
          driftedVideoIds: blocked.blocked.driftedVideoIds,
          driftDetectedAt: blocked.blocked.driftDetectedAt,
          latestManualEditHistoryId: blocked.blocked.latestManualEditHistoryId,
        },
      },
    };
  }

  // Phase 1 — build payloads and bump render_version with bounded concurrency.
  // Doing this serially is O(n) request-blocking round-trips: a template change
  // touching ~200 videos hung the save for ~20s. Each buildPushPayload runs in
  // its own transaction (FOR UPDATE locks distinct rows) and each payload is
  // self-contained, so there's no cross-video ordering to preserve. Settled so
  // a single failing video doesn't abandon the other in-flight transactions and
  // leave their committed render_version bumps without a workflow below.
  const builtResults = await mapWithConcurrencySettled(
    videoIds,
    PUSH_CONCURRENCY,
    (videoId) => db.transaction(async (tx) => buildPushPayload(tx, videoId, userId))
  );

  const payloads: PushPayload[] = [];
  const errors: unknown[] = [];
  for (const result of builtResults) {
    if (result.status === "rejected") errors.push(result.reason);
    else if (result.value !== null) payloads.push(result.value);
  }

  // Phase 2 — enqueue a workflow for every payload built above. This always
  // runs for the successfully-built payloads, even when Phase 1 had failures,
  // so a committed render_version bump is never left without its corresponding
  // YouTube-update workflow. Settled for the same reason as Phase 1.
  const enqueueResults = await mapWithConcurrencySettled(
    payloads,
    PUSH_CONCURRENCY,
    (payload) => start(updateVideoDescriptionsWorkflow, [payload])
  );
  for (const result of enqueueResults) {
    if (result.status === "rejected") errors.push(result.reason);
  }

  if (errors.length > 0) {
    console.error(
      `pushVideoDescriptions: ${errors.length} of ${videoIds.length} video(s) failed to push`,
      errors[0]
    );
    return {
      error: {
        code: "PUSH_PARTIALLY_FAILED",
        message: `Failed to push ${errors.length} of ${videoIds.length} video description(s).`,
        suggestion:
          "Retry the save. Videos that pushed successfully are already queued for update; retrying re-attempts the ones that failed.",
        status: 500,
      },
    };
  }

  return { data: { success: true } };
}

export async function updateVideoVariables(
  id: string,
  variables: VariableUpdate[],
  userId: string,
  organizationId?: string,
  opts: { force?: boolean } = {}
): Promise<ServiceResult<{ success: true }>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found) return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    const blocked = await assertNoDrift([video.id], opts);
    if (blocked) {
      return {
        error: {
          code: "VIDEO_HAS_DRIFT",
          message: `Video was edited on YouTube on ${blocked.blocked.driftDetectedAt ?? "an unknown date"}`,
          suggestion:
            "Review the edit with get_description_history, then retry with force: true to overwrite OR call resolve_drift with strategy 'keep_youtube_edit' to preserve it",
          status: 409,
          meta: {
            driftedVideoIds: blocked.blocked.driftedVideoIds,
            driftDetectedAt: blocked.blocked.driftDetectedAt,
            latestManualEditHistoryId: blocked.blocked.latestManualEditHistoryId,
          },
        },
      };
    }

    const payload = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select 1 from youtube_videos where id = ${video.id} for update`
      );

      const existing = await tx
        .select({
          templateId: videoVariables.templateId,
          variableName: videoVariables.variableName,
          variableValue: videoVariables.variableValue,
        })
        .from(videoVariables)
        .where(eq(videoVariables.videoId, video.id));
      const existingMap = new Map(
        existing.map((e) => [
          `${e.templateId}::${e.variableName}`,
          e.variableValue ?? "",
        ])
      );

      const events: Array<typeof videoVariableEvents.$inferInsert> = [];
      for (const variable of variables) {
        const key = `${variable.templateId}::${variable.name}`;
        const prior = existingMap.get(key);
        if (prior === variable.value) continue;

        await tx
          .insert(videoVariables)
          .values({
            videoId: video.id,
            templateId: variable.templateId,
            variableName: variable.name,
            variableValue: variable.value,
          })
          .onConflictDoUpdate({
            target: [
              videoVariables.videoId,
              videoVariables.templateId,
              videoVariables.variableName,
            ],
            set: { variableValue: variable.value },
          });

        events.push({
          videoId: video.id,
          templateId: variable.templateId,
          variableName: variable.name,
          oldValue: prior === undefined ? null : prior,
          newValue: variable.value,
          changeType: prior === undefined ? "create" : "update",
          changedBy: userId,
          organizationId: organizationId ?? null,
        });
      }

      if (events.length > 0) {
        await tx.insert(videoVariableEvents).values(events);
      }

      return buildPushPayload(tx, video.id, userId);
    });

    if (payload) {
      await start(updateVideoDescriptionsWorkflow, [payload]);
    }

    return { data: { success: true } };
  } catch (err) {
    console.error("[videos] updateVariables failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to update variables",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export async function getDescriptionHistory(
  id: string,
  userId: string,
  limit?: number,
  organizationId?: string
): Promise<ServiceResult<any>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found) return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    const maxEntries = Math.min(limit ?? 50, 100);
    const history = await db
      .select()
      .from(descriptionHistory)
      .where(eq(descriptionHistory.videoId, video.id))
      .orderBy(desc(descriptionHistory.versionNumber))
      .limit(maxEntries);

    return { data: history };
  } catch (err) {
    console.error("[videos] getDescriptionHistory failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to fetch description history",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export async function checkDrift(
  id: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<{ hasDrift: boolean; stored: string; live: string; driftDetectedAt: Date | null }>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found) return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    const [storedVideo] = await db
      .select({
        id: youtubeVideos.id,
        videoId: youtubeVideos.videoId,
        channelId: youtubeVideos.channelId,
        currentDescription: youtubeVideos.currentDescription,
        driftDetectedAt: youtubeVideos.driftDetectedAt,
      })
      .from(youtubeVideos)
      .where(eq(youtubeVideos.id, video.id));

    if (!storedVideo) return { error: videoNotFoundError("not_owned") };

    const accessToken = await getChannelAccessToken(storedVideo.channelId);
    const details = await fetchVideoDetails(accessToken, [storedVideo.videoId]);
    const live = details[0]?.snippet?.description ?? "";
    const stored = storedVideo.currentDescription ?? "";

    return {
      data: {
        hasDrift: live !== stored,
        stored,
        live,
        driftDetectedAt: storedVideo.driftDetectedAt,
      },
    };
  } catch (err) {
    console.error("[videos] checkDrift failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to check drift",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export async function revertDescription(
  id: string,
  historyId: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<{ success: true; delinkedContainer: boolean; variablesCleared: number }>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found) return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    const [history] = await db
      .select({ description: descriptionHistory.description })
      .from(descriptionHistory)
      .where(and(eq(descriptionHistory.id, historyId), eq(descriptionHistory.videoId, video.id)));

    if (!history) {
      return {
        error: {
          code: "HISTORY_NOT_FOUND",
          message: "History entry not found",
          suggestion: "Check the history ID — use get_description_history to list available entries",
          status: 404,
        },
      };
    }

    const [currentVideo] = await db
      .select({
        containerId: youtubeVideos.containerId,
        videoId: youtubeVideos.videoId,
        channelId: youtubeVideos.channelId,
        renderVersion: youtubeVideos.renderVersion,
      })
      .from(youtubeVideos)
      .where(eq(youtubeVideos.id, video.id));

    if (!currentVideo) return { error: videoNotFoundError("not_owned") };

    const accessToken = await getChannelAccessToken(currentVideo.channelId);
    const expectedRenderVersion = currentVideo.renderVersion;
    const reservationExpiresAt = new Date(
      Date.now() + DESCRIPTION_PUSH_RESERVATION_MS
    );

    // Phase 1 (read above): captured currentVideo + expectedRenderVersion.
    // Phase 2a: reserve the row with a short CAS before the external PUT. If the
    // row was deleted or modified after phase 1, skip the side effect.
    const claimRows = await db
      .update(youtubeVideos)
      .set({
        descriptionPushReservedUntil: reservationExpiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(youtubeVideos.id, video.id),
          eq(youtubeVideos.renderVersion, expectedRenderVersion),
          sql`(${youtubeVideos.descriptionPushReservedUntil} is null or ${youtubeVideos.descriptionPushReservedUntil} <= now())`
        )
      )
      .returning({ renderVersion: youtubeVideos.renderVersion });

    const claimedRenderVersion = Number(claimRows[0]?.renderVersion ?? 0);

    if (!claimedRenderVersion) {
      console.warn(
        "[videos] revertDescription CAS claim failed before YouTube PUT — skipping side effect",
        { videoId: video.id, expectedRenderVersion }
      );
      return {
        error: {
          code: "CONCURRENT_MODIFICATION",
          message:
            "Video was modified concurrently before YouTube revert; no changes were applied.",
          suggestion: "Refresh the video state and retry if the revert is still needed.",
          status: 409,
        },
      };
    }

    // Phase 2b: external HTTP PUT to YouTube — performed OUTSIDE any transaction
    // so we never hold a row lock across the round-trip. If this throws, best-effort
    // restore the reservation so the caller can retry against the original stamp.
    try {
      await updateVideoDescription(
        currentVideo.videoId,
        history.description,
        accessToken
      );
    } catch (err) {
      await db
        .update(youtubeVideos)
        .set({
          descriptionPushReservedUntil: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(youtubeVideos.id, video.id),
            eq(youtubeVideos.renderVersion, claimedRenderVersion)
          )
        );
      throw err;
    }

    // Phase 3: short write txn with CAS on render_version. If a concurrent
    // writer bumped render_version between phase 1 and phase 3, abort the local
    // write — YouTube already has the reverted description, and the next sync's
    // drift detection will reconcile.
    const writeResult = await db.transaction(async (tx) => {
      const existingVars = await tx
        .select({
          templateId: videoVariables.templateId,
          variableName: videoVariables.variableName,
          variableValue: videoVariables.variableValue,
        })
        .from(videoVariables)
        .where(eq(videoVariables.videoId, video.id));

      const hadContainer = !!currentVideo.containerId;
      const variableCount = existingVars.length;

      const updated = await tx
        .update(youtubeVideos)
        .set({
          currentDescription: history.description,
          driftDetectedAt: null,
          renderVersion: sql`${youtubeVideos.renderVersion} + 1`,
          descriptionPushReservedUntil: null,
          ...(hadContainer ? { containerId: null } : {}),
        })
        .where(
          and(
            eq(youtubeVideos.id, video.id),
            eq(youtubeVideos.renderVersion, claimedRenderVersion)
          )
        )
        .returning({ id: youtubeVideos.id });

      if (updated.length === 0) {
        return { casFailed: true as const };
      }

      if (variableCount > 0) {
        await tx.insert(videoVariableEvents).values(
          existingVars.map((v) => ({
            videoId: video.id,
            templateId: v.templateId,
            variableName: v.variableName,
            oldValue: v.variableValue ?? "",
            newValue: null,
            changeType: "revert_clear" as const,
            changedBy: userId,
            organizationId: organizationId ?? null,
          }))
        );
        await tx.delete(videoVariables).where(eq(videoVariables.videoId, video.id));
      }

      const nextVersionRows = await tx.execute(sql<{ next: number }>`
        select coalesce(max(version_number), 0) + 1 as next
        from description_history where video_id = ${video.id}
      `);
      const nextVersion = Number(nextVersionRows[0]?.next ?? 1);

      await tx.insert(descriptionHistory).values({
        videoId: video.id,
        description: history.description,
        versionNumber: nextVersion,
        renderSnapshot: null,
        createdBy: userId,
        source: "revert",
      });

      return { casFailed: false as const, hadContainer, variableCount };
    });

    if (writeResult.casFailed) {
      console.warn(
        "[videos] revertDescription CAS failed after YouTube PUT — concurrent writer bumped render_version; YouTube has reverted description but DB write skipped (drift detection will reconcile)",
        { videoId: video.id, expectedRenderVersion, claimedRenderVersion }
      );
      return {
        error: {
          code: "CONCURRENT_MODIFICATION",
          message:
            "Video was modified concurrently after YouTube revert; the DB metadata was not updated. Re-sync to reconcile.",
          suggestion:
            "Run a sync to refresh the cached description and resolve any drift, then retry if needed.",
          status: 409,
        },
      };
    }

    return {
      data: {
        success: true,
        delinkedContainer: writeResult.hadContainer,
        variablesCleared: writeResult.variableCount,
      },
    };
  } catch (err) {
    console.error("[videos] revertDescription failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to revert description",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}

export async function resolveDrift(
  id: string,
  userId: string,
  organizationId: string | undefined,
  input: { strategy: "keep_youtube_edit" | "reapply_template" | "revert_to_version"; historyId?: string; force?: boolean }
): Promise<ServiceResult<{ success: true; delinkedContainer?: boolean; variablesCleared?: number }>> {
  try {
    const videoResult = await resolveVideo(id, userId, organizationId);
    if (!videoResult.found) return { error: videoNotFoundError(videoResult.reason) };
    const video = videoResult.video;

    if (input.strategy === "revert_to_version") {
      if (!input.historyId) {
        return {
          error: {
            code: "HISTORY_ID_REQUIRED",
            message: "historyId is required for revert_to_version",
            suggestion: "Pass a historyId from get_description_history",
            status: 400,
          },
        };
      }
      return revertDescription(id, input.historyId, userId, organizationId);
    }

    const [videoRow] = await db.query.youtubeVideos.findMany({
      where: eq(youtubeVideos.id, video.id),
      with: { container: true, videoVariables: true, youtubeChannel: true },
      limit: 1,
    });

    if (!videoRow) return { error: videoNotFoundError("not_owned") };

    if (input.strategy === "keep_youtube_edit") {
      const variablesCleared = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select 1 from youtube_videos where id = ${video.id} for update`
        );

        const existingVars = await tx
          .select({
            templateId: videoVariables.templateId,
            variableName: videoVariables.variableName,
            variableValue: videoVariables.variableValue,
          })
          .from(videoVariables)
          .where(eq(videoVariables.videoId, video.id));

        await tx
          .update(youtubeVideos)
          .set({
            containerId: null,
            driftDetectedAt: null,
            renderVersion: sql`${youtubeVideos.renderVersion} + 1`,
          })
          .where(eq(youtubeVideos.id, video.id));

        if (existingVars.length > 0) {
          await tx.insert(videoVariableEvents).values(
            existingVars.map((v) => ({
              videoId: video.id,
              templateId: v.templateId,
              variableName: v.variableName,
              oldValue: v.variableValue ?? "",
              newValue: null,
              changeType: "drift_clear" as const,
              changedBy: userId,
              organizationId: organizationId ?? null,
            }))
          );
          await tx.delete(videoVariables).where(eq(videoVariables.videoId, video.id));
        }

        return existingVars.length;
      });

      return {
        data: {
          success: true,
          delinkedContainer: true,
          variablesCleared,
        },
      };
    }

    if (!videoRow.container || !videoRow.container.templateOrder?.length) {
      return {
        error: {
          code: "CANNOT_REAPPLY_NO_CONTAINER",
          message: "Video has no container assigned, cannot re-apply template",
          suggestion: "Assign the video to a container first with assign_video, or use strategy 'keep_youtube_edit' to accept the current description",
          status: 400,
        },
      };
    }

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select 1 from youtube_videos where id = ${video.id} for update`
      );

      await tx
        .update(youtubeVideos)
        .set({ driftDetectedAt: null })
        .where(eq(youtubeVideos.id, video.id));
    });

    return pushVideoDescriptions([video.id], userId, { force: true });
  } catch (err) {
    console.error("[videos] resolveDrift failed:", err);
    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "Failed to resolve drift",
        suggestion: "Try again later",
        status: 500,
      },
    };
  }
}
