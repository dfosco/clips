# CR-002: Add record templates to the clips skill

**Status:** In Review
**Type:** Documentation
**Branch:** main
**Base branch:** main
**Base commit:** 1845c75e926191b28085e1170fd177f82531ffd2
**Parent CR:** None
**Covers:** Untracked

## Why

The clips skill defined the planning-versus-record boundary but did not give the agent canonical formats to use when a user requested a Goal, Task, CR, ADR, or FDR.

## What changed

Added record triggers, routing rules, approval-state guidance, and embedded templates for all five artifact types to the clips skill. The templates point repository records to `docs/records/` and preserve the CR branch, base, and stacking metadata.

## Behavior

The agent can select the appropriate artifact from the user’s intent, avoid creating unnecessary ADRs or FDRs, create one CR for each non-trivial repository diff, and use a stable field and section layout.

## Files changed

| File | Semantic role |
|---|---|
| `.agents/skills/clips/SKILL.md` | Canonical artifact routing rules and templates. |
| `docs/records/cr/CR-002-add-record-templates-to-clips-skill.md` | This change record. |

## Test plan

- [x] `git diff --check` — passed.
- [x] `npm test` — passed.
- [x] Skill reviewed for consistency with `docs/records/` templates.

## Compatibility and operations

This is a skill and documentation change. It does not add record-specific CLI commands or migrate the legacy `.clips/db/` planning storage.

## Documentation and records

No ADR or FDR was created. The skill references the existing committed templates and artifact-model ADR.

## Review

- [x] Changed files inspected
- [x] Regression coverage reviewed; this documentation-only change has no executable-path coverage to add.
- [x] CR branch and base verified
- [x] Stacked dependency reviewed: none
- [ ] Ready to merge
