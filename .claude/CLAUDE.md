# CLAUDE.md

VidTempla is a YouTube description management tool: a Next.js 15 dashboard for humans and a REST API for AI agents that proxies YouTube on-demand.

## Project map

- `nextjs/` — Next.js 15 app (run all commands from here)
  - `src/app/` — App Router pages; REST endpoints under `src/app/api/v1/`
  - `src/server/` — tRPC routers and init (`api/routers/`, `trpc/`)
  - `src/db/schema.ts` — Drizzle schema (source of truth for DB types)
  - `src/lib/` — domain services (`auth.ts`, `plan-limits.ts`, `services/`, `api-auth.ts`, `api-keys.ts`)
  - `src/workflows/` — Inngest workflows (`sync-channel-videos`, `credit-reset`, …)
  - `drizzle/` — generated SQL migrations (commit alongside schema changes)
- `tasks/` — Kanban folders (`to-do/` → `doing/` → `done/`)
- `scripts/` — repo-level helpers

Stack: Next.js 15, React 18, TypeScript, Tailwind + Radix, tRPC, Drizzle ORM on PlanetScale Postgres, Better Auth (magic link + Google), Inngest, Stripe.

<important if="you need to run commands to build, test, lint, or generate code">

Run from `nextjs/`.

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` | `next build` |
| `npm run vercel-build` | `drizzle-kit migrate && next build` (what Vercel runs) |
| `npm run start` | Start the production server |
| `npm run lint` | `next lint` |
| `npm run test:org-guards` | Check YouTube router org guards |
| `npm run test:encryption` | Encryption smoke test |
| `npx drizzle-kit generate` | Generate SQL migration from schema changes |
| `npx drizzle-kit generate --custom` | Blank migration file for custom SQL (triggers, functions) |
| `npx drizzle-kit migrate` | Apply pending migrations |
| `npx tsc --noEmit -p .` | Typecheck the whole app |

</important>

<important if="you are editing `nextjs/src/db/schema.ts` or otherwise changing the database schema">

1. Edit `nextjs/src/db/schema.ts`.
2. Run `npx drizzle-kit generate` from `nextjs/` to create a SQL migration in `drizzle/`.
3. Review the generated SQL and commit it alongside the schema change.
4. For triggers/functions/custom DDL: `npx drizzle-kit generate --custom` for a blank migration.
5. **Never run `drizzle-kit push`** — prompts interactively and silently fails in CI.

Vercel's `vercel-build` runs `drizzle-kit migrate && next build` on every deploy, so migrations apply automatically once merged.

</important>

<important if="you are writing a database query — selecting, inserting, updating, deleting, or filtering rows">

**Prefer the typed query builder over raw `sql\`\``.** Drizzle's tagged-template `sql` does NOT apply column type encoders to interpolated values — a JS `Date` becomes `Tue Jun 02 2026 00:00:45 GMT+0000` and breaks `timestamptz` comparisons (production outage 2026-06-02 in `upsertCredits`).

Use these operators — already imported across the codebase:
- Comparison: `eq, ne, lt, lte, gt, gte, isNull, isNotNull, inArray, like, between`
- Logical: `and, or, not`
- Ordering: `asc, desc`

Raw `sql\`\`` is acceptable **only** when Drizzle has no equivalent: `CASE WHEN`, `SELECT 1 ... FOR UPDATE` row locks, `pg_advisory_*` locks, `SET LOCAL`, arithmetic in `SET` (`col + 1`), `DATE(col)` grouping, `nulls last`/`nulls first` ordering.

If raw `sql\`\`` is unavoidable and you must interpolate a value, wrap the comparison in a typed operator so encoders still run: `sql\`CASE WHEN ${eq(col, dateValue)} THEN ... END\``.

</important>

<important if="you are about to commit, stage files, or run `git add`">

This is a **public GitHub repository**. Never commit secrets, API keys, passwords, or database URLs. `.env.local` is gitignored — keep it that way. Review staged diffs for credentials before every commit.

</important>

<important if="you are touching authentication, sessions, middleware, or anything that protects user data">

- Better Auth lives in `nextjs/src/lib/auth.ts` (server) and `nextjs/src/lib/auth-client.ts` (client).
- Middleware checks the `better-auth.session_token` cookie for protected routes.
- User isolation is enforced in tRPC procedures via `WHERE` clauses — there is no database-level RLS. Every query that returns user-owned rows must filter by `userId` or `organizationId`.
- Never expose secrets, tokens, or internal IDs in client-side code.

</important>

<important if="you are adding or modifying a REST endpoint under `nextjs/src/app/api/v1/`">

Conventions enforced by `withApiKey()` in `nextjs/src/lib/api-auth.ts`:
- Response envelope: `{ data, error, meta }` — never bare arrays.
- Error format: `{ code, message, suggestion, status }` — always include `suggestion` so agents can self-correct.
- Cursor-based pagination on lists (`?cursor=...&limit=50`).
- Field selection on proxy endpoints (`?fields=id,title,viewCount`).
- camelCase JSON, kebab-case URLs.
- Document YouTube quota cost on every proxy endpoint.

Key files: `src/lib/api-auth.ts` (`withApiKey`, `apiSuccess`, `apiError`, `logRequest`), `src/lib/api-keys.ts` (`generateApiKey`, `hashApiKey`), `src/db/schema.ts` (`apiKeys`, `apiRequestLog`). See `nextjs/src/app/api/v1/CLAUDE.md` for the full guide.

</important>

<important if="you are picking up new work, finishing a task, or organizing what to do next">

Work lives in `tasks/` as a Kanban folder structure: `to-do/` → `doing/` → `done/`. Move the task file between folders as you pick it up and finish it. See `tasks/CLAUDE.md` for the workflow.

</important>

<important if="you have just pushed to main, deployed to Vercel, or were asked to confirm a deploy is healthy">

Verify the Vercel deployment reaches **READY** via `list_deployments` (projectId `prj_8JcHH2ynheBrW2pc2KTUMdTEbvNQ`, teamId `team_EnX8JK9URpU5sW8LFtwVLgoz`) before marking work complete. If it shows **ERROR**, fetch the build logs and diagnose before doing anything else.

</important>
