// #156 Proof #8 (I1): every hold, reject, ban or delete of this feature goes
// through applyModerationDecision. A static check in the style of
// scripts/check-youtube-router-org-guards.mjs, over every file in src/.
//
// Files are read with fs, never grep: the shell `grep` silently skips a file
// that holds a NUL byte, which would turn a real importer into a false pass.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const srcDir = join(root, "src");

const CLIENT = "src/lib/clients/youtube.ts";
const CHOKEPOINT = "src/lib/moderation/apply.ts";
const COMMENT_SERVICE = "src/lib/services/comments.ts";

/** The YouTube client functions that change a comment's visibility or existence. */
const MODERATION_FNS = ["setCommentModerationStatus"];
const DELETE_FNS = ["deleteComment"];
/** Every comment write in the client; none may be imported by the feature's other files. */
const COMMENT_WRITE_FNS = [
  "setCommentModerationStatus",
  "deleteComment",
  "updateComment",
  "replyToComment",
  "postCommentThread",
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = walk(srcDir).map((full) => ({
  path: relative(root, full).split("\\").join("/"),
  text: readFileSync(full, "utf8"),
}));

/** True when `spec` (an import specifier) names the YouTube client module. */
function isClientSpecifier(spec, fromPath) {
  if (spec === "@/lib/clients/youtube" || spec === "@/lib/clients/youtube.ts") return true;
  if (!spec.startsWith(".")) return false;
  const target = relative(root, resolve(root, dirname(fromPath), spec)).split("\\").join("/");
  return target === "src/lib/clients/youtube" || target === "src/lib/clients/youtube.ts";
}

/**
 * The client names a file can reach: named imports (with `as` renames), and a
 * namespace or dynamic import, which reaches every export — recorded as `*`.
 * Re-exports (`export { x } from`) count as imports too.
 */
function clientBindings(file) {
  const names = new Set();
  // The clause is limited to the characters an import clause can hold, so a
  // match can never run on from an earlier `export const …;` into a later import.
  const staticRe = /\b(?:import|export)\s+(type\s+)?([\w\s{},*$]*?)\s*\bfrom\s+["']([^"']+)["']/g;
  for (const m of file.text.matchAll(staticRe)) {
    if (!isClientSpecifier(m[3], file.path)) continue;
    if (m[1]) continue; // `import type { … }` is erased and cannot call anything
    const clause = m[2];
    if (/\*\s*as\s+\w+/.test(clause) || clause.trim() === "*") names.add("*");
    const braces = clause.match(/\{([\s\S]*)\}/);
    if (braces) {
      for (const part of braces[1].split(",")) {
        const t = part.trim();
        if (!t || t.startsWith("type ")) continue;
        names.add(t.split(/\s+as\s+/)[0].trim());
      }
    }
  }
  const dynamicRe = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of file.text.matchAll(dynamicRe)) {
    if (isClientSpecifier(m[1], file.path)) names.add("*");
  }
  return names;
}

function importersOf(fnNames) {
  return files
    .filter((f) => f.path !== CLIENT)
    .filter((f) => {
      const b = clientBindings(f);
      return fnNames.some((n) => b.has(n)) || b.has("*");
    })
    .map((f) => f.path)
    .sort();
}

test("the client defines setCommentModerationStatus and deleteComment", () => {
  const client = files.find((f) => f.path === CLIENT);
  assert.ok(client, `${CLIENT} not found`);
  assert.match(client.text, /export\s+async\s+function\s+setCommentModerationStatus\s*\(/);
  assert.match(client.text, /export\s+async\s+function\s+deleteComment\s*\(/);
});

test("the file scan is not vacuous", () => {
  assert.ok(files.length > 50, `only ${files.length} source files found under src/`);
  const importers = importersOf(COMMENT_WRITE_FNS);
  assert.ok(importers.includes(COMMENT_SERVICE), "the scan must see services/comments.ts import the client");
});

test("I1: only apply.ts imports setCommentModerationStatus", () => {
  assert.deepEqual(importersOf(MODERATION_FNS), [CHOKEPOINT]);
});

test("I1: deleteComment is imported only by the existing comment service and apply.ts", () => {
  // services/comments.ts keeps the pre-existing manual delete path (Ray's
  // answer 2: I1 covers this feature only).
  assert.deepEqual(importersOf(DELETE_FNS), [CHOKEPOINT, COMMENT_SERVICE].sort());
});

test("I1: no other file even names setCommentModerationStatus", () => {
  const namers = files
    .filter((f) => f.path !== CLIENT && f.path !== CHOKEPOINT)
    .filter((f) => /\bsetCommentModerationStatus\b/.test(f.text))
    .map((f) => f.path);
  assert.deepEqual(namers, []);
});

test("I1: the feature's other files import no YouTube comment write", () => {
  const featureFiles = files.filter(
    (f) =>
      f.path !== CHOKEPOINT &&
      (f.path.startsWith("src/lib/moderation/") ||
        /^src\/workflows\/comment-/.test(f.path) ||
        /^src\/app\/api\/workflows\/comment-/.test(f.path) ||
        f.path === "src/server/api/routers/dashboard/moderation.ts" ||
        /^src\/components\/youtube\/Moderation/.test(f.path))
  );
  assert.ok(
    featureFiles.some((f) => f.path === "src/lib/moderation/core.ts"),
    "core.ts must be among the checked files"
  );
  for (const f of featureFiles) {
    const b = clientBindings(f);
    const hits = COMMENT_WRITE_FNS.filter((n) => b.has(n));
    assert.deepEqual(hits, [], `${f.path} imports ${hits.join(", ")}`);
    assert.ok(!b.has("*"), `${f.path} imports the whole YouTube client`);
  }
});

test("apply.ts exports applyModerationDecision and is the only module that implements the moderation port", () => {
  const apply = files.find((f) => f.path === CHOKEPOINT);
  assert.ok(apply, `${CHOKEPOINT} not found`);
  assert.match(apply.text, /export\s+async\s+function\s+applyModerationDecision\s*\(/);
  const implementers = files
    .filter((f) => /\bYouTubeModerationPort\b/.test(f.text))
    .filter((f) => /:\s*YouTubeModerationPort\b/.test(f.text))
    .map((f) => f.path)
    .filter((p) => p !== "src/lib/moderation/types.ts" && p !== "src/lib/moderation/core.ts");
  assert.deepEqual(implementers, [CHOKEPOINT]);
});

test("core.ts has no runtime imports (strip-types, and no path to the client)", () => {
  const core = files.find((f) => f.path === "src/lib/moderation/core.ts");
  const runtimeImports = [...core.text.matchAll(/^\s*import\s+(?!type\b)[^;]*?from\s+["'][^"']+["']/gm)];
  assert.deepEqual(runtimeImports.map((m) => m[0]), []);
});
