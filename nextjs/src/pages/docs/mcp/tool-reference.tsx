import DocsArticle from "@/components/docs/DocsArticle";

export default function McpToolReferencePage() {
  return (
    <DocsArticle
      path="/docs/mcp/tool-reference"
      title="MCP tool families"
      description="Choose the VidTempla MCP tool family that matches the YouTube or description-management task at hand."
    >
      <p>
        The MCP server exposes tools in focused families. Your client presents
        each tool’s arguments and whether it can write data before it runs.
      </p>
      <h2>Channels and videos</h2>
      <p>
        Use channel tools to list, inspect, synchronize, search, and retrieve
        overview or analytics data. Video tools list and inspect managed videos,
        assign containers, update variables, inspect history, check drift,
        resolve drift, and revert descriptions.
      </p>
      <h2>Descriptions</h2>
      <p>
        Template and container tools create, inspect, update, delete, and check
        the impact of reusable description building blocks.
      </p>
      <h2>YouTube operations and analytics</h2>
      <p>
        Playlist and comment tools manage the connected channel’s YouTube data.
        Search tools find your videos or YouTube results, while analytics tools
        fetch channel, video, retention, and query-based analytics.
      </p>
      <p>
        For the complete current list of tool names, use the generated{" "}
        <a href="/llms.txt">llms.txt index</a>.
      </p>
    </DocsArticle>
  );
}
