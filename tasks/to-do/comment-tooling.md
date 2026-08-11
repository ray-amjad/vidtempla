# YouTube Comment Tooling

Agent-driven and dashboard-driven management of YouTube comments, with the primary use
case being the pinned top-level comment pointing to Ray's course: find it across the
channel by searching for the current URL, and rewrite it everywhere when the URL changes.

Extends the existing comment surface (`src/lib/clients/youtube.ts:651-785`,
`src/lib/services/comments.ts`, `src/lib/mcp/tools/comments.ts`,
`src/app/api/v1/youtube/comments/*`). Adds one table, a dashboard, and a bulk write path.

---

## Decided invariants

**I1 — No stored comment state.** Comments are discovered by live search against YouTube
on every operation. There is no managed-comments table, no comment template, no container
binding, no drift detection and no sync engine. The agent (or the human) searches, gets
IDs back, and decides which to act on.

**I2 — Every write is snapshotted before it happens.** No `comments.update` or
`comments.delete` may reach YouTube without a `comment_edits` row recording the prior
text. `comments.update` overwrites `textOriginal` in place and YouTube exposes no comment
version history, so this table is the only surviving copy of what a comment said.

**I3 — Update in place; never delete-and-repost.** Pinning cannot be read or set through
the API. A delete-and-repost cycle silently unpins the comment on every affected video
with no programmatic way to restore it, and also discards the comment's likes and original
timestamp. For Ray's course comment the operation is always `comments.update`.

**I4 — Removal is permanent and single-verb.** "Remove it" maps to `comments.delete`.
There is no reject/un-reject, no moderation queue, no `banAuthor`.

**I5 — The agent selects, the server fans out.** Read tools return candidates; the caller
filters; one bulk call carries the chosen IDs with per-item replacement text. The loop
runs server-side.

**I6 — A bulk batch is single-channel.** `channelId` is a required parameter of the bulk
call and every ID in the batch must belong to it. A comment ID carries no channel binding,
and `comments.update` only succeeds against the channel that authored the comment. A
mixed-channel batch is rejected up front with nothing written.

**I7 — Quota exhaustion halts the batch.** On the first `quotaExceeded`, trip
`markYouTubeQuotaExhausted()` and stop. Remaining items are returned as `skipped`, never
attempted. Resume by re-sending the skipped IDs.

**I8 — `comment_edits` is append-only.** `verb`, `beforeText` and `afterText` are written
once and never updated or deleted. Only `status` transitions. Retention is indefinite.

**I9 — No path bypasses the service layer.** Dashboard tRPC, MCP and REST all call
`src/lib/services/comments.ts`. Nothing talks to the YouTube client directly, so no caller
can skip snapshotting or `consumeCredits`.

**I10 — Credits are consumed per item as attempted.** Not `51 × N` up front. Items skipped
after a quota halt cost nothing.

---

## Data model

One new table. Ships with a generated Drizzle migration (`npx drizzle-kit generate`);
never `drizzle-kit push`.

```
comment_edits
  id              uuid pk default random
  organizationId  text  -> organization.id  (cascade)
  userId          uuid  -> user.id          (actor; set null on delete)
  channelId       text  not null   -- the UC... channel whose token signed the write
  commentId       text  not null
  videoId         text             -- nullable; see F1
  verb            text  not null   -- 'update' | 'delete'
  beforeText      text  not null
  afterText       text             -- null for verb='delete'
  status          text  not null default 'pending'  -- pending | applied | failed
  source          text  not null   -- 'mcp' | 'rest' | 'dashboard'
  createdAt       timestamptz not null default now()

  index (organizationId, createdAt desc)
```

Writes use the typed Drizzle query builder, never raw ``sql` ` `` — per the CLAUDE.md rule
recording the 2026-06-02 `timestamptz` encoder outage.

**Per-item write sequence.** Snapshot read (1 unit) → insert row as `pending` → YouTube
write (50 units) → mark `applied`, or `failed` if the write errored. A failed snapshot read
aborts the item as `SNAPSHOT_FAILED` with **no** YouTube write attempted. A failed row
insert aborts the item the same way: the table is the point of the feature, so a write that
cannot be recorded does not happen.

---

## Surfaces and permissions

| Verb | MCP (OAuth) | REST `read` | REST `read-write` | Dashboard | Credits |
|---|---|---|---|---|---|
| `list_comment_threads` (extended) | ✅ | ✅ | ✅ | ✅ member | 1 / page |
| `get_comment_replies` | ✅ | ✅ | ✅ | ✅ member | 1 |
| `list_comment_edits` | ✅ | ✅ | ✅ | ❌ no UI | 0 |
| `reply_to_comment` | ✅ | ❌ 403 | ✅ | ✅ member | 50 |
| `post_comment` | ✅ | ❌ 403 | ✅ | ❌ | 50 |
| `update_comment` (single) | ✅ | ❌ 403 | ✅ | ❌ | 51 |
| `update_comments` (bulk) | ✅ | ❌ 403 | ✅ | ✅ **admin** | 51 / item |
| `delete_comment` | ✅ | ❌ 403 | ✅ | ✅ **admin** | 51 |
| `setModerationStatus` | ❌ | ❌ | ❌ | ❌ | — |

Every write cell populates `comment_edits.actor` from the authenticated `userId` and
`source` from its caller. No cell creates rows another table depends on; nothing cascades.

**Dashboard tiers.** `orgProcedure` for search, per-video view and reply — reversible or
additive. `orgAdminProcedure` for bulk update and delete — the boundary tracks
irreversibility, not convenience. `apiKeys.create` is already `orgAdminProcedure`
(`dashboard/apiKeys.ts:33`), so a plain member cannot mint a read-write key to route
around this.

**REST routes.** New: `GET /api/v1/youtube/comments` (channel-wide search),
`POST /api/v1/youtube/comments/bulk-update`, `GET /api/v1/youtube/comments/edits`.
Existing and unchanged in shape: `GET|DELETE /api/v1/youtube/comments/[id]`,
`POST /api/v1/youtube/comments/reply`. All follow `api/v1/CLAUDE.md`: `{data, error, meta}`
envelope, `suggestion` on every error, cursor pagination, documented quota cost.

**Auth.** No new mechanism. MCP keeps better-auth MCP OAuth (`api/mcp/route.ts:20`), REST
keeps `vtk_` bearer keys with `requireWriteAccess` on every mutating route, dashboard keeps
the Better Auth session cookie. Mutating REST is POST-only with no GET alias. Dashboard
writes are tRPC mutations (POST-only transport), defended by the session cookie's SameSite
attribute plus `trustedOrigins` (`auth.ts:14`); cookie attributes are to be set explicitly
in `auth.ts` rather than inherited from a library default. No rate limiting is added —
`consumeCredits` is the sole throttle. No environment gating is added.

---

## Flows

**Course-link sweep (the primary case).** Search
`allThreadsRelatedToChannelId=<UC…>&searchTerms=<old URL>` → agent or human reviews the
matches with their video and text → selects a subset → one `update_comments` call carrying
`channelId` and `[{id, videoId, text}]` → server snapshots and writes each → per-item result
array returned.

**Per-video view.** Open a managed video in the dashboard, see its threads inline (1 credit),
reply, edit or delete from there.

**Quota halt mid-batch.** Item 81 returns `quotaExceeded` → breaker tripped → response is
`{ok} × 80`, `{error: QUOTA} × 1`, `{skipped} × 119`, plus `resetsAt`. The 80 before-texts
are already in `comment_edits`. Resume tomorrow by re-sending the skipped IDs.

**Recovery from a bad sweep.** `list_comment_edits` returns the rows; the caller re-sends
`beforeText` as a new `update_comments` batch. This costs another 51 credits per comment —
restoration is a normal write, not a free rollback.

## Edge cases

- **Comment not found / not authored by the acting channel** → YouTube 403. Surface as
  `YOUTUBE_API_ERROR` with the existing suggestion at `services/comments.ts:103-105`.
- **Search misses a drifted comment.** A comment whose text no longer contains the search
  term is invisible to the sweep. This is inherent to I1 and accepted.
- **Comments disabled on a video** → YouTube 403 `commentsDisabled`; report per item, do not
  halt the batch.
- **Reply subset.** `commentThreads.list` inlines only a partial reply list; a full thread
  requires `get_comment_replies`.
- **Deleted comment re-listed** — not possible to re-find; `comment_edits` is the only record.

## Quota and credits

`comments.update`, `comments.delete`, `comments.insert` and `commentThreads.insert` are 50
units each; `commentThreads.list` and `comments.list` are 1 unit per call of up to 100 items.
Snapshotting adds 1 unit to each update and delete, so both bill at **51**.

Worked example — the 200-video course-link sweep: discovery is 200 results ÷ 100 per page =
2 pages = **2 credits**; edits are 200 × 51 = **10,200**; job total **10,202 credits**. Against
`stripe.ts:22-56`: Free (10,000/mo) **cannot complete this job in a month**; Pro (100,000/mo)
affords ~9.8 such jobs per month; Business (500,000/mo) ~49.

**Accepted risk, explicit.** No per-org or project-wide daily write ceiling is added. Credits
are monthly and per-org; the YouTube Data API quota is daily and shared across the whole Google
Cloud project. One org can therefore exhaust the project's daily quota in a single sweep and
stall every org's background syncs and description pushes until the breaker clears at midnight
Pacific (`quota-guard.ts:121`). This was chosen deliberately over a cap.

## Non-goals

Moderation status, held-for-review queue, `likelySpam` triage, `banAuthor`. A comment inbox or
unified cross-channel view. Comment templates, variables, containers, drift detection or
version history. Background or scheduled comment work. An edit-history UI or undo button.
Caching of search results. Pinning or unpinning — impossible, the API exposes no pin field.

Not in scope and not fixed here: `videos/[id]/check-drift/route.ts` lacks `requireWriteAccess`
while `detectAndRecordDrift` writes a `descriptionHistory` row and stamps `driftDetectedAt`,
so a read-scoped key can cause a state change and spend quota within its own org. Separate
route, separate fix.

---

## Verified facts

Checked 2026-08-11 against this repo at `main` and the live Google docs.

| Claim | Source | Status |
|---|---|---|
| `comments.update` accepts only text | docs/comments/update, fetched 2026-08-11 | VERIFIED — "You can set values for these properties: `snippet.textOriginal`" |
| No `pinned`/`pinnedAt` on the comment resource | docs/comments, fetched 2026-08-11 | VERIFIED — absent from the property list |
| `comments.markAsSpam` gone | docs/comments, fetched 2026-08-11 | VERIFIED — "no longer supported" |
| `commentThreads` has only `list` and `insert` | docs/commentThreads, fetched 2026-08-11 | VERIFIED |
| `commentThreads.list` = 1 unit; filters `videoId` \| `allThreadsRelatedToChannelId` \| `id`; opts `moderationStatus`, `searchTerms`, `order`, `textFormat`, `maxResults` 1–100 | docs/commentThreads/list, fetched 2026-08-11 | VERIFIED |
| `moderationStatus` **cannot** filter by `rejected` | docs/commentThreads/list, fetched 2026-08-11 | VERIFIED — acceptable values are exactly `heldForReview`, `likelySpam`, `published` |
| `setModerationStatus` = 50 units, `banAuthor` only with `rejected`, scope `youtube.force-ssl`, `id` takes a comma-separated list | docs/comments/setModerationStatus, fetched 2026-08-11 | VERIFIED (recorded for completeness; out of scope per I4) |
| `replies.comments[]` is a partial subset | docs/commentThreads, fetched 2026-08-11 | VERIFIED |
| OAuth scopes already include `youtube.force-ssl` | `clients/youtube.ts:241-245` | VERIFIED — no re-consent needed |
| Plan credits: Free 10k/mo, Pro 100k/mo, Business 500k/mo | `stripe.ts:22-56` | VERIFIED |
| No comment table exists | `db/schema.ts` table list | VERIFIED |
| No rate limiting anywhere | `src/lib`, `middleware.ts` | VERIFIED — only YouTube's own `rateLimitExceeded` error names match |
| Every mutating comment route calls `requireWriteAccess` | all `POST\|PUT\|PATCH\|DELETE` handlers under `api/v1` | VERIFIED — only `analytics/query` (a read via POST) and `videos/[id]/check-drift` lack it |
| `apiKeys.create` is admin-only | `dashboard/apiKeys.ts:33` | VERIFIED |
| `orgProcedure` / `orgAdminProcedure` exist with `orgRole` narrowed | `server/trpc/init.ts:75-79` | VERIFIED |
| Editing a pinned comment keeps it pinned | asserted at `mcp/tools/comments.ts:52` | **COULD NOT VERIFY** — undocumented. I3 holds regardless, since it only requires that update is safer than delete-and-repost. Worth a live probe on one video before the first sweep. |
| `allThreadsRelatedToChannelId` returns owner-authored comments on the owner's own videos | web search 2026-08-11 inconclusive | **COULD NOT VERIFY** — needs a live probe. If it does not, the sweep must fall back to per-video search at 1 unit per video. |
| Current approved GCP daily quota for this project | not recorded in the repo | **UNKNOWN** — lives in the Cloud console. All arithmetic above assumes the 10,000/day default. |

## Open questions

None. Every decision above was posed and answered during the interview.

The two `COULD NOT VERIFY` rows are live-probe items, not deferred decisions: run both against
one real video and one real channel before the first production sweep. If
`allThreadsRelatedToChannelId` does not surface owner-authored comments, discovery cost for the
200-video case rises from 2 credits to 200 and the sweep total from 10,202 to 10,400 — which
does not change any decision here, only the arithmetic.
