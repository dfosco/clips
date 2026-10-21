---
name: lane-plugin
description: >-
  Install, update, reload, or verify the Lanes Paseo plugin or GitHub Copilot
  App canvas from an existing full repository checkout. Use when asked to set
  up or troubleshoot a Lanes host integration.
metadata:
  author: Daniel Fosco
  version: "2026.10.21.1"
---

# Install Lanes host integrations

Use this skill when the user asks to install, update, reload, or troubleshoot
the Lanes integration for Paseo or GitHub Copilot App. First identify the
requested host and source. If either is ambiguous, inspect the host's installed
help and ask only for the missing choice. Do not infer a repository URL from a
product rename, unpublished package, local directory, or this skill's own
location.

Authoring or reviewing these instructions does not authorize a live install,
update, reload, removal, migration, credential change, or GitHub publication.
Preserve existing installations and dirty checkouts. Before updating a local
checkout, inspect its remote, current revision, and `git status --short`. Do not
discard changes, reset, clean, or remove an existing runtime to work around a
conflict.

The stable runtime ID is `clips-workspaces`. Keep it unchanged, along with the
Copilot canvas type ID `clips-work`. Installation, host activation, and a
running session loading the intended source are separate states. Report which
state was actually verified.

## Host preflight

Run installation prerequisites on the machine that will execute the install:

```sh
node --version
git --version
npm --version
```

Node.js 22.18 or newer, Git, and npm are required. Paseo installs run on the
selected daemon; Copilot installs must target the actual Copilot App extension
host and user, not an unrelated remote shell. If the current session's host
cannot be confirmed from its runtime metadata, stop before installing and use
a terminal in the target host's context.

## Paseo plugin

Paseo plugin commands target a daemon host. Check the installed CLI before
using unfamiliar options:

```sh
paseo --help
paseo plugin --help
paseo plugin ls clips-workspaces --json
```

Paseo 0.11.2 or newer must be available on both daemon and app, and plugins
must be enabled in Paseo settings. Git, Node.js 22.18+, and npm must be
available on the daemon host. A configured provider is needed to launch agents,
not to browse Lanes records.

Inspect the existing entry before installing or updating. A runtime ID conflict
means an installation already exists; it is not permission to remove or replace
it. Ask before a destructive switch of source.

For an authorized Git installation, use the actual repository selected by the
user or verified for this task, and a reviewed ref:

```sh
paseo plugin add git:<owner>/<repo>:plugins/paseo --ref <reviewed-ref>
paseo plugin ls clips-workspaces --json
paseo plugin logs clips-workspaces
```

The `git:` prefix selects a repository source. This plugin requires the full
Lanes monorepo because it uses the canonical CLI and shared skills; do not copy
or install only `plugins/paseo`. Paseo prepares Git sources with the plugin's
declared locked build commands. An initial `--ref` does not pin future updates.
For a remote daemon, place `--host <target>` before `plugin`:

```sh
paseo --host <target> plugin add git:<owner>/<repo>:plugins/paseo --ref <reviewed-ref>
```

Git, Node, npm, the checkout, and planning repositories must be available on
that daemon host. A local directory path is not uploaded from the client.

For an authorized local directory install, retain a full checkout and prepare
both the root and plugin dependencies from the plugin directory:

```sh
git clone <verified-repository-url> <retained-directory>
cd <retained-directory>
git rev-parse HEAD
cd plugins/paseo
npm ci --prefix ../.. --omit=dev --ignore-scripts
npm ci --omit=dev --ignore-scripts
paseo plugin install "$PWD"
paseo plugin ls clips-workspaces --json
```

If pinning is required, switch to the reviewed full commit before preparing the
dependencies. Directory installation and reload do not run the Git preparation
commands automatically.

For a Git source update, inspect the proposal first, then install only the
reviewed update:

```sh
paseo plugin update clips-workspaces --check
paseo plugin update clips-workspaces --ref <reviewed-commit-sha>
paseo plugin ls clips-workspaces --json
paseo plugin logs clips-workspaces
```

For a directory source, restore the chosen full-checkout revision without
discarding local changes, rerun both dependency commands above, then run:

```sh
paseo plugin reload clips-workspaces
paseo plugin ls clips-workspaces --json
paseo plugin logs clips-workspaces
```

Reload does not install dependencies. Confirm the installed source and daemon
state using `plugin ls` and logs, then inspect the actual Paseo app/workspace
before claiming the integration is usable.

## GitHub Copilot App canvas

Install from a retained **full local clone** of the repository chosen for this
task. Do not copy only `plugins/copilot`, use a generic Copilot plugin install
command, depend on npm publication, or assume the renamed repository already
exists. If no verified source is available, ask for one rather than guessing.

The actual Copilot App must support canvas extensions, and the feature must be
enabled and permitted by the applicable organization policy. A signed-in
Copilot session is needed to use the canvas; the installer itself does not need
Copilot credentials. Git, npm, Node.js 22.18+, and network access to the chosen
repository and npm registry must be available on the extension host.

Before installing from a shell that may be remote, confirm through runtime
metadata that it runs on the machine and user account used by Copilot App.
Resolve the installer's effective directory:

```sh
node -p "JSON.stringify({home: require('node:os').homedir(), copilotHome: process.env.COPILOT_HOME || require('node:path').join(require('node:os').homedir(), '.copilot')})"
```

The output must identify the actual App user's extension directory. Do not
assume that the shell's `HOME` or hostname alone identifies that host. If the
target cannot be verified, use a terminal in the App host's context or stop
instead of installing links into the wrong user directory.

Use a new retained directory instead of replacing an existing or dirty
checkout. Review and record the exact commit; detach to a reviewed full commit
if a reproducible version is required:

```sh
git clone <verified-repository-url> <retained-directory>
cd <retained-directory>
git rev-parse HEAD
# Optional: after reviewing the commit, pin this checkout.
git switch --detach <reviewed-commit-sha>
npm ci --omit=dev --ignore-scripts
node scripts/install-copilot.js
```

The root locked dependencies are required for the canonical CLI and skill
library. The installer verifies the full checkout and root lock, verifies the
canvas build, installs the extension's locked runtime dependencies, then links
the extension and canonical skills into the Copilot user directory. It may
back up existing destinations. Do not bypass prerequisite or source-integrity
errors. Keep the checkout and dependencies in place while using the links;
they refer back to this local source. `COPILOT_HOME` can select an alternate
Copilot directory and `LANES_HOME` can isolate the install receipt.

By default, the extension link is `~/.copilot/extensions/clips-workspaces`
and the canonical skill links are under `~/.copilot/skills/`, including
`~/.copilot/skills/lane-plugin`. With `COPILOT_HOME` set, these destinations
are rooted under that directory instead.

An installation does not load an extension into an already-running App session
or open a canvas. In the actual session that should use the integration:

Start a **new Copilot session** after installation to verify skill discovery;
confirm `lane-plugin` appears in that session's skill catalog, then open the
canvas. `extensions_reload` reloads extensions, not the skill catalog, and is
not proof that the refreshed skill is discoverable.

For an extension code update in an existing session, reload extensions with the
available `extensions_reload` tool or that session's supported reload API, then
reopen the same `clips-work` canvas instance. Where available, inspect the
loaded runtime's source/hash and session metadata (for example,
`inspect_clips_runtime`) against the retained checkout before claiming that
the intended revision is active.

A different session cannot reload the actual App session. Refreshing a canvas
is not a reload and does not prove that changed code is loaded. If the host
does not expose the required reload or inspection capability, report that
limitation separately from successful local installation.

For an authorized update, preserve the current checkout and commit first. A
clean checkout can be fast-forwarded or switched to a reviewed full commit,
then the root install and `node scripts/install-copilot.js` can be repeated.
Close affected sessions before changing an in-use checkout: installed links
follow in-place source changes. Use the installer's `--rollback` only when
requested; it restores paths recorded by the current installation receipt, not
the source files, dependencies, canvas data, or a running session.

## Errors and scope

Use command help and host output as evidence. If the host, source, credentials,
network, locked dependencies, or destination is unavailable, report the
specific blocker rather than inventing a command or claiming partial success.
Do not request or print credentials. Do not publish, migrate, remove, or change
unrelated user configuration as part of plugin setup.
