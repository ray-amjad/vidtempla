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
