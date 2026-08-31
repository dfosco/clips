# Clips CLI reference

Use CLI commands for planning mutations and record lifecycle changes. Run commands from the repository root. Refs accept canonical forms such as `#g001`, `#g001#t01`, and shorthand such as `g1 t1`.

## Inspect

```bash
clips view
clips view all
clips view #g001
clips view #g001#t01
clips config
```

`clips view all` includes hidden statuses. Prefer the human-readable `view` command over internal JSON commands.

## Goals

```bash
clips goal create '{"type":"planning","title":"Choose an authentication model","description":"...","acceptance_criteria":["Decision criteria are explicit"]}'
clips goal create '{"type":"building","title":"Add authentication","description":"...","behavior":"Feature: Authentication\n  Scenario: Sign in\n    Given a registered user\n    When valid credentials are submitted\n    Then the user is signed in"}'
clips goal update g1 '{"title":"New title","description":"..."}'
clips goal status g1 in_progress
clips goal status g1 closed
clips goal attach-adr g1 ADR-003
clips goal unlink g1
clips goal unlink --all
```

Goal fields:

- `title` is required on create.
- `type` is `planning` or `building`; omitted legacy values resolve to `building`.
- `description` is the stable outcome and scope brief.
- `acceptance_criteria` is an array of observable completion or decision conditions.
- `behavior` is optional Gherkin-like text. Use it by default for building goals. Planning goals normally use decision criteria instead.
- `verification_mode` is `behavior` or `behavior_and_tests`.

A planning goal rejects tasks and cannot close without an attached ADR whose Markdown file exists. A building goal cannot close without at least one task.

Goal statuses are `open`, `in_progress`, `closed`, `not_planned`, and `duplicate`.

## Tasks

```bash
clips task create g1 '{"title":"Add session validation","description":"..."}'
clips task create-batch g1 '[{"title":"Add session validation"},{"title":"Render the signed-in state"}]'
clips task update g1 t1 '{"title":"Validate stored sessions","description":"..."}'
clips task status g1 t1 in_progress
clips task status g1 t1 closed
clips task reorder g1 '["t02","t01"]'
```

Task fields include `title`, `description`, optional `behavior`, and optional `verification_mode`. A task inherits its building goal's verification mode unless it explicitly overrides it. Use `verification_mode: null` to clear an override.

Task statuses match goal statuses. Reordering is allowed only while the goal is open and no task has started.

For large JSON payloads, prefer stdin over fragile shell escaping:

```bash
clips task create-batch g1 --stdin
```

## Records

The CLI manages record lifecycle but does not create record bodies. Create a CR or ADR Markdown file from its committed template under `.clips/records/<type>/`, then use:

```bash
clips record status CR-018 proposed
clips record status CR-018 in_review
clips record status ADR-004 accepted
clips record status CR-018 archived
```

Statuses are `Draft`, `Proposed`, `In Review`, `Accepted`, `Deprecated`, and `Archived`. `Archived` moves the file to `.clips/records/<type>/archived/`; a later active status restores it. Never edit the status field or move the file manually.

## Configuration and GitHub

```bash
clips config
clips config collaboration true
clips config collaboration false
clips config tasks_as_issues true
clips config project_id my-project
clips sync
clips sync g1
```

Collaboration defaults to `false`. `clips init` and `clips sync` make no GitHub reads or writes until the user explicitly enables collaboration. When enabled, goal and task mutations may update linked GitHub Issues. Never enable it merely because a GitHub remote exists.

## Board

```bash
clips web
clips web --host 127.0.0.1 --port 4173
```

The board is read-only. It can combine registered projects but cannot mutate or synchronize planning data.
