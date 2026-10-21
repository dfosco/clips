# Lanes for GitHub Copilot

This repository ships a Copilot App canvas extension and shared Lanes skills.
Install from a **complete Lanes checkout or extracted npm package**. The extension calls that directory's
canonical `src/cli.js` and links its canonical skills. Copying only
`plugins/copilot` omits required source and dependencies.

This is a repository-installed canvas extension, not a marketplace submission.
`copilot plugin install dfosco/lanes:plugins/copilot` is not a supported setup
command: generic plugin installation does not provision this package's full
canonical CLI, skills, locked SDK runtime, or user extension links.

## Requirements

- Git, npm, and Node.js **22.18 or newer** on the machine running Copilot.
  Node must remain available to the extension host. Set `LANES_NODE_PATH` to
  an absolute Node executable if the App's PATH cannot find it.
- GitHub Copilot App with canvas extensions enabled, an authenticated Copilot
  session, and any required organization permission to use extensions/skills.
  Installation itself needs no Copilot credentials and performs no login.
- Network access to GitHub for cloning and the npm registry for locked packages.
  Do not omit optional dependencies. The SDK is pinned to **1.0.22**, whose
  package declares Copilot CLI **1.0.98**. Existing host investigation used App
  **1.1.30**. These are the investigated versions, not a promise that every
  newer or older host is compatible. The public SDK canvas API is experimental.
- The SDK lock contains macOS, Linux glibc, Linux musl, and Windows packages for
  x64/arm64. The installer selects the current platform and verifies the matching
  SDK version, executable, and `runtime.node`. Distribution checks here run on
  macOS arm64. Other platforms are not runtime-validated by those checks;
  Windows additionally requires permission to create directory symlinks.

## Install from the repository

```sh
git clone https://github.com/dfosco/lanes.git lanes-copilot
cd lanes-copilot
# Record this commit; use a reviewed full commit SHA for a reproducible install.
git rev-parse HEAD
npm ci --omit=dev --ignore-scripts
node scripts/install-copilot.js
```

For a published release, extract its complete package into a retained directory
instead of cloning. After 2.0.0 is published:

```sh
mkdir lanes-copilot-2.0.0
cd lanes-copilot-2.0.0
npm pack @dfosco/lanes@2.0.0
tar -xzf dfosco-lanes-2.0.0.tgz
cd package
npm ci --omit=dev --ignore-scripts
node scripts/install-copilot.js
```

Keep the tarball checksum as the installation identity. The included root
`npm-shrinkwrap.json` and plugin `package-lock.json` provide the same locked
dependency checks as the source route. No Git checkout is required for this
package installation. Git is still required for repositories managed by Lanes.

To pin a chosen version, run `git switch --detach FULL_COMMIT_SHA` after cloning,
replacing `FULL_COMMIT_SHA` with the reviewed commit, before either install step.
The private extension package remains version `0.1.0`; identify repository
installations by commit as well as package version. This route does not use the
published npm Lanes CLI or require a global install or `npm link`.

The installer first checks Node and loads the checkout CLI with its locked
root production dependencies. It then verifies the committed canvas source and
asset hash manifest and runs the extension's own
`npm ci --omit=dev --include=optional`. It checks the selected SDK runtime before
and after linking. Missing CLI imports/dependencies, stale assets, unsupported
platforms, and missing runtime files fail before an extension is exposed.

It installs these user-scoped directory links:

| User path | Source in the retained checkout |
| --- | --- |
| `~/.copilot/extensions/clips-workspaces` | `plugins/copilot` |
| `~/.copilot/skills/lanes-copilot` | `plugins/copilot/skills/lanes-copilot` |
| `~/.copilot/skills/lanes` | `.agents/skills/lanes` |
| `~/.copilot/skills/lane-manager` | `.agents/skills/lane-manager` |
| `~/.copilot/skills/lane-dev` | `.agents/skills/lane-dev` |
| `~/.copilot/skills/lane-radar` | `.agents/skills/lane-radar` |
| `~/.copilot/skills/lane-plugin` | `.agents/skills/lane-plugin` |

Existing paths are backed up under the resolved Lanes user directory's
`copilot-backups`. A private receipt is written there as
`copilot-workspaces-install.json`. Settings, credentials,
existing sessions, and workflow records are not rewritten. `COPILOT_HOME` and
`LANES_HOME` override the user directories for isolated installation/testing.
`CLIPS_HOME` remains a fallback for `LANES_HOME`; populated legacy `~/.clips`
homes remain readable until explicit migration. `LANES_CLI_PATH`,
`LANES_NODE_PATH` and `LANES_COPILOT_HOST_ID` similarly take precedence over
their `CLIPS_*` aliases.
Persisted extension/canvas IDs, protocol keys and selection hashes retain their
`clips-*` identities so existing sessions and selections remain reachable.
Keep the checkout and its installed dependencies in place while using the links.
The installer replaces the extension checkout's `node_modules` through `npm ci`.

GitHub documents direct extension discovery under `~/.copilot/extensions` and
project extensions under `.github/extensions`; this installer uses user scope.
It does not create a canvas in a running session. Start a new Copilot session,
ask it to open **Lanes**, and check that `lanes`, `lane-manager`, `lane-dev`,
`lane-radar`, `lane-plugin`, and `lanes-copilot` appear in its skills. Select an existing Lanes project. To create
one, run this checkout's `node /path/to/lanes-copilot/src/cli.js init` from that
project first, or use Initialize for the current session's Git directory.
Initialize uses `init --store-only`; it does not install skills or change editor
settings. Installation itself does not initialize stores or trust projects.

## Update and rollback

For an in-place update of a clean branch checkout:

```sh
git rev-parse HEAD
git pull --ff-only
npm ci --omit=dev --ignore-scripts
node scripts/install-copilot.js
```

For a pinned checkout, fetch and switch to the chosen full commit instead of
pulling, then repeat both installation commands. Record the previous commit.
Links follow in-place source changes immediately, so close affected sessions
before changing an installed checkout. For a retained previous version, clone
into a separate directory, pin it, and install from there. Each checkout keeps
its own dependencies; the installer backs up the previous links when switching.

After either update, call `extensions_reload` in the **actual Copilot session**
(or its joined `session.rpc.extensions.reload()`), then reopen the same canvas
instance. A separate SDK session cannot reload the App's provider. Refresh only
rereads data. `inspect_clips_runtime` reports loaded module hashes, interpreter
and session metadata; compare them with the intended checkout before assuming
new source is active.

```sh
node scripts/install-copilot.js --rollback
```

Rollback restores the local paths displaced by the current installation receipt.
It refuses to overwrite targets that were independently replaced. Repeated
installation from the same checkout preserves its original backups. Switching
to a separate checkout allows one rollback to restore the previous checkout's
links. The receipt is consumed by rollback; this is not a multi-version history
manager. Retain both checkouts while using this rollback. Restored links are
outside the consumed receipt; inspect them before any later manual removal.
Rollback does not rewind files/dependencies changed in place, undo canvas data,
or reload a live session. To revert an in-place update, switch back to the
recorded commit and rerun both install commands, then reload/reopen.

## Build and validation

The committed `canvas/dist/{app.js,style.css,build-manifest.json}` is the closed
renderer artifact. Ordinary repository installation uses it directly and does
not need Vite. Maintainers changing build inputs must regenerate it:

```sh
npm ci --include=dev --ignore-scripts
npm ci --include=dev --include=optional --prefix plugins/copilot
npm run build --prefix plugins/copilot
npm run check:build --prefix plugins/copilot
npm test --prefix plugins/copilot
```

Lane, Goal, and Task cards show supported attachment titles and types. External
links are restricted to safe HTTP(S) URLs. Markdown content is read only when
requested, against the exact selected record and attachment, so edits and
missing files are reflected rather than cached as snapshots. Markdown is rendered
as text and a limited set of formatting; HTML and remote content are not executed
or fetched. The project-local GitHub collaboration control changes only local
configuration and does not publish. When enabled, later supported record
mutations may sync automatically.

The canvas uses canonical Lanes records and the current joined session. A valid
install or source/build hash proves distribution closure, not native App
activation, visibility, or full session parity. App session
creation/parentage and other-session steering remain subject
to the limits in [CONTRACT.md](CONTRACT.md) and [canvas/PARITY.md](canvas/PARITY.md).
The canvas requires no host identity, Lane claim, exclusive role or prior binding
to coordinate work. Claims and associations are optional metadata; sends do not
mutate claims. Exact targets, authentication, atomic storage and revision checks
remain enforced. See [the advisory policy](runtime/README.md#optional-host-and-claim-metadata).
Native App tools support steerable coordinated child sessions independently of
the canvas's current-session send adapter.

Official host contracts checked for this setup:
[canvas structure and scope](https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions),
[App customization](https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app),
and [plugin formats and install specifications](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference).
