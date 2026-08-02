# VidTempla documentation overhaul worklog

## 2026-08-01 — Goal activated

- Grounded current docs, source routes, MCP tools, dashboard pages, and build hooks.
- Baseline: 43 REST operations, 42 MCP tools, 12 dashboard feature surfaces,
  39 OpenAPI operations, and no docs content tree or coverage verifier.
- Existing lightweight checks passed: `test:org-guards` and `test:encryption`.
- Completed Phase 0 foundation on `codex/docs-foundation`:
  - Added `/docs` overview and manifest-backed navigation shell.
  - Replaced the manually maintained root `llms.txt` with generated REST/MCP
    inventory while keeping the URL unchanged.
  - Added a source-backed coverage verifier, explicit initial exemptions, a
    mutation test, and a GitHub Actions docs check.
  - Removed the README claim for unshipped captions/transcripts.
- Verification: docs coverage and its mutation test pass; TypeScript passes
  with the locked toolchain; org-guard and encryption tests pass.
- Known baseline verification issue: lint and `next build` compile the new docs
  code but fail afterward on five pre-existing generated `.well-known` routes
  excluded from the ESLint TypeScript project.
- Phase 0 committed locally as `6874f11` (`docs: add coverage foundations`).
- Next action: push/open the scoped Phase 0 PR after approval, then add the Get
  started and Concepts section in the next scoped PR.
