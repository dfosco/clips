---
name: clips-break-down-work
description: Decompose a Clips building goal into minimal verifiable tasks and create or reorder them through the CLI. Routed by the main Clips skill for task planning.
---

# Break down building work

Tasks are outcome slices, not implementation diaries. Decompose only as far as independent ownership, ordering, or verification requires.

## Ground the breakdown

1. Run `clips view <goal>` and confirm the goal type is `building`.
2. Read the goal behavior, acceptance criteria, constraints, existing tasks, relevant records, and repository conventions.
3. Identify blocking foundations, independent workstreams, shared write targets, and the smallest units that end in meaningful checks.

Use one task when the outcome is small and tightly coupled. More tasks are not more rigor. Do not create placeholder tasks for planning, generic phases such as "implement" and "test," or task-per-file breakdowns without an ownership reason.

## Define tasks

Each title should begin with a verb, remain scannable, and name a concrete outcome. Each description should contain:

- the outcome this slice produces;
- what is in and out of scope when not obvious from the goal;
- observable completion evidence;
- dependencies or shared-state constraints;
- behavior or verification-mode overrides only when they differ from the goal.

Put technical implementation choices in the Draft CR, not in stable task descriptions, unless the choice is itself a constraint of the goal.

## Create or update through the CLI

Create the complete initial set in one command:

```bash
clips task create-batch <goal> '<json-array>'
```

For large payloads, pass JSON through stdin. Add or refine later tasks with:

```bash
clips task create <goal> '<json>'
clips task update <goal> <task> '<json>'
```

Reorder only while the goal is open and no task has started:

```bash
clips task reorder <goal> '<task-id-array>'
```

Never append task events manually. After mutation, run `clips view <goal>` and verify order, inheritance, and scope.

Return the created or updated task refs, why the decomposition is the smallest safe one, dependency order, and any shared-state constraint that affects execution.
