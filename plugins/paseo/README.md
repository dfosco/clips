
# Clips Workspaces for Paseo

A Paseo-native, local-first UI for [@dfosco/clips](https://github.com/dfosco/clips).
Browse **Lanes → Goals → Tasks** and start work in an isolated Paseo Git worktree,
with or without an agent. Inspired by
[ajma/paseo-issues-workspaces](https://github.com/ajma/paseo-issues-workspaces),
but **Clips is the work system**, not GitHub Issues.

## What it does

- **Project labels:** Colored chips on Lane, Goal, and Task rows. Open the row's
  Labels action to assign or remove existing labels, search the catalog, or create
  a label with a name and palette color. Each label's Edit action opens rename,
  recolor, and deletion controls. Catalog edits affect this project; deleting an
  assigned label is refused with the record refs that still use it. Labels are
  independent of Clips status, acceptance, and Paseo runtime activity. The picker
  uses Paseo's dialog on wide layouts and bottom sheet on compact layouts.

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

Requires Paseo **0.11.2+** on both daemon and app, Git, and Node.js
**22.18+** with npm on the **daemon host**. Enable plugins in Paseo settings
before installing. A ready provider is needed to start agents, but not to browse
planning records. Plugins and their preparation commands run with the daemon
user's filesystem and process privileges.

Install this plugin directly from the Clips monorepo:

```sh
paseo plugin add git:dfosco/clips:plugins/paseo --ref main
paseo plugin ls clips-workspaces --json
```

The runtime ID is `clips-workspaces`. The explicit `git:` prefix selects the
repository rather than a registry listing. Paseo keeps the full monorepo checkout,
including the canonical Clips CLI and skills. Preparation runs these exact commands
from `plugins/paseo` before Paseo moves and activates the candidate:

```sh
npm ci --prefix ../.. --omit=dev --ignore-scripts
npm ci --omit=dev --ignore-scripts
```

The root lock installs the canonical CLI's dependencies, including `skillshop`;
the plugin lock installs `@getpaseo/client` and its transitive dependencies for
the standalone session CLI. Paseo supplies the plugin SDK, React and Zod to its
compiled entries. No global Clips installation, npm publication, `npm link`,
web-board build, or developer-specific path is needed for the native plugin.

For a local directory install, prepare the **full checkout** yourself first.
Directory install/reload does not run the Git preparation commands:

```sh
git clone https://github.com/dfosco/clips.git
cd clips/plugins/paseo
npm ci --prefix ../.. --omit=dev --ignore-scripts
npm ci --omit=dev --ignore-scripts
paseo plugin install "$PWD"
```

Do not copy only this subdirectory. The CLI eagerly imports other repository
modules and uses the canonical skill library. Initialize each planning repository
with that matching CLI, using the installed checkout path returned by `plugin ls`
or your own full checkout:

```sh
cd /path/to/planning-repository
node /path/to/clips/src/cli.js init --skills-scope project
```

With a remote daemon, put `--host <target>` before `plugin` and ensure Git, npm,
Node, the source directory, and planning repositories exist on that daemon host.
The client does not upload a local source directory or install dependencies there.

### Update and rollback

Save the current Git revision from `paseo plugin ls clips-workspaces --json`
before updating. Review the proposed revision, then apply it:

```sh
paseo plugin update clips-workspaces --check
paseo plugin update clips-workspaces
paseo plugin ls clips-workspaces --json
paseo plugin logs clips-workspaces
```

An ordinary Git update proposes the remote's default HEAD. The initial `--ref`
does **not** pin future updates. Select a reviewed commit explicitly to update
or roll back without a second CLI prompt:

```sh
paseo plugin update clips-workspaces --ref <reviewed-commit-sha>
```

Install/update runs both locked preparation commands before validation and
activation. Failed preparation or activation retains the previous installation.
A successful update must be rolled back explicitly to the saved commit; there is
no automatic persistent version pin. Directory sources are skipped by `update`:
restore the desired full checkout revision, rerun preparation, then use
`paseo plugin reload clips-workspaces`. Reload itself does not install dependencies.
An existing runtime ID is rejected by install. Switching an existing directory
installation to a Git source requires an explicit remove and add; do not use that
as an update or discard a development checkout unintentionally.

The native Paseo integration does not need `dist/web`. The separate `clips web`
command requires a root development install and `npm run web:build`. These
distribution checks do not claim native UI rendering or agent-provider parity.

Run **Clips** from the Paseo sidebar or Command Center. Configure a ready
provider in Paseo to start agents. **Clips settings** selects launch defaults.

**CLI resolution:** The backend reads public `paseo.config.get()` plugin sources.
It selects the single enabled source whose manifest ID is exactly
`clips-workspaces`, then runs that full checkout's `src/cli.js` with the server's
Node executable. It uses the final installed path, including after staging moves.
A missing or ambiguous source fails with guidance instead of choosing an arbitrary
`clips` from `PATH`. Multiple enabled copies need an explicit `CLIPS_CLI_PATH`
in the **daemon host's environment**. That override takes precedence and may name
a JavaScript CLI file or executable. It must implement the matching board, labels,
Lane manager and work-contract commands. A broken checkout/dependency install is
reported without falling back to an older global CLI.

The same checkout's CLI can be invoked from external shells and agent sessions
with `node /path/to/clips/src/cli.js`; the plugin does not alter their `PATH`.

The plugin's server process reads Clips data by invoking
`clips board --json` in the selected Git repository. No extra database,
GitHub authentication, or issue sync is required.

## CLI for configured sessions

The plugin includes a small CLI for Lane Managers and other callers that need
to start an agent with explicit settings. From a Clips checkout with the
Paseo plugin production dependencies installed:

```sh
node plugins/paseo/cli.js options --project . --provider codex
node plugins/paseo/cli.js options --project . --provider codex/gpt-6.1-sol
node plugins/paseo/cli.js start --project . --ref '#g001#t01' \
  --provider codex/gpt-6.1-sol --thinking high --speed fast \
  --permission restricted --dry-run --json
```

The first `options` command lists ready providers, models, thinking levels and
permission modes. The model-specific command also lists provider features and
their valid values. `--permission full-access` and `--permission restricted`
select the matching live provider mode; full access is the default. Use
`--mode <id>` to select an exact mode ID from discovery. Add `--thinking <id>`
when feature availability depends on the chosen thinking level. `--speed fast`
resolves to the selected provider's discovered Fast value; `--speed normal`
chooses its default or Normal value. Use repeatable `--feature id=value` flags
for other discovered provider features.

Permission modes vary by provider. If the requested access level is not
available, session creation reports that instead of silently falling back to
the provider's default mode.

`--dry-run` prints the target, workspace action, full Clips context prompt and
resolved Paseo config without creating a workspace or agent. Remove it to
create the session. If more than one Clips workspace matches the ref, pass
`--workspace <id>`. With no match, the CLI creates an isolated worktree from
the current branch, or from `--base <branch>` when provided. The project must
be registered in Paseo. `--url`, `PASEO_WS_URL` and `PASEO_PASSWORD` select an
alternate or authenticated daemon. `CLIPS_CLI_PATH` can select the Clips CLI
explicitly. The checkout-local CLI is the default; a plugin-only copy is unsupported.

The CLI runs on Node.js 22.18 or later. From `plugins/paseo`, install
locked production dependencies with `npm ci --omit=dev --ignore-scripts`
and the root preparation command above; then use:

```sh
npm run clips-paseo -- options --project ../.. --provider codex
npm run clips-paseo -- start --project ../.. --ref '#g001#t01' \
  --provider codex/gpt-6.1-sol --thinking high --speed fast \
  --permission full-access --dry-run --json
```

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

From the plugin directory, install its development and standalone CLI dependencies:

```sh
cd plugins/paseo
npm ci --ignore-scripts
npm run typecheck
npm test
paseo plugin install "$PWD"
paseo plugin reload clips-workspaces
paseo plugin logs clips-workspaces
```

Paseo supplies host SDK, React and Zod modules to compiled entries and compiles the
TypeScript source itself. The plugin never requires bundling a second
React, a daemon, or a Clips journal parser.

- `shared/`: RPC contracts, stable work identity, running-state mapping.
- `server/`: Clips CLI adapter, safe project/worktree lookup, agent launch.
- `client/`: React Native-compatible hierarchy, live directory observation,
  project selection, filters, launch/open actions and agent settings.

Trusted plugins run daemon-side commands with the user's account privileges.
Install only reviewed code; external work-record text should also be
treated as instructions to review rather than unconditional authority.

Installation/update behavior follows Paseo's [plugin source and CLI reference](https://paseo.sh/docs/plugins/reference#plugin-sources)
and [Git preparation guidance](https://paseo.sh/docs/plugins/publishing#share-through-github-or-git).
