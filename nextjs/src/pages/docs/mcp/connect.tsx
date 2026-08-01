import DocsArticle from "@/components/docs/DocsArticle";

export default function McpConnectPage() {
  return (
    <DocsArticle
      path="/docs/mcp/connect"
      title="Connect an MCP client"
      description="Connect Claude Code or another Streamable HTTP MCP client to VidTempla."
    >
      <p>
        VidTempla’s MCP server uses Streamable HTTP at
        <code>https://www.vidtempla.com/api/mcp</code>. Open MCP Server in the
        dashboard for the current connection command and copy it into your MCP
        client configuration.
      </p>
      <pre>
        <code>
          claude mcp add --transport http vidtempla
          https://www.vidtempla.com/api/mcp -s user
        </code>
      </pre>
      <p>
        The first connection opens a browser sign-in flow. The server then uses
        the signed-in account and active organization to run tools on your
        behalf.
      </p>
      <h2>Available tool families</h2>
      <p>
        Tools cover channels, videos, templates, containers, playlists,
        comments, and analytics. Write tools can change YouTube data or
        VidTempla configuration; review the tool description and arguments
        before allowing an agent to run one.
      </p>
      <h2>Tool catalog</h2>
      <ul>
        <li>
          <strong>Channels:</strong> list, inspect, overview, and sync.
        </li>
        <li>
          <strong>Videos:</strong> list, inspect, assign, update variables,
          history, drift, and revert.
        </li>
        <li>
          <strong>Templates and containers:</strong> list, inspect, create,
          update, delete, and impact analysis.
        </li>
        <li>
          <strong>YouTube operations:</strong> search, playlists, and comments.
        </li>
        <li>
          <strong>Analytics:</strong> channel analytics and flexible analytics
          queries.
        </li>
      </ul>
      <p>
        The generated <a href="/llms.txt">llms.txt index</a> lists every
        currently registered MCP tool by name.
      </p>
    </DocsArticle>
  );
}
