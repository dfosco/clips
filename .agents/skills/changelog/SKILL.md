---
name: changelog
description: Generates formatted changelog entries from commit ranges. Use when asked to generate a changelog, list what changed, or summarize commits between versions.
metadata:
  author: Daniel Fosco
  version: "2026.8.25"
---

# Changelog Skill

> Triggered by: "generate changelog", "create changelog", "changelog since", "changelog between", "what changed since"

## What This Does

Generates a formatted changelog entry for `CHANGELOG.md` from git commits between two versions (tags). Outputs are grouped by category with commit SHAs and a summary paragraph.

---

## How to Execute

### Step 1: Determine the version range

The user will specify a range. Resolve it to git tags:

- **"since 3.0.0"** → from `@dfosco/storyboard-core@3.0.0` to `HEAD`
- **"between 2.8.0 and 3.0.0"** → from `@dfosco/storyboard-core@2.8.0` to `@dfosco/storyboard-core@3.0.0`
- **"since last release"** → find the latest tag with `git tag -l '@dfosco/storyboard-core@*' --sort=-v:refname | head -1`, use that as the start, `HEAD` as the end

Tags in this repo follow the format `@dfosco/storyboard-core@{version}`.

### Step 2: Collect commits

```bash
git --no-pager log '<start-tag>'..'<end-tag-or-HEAD>' --format='%h|%s' | cat
```

### Step 3: Categorize commits

Group commits by their conventional-commit prefix and scope. Use these categories in this order:

| Category | Matches |
|----------|---------|
| **Features** | `feat:`, `feat(...):`  |
| **Bug Fixes** | `fix:`, `fix(...):` |
| **Style** | `style:`, `style(...):` |
| **Refactor** | `refactor:`, `refactor(...):` |
| **Documentation** | `docs:`, `docs(...):` |
| **Chores** | `chore:`, `chore(...):`, CI changes, renames, dependency updates |

Commits without a conventional prefix should be categorized by reading the message:
- Merge commits → skip (don't include in changelog)
- Plan commits → skip
- Anything with "fix" in the message → **Bug Fixes**
- Anything with "add", "implement", "new", "support" → **Features**
- Anything with "rename", "move", "remove" → **Chores**
- Anything with "style", "icon", "border", "color" → **Style**

Only include categories that have at least one entry.

### Step 4: Format entries

Each entry should follow this format:

```markdown
- **Scope**: Description (`short-sha`)
```

If there's no scope, omit it:

```markdown
- Description (`short-sha`)
```

**Grouping related commits:** When multiple commits clearly belong to the same feature (e.g., a series of canvas commits), group them under a single bullet with sub-bullets:

```markdown
- **Canvas system** — Main description (`sha`)
  - Sub-feature detail (`sha`)
  - Another detail (`sha1`, `sha2`)
```

### Step 5: Write the summary paragraph

Write a 1-3 sentence summary paragraph that goes directly under the version heading, before any category sections. It should:
- Name the main themes of the release (1-3 themes)
- Be written in plain language, not a list
- Start with a short punchy phrase, then elaborate

Example:
> Canvas, external prototypes, and polish. This release adds the full canvas system — an infinite, zoomable workspace for arranging widgets and embedding prototypes — along with external prototype support for linking to apps hosted elsewhere.

### Step 6: Determine the version heading

- If the end of the range is a tag, use that version number: `## 3.0.0`
- If the end of the range is HEAD, use: `## Unreleased (since {start-version})`

### Step 7: Assemble and insert

The final entry structure:

```markdown
## {version}

{summary paragraph}

### Features

- ...

### Bug Fixes

- ...

### Style

- ...

### Chores

- ...
```

Insert the new entry into `CHANGELOG.md` in version order — after the `# storyboard` heading and before the next older version entry.

---

## Output Format Reference

Here's a complete example entry:

```markdown
## 3.1.0

Canvas, external prototypes, and polish. This release adds the full canvas system — an infinite, zoomable workspace for arranging widgets and embedding prototypes — along with external prototype support for linking to apps hosted elsewhere. Includes a wave of bug fixes across comments, inspector, and accessibility.

### Features

- **External prototypes** — Link to prototypes hosted at external URLs; they appear in the viewfinder and open in a new tab (`2b6bc63`)
- **Canvas system** — Full canvas implementation with widgets, zoom controls, panning, and prototype embeds (`1ac085e`)
  - Smooth zoom with Cmd+scroll / pinch, with finer 5% steps under 75% (`87d43a1`, `4aac1f5`)
  - Space + click-drag to pan the canvas (`a18fc0e`)
- **Inspector panel** — Side/bottom dock toggle with localStorage persistence (`1e56e9d`)

### Bug Fixes

- **Comments**: Validate PAT has discussion access at sign-in time (`c6d66e2`)
- **Canvas**: Fix cmd+scroll zoom for Magic Mouse and trackpad (`caab0ec`)
- Add `@internationalized/date` for bits-ui peer dep (`bc20672`)

### Style

- Canvas zoom controls: frosted-glass backdrop, slate colors, border refinements (`33a9b5b`, `4dbf65c`)

### Chores

- Rename `src/canvases` to `src/canvas` (`06a406c`)
```

---

## Notes

- Always skip merge commits and plan/planning commits
- The changelog file is `CHANGELOG.md` at the repo root
- The top-level heading is `# storyboard` — do not change it
- When the user says a bare version like "3.0.0", always resolve to the full tag format `@dfosco/storyboard-core@3.0.0`
- If a GitHub release exists for the tag, fetch it with `gh release view '<tag>' --json body` and use its content as the primary source instead of raw commits — it will be better organized
