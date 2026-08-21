# clips

`clips` manages two related but deliberately separate things:

- **Planning state:** goals and tasks, kept in an external workflow store and optionally mirrored to GitHub Issues.
- **Repository records:** CRs and ADRs, committed with the code they describe.

CR = Change Record  
ADR = Architecture Decision Record  
FDR = Feature Decision Record (for user-facing functionality, can be a source of truth for usage docs)  

This separation keeps the board useful for scheduling while leaving the repository with a durable account of what changed and why.

## Artifact model

| Artifact | Role | Lifecycle | Repository location |
|---|---|---|---|
| Goal | An outcome or epic | Before and during work | External clips store |
| Task | An actionable piece of a goal | Before and during work | External clips store |
| CR | The review packet for a repository change; the local equivalent of a PR | Draft → In Review → Accepted → Merged | `docs/records/cr/` |
| ADR | A durable cross-cutting architectural decision | Proposed → Accepted → Superseded | `docs/records/adr/` |

Goals and tasks define intended outcomes. CRs explain specific implementation attempts. ADRs preserve rare, cross-cutting architectural decisions. Product documentation describes current user-visible behavior.

### Behavior descriptions and verification modes

Goals and tasks may carry an optional Gherkin-style behavior description. Clips stores and displays this text; it does not parse Gherkin, generate tests from it, or require a BDD tool.

Two modes control the expected evidence:

- `behavior`: describe and verify observable behavior. Automated tests are optional when the repository or change does not call for them.
- `behavior_and_tests`: describe observable behavior and produce automated test evidence before completion.

Tasks inherit their goal's mode unless they explicitly override it. A task can clear an override with `verification_mode: null` and resume inheritance. Existing planning data without a mode behaves as `behavior`.

`behavior_and_tests` does not select a framework, test level, methodology, language, or test-writing order. Before planning verification, the agent reads the repository's instructions, contribution guidance, scripts, CI, test configuration, adjacent tests, and type conventions. It uses the established approach. Adding a new framework or test dependency remains an explicit project decision.

Types can cover structural contracts: accepted values, data shapes, nullability, and interfaces between components. They do not prove runtime behavior such as permissions, persistence, rendering, network failures, or user interactions. Types therefore appear in task implementation when the repository and boundary call for them; Clips does not require a type-definition phase for every task.

Example:

```bash
clips goal create '{
  "title":"Add Figma task attachments",
  "verification_mode":"behavior_and_tests",
  "behavior":"Feature: Figma task attachments\n  Scenario: Render a valid Figma embed\n    Given a task has a valid Figma embed URL\n    When the attachment is displayed\n    Then the Figma content is rendered as an attachment"
}'

# Inherits behavior_and_tests from the goal.
clips task create g001 '{
  "title":"Validate and store Figma attachment URLs",
  "behavior":"Scenario: Reject unsupported Figma URLs\n  Given a URL is not an allowed Figma embed URL\n  When it is added as an attachment\n  Then the attachment is rejected with an actionable error"
}'
```

There is no fixed one-to-one mapping between planning and record artifacts:

- one CR may cover one task, several tasks, or a small complete goal;
- a task with no repository change needs no CR;
- a CR may reference a goal or task, but it is not their child item;
- one CR may update an existing ADR without creating a new one;
- an ADR is created only when a durable cross-cutting decision needs a new record.

The hard rule is: every non-trivial, reviewable repository diff is covered by exactly one active CR. A tiny bug fix or iteration still gets a small CR; it does not automatically get a new ADR.

### Living CR lifecycle

A CR starts as `Draft` before source implementation begins. It is the active development record for that change, not a post-mortem reconstructed at the end.

While Draft, it contains:

- proposed design, expected files and boundaries;
- repository-native verification strategy;
- known risks and unresolved product questions;
- meaningful discoveries, decisions, and deviations as work proceeds.

It records reviewable judgment, not raw chain-of-thought or a diary of every command. Before moving to `In Review`, the author consolidates the record around the actual implementation, resulting behavior, changed files, compatibility impact, and verification evidence. `In Review` means implementation and author-run verification are complete; it does not manufacture human approval.

Task, CR, and PR have distinct roles:

- **Task:** what outcome this slice of work must produce.
- **CR:** how this repository change intends to produce it, then what it actually changed and verified.
- **PR:** hosted Git diff, checks, discussion, and review workflow.

A Draft CR and Draft PR are counterparts. The CR is repository-native and preserves rationale; the PR is provider-hosted and exposes the diff and collaboration state. Either can exist without the other.

### CR metadata and stacked CRs

Every CR records the Git basis of its change:

```md
**Branch:** codex/example-change
**Base branch:** main
**Base commit:** FULL_COMMIT_ID
**Parent CR:** CR-012 | None
```

`Parent CR` is optional and is the only stacking relationship needed. Use it when a change is independently reviewable but depends on another CR. The base branch and base commit remain the source of truth for Git; the parent CR explains the review dependency. There is no separate stack artifact.

When a CR is accepted, its recorded branch, base, covered planning refs, verification, and record impact should describe the exact change being accepted. If a parent CR changes, dependent CRs must be revalidated.

## Storage boundary

Goals and tasks are workflow state. They may be synchronized to GitHub Issues, but they should not be committed to the source repository. The current CLI still has a legacy `.clips/db/` JSONL layout; moving that state to an external store is the intended storage direction and is a compatibility migration, not a reason to put board state into new commits.

CRs and ADRs are repository state. They must be committed in the target repository, under `docs/records/`. A worker may write these records in its isolated worktree as part of its change, but it must not mutate the external board. The supervisor may update board state, but must not edit source or committed records.

This boundary also gives a simple loop-manager model: select runnable goals/tasks externally, assign an isolated worktree and CR to a worker, let the worker produce code plus records, then use the CR and process result to decide whether the next action is automatic or requires the developer.

## Record templates

- [CR template](docs/records/cr/CR-TEMPLATE.md)
- [ADR template](docs/records/adr/ADR-TEMPLATE.md)
- [Living CR decision](docs/records/adr/ADR-002-use-living-crs-as-development-records.md)

## Installation

```bash
npm install -g github:dfosco/clips
```

### Setup

```bash
# In any git repo with a GitHub remote
clips init
```

`clips init` creates the legacy `.clips/` working state and imports existing GitHub Issues as goals. The planning-store migration described above is the target model.

Set `collaboration` to `false` for local mode. Goal/task mutations remain local, while `clips sync` still performs authenticated, pull-only GitHub reads. It imports Issues as goals and PRs as read-only external metadata; it never creates, edits, closes, reopens, or pushes GitHub objects. Pull failures are reported as warnings and do not remove existing local data. The CLI keeps local planning data and adds `.clips/` to `.gitignore`.

## Commands

```bash
clips view                          # List all goals with tasks
clips view #g001                    # View a specific goal

clips goal create '{"title":"..."}'  # Create goal (+ GitHub Issue)
clips goal create '{"title":"...","verification_mode":"behavior_and_tests","behavior":"Feature: ..."}'
clips goal status g1 closed         # Close goal (+ close issue)

clips task create-batch g001 '[{"title":"Task A"},{"title":"Task B"}]'
clips task status g1 t1 closed      # Close task (+ update issue)

clips sync                           # Pull Issues/PRs; push only when collaboration is enabled
clips config                         # View configuration
```

## Local board

Run the read-only local kanban board from a Clips repository:

```bash
npm install
npm run web:dev
# Or, from any directory inside this repository:
clips web
```

Open the printed local URL. The board reads all discoverable goals and tasks from `.clips/db`, including local-only goals and goals with GitHub metadata. It exposes only `GET /api/board`; the UI cannot create, edit, reorder, or synchronize planning data.

`clips sync` also pulls all GitHub PRs with the existing `gh` CLI session. A PR is associated only when its title or body explicitly references `#g001`, `#g001#t01`, or `CR-NNN`. Matched PRs are recorded as `github_pr_synced` events in the goal stream; unmatched PRs are retained in `.clips/db/_github.jsonl`, which is a reserved cache and is not discovered as a goal. Repeated pulls are idempotent by repository and PR number. The board shows linked PRs on CRs and goal/task details, plus unmatched changes on the CR surface; PR links open GitHub in a new tab.

Build and test the board with:

```bash
npm run web:build
npm run web:test
```

Use the committed templates for records until record-specific CLI commands are introduced. Do not add goals or tasks to `docs/records/`.

## Current data model

The compatibility CLI currently represents planning state as append-only JSONL:

- **Goals** are local records mirrored to GitHub Issues.
- **Tasks** are checklist items within a goal, or sub-issues when configured. Their verification mode inherits from the goal unless overridden.
- **Behavior** is optional, uninterpreted Gherkin-style text on a goal or task.
- **Verification modes** are `behavior` and `behavior_and_tests`; missing legacy values resolve to `behavior`.
- **Events** are append-only JSONL lines such as `goal_created` and `status_changed`.
- **Refs** include `#g001`, `#g001#t1`, and shorthand forms such as `g1 t1`.

That storage format is an implementation detail of the current CLI, not the repository-record model.

## Releasing

```bash
npm run release              # patch
npm run release:minor        # minor
npm run release:major        # major
```

The release command runs tests, updates the version, creates a tag and commit, pushes to GitHub, and creates a GitHub Release. It requires the [GitHub CLI](https://cli.github.com/) to be installed and authenticated.

## License

MIT
