
# Clips Workspaces for Paseo

A Paseo-native, local-first UI for [@dfosco/clips](https://github.com/dfosco/clips).
Browse **Lanes → Goals → Tasks** and start work in an isolated Paseo Git worktree,
with or without an agent. Inspired by
[ajma/paseo-issues-workspaces](https://github.com/ajma/paseo-issues-workspaces),
but **Clips is the work system**, not GitHub Issues.

## What it does

- **Project selector:** Finds Git projects on the connected Paseo daemon whose
  main checkout has an initialized `.clips/` store. Linked worktrees are grouped
  with the main project.
- **Planning hierarchy:** Lane strategic framing, Goal engineering outcome,
  and each Task's work request. Expand records for scope, plan, decisions,
  and acceptance criteria. Search by title, ref, and description.
- **Run in Paseo:** Starts an agent in a new Git worktree branch for that exact
  Clips reference. **Workspace only** creates the worktree without starting
  an agent. **Open workspace** returns to an existing one; **Start agent** starts
  another agent there when none is actively running or waiting for input.
- **Running now:** Reads the actual Paseo agent directory, not the Clips
  `in_progress` field. Running and initializing agents count as active.
  A task with an idle agent shows **Workspace idle**, while permission
  requests show **Needs input**. The **Running** filter includes Lanes,
  Goals, or Tasks with active agents, plus parent groupings for active children.
- **Safe identity:** Workspace titles embed the complete Clips ref; worktree
  branches carry a stable namespace-aware identity even when titles change.
  Agent labels provide a second identity path if a workspace is renamed.
  Creation checks the live workspace list, preexisting branches, and an
  in-flight guard before launching.
- **Preserves ownership:** Clips journals and acceptance remain under
  `.clips/`; no automatic status updates, closures, approvals, or GitHub writes.
  Paseo owns agent sessions, workspace lifecycle, and worktree creation.

## Install

Requires Paseo **0.11.2+**, Git, a repository initialized with
`clips init`, and a Clips CLI version that implements `clips board --json`.

Install this plugin directly from the Clips monorepo:

```sh
paseo plugin install git:dfosco/clips:plugins/paseo
```

Or install a local checkout:

```sh
paseo plugin install /absolute/path/to/clips/plugins/paseo
```

Run **Clips Workspaces** from the Paseo sidebar or Command Center. For
agent execution, configure at least one ready provider in Paseo. Use
**Clips Workspaces settings** to choose a specific provider/model, or
leave it set to Automatic.

**CLI requirement:** The published Clips 1.6.0 CLI does *not* implement
the new JSON board command yet. For this unreleased checkout, set
`CLIPS_CLI_PATH=/absolute/path/to/clips/src/cli.js` in the
**Paseo daemon host's environment** and restart/reload its plugin.
The path must exist on that machine. After publishing the updated
Clips package, installing the new CLI globally is sufficient.

The plugin's server process reads Clips data by invoking
`clips board --json` in the selected Git repository. No extra database,
GitHub authentication, or issue sync is required.

## Running a record

The action appears on every Lane, Goal, and Task that is not administratively
closed, not-planned, or duplicate. The generated branch looks like:

```
clips/task/alice-g001-t01-cbf3a4ef-write-tests
```

The ref identity is stable; the title suffix is only for readability.
The worktree branches from the selected checkout's current `HEAD`, **not**
necessarily the remote's latest default branch. Update the checkout's
base before launching when you need the newest upstream revision.

An agent receives a prompt to read `AGENTS.md`, the Clips record,
the associated skill, and the relevant source; then it works within
that record's contract. A Lane prompt emphasizes strategic coordination,
a Goal prompt emphasizes outcomes and Tasks, and a Task prompt emphasizes
bounded change, tests, and evidence. No agent can self-grant human approval
merely by setting status to closed.

Because worktrees share the same Clips store through Git's common root,
**concurrent agents can touch the same journals**. Clips recommends one
coordinator for shared records and separately owned source changes;
short file locks do not implement a distributed task lease.

## Reading execution status

Status is derived from the current Paseo host's workspace and agent
directories (with subscriptions and a 15-second backstop refresh).
**Running** means a matching agent is `running` or `initializing`;
it is not inferred from Clips planning status. **Needs input** means an
agent requires a response. **Idle** means the work has a workspace but
no active agent. The counts for Goals and Lanes are for agents started
*on those specific records*; a Running filter also displays ancestor
groups around directly running Task records.

Workspaces on other Paseo hosts are not read by this first integration:
install the plugin on each relevant daemon host to view its local
Clips projects and executions. Do not interpret a missing local
workspace as proof no work is running on another host.

## Development

From the plugin directory, install its *development-only* dependencies:

```sh
cd plugins/paseo
npm install
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload clips-workspaces
paseo plugin logs clips-workspaces
```

Paseo supplies host SDK, React and Zod modules at runtime and compiles the
TypeScript source itself. The plugin never requires bundling a second
React, a daemon, or a Clips journal parser.

- `shared/`: RPC contracts, stable work identity, running-state mapping.
- `server/`: Clips CLI adapter, safe project/worktree lookup, agent launch.
- `client/`: React Native-compatible hierarchy, live directory observation,
  project selection, filters, launch/open actions and agent settings.

Trusted plugins run daemon-side commands with the user's account privileges.
Install only reviewed code; external work-record text should also be
treated as instructions to review rather than unconditional authority.
