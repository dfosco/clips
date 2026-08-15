# CR-003: Add read-only local kanban board

**Status:** Merged
**Type:** Feature
**Branch:** codex/local-github-pr-sync
**Base branch:** main
**Base commit:** 7e57731477273fbd2e4bf0deed47f5e6a24c116d
**Parent CR:** None
**Covers:** #g001, #g001#t01, #g001#t02, #g001#t03, #g001#t04, #g001#t05, #g001#t06, #g001#t07

## Why

Clips has local planning data and optional GitHub linkage, but no visual way to browse goals and tasks. A local read-only board gives both modes one shared planning surface without introducing mutation or synchronization behavior.

## What changed

Add a standalone Vite + Svelte + Bits UI app under `web/`, backed by a local read-only API that reads `.clips/db` and committed CR metadata. Add shared normalization for all discoverable goals, tasks, statuses, optional GitHub metadata, closing commit SHAs, linked change records, and read-only GitHub PR metadata. Add `clips web` as the CLI entry point for starting the local board, open read-only goal/task details in a right-side drawer, render full CR markdown on a dedicated page with linked planning objects and PRs, provide compact sidebar lists, and use the official Iconoir icon package for every UI icon.

Extend `clips sync` so local mode pulls authenticated GitHub Issues and PRs without any GitHub writes. PRs are matched only by explicit `#g001`, `#g001#t01`, and `CR-NNN` references, stored as idempotent `github_pr_synced` events on matched goal streams, and cached in `.clips/db/_github.jsonl` when unmatched. The cache is excluded from goal discovery and malformed pull responses become warnings while existing local data remains intact.

## Behavior

The board displays local-only and GitHub-linked goals together. Users can search the active page from the top navigation, switch between goal cards and task cards, and open goal/task detail drawers. Closed goals and tasks show their associated closing commit SHA when status events contain one. Goals and Tasks sidebar views use compact lists. The CRs sidebar view lists committed change records; selecting a CR opens a full-page rendering of its complete Markdown body with linked goal/task and GitHub PR metadata. Unassociated pulled PRs appear on the CR surface and external links open GitHub in a new tab. Users cannot edit, reorder, create, or sync from the app.

## Files changed

| File | Semantic role |
|---|---|
| `src/lib/board.js` | Shared board data discovery and normalization |
| `src/lib/board.test.js` | Board data and malformed-file coverage |
| `src/lib/sync.js` | Pull-only GitHub Issue/PR sync, matching, cache, and idempotence |
| `src/lib/sync.test.js` | GitHub PR reference and metadata coverage |
| `src/lib/core.js` | Event replay and closing commit metadata |
| `src/commands/sync.js`, `src/cli.js` | Pull-only sync reporting and CLI routing |
| `web/` | Vite + Svelte + Bits UI application, API middleware, UI tests, compact lists, CR navigation, and functional search |
| `src/commands/web.js`, `src/cli.js` | `clips web` server command and CLI routing |
| `package.json`, `package-lock.json` | Frontend scripts, package contents, and dependencies |
| `.agents/skills/clips/SKILL.md` | Local-mode sync and CR workflow documentation |
| `README.md` | Development and behavior documentation |
| `docs/records/cr/CR-003-read-only-kanban-board.md` | Review packet |

## Test plan

- [x] Board data reader handles root and namespaced goals.
- [x] Read-only API handles empty, missing, and malformed data.
- [x] UI renders normal, loading, empty, and error states.
- [x] Production frontend build passes.
- [x] Existing CLI verification passes.
- [x] `clips web` starts Vite and forwards server arguments.
- [x] Task and goal cards open right-side read-only detail drawers with keyboard and backdrop dismissal.
- [x] Board segmented control switches between goal-card and task-card modes.
- [x] Committed CR metadata links to covered goal/task refs and has a full-page Markdown view with linked-object navigation.
- [x] Top navigation search filters the active board, goal, task, or CR view.
- [x] All UI icons resolve through official Iconoir SVG package assets; no hand-authored inline SVG icon paths remain.
- [x] Closed goals and tasks display their recorded closing commit SHA.
- [x] Local-mode sync pulls Issues and PRs without GitHub writes, preserves local data on pull warnings, deduplicates PRs by repository and number, and caches unmatched PRs in `_github.jsonl`.
- [x] PR references link goal/task detail panels and CR pages; unmatched PRs appear on the CR surface with external links.
- [x] Mock `gh` fixture verifies local pull-only sync, repeat-pull idempotence, and malformed-response warnings without dropping valid local data.
- [x] Browser QA covers desktop, mobile, search, source filtering, detail drawer navigation, and console errors.
- [x] Visual follow-up aligns grouped columns, status colors, controls, empty states, and sidebar views with approved mockup.

## Compatibility and operations

The web app remains read-only and GitHub pull is CLI-only. Local `clips sync` uses the authenticated `gh` CLI session, never writes remotely when `collaboration` is false, and keeps valid local records when either Issue or PR retrieval fails. App reads repository-local `.clips/db` and committed CR markdown only, exposes no write API, and uses Iconoir under its MIT license.

## Documentation and records

Iconoir: https://iconoir.com/ and the `iconoir` npm package.

## Review

- [x] Changed files inspected
- [x] Regression coverage reviewed
- [x] CR branch and base verified
- [ ] Stacked dependency reviewed, if applicable
- [x] Ready to merge
- [x] Merged into `main`
