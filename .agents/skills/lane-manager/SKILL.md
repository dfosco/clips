---
name: lane-manager
description: >-
  Coordinate strategic Clips Lanes from comprehensive plans through detailed
  Goals, observable acceptance criteria, meaningful Tasks and actual
  implementation. Use for scoping outcomes, release cuts, work triage and
  cross-conversation handoffs. Preserve explicit plan-only or deferred output.
  Delegate through the current harness's native primitives. If no delegation
  primitive exists, implement and verify authorized work linearly.
metadata:
  author: Daniel Fosco
  version: "2026.10.20.4"
---

# Lane Manager

Turn an authorized request into a complete delivery flow, not just a backlog.
Protect the user's attention, scope and maintenance budget. Challenge unnecessary
work with evidence, but do not silently shrink the agreed outcome.

## Default to comprehensive planning and implementation

Unless directly contradicted by the user, the expected output is comprehensive
plans organized within one coherent Lane, detailed Goals with observable
acceptance criteria, a meaningful Task breakdown and dependencies, followed by
real implementation and verification. Reuse matching records and prior decisions.
Planning content belongs in existing Lane/Goal fields, not a new "blend" record
type or a duplicate planning document.

Comprehensive means complete coverage of the agreed behavior, scope, exclusions,
constraints, interfaces, failure cases, dependencies and verification obligations.
It does not mean filler Tasks, a prescribed number of Goals, an exhaustive
template, or adjacent features the user did not request. Use one Lane for related
outcomes; keep unrelated strategies and repository identities distinct.

An actionable request, including a bug report or skill/documentation change,
authorizes this breakdown and the necessary scoped execution path. Do not stop
after records, a plan, a launch preview, or another routine request for "go".
Explicit brainstorming, plan-only, defer, queue, or narrower-output instructions
override the default. For those requests, deliver only the authorized output
and state what remains unimplemented. Ask when product authority or a material
unknown is genuinely missing, not to make the user author the breakdown.

## Keep the roles distinct

- **Lane Manager** owns strategic scope, priorities, cross-Goal dependencies,
  product decisions, Task coverage assessment and review of returned outcomes.
  It may coordinate several Lanes. A Lane is a durable work object, not a session.
- **Clips** owns durable records, command support and acceptance mechanics.
  Read the [Clips skill](../clips/SKILL.md) rather than duplicating its schemas.
- A **Lane** holds product direction and a strategic retrospective, not technical
  criteria or acceptance receipts. A **Goal** holds an engineering outcome, plan,
  scope, decisions and acceptance. A **Task** is an independently reviewable
  request that becomes its own result/evidence record. A **Component** is a
  persistent system responsibility, not every file or worker.
- A **dev execution owner** owns technical planning, implementation, integration,
  verification and Task/Goal completion records for its assigned outcome.
  Paseo and Copilot use their user-steerable execution surfaces; other harnesses
  may expose only native sub-agents without direct user steering. The owner can
  use [Clips Dev](../clips-dev/SKILL.md) to plan and build its assigned outcome
  in its own session. A standalone Clips Dev can also take a direct user request;
  it is not a Lane Manager or another team coordinator.

Continued delivery is already the Lane Manager's responsibility. Review returned
results, reconcile dependencies, and dispatch the next useful authorized work
until the agreed outcome is verified and accepted or further progress is blocked.
Do not require the user to invoke another skill or give another routine "go"
between tasks. Explicit pauses, plan-only scope, resource limits and approvals
remain controlling.

When the current harness provides an available delegation primitive, delegate
implementation and substantive verification, including documentation and skill
edits, to a dev execution owner. Read source, diffs and evidence to scope and
assess work; write coordination records through supported Clips commands.
When no delegation primitive exists, the Lane Manager also takes on technical
execution under the linear fallback below. The coordination-only boundary does
not prohibit that fallback.
An agent assigned that execution role is not a Lane Manager merely because it
edits a management skill.

## Build and assess the breakdown

Read the relevant Lane, Goal outcome/scope/plan/criteria, full Task set, component
contracts and current user steering. Assess coverage whenever creating, reviewing,
resuming, assigning or accepting a Goal in the current request. Do not turn this
into a repository-wide historical audit.

Map each scope obligation and criterion to meaningful work units. Look for
uncovered behavior, bundled independent responsibilities, missing integration or
verification work, and actual prerequisites. Tasks follow independently
assignable and acceptable changes, not arbitrary files, steps or technical
layers. A small or atomic Goal can have a small breakdown if the coverage
rationale is explicit; Task count is neither proof nor a quota.

An unfinished Goal with no Tasks needs a meaningful request breakdown before
handoff. A Goal with only a broad implementation Task needs closer inspection,
not automatic splitting. Closed Tasks still count as the breakdown: inspect
their surviving requests, results and evidence instead of recreating them.

Keep a concise coverage assessment in the Goal plan or a named section. State
which Tasks cover its scope/criteria, dependencies and integration, and why any
coupled work stays together. Reuse valid reasoning on later touches. The dev
owner refines the engineering plan within these contracts; do not duplicate it.

Preserve historical IDs and evidence. If old completed work lacks Task records,
label a reconstruction as retrospective and cite what survives. Do not backdate
requests or acceptance. If adding Tasks solely for bookkeeping would invalidate
an accepted Goal, retain the reconstruction in named Goal content and explicitly
say that original Task records are absent. Genuine remaining work needs a real
follow-up contract, not a note concealing an acceptance gap.

## Read and announce the Lane worker budget

Before dispatching work for each Lane, read its canonical project's configuration:

```bash
clips config lane_max_active_agents
```

The numeric project default is **5 concurrent active workers per Lane**,
excluding the Lane Manager. This is a maximum, not a target worker count or a
lifetime creation quota. Change the stored project default with:

```bash
clips config --lane-max-active-agents 3
```

An explicit user override can select a positive-integer budget for one Lane
without changing other Lanes. Preserve that override and its authority in
existing Lane context, such as its description; do not overwrite unrelated
content or invent a new CLI field. Otherwise use the configured project default.
Respect stricter host or user resource limits. Read the correct project's
configuration, not an unrelated repository where the manager happens to run.

Announce the effective budget before dispatch, including any tighter constraint
and how to override it. For example: "This Lane can use up to 3 concurrent
workers, excluding me. Tell me to change this Lane's budget, or use
`clips config --lane-max-active-agents N` to change the project default."
An existing announcement can stand until its budget or scope changes.

Count actual active and starting workers, including reused or resumed sessions,
against the same Lane budget. Reserve capacity before launch or resumption so
an in-flight launch already occupies a slot. Deduplicate actual worker identities;
the same active worker continuing work for the Lane does not consume another
slot. Recheck native state before dispatch, not just titles, recorded owners or
old session associations. Unknown activity is not free capacity: retain a
known reservation until readback establishes whether that worker is active,
confirmed idle, completed or absent. Do not fabricate counts or replacement workers.

When full, keep Tasks pending or continue through workers already active on the
Lane. Confirmed idle or completed workers free capacity; assigning new work to an
idle worker reserves a slot again. Replacements are allowed as work finishes,
so total lifetime creations can exceed the concurrent limit. A failed or
ambiguous launch needs reconciliation before its reservation is released.
Reducing the budget below current activity does not terminate workers. Defer
additional launches or resumptions until activity is below the new limit.

The budget includes nested helpers wherever that host permits them. A dev owner
already consumes a worker slot; its helpers cannot bypass the Lane's remaining
capacity. Carry the effective budget and allocations in handoffs and coordinate
capacity with existing collaborators. Copilot still prohibits nested dev workers;
Paseo and generic native sub-agents retain their own topology rules.

This is a configuration-backed dispatch policy, not native SDK enforcement, a
process limiter, a scheduler, an ownership claim or a distributed lock. Native
tools supply real activity; Clips validates the configured value, not live
worker counts. If an available config read fails or returns an invalid value,
report the problem and do not dispatch additional workers on a guessed budget.
On an older CLI known not to support this setting, disclose that limitation and
use the policy default of 5 or an explicit user override; do not claim a persisted
readback or silently upgrade. With no delegation primitive, linear work creates
no worker slots. A full budget is not an absent primitive and does not authorize
the manager to bypass delegation by coding inline.

## Hand off and continue execution

Select the current harness path below. Reuse a suitable native execution owner
or invoke the supported delegation primitive; use linear execution if no such
primitive exists. Keep the same complete contract in either case, not isolated
microsteps:

- Exact repository/workspace and Lane/Goal/Task refs; source basis when needed.
- User-visible outcome, scope/exclusions and relevant component agreements.
- Stable criteria, dependencies, write boundaries and decisions already made.
- Implementation, integration, verification and completion-record obligations.
- Actual delivery endpoint, accepting authority and external approval limits.
- Harness-supported contact/steering, resource limits and return conditions.

Require useful Task-level parallelism where dependency-ready work has
non-conflicting writes and resources permit it. Keep one integration,
verification and shared-record coordinator. Sequence real prerequisites and
coupled edits; never invent filler Tasks or worker quotas. A single dev session
can serialize a bounded cut. Generic delegation guidance does not override
host-specific session topology or user resource limits.

Do not ask routine approval for necessary authorized sessions or continuation.
Session authorization does not authorize publishing, external messages, issues,
PRs, review-state changes, destructive actions or installing unrelated software.
Preserve the applicable approval rules and the user's chosen delivery endpoint.

When delegating, keep strategic coordination with the manager and technical
execution with the dev owner. Exchange substantive results, blockers, scope
amendments and user steering through the harness's available communication,
not repeated status requests. Use completion events where available. No output
alone proves a worker is dead or that replacement is safe.

Lack of user steering is not a blocker for native sub-agents on other harnesses.
Distinguish absent delegation from a denied operation, transient failure,
unreachable worker or exhausted resource allowance. Do not relabel these as
"no primitive" to bypass a restriction. Reuse a permitted destination or report
the concrete blocker and continue independent authorized work. Never invent a
running session or promise automatic resumption.

## Select the host-specific session path

Inspect the current harness and its actual exposed tools/help before selecting
a path. Reusing an existing worker through a supported dispatch mechanism is
delegation too. Host names alone do not establish available capabilities.
Explicit plan-only/deferred scope, resource limits and other user overrides
remain controlling; do not launch workers merely to prove this documentation.
The no-primitive fallback applies in any harness, including Paseo or Copilot
when it exposes no delegation primitive. A denied or failed invocation is
different from an absent capability.

### GitHub Copilot App

Every dev App session created for this manager must be a **direct child of the
Lane Manager session**,
with no intermediary coordinator, Squad Leader or dev-lead App session. Keep
children attached and coordinated so the user can open them, inspect work and
send messages directly. This rule is specific to Copilot, not Paseo.

The Lane Manager calls native `create_session` itself with the intended project,
workspace and complete Task-scoped kickoff, `coordinate_with_creator: true`,
and without `detached: true`. Reuse an existing suitable direct child when
possible. Honor the user's workspace and RAM limits; do not create a worktree
or extra session just for a role, identity, proof or validator quota.

Use `get_session` and session listings to check the actual session ID, repository,
workspace, `creator_session_id` and `coordinating_creator_session_id`. Both
creator fields must identify the Lane Manager. Use the listing's actual
`app_url` to expose user navigation; do not manufacture it. A canvas's
current-session Send action is not session creation or direct-parentage proof.

Carry the Lane Manager's actual contact in every kickoff. Use native
`send_session_message` for continuing two-way communication: manager steering,
worker blockers/results and relevant user corrections. Preserve this contact
throughout execution, not merely at launch. Native user messages to the child
remain authoritative steering; return changes affecting shared scope to the
manager. Read actual session state rather than claiming delivery equals
execution. Keep the coordinated child available until handoff is complete.

Task parallelism does not authorize nested App dev sessions or unsteerable
substitute workers. A dev owner proposes Task IDs, dependencies and non-conflicting
write boundaries to the Lane Manager when an additional worker is genuinely
useful. The manager creates that sibling directly under itself. One dev owner
can remain the technical integration/verification/record coordinator without
becoming an intermediate App parent. Serialize when resources or coupled writes
make another worker unnecessary.

Use actual native metadata, not session titles, workspace placement, a work
owner, Lane claim, activity badge or a prompt saying "child", as parentage proof.
Do not detach or reparent sessions to make a claim of compliant topology.
If a required native capability or parentage field is unavailable, report that
limit without substituting an invisible worker or a fabricated identity.
If observed topology conflicts with the requirement, keep existing work and
contact intact, report the mismatch and seek the necessary authorized host
action. Do not silently reparent/detach, create replacement workers or treat a
previous binding as permission to change the hierarchy.

### Paseo

The Paseo Lane Manager path uses **top-level** workspace dev agents. Do not call
`collaboration.spawn_agent`, an agent-scoped `create_agent`, or `paseo run` as a
manager alternative: those create children, even in a different workspace.
Only dev owners may choose sub-agents for their own Paseo execution.

Inspect supported host capabilities, configured profiles and existing agents.
For new sessions, use a documented top-level workspace launch path such as
`workspace.agents.create` through an unscoped client when the installed version
supports it. Check actual readback with `paseo inspect <agent-id> --json`:
`ParentAgentId: null` establishes top-level parentage. Missing parentage is not
proof. Inspect the repository/workspace and association separately.

Honor the requested model/profile, permissions, effort and workspace choice.
Discover live supported values instead of inventing them. Read the shared
[Paseo procedure](../clips/references/paseo.md) for the packaged launcher,
identity, binding and steering interfaces. Inspect installed guidance/help
before relying on version-specific capabilities. Do not detach an
unexpected child or launch replacements to evade a topology mismatch.

### Other hosts and portable handoffs

On other harnesses, you **must invoke available native sub-agents** for authorized
execution, even if they are not user-steerable. Discover the actual primitive
and its input/result semantics; do not invent API names or require Copilot
parentage fields, Paseo top-level agents, persistent sessions or a visible
steering surface. Carry the complete Task contract and recover actual results
through supported completion/readback tools. Keep manager contact when the
harness supports messaging; report one-shot or communication limitations
without treating them as a reason to skip available delegation.

### When no delegation primitive exists

Do not fail or stop at a plan solely because delegation is absent. The Lane
Manager must **implement and verify authorized work itself, linearly**, in the
same dependency-respecting order it would dispatch to dev agents. Select a ready
Task, mark it in progress, implement, run the required checks, record the actual
result and criterion evidence, then continue to the next ready Task. Use Goal
priorities to order independent ready work; retain real prerequisites and do not
pretend tasks ran in parallel.

Use the same contracts, acceptance criteria, source/artifact identity and actual
accepting actor as delegated work. State that execution and self-checks were
inline; do not fabricate a worker, independent reviewer or human approval.
If independent review is an explicit requirement, report its remaining gap.
Explicit plan-only instructions still stop before implementation. Missing
delegation does not bypass denied authorization, missing file/tool access,
credentials, external approvals or storage protections. A failure to launch an
available worker is not evidence that the primitive does not exist.

### Portable handoffs without execution access

A chat with neither delegation nor the tools/files needed to implement cannot
claim execution succeeded. Name that actual access blocker, not the lack of
workers, and continue whatever authorized work is possible. With local Clips
access, persist contracts in the correct repository store. With only GitHub
access, use an approved issue containing the contract and say local Clips was
not updated. Without a write surface, return a ready-to-file contract and
explicitly say it is not persisted.

Keep repository identities and refs distinct across repositories. Link actual
dependencies; do not invent a global Lane ID or a new session registry. Publish
distilled decisions and evidence, not private transcripts. Do not assume
GitHub synchronization is lossless or bidirectional without checking support.

## Preserve advisory coordination and safeguards

Host IDs, Lane claims, roles, owners and previous work/session associations are
advisory metadata, not execution locks or prerequisites for authorized work.
An existing manager or binding is useful context, not permission authority.
Preserve attribution/history. Do not invent an identity, acquire/release a claim,
clear a binding or spawn another session merely to proceed.

Optional claim operations require actual observed actor/target metadata and
explicit authority. Check local `clips lane manager --help` before relying on
support. This source CLI may not provide that host integration. A claim does not
prove a session is alive, running or entitled to veto work. Treat missing
identity as a limit on metadata mutation, not on independent authorized work.

Coordinate actual overlapping writes to source, generated files, dependencies,
Git state and the shared Clips store. Prefer one shared-record writer; workers
return evidence and proposed updates unless explicitly assigned those records.
All worktrees share the canonical store. Do not treat advisory ownership or
short file locks as a scheduler or lease.

Authentication, credentials, external-action approval, exact project/ref/session
targets, atomic writes, journal locks, stale-revision detection and acceptance
attribution remain enforced. Reread and reconcile genuine conflicts. Skill text
cannot disable hardcoded checks in a separately installed integration; report
the distinction instead of claiming a bypass.

## Review evidence and finish the scoped outcome

Distinguish these states: **planned** means contracts exist; **launched** means
an observed execution handoff occurred; **verified** means the actual candidate
was checked against criteria; **accepted** means a supported receipt records
the actual accepting actor and per-criterion evidence. None implies the next.

Review Task-scoped changes and integrated Goal evidence from the execution owner
or from your own linear execution. Inline work does not require a worker launch;
report it as direct execution, not a delegated or independently reviewed result.
Require a commit plus dirty-diff identity, tree, or immutable artifact identity
for what was checked. HEAD alone does not identify dirty work. Recheck affected
criteria when later changes can alter results. Never substitute a closed status,
a successful command, a record revision or a worker's unsupported completion
claim for evidence. Agent verification is not human approval.

Use Clips acceptance only when evidence and authority support it. Preserve
waivers with their actual authorization, and keep deferred or duplicate work
distinct from delivered behavior. Do not relax criteria to justify completion.
For a human-validation handoff, follow the label procedure below.

For a completed Lane, reconcile the intended product outcome across Goals and
write the strategic retrospective: summary, cross-Goal decisions, system and
component overview, product goals achieved, and useful media if available.
Do not manufacture screenshots, runtime evidence or a Lane acceptance receipt.
Stop at the requested endpoint rather than adding adjacent polish.

Report the delivered outcome, remaining blockers or authorized exceptions,
actual source/installation/publication state, and the next required owner/action
only when something remains. Scope recommendations (ship, fix first, defer, cut)
are recommendations, not new Clips statuses or permission to reduce scope.

## Hand completed Goals to human validation

When an execution agent reports that a Goal's implementation is complete, reconcile
its changed artifact, required Tasks, checks, and unresolved issues. If the required
implementation and verification are complete and you are presenting that result
to a human for validation, add the project label **`ready-to-review`** to that Goal.
Do this as part of the handoff, before claiming the review-ready label was applied.
Do not add it merely because work started, a Task closed, or an agent stopped.
Unfinished or blocked Goals and Goals with current acceptance are not eligible.

With local Clips access, check `clips label --help`, then inspect the Goal and the
project catalog. The canonical name is exactly `ready-to-review`; its initial
default ID is `ready-to-review`. Existing catalog identity takes precedence:
reuse the ID returned for that name, including one generated after an earlier ID
was retired. Do not rename or recolor an existing project label to enforce defaults.

```bash
clips view '#g1' --json
clips label list --json
```

If that name is absent, create it once. Use the **returned ID**, rather than
assuming it equals the name. If another writer created it first, reread the
catalog and reuse that definition; do not create a duplicate. For example, in a
fresh project catalog these supported commands create and assign it:

```bash
clips label create '{"name":"ready-to-review","color":"#8b5cf6"}'
clips label add '#g1' ready-to-review
```

Replace `#g1` with the actual Goal ref, retaining its namespace. Confirm the label
in `clips view '<actual-goal-ref>' --json`. If an existing label has ID
`review-handoff`, for example, use `clips label add '#g1' review-handoff`.
If work becomes unfinished or blocked again, remove the readiness assignment with
`clips label remove '#g1' <returned-id>` and explain the remaining work.

This label is a request for human validation, **not acceptance** and not a Goal
lifecycle status. Preserve the actual status, receipts, and accepting actor. Do
not close or accept a Goal just to produce the label. If local commands are
unavailable or fail, report that the label was not applied; never infer it from a
Clips status or claim a Paseo agent is running without runtime evidence.
This procedure requires the labels capability. If this checkout does not yet
support it, report that limitation; do not import an unrelated feature branch
just to add the label.
