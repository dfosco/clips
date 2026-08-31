---
name: clips-verify-outcome
description: Verify a Clips goal, task, or CR against the real artifact, record exact evidence, and update lifecycle through CLI commands when completion was requested. Routed by the main Clips skill for verification.
---

# Verify an outcome

Verification answers whether the promised outcome exists at the exact change being reviewed. It does not merely report that a proxy passed.

## Establish the contract

1. Run `clips view <goal-or-task>` and read its behavior, acceptance criteria, and effective verification mode.
2. Read the active CR's Behavior and Verification strategy.
3. Inspect repository instructions, scripts, CI configuration, adjacent tests, type conventions, and the actual diff.
4. Record the exact branch and head SHA being verified.

`behavior` requires observable evidence appropriate to the repository and risk. `behavior_and_tests` additionally requires automated test evidence. It does not prescribe a framework, test level, methodology, or test-writing order.

## Build the evidence chain

Use the strongest safe evidence available:

1. inspect the changed artifact and diff;
2. run focused repository-native checks;
3. run the broader relevant suite;
4. exercise the real CLI, UI, API, library call, stored value, or other user path;
5. verify side effects and important failure paths;
6. run package, build, compatibility, or performance checks when the change makes them material.

Types prove structural contracts, not runtime behavior. A build proves construction, not the user outcome. If real-surface verification is unavailable, report the gap as `BLOCKED` or `INCONCLUSIVE`; do not silently convert it into a pass.

Prefer deterministic rerunnable checks over one-time observation. Keep evidence paths or exact command results available to the reviewer.

## Record results

Update the CR body with exact commands, outcomes, head SHA where relevant, and unresolved gaps. Editing the record body is file work. Do not edit lifecycle status manually.

When this skill is part of an authorized implementation or completion workflow and every required check passes:

```bash
clips record status <CR> in_review
clips task status <goal> <task> closed
```

Close the goal through `clips goal status <goal> closed` only when its type-specific invariant and all required work are satisfied.

When the user asked only for verification, review, or status, do not mutate task, goal, or record lifecycle unless they also requested that update. Report the verdict and evidence instead.

Return `PASS`, `ISSUES`, `BLOCKED`, or `INCONCLUSIVE`, followed by the exact evidence, what was not exercised, and whether the result applies to the current head SHA.
