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
