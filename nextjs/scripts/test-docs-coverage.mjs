import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { appRoot } from "./lib/docs-sources.mjs";
import { checkDocsCoverage } from "./check-docs-coverage.mjs";

const manifestPath = path.join(appRoot, "docs-manifest.json");
const originalManifest = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(originalManifest);

try {
  manifest.pages[0].coverage.rest.push("GET /api/v1/channels");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await checkDocsCoverage({
    expectedFailure: "REST operations both claimed and exempted",
  });
  console.log("Docs coverage mutation test passed.");
} finally {
  await writeFile(manifestPath, originalManifest, "utf8");
}
