---
name: clips-develop-change
description: Implement a Clips task or repository change through a living Draft CR, CLI-managed progress, repository-native verification, and review-ready handoff. Routed by the main Clips skill for development.
---

# Develop a change

Own the implementation and its evidence. Keep stable intent in goals and tasks; keep evolving design, discoveries, and verification in one living CR.

## Recontextualize

Before source edits:

1. Run `clips view` and `clips view <goal-or-task>` for the relevant contract and completed neighboring work.
2. Run `git status --short`, inspect recent commits, and identify the branch, base branch, and full base commit.
3. Read repository instructions, adjacent source, established tests, active CRs, and related ADRs.
4. Name the data shape and ownership boundary before writing stateful logic.
5. Reproduce a reported defect before fixing it when a safe reproduction path exists.

If a referenced task or goal is open and work is beginning, update progress through the CLI:

```bash
clips goal status <goal> in_progress
clips task status <goal> <task> in_progress
```

## Create the living CR

Every non-trivial reviewable diff gets exactly one active CR before source implementation. Reuse the active CR when it already covers the change. Otherwise choose an unused `CR-NNN` identifier, copy `docs/records/cr/CR-TEMPLATE.md` into `.clips/records/cr/`, and populate:

- exact `Branch`, `Base branch`, and full `Base commit`;
- `Parent CR` only for a real stacked review dependency;
- covered goal and task refs, or `Untracked`;
- why the change matters;
- proposed design, boundaries, expected files, risks, and open product questions;
- repository-native verification strategy.

Creating and editing the Markdown body is file work. Keep lifecycle `Draft` during implementation and use `clips record status` for later transitions. Never change the status field by hand.

## Implement

- Resolve blocking facts before broad edits.
- Prefer the smallest coherent design that reaches the goal behavior.
- Separate concurrent writers by file, branch, worktree, or owned state. Serialize only a genuine single-writer invariant.
- Update the CR only for discoveries, choices, risks, and deviations a reviewer needs. Do not keep a command diary.
- Preserve unrelated work and remain within the user's authorized scope.
- Do not create an ADR for ordinary implementation design. Update or create one only when a durable cross-cutting decision genuinely requires it.

When the change is repetitive or difficult to inspect, build a rerunnable script or check. When several viable shapes exist with no precedent, compare concrete alternatives before committing to one.

## Verify and hand off

Route completed implementation through `clips-verify-outcome`. Consolidate the CR so its Result, Behavior, Files changed, verification evidence, compatibility impact, and records describe the actual diff rather than the initial proposal.

When implementation and author-run verification are complete:

```bash
clips record status <CR> in_review
```

Close a task only after its completion evidence exists:

```bash
clips task status <goal> <task> closed
```

Close a building goal only when it contains tasks and every required task is complete:

```bash
clips goal status <goal> closed
```

Do not set a CR to Accepted. Return what changed, the main design choice, verification evidence, compatibility impact, CR reference, covered planning refs, and remaining review work.
