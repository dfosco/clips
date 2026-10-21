# Copilot runtime adapter

`createClipsRuntime` supplies canonical board/record commands, saved-session
navigation, joined-session work delivery and read-only diagnostics. All Lanes
mutations use the checkout CLI in the explicitly selected Git project. No
adapter writes workflow journals or chooses the source repo as a fallback.

## Interpreter and dependency resolution

`LANES_CLI_PATH` (legacy `CLIPS_CLI_PATH`) selects `src/cli.js` or an installed executable. JS entry points
run through a verified Node 18+ executable. The packaged Copilot extension
executable is not Node; it is never reused merely because it is process.execPath.
`LANES_NODE_PATH` (legacy `CLIPS_NODE_PATH`) selects a specific interpreter. Otherwise discovery checks an
npm-provided Node, a Node host, PATH, and conventional system installation paths.
An invalid explicit setting fails with a repair instruction.

The SDK client is a lazily started, metadata-only catalog sidecar. The App
redirects SDK imports to its bundle; its default runtime search cannot see this
extension's optional platform package. Supply the locked extension-relative
executable through `RuntimeConnection.forStdio({path})`. Catalog failures become
warnings and do not suppress the board or replace the joined session.

## Current-session behavior and limits

The extension injects the actual `joinSession()` handle. `launchRecord` sends to
that handle after verifying the project and exact record. It creates no session.
Host identity, manager roles, Lane claims and previous record associations are
advisory. An explicit send can select another record without a claim, idle-state
requirement or exclusive launch lease. Sends on one adapter are queued to keep
client-metadata updates and delivery ordered; no durable launch lock is created.
Historical launch-lock files are not consulted or deleted.

Current-session metadata, activity, model/reasoning and workspace come from
public `session.rpc.metadata.snapshot/activity`, `model.getCurrent`, and
`workspaces.getWorkspace`. Mode comes from the metadata snapshot. Missing RPCs
or fields remain unavailable. These getters do not alter settings. Goal/Task
association uses exact `clips/ref`, `clips/project`, `clips/kind` client metadata with
readback where available, plus a private mode-0600 local index under
`$COPILOT_HOME/clips-runtime`. Client metadata describes the latest selected
Goal/Task; per-record local associations and unrelated metadata are preserved.

Joining demonstrates send capability, not App visibility or top-level
parentage. `canSendToCurrentSession` and `appSessionVisibilityVerified` are
separate. Historical `recordHostVerification` records apply only to the exact
session checked; they never enable sidecar steering. Other sessions are navigation-only until their own canvas joins them. No verification record is manufactured by joining. Other
session status is unknown. Native App tools can create and communicate with
steerable coordinated child sessions; the canvas adapter does not implement
those tools or infer their success from a joined send.

## Optional host and claim metadata

No host identity lookup or configuration is required to plan, coordinate or send
work. The extension does not read native App credentials to unlock management.
`options.hostId` and `LANES_COPILOT_HOST_ID` (legacy `CLIPS_COPILOT_HOST_ID`) can supply optional metadata; absent
identity remains null and `hostIdentityAuthenticated` remains false.

The explicit `lane manager` CLI commands remain an opt-in metadata API with
truthful actor fields and revision-checked, non-destructive history. Sends
neither claim nor release Lanes. Existing claims are shown, not enforced as
permission. Canonical journal locks, atomic writes, stale-revision rejection,
authenticated transport and exact project/record/session checks remain required.

## Reload and evidence

After source edits, call `extensions_reload` in the actual Copilot session, or
`session.rpc.extensions.reload()` on that joined connection. Then reopen the
same Lanes canvas instance. Refresh only rereads data from loaded code.
The `inspect_clips_runtime` action reports loaded module hashes, actual
process/interpreter identity, current metadata and bindings. Successful
source installation alone is not successful native activation.
