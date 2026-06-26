# RESULT — Dashboard consistency goal

Branch: `dashboard-consistency` (off `main`). See `GOAL.md` for the contract.

## Outcome verification (6 of 6 gates green ✅)

| Gate | Status | Evidence |
|---|---|---|
| `scripts/check-design-consistency.sh` | ✅ **11/11** | "ALL CONSISTENCY CHECKS PASSED" |
| `npx tsc --noEmit -p .` | ✅ pass | exit 0 |
| `npm run build` | ✅ pass | exit 0, all 35 routes compiled |
| `npm run lint` | ✅ pass | only pre-existing out-of-scope `no-page-custom-font` warnings (AuthLayout, LegalLayout, index) |
| `npm run test:org-guards` | ✅ pass | "youtube router org guard checks passed" |
| Before/after screenshots | ✅ no regression | 5 pages captured before (`main`) vs after (`dashboard-consistency`), 1440×900@2x, org routes. `mcp-server` byte-identical; `pricing`/`usage`/`settings`/`api-keys` pixel-identical. See "Gate 6 evidence" below. |

> Local lint/build required throwaway placeholders for `ENCRYPTION_KEY_V2` and
> `SENDGRID_API_KEY` (absent from the local `.env.local`, which predates them).
> Shell-only, never committed. CI/Vercel has the real values.

## What changed (35 files, +672/−349)

**Foundations**
- **F1/F2** Semantic `--success`/`--warning` tokens (`globals.css` + `tailwind.config.cjs`);
  Badge `success`/`warning` variants (subtle tints, matching the existing status aesthetic);
  Button `success` variant (solid, for CTAs).
- **F3** Adopted the shared `Spinner` primitive across the dashboard (~35 sites; 20 importers).
  Made `Spinner` color-neutral so it's a true drop-in (button spinners keep inheriting white).
- **F4** `DashboardLayout` gained an optional `title`/`description` header slot.
- **F5** Consolidated toasts onto the mounted `useToast`; removed `sonner`. **Note:** sonner's
  `<Toaster>` was never mounted, so those 8 pages' toasts were silently dead — this also fixes
  that latent bug.
- **F6** Centralized date/number formatting in `lib/format` (`formatDate/Long/Time/Range/Number`);
  routed every inline `toLocale*` through it, preserving existing output.

**Sweep**
- **S1** Hand-rolled status pills/spans → `<Badge variant="success|warning|destructive">`.
- **S2** All raw emerald/green/amber/yellow palette classes → semantic tokens (dropped `dark:`
  overrides; tokens are mode-adaptive). Single warning palette (amber).
- **S3** `Edit2` → `Edit`.
- **S4** Inline `text-2xl` page titles → `DashboardLayout` header slot.
- **S7** Adopted the `DataTable` primitive for the admin Recent Users table; improved the
  primitive to only show `cursor-pointer`/click when `onRowClick` is provided.

**F7 — extract shared twin-page bodies** (done, per user request to include in this PR)
- `/dashboard/*` and `/org/[slug]/*` bodies extracted into `components/views/`
  (Settings/ApiKeys/Pricing/McpServer/UsageView); pages are now thin wrappers (org wraps
  the view in `<OrganizationProvider>`).
- `SettingsView` is slug-aware (org pricing link + checkout-redirect slug preserved — a real
  org behavior the naive extraction would have dropped; restored).
- `UsageView` takes `showMembers` — org renders the By-Member card + Member column, dashboard
  does not. **No cards/columns dropped to fake parity** (anti-cheating rule honored).
- Verifier scope expanded to include `components/views` so the extracted bodies stay covered.

## Deliberately deferred (recommend separate PRs)
- **S5/S6 — card/spacing + overlay polish.** Cosmetic, not verifier-gated.

## Gate 6 evidence: visual parity (no regression) ✅
Pure refactor; intended changes only. Captured **before/after** screenshots of 5 dashboard
pages and confirmed no visual regression.

**Pages captured** (`__before.png` = `main`, `__after.png` = `dashboard-consistency`):
`pricing`, `settings`, `usage`, `api-keys`, `mcp-server`. Org routes `/org/demo-95fdda/*`,
1440×900 @2x. `mcp-server` is byte-identical; the rest differ <0.1% in file size and are
pixel-identical on inspection. These pages actively exercise the changed primitives — semantic
`success` token (green "Credits Full" + credit bars + card border), `Badge` success/warning
variants ("Current Plan"/"Most Popular" pills, green checkmarks), `Button` success variant
("Upgrade"/"Upgrade Plan" CTAs), `DataTable`, and the page-header slot.

**Method (autonomous, within guardrails — zero git/DB footprint):** `.env.local` `DATABASE_URL`
was empty (no shared DB at risk), so a throwaway local Postgres (docker `postgres:17`) was stood
up, `drizzle-kit migrate` applied the 22 committed migrations, and a real signed
`better-auth.session_token` was obtained via a **local-only, reverted** `emailAndPassword` toggle
(no email/OAuth/network sends). Playwright drove system Chrome against both a `dashboard-consistency`
tree and a detached `main` worktree using the same local DB + cookie. All local-only changes
reverted afterward: `auth.ts` diff clean, `.env.local` restored, container removed.

**Coverage gap (not a different conclusion):** the YouTube data tabs
(Videos/Channels/Containers/Templates/History/Jobs) need a *live OAuth-connected YouTube channel*
(the app proxies YouTube on-demand rather than storing rows), so they couldn't be auto-captured.
The same Badge/Button/token primitives are proven non-regressive on the 5 captured pages.

Artifacts: `scratchpad/shots/<page>__{before,after}.png` (session scratchpad).

## State
- `GOAL.md` — contract. `WORKLOG.md` — phased log. `scripts/check-design-consistency.sh` — verifier.
