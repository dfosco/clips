# clips v0.2 — Idempotent GitHub Issues Mirror

## Overview

Make clips a 1:1 bidirectional mirror of GitHub Issues. Goals are top-level issues, tasks are markdown checkbox items in the issue body. Optional config to promote tasks to their own sub-issues.

### Key changes from v0.1
1. **Bidirectional sync** — `clips init` imports existing GitHub Issues as goals, every mutation pushes immediately
2. **`clips sync`** — Replaces `github_sync`, idempotent bidirectional reconciliation
3. **`tasks_as_issues` config** — When true, tasks become their own GitHub Issues linked from parent

## Config Addition

Add to `DEFAULT_CONFIG` in `src/lib/config.js`:
```json
{
  "tasks_as_issues": false
}
```

- **`false` (default):** Tasks are markdown checkboxes in the parent issue body only
- **`true`:** Each task is also created as a separate GitHub Issue. The parent issue body links to them: `- [ ] #42 Task title`. Task status changes close/reopen the sub-issue.

## Sync Engine Design (`src/lib/sync.js`)

### Pull: GitHub → Local

`pullAllIssues()` — Fetch all issues via `gh issue list --state all --json number,title,body,state,createdAt,updatedAt --limit 1000`. For each:
- Scan local JSONL files to find matching `issue_number`
- If no match: assign next `gNNN` ID, write `goal_created` + `github_synced` events
- Parse `- [ ]` / `- [x]` task items from body → `task_created` events
- Map GitHub state: `open` → `to_do`, `closed` → `closed`
- Clip description to 200 chars

`parseTaskList(body)` — Extract `- [ ] title` / `- [x] title` from markdown. Returns `[{ title, done }]`.

`findGoalByIssueNumber(num)` — Scan all JSONL files for a `github_synced` event with matching `issue_number`. Returns `goalId` or `null`.

### Push: Local → GitHub

`pushGoal(goalId)` — Read local state, create or update GitHub Issue:
- No `issue_number`: create via `gh issue create`, record `github_synced`
- Has `issue_number`: update via `gh issue edit` (title, body with checkboxes)
- Close/reopen based on status mapping
- If `tasks_as_issues` is true: create/update sub-issues for each task

### Sync

`syncGoal(goalId)` — Pull latest from GitHub for this goal's issue, then push local state
`syncAll()` — Pull all from GitHub, then push any unsynced local goals

### Status Mapping

| clips status | GitHub state |
|---|---|
| `draft`, `to_do`, `in_progress` | open |
| `done`, `closed`, `archived` | closed |

Pull: `open` → keep local status (or `to_do` if new), `closed` → `closed`

## Modified Command Behaviors

### `clips init`
1. Create `.clips/` dir + config (existing)
2. **NEW:** Call `pullAllIssues()` — import all existing repo issues as goals
3. Report: "Imported N issues as goals"

### `clips goal create` → also creates GitHub Issue
### `clips goal update` → also updates GitHub Issue
### `clips goal status` → also closes/reopens GitHub Issue
### `clips task create/create-batch` → also updates GitHub Issue body
### `clips task status` → also updates checkbox / sub-issue state

### `clips sync` (new command, replaces `github_sync`)
- `clips sync` — pull all, reconcile, push
- `clips sync #g001` — sync a specific goal
- Idempotent

## Architecture

```
src/
  cli.js                # MODIFIED: add sync, remove github_sync
  lib/
    config.js           # MODIFIED: add tasks_as_issues to DEFAULT_CONFIG
    sync.js             # NEW: sync engine
  commands/
    goal.js             # MODIFIED: add pushGoal() after mutations
    task.js             # MODIFIED: add pushGoal() after mutations
    sync.js             # NEW: clips sync command
    init.js             # MODIFIED: call pullAllIssues() on fresh init
    github-sync.js      # DELETED
```

## Todos

1. **sync-lib** — Create `src/lib/sync.js`
2. **sync-cmd** — Create `src/commands/sync.js`
3. **update-config** — Add `tasks_as_issues` to DEFAULT_CONFIG
4. **update-init** — Import issues on fresh init
5. **update-goal** — Auto-sync after mutations
6. **update-task** — Auto-sync after mutations
7. **update-cli** — Wire sync, remove github_sync, update help
8. **validate** — End-to-end test
