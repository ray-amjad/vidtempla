import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appRoot,
  extractMcpTools,
  extractRestOperations,
  readJson,
} from "./lib/docs-sources.mjs";

export async function renderLlmsTxt() {
  const [manifest, restOperations, mcpTools] = await Promise.all([
    readJson("docs-manifest.json"),
    extractRestOperations(),
    extractMcpTools(),
  ]);
  const lines = [
    `# ${manifest.title}`,
    "",
    "> VidTempla manages YouTube video descriptions with templates, containers, and variables.",
    "",
    "## Documentation",
    "",
    ...manifest.pages.map(
      (page) =>
        `- [${page.title}](${manifest.baseUrl}${page.path}): ${page.description}`,
    ),
    `- [Interactive REST API reference](${manifest.baseUrl}/reference): Scalar API reference backed by OpenAPI.`,
    `- [OpenAPI specification](${manifest.baseUrl}/openapi.yaml): Machine-readable REST API specification.`,
    "",
    "## REST API operations",
    "",
    "All REST API operations use the `/api/v1` base path and API-key authentication.",
    "",
    ...restOperations.map((operation) => `- \`${operation}\``),
    "",
    "## MCP tools",
    "",
    "The Streamable HTTP MCP server is available at `https://www.vidtempla.com/api/mcp`.",
    "",
    ...mcpTools.map((tool) => `- \`${tool}\``),
  ];
  return `${lines.join("\n")}\n`;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await writeFile(
    path.join(appRoot, "public/llms.txt"),
    await renderLlmsTxt(),
    "utf8",
  );
}
