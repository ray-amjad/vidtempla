// #156 review round 2: static checks for fixes that live in adapter code the
// strip-types runner cannot import (Drizzle queries behind `@/` aliases).
// Files are read with fs, never grep (a NUL byte makes grep skip a file).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

/** The body of `export async function name(` up to the next top-level export. */
function fnBody(src, name) {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next).replace(/\s+/g, " ");
}

test("R2 #3: the classifications list meta carries `total`, as the v1 envelope convention requires", () => {
  const route = read("src/app/api/v1/youtube/comments/classifications/route.ts").replace(/\s+/g, " ");
  assert.match(route, /apiSuccess\(result\.data\.items, \{[^}]*total: result\.data\.total/, "route meta.total");
  const queries = fnBody(read("src/lib/moderation/queries.ts"), "listClassifications");
  assert.match(queries, /withTotal: true/, "listClassifications asks for the count");
  assert.match(queries, /total: res\.data\.total/, "listClassifications returns it");
  const yaml = read("public/openapi.yaml");
  const op = yaml.slice(yaml.indexOf("/youtube/comments/classifications:"));
  const meta = op.slice(op.indexOf("meta:"), op.indexOf('"400":'));
  assert.match(meta, /total:\s+type: integer/, "OpenAPI documents meta.total");
});

test("R2 #2: removing an accepted, unpublished example from the draft records it, so the next draft does not re-add it", () => {
  const body = fnBody(read("src/lib/moderation/service.ts"), "saveRubricDraft");
  // The draft is rebuilt from accepted examples with no includedInVersion;
  // the removed ones must leave that set.
  assert.match(body, /update\(commentRubricExamples\)/, "saveRubricDraft updates the example rows");
  assert.match(body, /status: "rejected"/, "removed examples become rejected");
  assert.match(body, /eq\(commentRubricExamples\.status, "accepted"\)/, "only accepted ones");
  assert.match(body, /isNull\(commentRubricExamples\.includedInVersion\)/, "only unpublished ones");
});
