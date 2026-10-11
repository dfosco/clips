# AGENTS

## Skills

| Skill | Path | Description |
|---|---|---|
| **clips** | `.agents/skills/clips/SKILL.md` | Goals, atomic task requests and records, system components, evidence, history, and optional GitHub collaboration. |

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
