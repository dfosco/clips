---
name: release
description: Creates a versioned release from commits since the last tag. Generates changeset, versions, tags, pushes — CI publishes to npm with OIDC provenance.
metadata:
  author: Daniel Fosco
  version: "2026.4.08"
---

# Release Skill

> Triggered by: "release", "cut a release", "publish a release", "release a new version", "ship a release", "do a release"
>
> **This skill is always invoked manually. It is never called automatically by other skills (including `ship`).**

## What This Does

Creates a versioned release of all `@dfosco/storyboard-*` packages. Generates a changeset from commits since the last release, bumps versions, creates tags, and pushes. CI then publishes to npm (via OIDC Trusted Publishing) and creates a GitHub Release — both with the same description.

---

## How to Execute

### Step 1: Determine the last release

Find the most recent version tag:

```bash
git describe --tags --abbrev=0 --match '@dfosco/storyboard-core@*'
```

This gives you the tag (e.g. `@dfosco/storyboard-core@3.8.2`). All commits after this tag are part of the new release.

### Step 2: Gather commits since last release

```bash
git --no-pager log <last-tag>..HEAD --oneline --no-merges
```

These commits form the release description. Group them by type:

- **Features** — commits starting with `feat:`
- **Fixes** — commits starting with `fix:`
- **Other** — everything else worth mentioning (skip `chore:`, `docs:`, `ci:` unless they're user-facing)

### Step 3: Ask the user for bump type and summary

Use `ask_user` to confirm:

1. **Bump type**: patch / minor / major (suggest based on commits — if any `feat:` → suggest minor, if any `BREAKING:` → suggest major, otherwise suggest patch)
2. **Release channel**: stable / beta / alpha (default: stable)
3. **Summary**: Show the auto-generated summary from commits and let the user edit or approve it

The summary should be a concise, human-readable description of what changed. Format:

```markdown
Summary line here (1 sentence)

- First notable change
- Second notable change
- Third notable change
```

### Step 4: Create the changeset file

Create a `.changeset/<id>.md` file with the approved summary:

```bash
CHANGESET_ID=$(node -p "'changeset-' + Date.now().toString(36)")
```

```markdown
---
"@dfosco/storyboard-core": <bump_type>
---

<approved summary>
```

Only `@dfosco/storyboard-core` needs to be listed — the `fixed` config in `.changeset/config.json` bumps all four packages together.

### Step 5: Enter prerelease mode (if beta/alpha)

Only for non-stable releases:

```bash
npx changeset pre enter <tag>   # "beta" or "alpha"
```

### Step 6: Version bump

```bash
npm run version
```

This runs `changeset version` + `sync-root-version.js`, which:
- Consumes the changeset file
- Bumps all package.json versions
- Updates CHANGELOG.md (this is where the summary appears)

Read back the new version to confirm:

```bash
node -p "require('./packages/core/package.json').version"
```

### Step 7: Sanity check (prerelease only)

If prerelease, verify the version contains the tag:

```bash
# e.g. 3.9.0-beta.0 must contain "-beta."
```

If it doesn't, abort and have the user run `npx changeset pre exit` and retry.

### Step 8: Commit

```bash
git add -A
git commit -m "chore: version packages"
# or for prerelease:
git commit -m "chore: version packages (<tag>)"
```

### Step 9: Create git tags

```bash
npx changeset tag
```

This creates tags like `@dfosco/storyboard-core@3.9.0` for each package.

### Step 10: Exit prerelease mode (if beta/alpha)

```bash
npx changeset pre exit
git add -A
git commit -m "chore: exit prerelease mode" --allow-empty
```

### Step 11: Push

Push branch and tags **separately** — pushing a new branch + tags together in one command can cause GitHub Actions to miss the tag push event.

```bash
git push --set-upstream origin "$(git branch --show-current)" 2>/dev/null || git push
git push --tags
```

### Step 12: Trigger publish workflow

Always trigger the publish workflow explicitly via `gh workflow run` — do **not** rely on the `push: tags:` event, which is unreliable when pushing from non-main branches.

```bash
gh workflow run release-publish.yml -f tag=@dfosco/storyboard-core@<version>
```

### Step 12.1: Never thank the author (the user IS the author)

The `@changesets/changelog-github` plugin auto-prefixes every entry with
`Thanks [@<user>](https://github.com/<user>)! - `. The user is writing
the release — they don't need to be thanked as a minor contributor in
their own changelog.

`scripts/sync-root-version.js` already strips this from
`packages/storyboard/CHANGELOG.md` (and root `CHANGELOG.md` if present)
after `changeset version`. But the GitHub Release body is generated
separately by the publish workflow and may still contain it. After
the publish workflow finishes (or right after `gh release create`),
**always check the release body and strip the prefix** if present:

```bash
TAG='@dfosco/storyboard@<version>'
BODY=$(gh release view "$TAG" --json body -q .body)
CLEAN=$(printf '%s' "$BODY" | sed -E 's/Thanks \[@[^]]+\]\(https:\/\/github\.com\/[^)]+\)! - //g')
if [ "$BODY" != "$CLEAN" ]; then
  printf '%s' "$CLEAN" | gh release edit "$TAG" --notes-file -
fi
```

**Hard rule: NEVER include "Thanks @<user>" in any release body, changelog
entry, or commit message you write.** If you see it in generated output,
strip it before finalizing.

### Step 12.5: Beta changelog (stable releases with preceding betas)

If this is a **stable release** and there were preceding beta/alpha tags for the same major.minor version:

1. List all beta tags: `git tag -l '@dfosco/storyboard-core@<version>-beta.*' --sort=version:refname`
2. For each beta, get commits since the previous beta (or last stable): `git --no-pager log <prev-tag>..<beta-tag> --oneline --no-merges`
3. Summarize each beta to 1–3 bullet points of user-facing improvements
4. Group adjacent tiny betas that are clearly related (e.g. beta.16–18 for a series of build fixes)
5. Skip betas with only version bumps, chore, or debug commits
6. **Update all CHANGELOG.md files** (packages/core, react, react-primer, react-reshaped, tiny-canvas) — replace the auto-generated 4.x.0 section with a curated overview + "### Beta releases" sub-section containing the per-beta summaries
7. **Update the GitHub Release body** with the same content using `gh release edit`
8. Commit: `git commit -am "docs: rewrite <version> changelogs with beta-by-beta breakdown"` and push

This ensures the changelog captures the full journey of the release, not just the final changeset summary.

### Step 13: Report success

Print:

```
✅ Version <version> tagged, pushed, and publish triggered!

   Track progress: https://github.com/dfosco/storyboard/actions/workflows/release-publish.yml
```

### Step 14: Create clips task

If clips is available, create a task under a relevant goal (or create a new goal) to track the release, and close it immediately.

---

## Important Rules

1. **Never call this skill automatically.** The user must explicitly ask for a release.
2. **Always ask the user to confirm** the bump type, channel, and summary before proceeding.
3. **The summary you write in the changeset file is the source of truth** — it flows into CHANGELOG.md, the GitHub Release body, and the npm package description.
4. **All four packages bump together** due to the `fixed` config. Only list `@dfosco/storyboard-core` in the changeset frontmatter.
5. **Prereleases must be done from a branch, not main.** Warn the user if they're on `main` and request a prerelease.
6. **NEVER thank the author of the commits in any release body, changelog entry, or commit message.** The user is the author — thanking them as a "minor contributor" in their own changelog is wrong. The `@changesets/changelog-github` plugin auto-injects `Thanks [@<user>](https://github.com/<user>)! - ` prefixes; `scripts/sync-root-version.js` strips them from local changelogs, but the GitHub Release body must be cleaned post-publish (see Step 12.1). If you ever see "Thanks @&lt;user&gt;" in a release artifact, remove it.

---

## Relationship to Other Skills

| Skill | Relationship |
|-------|-------------|
| `changeset` | Low-level changeset operations. `release` orchestrates the full flow. |
| `ship` | Ships features (worktree → PR). Does NOT trigger release. |
| `worktree` | Used by `ship`, not by `release`. Releases happen on the current branch. |

---

## Resuming a Failed Release

If the release fails after versioning (e.g. push failed):

```bash
npm run release:resume              # stable
npm run release:resume:beta         # beta
npm run release:resume:alpha        # alpha
```

This ensures tags exist, pushes, and lets CI take over publishing.
