import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const appRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(entryPath) : [entryPath];
    }),
  );
  return nested.flat();
}

function routeSegment(segment) {
  const match = segment.match(/^\[([^\]]+)\]$/);
  return match ? `{${match[1]}}` : segment;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export async function extractRestOperations() {
  const root = path.join(appRoot, "src/app/api/v1");
  const routes = (await walk(root)).filter((file) =>
    file.endsWith("/route.ts"),
  );
  const operations = [];

  for (const route of routes) {
    const source = await readFile(route, "utf8");
    const relative = path.relative(root, path.dirname(route));
    const routePath = `/api/v1/${relative.split(path.sep).map(routeSegment).join("/")}`;
    const exportedMethods = [
      ...source.matchAll(
        /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\(/g,
      ),
    ].map((match) => match[1]);
    const allExportedMethods = [
      ...source.matchAll(
        /export\s+(?:async\s+)?(?:const|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g,
      ),
    ].map((match) => match[1]);

    if (allExportedMethods.length !== exportedMethods.length) {
      throw new Error(
        `Cannot statically extract REST methods from ${path.relative(appRoot, route)}.`,
      );
    }
    operations.push(
      ...exportedMethods.map((method) => `${method} ${routePath}`),
    );
  }

  return uniqueSorted(operations);
}

export async function extractMcpTools() {
  const root = path.join(appRoot, "src/lib/mcp/tools");
  const files = (await walk(root)).filter(
    (file) => file.endsWith(".ts") && !file.endsWith("/register.ts"),
  );
  const tools = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const calls = [...source.matchAll(/server\.tool\s*\(/g)];
    const literals = [
      ...source.matchAll(/server\.tool\s*\(\s*["']([^"']+)["']/g),
    ];
    if (calls.length !== literals.length) {
      throw new Error(
        `Cannot statically extract MCP tool names from ${path.relative(appRoot, file)}.`,
      );
    }
    tools.push(...literals.map((match) => match[1]));
  }

  return uniqueSorted(tools);
}

export async function extractDashboardSurfaces() {
  const orgRoot = path.join(appRoot, "src/pages/org/[slug]");
  const pages = (await walk(orgRoot)).filter((file) => file.endsWith(".tsx"));
  const surfaces = [];

  for (const page of pages) {
    const relative = path.relative(orgRoot, page).replace(/\.tsx$/, "");
    if (relative === "index") continue;

    if (relative === path.join("dashboard", "youtube", "index")) {
      const source = await readFile(page, "utf8");
      const tabValues = [
        ...source.matchAll(/<TabsTrigger\s+value=["']([^"']+)["']/g),
      ].map((match) => match[1]);
      if (tabValues.length === 0) {
        throw new Error(
          "Cannot statically extract YouTube Manager dashboard tabs.",
        );
      }
      surfaces.push(...tabValues.map((tab) => `dashboard/youtube/${tab}`));
      continue;
    }

    surfaces.push(relative.replace(/\\/g, "/").replace(/\/index$/, ""));
  }

  return uniqueSorted(surfaces);
}

export async function extractOpenApiOperations() {
  const source = await readFile(
    path.join(appRoot, "public/openapi.yaml"),
    "utf8",
  );
  const operations = [];
  let currentPath = null;

  for (const line of source.split("\n")) {
    const pathMatch = line.match(/^  (\/[^:]+):$/);
    if (pathMatch) {
      currentPath = pathMatch[1];
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):$/);
    if (methodMatch && currentPath) {
      operations.push(`${methodMatch[1].toUpperCase()} /api/v1${currentPath}`);
    }
  }

  return uniqueSorted(operations);
}

export async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(appRoot, relativePath), "utf8"));
}

export function difference(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => !rightSet.has(value));
}

export function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort();
}
