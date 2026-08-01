import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appRoot,
  difference,
  duplicateValues,
  extractDashboardSurfaces,
  extractMcpTools,
  extractOpenApiOperations,
  extractRestOperations,
  readJson,
} from "./lib/docs-sources.mjs";
import { renderLlmsTxt } from "./generate-llms-txt.mjs";

function formatList(label, values) {
  return values.length === 0
    ? []
    : [`${label}:`, ...values.map((value) => `  - ${value}`)];
}

async function verifyPageSources(manifest) {
  const missing = [];
  for (const page of manifest.pages) {
    if (
      !page.path?.startsWith("/docs") ||
      !page.title ||
      !page.description ||
      !page.source
    ) {
      missing.push(`invalid manifest entry for ${page.path ?? "unknown path"}`);
      continue;
    }
    try {
      await access(path.join(appRoot, page.source));
    } catch {
      missing.push(`${page.path} declares missing source ${page.source}`);
    }
  }
  return missing;
}

function claimsFor(manifest, kind, extracted) {
  const claims = manifest.pages.flatMap((page) => page.coverage?.[kind] ?? []);
  if (!claims.includes("*")) return claims;
  if (claims.some((claim) => claim !== "*")) {
    throw new Error(
      `Wildcard ${kind} coverage cannot be mixed with explicit claims.`,
    );
  }
  return extracted;
}

function validateKind(kind, extracted, claimed, exempted) {
  const errors = [];
  errors.push(
    ...formatList(`duplicate ${kind} claims`, duplicateValues(claimed)),
  );
  errors.push(
    ...formatList(`duplicate ${kind} exemptions`, duplicateValues(exempted)),
  );
  errors.push(
    ...formatList(`unknown ${kind} claims`, difference(claimed, extracted)),
  );
  errors.push(
    ...formatList(`stale ${kind} exemptions`, difference(exempted, extracted)),
  );
  errors.push(
    ...formatList(
      `uncovered ${kind}`,
      difference(extracted, [...claimed, ...exempted]),
    ),
  );
  errors.push(
    ...formatList(
      `${kind} both claimed and exempted`,
      claimed.filter((value) => exempted.includes(value)),
    ),
  );
  return errors;
}

export async function checkDocsCoverage({ expectedFailure = null } = {}) {
  const [
    manifest,
    exemptions,
    rest,
    mcp,
    dashboard,
    openapi,
    generatedLlms,
    checkedInLlms,
  ] = await Promise.all([
    readJson("docs-manifest.json"),
    readJson("docs-coverage.exempt.json"),
    extractRestOperations(),
    extractMcpTools(),
    extractDashboardSurfaces(),
    extractOpenApiOperations(),
    renderLlmsTxt(),
    readFile(path.join(appRoot, "public/llms.txt"), "utf8"),
  ]);
  const errors = await verifyPageSources(manifest);
  errors.push(
    ...validateKind(
      "REST operations",
      rest,
      claimsFor(manifest, "rest", rest),
      exemptions.rest ?? [],
    ),
  );
  errors.push(
    ...validateKind(
      "MCP tools",
      mcp,
      claimsFor(manifest, "mcp", mcp),
      exemptions.mcp ?? [],
    ),
  );
  errors.push(
    ...validateKind(
      "dashboard surfaces",
      dashboard,
      claimsFor(manifest, "dashboard", dashboard),
      exemptions.dashboard ?? [],
    ),
  );
  errors.push(
    ...formatList(
      "unexplained REST vs OpenAPI drift",
      difference(rest, [...openapi, ...(exemptions.openapi ?? [])]),
    ),
  );
  errors.push(
    ...formatList("unexplained OpenAPI operations", difference(openapi, rest)),
  );
  errors.push(
    ...formatList(
      "stale OpenAPI exceptions",
      (exemptions.openapi ?? []).filter(
        (operation) => !rest.includes(operation) || openapi.includes(operation),
      ),
    ),
  );
  if (checkedInLlms !== generatedLlms) {
    errors.push("public/llms.txt is stale; run npm run generate:llms");
  }

  if (expectedFailure) {
    const matched = errors.some((error) => error.includes(expectedFailure));
    if (!matched) {
      throw new Error(
        `Expected docs coverage to fail with: ${expectedFailure}\nActual errors:\n${errors.join("\n")}`,
      );
    }
    return { errors, rest, mcp, dashboard };
  }
  if (errors.length > 0) {
    throw new Error(`Docs coverage failed:\n${errors.join("\n")}`);
  }
  return { rest, mcp, dashboard, exemptions };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await checkDocsCoverage();
  console.log(
    `Docs coverage: ${result.rest.length}/${result.rest.length} REST operations, ${result.mcp.length}/${result.mcp.length} MCP tools, ${result.dashboard.length}/${result.dashboard.length} dashboard surfaces, 0 uncovered; ${result.exemptions.rest.length + result.exemptions.mcp.length + result.exemptions.dashboard.length} temporary documentation exemptions and ${result.exemptions.openapi.length} OpenAPI exceptions.`,
  );
}
