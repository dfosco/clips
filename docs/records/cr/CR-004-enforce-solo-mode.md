# CR-004: Enforce solo mode for GitHub sync

**Status:** In Review
**Type:** Bugfix
**Branch:** main
**Base branch:** main
**Base commit:** f9a9034ccfc0b3671b71f278d6b2fc485e505556
**Parent CR:** None
**Covers:** Untracked

## Why

`clips config collaboration false` configured `.clips/` as local state but did not stop initialization, explicit sync, or goal/task mutations from attempting GitHub operations.

## What changed

Added collaboration guards to the sync engine and clear skipped-sync messages to `init` and `sync`. Updated the user-facing documentation to describe local-only behavior.

## Behavior

When collaboration is disabled, `clips init` skips issue import, `clips sync` performs no remote pull or push, and goal/task mutations remain local because `pushGoal` returns before invoking `gh`.

## Files changed

| File | Semantic role |
|---|---|
| `src/lib/sync.js` | Enforce the collaboration boundary for pull, push, and sync operations. |
| `src/commands/init.js` | Report skipped GitHub import during local-only initialization. |
| `src/commands/sync.js` | Report skipped explicit synchronization. |
| `README.md` | Document local-only mode. |
| `.agents/skills/clips/SKILL.md` | Document the enforced collaboration setting. |
| `docs/records/cr/CR-004-enforce-solo-mode.md` | This change record. |

## Test plan

- [x] `npm test` — passed.
- [x] Node syntax checks for changed JavaScript files — passed.
- [x] Isolated smoke test verified collaboration guards prevent all `gh` calls.

## Compatibility and operations

Default behavior remains collaborative. Existing local data is not deleted or migrated. Re-enable remote operations with `clips config collaboration true`.

## Documentation and records

No ADR or FDR was created; this is a bug fix to an existing configuration boundary.

## Review

- [x] Changed files inspected
- [x] Regression coverage reviewed
- [x] CR branch and base verified
- [x] Stacked dependency reviewed: none
- [ ] Ready to merge
