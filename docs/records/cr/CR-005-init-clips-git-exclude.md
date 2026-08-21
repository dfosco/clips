# CR-005: Exclude local clips state from Git

**Status:** In Review
**Type:** Bugfix
**Branch:** main
**Base branch:** main
**Base commit:** 1de71171e7ca2c5064351798234ba53fbc7650e9
**Parent CR:** None
**Covers:** Untracked

## Why

`clips init` creates repository-local `.clips/` state but incorrectly adds `.dots` to `.git/info/exclude`. Team repositories therefore do not get the intended local-only exclusion for clips artifacts.

## What changed

Updated init to add `.clips` to `.git/info/exclude`, with the existing idempotent and content-preserving behavior. Added regression coverage for first and repeated initialization.

## Behavior

Running `clips init` in a Git repository locally excludes `.clips/` without modifying the shared `.gitignore`. Re-running init does not duplicate the entry.

## Files changed

| File | Semantic role |
|---|---|
| `src/commands/init.js` | Manage the repository-local `.clips` Git exclusion and status messages. |
| `src/commands/init.test.js` | Verify exclusion creation and idempotence. |
| `docs/records/cr/CR-005-init-clips-git-exclude.md` | This change record. |

## Test plan

- [x] `npm test` — passed.
- [x] `npm run web:test` — passed.
- [x] `npx vitest run src/commands/init.test.js` — passed.

## Compatibility and operations

Existing `.dots` entries are not removed. Existing `.clips` data is not deleted or moved. Configured solo mode may still add `.clips/` to `.gitignore` as before.

## Documentation and records

No ADR or FDR was created; this is a focused initialization bug fix.

## Review

- [x] Changed files inspected
- [x] Regression coverage reviewed
- [x] CR branch and base verified
- [x] Stacked dependency reviewed: none
- [ ] Ready to merge
