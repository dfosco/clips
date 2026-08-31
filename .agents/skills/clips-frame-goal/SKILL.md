---
name: clips-frame-goal
description: Frame, create, or refine a Clips planning or building goal from repository evidence with minimal questioning. Routed by the main Clips skill for goal work.
---

# Frame a goal

Produce a useful goal quickly. Do not conduct an intake interview or use structure as a substitute for evidence.

## Ground the goal

1. Read the repository instructions.
2. Run `clips view all` to find overlapping, completed, or superseded work.
3. Inspect relevant ADRs, CRs, product documentation, nearby code, and recent Git history in proportion to the request.
4. Separate facts, reasonable inferences, and genuine product choices.

Do not ask the user for facts the repository can answer. If the request is incomplete, choose the smallest reversible interpretation and state it in the result. Ask one question only when different answers would materially change the product outcome and evidence cannot choose between them.

## Choose the goal type

- Use `planning` when completion means resolving uncertainty into a durable decision. The goal will produce one ADR and no tasks.
- Use `building` when completion means delivering observable behavior through tasks and CR-backed repository changes.

Do not create a planning goal merely because implementation needs thought. Normal implementation design belongs in the Draft CR. Use planning only for a decision that deserves an ADR.

## Write the goal contract

Keep the goal stable if implementation details change.

For every goal, write:

- a concise outcome title;
- the problem and evidence that make the work necessary;
- the expected outcome at an implementation-neutral level;
- included and excluded scope;
- constraints, dependencies, and material assumptions;
- acceptance criteria that can prove completion.

For a building goal, also write concise Gherkin-like behavior describing observable outcomes. Use `Feature`, `Scenario`, `Given`, `When`, and `Then`. Do not prescribe internal modules or a test framework in the behavior.

For a planning goal, normally omit Gherkin. Acceptance criteria instead name the decision, alternatives that must be considered, evidence or constraints that must be resolved, and the required ADR result.

## Create or update

Unless the user asked only for a draft, create the local goal without a confirmation round:

```bash
clips goal create '<json>'
```

Use `type`, `title`, `description`, `acceptance_criteria`, and, for building goals, `behavior`. Set `verification_mode` to `behavior_and_tests` only when the repository or user requires automated test evidence; otherwise use `behavior`.

For an existing goal, preserve its reference and use:

```bash
clips goal update <goal> '<json>'
```

Do not edit `.clips/db` manually. After mutation, run `clips view <goal>` and inspect the rendered contract.

## Continue

- Route a planning goal directly to `clips-plan-decision`. Do not ask whether to start the ADR.
- Route a building goal to `clips-break-down-work` when decomposition is useful. A small outcome still needs at least one task before the goal can close.

Return the goal reference, type, outcome, material assumptions, and any single unresolved product choice. Do not repeat the full goal body when the CLI view already makes it available.
