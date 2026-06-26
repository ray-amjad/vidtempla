# GOAL — Make the VidTempla dashboard visually consistent

## Outcome (one observable result)
Every **dashboard** surface renders through shared design-system primitives and
semantic tokens. Concretely, the goal is complete only when:

1. `bash scripts/check-design-consistency.sh` exits **0** (all checks ✓), and
2. `cd nextjs && npx tsc --noEmit -p .` passes, and
3. `cd nextjs && npm run build` succeeds, and
4. `cd nextjs && npm run lint` passes, and
5. `cd nextjs && npm run test:org-guards` passes, and
6. Before/after screenshots of every dashboard page show **no unintended visual
   regression** (pure refactor — pages should look the same except where
   unification is the explicit intent).

## Scope
**In scope (dashboard only):** the YouTube/jobs/billing components, the dashboard
sidebar + `DashboardLayout`, and the `/dashboard` and `/org/[slug]` page trees,
plus the shared `ui/*` primitives they depend on.

**Out of scope (do NOT touch for this goal):** the auth surface
(`AuthLayout`, `/auth/consent`, `/auth/callback`, sign-in/up, `GoogleSignInButton`),
marketing/legal pages, and the public invite page. These use a separate visual
system and rebuilding them is a deliberate design decision deferred to later.

## Baseline (scoped verifier, captured at goal creation)
| Check | Baseline violations |
|---|---|
| sonner imports (should be one toast system) | 8 |
| hand-rolled `animate-spin` (should use `Spinner`) | 20 files |
| `Spinner` primitive importers | 0 (dead) |
| `DataTable` primitive importers | 0 (dead) |
| `Edit2` icon usage (should be `Edit`) | 2 |
| raw `<img>` in dashboard components | 0 ✓ already clean |
| hand-rolled status pills (should be `<Badge>`) | 2 |
| raw status text colors (should be tokens/variants) | 42 |
| amber AND yellow both used for "warning" | both present |
| inline `text-2xl` page headings (should be layout header) | 4 |
| inline `toLocale*` date formatting (should be `lib/format`) | 13 |

## Constraints / non-goals
- **No visual redesign.** Preserve existing layout and behavior; this is a
  consistency refactor, not a restyle.
- **No new runtime dependencies.** Removing `sonner` is fine; adding libs needs approval.
- **No data/logic changes.** Do not touch tRPC routers, queries, or auth logic.
- Intended `org/*`-only feature deltas (e.g. the usage "By Member" card) **stay** —
  only the *shared* parts of twin pages must converge.
- Enforcement (eslint rule / CI gate) is a **non-goal** for this pass; the verifier
  script is the gate.

## Success criteria
All six Outcome conditions above hold simultaneously on a clean working tree.

## Anti-cheating rules
- Dead primitives must be **adopted, not deleted**, to satisfy the greps:
  `Spinner`/`DataTable` importer counts must go **up** and call sites must migrate.
- No `eslint-disable`, `@ts-ignore`, `any`, or class renaming to dodge a gate.
- Do not drop columns/cards to make twin pages match — **extract a shared component**.
- The `// design-ok` allowlist is only for genuine data-viz exceptions, each noted
  in WORKLOG.md with a one-line reason. Do not blanket-allowlist to pass.
- Greps passing while a page looks broken is a **failure** — visual parity must hold.

## Approval gates (require explicit user sign-off)
- Opening is fine; **do not merge to `main`** without approval. Never push to `main` directly.
- Adding any dependency.
- Any change that alters user-visible behavior (e.g. toast position/animation when
  consolidating toast systems) — flag it and confirm before proceeding.

## Blocker standard
Mark blocked only on a real external blocker (e.g. build infra down) **plus** the
smallest next action. Difficulty or uncertainty is not a blocker.

## Completion proof (required before status=complete)
- Full `scripts/check-design-consistency.sh` output showing **0 violations**.
- Passing `tsc --noEmit`, `npm run build`, `npm run lint`, `npm run test:org-guards`.
- Before/after screenshots per dashboard page (visual parity).
- `git diff --stat` and the opened PR link.

## Where state lives
- `GOAL.md` — this file: the contract (outcome, scope, constraints, proof).
- `WORKLOG.md` — running log: phased plan, attempts, evidence, current next action.
- `scripts/check-design-consistency.sh` — the primary verifier.
