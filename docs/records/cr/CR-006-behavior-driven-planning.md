# CR-006: Add behavior-driven planning and adaptive verification

**Status:** In Review
**Type:** Feature
**Branch:** main
**Base branch:** main
**Base commit:** 1de71171e7ca2c5064351798234ba53fbc7650e9
**Parent CR:** None
**Covers:** #g002

## Why

Goals and tasks need an implementation-neutral way to describe observable behavior. Agents also need a clear verification expectation without Clips imposing a test framework, test level, methodology, language, or test-writing sequence on the target repository.

## Proposed approach

- Add optional, uninterpreted Gherkin-style behavior text to goals and tasks.
- Add `behavior` and `behavior_and_tests` modes, with goal defaults and task inheritance or override.
- Preserve compatibility for event logs that predate both fields.
- Expose behavior and effective modes through the CLI, GitHub issue mirrors, board API, and read-only UI.
- Follow this JavaScript repository's existing runtime-validation and Vitest conventions. Add no parser, Gherkin runner, type system, framework, or test dependency.

## Development updates

- The repository is JavaScript rather than TypeScript. Mode values therefore use a small shared runtime contract with validation and tests instead of introducing type declarations or a compiler solely for this feature.
- Behavior text remains opaque. This preserves Gherkin-style readability without coupling planning data to a parser, runner, step-definition framework, or specific BDD dialect.
- GitHub task sub-issues now receive updates to behavior and effective verification mode, matching the goal issue and local board instead of serializing the fields only at creation.
- The existing board already had goal/task detail panels. Behavior and mode were added to those surfaces rather than creating a separate behavior view.

## Result

Goals and tasks now accept optional `behavior` text and one of two verification modes. New goals default to `behavior`; tasks inherit the goal mode unless they override it, and `null` clears a task override. Legacy records resolve to `behavior` without migration.

CLI views, GitHub issue bodies, board API responses, cards, search, and detail panels expose the new planning data. Repository guidance tells agents to inspect and follow each repository's established test and type conventions. Automated evidence is required only in `behavior_and_tests` mode, without prescribing how that evidence is produced.

## Behavior

- Existing planning records without behavior or verification metadata remain readable.
- Goals and tasks may carry behavior descriptions.
- Tasks inherit their goal's verification mode unless they define an override.
- `behavior_and_tests` requires repository-native automated evidence; it does not select how or when tests are written.
- Agents inspect repository instructions and existing verification conventions before proposing coverage.

## Files changed

| File | Semantic role |
|---|---|
| `src/lib/behavior.js` | Shared mode contract, field validation, defaults, and inheritance. |
| `src/commands/goal.js`, `src/commands/task.js`, `src/commands/view.js`, `src/cli.js` | Goal/task input and terminal exposure. |
| `src/lib/core.js`, `src/lib/board.js`, `src/lib/sync.js` | Event replay, effective-mode projection, board API, and GitHub serialization. |
| `src/lib/behavior.test.js`, `src/commands/behavior.test.js`, `src/lib/board.test.js`, `src/lib/sync.test.js` | Model, CLI, API, inheritance, compatibility, and mirror regression coverage. |
| `web/src/App.svelte`, `web/src/lib/GoalCard.svelte`, `web/src/lib/TaskCard.svelte`, `web/src/app.css` | Read-only card, search, and detail-panel exposure. |
| `web/src/App.test.js` | UI behavior and mode rendering coverage. |
| `.agents/skills/clips/SKILL.md` | Agent workflow for behavior descriptions and adaptive verification. |
| `README.md` | Public behavior-mode documentation. |
| `docs/records/cr/CR-006-behavior-driven-planning.md` | Living review packet for this change. |

## Verification strategy

- Cover validation, goal defaults, task inheritance/override clearing, legacy compatibility, CLI display, board projection, and GitHub serialization using existing Vitest suites.
- Run the repository's existing CLI smoke test and frontend production build.
- Exercise the local board in the in-app browser, open the behavior goal, and inspect runtime logs.
- Check the completed diff for whitespace errors and current guidance for accidental methodology or framework mandates.

## Verification results

- [x] `npm run web:test` — passed; 6 test files and 30 tests passed.
- [x] `npm run web:build` — passed; 688 modules transformed and production assets emitted.
- [x] `npm test` — passed; CLI reported `clips v1.2.1`.
- [x] Local board browser check — behavior goal card and Gherkin detail rendered, effective mode displayed as `behavior and tests`, and no console warnings or errors were recorded.
- [x] `git -c core.fsmonitor=false diff --check` — passed with no whitespace errors.

## Compatibility and operations

New fields are optional. Legacy JSONL events and imported GitHub issues remain valid and resolve to `behavior`. GitHub mirrors gain additive sections. No test dependency, Gherkin runner, type system, or data migration is introduced.

## Documentation and records

- Updated README and Clips skill guidance.
- No ADR: mode semantics are product behavior, not a durable cross-cutting architectural decision.
- Goal #g003 separately revises the CR/record model in CR-007 and ADR-002.

## Review

- [x] Proposed approach reviewed
- [x] Meaningful decisions and deviations captured
- [x] Changed files inspected
- [x] Verification evidence reviewed
- [x] CR branch and base verified
- [x] Stacked dependency reviewed: none
- [ ] Ready to merge
