# Clips records and optional Paseo execution

This is the shared procedure for ordinary dev agents, direct user steering,
and Lane Manager handoffs. Use the installed interfaces you actually have;
inspect tool schemas and CLI help before using a version-dependent capability.
An assigned dev agent implements its outcome and maintains its records. It
does not need to become Lane Manager, spawn a replacement, or claim a Lane.
Lane Manager separately retains its coordination-only, top-level delegation,
task-coverage, authorization, and management-claim policies.

## Distinguish the sources

- **Planning:** the plugin reads `clips board --json` from the selected Git
  repository's shared Clips store. Update records through the Clips CLI, never
  raw journals or a parallel UI store. Linked worktrees share that store.
- **Activity and navigation:** the plugin reads the selected Paseo host's
  workspace/agent directory. An `in_progress` Goal can have no running agent;
  an idle, failed, or input-blocked session is different from active execution.
  A stopped agent is not evidence that its Task is complete or accepted.
- **Association:** an observed session/workspace is attached to an exact work
  record by native Paseo labels. Titles and Clips `owner` prose do not make
  that link. A Task binding is not an automatic binding to its parent Goal.
- **Management:** durable Lane claims are separate from work execution. They
  survive disconnection. Contributing to an agreed Goal/Task requires no Lane
  claim; strategic Lane management still requires its own authority/procedure.

## Maintain the work contract

Read the complete qualified Goal/Task, linked contracts, scope, criteria and
blockers. Reuse the current request/authorization. A direct bug/feature request
can be implemented by the current dev agent; no manager session is required.
Create or amend the bounded Task request before implementation when needed.
Preserve historical IDs and request revisions. Use the goal for coordination
and cross-task decisions, and tasks for independently acceptable changes.

Use actual supported commands, for example:

```sh
clips view '#g1#t1' --json
clips task update g1 t1 --file task-request.json
clips task status g1 t1 in_progress
clips task update g1 t1 --file task-result.json
clips task accept g1 t1 --file task-acceptance.json
clips view '#g1#t1' --json
```

`task-request.json` can set `owner` to the actual execution identity and amend
`blocked_by` to reflect real dependencies. Do not clear blockers simply to run.
Record an execution destination that another agent can identify; that owner
field is coordination metadata, not the runtime association below. Keep a
truthful result/record while working or blocked. Acceptance requires the checked
artifact, actual accepting actor and criterion evidence under the main Clips
skill; administrative status alone is insufficient. Update the Goal's plan or
record when coordination/outcome changes. Use expected revisions when supported.

## Discover identity and bind the actual session

For the native Paseo tools, the supported sequence is:

1. Identify the actual session you are authorized to use. In a Paseo agent,
   `PASEO_AGENT_ID` is an observed candidate ID, not a fabricated display name.
   Read `get_agent_status({agentId})`: the returned snapshot includes `id`,
   `cwd`, `workspaceId`, current `labels` and actual runtime status. Use
   `list_agents` to discover candidates when needed, not as a polling loop.
2. Read `list_workspaces({})` and match the snapshot's `workspaceId` to the
   returned `workspaceId`, `cwd`, and **`projectId`**. Verify the actual project
   and selected workspace belong to the repository/worktree being worked on.
   The Paseo project ID is not Clips config `project_id`, a title, or a guessed
   hash. Resolve ambiguous repositories/workspaces before writing a binding.
3. Read the exact Clips ref, retaining any namespace, and select its real kind:
   `goal` for a whole-Goal owner, `task` for a bounded Task, or `lane` only for
   actual Lane management. Read current labels immediately before an update.
   With `update_agent`, merge the three fields below into those fresh labels;
   preserve every unrelated key. For example, a tool invocation constructed
   from observed values has this shape (variables are not literal IDs):

   ```js
   update_agent({
     agentId: observedSessionId,
     labels: {
       ...freshSnapshot.labels,
       "clips.ref": qualifiedRecordRef,
       "clips.projectId": observedWorkspace.projectId,
       "clips.kind": recordKind,
     },
   })
   ```

4. Reread `get_agent_status({agentId})` and verify the exact triple, session,
   workspace and repository. New launches need this readback too, even if the
   launch path sets labels automatically. Report success only for what was
   observed. An ordinary dev agent can now continue its direct assignment;
   a coordinator reusing another session sends the complete outcome through
   `send_agent_prompt` within existing authority and reports actual handoff.

For shell-only environments with the installed Paseo CLI, inspect
`paseo project ls --help`, `paseo agent update --help`, and `paseo ls --help` first.
Resolve the executable from the host's `PASEO_CLI` when provided, or
`command -v paseo`; examples use `paseo` as shorthand for that actual executable.
An app-bundled CLI may not be on PATH. Do not invent an installation path.
Current supported equivalents include `paseo project ls --json` to discover
actual registered project IDs and `paseo agent update <actual-agent-id>` with
repeated `--label key=value` add/set flags. Read back the exact association and
match the actual agent ID. Substitute observed values; do not copy placeholders:

```sh
paseo agent update '<actual-agent-id>' \
  --label 'clips.ref=<qualified-ref>' \
  --label 'clips.projectId=<observed-project-id>' --label 'clips.kind=<kind>' --json
paseo ls --global --label 'clips.ref=<qualified-ref>' \
  --label 'clips.projectId=<observed-project-id>' --label 'clips.kind=<kind>' --json
```

The compact list omits the complete label map and workspace ID. Use a native
snapshot/workspace API when those need inspection; never pretend the compact
list supplied missing metadata. If no supported discovery/write/readback route
is available, report that integration limitation and continue authorized record
work rather than inventing flags or claiming association succeeded.

`paseo inspect <actual-agent-id> --json` exposes `ParentAgentId`. Verify null
parentage when a top-level dev-owner handoff is required; do not infer it from
workspace placement or a visible tab. A child must not present itself as a
top-level execution owner. The existing Lane Manager role policy determines
which sessions it may choose; this procedure does not grant it child creation.

## Direct steering, reuse, and limitations

A user may steer the current dev agent directly. Keep its Task/Goal records
and binding aligned with the new agreed outcome. Reuse after the previous work
is complete or explicitly transferred; do not steal another owner's session
or silently relabel an unrelated active outcome. A single `clips.ref` cannot
represent several simultaneous Goals. Use separate authorized owners or actual
supported multi-record association; do not claim nonexistent aggregation.

Preserve labels from the freshest read and read them back. Full-map replacement
APIs without revision/CAS support cannot guarantee against a concurrent writer
between read and write; coordinate a single binding writer, report conflicts,
and use atomic revision support if the installed interface provides it. Do not
invent CAS flags. Binding success alone does not prove the Go to agent action
renders. If a concrete UI problem remains, send the observed binding/workspace
and reproduction details to the responsible UI dev owner; preserve the host's
computer-use and external-message authorization rules.

## Configure a new session only when needed

Current dev agents do not need a new session merely to update assigned work.
When an authorized handoff needs a new top-level owner, reuse a suitable one
first. Discover configured profiles and their notes. Materialize the requested
provider/model, permission mode, thinking and feature values; if no profile fits,
discover live capabilities and report the fallback rather than guessing values.
Workspace choice follows the request/settings, not a universal isolation default.

From the Clips checkout on Node.js 22.18 or later, the supported top-level
launch path is the Clips Paseo CLI (or its plugin launch dialog):

```sh
node plugins/paseo/cli.js options --project . --provider codex
node plugins/paseo/cli.js options --project . --provider codex/gpt-6.1-sol
node plugins/paseo/cli.js start --project . --ref '#g1#t1' \
  --provider codex/gpt-6.1-sol --thinking high --speed fast \
  --permission full-access --workspace '<observed-workspace-id>' --dry-run --json
```

Examples of provider/model/settings are illustrative: use values returned by
live discovery. The provider-only query lists ready models and permission modes;
provider/model queries include thinking/features. Add `--thinking <id>` to
discovery when feature availability depends on thinking. Full access is the
default where supported; `--permission restricted` selects a matching restricted
mode and `--mode <id>` chooses an exact discovered provider mode. Missing requested
modes are a real choice/blocker, not permission to substitute a default.

Inspect the preview's exact ref, prompt, workspace action, `config.modeId` and
feature values. `--workspace <id>` selects a current/existing workspace;
`--base <branch>` selects the base for a requested new worktree. Without a
matching workspace the CLI proposes a new worktree; do not accept that if the
request calls for current-workspace execution. Lane launches additionally need
the actual observed app host ID in `--host-id`, even for a dry run; use Lane
Manager for strategic management and claim/authority policy. Goal/Task launches
require neither Lane ownership nor that host-ID option.

Within the user's authorization, run the same start command without `--dry-run`,
then verify actual returned parentage, workspace and binding. Lane Manager's
actionable-request policy already authorizes necessary scoped dev sessions;
do not add a routine start confirmation. Explicit plan/defer/queue instructions
and real blockers still override execution. The checkout CLI uses an unscoped
workspace SDK route. Agent-scoped `create_agent` and `paseo run` create children
even in another workspace, so are not substitutes for a top-level-owner launch.
Dev agents may choose their own sub-agents within their role/authority.

## When Paseo is absent

Use Clips locally for authorized requests, owners, statuses, blockers, results
and acceptance. Runtime integration is optional. Report missing session/project
discovery, tooling or daemon access precisely; do not block unrelated engineering,
start a manager, fake a Lane claim, or infer a running agent from Clips status.
Filesystem skill updates become visible through live links, but already-loaded
session instructions require explicit rereading; dissemination is not prompt
hot-reload or future compliance proof.
