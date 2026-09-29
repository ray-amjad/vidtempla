import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const routerPath = resolve(scriptDir, "../src/server/api/routers/dashboard/youtube.ts");
const source = readFileSync(routerPath, "utf8");

const containerRouterStart = source.indexOf("containers: router({");
const templateRouterStart = source.indexOf("templates: router({", containerRouterStart);

assert.notEqual(containerRouterStart, -1, "containers router block was not found");
assert.notEqual(templateRouterStart, -1, "templates router block was not found");

const containerRouter = source.slice(containerRouterStart, templateRouterStart);
const getAffectedVideosStart = containerRouter.indexOf("getAffectedVideos: orgProcedure");
const procedureEnd = containerRouter.indexOf("  }),", getAffectedVideosStart);

assert.notEqual(
  getAffectedVideosStart,
  -1,
  "containers.getAffectedVideos procedure was not found"
);
assert.notEqual(procedureEnd, -1, "containers.getAffectedVideos procedure end was not found");

const procedure = containerRouter.slice(getAffectedVideosStart, procedureEnd);

assert.match(
  procedure,
  /\.innerJoin\(\s*containers\s*,\s*eq\(\s*containers\.id\s*,\s*youtubeVideos\.containerId\s*\)\s*\)/s,
  "containers.getAffectedVideos must join youtubeVideos through containers"
);
assert.match(
  procedure,
  /eq\(\s*youtubeVideos\.containerId\s*,\s*input\.containerId\s*\)/s,
  "containers.getAffectedVideos must filter by the requested container id"
);
assert.match(
  procedure,
  /eq\(\s*containers\.organizationId\s*,\s*ctx\.organizationId\s*\)/s,
  "containers.getAffectedVideos must filter by the active organization"
);

console.log("youtube router org guard checks passed");

// ─── #156 Proof #9 (I9): moderation router roles ─────────────────────────────
//
// Every mutation in the moderation router must be `orgAdminProcedure`, except
// `suggestCorrection`, the one verb a member may use, which must be
// `orgProcedure`. Queries must be org-scoped (`orgProcedure` or
// `orgAdminProcedure`). The expected mutation list is asserted in both
// directions, so the check cannot pass on an empty or renamed router, and a new
// mutation fails until someone decides its role here.

const MEMBER_MUTATIONS = ["suggestCorrection"];
const ADMIN_MUTATIONS = [
  "setChannelAutomation",
  "resumeAutomation",
  "setModerationRules",
  "saveRubricDraft",
  "dryRunRubric",
  "publishRubric",
  "acceptExample",
  "rejectExample",
  "releaseHeldComment",
  "applyManualAction",
];
const ORG_BUILDERS = new Set(["orgProcedure", "orgAdminProcedure"]);

const moderationPath = resolve(scriptDir, "../src/server/api/routers/dashboard/moderation.ts");
const dashboardPath = resolve(scriptDir, "../src/server/api/routers/dashboard.ts");

assert.ok(existsSync(moderationPath), "src/server/api/routers/dashboard/moderation.ts was not found");

/** Drops block and line comments so a commented-out builder cannot satisfy the check. */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

const moderationSource = stripComments(readFileSync(moderationPath, "utf8"));

const initImport = moderationSource.match(/import\s*\{([^}]*)\}\s*from\s*["']@\/server\/trpc\/init["']/);
assert.ok(initImport, "moderation.ts must import its procedure builders from @/server/trpc/init");
const importedBuilders = initImport[1]
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
for (const name of importedBuilders) {
  assert.ok(
    ["orgProcedure", "orgAdminProcedure", "router"].includes(name),
    `moderation.ts imports ${name} from trpc/init; only orgProcedure, orgAdminProcedure and router (no aliases) are allowed`
  );
}
assert.doesNotMatch(
  moderationSource,
  /(?:const|let|var)\s+\w+\s*=\s*(?:orgProcedure|orgAdminProcedure)\b/,
  "moderation.ts must not alias a procedure builder; use orgProcedure / orgAdminProcedure at each procedure"
);

const routerStart = moderationSource.search(/export\s+const\s+moderationRouter\s*=\s*router\(\s*\{/);
assert.notEqual(routerStart, -1, "export const moderationRouter = router({ was not found");
const routerBody = moderationSource.slice(routerStart);

// Top-level entries are indented two spaces: `  name: builder`.
const entryRe = /^ {2}([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$.]*)/gm;
const entries = [...routerBody.matchAll(entryRe)].map((m, i, all) => ({
  name: m[1],
  builder: m[2].split(".")[0],
  body: routerBody.slice(m.index, i + 1 < all.length ? all[i + 1].index : routerBody.length),
}));
assert.ok(entries.length > 0, "no procedures were found in moderationRouter");

const names = entries.map((e) => e.name);
assert.equal(new Set(names).size, names.length, `duplicate procedure names in moderationRouter: ${names.join(", ")}`);

const mutations = [];
const queries = [];
for (const entry of entries) {
  assert.ok(
    ORG_BUILDERS.has(entry.builder),
    `moderation.${entry.name} uses ${entry.builder}; every moderation procedure must be orgProcedure or orgAdminProcedure`
  );
  const isMutation = /\.mutation\s*\(/.test(entry.body);
  const isQuery = /\.query\s*\(/.test(entry.body);
  assert.ok(isMutation !== isQuery, `moderation.${entry.name} must be exactly one of .query( or .mutation(`);
  (isMutation ? mutations : queries).push(entry);
}

const expected = [...ADMIN_MUTATIONS, ...MEMBER_MUTATIONS].sort();
const found = mutations.map((m) => m.name).sort();
assert.deepEqual(
  found,
  expected,
  "moderationRouter mutations differ from the expected list; add a new mutation to ADMIN_MUTATIONS or MEMBER_MUTATIONS deliberately"
);

for (const m of mutations) {
  const want = MEMBER_MUTATIONS.includes(m.name) ? "orgProcedure" : "orgAdminProcedure";
  assert.equal(m.builder, want, `moderation.${m.name} is a mutation and must use ${want} (I9), found ${m.builder}`);
}

const dashboardSource = stripComments(readFileSync(dashboardPath, "utf8"));
assert.match(
  dashboardSource,
  /^\s*moderation\s*:\s*moderationRouter\s*,?\s*$/m,
  "dashboard.ts must register moderation: moderationRouter"
);

console.log(
  `moderation router org guard checks passed: ${mutations.length} mutations (${mutations.length - MEMBER_MUTATIONS.length} orgAdminProcedure, ${MEMBER_MUTATIONS.length} orgProcedure), ${queries.length} queries on org procedures`
);

