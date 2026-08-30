# Clips

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
