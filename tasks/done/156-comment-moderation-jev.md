# #156 Automatic YouTube comment classification and moderation with Jev

Store each new viewer comment on an enabled channel, score it with TypeSafe Jev,
and apply owner-defined rules `{label, threshold, action}` through one
moderation chokepoint (`applyModerationDecision`). Owners improve the rubric by
approving examples taken from corrections. Existing comment tools, REST/MCP
write endpoints, credit costs and description sync are unchanged.

Issue: https://github.com/ray-amjad/vidtempla/issues/156

## Phases

1. Schema, migration, pure rule evaluator and ingest filter (Proofs #1 rules part, #4, #7)
2. `applyModerationDecision` chokepoint, caps, snapshots (Proofs #2, #6, #8)
3. Jev adapter, sweep, reclassify, workflows, cron (Proofs #3, #5, #10, #11)
4. tRPC, org guards, REST, MCP, docs (Proof #9)
5. Dashboard UI, close task

## Proof

| # | Proves | Check | Where | Phase |
| --- | --- | --- | --- | --- |
| 1 | Goal 2, I3 | Rule evaluator on `spam-comments.txt` + multi-rule, exactly 0.90 | `scripts/unit/comment-rules.mjs` | 1 |
| 2 | I2 | 101 rejects + 11 deletes → exactly 100 / 10 reach the fake | `scripts/unit/moderation-caps.mjs` | 2 |
| 3 | I4, Goal 3 | Reclassify skips actioned comments; held + now clean → maybe release | `scripts/unit/comment-rules.mjs` | 3 |
| 4 | I5, D10 scope | Ingest filter: own-channel and about-channel dropped, replies kept | `scripts/unit/comment-ingest.mjs` | 1 |
| 5 | Credits, stopping rules | Fake meter 1 / 50; empty balance and breaker skip with cursor advanced | `scripts/unit/comment-sweep.mjs` | 3 |
| 6 | I6 | Snapshot before the fake YouTube call, `source = 'auto'` | `scripts/unit/moderation-caps.mjs` | 2 |
| 7 | I8 | Every new table references `youtube_channels` with cascade | `scripts/unit/comment-schema.mjs` | 1 |
| 8 | I1 | Grep test: only the chokepoint imports moderation/delete client functions | `scripts/unit/moderation-chokepoint.mjs` | 2 |
| 9 | I9 | Every new mutating tRPC procedure is `orgAdminProcedure` except `suggestCorrection` | `npm run test:org-guards` | 4 |
| 10 | Jev failure | Fake 529 → `unscored`, no decision, never retried | `scripts/unit/comment-sweep.mjs` | 3 |
| 11 | I7 | Injection payload: YouTube fake gets only IDs, Jev fake gets text only in `state` | `scripts/unit/comment-sweep.mjs` | 3 |

## Fail-first log

Each test is written first against a stub, run with `npm run test:unit`
(from `nextjs/`), and the failing counts are recorded here before the
implementation lands.

### Phase 1 — 2026-09-29

**Red** (stub `core.ts` returning empty/null values, no new tables in `schema.ts`):

| File | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `comment-rules.mjs` | 14 | 4 | 10 |
| `comment-ingest.mjs` | 16 | 0 | 16 |
| `comment-schema.mjs` | 11 | 1 | 10 |
| `npm run test:unit` total | 85 | 49 | 36 |

The 5 stub passes assert "no action" / "empty is accepted" outcomes the stub
gets right by construction (spam file parses, "Great video!" takes no action,
an empty rule set is valid, an unknown label is ignored, and the
table-completeness guard with no new tables yet). Every other new test fails.

**Green** (implementation in `src/lib/moderation/core.ts`, 8 tables in
`src/db/schema.ts`, migration `drizzle/0024_sleepy_human_torch.sql`):

| File | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `comment-rules.mjs` | 14 | 14 | 0 |
| `comment-ingest.mjs` | 16 | 16 | 0 |
| `comment-schema.mjs` | 11 | 11 | 0 |
| `npm run test:unit` total | 85 | 85 | 0 |

`npm run test:org-guards` and `npx tsc --noEmit -p .` pass.

Note: `spam-comments.txt` holds 2 entries, not the 5 the plan assumed; the
test asserts at least 2 and runs every entry.

### Phase 2 — 2026-09-29

**Red** (stub `applyDecisions` in `core.ts` returning an empty result; no
`setCommentModerationStatus` in `clients/youtube.ts`; no `moderation/apply.ts`):

| File | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `moderation-caps.mjs` | 25 | 1 | 24 |
| `moderation-chokepoint.mjs` | 8 | 4 | 4 |
| `npm run test:unit` total | 118 | 90 | 28 |

The 5 stub passes hold by construction: "only comment ids reach the YouTube
port" (the stub calls nothing), and four chokepoint guards that are true before
any code exists (the scan is non-vacuous, no other file names
`setCommentModerationStatus`, the feature's other files import no YouTube
write, `core.ts` has no runtime imports). The four that need the chokepoint
(`client defines setCommentModerationStatus`, `only apply.ts imports it`,
`deleteComment importers`, `apply.ts exports applyModerationDecision`) fail.

**Green** (`applyDecisions` in `src/lib/moderation/core.ts`,
`setCommentModerationStatus` in `src/lib/clients/youtube.ts`,
`applyModerationDecision` + Drizzle adapters in `src/lib/moderation/apply.ts`,
credit helpers exported from `src/lib/services/comments.ts`):

| File | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `moderation-caps.mjs` | 25 | 25 | 0 |
| `moderation-chokepoint.mjs` | 8 | 8 | 0 |
| `npm run test:unit` total | 118 | 118 | 0 |

`npm run test:org-guards`, `npm run test:docs-coverage` and
`npx tsc --noEmit -p .` pass. The chokepoint test was also mutation-checked:
a temporary file under `src/lib/moderation/` importing
`setCommentModerationStatus as s` through a relative path, with a NUL byte in
it, failed 3 of its 8 tests; the file was then removed.

### Phase 3 — 2026-09-29

**Red** (stub `sweepBegin` / `sweepScoreChunk` / `sweepChannel` /
`reclassifyChunk` / `dryRun` in `core.ts` returning empty terminal results;
stub `jev.ts` whose port always returns `not_configured`):

| File | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `comment-sweep.mjs` | 19 | 1 | 18 |
| `comment-rules.mjs` | 18 | 14 | 4 |
| `npm run test:unit` total | 141 | 119 | 22 |

The one sweep pass is "a missing TYPESAFE_API_KEY is `not_configured`",
which the stub adapter returns by construction. The 14 rules passes are the
phase-1 tests; the 4 new reclassify tests (Proof #3) fail.

**Green** (sweep, reclassify and dry run in `src/lib/moderation/core.ts`,
the Jev adapter in `src/lib/moderation/jev.ts`, Drizzle adapters in
`store.ts` / `deps.ts`, `service.ts`, `queries.ts`, the workflows
`src/workflows/comment-sweep.ts` / `comment-reclassify.ts` and the cron
route `src/app/api/workflows/comment-sweep/route.ts`):

| File | Tests | Pass | Fail |
| --- | --- | --- | --- |
| `comment-sweep.mjs` | 19 | 19 | 0 |
| `comment-rules.mjs` | 18 | 18 | 0 |
| `npm run test:unit` total | 141 | 141 | 0 |

`npm run test:org-guards`, `npm run test:docs-coverage` and
`npx tsc --noEmit -p .` pass. The chokepoint test still covers the new files:
a temporary `deleteComment` import added to `src/lib/moderation/deps.ts`
failed 2 of its 8 tests, and was then removed.

### Phase 4 — 2026-09-29

Proof #9 lives in `nextjs/scripts/check-youtube-router-org-guards.mjs`
(`npm run test:org-guards`), a plain assert script rather than `node:test`,
so its counts are checks, not tests. It parses
`src/server/api/routers/dashboard/moderation.ts` with comments stripped,
pins the expected mutation list in both directions (10 admin mutations plus
`suggestCorrection`), requires every mutation except `suggestCorrection` to be
`orgAdminProcedure`, requires `suggestCorrection` to be `orgProcedure`,
requires every query to be on an org procedure, forbids builder aliases, and
checks that `dashboard.ts` registers the router.

**Red 1** (guard written first, no `moderation.ts` yet): the existing youtube
check passes, then `AssertionError: src/server/api/routers/dashboard/moderation.ts
was not found`, exit 1.

**Green** (router written and registered):
`moderation router org guard checks passed: 11 mutations (10 orgAdminProcedure,
1 orgProcedure), 8 queries on org procedures`, exit 0.

**Red 2** (fail-first as briefed: `publishRubric` flipped to `orgProcedure`):
`AssertionError: moderation.publishRubric is a mutation and must use
orgAdminProcedure (I9), found orgProcedure`, exit 1. Reverted, and green again.

Other mutations, each run on its own and reverted (8 of 8 failed, exit 1):

| Mutation | Failure |
| --- | --- |
| `publishRubric` → `orgProcedure` | must use orgAdminProcedure |
| `suggestCorrection` → `orgAdminProcedure` | must use orgProcedure |
| `dryRunRubric` `.mutation(` → `.query(` | mutation list differs |
| `applyManualAction` removed | mutation list differs |
| empty `router({})` | no procedures found |
| `rejectExample: /* orgAdminProcedure */ orgProcedure` | must use orgAdminProcedure |
| `const adminish = orgProcedure` alias | must not alias a builder |
| `moderation: moderationRouter` removed from `dashboard.ts` | must register |

After the phase: `npm run test:unit` 141/141 (no new unit tests in this
phase), `npm run test:org-guards` passes, `npm run test:docs-coverage` passes
(47/47 REST operations, 47/47 MCP tools, 13/13 dashboard surfaces), and
`npx tsc --noEmit -p .` is clean.

### Phase 5 — 2026-09-29

The dashboard is UI, so the unit gate is the part of it that is pure: the
threshold notes of the rules editor (spec boundary rows: threshold 0 must
warn, threshold 1 matches only exactly 1.0), in
`src/components/youtube/moderation/rule-notes.ts`, tested by
`scripts/unit/moderation-rule-notes.mjs`.

**Red** (mutation: the threshold-0 branch disabled and the upper bound
widened to 2): `moderation-rule-notes.mjs` 4 tests, 2 pass, 2 fail. Reverted.

**Red** (`docs-manifest.json` without the `dashboard/youtube/moderation`
claim, after the tab was added): `npm run test:docs-coverage` exits 1 with
`uncovered dashboard surfaces: dashboard/youtube/moderation`.

**Green:**

| Check | Result |
| --- | --- |
| `npm run test:unit` | 145 / 145 pass |
| `npm run test:org-guards` | pass (11 mutations: 10 admin, 1 member; 8 queries) |
| `npm run test:docs-coverage` | 47/47 REST, 47/47 MCP, 14/14 dashboard surfaces |
| `npx tsc --noEmit -p .` | clean |
| `npx eslint` on the changed files | clean |

Not verified yet: the tab has not been driven in a browser or against a
database. That is the next step (verify, with fakes), before the PR merges.

## Status

Done — built in 5 phases on `feat/156-comment-moderation-jev`, 2026-09-29.
Open for the PR body: the spec corrections from Ray's answers 1, 2 and 4
(org-less REST key is 401, I1 covers this feature only, examples go in Jev
`state`); the cron sweep's charges are not in `apiRequestLog` (phase 4 open
item); Jev pacing is per step, not global (phase 3 tradeoff).

## Review round 1 fixes

Fail-first counts: the new tests were added and run against the unfixed
code first, then the fix went in and the whole suite ran green.

| Finding | New tests | Failed before the fix | Pass after |
| --- | --- | --- | --- |
| #1 ledger error read as out of credits | 3 in `scripts/unit/comment-sweep.mjs` (`R1 #1 …`) | 3 / 3 | 3 / 3 |
| #5 "maybe release" always empty | 2 in `scripts/unit/comment-rules.mjs` (`R1 #5 …`) | 2 / 2 | 2 / 2 |
| #2 bulk-update phase 0 reconciles moderation snapshots | 1 static check in `scripts/unit/moderation-chokepoint.mjs` (`R1 #2 …`; the logic is a SQL filter in `services/comments.ts`, which the strip-types runner cannot import) | 1 / 1 | 1 / 1 |
| #3 cursor skips unread pages; same-second edge | 2 in `comment-sweep.mjs` (`R1 #3 …`) + the `filterIngest` cursor test in `comment-ingest.mjs` rewritten to the inclusive contract | 3 / 3 | 3 / 3 |
| #4 decisions that never start are lost | 3 in `comment-sweep.mjs` (time budget, chokepoint throw, backlog uses only the published version) + 1 in `comment-rules.mjs` (reclassify stamps only started decisions) | 4 / 4 | 4 / 4 |
| #4 guards (no double action) | 3 in `comment-sweep.mjs`: a definitive 4xx and an ambiguous 5xx are not re-sent; an owed decision the balance cannot pay waits while new comments are still scored | 0 / 3 (they pin behaviour the fix must keep) | 3 / 3 |

Schema: migration `drizzle/0025_jazzy_raza.sql` adds
`comment_automation.listing_page_token`, `comment_automation.listing_newest`,
`comment_scores.decided_at` (backfilled to `created_at`) and the partial index
`comment_scores_undecided_idx`.

Gates after the round (from `nextjs/`): `npm run test:unit` 160 / 160,
`npm run test:org-guards` pass, `npm run test:docs-coverage` 47/47/14 pass,
`npx tsc --noEmit -p .` clean.

## Review round 2 fixes

Fail-first counts: each new test was run against the unfixed code first
(the fix stashed), then with the fix.

| Finding | New tests | Failed before the fix | Pass after |
| --- | --- | --- | --- |
| #3 classifications meta has no `total` | 1 static check in `scripts/unit/moderation-static.mjs` (`R2 #3 …`; the count is a Drizzle query in `queries.ts`, covered by tsc) | 1 / 1 | 1 / 1 |
| #2 removed rubric examples come back in the next draft | 1 static check in `moderation-static.mjs` (`R2 #2 …`; SQL in `service.ts`, covered by tsc) | 1 / 1 | 1 / 1 |
| #6 fail-open credit charge treated as paid | 3 in `comment-sweep.mjs`, 1 in `comment-rules.mjs`, 2 in `moderation-caps.mjs` (`R2 #6 …`): sweep scoring, sweep action, reclassify scoring and the automatic chokepoint stop as `ledger`; dry run and a manual dashboard action keep fail-open | 4 / 6 (the 2 fail-open guards pin unchanged behaviour) | 6 / 6 |
| #7 an expired resume token skips the unread pages | 2 in `comment-sweep.mjs` (`R2 #7 …`): relist from page 1 ingests the gap and dedupes; a failed relist keeps the old cursor | 2 / 2 | 2 / 2 |
| #1 auth / rateLimit halts (and a YouTube 401) do not stop the run | 3 in `comment-sweep.mjs` (rateLimit and auth halts end `skipped: youtube error`, the decision stays owed and the next sweep applies it; `moderationErrorClass` maps a 401 to auth), 1 in `comment-rules.mjs` (reclassify auth halt), 1 in `moderation-caps.mjs` (`retryable` only on what never reached YouTube), 1 static check in `moderation-static.mjs` (the `apply.ts` classifier passes the 401; adapter, covered by tsc) | 6 / 6 | 6 / 6 |
| #4 automatic steps do not re-check `enabled` | 3 in `comment-sweep.mjs` (scoring step, backlog, chokepoint mid-chunk), 1 in `comment-rules.mjs` (reclassify), 2 in `moderation-caps.mjs` (automatic actor acts on nothing; a person's action does not depend on `enabled`), 1 static check in `moderation-static.mjs` (`publishRubric` / `setChannelAutomation` start reclassify; the `isAutomationEnabled` read is covered by tsc) | 6 / 7 (the manual-action guard pins unchanged behaviour) | 7 / 7 |
