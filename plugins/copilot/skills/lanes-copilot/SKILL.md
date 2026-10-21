---
name: lanes-copilot
description: Use Lanes in GitHub Copilot App with canonical records, advisory management metadata and steerable coordinated child sessions.
---

# Lanes in GitHub Copilot App

Install from a complete maintained repository checkout with Node.js 22.18+.
First run `npm ci --omit=dev --ignore-scripts` at its root, then install or
update its local extension and shared skill links with
`node scripts/install-copilot.js`. See `plugins/copilot/README.md` in that
checkout for pin/update/rollback requirements. Generic plugin install does not
provision the canonical CLI/skills/extension closure. The installer checks the
canonical CLI and its root runtime dependencies, then runs the extension's locked
production dependency install (`npm ci --omit=dev --include=optional`) before exposing the source
links. GitHub documents user-scoped extensions under `~/.copilot/extensions`;
the installer places the extension at
`~/.copilot/extensions/clips-workspaces` and links guidance at
`~/.copilot/skills/{lanes,lane-manager,lane-dev,lane-radar,lanes-copilot}`. It does not change
Copilot settings or start the extension. After source updates, run
`extensions_reload` in the actual Copilot session, then reopen the same canvas
instance. An extension can use its public `session.rpc.extensions.reload()`;
a separate SDK resume does not reload the App's live provider. Refresh only
rereads data. Use `inspect_clips_runtime` to check loaded module hashes,
interpreter and actual session metadata, then verify board/focus operations.
To restore the prior local paths, run
`node scripts/install-copilot.js --rollback`. The installer receipt is kept at
`copilot-workspaces-install.json` in the resolved Lanes user directory
(`LANES_HOME`, then `CLIPS_HOME`, then the populated default `.lanes`/`.clips`).

Before planning or coordinating Lanes work, read the canonical
`lanes` and `lane-manager` skills from `~/.copilot/skills/` (or their maintained
checkout at `.agents/skills/`). They define the shared record, task, coordination,
parallelism, and acceptance policy. This host skill only explains how to apply
that policy in Copilot. Do not copy or override it here.

Use the Lanes CLI and its resolved `.lanes` or legacy `.clips` store for Goals, Tasks, Lanes,
claims, and receipts. Treat Copilot canvas state as navigation state only. Never
edit Lanes journals directly or create a second board database.

## Session targets and advisory associations

- A Copilot SDK session is a real Copilot CLI session with its own session ID.
  Do not describe it as a GitHub Copilot App session until the installed App
  lists it and `ghapp://sessions/<session-id>` opens that same session.
- Verify the actual session, working directory, Git root, project, record
  reference, and record kind from observed SDK/App data before associating work.
  A session ID alone does not prove its Lanes binding.
- Keep implementation work in an actual user-visible, steerable App session.
  Native `create_session` supports coordinated children; keep
  `coordinate_with_creator: true` and use `send_session_message` for parent/worker
  communication. Inspect the actual returned session with `get_session` and
  session listings. Do not confuse an idle creation handle with its later active
  session ID. Honor the user's workspace and child-session choices.
- Public hook inputs can include optional `agentId`, `agentType`, and
  `parentAgentId`. A missing parent ID can also mean an older runtime; it does
  not prove a top-level session. Native App `get_session` can expose creator and
  coordinating-creator IDs separately from SDK hook metadata. An independently
  created SDK session does not prove App visibility or steerability.
- Preserve the selected App session's model and permissions. The public SDK
  does not expose a documented getter for every App session setting. Do not
  guess or overwrite unavailable settings; report which settings the SDK
  actually exposes.
- Host identity, Lane claims, manager roles and prior work associations are
  optional advisory metadata. Missing identity, another manager's claim or an
  existing association must not block planning or an explicitly requested send.
  Do not claim a Lane automatically or fabricate attribution to get started.
  The explicit `lane manager` commands retain truthful actor, revision and
  non-destructive history requirements when the user chooses to update metadata.
- Existing-session navigation and an explicit Send/Run may coexist. Avoid
  duplicate engineering work through communication and Task/write boundaries,
  not exclusive launch locks. Preserve historical claims and associations.
  Retain atomic writes, canonical journal locks, stale-edit conflict detection,
  authentication, credential safeguards and accurate action targets.
- The ordinary developer updates the same canonical Goal/Task with actual
  implementation status, result, source/test evidence, and relevant user-facing
  behavior. Record unperformed App validation as unperformed. The Lane Manager
  assesses Goal task coverage and assigns complete outcomes. Follow its documented
  linear fallback only when the host has no delegation primitive.

## Canvas focus

Focus is scoped to the actual Copilot session, open-canvas instance and selected project. Project selection is scoped to session and instance. Keep separate
focus for separate open canvases and users. Store only the selected record/Lane;
the canonical CLI remains authoritative for record contents and status.

The canvas sends work to its current joined session; it does not create a new
App dev session. Separate manager and implementation sessions are useful
coordination guidance, not a runtime permission restriction.
Current public RPCs expose `metadata.snapshot/activity`, `model.getCurrent`,
`mode.get`, and `workspaces.getWorkspace`. Read actual results without changing
settings. Joining alone proves neither App visibility nor top-level parentage.
If Node cannot be found by the packaged extension, set `LANES_NODE_PATH` (legacy
`CLIPS_NODE_PATH`) to an
installed Node 18+ executable and reload. Never pass `src/cli.js` to Copilot as
though its packaged process.execPath were a Node interpreter.
