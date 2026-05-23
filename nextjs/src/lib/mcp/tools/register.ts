import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerChannelTools } from "./channels";
import { registerVideoTools } from "./videos";
import { registerTemplateTools } from "./templates";
import { registerContainerTools } from "./containers";
import { registerAnalyticsTools } from "./analytics";
import { registerCommentTools } from "./comments";
import { registerPlaylistTools } from "./playlists";

/**
 * Registers all MCP tools on the server.
 * userId is resolved at call time via AsyncLocalStorage (see helpers.ts).
 */
export function registerAllTools(server: McpServer) {
  registerChannelTools(server);
  registerVideoTools(server);
  registerTemplateTools(server);
  registerContainerTools(server);
  registerAnalyticsTools(server);
  registerCommentTools(server);
  registerPlaylistTools(server);
}
