# WORKLOG — Dashboard consistency goal

See `GOAL.md` for the contract. This file tracks the phased plan, attempts, and
the current next action. Update it after every batch.

## Phased plan

Foundations first (the sweep depends on them), then category-by-category sweep.
Each batch: make the change → run the relevant verifier check(s) + `tsc` → screenshot
the touched pages → record result here → move to next.

### Phase 0 — Foundations (do these first)
- [ ] **F1. Badge variants** — add `success` + `warning` variants to `ui/badge.tsx`
      (map to semantic tokens with dark-mode support).
- [ ] **F2. Button variants** — add `success` (and if needed `warning`) variant to
      `ui/button.tsx`; remove the `bg-emerald-600` inline overrides later in the sweep.
- [ ] **F3. Adopt `Spinner`** — replace all 20 hand-rolled `<Loader2 animate-spin>`
      in-scope with `<Spinner>` (it takes `className` for size/color). Keep `Loader2`
      only inside `ui/spinner.tsx`.
- [ ] **F4. `DashboardLayout` header slot** — add `title` + optional `description`
      props that render a standard page header; remove inline page titles.
- [ ] **F5. One toast system** — migrate the 8 `sonner` imports to the custom
      `useToast` hook (the 16-file majority standard). ⚠️ behavior-change gate:
      confirm toast position/animation parity with the user before finalizing.
- [ ] **F6. `lib/format` date helper** — create one date/relative-time helper
      (Luxon is already a dep) and route the 13 inline `toLocale*` call sites through it.
- [ ] **F7. Shared twin page bodies** — extract `/dashboard/*` and `/org/[slug]/*`
      shared bodies into a single component parametrized by context; keep only the
      intended org-only deltas. (Approved by user.)

### Phase 1 — Sweep (after foundations)
- [ ] **S1. Status pills → `<Badge>`** (2 hand-rolled pills + the JobsView color maps).
- [ ] **S2. Raw status colors → tokens/variants** (42 hits): emerald/green → success,
      amber/yellow → one `warning` palette. Pick **one** of amber|yellow and delete the other.
- [ ] **S3. Icons** — `Edit2` → `Edit` (2); audit trash/edit icon consistency.
- [ ] **S4. Page headers** — convert the 4 inline `text-2xl` titles to the new
      `DashboardLayout` header slot.
- [ ] **S5. Cards/spacing** — `CardDescription` for subtitles; unify page container
      (`space-y-6`), card-title sizes, bordered-box radius, empty/loading padding.
- [ ] **S6. Overlays** — rationalize Dialog/Sheet/AlertDialog choice + `DialogFooter`
      usage; rename files whose name doesn't match the component (HistoryDrawer=Sheet,
      EditContainerModal=Dialog). (Cosmetic/structural — keep behavior identical.)
- [ ] **S7. `DataTable` adoption** — route the simple list tables (api-keys, usage,
      admin, jobs) through the shared `DataTable`; add an `emptyState` prop.

### Phase 2 — Verify & ship
- [ ] Full `scripts/check-design-consistency.sh` → 0 violations.
- [ ] `tsc --noEmit`, `npm run build`, `npm run lint`, `npm run test:org-guards` green.
- [ ] Before/after screenshots per dashboard page (visual parity).
- [ ] Open PR (do NOT merge without approval); paste `git diff --stat` + PR link into RESULT.md.

## Allowlist log (`// design-ok` exceptions)
_None yet. Each entry: file:line — reason._

## Attempts / evidence
- **Baseline captured at goal creation** (scoped verifier): 10 of 11 checks failing
  (raw `<img>` already clean). Counts recorded in GOAL.md baseline table.

## Progress
- **Phase 0 Foundations:** F1✓ F2✓ F3✓ F4✓ F5✓ F6✓ F7✓ (twin extraction into
  components/views; SettingsView slug-aware; UsageView showMembers; no parity faked).
- **Phase 1 Sweep:** S1✓ S2✓ S3✓ S4✓ S7✓. S5/S6 (card/spacing + overlay polish) deferred
  (cosmetic, not verifier-gated).
- **Phase 2 Verify:** verifier 11/11✓, tsc✓, build✓, lint✓, test:org-guards✓.
  Screenshots ⏳ (needs running app + login — owner-side). PR not yet opened.

See `RESULT.md` for full evidence and the diff summary (35 files, +672/−349).

## Current next action
Visual parity screenshots, then open PR (do NOT merge without approval).
