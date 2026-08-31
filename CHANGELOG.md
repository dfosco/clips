# Clips

## 1.4.0-beta.0

Make Clips planning more rigorous while reducing agent ceremony. This beta introduces typed goal outcomes, shared record lifecycles, and a selectively loaded workflow skill pack grounded in evidence and real verification.

### Features

- **Rigorous workflow router**: Route goal framing, decision planning, task breakdown, development, verification, review, and resume work through focused CLI-backed skills with the adapted pstack principles kept inline (`0053934`)
- **Typed goal outcomes**: Separate planning goals that produce ADRs from building goals that deliver tasks and CR-backed changes (`924b16f`)
- **Record lifecycle management**: Manage CR and ADR status and archive transitions through one CLI workflow (`924b16f`)
- **Complete skill installation**: Install and update the router, routed skills, CLI reference, and third-party notice through `clips init` (`0053934`)

### Fixes

- **Dashboard readability**: Improve goal and record presentation in the local board (`d3b1bbe`)
- **Publishing command**: Prevent the explicit npm publish command from recursively invoking itself (`4dc4747`)

### Developer workflow

- Generate observable behavior by default for building goals while planning goals use decision criteria (`d0b4468`)
- Add a repository-local command for running the current Clips CLI during development (`3921ce3`)

## 1.3.0

Improve local web workflows and simplify local-only planning. This release adds npm-packaged web assets, unlinking goals from GitHub, Markdown task checkboxes, reliable project selection, and corrected dark-mode styling.

### Features

- **Packaged web board**: Build and ship the web UI with the npm package so `clips web` works from installed releases (`2899c9e`)
- **Local-only goals**: Unlink goals from GitHub while preserving their local planning state (`696fa1a`)
- **Markdown task lists**: Render task-list items as read-only checkboxes in change records (`7bf89d6`)

### Fixes

- **Theme styling**: Apply semantic theme tokens consistently in dark mode (`7826738`)
- **Project selection**: Keep the project selector visible for single-project boards (`4b4d0c2`)

## 1.2.3

One board for every Clips project. This release adds a global multi-project view with project discovery, filtering, qualified references, and packaged web assets that run outside a repository.

### Features

- **Multi-project board**: Add a global read-only board with project registration, selection, and workspace-qualified goal and task references (`97c1cbb`)

### Chores

- Release version 1.2.3 (`cd35405`)
