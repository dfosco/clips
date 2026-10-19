---
name: clips
description: >-
  Plan and track repository work with strategic Clips Lanes, goals, atomic task
  change requests and records, system components, acceptance evidence, and
  record history. Use
  when framing an outcome, negotiating scope or interfaces, assigning work,
  reviewing completion, resuming tracked work, or managing existing CRs, ADRs,
  and optional GitHub synchronization.
metadata:
  author: Daniel Fosco
  version: "2026.10.11.1"
---

# Clips

Use a small set of durable work identities: strategic Lanes, goals, tasks, and
system components.
Make each task the agent's work contract before execution and its change record
afterward. Add detail when it helps another agent act or accept the result.

## Establish context and capabilities

Read the current request, prior scope decisions, repository instructions, relevant
source, and existing Clips state. Reuse information already supplied. Make
reasonable implementation decisions within the user's authorization; ask only
when a material unknown prevents progress. Goal creation, task breakdown, and
continuation do not require a fixed interview or repeated confirmation.

Inspect the installed CLI's help before relying on unfamiliar commands. This
skill describes the work-contract implementation, which adds components,
structured acceptance, and revision views beyond the published 1.6.0 baseline.
The skill version is not a promise that these features are installed. Check
`clips --help`, `clips lane --help`, `clips goal --help`, and
`clips task --help`; use supported syntax.

With an older CLI, preserve the same concepts in named Markdown sections of the
existing goal/task descriptions. Record acceptance evidence there and treat
status closure as administrative. Do not invent a structured receipt, resolvable
revision, or new command. Explain a missing capability when it materially limits
the task; do not upgrade or migrate solely to begin work. If an old command
requires a legacy closure artifact, preserve truthful completion evidence and
report the administrative limitation instead of inventing an ADR or task merely
to satisfy that gate.

## Use the core model

| Record | Responsibility | Typical content |
|---|---|---|
| Lane `#l1` | Strategic frame across related goals | Product direction, narrative, goal set, product goals, and eventual strategic retrospective |
| Goal `#g1` | One engineering outcome and how the work is organized | Context, scope, plan, architectural decisions, task relationships, outcome acceptance |
| Task `#g1#t1` | One independently reviewable and acceptable change | Request, affected components, boundaries, owner, criteria, amendments, actual result, evidence, acceptance |
| Component `#c1` | A persistent system responsibility and behavioral boundary | Responsibility, interface or behavior contract, constraints, implementation/specification references, dependencies |

Use a Lane when multiple goals belong to one sustained product or strategic
workstream. Lanes are deliberately less formal than goals: they do not own
technical acceptance criteria, test evidence, or an acceptance owner. Read a
goal's Lane for strategic context, but do not assume sibling goals are in scope
or dependent merely because they share a Lane.

Closing a Lane is retrospective, not engineering acceptance. Capture a concise
summary, the cross-goal decision log, a system overview with components worked
on, product goals achieved, and product media/screenshots when useful. Goal and
task acceptance remain the evidence-bearing engineering records.

Keep plan and decisions in the goal. The plan describes the current route to the
outcome; the decisions explain choices, rationale, and consequences. Update the
plan as work changes and retain useful decision history. Link the relevant goal
decision from a component when it remains part of that component's rationale.
An independent ADR remains useful when the project needs one, but is optional.

Define a component when work needs a stable shared boundary. It must have a
coherent responsibility, an observable contract another part of the system can
rely on, and identifiable implementation or specification references. A planned
component can initially name its intended implementation. Keep its identity
through moves or internal refactors while the responsibility remains coherent.
Unqualified components are shared across the repository: changing the configured
agent username does not retarget `#c1`. Use an explicit namespace such as
`#alice#c1` only when a separate catalog is intentional.
Do not equate components mechanically with files, classes, packages, or agents.

Express task scope as the selected components and the particular changes and
constraints. A task may span components when the change is accepted as a unit.
Split work into another task when it can be assigned and accepted independently.
Use ordinary lists for implementation steps; do not create a step ID namespace
or use `#t1.1` to imply a separately tracked task.

Keep contracts, constraints, and decisions in named sections or link their
authoritative source/schema/specification. Avoid duplicating every API detail in
Clips. Do not create numbered invariant, interface, or decision artifacts merely
because the model could support them.

Use the optional fields that improve coordination. Add `sections` for named
Markdown sections and `extensions` for project-defined JSON metadata or
relationships. Define an extension's meaning and owner where another agent needs
to rely on it. Preserve unfamiliar extension content during updates. Keep
authority, acceptance, and source identity explicit rather than hiding altered
semantics in an extension. There is no required section count or universal
template that every task must fill. Section updates merge by heading; extension
objects merge recursively. In either container, `null` removes a key. Put changed
obligations in the request, scope, or criteria as well: note and extension edits
do not automatically invalidate acceptance.

## Keep identities stable

- Use `#l1`, `#g1`, `#g1#t1`, and `#c1` for current records. The CLI may display padded
  forms such as `#g001#t01`. Use the full goal/task reference outside its context.
- Use `#g1#A1` and `#g1#t1#A1` for acceptance criteria. Within an identified goal,
  `#t1#A1` is a contextual shorthand. Store criteria as objects with stable IDs;
  preserve IDs when reordering or rewording the same condition. Retired IDs must
  not be reused for different conditions. Evidence belongs to the criterion.
- Use `#l1#r1`, `#c1#r1`, `#g1#r1`, or `#g1#t1#r1` to cite a recoverable record snapshot.
  Use current refs for navigation and pinned revisions when a dependency or
  acceptance discussion requires a particular agreement. A criterion within a
  pinned task snapshot is `#g1#t1#r1#A1`. Use the same history mechanism for all
  records; do not invent separate agreement-version systems.
- Treat a revision as record history, not the identity of the code or artifact
  checked. Preserve a commit, tree/diff identity, or immutable artifact reference
  with verification evidence. A HEAD commit alone does not identify dirty work.

Quote refs beginning with `#` in shell commands so the shell does not treat them
as comments. Historical Tracks and standalone `#r001` refs remain compatibility aliases;
current strategic grouping uses Lanes and `#l001`. A nested `#r1` identifies
record history, so `#l1#r2` means Lane 1 revision 2.

## Negotiate and execute a task

1. Find or create the goal from the requested outcome. If it belongs to an
   existing Lane, read that Lane for strategic context; create a Lane when this
   work is part of a sustained multi-goal product frame rather than a one-off
   outcome. Add the goal plan and decisions at the level needed for coordination. Create task requests from the available
   context, without asking the user to author the breakdown.
2. Make the task understandable before assignment: state the intended change in
   `description`, identify affected `components`, describe `scope`, and define
   observable `acceptance_criteria`. Add `owner`, `acceptance_owner`, dependencies,
   and verification details when they affect execution.
3. Read the relevant component contracts and source. Resolve a consequential
   disagreement before dependent work commits to it. An agreed interface can
   enable parallel implementation; integrated acceptance still needs the real
   provider and consumer where their interaction is part of the criterion.
4. Mark the task `in_progress` when execution begins. Keep meaningful discoveries
   and amendments in its named sections. Update the request when the agreement
   changes, recording why; history preserves the prior agreement. Do not quietly
   reduce scope or weaken criteria to make a partial result appear complete.
5. Consolidate the actual change in `record`, including behavior, compatibility
   impact, relevant decisions, and evidence. Keep the request available. Capture
   reviewable reasoning and outcomes, not a microstep diary or private reasoning.
6. Verify the actual candidate against each criterion. Then record acceptance
   through the supported command and continue other authorized work.

Distinguish component `dependencies` from task `blocked_by`. The former describe
system relationships; the latter describe required work ordering. Do not turn
every runtime dependency into a serial implementation schedule. Treat declared
blockers as coordination data, not proof that a scheduler enforces them.

## Accept outcomes with evidence

Use `goal accept` or `task accept` to record a receipt for a checked outcome.
Include the actual `artifact`, the real `accepted_by` identity, a concise
`summary`, and an assessment for each live criterion. Each assessment names its
`id`, provides `evidence`, and has status `satisfied` or `waived`; a waiver also
needs its reason and the applicable authorization. Never claim human acceptance
on the basis of an agent's own verification. When `acceptance_owner` is set,
`accepted_by` must match it; this is responsibility metadata, not authentication.

The CLI captures the request snapshot with the receipt and preserves prior
history. Its validation confirms record structure, not that tests ran or that
the actor has human authority. Inspect the source, results, and authorization
before writing the receipt. Changes to the agreed request can invalidate current
acceptance; recheck affected outcomes and preserve prior evidence as history.

Acceptance also generates `component_basis`, pinning each declared component to
a recoverable revision. An explicit component pin is honored; a current ref is
resolved at acceptance time, and missing declared components prevent acceptance.
Pin the agreed component revision before assignment when the negotiated baseline
must stay fixed. Later component edits do not automatically reopen tasks across
their separate journals; reconcile affected agreements and evidence explicitly.
The receipt's `artifact` identifies the checked result. Explicit acceptance clears
the legacy `closed_commit_sha`; administrative closure still records HEAD.

Honor the inherited `verification_mode`. In `behavior`, check relevant observable
behavior using methods appropriate to the repository and change. In
`behavior_and_tests`, include relevant automated test evidence. Do not change the
mode to excuse missing evidence. Optional `behavior` text can describe scenarios;
Clips does not execute Gherkin or choose a test framework.

Treat `status closed` as an administrative operation. It records neither a
verification result nor an approval. For whole-goal completion, assess the goal's
outcome and required tasks against the integrated result. For selected-task
scope, accept those tasks without closing unrelated remaining work. Preserve
`not_planned` and `duplicate` as their true dispositions; report authorized
waivers separately from delivered work. Goal acceptance requires terminal child
tasks and an explicit `exceptions` entry with the task ref and reason for each
`not_planned` or `duplicate` child. Existing closed tasks need no fabricated receipt.

## Command patterns

Prefer a JSON file or stdin for substantial Markdown and receipts. Keep JSON
metadata types intact. Verify supported flags against local help. If batch
creation fails or is interrupted, reconcile created IDs before retrying; a batch
is not an all-or-nothing transaction.

```bash
clips init
clips lane create '{"title":"Workspace experience","description":"Make returning to work continuous","product_goals":["Users return to the right workspace quickly"]}'
clips view '#l1'
clips view all
clips view '#g1' --json
clips view '#g1#t1#A1' --json
clips view '#c1#r1' --json
clips history '#g1#t1' --json

clips component create '{"title":"Workspace preference","responsibility":"Persist the selected workspace ID","contract":"Read returns an ID or no preference; storage failures do not block startup","source_refs":["src/workspace-preference.js"]}'
clips component update c1 '{"sections":{"Failure behavior":"Treat unavailable storage as no preference"}}'
clips component list
clips component history c1

clips goal create '{"title":"Restore the selected workspace","lane_id":"l1","description":"Reopen the last available workspace after reload","components":["#c1"],"plan":"Implement persistence, then integrate selection","decisions":"Store an ID and validate it against current workspaces","acceptance_criteria":[{"id":"A1","description":"Reload restores the last available workspace"}]}'
clips task create g1 '{"title":"Persist workspace preference","description":"Read and write the selected workspace ID","components":["#c1"],"scope":"Persistence boundary and its failure behavior","acceptance_criteria":[{"id":"A1","description":"A stored ID can be read back"},{"id":"A2","description":"Unavailable storage does not throw"}]}'
clips task status g1 t1 in_progress
clips task update g1 t1 --file task-result.json
clips task accept g1 t1 --file task-acceptance.json
clips goal accept g1 --file goal-acceptance.json
clips lane close l1 --file lane-closure.json
```

For example, a task result file may contain `{"record":"Implemented the reader
and writer. Evidence and compatibility notes follow..."}`. A receipt has this
shape; replace illustrative values with observed facts before recording it:

```json
{
  "artifact": "immutable source or artifact identity",
  "accepted_by": "actual authorized reviewer or agent",
  "summary": "What was checked and accepted",
  "criteria": [
    {"id":"A1","status":"satisfied","evidence":"Check, observed result, and evidence location"},
    {"id":"A2","status":"satisfied","evidence":"Failure-path check and observed result"}
  ]
}
```

Goal/task JSON also supports existing behavior, verification, and collaboration
fields. Acceptance criteria supplied as legacy strings remain readable; prefer
explicit IDs for later edits. Use named sections or `extensions` for optional
notes, risk descriptions, migration details, or project-specific relationships.

## Preserve workflow state and coordinate writers

Keep record instances in the resolved `.clips/` store. Goals and tasks use
append-only events under `.clips/db/`; components and optional legacy records
also remain local workflow state. Do not commit `.clips/` instances. Committed
product docs and source remain authoritative for shipped behavior; committed
`docs/records/` files are templates only.

Worktrees share Clips state through the common repository root. Default to one
coordinator writing shared records; workers return results, evidence, and proposed
updates. Separate worktrees do not isolate the workflow store. Use revision
checks when supported, but do not treat append locks or optimistic checks as a
distributed scheduler, lease, or full multiwriter workflow.

Lane management claims are separate user-level coordination records. Before
managing a Lane or contributing overlapping decisions, inspect
`clips lane manager inspect '#l1' --json` and contact its recorded managers using
an available, authorized transport. Report missing contact/transport rather than
claiming coordination occurred. Contributions do not require taking ownership.
One observed session can manage several Lanes; several managers require explicit
sharing. Lane identity is shared across worktrees and agent usernames.

An unowned Lane has revision 0. Claim using observed host/runtime/session IDs,
never an invented session or display label. For example, with actual values:

```bash
clips lane manager claim '#l1' '{"expected_revision":0,"actor":{"host":"observed-host-id","runtime":"paseo","session_id":"actual-agent-id","workspace_id":"actual-workspace-id","contact":"supported coordination route"}}'
clips lane manager list --json
```

`share` adds an `owner` identity and requires the actor to be a current manager.
`release` removes only the actor's own claim. `handover` replaces one owner and
requires an `owner`, recorded `authorization` with `by` and `reason`, and an
explicit user instruction authorizing that replacement. Its optional `from`
identity selects the displaced owner when different from the actor. Every
mutation requires the inspected `expected_revision`; reread and coordinate on
conflict rather than forcing a stale write. Use `--file` or `--stdin` for JSON.
The CLI records the asserted identity and authority; it does not authenticate
them. Stopped, unavailable, or disconnected sessions retain ownership until an
explicit release or authorized handover. Claims live under `CLIPS_HOME` or
`~/.clips`, are not committed or synced, and do not lock unrelated execution.

Keep execution state in task status, owner, and blocker information; keep
cross-task coordination in the goal plan and cross-goal strategic context in the
Lane. Use an existing squad log or session
handoff for transient context. Do not require a separate execution-note artifact.
On resume, reconcile those records with current source, workers, and user input.

## Preserve optional and legacy workflows

Keep existing Track journals, `#r001` refs, and `track_id` fields readable as
legacy Lane aliases without rewriting them. New work uses `clips lane`,
`#l001`, and `lane_id`.

Keep existing `planning`/`building` type labels and attached ADRs readable without
using them to prohibit tasks or require an ADR. The goal can hold both planning
and implementation work. Keep existing CR/ADR files and links; do not create a
parallel CR for every task. Use an independent record when the user or project
has a concrete reason, and link the authoritative task instead of duplicating it.

Use `clips record status` for existing CR/ADR lifecycle changes. Valid statuses
are `Draft`, `Proposed`, `In Review`, `Accepted`, `Deprecated`, and `Archived`.
Instances live under `.clips/records/{cr,adr}/`; archiving moves them into the
type's `archived/` directory. Copy committed templates only when needed.

Keep GitHub collaboration opt-in. `clips init` is local and `clips sync` performs
no GitHub work while collaboration is disabled. Enable it only when authorized
with `clips config collaboration true`. Use `clips goal unlink <ref>` or `--all`
to keep local history while leaving existing remote issues unchanged. Use `clips web` for the read-only board and Lane summaries. The legacy
`clips track` command remains only for compatibility. These optional surfaces do not change task acceptance.
