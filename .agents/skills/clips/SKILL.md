---
name: clips
description: Local-first planning and repository-record workflow. Use when creating goals, tasks, CRs, ADRs, and tracking progress.
metadata:
  author: Daniel Fosco
  version: "2026.3.28"
---

# Skill: clips — Planning and Records

clips is a local-first workflow tool that can mirror goals and tasks to GitHub Issues after explicit opt-in. Planning events live in `.clips/db/`; CR and ADR record instances live in `.clips/records/`. All are local workflow state and must not be committed. Committed `docs/records/` files are templates only.

## Triggers

- "create an issue", "track this work", "let's plan this", "write a goal"
- "break this down into tasks", "add tasks to the goal"
- "create a CR", "write a change record", "update the CR", "stack this CR"
- "write an ADR", "record this architectural decision", "update the ADR"
- "what's the status?", "show me the issues", "what are we tracking?"
- "mark it done", "close that task", "update the status"
- "sync with github", "pull latest issues", "push to github"
- "set up clips", "initialize issue tracking"

---

## Conversational Workflows

These workflows are **mandatory**. When a user triggers goal creation, task breakdown, or task implementation, you MUST follow the multi-step conversation described below. Do NOT skip steps or collapse the workflow into a single response.

Use `ask_user` for every question. One question per turn. Never bundle questions.

### Creating a Goal

When the user wants to create a goal (gives you a title, says "let's plan this", "new goal", etc.):

**Step 1 — Acknowledge and clarify.** Take the title they gave you and ask 2–3 clarifying questions, one at a time. Focus on:
  - What problem this solves or what outcome they want
  - What the scope is (what's in, what's out)
  - Any constraints, dependencies, or context that matters

**Step 2 — Draft the goal description and behavior.** After you have enough context, write a 3–4 paragraph description of the problem/goal. This should read like a well-written GitHub Issue body:
  - Paragraph 1: The problem or motivation — why this work matters
  - Paragraph 2: What the solution looks like at a high level
  - Paragraph 3: Scope boundaries — what's included and what's explicitly not
  - Paragraph 4 (optional): Technical considerations, constraints, or open questions

Unless the user explicitly asks not to include behavior, also generate a concise, implementation-neutral Gherkin-like behavior description. Include a `Feature` and one or more `Scenario` blocks using `Given`, `When`, and `Then` to express observable outcomes. Do not ask whether to include behavior by default, and do not add an empty behavior placeholder when the user opts out.

Present the description and behavior to the user and ask them to confirm, using `ask_user`: _"Does this capture the goal correctly, or would you like to change anything?"_

**Step 3 — Create the goal.** Once confirmed, run `clips goal create` with the title, full description, and generated `behavior`. Omit `behavior` only when the user explicitly opted out. Show the user the created goal reference (e.g. `#g001`).

**Step 4 — Offer task breakdown.** Ask: _"Would you like to break this down into tasks?"_ If yes, move to the Task Breakdown workflow. If no, you're done.

### Breaking Down into Tasks

When the user wants to add tasks (after goal creation, or "break this into tasks", "add tasks to g1"):

**Step 1 — Gather tasks.** Ask the user to list the tasks they have in mind. They may give you rough ideas, single words, or partial descriptions.

**Step 2 — Refine titles.** Take what they gave you and refine each into a clear, descriptive task title. Task titles should:
  - Be long enough to be self-explanatory (someone reading just the title should know what to do)
  - Be short enough to scan in a list (one line, no more than ~15 words)
  - Start with a verb when possible ("Add…", "Implement…", "Update…", "Remove…")
  - Not duplicate information already in the goal title

Present the refined list and ask the user to confirm or adjust, using `ask_user`.

**Step 3 — Create the tasks.** Once confirmed, run `clips task create-batch` with the final titles. Show the result.

**Step 4 — Offer continuation.** Ask if they want to add more tasks or if the breakdown is complete.

### Implementing a Task

When the user asks to implement a task (e.g. "work on t1", "implement the next task", "let's do g1 t2"):

**Step 1 — Recontextualize.** Before writing any code, gather context silently (don't narrate each step to the user, just do it):
  1. Run `clips view` to get the current state of all goals and tasks
  2. Run `git --no-pager log --oneline -10` to see recent commits
  3. Check the relevant files in the repo that the task will touch
  4. Review which tasks are already closed to understand what's been done

**Step 2 — Pad out the plan.** Based on the context gathered, write a brief implementation plan for this specific task: what files to touch, what changes to make, what order to do them in. Present this to the user and confirm before proceeding.

**Step 3 — Execute.** Implement the task. When done, run `clips task status <goal> <task> closed` to mark it complete.

**Step 4 — Next task.** After completing the task, show the updated goal status with `clips view <goal>` and ask if they want to continue with the next task.

### Creating or Updating Repository Records

Use these rules whenever the user asks for a CR, ADR, or asks to document repository work:

1. Determine the record type from the requested outcome. A CR records a repository change; an ADR records a durable cross-cutting architectural decision.
2. Do not create a new ADR merely because a task or CR exists. Update an existing record when it still describes the decision. Small bug fixes and feature iterations normally need only a CR.
3. Every non-trivial, reviewable repository diff gets exactly one active CR. A CR may cover one task, several tasks, or a complete small goal. It is not a child item of a goal or task.
4. Create or update record instances in `.clips/records/<type>/`. Never commit goals, tasks, CRs, ADRs, or other workflow instances. Files under `docs/records/` are template schemas only.
5. For a stacked CR, set `Parent CR` and record the exact Git basis. Do not create a separate stack record.

When a repository change starts, create the CR as `Draft`. When implementation and verification are complete, update it to `In Review`. Only a human may manufacture explicitly human-owned approval states such as `Testing`, `Needs Changes`, and `Ready to Merge`.

Use the following canonical templates. Preserve the field names and section order unless the user asks for a variant.

#### Goal template

Goals are external planning artifacts and are not committed to the source repository. Include generated Gherkin-like behavior unless the user explicitly asks not to.

````md
# Goal: Outcome title

**Status:** open | in_progress | closed | not_planned | duplicate

## Outcome

What outcome should exist when this goal is complete?

## Problem and context

Why is this work needed?

## Scope

What is included and explicitly excluded?

## Behavior

```gherkin
Feature: Observable outcome
  Scenario: Representative behavior
    Given a relevant starting condition
    When an actor performs an action
    Then an observable outcome occurs
```

## Acceptance criteria

- Observable condition that proves the outcome exists.

## Constraints and dependencies

Known limits, dependencies, or unresolved questions.
````

For the current CLI, map the goal to `clips goal create` with `title`, `description`, `behavior`, and `acceptance_criteria`. Keep the description concise enough to serve as the planning brief. Omit `behavior` only after an explicit user request.

#### Task template

Tasks are external planning artifacts associated with a goal.

```md
- [ ] Task title beginning with a verb
  - Goal: #g001
  - Outcome: What this task produces.
  - Done when: Observable completion condition.
  - Dependencies: Other task or external dependency, or None.
```

For the current CLI, create the task with `title` and optional `description` under the goal. Do not turn each task into a CR unless it produces a repository diff; one CR may cover multiple tasks.

#### CR template

CR instances are local under `.clips/records/cr/CR-NNN-short-title.md`. Start from committed `docs/records/cr/CR-TEMPLATE.md`, but never place instances beside the template.

```md
# CR-NNN: Change title

**Status:** Draft | In Review | Accepted | Merged | Rejected | Abandoned
**Type:** Feature | Bugfix | Maintenance | Documentation
**Branch:** exact-worker-branch
**Base branch:** main
**Base commit:** FULL_COMMIT_ID
**Parent CR:** CR-NNN | None
**Covers:** #g001, #g001#t1 | Untracked

## Why

## What changed

## Behavior

## Files changed

| File | Semantic role |
|---|---|
| `path/to/file` | Role |

## Test plan

- [ ] Exact command and result

## Compatibility and operations

## Documentation and records

List ADRs created or updated, or `None`.

## Review

- [ ] Changed files inspected
- [ ] Regression coverage reviewed
- [ ] CR branch and base verified
- [ ] Stacked dependency reviewed, if applicable
- [ ] Ready to merge
```

`Parent CR` expresses a stacked review dependency, not a planning hierarchy. The branch, base branch, and base commit must describe the exact change being reviewed.

#### ADR template

ADR instances are local under `.clips/records/adr/ADR-NNN-short-title.md`. Start from committed `docs/records/adr/ADR-TEMPLATE.md`. Create one only for a durable architectural decision.

```md
# ADR-NNN: Decision title

**Status:** Proposed | Accepted | Superseded | Retired
**Date:** YYYY-MM-DD
**Decision basis:** FULL_COMMIT_ID
**Supersedes:** ADR-NNN | None

## Context

## Decision

## Consequences

## Related

CRs, goals, tasks, or external references.
```

---

## Concepts

**Goals** are top-level planning items, optionally mirrored as GitHub Issues. Each goal has a title, description, status, and tasks.

**Tasks** are actionable planning items within a goal. They appear as markdown checkboxes in the GitHub Issue mirror. With `tasks_as_issues: true`, tasks become their own GitHub Issues.

**Refs** identify goals and tasks: `#g001`, `#g001#t1`, or shorthand `g1`, `g1 t1`.

**Statuses** mirror GitHub: `open`, `in_progress`, `closed`, `not_planned`, `duplicate`.

**Record boundary**: Goals, tasks, CRs, and ADRs are local workflow state under `.clips/` and are never committed. Every non-trivial repository diff gets one active local CR. Committed product documentation holds user-visible truth; committed `docs/records/` files are schemas only. A CR can cover one task, several tasks, or a small complete goal, and may update an existing ADR.

**CR basis**: Every CR records `Branch`, `Base branch`, `Base commit`, and optional `Parent CR`. `Parent CR` expresses a stacked review dependency; it is not a task hierarchy.

---

## Commands

### `clips init`

Set up clips in the current repo. Creates local `.clips/` state with collaboration disabled. It does not contact GitHub or import Issues by default.

**When to use:** First time using clips in a repo, or when a repo has existing GitHub Issues you want to track locally.

**Triggers:** "set up clips", "initialize tracking", "start using clips", "import issues"

```bash
clips init
```

---

### `clips view`

Display goals and tasks in a human-readable terminal format with status icons (🟢 open, 🟠 in_progress, 🟣 closed, ⚪ not_planned/duplicate).

**When to use:** To see what's being tracked, check progress, review task lists before making changes.

**Triggers:** "show issues", "what are we working on", "list goals", "show progress", "what's open", "view tasks"

```bash
clips view                  # List all goals with tasks
clips view #g001            # View a specific goal with details
clips view #g001#t1         # View a specific task
clips view all              # Include hidden statuses
clips view --all-users      # Show all users' goals
```

---

### `clips goal create`

Create a new goal (top-level planning item). The current compatibility CLI may create or update a GitHub Issue mirror.

**When to use:** Starting new work, planning a feature, tracking a bug, defining a milestone.

**Triggers:** "create a goal", "new issue", "let's track this", "plan a feature", "write up this work"

```bash
clips goal create '{"title":"Add authentication","behavior":"Feature: User authentication\n  Scenario: Sign in with valid credentials\n    Given a registered user\n    When the user submits valid credentials\n    Then the user is signed in"}'
clips goal create '{"title":"Fix login bug","description":"Users get 500 on /login","behavior":"Feature: Reliable login\n  Scenario: Open the login page\n    Given the service is available\n    When a user opens /login\n    Then the login page is displayed without a server error"}'
```

The JSON accepts: `title` (required), `description`, `behavior` (Gherkin-like text), `acceptance_criteria` (array of strings). Generate `behavior` by default; omit it only when the user explicitly asks not to include it.

---

### `clips goal status`

Change a goal's status. A linked GitHub Issue changes only when collaboration was explicitly enabled.

**When to use:** When work begins, completes, or is cancelled.

**Triggers:** "start working on", "mark as done", "close the goal", "this is a duplicate", "won't fix"

```bash
clips goal status g1 in_progress    # Work started
clips goal status g1 closed         # Completed
clips goal status g1 not_planned    # Won't do
clips goal status g1 duplicate      # Duplicate of another
clips goal status g1 open           # Reopen
```

Valid statuses: `open`, `in_progress`, `closed`, `not_planned`, `duplicate`.

---

### `clips goal update`

Update a goal's title, description, behavior, or acceptance criteria. Pushes to a linked GitHub Issue only when collaboration was explicitly enabled.

**When to use:** Refining scope, correcting a title, adding details after creation.

**Triggers:** "update the goal", "change the title", "edit the description", "update behavior", "add acceptance criteria"

```bash
clips goal update g1 '{"title":"New title"}'
clips goal update g1 '{"description":"Updated scope description"}'
clips goal update g1 '{"behavior":"Scenario: Updated outcome\n  Given a relevant condition\n  When the goal behavior occurs\n  Then the updated outcome is observable"}'
clips goal update g1 '{"acceptance_criteria":["Users can login","Users can logout"]}'
```

---

### `clips goal unlink`

Disconnect one or all goals and their tasks from GitHub while preserving local planning history and existing remote issues. Detached goals remain local even when repository collaboration is enabled later.

```bash
clips goal unlink g1
clips goal unlink #g001
clips goal unlink --all
```

Both forms are idempotent. `--all` skips goals that are already local, and future local mutations or `clips sync` do not recreate, edit, or import detached issues.

---

### `clips task create`

Add a single task to a goal. Updates a linked GitHub Issue only when collaboration was explicitly enabled.

**When to use:** Adding one task to an existing goal.

**Triggers:** "add a task", "one more thing to do"

```bash
clips task create g001 '{"title":"Write unit tests"}'
clips task create g001 '{"title":"Update docs","description":"Add API reference"}'
```

---

### `clips task create-batch`

Add multiple tasks to a goal at once. Supports JSON argument or `--stdin` for piped input.

**When to use:** Breaking a goal down into tasks, planning implementation steps, decomposing work.

**Triggers:** "break this down", "add tasks", "decompose into steps", "plan the tasks", "create a task list"

```bash
clips task create-batch g001 '[{"title":"Design schema"},{"title":"Write migrations"},{"title":"Add API endpoints"}]'

# Or pipe from stdin (avoids shell escaping)
echo '[{"title":"Task 1"},{"title":"Task 2"}]' | clips task create-batch g001 --stdin
```

---

### `clips task status`

Change a task's status. Updates the checkbox in the GitHub Issue body.

**When to use:** Marking a task as started, done, or cancelled.

**Triggers:** "mark task done", "complete this task", "close the task", "start working on task", "skip this task"

```bash
clips task status g1 t1 closed          # Task complete
clips task status g1 t1 in_progress     # Working on it
clips task status #g001#t1 not_planned  # Won't do
clips task status g1 t1 open            # Reopen
```

Flexible ID formats: `g1 t1`, `g001 t01`, `#g001#t1` all work.

---

### `clips task update`

Update a task's title or description.

**When to use:** Correcting a task name, adding implementation details.

**Triggers:** "rename the task", "update task description", "edit task"

```bash
clips task update g001 t01 '{"title":"Renamed task"}'
clips task update g1 t1 '{"description":"Added details"}'
```

---

### `clips task reorder`

Reorder tasks within a goal. Only works when the goal is `open` and no tasks have been started.

**When to use:** Prioritizing tasks, changing implementation order.

**Triggers:** "reorder tasks", "change task order", "prioritize", "rearrange tasks"

```bash
clips task reorder g001 '["t03","t01","t02"]'
```

---

### `clips sync`

Bidirectional sync between local JSONL and GitHub Issues, available only after explicit opt-in with `clips config collaboration true`. With collaboration disabled, this command performs no GitHub reads or writes.

**When to use:** After external changes on GitHub (someone edited an issue in the UI), to ensure local and remote are consistent, or as a periodic reconciliation.

**Triggers:** "sync issues", "pull from github", "push to github", "reconcile", "refresh issues", "update from remote"

```bash
clips sync              # Sync all goals ↔ GitHub Issues
clips sync #g001        # Sync a specific goal
clips sync g12          # Shorthand
```

---

### `clips web`

Start the read-only kanban board. Inside an initialized Clips repository it opens that project; from any other directory it opens all projects registered by `clips init`. The board exposes only `GET /api/board` and cannot create, edit, reorder, or synchronize planning data.

**When to use:** Reviewing one project or combining goals and tasks from multiple initialized repositories in a visual board.

**Triggers:** "open the board", "show the kanban board", "start the local board", "view planning board"

```bash
clips web                              # Current project, or all registered projects elsewhere
clips web --host 127.0.0.1 --port 4173
```

Open the printed local URL. The installed package includes the board assets and does not require Vite or project-local dependencies. The project selector supports combining registered projects; qualified references use `project#g001#t01`.

---

### `clips config`

View or change clips configuration.

**When to use:** Checking current settings or enabling sub-issues for tasks. The legacy `auto_commit` setting does not change the repository-record boundary.

**Triggers:** "show config", "change settings", "enable sub-issues"

```bash
clips config                            # Show all config
clips config tasks_as_issues            # Show specific key
clips config tasks_as_issues true       # Enable task sub-issues
clips config collaboration false        # Solo mode (no git sync)
clips config project_id my-project      # Override the repository-name board ID
```

**Config keys:**
- `default_branch` — Git branch (default: `main`)
- `username` — GitHub username
- `collaboration` — Enable GitHub reads and writes during init, sync, and goal/task mutations (default: `false`; explicit opt-in)
- `auto_commit` — Legacy compatibility setting; planning state should move to the external workflow store
- `tasks_as_issues` — Create tasks as separate GitHub Issues (default: `false`)
- `agent_dir` — Agent directory name for skill file (auto-detected; e.g. `.agents`, `.claude`, `.github`)
- `project_id` — Unique cross-project board ID (defaults to the repository directory name)

---

## Data Storage

```
.clips/
  clips.config.json       # Configuration
  db/
    g001.jsonl            # Goal g001 + its tasks (append-only events)
    g002.jsonl            # Goal g002 + its tasks
  records/
    cr/                   # Local Change Record instances
    adr/                  # Local Architecture Decision Record instances
```

Each `.jsonl` file is an append-only event log. State is computed by replaying events. Files are never overwritten.

## Workflow Example

```bash
# 1. Initialize in a repo
clips init

# 2. Create a goal
clips goal create '{"title":"Add user authentication","behavior":"Feature: User authentication\n  Scenario: Sign in\n    Given a registered user\n    When the user submits valid credentials\n    Then the user is signed in"}'
# → Creates goal g001, GitHub Issue #1

# 3. Break into tasks
clips task create-batch g001 '[
  {"title":"Design auth schema"},
  {"title":"Implement JWT middleware"},
  {"title":"Add login/logout endpoints"},
  {"title":"Write integration tests"}
]'
# → Updates Issue #1 body with checkboxes

# 4. Work through tasks
clips task status g1 t1 in_progress
clips task status g1 t1 closed
clips task status g1 t2 in_progress

# 5. Check progress
clips view #g001

# 6. Complete the goal
clips goal status g1 closed
# → Closes Issue #1
```
