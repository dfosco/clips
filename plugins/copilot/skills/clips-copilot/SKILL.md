---
name: clips-copilot
description: Use the Clips Lane Manager canvas in GitHub Copilot App while preserving canonical Clips workflow and ownership rules.
---

# Clips in GitHub Copilot App

Install or update the maintained checkout's local extension and shared skill
links with `node scripts/install-copilot.js`. It runs the extension's locked
production dependency install (`npm ci --omit=dev`) before exposing the source
links. GitHub documents user-scoped extensions under `~/.copilot/extensions`;
the installer places the extension at
`~/.copilot/extensions/clips-workspaces` and links guidance at
`~/.copilot/skills/{clips,lane-manager,clips-copilot}`. It does not change
Copilot settings or start the extension. The official docs do not specify a
reload command. Operationally, after installing or updating, relaunch the
Copilot App, then open the canvas in a new App session and verify it appears.
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
- The public SDK does not expose parent-agent metadata or a documented
  parent-child agent API. An independently created SDK session is not proof of
  top-level Copilot App visibility or steerability. Verify the actual session
  in the App before calling it the top-level dev agent.
- Preserve the selected App session's model and permissions. The public SDK
  does not expose a documented getter for every App session setting. Do not
  guess or overwrite unavailable settings; report which settings the SDK
  actually exposes.
- For Lane Manager work, inspect the canonical claim and use the actual host,
  runtime, and session identity. Claim an unowned Lane before management;
  reuse the current session's claim for direct launches. A conflict or missing
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

Focus is scoped to the Copilot-provided open-canvas instance ID. Keep separate
focus for separate open canvases and users. Store only the selected record/Lane;
the canonical CLI remains authoritative for record contents and status.
