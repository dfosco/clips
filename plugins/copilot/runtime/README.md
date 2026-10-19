# Copilot runtime adapter

`index.mjs` exports `createClipsRuntime(options)`. The returned adapter implements
the canvas contract (`listBoard`, `viewRecord`, `recordCommand`, `listSessions`,
`launchRecord`, `steerSession`, and `appSessionUrl`) plus host capability and
cleanup helpers. Board and record operations invoke the canonical Clips CLI in
the selected repository. The adapter does not read or write `.clips` journals.

## Host configuration and verified actions

The runtime creates an SDK client lazily. `COPILOT_HOME` is passed through to the
SDK's documented `baseDirectory` option and stores user-local adapter state under
`$COPILOT_HOME/clips-runtime` (default `~/.copilot/clips-runtime`).
`CLIPS_CLI_PATH` can identify the maintained `src/cli.js` or an installed `clips`
executable. An embedding application can also pass `cliPath`.

Session list, launch, and steer controls remain disabled until the user has
confirmed that an actual SDK session opens in and can be steered from the native
Copilot App. After that real check, the embedding host can call:

```js
await runtime.recordHostVerification({
  appVersion: "<observed app version>",
  sessionId: "<actual SDK session ID opened and steered in the app>",
  verifiedBy: "<user identity>",
  openedInApp: true,
  steeredInApp: true,
});
```

This writes a mode-0600 user-local capability record. The method checks that the
session ID exists in the SDK catalog, but the App observations and verifier are
asserted metadata, not cryptographic proof. No such verification has been made
for this development candidate. The canvas should read
`runtime.hostCapabilities()` or the `appSessionVisibilityVerified` result from
`listSessions` and display disabled controls while it is false.

The current SDK does not expose a Copilot App host ID. Lane Manager creation
therefore requires an explicit `options.hostId` or `CLIPS_COPILOT_HOST_ID` value
from a future supported host context. The adapter marks that source as configured
and unauthenticated; it does not substitute a hostname. Without the value, Lane
claim/launch is rejected before creating a session. Claims otherwise use the
actual SDK session ID and canonical `clips lane manager` revision-checked CLI
commands.

The SDK's session catalogue exposes context, timestamps, and a summary, but not
running/idle/attention state. Session status is always `unknown`; consumers must
not derive execution state from timestamps or summaries. The public API exposes
no Copilot App worktree allocator. New sessions use the selected project path as
their `workingDirectory`, so this adapter does not claim isolated workspaces.
Model and reasoning settings are passed only when the caller explicitly supplies
them; otherwise SDK defaults remain in effect. This does not inherit the App's
current selected model or mode because no documented getter is available.

Record bindings are a separate, mode-0600 user-local index. Each binding records
the canonical Git common directory, full Clips ref and kind, plus the actual SDK
session ID. It lets the adapter avoid unrelated sessions; it is not a Clips
record and is not treated as authenticated host metadata. Claimed manager reuse
requires both this binding and matching observed SDK Git context. Missing or
conflicting evidence fails closed.

Per-record launches are serialized across adapter processes with an exclusive
user-local lock held through prompt delivery. A process crash leaves the lock
in place; first verify that no launch is active, then remove that exact lock to
recover. The adapter never guesses whether a recorded lock is stale.
