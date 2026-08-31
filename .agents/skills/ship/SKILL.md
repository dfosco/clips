---
name: ship
description: Runs a repository-aware workflow to isolate, plan, implement, review, validate, and push a change.
metadata:
  author: Daniel Fosco
  version: "2026.8.30"
---

# Ship Skill

> Triggered by: "ship", "ship this", "ship a feature", "ship it", "ship a change"
>
> This skill ships a change to a reviewable remote branch. It must not publish a package or create a release unless the user separately invokes the release workflow.

## What This Does

Carries a change from repository discovery through implementation, validation, review, documentation, and push. It follows the target repository's branch, worktree, planning, testing, commit, and review conventions rather than prescribing a particular toolchain.

## Step 1: Discover Repository Policy

Before choosing a branch or path, inspect repository instructions, current worktrees, branch state, remotes, package or build tooling, required checks, contribution guidance, and available local skills. Identify whether the repository requires:

- a worktree or permits work on the current branch;
- a branch naming convention or issue identifier;
- a checked-in plan or change request;
- specific test, lint, build, formatting, or documentation commands;
- commit-message conventions or attribution trailers;
- a pull request instead of a direct branch push.

Do not turn examples from this skill into repository policy.

## Step 2: Isolate The Change

Use the `worktree` skill when available and appropriate. Derive a short branch name from the requested outcome, preserving any user-provided branch name and documented prefix. Confirm the name only when it is ambiguous or repository policy requires confirmation.

Use the path returned by the worktree workflow for all subsequent commands. Do not assume it is `worktrees/<branch-name>`. Never discard changes in the source or target worktree.

If the repository explicitly does not use worktrees, create or use the required branch without silently switching a dirty working tree.

## Step 3: Plan Against Goals

Explore the relevant code before writing a plan. Define one to three measurable user-facing goals, then describe the smallest approach that satisfies them, affected files, implementation steps, edge cases, compatibility concerns, and validation.

Write the plan only when the repository has an established plan location or the user asks for a plan artifact. Otherwise keep it in task tracking. If approval is needed because the request is ambiguous, risky, destructive, or materially larger than stated, present the tradeoff and ask before implementation; do not add an unconditional approval gate to routine work.

Use repository-local issue or task tooling when available and useful. Do not require a specific tracker.

## Step 4: Implement

Make the smallest correct changes consistent with existing architecture and style. Preserve unrelated worktree changes. Add or update tests alongside the behavior they cover using the repository's existing framework and patterns.

Do not split implementation and tests into separate commits by default. Commit boundaries should represent coherent reviewable changes, not phases imposed by this skill.

## Step 5: Validate

Run the checks discovered in Step 1. Prefer documented aggregate commands. If no aggregate command exists, run the relevant tests and static checks for the changed area, expanding to the full suite when risk or repository policy warrants it.

Do not assume Node.js, npm, Vitest, or scripts named `lint`, `build`, `test`, or `dev`. Report any check that could not run and why.

## Step 6: Review

Review the full branch diff against its base, not only the last commit. Check for behavioral regressions, security problems, broken interfaces, concurrency or error-path failures, missing tests, and needless complexity.

Use an available review agent or skill when it adds value, but do not require an agent name that may not exist. Apply high-confidence fixes, rerun affected checks, and avoid speculative refactors that do not serve a stated goal.

Read existing architecture documentation for changed files when present. Update generated or authored architecture docs only through the repository's documented process.

## Step 7: Document And Commit

Update user-facing or architectural documentation when behavior, interfaces, operations, or durable design contracts changed. Do not edit every common documentation filename mechanically.

Stage only intended files and inspect the staged diff. Follow the repository's commit conventions. Add co-author or sign-off trailers only when required by repository policy or requested by the user; never hardcode an identity.

## Step 8: Push And Report

Push the branch to the configured remote only when shipping includes a push under the user's request and repository policy. Use the actual remote name rather than assuming `origin`. If the repository expects a pull request and the user asked for one, create it using the repository template and return its URL.

Report:

- branch and worktree path;
- concise change summary;
- validation commands and results;
- review findings resolved or left open;
- commit, remote branch, and pull request URL when created;
- any manual verification still required.

Start a development server only when requested or needed for verification. Use the documented command and report how to stop it.

## Rules

- Never ship directly to a protected or default branch unless repository policy and the user explicitly require it.
- Never release or publish as part of this workflow.
- Never assume a worktree directory, branch prefix, package manager, test framework, tracker, plan path, dev command, remote name, or commit trailer.
- Stop before destructive operations or unresolved high-severity failures; ordinary recoverable failures should be investigated and fixed.
- Preserve unrelated changes and state exactly what was pushed.
