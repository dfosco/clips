# clips

`clips` manages local workflow state without adding it to repository history:

- **Planning state:** goals and tasks under `.clips/db/`, optionally mirrored to GitHub Issues after explicit opt-in.
- **Review and decision records:** CRs and ADRs under `.clips/records/`.
- **Committed schemas:** record templates under `docs/records/`; these are not record instances.

CR = Change Record  
ADR = Architecture Decision Record  

This keeps planning and review state local while allowing the repository to ship shared record formats.

## Artifact model

| Artifact | Role | Lifecycle | Repository location |
|---|---|---|---|
| Goal | An outcome or epic | Before and during work | External clips store |
| Task | An actionable piece of a goal | Before and during work | External clips store |
| CR | The review packet for a repository change; the local equivalent of a PR | Draft → In Review → Accepted → Merged | `.clips/records/cr/` |
| ADR | A durable cross-cutting architectural decision | Proposed → Accepted → Superseded | `.clips/records/adr/` |
| Other record | Optional project-defined workflow record | Project-defined | `.clips/records/<type>/` |

Goals and tasks define intended outcomes. CRs explain specific implementation attempts. ADRs preserve rare, cross-cutting architectural decisions for the local workflow. Committed product documentation describes current user-visible behavior.

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

A Draft CR and Draft PR are counterparts. The CR is local workflow state and preserves rationale; the PR is provider-hosted and exposes the diff and collaboration state. Either can exist without the other.

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

Goals, tasks, CRs, ADRs, and other record instances are workflow state. They live under `.clips/` and must not be committed. `.clips` is excluded through the repository-local `.git/info/exclude`, so no shared `.gitignore` change is required.

Committed `docs/records/` files are templates only. Product documentation and source code remain repository state. Workers and supervisors may update `.clips` workflow artifacts, but source changes remain governed by the normal worktree boundary.

This gives a simple loop-manager model: select runnable goals/tasks, assign a worktree and local CR, let the worker produce code while maintaining `.clips` records, then use the CR and process result to choose the next action.

## Record templates

- [CR template](docs/records/cr/CR-TEMPLATE.md)
- [ADR template](docs/records/adr/ADR-TEMPLATE.md)

Copy templates into `.clips/records/<type>/` when creating a record. Never put record instances beside the templates.

## Installation

```bash
npm install -g @dfosco/clips
```

Or run it without a global install:

```bash
npx @dfosco/clips --help
```

### Setup

```bash
# In any git repo with a GitHub remote
clips init
```

`clips init` creates local `.clips/` working state, including `.clips/records/{cr,adr}/`. It does not contact GitHub or import Issues by default.

Non-collaborative mode is the default. Goal/task mutations remain local, and `clips init` plus `clips sync` perform no GitHub Issue or pull-request reads or writes. Clips adds `.clips` to the repository-local `.git/info/exclude`, leaving the shared `.gitignore` unchanged.

GitHub integration requires explicit opt-in:

```bash
clips config collaboration true
clips sync
```

Existing repositories that already set `collaboration: true` remain collaborative.

## Commands

```bash
clips view                          # List all goals with tasks
clips view #g001                    # View a specific goal

clips goal create '{"title":"..."}'  # Create local goal
clips goal create '{"title":"...","verification_mode":"behavior_and_tests","behavior":"Feature: ..."}'
clips goal status g1 closed         # Close local goal
clips goal unlink g1                # Keep a linked goal local without changing its GitHub issue
clips goal unlink --all             # Unlink every linked goal in this repository

clips task create-batch g001 '[{"title":"Task A"},{"title":"Task B"}]'
clips task status g1 t1 closed      # Close local task

clips sync                           # No-op unless collaboration is explicitly enabled
clips config                         # View configuration
```

`clips goal unlink <ref>` appends a local unlink event, removes the goal and its tasks from future GitHub synchronization, and leaves existing remote issues unchanged. Use `clips goal unlink --all` to detach every linked goal in the current repository. Both forms are safe to repeat and leave already-local goals unchanged.

## Local board

Run the read-only kanban board from any directory after installing Clips:

```bash
clips web
```

Open the printed local URL. Inside an initialized Clips repository, the board opens that project. Everywhere else, it opens all projects registered by `clips init`, with a project multi-select for narrowing the combined view. Missing project paths are pruned safely from the system registry at `~/.clips/projects.json` (or `$CLIPS_HOME/projects.json`).

Projects use their repository directory name as the default ID. Override it later with `clips config project_id <id>`; IDs must be unique across registered projects. Combined references are qualified as `project#g001` and `project#g001#t01`, and project identity is shown throughout the board.

The board reads discoverable goals and tasks from each project’s `.clips/db`, including local-only goals and goals with GitHub metadata. It exposes only `GET /api/board`; the UI cannot create, edit, reorder, or synchronize planning data. Use `clips web --host <host> --port <port>` to customize the local server.

For development from this repository:

```bash
npm install
npm run web:dev
```

`clips sync` also pulls all GitHub PRs with the existing `gh` CLI session. A PR is associated only when its title or body explicitly references `#g001`, `#g001#t01`, or `CR-NNN`. Matched PRs are recorded as `github_pr_synced` events in the goal stream; unmatched PRs are retained in `.clips/db/_github.jsonl`, which is a reserved cache and is not discovered as a goal. Repeated pulls are idempotent by repository and PR number. The board shows linked PRs on CRs and goal/task details, plus unmatched changes on the CR surface; PR links open GitHub in a new tab.

Build and test the board with:

```bash
npm run web:build
npm run web:test
```

Use committed templates for schemas until record-specific CLI commands are introduced. Create every record instance under `.clips/records/`; never under `docs/records/`.

## Current data model

The compatibility CLI currently represents planning state as append-only JSONL:

- **Goals** are local records mirrored to GitHub Issues.
- **Tasks** are checklist items within a goal, or sub-issues when configured. Their verification mode inherits from the goal unless overridden.
- **Behavior** is optional, uninterpreted Gherkin-style text on a goal or task.
- **Verification modes** are `behavior` and `behavior_and_tests`; missing legacy values resolve to `behavior`.
- **Records** are Markdown instances under `.clips/records/<type>/`; board CR discovery reads `.clips/records/cr/`.
- **Events** are append-only JSONL lines such as `goal_created` and `status_changed`.
- **Refs** include `#g001`, `#g001#t1`, and shorthand forms such as `g1 t1`.

That storage format is an implementation detail of the current CLI, not the repository-record model.

## Releasing

```bash
npm run release              # patch
npm run release:minor        # minor
npm run release:major        # major
npm publish                   # publish the tagged version to npm
```

The versioning commands run tests, update the version, create a tag and commit, push to GitHub, and create a GitHub Release. They require the [GitHub CLI](https://cli.github.com/) to be installed and authenticated. `npm publish` reruns the complete test and package smoke suite before publishing the public `@dfosco/clips` package.

## License

MIT
