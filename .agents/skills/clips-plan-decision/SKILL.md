---
name: clips-plan-decision
description: Resolve a Clips planning goal into an evidence-based ADR, attach it through the CLI, and preserve human-owned acceptance. Routed by the main Clips skill for durable decisions.
---

# Plan a decision

A planning goal exists to remove uncertainty, not to create implementation tasks. The deliverable is one attached ADR.

## Establish the decision

1. Run `clips view <goal>` and confirm the goal type is `planning`.
2. Mark active work with `clips goal status <goal> in_progress` when it has not started.
3. Inspect relevant source, history, current records, documentation, runtime behavior, and external authoritative sources as needed.
4. State the decision boundary, constraints, criteria, and what is outside the decision.
5. Produce at least two materially different options when more than one viable shape exists. Include the status quo when retaining it is credible.
6. Resolve factual forks by inspection or a reversible prototype. Ask the user only for an irreducible product preference or authority decision.

Compare options against named criteria. Do not manufacture certainty when evidence is incomplete; distinguish direct evidence, inference, and unresolved risk.

## Create the ADR

Choose the next available `ADR-NNN` identifier by inspecting `.clips/records/adr/` and its archive. Copy `docs/records/adr/ADR-TEMPLATE.md` into a new instance under `.clips/records/adr/`; do not place it under `docs/records/`.

Populate the canonical sections:

- `Context` explains the forces, evidence, and options.
- `Decision` states the chosen direction and its boundaries.
- `Consequences` records benefits, costs, follow-up implications, and compatibility effects.
- `Related` includes the planning goal and relevant CRs, ADRs, or sources.

Keep the record `Draft` while material analysis is missing. When the recommendation is complete and internally checked, change lifecycle through the CLI:

```bash
clips record status <ADR> proposed
```

Use `In Review` when the decision packet is ready for human review. Set `Accepted` only after explicit human acceptance.

## Attach and complete

Attach the result through the CLI as soon as the ADR file exists:

```bash
clips goal attach-adr <goal> <ADR>
clips view <goal>
```

Do not edit goal events or association metadata manually. Close the goal only when the decision itself is complete under the user's acceptance boundary:

```bash
clips goal status <goal> closed
```

If the ADR is merely Proposed or In Review and a human decision is still required, leave the goal `in_progress`.

Return the selected option, strongest rejected alternative, decisive evidence, ADR reference, goal status, and remaining human decision if any.
