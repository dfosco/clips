---
name: loopz
description: >-
  Continue scoped Clips Lanes, goals, or tasks autonomously until their outcomes are
  verified and accepted or further progress is blocked. Execute or delegate
  dependency-ready work, negotiate task and component contracts, adapt the
  organization when evidence warrants it, and preserve useful handoff state.
  Use when the user asks to loop, keep going, babysit, or work continuously on
  Clips work. Do not use for unrelated recurring reports or monitoring.
metadata:
  author: Daniel Fosco
  version: "2026.10.11.1"
---

# Loopz

Drive the user's scoped outcomes to verified completion. Keep making useful
progress, adjust the organization when needed, and stop when the requested
delivery endpoint is reached or further progress needs an unavailable input,
capability, or decision.

## Use Clips as the work contract

Read the applicable Clips skill and repository instructions. Use Clips for
record identity, persistence, supported commands, and acceptance. Use Loopz for
execution and coordination.

Keep the model small: a Lane is the strategic frame across related goals; the
goal holds one engineering outcome, plan, and architectural decisions; each task
is an atomic change request before execution and its change record afterward;
components identify persistent responsibilities and behavioral boundaries. Reuse these records. The loop's scope is a selection of them, not a
new numbered contract or a duplicate request.

Lanes are intentionally less formal than goals. They provide product direction
and cross-goal context rather than technical acceptance criteria or evidence.
Closing a Lane records the product goals achieved, cross-goal decision log,
system/component overview, and useful product media or screenshots. Goal and task
acceptance remain the engineering proof.

Use named sections, extensions, and links when additional context helps agents
negotiate or act. Define the meaning of shared extensions. Introduce another
artifact only when distinct ownership or a durable lifecycle warrants it. Do not
require an ADR, separate CR, execution note, or fixed set of fields for every
piece of work. Keep task acceptance and the actual result explicit.

Reuse the user's context and existing authorization. Make ordinary decisions,
move between scoped tasks, and continue necessary authorized actions without
confirmation. Ask only for a consequential missing input or authority. Preserve
explicit human approval requirements. Invoking Loopz does not itself authorize
unrelated work or change the requested publication or deployment endpoint.

Use the installed CLI's supported operations; check local help for unfamiliar
capabilities. Follow the Clips compatibility guidance on older installations.
Do not invent commands, receipts, statuses, resolvable revisions, or scheduler
guarantees. This skill governs the current task and does not itself launch a
supervisor, background job, or future execution service.

## Establish the loop scope

1. Read the current request, prior decisions, and latest user steering. Reuse the
   agreed scope when continuing the same work.
2. Inspect relevant Clips state with `clips view all` and `clips view <ref>`.
   If a scoped goal belongs to a Lane, read the Lane for strategic context without
   automatically adding its sibling goals. If the user explicitly scopes a Lane,
   its related goals become the orchestration surface. Include explicitly
   requested goals or tasks and existing work that clearly matches the outcome. Do not include unrelated open items. Prefer an
   in-progress match when candidates represent the same outcome; ask only when
   alternatives imply materially different requested outcomes.
3. If necessary, create a goal and atomic tasks from the available context.
   Create or reuse a Lane when the request is a sustained multi-goal product
   workstream rather than a single engineering outcome. Describe enough scope
   and observable acceptance to act. Do not return a clear
   implementation request to an intake interview or ask the user to supply the
   breakdown.
4. Account for explicit checklist items needed for the outcome. Ordinary steps
   remain lists inside a task or the plan. Give independently assignable and
   acceptable work its own task. A planning label does not prohibit tasks.
5. Announce the selected refs, intended outcomes, material boundaries, and
   requested delivery endpoint. Distinguish Lane scope, whole-goal scope, and
   selected tasks. Include ownership, dependencies, and limits when they affect execution.
   Then begin; the announcement is not an approval gate.

Treat user corrections as changes to the existing scope. Refine the route as
evidence arrives. Preserve material amendments in the task or goal; do not
quietly reduce the outcome, weaken criteria, or add adjacent improvements.

## Continue useful execution

Repeat while actionable work remains:

1. **Reconcile.** Inspect scoped records, relevant source changes, worker results,
   verification evidence, and user input. Establish what is complete, active,
   waiting, or contradicted before assigning more work.
2. **Select.** Choose work that advances the scope and is ready under its actual
   dependencies. For Lane scope, choose among its goals using explicit blockers
   and current state; Lane membership alone does not impose ordering. Prefer finishing active work and unblocking others. An open
   status alone does not establish readiness.
3. **Organize.** Execute directly or delegate bounded outcomes. Start independent
   work together when the benefit warrants coordination; continue useful work
   while other owners are active.
4. **Implement.** Mark the task `in_progress` when work begins. Maintain its
   request, meaningful amendments, and actual result. Follow repository
   conventions and keep component contracts accurate.
5. **Verify.** Check the actual candidate against the applicable criteria and
   verification mode. Investigate failures and fix relevant gaps.
6. **Accept.** Preserve evidence on the criteria and record acceptance when the
   outcome and authority support it. Update the task's result. Reopen or amend
   affected work if later evidence disproves completion.
7. **Continue.** Update the remaining work and take the next useful action. Do
   not end with a status-only response or ask whether to continue while
   authorized work remains actionable.

Refresh broad context when relevant evidence changes, not after every command.
A successful command, a closed status, or a worker completion message is an
observation to assess against the task; none alone establishes the outcome.

## Negotiate scope and component boundaries

Read the component contract and relevant implementation before assigning work
across its boundary. Use `#c1` for current context and `#c1#r1` when a specific
recoverable agreement matters. Keep interfaces, constraints, and decisions as
named content or source links, without creating another global ID namespace.

Pin component revisions before assignment when a negotiated baseline must stay
fixed. Acceptance captures a pinned `component_basis`, resolving unpinned refs
at acceptance time. A later component edit does not automatically reopen tasks
in other journals; the coordinator must reconcile affected work and evidence.

Separate system dependencies from work ordering. A component can consume another
component while their implementations proceed in parallel against an agreed
interface. A task is blocked only by work or inputs it actually needs. The final
integration check must use the real provider and consumer when their interaction
is part of acceptance.

If a discovery changes a shared promise, identify the affected owners and tasks,
record the amended agreement, and notify those relying on it. Reconcile pinned
revisions before integration. Preserve the old agreement and why it changed.
Revise affected criteria with authorization; do not retroactively make failed
work satisfy a different request. Recheck evidence that the change can affect.

Allow workers to expand descriptions, named sections, or project metadata when
it improves the assignment. Return material changes to shared scope or authority
to the coordinator. Avoid making every local implementation choice a contract
negotiation.

## Delegate with clear ownership

Keep one coordinator accountable for scope, integration, and final completion.
Let workers own bounded outcomes. Introduce local coordination only when a
workstream benefits from it; remove the extra layer when direct ownership is
simpler. Agent hierarchy and Clips goal/task hierarchy serve different purposes.

When delegated work, apply Loopz only within the assignment and its ownership
rules. Return results and unresolved decisions to the parent. Do not widen the
scope or appoint yourself another writer to shared Clips state.

Give each assignment enough context to work independently:

- Expected outcome, task ref, criteria, and relevant component agreements.
- Owned files, workspace, or other writable resources.
- Dependencies, decisions already made, and choices delegated to the worker.
- Evidence to return and the condition for handing work back.
- Authority, shared limits, and whether further delegation is useful.

Check for existing owners. Keep one owner for an overlapping mutable surface,
including shared fixtures, generated output, lockfiles, services, and Git state.
Use isolated workspaces where available; otherwise serialize overlapping edits
and delegate read-only investigation or patch proposals where useful.

Default to the coordinator as the only writer to shared Clips state. Workers
return evidence and proposed record updates. Worktrees share the workflow store;
revision checks and short append locks do not provide task leases or a
distributed scheduler. Permit multiple writers only when the actual tooling and
assignment provide suitable coordination.

Use completion events and substantive messages when available. Inspect state
before declaring a worker stalled or replacing it. Transfer ownership explicitly
and preserve useful work; quiet output does not establish a dead worker.

Choose tools, models, and effort within user preferences and host capabilities.
Consult a specialist for a concrete uncertainty and return the result to the
existing owner. Share resource limits across descendants rather than giving each
worker a fresh copy of the total budget.

## Adapt the organization

Reassess after an early result, integration, repeated failure, material dependency
change, or a handoff that loses useful context. Keep this proportional to the
work; do not add a reflection ceremony after every tool call.

Look for a concrete impediment: unclear contracts, duplicate investigation, an
overloaded owner, excessive handoffs, conflicting edits, waiting decisions, or
verification that cannot keep up with implementation.

Make the smallest useful adjustment: improve an assignment, settle an interface,
split independent work, consolidate coupled owners, add a temporary specialist,
or reduce concurrency. Preserve accepted results and explicit ownership.

Assess the adjustment using observed progress and defects. Do not invent
throughput statistics or infer a general rule from one easy task. Retain useful
lessons with their conditions. Do not expand scope, lower acceptance, or restart
the team merely to obtain fresh contexts.

## Tie acceptance to the delivered result

For each criterion, preserve what was checked, how, the observed result, and the
source or artifact checked. Include environment details when they matter. Record
revisions identify agreements; they do not identify executable source. A Git
HEAD alone does not identify uncommitted changes. Check the candidate intended
for delivery, including the selected subset when a worktree has unrelated edits.

Honor inherited verification modes and repository-native methods. Where
`behavior_and_tests` applies, obtain automated test evidence as well as checking
behavior. Do not change the mode to excuse missing evidence. Record an
authorized exception as a waiver, with its reason and actual authority.

Review worker results against their tasks, then verify the integrated outcome.
Reuse valid evidence without replaying every worker action. Repeat checks that
later changes can affect and preserve unrelated valid evidence. Reconcile known
in-flight changes that can affect the candidate without taking over unrelated
work.

Write a supported acceptance receipt only after assessing the evidence and
acceptance authority. Identify the real accepting agent or reviewer. Never use a
human's name to imply approval they did not give. The CLI validates metadata and
captures the request snapshot; it does not run tests or authenticate approval.
Administrative `closed` status is insufficient on its own.

Use extra review or tests to resolve a concrete remaining uncertainty or required
gate. Do not rerun checks until lucky, weaken them to pass, or add unbounded
review and polish after the scoped outcome is satisfied.

## Resume, wait, and hand off

Keep task status, owners, blockers, results, and evidence current; keep cross-task
coordination in the goal plan and cross-goal strategic context in the Lane. Use an existing squad log or host handoff for
transient execution context. Preserve only the context needed to resume:
selected refs, remaining work, material decisions, owners, evidence, blockers,
in-flight effects, and the next useful action. No separate execution-note
artifact is required.

On resume, reconcile newer user instructions with current records, source,
ownership, and external results. Reuse valid work. Resolve uncertain side effects
before retrying; a timed-out write may have succeeded. If durable handoff is
unavailable, state the limitation without claiming guaranteed recovery.

Continue independent work during waits. Prefer completion events or useful
bounded waits to repeated polling. Retry when a plausible transient condition or
new evidence makes another attempt useful. Repeated identical failure calls for
a changed approach, investigation, or focused consultation.

When progress needs an unavailable input, capability, permission, or material
decision, finish independent work and report the exact blocked scope and the
smallest requirement to continue. Do not ask again for authorized actions or
routine implementation choices. Preserve pending work without marking it
complete or promising automatic resumption.

Use native scheduling only when future execution is authorized and supported.
On cancellation or a resource cutoff, stop admitting work, notify owned workers,
and settle or safely stop in-flight actions within authority. Preserve results
and unresolved effects; interrupted work is not accepted completion.

## Complete the scoped work

Declare success when all scoped outcomes and criteria are verified, actual
results and evidence are preserved, required deliverables are current, and the
requested delivery endpoint is reached. Keep authorized waivers visible as
exceptions, with their true scope.

For whole-goal work, assess the goal's own outcome and all required tasks against
the integrated candidate, then record acceptance and close the eligible goal.
For selected tasks, accept those tasks while leaving the parent goal's remaining
scope intact.

For Lane-scoped work, do not manufacture a Lane acceptance receipt. Reconcile
the intended product direction with the goals that were completed, superseded,
or deliberately dropped. Before closing the Lane, write a strategic retrospective:
a concise summary, decisions made across goals, system overview and components
worked on, product goals achieved, and product media/screenshots when useful.
Use `clips lane close`; leave any still-active goals explicit rather than hiding
them behind Lane closure. On older CLIs, retain evidence in the task/goal record and describe
the administrative status honestly.

Treat `not_planned` or `duplicate` as successful resolution only when the user
has accepted that disposition for this work. Report waived scope separately
from delivered behavior.

Send a final account of completed outcomes, relevant refs, verification, delivery
state, and material exceptions. During execution, focus progress updates on
consequential findings and decisions. Keep the coordination work with the agents
rather than asking the user to manage the team.
