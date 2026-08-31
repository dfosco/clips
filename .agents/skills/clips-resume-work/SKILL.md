---
name: clips-resume-work
description: Reconstruct and resume Clips work from goals, tasks, living records, Git state, and existing evidence without redoing completed work. Routed by the main Clips skill for pickup and handoff.
---

# Resume work

Treat existing workflow records and repository artifacts as inherited state. Reconstruct the resume point before taking new action.

## Rebuild state

1. Run `clips view` and `clips view <goal-or-task>`.
2. Run `git status --short`, inspect the current branch, recent commits, and the diff against the relevant base.
3. Find the active CR from its `Covers`, branch, and base metadata. For planning work, find the attached ADR.
4. Read the record's proposed approach, development updates, result, verification evidence, and unchecked review items.
5. Compare planned work with the actual diff and current artifacts. Separate completed, in-progress, blocked, and stale claims.
6. Verify inherited completion claims against existing evidence and the current head. Do not rerun completed work merely to feel oriented.

If a status is stale and the user asked to resume execution, correct it through the CLI:

```bash
clips goal status <goal> in_progress
clips task status <goal> <task> in_progress
clips record status <CR-or-ADR> draft
```

Do not edit planning events or record status fields manually.

## Choose the resume point

- Route remaining implementation to `clips-develop-change`.
- Route missing or stale evidence to `clips-verify-outcome`.
- Route an unfinished planning decision to `clips-plan-decision`.
- Route a review-ready artifact to `clips-review-change`.

Preserve existing decisions unless current evidence disproves them. When overriding one, record the new evidence and reason in the living CR or ADR.

For a handoff, leave the work at a coherent boundary and update the active record with intent, completed work, verified evidence, current state, next action, key files, and gotchas. Do not create a parallel handoff format when the CR or ADR can carry the information.

Return what was inherited, the exact resume point, what evidence remains current, what is stale or blocked, and the first next action.
