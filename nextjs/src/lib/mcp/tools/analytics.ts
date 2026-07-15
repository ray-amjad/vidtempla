import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcp, mcpQuotaExceeded, getSessionUserId, getSessionOrgId, logMcpRequest, READ, WRITE } from "../helpers";
import { consumeCredits } from "@/lib/plan-limits";
import {
  getChannelAnalytics,
  queryAnalytics,
  searchMyVideos,
  searchYouTube,
  syncChannel,
} from "@/lib/services/analytics";

export function registerAnalyticsTools(server: McpServer) {
  server.tool(
    "get_channel_analytics",
    "Get channel-level analytics over a date range",
    {
      channelId: z.string().describe("YouTube channel ID"),
      startDate: z.string().optional().describe("Start date YYYY-MM-DD (default: 28 days ago)"),
      endDate: z.string().optional().describe("End date YYYY-MM-DD (default: today)"),
      metrics: z.string().optional().describe("Comma-separated metrics (default: views,estimatedMinutesWatched)"),
      dimensions: z.string().optional().describe("Dimensions (default: day)"),
    },
    READ,
    async ({ channelId, ...opts }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await getChannelAnalytics(channelId, userId, opts, orgId);
      logMcpRequest(userId, "get_channel_analytics", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "query_analytics",
    "Flexible YouTube Analytics API query. Supports any valid metrics, dimensions, filters, and sort parameters.",
    {
      channelId: z.string().describe("YouTube channel ID"),
      startDate: z.string().describe("Start date YYYY-MM-DD"),
      endDate: z.string().describe("End date YYYY-MM-DD"),
      metrics: z.string().describe("Comma-separated metrics (e.g. views,estimatedMinutesWatched,averageViewDuration)"),
      dimensions: z.string().optional().describe("Dimensions (e.g. day, month, country, video)"),
      filters: z.string().optional().describe("Filters (e.g. video==dQw4w9WgXcQ)"),
      sort: z.string().optional().describe("Sort field (e.g. -views)"),
      maxResults: z.number().optional().describe("Max results"),
    },
    READ,
    async (args) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await queryAnalytics(userId, args, orgId);
      logMcpRequest(userId, "query_analytics", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "search_my_videos",
    "Search your own channel's videos (forMine=true). Costs 100 YouTube API quota units.",
    {
      channelId: z.string().describe("YouTube channel ID"),
      q: z.string().describe("Search query"),
      sort: z.string().optional().describe("Sort order: relevance (default), date, viewCount, rating"),
      maxResults: z.number().optional().describe("Max results (default 25, max 50)"),
    },
    READ,
    async ({ channelId, ...opts }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 100);
      if (!credits.success) return mcpQuotaExceeded(userId, "search_my_videos");
      const result = await searchMyVideos(channelId, userId, opts, orgId);
      logMcpRequest(userId, "search_my_videos", 100, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "search_youtube",
    "Search all of YouTube (not just your channel). Costs 100 YouTube API quota units (+1 if includeStats is set).",
    {
      channelId: z.string().describe("Your YouTube channel ID (used for OAuth authentication)"),
      q: z.string().describe("Search query"),
      type: z.string().optional().describe("Resource type: video (default), channel, playlist"),
      sort: z.string().optional().describe("Sort order: relevance (default), date, viewCount, rating"),
      maxResults: z.number().optional().describe("Max results (default 10, max 50)"),
      pageToken: z.string().optional().describe("Page token for pagination"),
      filterChannelId: z.string().optional().describe("Filter results to a specific channel ID"),
      publishedAfter: z.string().optional().describe("ISO 8601 datetime — only return results after this date (e.g. 2026-04-09T00:00:00Z)"),
      publishedBefore: z.string().optional().describe("ISO 8601 datetime — only return results before this date"),
      regionCode: z.string().optional().describe("ISO 3166-1 alpha-2 country code (e.g. US, GB, DE)"),
      relevanceLanguage: z.string().optional().describe("BCP-47 language code to bias results (e.g. en, es, fr)"),
      videoCategoryId: z.string().optional().describe("YouTube category ID (e.g. 28=Science&Tech, 22=People&Blogs). Requires type=video"),
      videoDuration: z.string().optional().describe("Filter by duration: short (<4min), medium (4-20min), long (>20min). Requires type=video"),
      eventType: z.string().optional().describe("Filter livestream status: completed, live, upcoming. Requires type=video"),
      includeStats: z
        .preprocess((v) => (typeof v === "string" ? v.toLowerCase() === "true" : v), z.boolean())
        .optional()
        .describe("If true, hydrate each video result with viewCount/likeCount/commentCount (statistics) and duration (contentDetails) via a chained videos.list call. Adds 1 quota unit. Video results only. Accepts a boolean or the string \"true\"/\"false\" (some MCP clients stringify args)."),
    },
    READ,
    async ({ channelId, ...opts }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      // includeStats chains a second videos.list call (+1 YouTube quota unit).
      const quotaUnits = opts.includeStats ? 101 : 100;
      const credits = await consumeCredits(orgId, quotaUnits);
      if (!credits.success) return mcpQuotaExceeded(userId, "search_youtube");
      const result = await searchYouTube(channelId, userId, opts, orgId);
      logMcpRequest(userId, "search_youtube", quotaUnits, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "sync_channel",
    "Trigger a video sync for a channel (imports new videos from YouTube)",
    { channelId: z.string().describe("YouTube channel ID") },
    WRITE,
    async ({ channelId }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await syncChannel(channelId, userId, orgId);
      logMcpRequest(userId, "sync_channel", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );
}
