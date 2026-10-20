# Work contracts in Clips

This document defines the work-contract implementation in this checkout.
It is not a claim that an older installed CLI supports every command below.

## Contents

- [Core records](#core-records)
- [Planning through implementation](#planning-through-implementation)
- [Fields and extensions](#fields-and-extensions)
- [Identity and revisions](#identity-and-revisions)
- [Management policy](#management-policy)
- [Acceptance](#acceptance)
- [Dependencies and coordination](#dependencies-and-coordination)
- [Compatibility and storage](#compatibility-and-storage)

## Core records

A **Lane** is a sustained conceptual and strategic frame across related goals.
It describes product direction and helps agents understand why several outcomes
belong together. It is not an engineering acceptance layer: Lanes do not carry
technical acceptance criteria, verification modes, or acceptance receipts.

Closing a Lane creates a strategic retrospective. The closure records a summary,
the decisions made across its goals, a system overview and components worked on,
product goals achieved, goal-status snapshot, and product media such as
screenshots when useful. Goal acceptance remains authoritative for engineering
completion.

A **goal** is a desired engineering outcome and the record that coordinates its delivery.
It holds the context, scope, plan, architectural decisions, and outcome
acceptance. Its plan can change as the team learns. Decisions retain the choices
and reasons that explain the plan and the resulting system.

A **task** is the work contract for one atomic change. Atomic means the change
has a coherent result that can be assigned, reviewed, and accepted as a unit;
it does not mean one file, one command, or one commit. Before execution, the
task is a change request. During execution, it preserves material amendments.
Afterward, the same task contains the actual change record, evidence, and
acceptance. It does not turn into another object or lose its original request.

A **system component** is a persistent unit of responsibility with a behavioral
boundary and identifiable implementation or specification references. It gives
other components and tasks a stable identity to rely on.

A useful component definition answers:

- What responsibility does it own?
- What interface or observable behavior can consumers rely on?
- What constraints or failure behavior are part of that promise?
- Where is its implementation or authoritative specification?
- What other components does it depend on?

Create a component when this shared boundary is useful to coordination. A title
alone can start a draft definition; settle the relevant promise before consumers
rely on it. A component can span files or be part of a larger module. It survives
renames and internal refactors while its responsibility remains coherent. A
split or replacement may justify new component identities, with the relationship
recorded in named sections or extensions and the obsolete component retired.

**Scope** is the selection of components and the particular changes and
constraints within a task. It is not another record type. A task can touch
several components if the result must be accepted as a unit.

**Contracts** are the interface, behavior, and constraints a component promises.
Keep them as named Markdown or links to authoritative code, schemas, tests, or
specifications. Use ordinary names for decisions and constraints. Stable
component identity does not require numbered IDs for every function or invariant.

The Lane supplies strategic context across goals. The goal owns engineering
orchestration. Component dependencies describe the system. Task dependencies
describe ordering of work. Merely sharing a Lane does not imply a dependency.
Neither the agent hierarchy nor a file tree has to mirror these records.

## Planning through implementation

For actionable requests, the skills default to comprehensive plans within one
coherent Lane, detailed Goals with observable acceptance criteria, meaningful
Task contracts and dependencies, then implementation and verification. Reuse
matching records; preserve a selected Task's scope and proportionate records for
an atomic outcome. Explicit brainstorming, plan-only, defer, queue or narrower
instructions override the default. This is agent guidance, not a new CLI record
type, scheduler or requirement to repeat intake interviews.

Comprehensive means the agreed behavior, constraints, interfaces, failure cases
and verification are covered. Map a Goal's full Task set to its scope/criteria,
record gaps or a coherent atomic-scope rationale, and identify real prerequisites
and write conflicts. Task count and a mandatory split by file/layer do not prove
coverage. Useful independent work can run in parallel within resource limits;
coupled work can stay serial with one integration and record coordinator.

For example, an authorized workspace-restoration feature may use one Lane with
Goals for persistence and user-facing restoration. Each Goal owns observable
criteria and reviewable Tasks, including the real integration check where needed.
Creating those records means **planned**, not delivered. An observed dev handoff
means **launched**; candidate-specific checks establish **verified**; a truthful
receipt naming the actual actor and criterion evidence records **accepted**.
For "plan this only", deliver the same necessary planning detail but do not
launch implementation or claim any of those later states.

A Lane Manager delegates engineering and substantive verification through the
current harness. Paseo uses workspace agents; Copilot uses direct coordinated
children. Other harnesses must invoke available native sub-agents even if they
are not user-steerable. If no delegation primitive exists, the manager implements
and verifies authorized Tasks itself, linearly in dependency/dispatch order,
using the same contracts and evidence. The actual executor records results under
the existing Task IDs. Do not fabricate a worker, parallel execution, independent
review or human approval. Missing delegation does not bypass denied authorization,
missing tools/files or any real dependency.

## Fields and extensions

Goal and task commands accept a single JSON argument, `--file <path>`, or
`--stdin`. The only required field on creation is a nonempty `title`. Add
enough context to make an assignment clear; the schema does not enforce a
universal planning template.

| Field | Applies to | Meaning |
|---|---|---|
| `title` | Goal, task, component | Short identity label |
| `description` | Goal, task | Desired outcome; the task's requested change |
| `scope` | Goal, task | Boundaries, selected changes, and constraints |
| `components` | Goal, task | Array of component reference strings |
| `plan` | Goal | Markdown approach and cross-task coordination |
| `decisions` | Goal, component | Markdown choices, rationale, and consequences |
| `owner` | Goal, task | Work owner, or `null` to clear |
| `acceptance_owner` | Goal, task | Expected accepting actor, or `null` to clear |
| `acceptance_criteria` | Goal, task | Array of `{id, description}` criteria; legacy strings accepted |
| `record` | Goal, task | Markdown actual result and material implementation notes |
| `behavior` | Goal, task | Optional behavior/scenario text |
| `verification_mode` | Goal, task | `behavior` or `behavior_and_tests`; task `null` restores inheritance |
| `blocked_by` | Goal, task | Array of required work references |
| `responsibility` | Component | Markdown statement of its system responsibility |
| `contract` | Component | Markdown interface, behavior, and constraints |
| `source_refs` | Component | Array of implementation or specification references |
| `dependencies` | Component | Array of component references, optionally pinned to revisions |
| `sections` | All three | Named Markdown sections |
| `extensions` | All three | Project-defined JSON metadata or relationships |
| `expected_revision` | Update/accept input | Reject a mutation if the current record revision differs |

Goals support `lane_id` for their strategic frame and retain legacy
`track_id` plus `type` labels for compatibility. Lane creation/update uses
`title`, `description`, and optional `product_goals`. Lane closure uses
`summary`, `decision_log`, `system_overview`,
`product_goals_achieved`, and optional `components` / `media`.
Use status commands for lifecycle changes, except Lane closure, which uses
`clips lane close` so the retrospective is captured.

### Extend without multiplying artifact types

Use `sections` when a named explanation helps another agent, and `extensions`
when structured project data is useful. For example:

```json
{
  "sections": {
    "Migration": "Read the existing preference key; write only the new key.",
    "Review focus": "Confirm startup still works when browser storage is unavailable."
  },
  "extensions": {
    "review": {
      "source_branch": "feature/workspace-preference",
      "affected_docs": ["docs/workspaces.md"]
    }
  }
}
```

A section update merges by heading; `null` removes that heading. Extensions
merge objects recursively; arrays and scalar values replace the value at that
key, and `null` removes a key. Unspecified content is preserved. New
project-defined fields belong in these containers; unsupported top-level
goal/task keys are rejected with guidance instead of silently dropped.

Define the meaning and owner of an extension if other agents rely on it.
A contract obligation belongs in the request, scope, or criteria even if an
extension supplies additional details. Editing `sections` or `extensions`
does not automatically invalidate acceptance, so do not hide changed obligations
there. If a custom relationship changes what must be delivered, amend the
authoritative request too.

## Identity and revisions

Current references identify Lanes, goals, tasks, and components:

- `#l1`
- `#g1`
- `#g1#t1`
- `#c1`

The CLI normalizes shorthand to its canonical padded IDs. Existing user
namespaces remain supported, for example `#alice#g1#t1` and `#alice#c1`.
Unqualified components are repository-wide: `#c1` and `#c1#r1` always address
root component storage, independent of the configured agent username. Use an
explicit component namespace when a separate catalog is intentional.
Use complete refs across contexts. Within an identified goal,
`#t1#A1` can name a task criterion; a CLI view supplies the goal explicitly
with `--goal`.

### Criteria

Acceptance criteria use nested stable IDs:

- `#g1#A1`: goal criterion.
- `#g1#t1#A1`: task criterion.

Preserve explicit IDs on reorder and when refining the same condition.
Allocate a new ID for a new condition. Removed or reserved IDs are not reused.
Legacy strings are normalized into criteria with deterministic IDs; use the
returned IDs for subsequent edits.

Implementation steps remain ordinary lists. A separate task is appropriate
when a piece of work needs its own assignment and acceptance. There is no
required step, evidence, invariant, or decision ID namespace.

### History

Append `#rN` to read a recoverable record snapshot. Lane IDs use `l`, so
`#l1#r2` is unambiguous: Lane 1, revision 2.

```bash
clips view '#l1#r1' --json
clips view '#c1#r1' --json
clips view '#g1#t1#r2' --json
clips view '#g1#t1#r2#A1' --json
clips history '#g1' --json
clips history '#g1#t1' --json
clips history '#c1' --json
```

Goal revisions count events in the aggregate goal/task stream. Task revisions
advance when events affect that task, including relevant inherited state.
Component revisions follow the component's event stream. Use returned revisions;
do not infer a revision number from elapsed time, commit count, or semantic
compatibility.

Pinned refs are read-only. Supply `expected_revision` on a mutation of the
current ref when work was based on a particular revision:

```json
{
  "expected_revision": 3,
  "scope": "Persist one workspace ID; tolerate unavailable storage."
}
```

A stale revision is a prompt to reread and reconcile. It is not permission to
overwrite another owner's change. Short append locks and revision checks do not
implement a distributed scheduler, a task lease, or complete multiwriter
coordination.

Revisions identify agreements and historical records. A separate commit,
tree/diff identity, or immutable artifact reference identifies what was
implemented and checked. A record's current revision is not verification
evidence, and a Git HEAD alone does not identify a dirty working tree.

## Management policy

Work ownership is advisory coordination metadata, not an authorization or
execution lock. Authorized Lane, goal, and task work does not require a host ID,
manager claim, exclusive management role, or unused session association.
The canonical CLI has no host-identity or Lane-claim prerequisite. Integrations
must not turn those optional relationships into requirements for ordinary work.

Preserve existing owners, associations, and history unless explicitly updating
them. Do not fabricate an actor, erase metadata, or claim a Lane just to start
work. Coordinate actual overlapping writes rather than treating a recorded owner
as proof that another agent is currently writing.

Use the CLI for records and supported host tools for agent sessions and
communication. User-requested coordinated children remain steerable through
those tools; they do not require a Clips role or claim. Respect resource limits
and reuse an existing session when another is unnecessary. This package does not
provide a Copilot canvas runtime or change checks in a separately installed
integration through agent instructions.

For GitHub Copilot App handoffs, every dev session is a direct coordinated child
of the Lane Manager, without an intermediate coordinator/Squad/dev-lead session.
The manager calls native `create_session` and verifies `creator_session_id` and
`coordinating_creator_session_id` through `get_session`/listings, together with
the intended repository and workspace. The actual listed `app_url` exposes user
navigation; `send_session_message` maintains manager/worker contact throughout
execution. Claims, titles, activity or a canvas Send do not establish parentage.
Do not detach/reparent or use hidden replacement workers to satisfy the rule.
If useful parallel Tasks need more dev sessions, the manager creates direct
siblings while one owner integrates. RAM limits or shared writes can justify
one serial dev child. Paseo's separate top-level path is unaffected.

This policy leaves authentication, credential safeguards, external-action
approval, exact-target validation, atomic writes, canonical journal locks, and
stale-revision conflicts intact. It also preserves acceptance receipt checks:
`acceptance_owner` identifies the expected accepting actor, not who may implement
the work. A receipt must still name its actual authorized actor and satisfy the
recorded acceptance agreement.

## Acceptance

Accept only after assessing the actual result against the current request and
criteria, under the authority of the accepting actor. A task's result can be
written to `record`; the acceptance receipt also carries its summary and
evidence. The request remains available in the same task and history.

```bash
clips task update '#g1#t1' --file task-result.json
clips task accept '#g1#t1' --file task-acceptance.json
clips goal accept '#g1' --file goal-acceptance.json
```

Receipt shape, with illustrative values:

```json
{
  "expected_revision": 4,
  "artifact": {
    "source": "actual immutable commit, tree/diff, or artifact identity",
    "evidence": "location of the observed verification results"
  },
  "accepted_by": "actual-authorized-actor",
  "summary": "Describe the outcome accepted and its boundaries.",
  "criteria": [
    {
      "id": "A1",
      "status": "satisfied",
      "evidence": "Check performed, observed result, and relevant evidence location."
    },
    {
      "id": "A2",
      "status": "waived",
      "reason": "Specific waived scope and the authority that approved the exception."
    }
  ]
}
```

`artifact` must be nonempty text or an object. Satisfied criteria need nonempty
evidence, which may be text, an object, or an array. Waived criteria need a
nonempty reason; evidence may also be supplied. Every live criterion must appear
exactly once, and unknown criterion IDs are rejected.

The CLI supplies `accepted_at`, `request_snapshot`, and
`request_revision` when available. It stores the receipt under `acceptance`
and closes only the target task or goal. It preserves superseded or invalidated
receipts in history.

It also generates `acceptance.component_basis` as canonical pinned component
refs. Explicit component revisions are honored; unpinned refs resolve to their
current revisions at acceptance time. Missing declared components prevent
acceptance. The request snapshot retains the originally declared component refs.
Pin a component before assignment when work must use a fixed negotiated baseline.
Later component edits do not automatically invalidate acceptance across separate
journals; agents must reconcile affected contracts and evidence.

The receipt's `artifact` is the authoritative identity of the checked result,
which may include uncommitted changes or an external artifact. Explicit
acceptance clears the legacy `closed_commit_sha` field. Administrative status
closure still records HEAD, which alone does not identify a dirty working tree.

If `acceptance_owner` is set, `accepted_by` must match. These fields are
responsibility metadata. The CLI does not authenticate an actor, run the checks,
prove that evidence is true, or manufacture human approval. An agent should name
itself when accepting under delegated authority and must not imply a human
approved something they have not reviewed.

### Goal completion and exceptions

Goal acceptance requires its children to be `closed`, `not_planned`, or
`duplicate`. For each `not_planned` or `duplicate` child, the goal receipt
must include an explicit exception:

```json
{
  "exceptions": [
    {
      "ref": "#g1#t2",
      "reason": "State the actual disposition and authority for excluding this work."
    }
  ]
}
```

This is an additional field in a complete goal receipt, not a receipt by itself.
The goal receipt captures the child task basis. Already closed legacy tasks can
be included without synthesizing missing task receipts. The goal's own evidence
must establish the integrated outcome; child statuses alone do not do that.

A selected-task assignment accepts those tasks without accepting the whole goal.
Keep dispositions and waivers distinct from delivered behavior.

### Changes after acceptance

Request-affecting edits include changes to title, description, scope, component
refs, acceptance criteria, acceptance owner, behavior, verification mode, and
work blockers; goal decisions also belong to its accepted request. Such changes
invalidate current acceptance and reopen closed work while preserving the prior
receipt. Criteria or reference reordering alone does not change the agreement.

Plan updates, work-owner changes, result notes, sections, and extensions do not
automatically change the obligation. They remain in history. An agent must still
notice when source changes or custom semantics make earlier evidence stale.
Clips does not watch the filesystem and prove continued correctness.

Administrative `status closed` creates no receipt and is not evidence of
acceptance. Reopening work also invalidates its prior current acceptance.
Status is useful for coordination, while evidence supports the completion claim.

## Dependencies and coordination

Use Lanes for strategic grouping and narrative continuity across related goals.
A goal belongs to at most one Lane, but Lane membership does not schedule work.
When an agent works on a goal in a Lane, read the Lane for context; do not
automatically pull sibling goals into scope. When the Lane itself is the user's
scope, coordinate its dependency-ready goals and close the Lane only after
capturing the strategic retrospective.

Use component `dependencies` for structural system relationships. Structural
cycles are permitted; the field does not schedule work. Pin a component revision
when a consumer needs a specific contract and reconcile changes before
integration.

Use task `blocked_by` for task or goal references that the work actually needs.
Goal `blocked_by` retains its existing goal-dependency validation. Dependencies
are recorded coordination data, not a runtime enforcement or ownership system.

A provider and consumer can be implemented in parallel after agreeing their
interface. Record any integration acceptance gate in the goal plan. A mock can
support local development without proving that the real integration works.

Keep one coordinator writing shared Clips state by default. Workers return
results and proposed updates. Keep execution state in task status, owner,
blockers, and result; keep cross-task coordination in the goal plan. An existing
squad log or host handoff can hold transient context. No separate execution-note
record is required.

## Compatibility and storage

Existing planning/building labels, Track relationships, attached ADRs, CR/ADR
files, GitHub metadata, and old event streams remain supported. Track IDs such
as `#r001` are exposed as legacy aliases of `#l001`; their journals remain in
`.clips/db/tracks/` so existing stores do not need a migration. New user-facing
commands, fields, and references use Lane terminology. Labels no longer
force a separate ADR or prohibit tasks. Existing records are not rewritten into
new objects or discarded.

Workflow instances remain local under `.clips/` and must not be committed:

| State | Location |
|---|---|
| Lane events (including legacy Tracks) | `.clips/db/tracks/r001.jsonl` |
| Goal/task events | `.clips/db/[username/]g001.jsonl` |
| Component events | `.clips/components/[username/]c001.jsonl` |
| Optional CR/ADR Markdown | `.clips/records/{cr,adr}/` |
| Archived CR/ADR Markdown | `.clips/records/{cr,adr}/archived/` |

Worktrees resolve the common repository's store. Product documentation and
source remain committed repository state. GitHub collaboration stays opt-in,
and the full structured work-contract record remains local.

On older installations, inspect help and preserve useful model content in named
sections of goal/task descriptions. Keep evidence explicit and describe status
closure honestly. Do not claim that a textual revision label is a recoverable
snapshot, or that an older CLI created a structured acceptance receipt.

Legacy criterion maps and entries using `text` remain readable, including blank
legacy descriptions. Replay assigns stable criterion IDs and retains their
metadata without rewriting the journal. Clarify a blank criterion before
accepting it; new and amended criterion descriptions must be nonempty.
