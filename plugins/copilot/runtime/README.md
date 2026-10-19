# Copilot runtime adapter

`createClipsRuntime` supplies canonical board/record commands, saved-session
navigation, joined-session work delivery and read-only diagnostics. All Clips
mutations use the checkout CLI in the explicitly selected Git project. No
adapter writes workflow journals or chooses the source repo as a fallback.

## Interpreter and dependency resolution

`CLIPS_CLI_PATH` selects `src/cli.js` or an installed executable. JS entry points
run through a verified Node 18+ executable. The packaged Copilot extension
executable is not Node; it is never reused merely because it is process.execPath.
`CLIPS_NODE_PATH` selects a specific interpreter. Otherwise discovery checks an
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
A manager cannot receive dev work in the same session. Dev sessions cannot be
silently reassigned. Canonical policy permits a manager to hold several Lane
claims. Per-record and per-session locks serialize local sends; crash locks
require checking the recorded process before removing that exact stale lock.

Current-session metadata, activity, model/reasoning and workspace come from
public `session.rpc.metadata.snapshot/activity`, `model.getCurrent`, and
`workspaces.getWorkspace`. Mode comes from the metadata snapshot. Missing RPCs
or fields remain unavailable. These getters do not alter settings. Goal/Task
binding uses exact `clips/ref`, `clips/project`, `clips/kind` client metadata with
readback where available, plus a private mode-0600 local index under
`$COPILOT_HOME/clips-runtime`. Unrelated metadata is preserved.

Joining demonstrates send capability, not App visibility or top-level
parentage. `canSendToCurrentSession` and `appSessionVisibilityVerified` are
separate. Historical `recordHostVerification` records apply only to the exact
session checked; they never enable sidecar steering. Other sessions are navigation-only until their own canvas joins them. No verification record is manufactured by joining. Other
session status is unknown. The public API does not provide verified top-level
App dev creation or an App host ID. Lane claims require a configured, actually
observed host ID; no hostname or invented capability substitutes for it.

## Reload and evidence

After source edits, call `extensions_reload` in the actual Copilot session, or
`session.rpc.extensions.reload()` on that joined connection. Then reopen the
same Clips Work canvas instance. Refresh only rereads data from loaded code.
The `inspect_clips_runtime` action reports loaded module hashes, actual
process/interpreter identity, current metadata and bindings. Successful
source installation alone is not successful native activation.
