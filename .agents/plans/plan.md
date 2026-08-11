# Superseded plan: commit and push `.clips/` on every mutation

This plan is superseded by [ADR-001](../../docs/records/adr/ADR-001-separate-planning-state-from-repository-records.md).

Goals and tasks are planning state and should move to an external workflow store. They must not be made repository commits as part of normal clips mutations. CRs, ADRs, and FDRs are the repository-committed records.

The historical proposal is retained below for context only; it is not an implementation target.

## Problem

Currently, mutations write JSONL files and push to the GitHub API, but the `.clips/db/` files are not reliably committed to git or pushed to the remote. The `syncAfterMutation` calls `refresh push` (which uses a complex ledger branch workflow), but `pushGoal()` writes additional events (e.g., `github_synced`) with `skipSync: true` — those never get committed.

## Goal

Every mutation should end with `.clips/` committed and pushed to the remote. The flow:

1. `git pull --rebase` (reduce conflicts)
2. Local JSONL write
3. GitHub API push (`pushGoal`)
4. `git add .clips/ && git commit && git pull --rebase && git push`

This should be a single function called at the end of every mutation, replacing the current `syncBeforeMutation`/`syncAfterMutation` pair.

## Design

### New function: `commitAndPush(message)` in `src/lib/core.js`

```js
export function commitAndPush(message = 'clips update') {
  const root = getRepoRoot();
  // Pull first to reduce conflicts
  run('git pull --rebase', { cwd: root, silent: true });
  // Stage all clips data
  run('git add .clips/', { cwd: root, silent: true });
  // Check if there's anything to commit
  const staged = run('git diff --cached --quiet .clips/ || echo "changes"', { cwd: root, silent: true });
  if (staged && staged.trim() === 'changes') {
    run(`git commit -m "${message}"`, { cwd: root, silent: true });
    // Push with pull --rebase on failure
    try {
      run('git push', { cwd: root, silent: true });
    } catch {
      run('git pull --rebase', { cwd: root, silent: true });
      run('git push', { cwd: root, silent: true });
    }
  }
}
```

### Remove old sync machinery

- Remove `syncBeforeMutation()` and `syncAfterMutation()` from `core.js`
- Remove `syncInProgress` flag
- Remove `skipSync` option from `appendEvent` (no longer needed — sync happens at the end, not per-event)
- Remove `refresh.js` command entirely (replaced by simple git commit+push)
- Remove `refresh` from CLI

### Update mutation commands

In `goal.js`, `task.js`: after `pushGoal()`, call `commitAndPush(message)`:

```js
// goal create
appendEvent(goalId, event);
try { pushGoal(goalId); } catch (e) {}
commitAndPush(`clips: create goal ${goalId}`);
```

Same for all mutations: `goal update`, `goal status`, `task create`, `task create-batch`, `task status`, `task update`, `task reorder`.

In `sync.js` lib: `syncAll()` and `syncGoal()` should call `commitAndPush` at the end.

In `init.js`: after `pullAllIssues()`, call `commitAndPush('clips: init')`.

### Config: `auto_commit` (default: `true`)

Add to DEFAULT_CONFIG. When `false`, skip git commit/push (for users who manage commits themselves). Solo mode (`collaboration: false`) also skips.

## Todos

1. **add-commit-push** — Add `commitAndPush()` to core.js, remove old sync functions, remove skipSync from appendEvent
2. **update-mutations** — Update goal.js and task.js: remove syncBeforeMutation calls, add commitAndPush after pushGoal
3. **update-sync-lib** — Update sync.js: remove skipSync from appendEvent calls, call commitAndPush at end of syncAll/syncGoal
4. **update-init** — Add commitAndPush after pullAllIssues in init.js
5. **remove-refresh** — Delete refresh.js, remove from cli.js
6. **validate** — Test full flow: mutation → JSONL written → GitHub Issue updated → git committed + pushed
