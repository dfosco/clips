# clips

`clips` manages two related but deliberately separate things:

- **Planning state:** goals and tasks, kept in an external workflow store and optionally mirrored to GitHub Issues.
- **Repository records:** CRs, ADRs, and FDRs, committed with the code they describe.

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
| FDR | Durable current user-visible behavior and feature rationale | Proposed → Active → Experimental → Retired | `docs/records/fdr/` |

Goals and tasks are the meeting agenda. CRs, ADRs, and FDRs are the meeting minutes.

There is no fixed one-to-one mapping between planning and record artifacts:

- one CR may cover one task, several tasks, or a small complete goal;
- a task with no repository change needs no CR;
- a CR may reference a goal or task, but it is not their child item;
- one CR may update an existing ADR or FDR without creating a new one;
- an ADR or FDR is created only when a durable decision or behavior needs a new record.

The hard rule is: every non-trivial, reviewable repository diff is covered by exactly one active CR. A tiny bug fix or iteration still gets a small CR; it does not automatically get a new ADR or FDR.

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

CRs, ADRs, and FDRs are repository state. They must be committed in the target repository, under `docs/records/`. A worker may write these records in its isolated worktree as part of its change, but it must not mutate the external board. The supervisor may update board state, but must not edit source or committed records.

This boundary also gives a simple loop-manager model: select runnable goals/tasks externally, assign an isolated worktree and CR to a worker, let the worker produce code plus records, then use the CR and process result to decide whether the next action is automatic or requires the developer.

## Record templates

- [CR template](docs/records/cr/CR-TEMPLATE.md)
- [ADR template](docs/records/adr/ADR-TEMPLATE.md)
- [FDR template](docs/records/fdr/FDR-TEMPLATE.md)
- [Artifact model decision](docs/records/adr/ADR-001-separate-planning-state-from-repository-records.md)

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
- **Tasks** are checklist items within a goal, or sub-issues when configured.
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
