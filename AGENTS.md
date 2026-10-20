# AGENTS

## Skills

| Skill | Path | Description |
|---|---|---|
| **clips** | `.agents/skills/clips/SKILL.md` | Goals, atomic task requests and records, system components, evidence, history, and optional GitHub collaboration. |
| **lane-manager** | `.agents/skills/lane-manager/SKILL.md` | Plan and coordinate continued delivery, delegating development through the current harness. |
| **clips-dev** | `.agents/skills/clips-dev/SKILL.md` | Plan, implement and verify a requested outcome as an autonomous staff developer in its own session. |

## Work model

Use a goal for the outcome, plan, and architectural decisions. Use a task as the
work contract for one independently reviewable and acceptable change: request
before execution, actual result and acceptance afterward, under the same ID.
Use components for persistent system responsibilities and behavioral boundaries
that other work depends on.

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

The default for actionable work is comprehensive plans within one coherent Lane,
detailed Goals with observable acceptance criteria, meaningful Task contracts and
dependencies, then implementation and verification. Reuse the existing frame and
preserve atomic/selected-Task scope. Comprehensive means complete coverage, not
filler Tasks or a new record type. Explicit brainstorming, plan-only, defer,
queue or narrower-output instructions override that default. A plan, records or
a launch preview alone does not satisfy an authorized implementation request.
Lane Managers delegate through the current harness; dev execution owners implement
and verify. Lane Manager already owns continuation through the agreed outcome;
no separate skill invocation or routine "go" is needed between tasks. Clips Dev
can also take a direct request and plan/build it in its own session without
becoming a Lane Manager. Other harnesses' Lane Managers must use available native
sub-agents even without user steering. When no delegation primitive exists, the
manager implements and
verifies authorized Tasks linearly in dependency/dispatch order. This fallback
does not bypass denied authorization or missing tool/file access.

Lane Manager reads `clips config lane_max_active_agents` and announces the
effective budget before dispatch. The project default is 5 concurrent active
workers per Lane, excluding its manager; configure it with
`clips config --lane-max-active-agents N`. Explicit user overrides can apply to
one Lane, and tighter resource limits still apply. Count existing/starting/reused
workers and any permitted nested helpers. Unknown activity is not free capacity;
completion or confirmed idle frees a slot. Reductions never implicitly terminate
workers. This is dispatch policy, not a native scheduler or ownership gate.

When a Lane Manager delegates work in GitHub Copilot App, its dev execution
sessions are direct children, never grandchildren behind an intermediary
coordinator/Squad/dev lead. A standalone Clips Dev session needs no manager.
The manager creates needed siblings using native `create_session`; keep them
coordinated, user-steerable and in two-way `send_session_message` contact. Verify
both creator fields with native session readback. A technical integration owner
is not an extra parent. Serialize for resource limits; do not detach/reparent or
spawn invisible substitutes. This does not replace Paseo's top-level dev path.

## Quick reference

Use the checkout's CLI when developing capabilities absent from an installed
release. From this repository, `node src/cli.js` is equivalent to `clips` below.

```bash
clips view all
clips goal create '{"title":"Outcome","description":"Why it matters","plan":"Approach and coordination"}'
clips task create g1 '{"title":"Atomic change","description":"Requested outcome","acceptance_criteria":[{"id":"A1","description":"Observable completion condition"}]}'
clips component list
clips view '#g1#t1' --json
clips history '#g1#t1' --json
clips task status g1 t1 in_progress
clips task update g1 t1 --file task-result.json
clips task accept g1 t1 --file task-acceptance.json
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

Workflow instances live under the resolved `.clips/` store and must not be
committed. Committed product documentation, source, and templates are repository
state. Copy legacy templates into `.clips/records/` only when an independent
record is useful; never place instances beside templates.

All worktrees share Clips state through the common repository root. Default to a
single coordinator writing shared records while workers return proposed updates
and evidence. Revision checks and short file locks do not establish a distributed
scheduler or task lease.

GitHub collaboration is disabled by default. Preserve the current setting and
enable it only when authorized. Use the normal source-control workflow for code
and skill changes; local workflow records are excluded from those commits.
