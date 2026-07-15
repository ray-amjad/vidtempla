import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { youtubeChannels } from "@/db/schema";
import { getChannelTokens } from "@/lib/api-auth";
import { fetchChannelAnalytics, fetchVideoDetails } from "@/lib/clients/youtube";
import { start } from "workflow/api";
import { syncChannelVideosWorkflow } from "@/workflows/sync-channel-videos";
import axios from "axios";
import { mapYouTubeServiceError } from "@/lib/youtube-errors";
import type { ServiceResult } from "./types";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const YOUTUBE_ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

// ── get_channel_analytics ────────────────────────────────────

export interface ChannelAnalyticsOpts {
  startDate?: string;
  endDate?: string;
  metrics?: string;
  dimensions?: string;
}

export async function getChannelAnalytics(
  channelId: string,
  userId: string,
  opts: ChannelAnalyticsOpts,
  organizationId?: string
): Promise<ServiceResult<unknown>> {
  try {
    const now = new Date();
    const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const startDate = opts.startDate ?? twentyEightDaysAgo.toISOString().split("T")[0]!;
    const endDate = opts.endDate ?? now.toISOString().split("T")[0]!;
    const metrics = opts.metrics ?? "views,estimatedMinutesWatched";
    const dimensions = opts.dimensions ?? "day";

    const tokens = await getChannelTokens(channelId, userId, organizationId);
    if ("error" in tokens) {
      return { error: { code: tokens.error.error.code, message: tokens.error.error.message, suggestion: tokens.error.error.suggestion ?? "", status: tokens.status } };
    }

    const data = await fetchChannelAnalytics(tokens.accessToken, tokens.channelId, metrics, dimensions, startDate, endDate);
    return { data };
  } catch {
    return { error: { code: "ANALYTICS_ERROR", message: "Failed to fetch channel analytics", suggestion: "Ensure your channel has analytics access", status: 500 } };
  }
}

// ── query_analytics ──────────────────────────────────────────

export interface QueryAnalyticsOpts {
  channelId: string;
  startDate: string;
  endDate: string;
  metrics: string;
  dimensions?: string;
  filters?: string;
  sort?: string;
  maxResults?: number;
}

export async function queryAnalytics(
  userId: string,
  opts: QueryAnalyticsOpts,
  organizationId?: string
): Promise<ServiceResult<unknown>> {
  try {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(opts.startDate) || !dateRegex.test(opts.endDate)) {
      return { error: { code: "INVALID_PARAMETER", message: "Dates must be in YYYY-MM-DD format", suggestion: "Use ISO date format, e.g. 2024-01-01", status: 400 } };
    }

    const tokens = await getChannelTokens(opts.channelId, userId, organizationId);
    if ("error" in tokens) {
      return { error: { code: tokens.error.error.code, message: tokens.error.error.message, suggestion: tokens.error.error.suggestion ?? "", status: tokens.status } };
    }

    const queryParams: Record<string, string | number> = {
      ids: `channel==${opts.channelId}`,
      startDate: opts.startDate,
      endDate: opts.endDate,
      metrics: opts.metrics,
    };
    if (opts.dimensions) queryParams.dimensions = opts.dimensions;
    if (opts.filters) queryParams.filters = opts.filters;
    if (opts.sort) queryParams.sort = opts.sort;
    if (opts.maxResults) queryParams.maxResults = opts.maxResults;

    const response = await axios.get(YOUTUBE_ANALYTICS_API, {
      params: queryParams,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    return { data: response.data };
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status || 500 : 500;
    const message = axios.isAxiosError(error)
      ? error.response?.data?.error?.message || error.message
      : "Unknown error";

    if (status === 403 && message.includes("insufficient")) {
      return { error: { code: "MISSING_SCOPE", message: "Analytics scope not authorized", suggestion: "Reconnect your channel from the dashboard to enable analytics", status: 403 } };
    }

    return {
      error: {
        code: "YOUTUBE_API_ERROR",
        message,
        suggestion: "Check query parameters. Valid metrics: views, estimatedMinutesWatched, averageViewDuration, likes, comments, shares. Valid dimensions: day, month, country, video.",
        status,
      },
    };
  }
}

// ── search_my_videos (channel-scoped) ────────────────────────

export interface SearchChannelVideosOpts {
  q: string;
  sort?: string;
  maxResults?: number;
}

/** @deprecated Use searchMyVideos instead */
export const searchChannelVideos = searchMyVideos;

export async function searchMyVideos(
  channelId: string,
  userId: string,
  opts: SearchChannelVideosOpts,
  organizationId?: string
): Promise<ServiceResult<unknown>> {
  try {
    const maxResults = Math.min(opts.maxResults ?? 25, 50);

    const tokens = await getChannelTokens(channelId, userId, organizationId);
    if ("error" in tokens) {
      return { error: { code: tokens.error.error.code, message: tokens.error.error.message, suggestion: tokens.error.error.suggestion ?? "", status: tokens.status } };
    }

    const response = await axios.get(`${YOUTUBE_API_BASE}/search`, {
      params: {
        part: "snippet",
        forMine: true,
        type: "video",
        q: opts.q,
        order: opts.sort ?? "relevance",
        maxResults,
      },
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    return { data: response.data };
  } catch (error) {
    return { error: mapYouTubeServiceError(error) };
  }
}

// ── search_youtube (all of YouTube) ──────────────────────────

export interface SearchYouTubeOpts {
  q: string;
  type?: string;
  sort?: string;
  maxResults?: number;
  pageToken?: string;
  filterChannelId?: string;
  publishedAfter?: string;
  publishedBefore?: string;
  regionCode?: string;
  relevanceLanguage?: string;
  videoCategoryId?: string;
  videoDuration?: string;
  eventType?: string;
  includeStats?: boolean;
}

export async function searchYouTube(
  authChannelId: string,
  userId: string,
  opts: SearchYouTubeOpts,
  organizationId?: string
): Promise<ServiceResult<unknown>> {
  try {
    const maxResults = Math.min(opts.maxResults ?? 10, 50);

    const tokens = await getChannelTokens(authChannelId, userId, organizationId);
    if ("error" in tokens) {
      return { error: { code: tokens.error.error.code, message: tokens.error.error.message, suggestion: tokens.error.error.suggestion ?? "", status: tokens.status } };
    }

    const params: Record<string, string | number | boolean> = {
      part: "snippet",
      type: opts.type ?? "video",
      q: opts.q,
      order: opts.sort ?? "relevance",
      maxResults,
    };
    if (opts.pageToken) params.pageToken = opts.pageToken;
    if (opts.filterChannelId) params.channelId = opts.filterChannelId;
    if (opts.publishedAfter) params.publishedAfter = opts.publishedAfter;
    if (opts.publishedBefore) params.publishedBefore = opts.publishedBefore;
    if (opts.regionCode) params.regionCode = opts.regionCode;
    if (opts.relevanceLanguage) params.relevanceLanguage = opts.relevanceLanguage;
    if (opts.videoCategoryId) params.videoCategoryId = opts.videoCategoryId;
    if (opts.videoDuration) params.videoDuration = opts.videoDuration;
    if (opts.eventType) params.eventType = opts.eventType;

    const response = await axios.get(`${YOUTUBE_API_BASE}/search`, {
      params,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });

    // Opt-in stats hydration: search only returns snippet data, so chain a
    // videos.list call (1 quota unit, up to 50 ids) to merge in view/like/
    // comment counts and duration. Only applies to video-type results.
    if (opts.includeStats && (opts.type ?? "video") === "video") {
      const items = response.data?.items ?? [];
      const videoIds = items
        .map((item: { id?: { videoId?: string } }) => item.id?.videoId)
        .filter((id: string | undefined): id is string => Boolean(id));

      if (videoIds.length > 0) {
        try {
          const details = await fetchVideoDetails(tokens.accessToken, videoIds);
          const byId = new Map(details.map((d) => [d.id, d]));
          for (const item of items) {
            const detail = item.id?.videoId ? byId.get(item.id.videoId) : undefined;
            if (detail) {
              item.statistics = detail.statistics;
              item.contentDetails = detail.contentDetails;
            }
          }
        } catch (err) {
          // Non-fatal: return the search results without stats rather than failing.
          console.warn("[analytics] searchYouTube stats hydration failed:", err);
        }
      }
    }

    return { data: response.data };
  } catch (error) {
    return { error: mapYouTubeServiceError(error) };
  }
}

// ── sync_channel ─────────────────────────────────────────────

export async function syncChannel(
  channelId: string,
  userId: string,
  organizationId?: string
): Promise<ServiceResult<{ message: string; jobId: string }>> {
  try {
    const ownerFilter = organizationId
      ? eq(youtubeChannels.organizationId, organizationId)
      : eq(youtubeChannels.userId, userId);

    const [channel] = await db
      .select({ id: youtubeChannels.id, syncStatus: youtubeChannels.syncStatus })
      .from(youtubeChannels)
      .where(and(eq(youtubeChannels.channelId, channelId), ownerFilter));

    if (!channel) {
      return { error: { code: "CHANNEL_NOT_FOUND", message: "Channel not found or not connected", suggestion: "Connect a YouTube channel from the dashboard first", status: 404 } };
    }

    if (channel.syncStatus === "syncing") {
      return { error: { code: "SYNC_IN_PROGRESS", message: "A sync is already in progress", suggestion: "Wait for the current sync to complete", status: 409 } };
    }

    await start(syncChannelVideosWorkflow, [channel.id, userId, organizationId]);

    return { data: { message: "Video sync started", jobId: `sync-${channel.id}-${Date.now()}` } };
  } catch {
    return { error: { code: "INTERNAL_ERROR", message: "Failed to trigger sync", suggestion: "Try again later", status: 500 } };
  }
}
