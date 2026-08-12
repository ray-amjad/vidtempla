import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { toMcp, mcpQuotaExceeded, getSessionUserId, getSessionOrgId, logMcpRequest, requireOrgAdmin, READ, WRITE, DESTRUCTIVE } from "../helpers";
import { consumeCredits } from "@/lib/plan-limits";
import {
  listPlaylists,
  createPlaylist,
  getPlaylist,
  updatePlaylist,
  deletePlaylist,
  listPlaylistItems,
  addPlaylistItem,
  deletePlaylistItem,
} from "@/lib/services/playlists";

export function registerPlaylistTools(server: McpServer) {
  server.tool(
    "list_playlists",
    "List all playlists on a YouTube channel, including title, description, privacy status, and video count.",
    {
      channelId: z.string().describe("YouTube channel ID"),
      maxResults: z.number().optional().describe("Number of playlists to return (1-50, default 25)"),
      pageToken: z.string().optional().describe("Pagination token from a previous response's nextPageToken"),
    },
    READ,
    async ({ channelId, maxResults, pageToken }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 1);
      if (!credits.success) return mcpQuotaExceeded(userId, "list_playlists");
      const result = await listPlaylists(channelId, userId, { maxResults, pageToken }, orgId);
      logMcpRequest(userId, "list_playlists", 1, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "create_playlist",
    "Create a new YouTube playlist. Defaults to private visibility.",
    {
      channelId: z.string().describe("YouTube channel ID to create the playlist on"),
      title: z.string().describe("Playlist title"),
      description: z.string().optional().describe("Playlist description"),
      privacyStatus: z.enum(["public", "unlisted", "private"]).optional().describe("Visibility (default: 'private')"),
    },
    WRITE,
    async ({ channelId, title, description, privacyStatus }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 50);
      if (!credits.success) return mcpQuotaExceeded(userId, "create_playlist");
      const result = await createPlaylist(channelId, userId, { title, description, privacyStatus }, orgId);
      logMcpRequest(userId, "create_playlist", 50, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "get_playlist",
    "Get details of a specific YouTube playlist including title, description, privacy status, and item count.",
    {
      playlistId: z.string().describe("YouTube playlist ID"),
      channelId: z.string().describe("YouTube channel ID that owns the playlist"),
    },
    READ,
    async ({ playlistId, channelId }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 1);
      if (!credits.success) return mcpQuotaExceeded(userId, "get_playlist");
      const result = await getPlaylist(playlistId, channelId, userId, orgId);
      logMcpRequest(userId, "get_playlist", 1, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "update_playlist",
    "Update a YouTube playlist's title, description, or privacy status. Only provided fields are changed; others are preserved.",
    {
      playlistId: z.string().describe("YouTube playlist ID to update"),
      channelId: z.string().describe("YouTube channel ID that owns the playlist"),
      title: z.string().optional().describe("New playlist title"),
      description: z.string().optional().describe("New playlist description"),
      privacyStatus: z.enum(["public", "unlisted", "private"]).optional().describe("New visibility setting"),
    },
    WRITE,
    async ({ playlistId, channelId, title, description, privacyStatus }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 50);
      if (!credits.success) return mcpQuotaExceeded(userId, "update_playlist");
      const result = await updatePlaylist(playlistId, channelId, userId, { title, description, privacyStatus }, orgId);
      logMcpRequest(userId, "update_playlist", 50, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "delete_playlist",
    "Permanently delete a YouTube playlist. This cannot be undone. Requires the owner or admin role in the workspace; a member gets FORBIDDEN_ROLE and nothing is deleted. All items in the playlist will be removed (videos themselves are not deleted).",
    {
      playlistId: z.string().describe("YouTube playlist ID to delete"),
      channelId: z.string().describe("YouTube channel ID that owns the playlist"),
    },
    DESTRUCTIVE,
    async ({ playlistId, channelId }) => {
      const userId = getSessionUserId();
      // Before the ledger: a refused call bills nothing and touches no channel.
      const denied = requireOrgAdmin(userId, "delete_playlist");
      if (denied) return denied;
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 50);
      if (!credits.success) return mcpQuotaExceeded(userId, "delete_playlist");
      const result = await deletePlaylist(playlistId, channelId, userId, orgId);
      logMcpRequest(userId, "delete_playlist", 50, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "list_playlist_items",
    "List videos in a YouTube playlist, in playlist order. Returns video IDs, titles, positions, and thumbnails.",
    {
      playlistId: z.string().describe("YouTube playlist ID"),
      channelId: z.string().describe("YouTube channel ID that owns the playlist"),
      maxResults: z.number().optional().describe("Number of items to return (1-50, default 25)"),
      pageToken: z.string().optional().describe("Pagination token from a previous response's nextPageToken"),
    },
    READ,
    async ({ playlistId, channelId, maxResults, pageToken }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 1);
      if (!credits.success) return mcpQuotaExceeded(userId, "list_playlist_items");
      const result = await listPlaylistItems(playlistId, channelId, userId, { maxResults, pageToken }, orgId);
      logMcpRequest(userId, "list_playlist_items", 1, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "add_playlist_item",
    "Add a video to a YouTube playlist. The video is appended to the end of the playlist.",
    {
      playlistId: z.string().describe("YouTube playlist ID to add the video to"),
      channelId: z.string().describe("YouTube channel ID that owns the playlist"),
      videoId: z.string().describe("YouTube video ID to add"),
    },
    WRITE,
    async ({ playlistId, channelId, videoId }) => {
      const userId = getSessionUserId();
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 50);
      if (!credits.success) return mcpQuotaExceeded(userId, "add_playlist_item");
      const result = await addPlaylistItem(playlistId, channelId, userId, videoId, orgId);
      logMcpRequest(userId, "add_playlist_item", 50, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );

  server.tool(
    "delete_playlist_item",
    "Remove a video from a YouTube playlist. Requires the owner or admin role in the workspace; a member gets FORBIDDEN_ROLE and nothing is removed. Use list_playlist_items to find the item ID (this is different from the video ID).",
    {
      itemId: z.string().describe("Playlist item ID (from list_playlist_items, NOT the video ID)"),
      channelId: z.string().describe("YouTube channel ID that owns the playlist"),
    },
    DESTRUCTIVE,
    async ({ itemId, channelId }) => {
      const userId = getSessionUserId();
      const denied = requireOrgAdmin(userId, "delete_playlist_item");
      if (denied) return denied;
      const orgId = getSessionOrgId();
      const credits = await consumeCredits(orgId, 50);
      if (!credits.success) return mcpQuotaExceeded(userId, "delete_playlist_item");
      const result = await deletePlaylistItem(itemId, channelId, userId, orgId);
      logMcpRequest(userId, "delete_playlist_item", 50, "error" in result ? 400 : 200);
      return toMcp(result);
    }
  );
}
