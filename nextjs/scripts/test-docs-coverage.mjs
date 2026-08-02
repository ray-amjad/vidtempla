import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { appRoot } from "./lib/docs-sources.mjs";
import { checkDocsCoverage } from "./check-docs-coverage.mjs";

const manifestPath = path.join(appRoot, "docs-manifest.json");
const originalManifest = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(originalManifest);

try {
  const restReference = manifest.pages.find(
    (page) => page.path === "/docs/api/rest-api",
  );
  if (!restReference)
    throw new Error(
      "REST API documentation page is missing from the manifest.",
    );
  restReference.coverage.rest = [];
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await checkDocsCoverage({
    expectedFailure: "uncovered REST operations",
  });
  console.log("Docs coverage mutation test passed.");
} finally {
  await writeFile(manifestPath, originalManifest, "utf8");
}
