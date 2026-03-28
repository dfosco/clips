---
name: clips
description: Local-first issue tracker that mirrors GitHub Issues. Use when creating goals, tasks, and tracking progress.
metadata:
  author: Daniel Fosco
  version: "2026.3.28"
---

# Skill: clips — Issue Tracking

clips is a local-first issue tracker that mirrors GitHub Issues. Data lives in `.clips/db/` as append-only JSONL files. Every mutation syncs to GitHub and commits to git automatically.

## Triggers

- "create an issue", "track this work", "let's plan this", "write a goal"
- "break this down into tasks", "add tasks to the goal"
- "what's the status?", "show me the issues", "what are we tracking?"
- "mark it done", "close that task", "update the status"
- "sync with github", "pull latest issues", "push to github"
- "set up clips", "initialize issue tracking"

## Concepts

**Goals** are top-level issues (GitHub Issues). Each goal has a title, description, status, and tasks.

**Tasks** are checklist items within a goal. They appear as markdown checkboxes in the GitHub Issue body. With `tasks_as_issues: true`, tasks become their own GitHub Issues.

**Refs** identify goals and tasks: `#g001`, `#g001#t1`, or shorthand `g1`, `g1 t1`.

**Statuses** mirror GitHub: `open`, `in_progress`, `closed`, `not_planned`, `duplicate`.

**Auto-sync**: Every mutation writes JSONL locally → pushes to GitHub API → commits `.clips/` to git.

---

## Commands

### `clips init`

Set up clips in the current repo. Creates `.clips/` directory, detects GitHub settings, and imports all existing GitHub Issues as goals.

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

Create a new goal (top-level issue). Automatically creates a GitHub Issue and commits to git.

**When to use:** Starting new work, planning a feature, tracking a bug, defining a milestone.

**Triggers:** "create a goal", "new issue", "let's track this", "plan a feature", "write up this work"

```bash
clips goal create '{"title":"Add authentication"}'
clips goal create '{"title":"Fix login bug","description":"Users get 500 on /login"}'
```

The JSON accepts: `title` (required), `description`, `acceptance_criteria` (array of strings).

---

### `clips goal status`

Change a goal's status. Automatically closes/reopens the GitHub Issue.

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

Update a goal's title, description, or acceptance criteria. Pushes changes to the GitHub Issue.

**When to use:** Refining scope, correcting a title, adding details after creation.

**Triggers:** "update the goal", "change the title", "edit the description", "add acceptance criteria"

```bash
clips goal update g1 '{"title":"New title"}'
clips goal update g1 '{"description":"Updated scope description"}'
clips goal update g1 '{"acceptance_criteria":["Users can login","Users can logout"]}'
```

---

### `clips task create`

Add a single task to a goal. Updates the GitHub Issue body with a new checkbox.

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

Bidirectional sync between local JSONL and GitHub Issues. Pulls new/updated issues from GitHub, pushes local changes. Idempotent — safe to run anytime.

**When to use:** After external changes on GitHub (someone edited an issue in the UI), to ensure local and remote are consistent, or as a periodic reconciliation.

**Triggers:** "sync issues", "pull from github", "push to github", "reconcile", "refresh issues", "update from remote"

```bash
clips sync              # Sync all goals ↔ GitHub Issues
clips sync #g001        # Sync a specific goal
clips sync g12          # Shorthand
```

---

### `clips config`

View or change clips configuration.

**When to use:** Checking current settings, enabling sub-issues for tasks, disabling auto-commit.

**Triggers:** "show config", "change settings", "enable sub-issues", "disable auto-commit"

```bash
clips config                            # Show all config
clips config tasks_as_issues            # Show specific key
clips config tasks_as_issues true       # Enable task sub-issues
clips config auto_commit false          # Disable auto git commit
clips config collaboration false        # Solo mode (no git sync)
```

**Config keys:**
- `default_branch` — Git branch (default: `main`)
- `username` — GitHub username
- `collaboration` — Enable git sync (default: `true`)
- `auto_commit` — Commit+push `.clips/` on mutations (default: `true`)
- `tasks_as_issues` — Create tasks as separate GitHub Issues (default: `false`)

---

## Data Storage

```
.clips/
  clips.config.json       # Configuration
  db/
    g001.jsonl            # Goal g001 + its tasks (append-only events)
    g002.jsonl            # Goal g002 + its tasks
```

Each `.jsonl` file is an append-only event log. State is computed by replaying events. Files are never overwritten.

## Workflow Example

```bash
# 1. Initialize in a repo
clips init

# 2. Create a goal
clips goal create '{"title":"Add user authentication"}'
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
