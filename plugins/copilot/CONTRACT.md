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
- The SDK session catalog provides IDs, timestamps, local/remote state, and
  working-directory/Git context. It does not expose a documented App worktree
  allocator or a public getter for the current App session's selected model,
  reasoning, or mode. The host adapter must not invent those values. Omitted
  model settings preserve runtime defaults; any unavailable per-session host
  settings remain explicit until demonstrated by the actual App.
- GitHub documents `ghapp://session/new?...` for prefilled app sessions, but
  it does not expose a returned session ID before the prompt is submitted. This
  is not sufficient by itself for claim-before-prompt manager acquisition.

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
Lane claims use `clips lane manager` commands with configured observed Copilot
host/session identities and revision checks.

The canvas (t03) owns the renderer, local bridge, and `createCanvas` declaration.
Its human UI and agent-callable actions call the same runtime adapter methods.
The bridge uses one ephemeral loopback server per extension process and an
unpredictable token; no canvas action accepts arbitrary shell commands.

Per-open-canvas focus uses the host-provided `instanceId`, with its data stored
under Copilot's user-local data root. The instance ID is hashed before it is
used in a filename. Board content remains canonical Clips state. Search,
filters, menus, and in-flight launch state are not persisted as focus.

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
  writer. It waits for the #g021 owner to release the shared Git/index/reload
  window before taking it.

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
