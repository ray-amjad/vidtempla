# GOAL — VidTempla documentation overhaul

## Outcome

VidTempla has a sectioned, user-facing documentation site that describes only
shipped behavior; its REST, MCP, and dashboard surfaces are covered by a
fail-closed verifier; and machine-readable documentation is current.

## Baseline

- No `/docs` content tree exists. The public documentation is the root README,
  static `nextjs/public/llms.txt`, `nextjs/public/openapi.yaml`, and Scalar at
  `/reference`.
- The live source tree contains 43 v1 REST method/path operations, 42 MCP tools,
  and 12 canonical dashboard feature surfaces (including the four YouTube
  Manager tabs).
- OpenAPI has 39 operations, and `llms.txt` omits shipped history/drift and
  YouTube-search operations. The README advertises unshipped captions and
  transcripts.
- There is no committed CI workflow and no documentation coverage check.

## Scope

Create `/docs` sections for Get started, Concepts, Manage, Workspace, MCP, and
API; keep operation-level REST documentation in Scalar; and add a generated
`llms.txt` index plus documentation coverage verification.

## Constraints

- Document shipped behavior only. Do not represent captions, transcripts, or
  other unimplemented endpoints as available.
- Preserve `/reference`, `/openapi.yaml`, and `/llms.txt`; retain existing
  dashboard route aliases.
- Use small, scoped PRs. Do not make a documentation mega-PR.
- Preserve unrelated work and do not weaken an existing product test to make
  the documentation gate pass.
- A coverage exemption must be explicit, specific, and removed by the PR that
  documents its surface. Final completion permits no exemptions.

## Information architecture

- `/docs`: overview
- `/docs/get-started`: quickstart, connect YouTube, first managed description,
  and core workflow
- `/docs/concepts`: templates, containers, variables/assignments, and
  description lifecycle
- `/docs/manage`: channels/sync, videos, jobs/retries, drift/history/revert
- `/docs/workspace`: organizations/members, settings, plans/credits/usage
- `/docs/mcp`: setup plus tool-family references (channels, videos, templates,
  containers, playlists, comments, analytics)
- `/docs/api`: authentication, pagination/envelopes, errors/permissions/quota,
  and the Scalar REST reference

## Primary verifier

`cd nextjs && npm run test:docs-coverage` must extract and account for every
REST method/path operation, MCP tool, and normalized dashboard feature surface.
It must fail on unknown/nonliteral declarations, uncovered surfaces, stale or
duplicate claims, stale exemptions, missing documentation files, and REST vs
OpenAPI drift. The check must also prove that generated `llms.txt` is current.

## Supporting checks

- A controlled mutation test: remove one valid coverage claim and assert one
  precise uncovered-surface failure; restore it and return green.
- `npm run test:org-guards`
- `npm run test:encryption`
- `npx tsc --noEmit -p .`, `npm run lint`, and `npm run build`
- Local route/link checks for `/docs`, `/reference`, `/openapi.yaml`, and
  `/llms.txt`; production checks only against the deployment matching the final
  merge SHA.

## Iteration loop

1. Enumerate source surfaces before changing coverage data.
2. Implement one scoped docs or verifier change.
3. Run the focused verifier and affected regression checks.
4. Record updated/skipped/unchanged counts and the next uncovered surface.
5. Keep legacy routes live while moving public navigation to canonical docs.

## Approval gates

- Ask before changing redirect behavior beyond preserving existing paths.
- Ask before merging, pushing, deploying, or changing external services.
- Ask before adding a runtime dependency.

## Blocker standard

Blocked requires an external failure with the smallest actionable next step.
Missing local dependencies, a failed check, or documentation uncertainty is not
by itself a blocker; separate environment evidence from product evidence.

## Completion proof

- Zero coverage exemptions and full current-source counts in the verifier output.
- OpenAPI, `llms.txt`, docs navigation, and source extraction agree.
- All supporting checks pass on the final integration commit.
- Legacy public paths respond successfully.
- Deployment SHA matches the final merge before any live validation is claimed.
