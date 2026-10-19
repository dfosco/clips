---
name: clips-copilot
description: Use the Clips Lane Manager canvas in GitHub Copilot App while preserving canonical Clips workflow and ownership rules.
---

# Clips in GitHub Copilot App

Install or update the maintained checkout's local extension and shared skill
links with `node scripts/install-copilot.js`. It runs the extension's locked
production dependency install (`npm ci --omit=dev --include=optional`) before exposing the source
links. GitHub documents user-scoped extensions under `~/.copilot/extensions`;
the installer places the extension at
`~/.copilot/extensions/clips-workspaces` and links guidance at
`~/.copilot/skills/{clips,lane-manager,clips-copilot}`. It does not change
Copilot settings or start the extension. After source updates, run
`extensions_reload` in the actual Copilot session, then reopen the same canvas
instance. An extension can use its public `session.rpc.extensions.reload()`;
a separate SDK resume does not reload the App's live provider. Refresh only
rereads data. Use `inspect_clips_runtime` to check loaded module hashes,
interpreter and actual session metadata, then verify board/focus operations.
To restore the prior local paths, run
`node scripts/install-copilot.js --rollback`. The installer receipt is kept at
`~/.clips/copilot-workspaces-install.json` (or under `$CLIPS_HOME`).

Before planning or coordinating Clips work, read the canonical
`clips` and `lane-manager` skills from `~/.copilot/skills/` (or their maintained
checkout at `.agents/skills/`). They define the shared record, task, ownership,
parallelism, and acceptance policy. This host skill only explains how to apply
that policy in Copilot. Do not copy or override it here.

Use the Clips CLI and its canonical `.clips` store for Goals, Tasks, Lanes,
claims, and receipts. Treat Copilot canvas state as navigation state only. Never
edit Clips journals directly or create a second board database.

## Session and task ownership

- A Copilot SDK session is a real Copilot CLI session with its own session ID.
  Do not describe it as a GitHub Copilot App session until the installed App
  lists it and `ghapp://sessions/<session-id>` opens that same session.
- Verify host session identity, working directory, Git root, project, record
  reference, and record kind from observed SDK/App data before associating work.
  A session ID alone does not prove its Clips binding.
- Keep implementation work in the actual steerable top-level session. Do not
  claim that this integration can create or steer child agents. If the current
  host cannot establish the requested top-level ownership or steerability,
  surface that limit and hand off the complete work contract for a top-level
  Copilot App session to continue.
- Public hook inputs can include optional `agentId`, `agentType`, and
  `parentAgentId`. A missing parent ID can also mean an older runtime; it does
  not prove a top-level session. No authoritative existing-App-session
  parentage getter or verified top-level App dev creation/readback is exposed.
  An independently created SDK session does not prove top-level Copilot App
  visibility or steerability. Verify the actual session in the App and retain
  the parentage limitation when supported evidence is unavailable.
- Preserve the selected App session's model and permissions. The public SDK
  does not expose a documented getter for every App session setting. Do not
  guess or overwrite unavailable settings; report which settings the SDK
  actually exposes.
- For Lane Manager work, inspect the canonical claim and use the actual host,
  runtime, and session identity. Claim an unowned Lane before management;
  reuse the current session's claim for current-session sends. A conflict or missing
  identity blocks management and takeover. Engineering contributions may
  proceed without owning the Lane, subject to coordination with its manager.
- A running record should navigate to its observed session. Do not launch a
  duplicate. An idle claimed Lane Manager remains the owner's session; do not
  replace it because it is idle or unavailable.
- The ordinary developer updates the same canonical Goal/Task with actual
  implementation status, result, source/test evidence, and relevant user-facing
  behavior. Record unperformed App validation as unperformed. The Lane Manager
  assesses Goal task coverage and assigns complete outcomes; it does not
  implement or babysit engineering work.

## Canvas focus

Focus is scoped to the actual Copilot session, open-canvas instance and selected project. Project selection is scoped to session and instance. Keep separate
focus for separate open canvases and users. Store only the selected record/Lane;
the canonical CLI remains authoritative for record contents and status.

The canvas sends work to its current joined session; it does not create a new
App dev session. Keep manager and implementation roles in separate sessions.
Current public RPCs expose `metadata.snapshot/activity`, `model.getCurrent`,
`mode.get`, and `workspaces.getWorkspace`. Read actual results without changing
settings. Joining alone proves neither App visibility nor top-level parentage.
If Node cannot be found by the packaged extension, set `CLIPS_NODE_PATH` to an
installed Node 18+ executable and reload. Never pass `src/cli.js` to Copilot as
though its packaged process.execPath were a Node interpreter.
