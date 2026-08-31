---
name: clips
description: Rigorous local-first workflow router for framing goals, planning decisions, breaking down work, developing and reviewing changes, verifying outcomes, resuming work, and managing Clips status. Routes to focused CLI-backed skills and optionally syncs GitHub only after explicit opt-in.
metadata:
  author: Daniel Fosco
  version: "2026.8.31"
---

# Clips workflow router

Clips separates intent, execution, review, and durable decisions without adding workflow state to repository history. Use this skill as the entry point. Apply the principles below, classify the request, and read only the routed skill needed for the current work.

## Non-negotiables

- Inspect before asking. Read repository instructions, `clips view`, relevant goals or tasks, active records, and nearby source or history before requesting information the workspace can answer.
- Questions are the slow path. Infer reversible choices, state material assumptions, and proceed. Ask at most one question when a genuine product choice, missing authority, or irreversible action prevents useful progress.
- Use the `clips` CLI for goals, tasks, status changes, ADR attachment, record lifecycle changes, configuration, and synchronization. Never edit `.clips/db/*.jsonl`, change record status fields manually, or move archived records by hand.
- Creating or updating Markdown record content is file work because the CLI does not create CR or ADR bodies. Start from the committed template and write the instance under `.clips/records/<type>/`. Use `clips record status` for every later status transition.
- Planning goals resolve uncertainty into one attached ADR and contain no tasks. Building goals deliver an outcome through tasks, and every non-trivial reviewable repository diff has exactly one active Draft CR.
- Goals and tasks describe stable intent. CRs own changing implementation reasoning and verification. ADRs own durable cross-cutting decisions. Product documentation owns current user-visible truth.
- Human approval stays human-owned. Agents may create Draft or Proposed records and move completed implementation to In Review. Set Accepted only after explicit human acceptance.
- GitHub access is opt-in. Do not enable collaboration or run a mutating sync unless the user explicitly requests GitHub collaboration. When collaboration is already enabled, explain when a goal or task mutation will update GitHub.
- Preserve unrelated work. Source edits remain in the current worktree unless the user authorizes a different Git operation.

## Principles

Read this section for every non-trivial workflow. Apply the principles whose triggers match. A principle counts only when it changes a concrete decision. Record material decisions in the goal, CR, or ADR; mention only the principles that materially shaped the final result.

### Core

- **Laziness Protocol.** Bias toward deletion and the smallest change that solves the problem. Apply when refactoring, sizing a diff, or tempted to add abstractions, layers, or signal threading.
- **Foundational Thinking.** Apply before writing logic: choose core types and data structures, sequence scaffold before feature work, and ask what concurrent actors share. Get the data structures right so downstream code becomes obvious.
- **Redesign from First Principles.** Integrate a new requirement as if it had been a foundational assumption from day one instead of bolting it onto the existing design.
- **Subtract Before You Add.** Remove dead weight, redundant validators, obsolete paths, and stub references first, then build on the simpler base.
- **Minimize Reader Load.** Count the layers between question and answer and the hidden state in the reader's head. Collapse one-caller wrappers and pass-through layers, and shrink mutable scope.
- **Outcome-Oriented Execution.** During planned rewrites and migrations, converge on the target architecture. Do not preserve smooth intermediate states with throwaway compatibility code.
- **Experience First.** Choose user delight over implementation convenience. Ship fewer polished features over more rough ones, and treat the next maintainer as a user too.
- **Exhaust the Design Space.** For a novel interaction or architectural decision with no precedent, build two or three structurally distinct prototypes or sketches and compare them before committing.
- **Build the Lever.** For non-trivial work, build the tool that does or proves it: a codemod, script, generator, check, or shared workflow instruction. The tool is the artifact a reviewer can rerun.

### Architecture

- **Model the Domain.** Encode the domain in a structure instead of scattered conditionals. Reach for a state machine, typed model, event model, table, registry, reducer, or other fitting structure only when it removes duplicated rules or invalid states.
- **Boundary Discipline.** Concentrate validation and error handling at system boundaries such as the CLI, config, storage, network, and external APIs. Trust validated internal data and keep business logic pure where practical.
- **Type System Discipline.** Make illegal states unrepresentable, brand semantic primitives, parse external data at boundaries, refuse to lie to the compiler, exhaust variants, and derive from authoritative schemas.
- **Make Operations Idempotent.** Design commands and lifecycle steps to converge on the same end state amid crashes, restarts, and retries.
- **Migrate Callers Then Delete Legacy APIs.** Migrate internal callers and delete the old API in the same wave instead of preserving compatibility layers without a real external requirement.
- **Separate Before Serializing Shared State.** Eliminate shared mutable state first. Serialize structurally only when one shared writer is a real invariant.

### Verification

- **Prove It Works.** Verify against the real artifact: run the feature, read the actual value, and inspect the diff. Do not infer completion from a proxy, cached result, self-report, or "it compiles."
- **Fix Root Causes.** Reproduce first, trace each symptom to its root cause, instrument when stuck, and resist guards that merely silence the failure.
- **Sequence Work into Verifiable Units.** Break multi-step work into small units that each end in a check. Verify before advancing and order delivery so the sequence proves itself to a reviewer.

### Delegation and context

- **Guard the Context Window.** Route bulk reading or fan-out to isolated workers when available. Keep summaries and file pointers in the main thread, not raw payloads, and do not read what the current decision will not use.
- **Never Block on the Human.** Proceed on reversible work, present the result, and let the human course-correct after the fact. Reserve questions for irreducible product direction, missing authority, and irreversible external actions.

### Meta

- **Encode Lessons in Structure.** When the same instruction or correction appears twice, encode it as an invalid-state check, type, lint, test, metadata flag, canonical helper, or script instead of more text.

## Route the request

Read the selected routed skill completely before acting. Load multiple routed skills only when the request genuinely spans their responsibilities.

| Request | Routed skill |
|---|---|
| Create, clarify, or rewrite a goal | [`clips-frame-goal`](../clips-frame-goal/SKILL.md) |
| Resolve a planning goal or create an ADR | [`clips-plan-decision`](../clips-plan-decision/SKILL.md) |
| Add, refine, or reorder tasks | [`clips-break-down-work`](../clips-break-down-work/SKILL.md) |
| Implement a task or repository change | [`clips-develop-change`](../clips-develop-change/SKILL.md) |
| Verify behavior or prepare completion evidence | [`clips-verify-outcome`](../clips-verify-outcome/SKILL.md) |
| Review a diff, CR, or ADR | [`clips-review-change`](../clips-review-change/SKILL.md) |
| Resume, hand over, or reconstruct work | [`clips-resume-work`](../clips-resume-work/SKILL.md) |

Handle simple status and configuration requests directly:

- Inspect with `clips view`, `clips view <ref>`, and `clips config`.
- Mutate goal or task status with `clips goal status` or `clips task status`.
- Change CR or ADR lifecycle with `clips record status`.
- Use `clips sync` only after collaboration was explicitly enabled.

Read [the CLI reference](references/cli.md) when exact syntax, accepted fields, status values, or synchronization behavior is needed. Do not load it merely to run a familiar command.

## Artifact boundary

- `.clips/db/` contains append-only local planning events. Only the CLI writes them.
- `.clips/records/cr/` and `.clips/records/adr/` contain local record instances. Do not commit them.
- `docs/records/*-TEMPLATE.md` contains committed schemas only. Never create instances beside the templates.
- Source code and product documentation remain normal repository state.
- A CR may cover one task, several tasks, or a small complete goal. `Parent CR` expresses a stacked review dependency, not a planning hierarchy.

## Response contract

Lead with the outcome. State material assumptions, evidence, verification, and unresolved product decisions. Do not narrate routine commands or repeat the entire workflow. When a principle shaped a non-obvious choice, name the choice it changed rather than citing the principle alone.

## Provenance

The engineering principles are adapted from Lauren Tan's MIT-licensed [pstack Poteto Mode](https://github.com/cursor/plugins/tree/main/pstack). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the license notice.
