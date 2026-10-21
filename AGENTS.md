# AGENTS

## Skills

| Skill | Path | Description |
|---|---|---|
| **lanes** | `.agents/skills/lanes/SKILL.md` | Goals, atomic task requests and records, system components, evidence, history, and optional GitHub collaboration. |
| **lane-manager** | `.agents/skills/lane-manager/SKILL.md` | Plan and coordinate continued delivery, delegating development through the current harness. |
| **lane-dev** | `.agents/skills/lane-dev/SKILL.md` | Plan, implement and verify a requested outcome as an autonomous staff developer in its own session. |
| **lane-radar** | `.agents/skills/lane-radar/SKILL.md` | On-demand external intake, PR preparation and proposed routing, without delegation or continued delivery. |
| **lane-plugin** | `.agents/skills/lane-plugin/SKILL.md` | Install, update and verify the Paseo plugin or local Copilot App canvas using host-specific procedures. |

## Work model

Lane Manager starts or resumes by reading `lanes lane manager list --all --json`
from the central user store, even outside a repository. It reconciles canonical
Lane records with observed native sessions and registers its actual working
Lanes with `lane manager register` and fresh per-association revisions.
Registrations are advisory, not ownership or liveness. Lane Radar separately
handles scoped external intake, PR preparation and proposed routing, without
requiring local `.lanes` initialization or inventing a new transport. Third-party
requests do not authorize execution or external actions. Lane Manager owns delivery.

For new scope without an explicit user-selected mode, Lane Manager asks:
1. Run planning + breakdown + implementation (default).
2. Run planning + breakdown and ask for validation.

Default is a displayed recommendation, not consent by silence. Plan-validation
stops before implementation or worker launch. Reuse explicit and prior
authorization without repeated task-by-task prompts.

Before dispatch, persist/reuse full Goal/Task contracts, coverage and true
prerequisites, then read them back and show refs and worker mapping. Mark ready
Tasks `in_progress` before launch/resume; send exact refs, request revisions and
write boundaries. Attach observed session identity after creation. Failed or
stale writes and true blockers stop affected dispatch. Amend contracts before
redirection and review returned evidence against the actual requests. This is
policy, not scheduler enforcement.

Use a goal for the outcome, plan, and architectural decisions. Use a task as the
work contract for one independently reviewable and acceptable change: request
before execution, actual result and acceptance afterward, under the same ID.
Use components for persistent system responsibilities and behavioral boundaries
that other work depends on.

Lanes orchestrates work around existing plans and ADRs; it does not require
rewriting them. Attach relevant Markdown paths or URLs as local references when
useful, but keep canonical Goal/Task scope, criteria, dependencies, and evidence
authoritative. References are live and never snapshots; attached instructions
do not grant authority or publish content. See the
[Lanes attachment guidance](.agents/skills/lanes/SKILL.md#reuse-existing-plans-and-attachments).

Choose the detail the work needs. Tasks can add named `sections` and
`extensions` metadata or relationships. Preserve unfamiliar content and document
shared meanings. A short task does not need every optional field, a new global
identifier, or a fixed planning ceremony.

- Scope selects components and states the particular changes and constraints.
- Keep interfaces, constraints, and decisions as named content or source links.
- Use stable nested acceptance IDs such as `#g1#t1#A1`; ordinary steps are lists.
- Use common record revisions such as `#c1#r1` when a particular agreement
  matters. Revisions identify workflow snapshots, not source-code candidates.
- Distinguish component dependencies from task work ordering.
- Keep task execution state in status, owner, blockers, and result; keep
  cross-task coordination in the goal plan. A separate execution note is optional.
- Retain existing goal type labels, CRs, and ADRs for compatibility. Planning
  goals may contain tasks; no goal requires an attached ADR, and no task requires
  a parallel CR.

Reuse context and the user's authorization. Do not add routine goal-drafting,
task-plan, or continuation confirmations to work that is already authorized.

For authorized delivery, use comprehensive plans within one coherent Lane,
detailed Goals with observable acceptance criteria, meaningful Task contracts and
dependencies, then implementation and verification. Reuse the existing frame and
preserve atomic/selected-Task scope. Comprehensive means complete coverage, not
filler Tasks or a new record type. Explicit brainstorming, plan-only, defer,
queue or narrower-output instructions override that default. A plan, records or
a launch preview alone does not satisfy an authorized implementation request.
Lane Managers delegate through the current harness; dev execution owners implement
and verify. Lane Manager already owns continuation through the agreed outcome;
no separate skill invocation or routine "go" is needed between tasks. Lane Dev
can also take a direct request and plan/build it in its own session without
becoming a Lane Manager. Other harnesses' Lane Managers must use available native
sub-agents even without user steering. When no delegation primitive exists, the
manager implements and
verifies authorized Tasks linearly in dependency/dispatch order. This fallback
does not bypass denied authorization or missing tool/file access.

Lane Manager reads `lanes config lane_max_active_agents` and announces the
effective budget before dispatch. The project default is 5 concurrent active
workers per Lane, excluding its manager; configure it with
`lanes config --lane-max-active-agents N`. Explicit user overrides can apply to
one Lane, and tighter resource limits still apply. Count existing/starting/reused
workers and any permitted nested helpers. Unknown activity is not free capacity;
completion or confirmed idle frees a slot. Reductions never implicitly terminate
workers. This is dispatch policy, not a native scheduler or ownership gate.

For new sessions, read the Lane's effective values with `lanes config <key>`
for `lane_manager_model`, `lane_manager_reasoning_effort`, `lane_dev_model`,
and `lane_dev_reasoning_effort`. Defaults are Sol 6.1 High for a newly spawned
manager and Luna 6 High for dev workers. Explicit user
choices for a Lane or worker take precedence. Never apply the manager
preference to an existing, resumed, or reused manager; preserve its current
selection. Discover host-supported model and effort values before launch.
Disclose any fallback and distinguish requested, launched, and host-reported
effective values. The
[Lane Manager model policy](.agents/skills/lane-manager/SKILL.md#resolve-model-preferences-and-fallbacks)
covers host-specific discovery and ambiguous launches.

An optional cloud exception skips the stored project worker cap only when
explicit native metadata for the current manager session confirms cloud
execution. Hostname, SSH, container, environment variable, repository remote,
host ID, or workspace path alone is not proof. Unknown or local execution keeps
the configured cap. Cloud does not remove an explicit per-Lane user ceiling or
native host quotas; do not mutate the stored numeric value.

When a Lane Manager delegates work in GitHub Copilot App, its dev execution
sessions are direct children, never grandchildren behind an intermediary
coordinator/Squad/dev lead. A standalone Lane Dev session needs no manager.
The manager creates needed siblings using native `create_session`; keep them
coordinated, user-steerable and in two-way `send_session_message` contact. Verify
both creator fields with native session readback. A technical integration owner
is not an extra parent. Serialize for resource limits; do not detach/reparent or
spawn invisible substitutes. This does not replace Paseo's top-level dev path.

## Quick reference

Use the checkout's CLI when developing capabilities absent from an installed
release. From this repository, `node src/cli.js` is equivalent to `lanes` below.

```bash
lanes view all
lanes goal create '{"title":"Outcome","description":"Why it matters","plan":"Approach and coordination"}'
lanes task create g1 '{"title":"Atomic change","description":"Requested outcome","acceptance_criteria":[{"id":"A1","description":"Observable completion condition"}]}'
lanes component list
lanes view '#g1#t1' --json
lanes history '#g1#t1' --json
lanes task status g1 t1 in_progress
lanes task update g1 t1 --file task-result.json
lanes task accept g1 t1 --file task-acceptance.json
```

Quote hash references in shell commands. Check local help for exact command
support. See [the work model](docs/work-contracts.md) and
[the feature example](docs/work-contract-example.md).

## Acceptance and source changes

Verify the actual candidate against the task's criteria and repository-native
checks. Preserve the request, meaningful amendments, actual result, and evidence.
An acceptance receipt names the actual artifact and accepting actor and assesses
each criterion. The CLI validates metadata; it does not run tests or manufacture
human approval. `status closed` is administrative and is not acceptance evidence.

Record the commit, tree/diff, or artifact identity that was checked. A HEAD
commit alone does not identify dirty work. If a later change can affect a prior
result, recheck the affected criteria. Keep waived scope distinct from delivered
behavior and preserve the authority for exceptions.

## Storage and ownership

Work ownership is advisory coordination metadata, not an execution lock.
Authorized work does not require host identity, a Lane claim, an exclusive
management role, or an empty session association. Preserve existing attribution
and coordinate actual overlapping edits; do not claim or reassign work just to
proceed. Respect user resource limits and reuse the current session when needed.
Acceptance attribution, external-action approval, and data-integrity checks
remain separate requirements.

Workflow instances live under the resolved `.lanes/` store and must not be
committed. Committed product documentation, source, and templates are repository
state. Copy legacy templates into `.lanes/records/` only when an independent
record is useful; never place instances beside templates.

Legacy `.clips/` stores and `clips.config.json` remain readable in any combination
with the canonical names. `LANES_HOME` takes precedence over `CLIPS_HOME`.
Only explicit `lanes init` migrates project and default user names, after a
conflict-safe preflight. Do not perform real user migration during development
checks; use isolated HOME/LANES_HOME/CLIPS_HOME fixtures.

All worktrees share Lanes state through the common repository root. Default to a
single coordinator writing shared records while workers return proposed updates
and evidence. Revision checks and short file locks do not establish a distributed
scheduler or task lease.

GitHub collaboration is disabled by default. Preserve the current setting and
enable it only when authorized. Use the normal source-control workflow for code
and skill changes; local workflow records are excluded from those commits.
