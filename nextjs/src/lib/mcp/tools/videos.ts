import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcp, mcpQuotaExceeded, getSessionUserId, getSessionOrgId, logMcpRequest, requireOrgAdmin, READ, WRITE, DESTRUCTIVE } from "../helpers";
import { consumeCredits } from "@/lib/plan-limits";
import {
  listVideos,
  getVideo,
  getVideoAnalytics,
  getVideoRetention,
  getVideoVariables,
  assignVideo,
  updateVideoVariables,
  getDescriptionHistory,
  revertDescription,
  checkDrift,
  resolveDrift,
} from "@/lib/services/videos";
import { videoVariableUpdatesSchema } from "@/lib/validation/videoVariables";

export function registerVideoTools(server: McpServer) {
  server.tool(
    "list_videos",
    "List videos with filtering, sorting, and cursor pagination",
    {
      channelId: z.string().describe("YouTube channel ID, @handle, or channel URL — syncs from DB for owned channels, fetches directly from YouTube API for unowned public channels"),
      containerId: z.string().optional().describe("Filter by container UUID"),
      search: z.string().optional().describe("Search by video title"),
      unassigned: z.boolean().optional().describe("Only show unassigned videos"),
      hasDrift: z.boolean().optional().describe("Owned channels only: true for drifted videos, false for non-drifted videos"),
      sort: z.string().optional().describe("Sort field:direction, e.g. publishedAt:desc (default) or title:asc"),
      cursor: z.string().optional().describe("Pagination cursor from previous response"),
      limit: z.number().optional().describe("Results per page (max 100, default 50)"),
    },
    READ,
    async (args) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 2);
      if (!credits.success) return mcpQuotaExceeded(userId, "list_videos");
      const result = await listVideos(userId, args, orgId);
      logMcpRequest(userId, "list_videos", 2, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "get_video",
    "Get video details including currentDescription and driftDetectedAt (accepts VidTempla UUID or YouTube video ID)",
    { id: z.string().describe("VidTempla UUID or YouTube video ID (e.g. dQw4w9WgXcQ)") },
    READ,
    async ({ id }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 1);
      if (!credits.success) return mcpQuotaExceeded(userId, "get_video");
      const result = await getVideo(id, userId, orgId);
      logMcpRequest(userId, "get_video", 1, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "get_video_analytics",
    "Get video analytics over a date range (views, watch time, etc.)",
    {
      id: z.string().describe("VidTempla UUID or YouTube video ID"),
      startDate: z.string().optional().describe("Start date YYYY-MM-DD (default: 28 days ago)"),
      endDate: z.string().optional().describe("End date YYYY-MM-DD (default: today)"),
      metrics: z.string().optional().describe("Comma-separated metrics (default: views,estimatedMinutesWatched,averageViewDuration)"),
      dimensions: z.string().optional().describe("Dimensions (default: day)"),
    },
    READ,
    async ({ id, ...opts }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await getVideoAnalytics(id, userId, opts, orgId);
      logMcpRequest(userId, "get_video_analytics", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "get_video_retention",
    "Get audience retention curve (100 data points with position, watchRatio, relativePerformance)",
    { id: z.string().describe("VidTempla UUID or YouTube video ID") },
    READ,
    async ({ id }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await getVideoRetention(id, userId, orgId);
      logMcpRequest(userId, "get_video_retention", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "get_video_variables",
    "Get template variables for a video",
    { id: z.string().describe("VidTempla UUID or YouTube video ID") },
    READ,
    async ({ id }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await getVideoVariables(id, userId, orgId);
      logMcpRequest(userId, "get_video_variables", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "assign_video",
    "Assign a video to a container (initializes template variables)",
    {
      id: z.string().describe("VidTempla UUID or YouTube video ID"),
      containerId: z.string().describe("Container UUID to assign the video to"),
    },
    WRITE,
    async ({ id, containerId }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await assignVideo(id, containerId, userId, orgId);
      logMcpRequest(userId, "assign_video", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "update_video_variables",
    "Update template variable values for a video and trigger description rebuild. If the video has drift, returns VIDEO_HAS_DRIFT unless force=true.",
    {
      id: z.string().describe("VidTempla UUID or YouTube video ID"),
      variables: videoVariableUpdatesSchema.describe(
        "Array of variables to update"
      ),
      force: z.boolean().optional().describe("Set true to overwrite a drifted YouTube edit"),
    },
    WRITE,
    async ({ id, variables, force }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await updateVideoVariables(id, variables, userId, orgId, { force });
      logMcpRequest(userId, "update_video_variables", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "get_description_history",
    "Get the version history of a video's description (ordered by most recent first)",
    {
      id: z.string().describe("VidTempla UUID or YouTube video ID"),
      limit: z.number().optional().describe("Max entries to return (default 50, max 100)"),
    },
    READ,
    async ({ id, limit }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await getDescriptionHistory(id, userId, limit, orgId);
      logMcpRequest(userId, "get_description_history", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "check_drift",
    "Check a video's live YouTube description against VidTempla's stored currentDescription. Costs 1 YouTube quota unit.",
    { id: z.string().describe("VidTempla UUID or YouTube video ID") },
    READ,
    async ({ id }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await checkDrift(id, userId, orgId);
      logMcpRequest(userId, "check_drift", 1, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "resolve_drift",
    "Resolve description drift by keeping the YouTube edit, reapplying the template, or reverting to a historical version.",
    {
      id: z.string().describe("VidTempla UUID or YouTube video ID"),
      strategy: z.enum(["keep_youtube_edit", "reapply_template", "revert_to_version"]),
      historyId: z.string().optional().describe("Required for revert_to_version"),
      force: z.boolean().optional(),
    },
    WRITE,
    async ({ id, ...input }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const result = await resolveDrift(id, userId, orgId, input);
      logMcpRequest(userId, "resolve_drift", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "revert_description",
    "Revert a video's description to a previous version. Requires the owner or admin role in the workspace; a member gets FORBIDDEN_ROLE and nothing is changed. This delinks the video from its container, clears all template variables, and pushes the historical description to YouTube.",
    {
      id: z.string().describe("VidTempla UUID or YouTube video ID"),
      historyId: z.string().describe("History entry UUID (from get_description_history)"),
    },
    DESTRUCTIVE,
    async ({ id, historyId }) => {
      const userId = getSessionUserId();
      const denied = requireOrgAdmin(userId, "revert_description");
      if (denied) return denied;
      const orgId = getSessionOrgId();
      const result = await revertDescription(id, historyId, userId, orgId);
      logMcpRequest(userId, "revert_description", 0, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );
}
