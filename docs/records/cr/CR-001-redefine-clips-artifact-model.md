# CR-001: Redefine the clips artifact model

**Status:** In Review
**Type:** Documentation
**Branch:** main
**Base branch:** main
**Base commit:** 0a77da5591a377dbcc65135bacf3fb55cf1573b5
**Parent CR:** None
**Covers:** Untracked

## Why

Clips needs to coordinate goals and tasks without turning every planning item into an ADR or FDR. It also needs a committed record of repository work when no pull request exists.

## What changed

Defined separate planning and repository-record boundaries. Added templates and the first ADR for CRs, ADRs, and FDRs. Defined the CR coverage rule, conditional ADR/FDR creation, and explicit Git metadata for stacked CRs.

## Behavior

Goals and tasks remain planning state. Every non-trivial reviewable repository diff gets one active CR. A CR can cover one task, several tasks, or a small complete goal. ADRs and FDRs are created or updated only when durable architecture or user-visible behavior warrants it.

## Files changed

| File | Semantic role |
|---|---|
| `README.md` | Public artifact model and storage boundary. |
| `AGENTS.md` | Repository workflow rules. |
| `docs/records/adr/` | ADR template and accepted storage-boundary decision. |
| `docs/records/fdr/FDR-TEMPLATE.md` | FDR template. |
| `docs/records/cr/` | CR template and this change record. |
| `.agents/plans/plan.md` | Marks the conflicting `.clips` auto-commit plan as superseded. |
| `.agents/skills/clips/SKILL.md` | Agent-facing planning and record guidance. |

## Test plan

- [x] `npm test` — passed.
- [x] `git diff --check` — passed.
- [x] README record links resolve.

## Compatibility and operations

This is a documentation and workflow-definition change. It does not yet migrate the CLI's legacy `.clips/db/` storage or add record-specific CLI commands. The storage migration and loop-manager runtime remain follow-up implementation work.

## Documentation and records

- Added [ADR-001](../adr/ADR-001-separate-planning-state-from-repository-records.md).
- Added CR, ADR, and FDR templates.
- No FDR was created; this change defines workflow behavior rather than a product feature.

## Review

- [x] Changed files inspected
- [x] Regression coverage reviewed; this documentation-only change has no executable-path coverage to add.
- [x] CR branch and base recorded
- [x] Stacked dependency reviewed: none
- [ ] Ready to merge
