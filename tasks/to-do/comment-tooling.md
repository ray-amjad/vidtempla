# YouTube Comment Tooling

Agent-driven and dashboard-driven management of YouTube comments, with the primary use
case being the pinned top-level comment pointing to Ray's course: find it across the
channel by searching for the current URL, and rewrite it everywhere when the URL changes.

Extends the existing comment surface (`src/lib/clients/youtube.ts:651-785`,
`src/lib/services/comments.ts`, `src/lib/mcp/tools/comments.ts`,
`src/app/api/v1/youtube/comments/*`). Adds one table, a dashboard, and a bulk write path.

> **Revision note.** An independent audit found one fabricated claim, one missed API
> qualifier that broke a decided invariant, and five internal contradictions in the first
> version of this document. All are corrected below; the corrections are recorded in
> Verified facts and Changes to existing behavior so the diff is traceable.

---

## Decided invariants

**I1 — No stored comment state.** Comments are discovered by live search against YouTube
on every operation. There is no managed-comments table, no comment template, no container
binding, no drift detection and no sync engine. The agent (or the human) searches, gets
IDs back, and decides which to act on.

**I2 — Every destructive write is snapshotted before it happens.** No `comments.update` or
`comments.delete` may reach YouTube without a `comment_edits` row recording the prior text.
`comments.update` overwrites `textOriginal` in place and YouTube exposes no comment version
history, so this table is the only surviving copy of what a comment said. `reply_to_comment`
and `post_comment` create new content and write no row.

**I2a — Snapshot fidelity depends on authorship.** YouTube returns `textOriginal` only to
the comment's author (see Verified facts). For a comment the acting channel wrote, the
snapshot stores `textOriginal` and a restore is byte-exact. For a third-party comment —
the normal case for `delete_comment` — `textOriginal` comes back empty, so the snapshot
stores `textDisplay`, which is HTML-marked-up and is an audit record only, never a restore
source. `textSource` records which was captured. A restore is only offered for
`textSource = 'original'`.

**I3 — Update in place; never delete-and-repost.** Pinning cannot be read or set through
the API. A delete-and-repost cycle silently unpins the comment on every affected video
with no programmatic way to restore it, and also discards the comment's likes and original
timestamp. For Ray's course comment the operation is always `comments.update`.

**I4 — Removal is permanent and single-verb.** "Remove it" maps to `comments.delete`.
There is no reject/un-reject, no moderation queue, no `banAuthor`.

**I5 — The agent selects, the server fans out, in bounded batches.** Read tools return
candidates; the caller filters; one bulk call carries the chosen IDs with per-item
replacement text and the loop runs server-side. **A batch is capped at 40 items.** At 40
items a batch costs 80 YouTube round-trips and ~120 DB operations, which fits inside the
MCP handler's declared `maxDuration: 60` (`api/mcp/route.ts:16`). The REST bulk route must
declare an explicit `maxDuration`; none exists anywhere in `src` today. A 200-comment sweep
is 5 calls, looped by the caller. Background and scheduled execution remain non-goals, so
the cap is what makes the operation completable.

**I6 — A bulk batch is single-channel, validated before any write.** `channelId` is a
required parameter and every ID in the batch must belong to it. Because a comment ID
carries no channel binding, authorship is only knowable from the snapshot read — so a batch
runs in two phases: **phase 1** snapshots and validates all items; if any item is not
authored by the acting channel, the batch aborts with nothing written. **Phase 2** performs
the writes. The 40-item cap is what makes two-phase affordable.

**I7 — Quota exhaustion halts the batch.** On the first `quotaExceeded`, trip
`markYouTubeQuotaExhausted()` and stop. Remaining items are returned as `skipped`, never
attempted. Resume by re-sending the skipped IDs. Exhaustion during phase 1 aborts the batch
with nothing written; during phase 2 it leaves earlier items applied.

**I8 — `comment_edits` is append-only.** `verb`, `textSource`, `beforeText` and `afterText`
are written once and never updated or deleted. Only `status` transitions. Retention is
indefinite.

**I9 — No path bypasses the service layer.** Dashboard tRPC, MCP and REST all call
`src/lib/services/comments.ts`. Nothing talks to the YouTube client directly, so no caller
can skip snapshotting or `consumeCredits`. **This is not true today and is work, not a
description:** `consumeCredits` currently lives in the MCP tool layer
(`mcp/tools/comments.ts:22,42,62,81`), and the existing REST comment routes call Google
directly with raw axios (`comments/[id]/route.ts:70,137`, `comments/reply/route.ts:65`) and
consume zero credits. Credit consumption moves into the service, and both routes are
rewritten to go through it. See Changes to existing behavior.

**I10 — Credits are consumed per item as attempted.** Not `51 × N` up front. Items skipped
after a quota halt, or never reached because phase 1 aborted, cost nothing.

---

## Data model

One new table. Ships with a generated Drizzle migration (`npx drizzle-kit generate`);
never `drizzle-kit push`.

```
comment_edits
  id              uuid pk default random
  organizationId  text  -> organization.id  (cascade)
  userId          uuid  -> user.id          (the actor; set null on delete)
  channelId       text  not null   -- the UC... channel whose token signed the write
  commentId       text  not null
  videoId         text             -- nullable: callers pass it from search results,
                                   -- which already carry it; omitted rather than
                                   -- spending a lookup when a caller doesn't have it
  verb            text  not null   -- 'update' | 'delete'
  textSource      text  not null   -- 'original' | 'display'  (see I2a)
  beforeText      text  not null
  afterText       text             -- null for verb='delete'
  status          text  not null default 'pending'  -- pending | applied | failed
  source          text  not null   -- 'mcp' | 'rest' | 'dashboard'
  createdAt       timestamptz not null default now()

  index (organizationId, createdAt desc)
```

Writes use the typed Drizzle query builder, never raw ``sql` ` `` — per the CLAUDE.md rule
recording the 2026-06-02 `timestamptz` encoder outage.

**Batch sequence.** *Phase 1, per item:* snapshot read (1 unit) → verify the comment is
authored by the acting channel → insert the row as `pending`. Any authorship mismatch, read
failure, or insert failure aborts the entire batch before phase 2, with nothing written to
YouTube; rows already inserted are marked `failed`. *Phase 2, per item:* YouTube write (50
units) → mark `applied`, or `failed` if the write errored.

A row left `pending` means the process died between the two phases. Reconciliation of
stranded `pending` rows is unresolved — see Open questions.

---

## Surfaces and permissions

| Verb | MCP (OAuth) | REST `read` | REST `read-write` | Dashboard | Credits | Writes `comment_edits` |
|---|---|---|---|---|---|---|
| `list_comment_threads` (extended) | ✅ | ✅ | ✅ | ✅ member | 1 / page | — |
| `get_comment_replies` | ✅ | ✅ | ✅ | ✅ member | 1 | — |
| `list_comment_edits` | ✅ | ✅ | ✅ | ❌ no UI | 0 | — |
| `reply_to_comment` | ✅ | ❌ 403 | ✅ | ✅ member | 50 | no |
| `post_comment` | ✅ | ❌ 403 | ✅ | ❌ | 50 | no |
| `update_comment` (single) | ✅ | ❌ 403 | ✅ | ❌ | 51 | yes |
| `update_comments` (bulk, ≤40) | ✅ | ❌ 403 | ✅ | ✅ **admin** | 51 / item | yes |
| `delete_comment` | ✅ | ❌ 403 | ✅ | ✅ **admin** | 51 | yes |
| `setModerationStatus` | ❌ | ❌ | ❌ | ❌ | — | — |

Rows that write `comment_edits` populate `userId` from the authenticated user and `source`
from the caller. No verb creates rows another table depends on; nothing cascades.

**Dashboard tiers.** `orgProcedure` for search, per-video view and reply — reversible or
additive. `orgAdminProcedure` for bulk update and delete. The boundary tracks
irreversibility, not convenience. `apiKeys.create` is already `orgAdminProcedure`
(`dashboard/apiKeys.ts:33`), so a plain member cannot mint a read-write key to route
around it.

**REST routes.** New: `GET /api/v1/youtube/comments` (channel-wide search),
`POST /api/v1/youtube/comments/bulk-update`, `GET /api/v1/youtube/comments/edits`.
Rewritten to route through the service layer and to consume credits:
`GET|DELETE /api/v1/youtube/comments/[id]`, `POST /api/v1/youtube/comments/reply`.
All follow `api/v1/CLAUDE.md`: `{data, error, meta}` envelope, `suggestion` on every error,
cursor pagination, documented quota cost.

**Auth.** No new mechanism. MCP keeps better-auth MCP OAuth (`api/mcp/route.ts:20`), REST
keeps `vtk_` bearer keys with `requireWriteAccess` on every mutating route, dashboard keeps
the Better Auth session cookie. Mutations are reachable only by POST or DELETE; no mutation
has a GET alias. Dashboard writes are tRPC mutations (POST-only transport), defended by the
session cookie's SameSite attribute plus `trustedOrigins` (`auth.ts:14`); cookie attributes
are to be set explicitly in `auth.ts` rather than inherited from a library default. No rate
limiting is added — `consumeCredits` is the sole throttle. No environment gating is added.

---

## Flows

**Course-link sweep (the primary case).** Search
`allThreadsRelatedToChannelId=<UC…>&searchTerms=<old URL>` → agent or human reviews the
matches with their video and text → selects a subset → `update_comments` in batches of ≤40,
each carrying `channelId` and `[{id, videoId, text}]` → each batch validates in phase 1 and
writes in phase 2 → per-item result array returned per batch.

**Per-video view.** Open a managed video in the dashboard and see its threads inline (1
credit). Members can reply. Editing and deleting are admin-only and surface only for admins,
matching the table above.

**Quota halt mid-batch.** A 40-item batch reaches item 33 in phase 2 and gets
`quotaExceeded` → breaker tripped → response is `{ok} × 32`, `{error: QUOTA} × 1`,
`{skipped} × 7`, plus `resetsAt`. The 40 before-texts from phase 1 are already recorded.
Resume by re-sending the skipped IDs.

**Recovery from a bad sweep.** `list_comment_edits` returns the rows; the caller re-sends
`beforeText` as a new `update_comments` batch. Only rows with `textSource = 'original'` are
restorable; `'display'` rows are HTML-marked-up audit records. Restoration is a normal
write at 51 credits per comment, not a free rollback.

## Edge cases

- **Comment not found** → the phase-1 snapshot read returns an empty list, not a 403. The
  item fails as `SNAPSHOT_FAILED` and the batch aborts before any write.
- **Comment not authored by the acting channel** → detected in phase 1 from
  `authorChannelId`; batch aborts with nothing written. A single-item `update_comment` that
  slips through returns YouTube's 403 with the existing suggestion at
  `services/comments.ts:103-105`.
- **Search misses a drifted comment.** A comment whose text no longer contains the search
  term is invisible to the sweep. Inherent to I1 and accepted.
- **Comments disabled on a video** → YouTube 403 `commentsDisabled`; reported per item.
- **Reply subset.** `commentThreads.list` inlines only a partial reply list; a full thread
  requires `get_comment_replies`.
- **Deleted comment** cannot be re-found; `comment_edits` is the only record, and for a
  third-party comment that record is `textDisplay`.

## Quota and credits

`comments.update`, `comments.delete`, `comments.insert` and `commentThreads.insert` are 50
units each; `commentThreads.list` and `comments.list` are 1 unit per call of up to 100 items.
Snapshotting adds 1 unit to each update and delete, so both bill at **51**. Replies and new
top-level comments are not snapshotted and bill at **50**.

Worked example — the 200-video course-link sweep: discovery is 200 results ÷ 100 per page =
2 pages = **2 credits**. Edits run as 5 batches of 40; each batch is 40 × 1 (phase 1) + 40 ×
50 (phase 2) = **2,040 credits**; 5 × 2,040 = **10,200**. Job total **10,202 credits** — the
batch cap changes the number of calls, not the cost. Against `stripe.ts:22-57`: Free
(10,000/mo) **cannot complete this job in a month**; Pro (100,000/mo) affords ~9.8 such jobs
per month; Business (500,000/mo) ~49.

**Accepted risk, explicit.** No per-org or project-wide daily write ceiling is added. Credits
are monthly and per-org; the YouTube Data API quota is daily and shared across the whole Google
Cloud project. One org can therefore exhaust the project's daily quota in a single sweep and
stall every org's background syncs and description pushes until the breaker clears at
midnight Pacific plus a 10-minute buffer (`RESET_BUFFER_MS`, `quota-guard.ts:25`). This was
chosen deliberately over a cap.

## Changes to existing behavior

Work that is invisible if this section is omitted:

- **MCP `update_comment` billing rises 50 → 51 credits** (snapshot read), and it now writes a
  `comment_edits` row.
- **MCP `delete_comment` billing rises 50 → 51** for the same reason.
- **The existing REST comment routes begin consuming credits.** They consume zero today; the
  only v1 route calling `consumeCredits` is `videos/route.ts:21`.
- **The existing REST comment routes are rewritten** to call `services/comments.ts` instead of
  raw axios, so I9 holds.
- **`consumeCredits` moves** from the MCP tool layer into the service layer.
- **An explicit `maxDuration`** is declared on the REST bulk route; no `export const maxDuration`
  exists anywhere in `src` today.
- **The comment read path loses its `getAnyUserToken` fallback**; `channelId` becomes required,
  fixing reads that could authenticate as an arbitrary channel.

## Non-goals

Moderation status, held-for-review queue, `likelySpam` triage, `banAuthor`. A comment inbox or
unified cross-channel view. Comment templates, variables, containers, drift detection or
version history. Background or scheduled comment work. An edit-history UI or undo button.
Caching of search results. Pinning or unpinning — impossible, the API exposes no pin field.

---

## Verified facts

Checked 2026-08-11 against this repo at `main` and the live Google docs. Every row below was
independently re-verified by a second agent on the same date.

| Claim | Source | Status |
|---|---|---|
| `comments.update` accepts only text | docs/comments/update | VERIFIED — "You can set values for these properties: `snippet.textOriginal`" |
| **`textOriginal` is author-only** | docs/comments | VERIFIED — "The original text is only returned to the authenticated user if they are the comment's author." **This qualifier was missed in the first draft and is the basis of I2a.** |
| No `pinned`/`pinnedAt` on the comment resource | docs/comments | VERIFIED — absent from the full property list |
| `comments.markAsSpam` gone | docs/comments | VERIFIED — "no longer supported" |
| `commentThreads` has only `list` and `insert` | docs/commentThreads | VERIFIED |
| `commentThreads.list` = 1 unit; filters `videoId` \| `allThreadsRelatedToChannelId` \| `id` | docs/commentThreads/list | VERIFIED |
| `moderationStatus` cannot filter by `rejected` | docs/commentThreads/list | VERIFIED — values are exactly `heldForReview`, `likelySpam`, `published` |
| `comments.insert`/`delete`, `commentThreads.insert` = 50 units; `comments.list` = 1 unit | docs | VERIFIED |
| `replies.comments[]` is a partial subset | docs/commentThreads | VERIFIED |
| OAuth scopes already include `youtube.force-ssl` | `clients/youtube.ts:241-245` | VERIFIED — no re-consent needed |
| Plan credits: Free 10k/mo, Pro 100k/mo, Business 500k/mo | `stripe.ts:22-57` | VERIFIED |
| No comment table exists | `db/schema.ts` — 26 `pgTable`s, none comment | VERIFIED |
| No rate limiting anywhere | `src/lib`, `middleware.ts` | VERIFIED — only YouTube's own `rateLimitExceeded` strings match |
| `apiKeys.create` is admin-only | `dashboard/apiKeys.ts:33` | VERIFIED |
| `orgProcedure` / `orgAdminProcedure` exist | `server/trpc/init.ts:75-79` | VERIFIED |
| MCP handler declares `maxDuration: 60` | `api/mcp/route.ts:16` | VERIFIED — basis of the I5 batch cap |
| No `export const maxDuration` anywhere in `src`; `vercel.json` has only crons | grep | VERIFIED — REST bulk route runs at an unestablished platform default |
| REST comment routes bypass the service layer and consume zero credits | `comments/[id]/route.ts:70,137`, `comments/reply/route.ts:65`; only `videos/route.ts:21` calls `consumeCredits` | VERIFIED — basis of the I9 caveat |
| Quota breaker clears at midnight Pacific **+10 min** | `quota-guard.ts:25` | VERIFIED |
| ~~`videos/[id]/check-drift` lets a read-scoped key cause a state change~~ | `check-drift/route.ts:13` → `checkDrift` (`services/videos.ts:1592-1638`) | **RETRACTED — this claim was false.** The route calls `checkDrift`, which performs a DB select, one YouTube read and a comparison, and returns. It never calls `detectAndRecordDrift`, whose only callers are `sync-channel-videos.ts:386` and `videos.ts:186`. It is a read expressed as POST, like `analytics/query`; the absence of `requireWriteAccess` is appropriate and there is no issue to fix. |
| Editing a pinned comment keeps it pinned | asserted at `mcp/tools/comments.ts:52` | **COULD NOT VERIFY** — undocumented. I3 holds regardless, since it only requires that update is safer than delete-and-repost. Probe one video before the first sweep. |
| `allThreadsRelatedToChannelId` returns owner-authored comments on the owner's own videos | inconclusive | **COULD NOT VERIFY** — probe needed. If it does not, discovery for the 200-video case rises from 2 credits to 200 and the job total from 10,202 to 10,400. No decision changes. |
| Current approved GCP daily quota | not in the repo | **UNKNOWN** — lives in the Cloud console. All arithmetic assumes the 10,000/day default. |

## Open questions

Two items are genuinely undecided and must be resolved before implementation:

1. **Stranded `pending` rows.** A crash between phase 1 and phase 2, or between a successful
   YouTube write and its `applied` stamp, leaves a row whose status does not describe reality —
   including a write that succeeded but is recorded as unapplied. No reconciliation mechanism
   is specified, and background work is a non-goal, so there is nowhere obvious to put one.
2. **Enforcement of I2 and I9.** Both are asserted with nothing proposed to enforce them or
   detect regression. No test strategy exists for this feature. Both invariants are the kind
   that decay silently — a new caller added later that talks to the YouTube client directly
   violates I9 with no failing signal.
