# Clips Copilot integration contract

This integration adds a user-scoped GitHub Copilot App canvas extension while
using the existing Clips CLI, record store, and Lane claim library as the
authoritative work state. It does not create a second board database or
reimplement Clips lifecycle rules.

## Supported Copilot surfaces

- Canvas extensions are user-scoped under `~/.copilot/extensions/<name>` and
  project-scoped under `.github/extensions/<name>`. A user-scoped extension
  commonly contains `package.json` and `extension.mjs`.
- Copilot CLI extensions use the public `@github/copilot-sdk/extension` entry
  and `joinSession({ canvases: [createCanvas(...)] })`. A canvas declares an
  `open` callback that returns a renderer URL and named action handlers.
- Canvas open/action callbacks receive the actual Copilot `sessionId`, a stable
  caller-supplied `instanceId`, and the session working directory when known.
  Reopening an existing instance focuses it. The canvas protocol is marked
  experimental by the current Node SDK; keep it behind an adapter and report
  host/API failures directly.
- The local Copilot SDK supports independent sessions through
  `CopilotClient.createSession`, `resumeSession`, `listSessions`,
  `getSessionMetadata`, and `session.send`. The Copilot App is built on Copilot
  CLI, and its documented app link opens an app-local session at
  `ghapp://sessions/<session-id>`. The checked integration must still verify
  that an SDK-created session appears in the installed App before claiming
  native navigation.
- The separate SDK catalog provides saved session IDs and Git context. It is
  optional navigation metadata, not the native App connection. Its failure must
  not prevent canonical board/focus operations or current-session sends.
- The actual `joinSession()` handle supplies current-session public RPCs:
  `metadata.snapshot()`, `metadata.activity()`, `model.getCurrent()`,
  `mode.get()`, and `workspaces.getWorkspace()`. Read these without changing the
  host-selected settings. Model/reasoning, activity and workspace ID are shown
  when returned; unavailable fields remain unknown. Workspace artifact paths
  are not the working directory. `metadata.getClientMetadata()` and
  `updateClientMetadata({set})` support namespaced client-owned record bindings.
- Joining proves a connection to the foreground CLI session. It does not prove
  native App visibility or parentage. Native App session tools separately expose
  creation, creator/coordinating-creator metadata and cross-session messaging.
  Use those tools for steerable coordinated children; do not infer their success
  from a canvas send. Host identity is optional metadata, not a management gate.
- GitHub documents `ghapp://session/new?...` for prefilled app sessions, but
  it does not expose a returned session ID before the prompt is submitted. This
  is not proof that a session was created or a prompt delivered.

## Provider/consumer interfaces

The runtime adapter (t02) owns these host-facing operations:

```ts
type ClipsRuntime = {
  listBoard(projectPath: string): Promise<Board>;
  viewRecord(ref: string, projectPath: string): Promise<Record>;
  recordCommand(args: string[], projectPath: string): Promise<JsonValue>;
  listSessions(projectPath: string): Promise<CopilotSessionSummary[]>;
  launchRecord(input: LaunchRecordInput): Promise<CopilotSessionSummary>;
  steerSession(sessionId: string, prompt: string): Promise<void>;
  appSessionUrl(sessionId: string): string;
};
```

`recordCommand` is constrained to supported `node src/cli.js`/`clips` commands
and validates allowed command families. It must not write `.clips` journals
directly. The canvas currently needs the supported `lane create`, `lane update`,
`lane status`, `<lane> add <goal...>`, `label list/create/edit/recolor/delete`,
and `label add/remove` commands as well as Goal/Task create/update/status/accept
and Lane manager operations. Keep the allowlist and canvas dispatch aligned
with `node src/cli.js lane --help`, `label --help`, `goal --help`, and
`task --help`; do not use near-synonym commands such as `label attach/detach`.
Optional Lane claims use `clips lane manager` commands with observed actor
identities and revision checks. They do not authorize or block ordinary planning,
record mutations or sends. No host identity is fabricated to create metadata.

The canvas (t03) owns the renderer, local bridge, and `createCanvas` declaration.
Its human UI and agent-callable actions call the same runtime adapter methods.
The bridge uses one ephemeral loopback server per extension process and an
unpredictable token; no canvas action accepts arbitrary shell commands.

Per-open-canvas project selection is keyed by the actual session and instance.
Focus also includes the selected absolute project path. User-local files hold
only navigation state. Reload with the same identities restores it; different
sessions/projects cannot share focus merely because their instance IDs match.
Legacy instance-only files are not imported because their owner is ambiguous.
An explicit project input or saved user selection takes precedence over the
host working directory. A missing store produces an actionable error for that
project; it never substitutes the Clips source checkout or initializes a store.

Agent callers use `list_clips_projects` to read the same canonical local-user
catalog as the UI chooser, then pass an exact returned `projectId` to
`select_clips_project`. Selection revalidates that ID and fails without a
fallback if it is stale. Arbitrary `projectPath` selection is not accepted.

## Execution and reload

`launchRecord` is retained as an adapter method name for compatibility. It sends
work to the exact joined handle and never creates a separate SDK session. The
UI says “Send work to this session.” Explicit sends do not require a host ID,
claim, exclusive role, idle status or previous binding. Existing-session
navigation remains available alongside Send/Run. No automatic claim mutation or
durable exclusive launch lock occurs. One adapter orders metadata/send operations;
the service suppresses duplicate Task clicks only while that request is pending.
Binding to a Goal/Task patches only Clips client-metadata keys and reads them
back where supported. Historical per-record associations remain available.
Model/mode settings remain untouched. Canonical journal locks, atomic storage,
stale-revision conflict checks, authentication and exact action-target validation
are data-integrity protections and remain enforced.

JavaScript Clips entry points use a verified Node 18+ executable, not the
packaged Copilot process executable. `CLIPS_NODE_PATH` can select an installed
interpreter; `CLIPS_CLI_PATH` selects a CLI entry point. The optional catalog
runtime uses the locked extension-relative platform executable through public
`RuntimeConnection.forStdio({path})`, including Linux musl package selection.
The installer verifies its wrapper and runtime.node before and after linking.

After source changes, use `extensions_reload` from the same Copilot session,
or `session.rpc.extensions.reload()` through its actual joined host connection.
A separate SDK resume is a separate runtime and cannot stand in for that host.
Then reopen the same canvas instance to load its compiled React/Primer renderer. The closed app.js/style.css asset pair has independently authenticated URLs and source/build hashes verified by the installer. Project tabs replace the original Board strip and are the sole selector, without a chooser modal. They read canonical local-user registry entries, accept exact discovered IDs and revalidate the selected common Git/worktree store without substituting a stale selection. Initial defaults prefer the registered current repository, otherwise the first available project. A separate Initialize action targets only the actual session Git root with no store, using minimal `clips init --store-only`, never a selected tab's directory. The canvas's
Refresh button rereads data only; it does not reload provider modules.
`inspect_clips_runtime` reports hashes captured when the runtime/service modules
loaded, actual process/interpreter paths and joined-session readback. Inspect
that response before treating a source-linked install as activated. It is
read-only and does not verify App visibility by assertion.

## Task boundaries

- t01: this contract, official API and local installation evidence.
- t02: `plugins/copilot/runtime/**` and `plugins/copilot/package.json`; canonical
  Clips command adapter, actual Copilot SDK session operations, and tests.
- t03: `plugins/copilot/extension.mjs` and `plugins/copilot/canvas/**`; canvas
  UI, actions, bridge, per-instance navigation, and tests. It consumes t02's
  exports and does not change its package manifest.
- t04: `plugins/copilot/skills/**`, `scripts/install-copilot.js`,
  `src/lib/copilot-install.js`, and installer tests. It links existing
  canonical Clips/Lane Manager skills rather than copying their policy.
- t05: independent review/tests only; it does not edit product sources.
- t06: sole integrated verifier, Git/index/reload coordinator, and record
  writer. It exclusively owns the released Git/index/install/reload
  window; independent review remains read-only.

## Evidence limits

The local machine has Copilot CLI 1.0.98 and the matching published Node SDK
1.0.22. GitHub Copilot App 1.1.30 is installed at
`/Applications/GitHub Copilot.app`; the official Apple Silicon disk image and
installed bundle passed code-signature and notarization checks. Extension
activation and native canvas/session behavior are integration evidence tracked
by #g022#t06, not inferred from the app's presence or valid signature. App
visibility and steerability of SDK-created sessions remain unverified until
the public canvas/session paths are checked through supported CLI/API
mechanisms.

## Primary references

- https://docs.github.com/en/copilot/concepts/copilot-surfaces/github-copilot-app
- https://docs.github.com/en/copilot/get-started/quickstart-copilot-app
- https://docs.github.com/en/copilot/get-started/sdk-quickstart
- https://docs.github.com/en/copilot/how-tos/github-copilot-app/working-with-canvas-extensions
- https://docs.github.com/en/copilot/how-tos/github-copilot-app/customize-github-copilot-app
- https://docs.github.com/en/copilot/how-tos/github-copilot-app/agent-sessions
- https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/github-copilot-app/open-with-deep-links
- https://github.com/github/awesome-copilot/blob/main/extensions/chromium-control-canvas/extension.mjs
- https://github.com/github/copilot-sdk/tree/main/nodejs
