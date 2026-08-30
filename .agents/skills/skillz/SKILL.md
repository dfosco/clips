---
name: skillz
description: Manage repository-local agent skills from the installed skillz registry. Use when a repository has a .skillz-lock or the user asks to install, pin, list, or update local skills with skillz.
metadata:
  author: Daniel Fosco
  version: "2026.8.25"
---

# Skillz — Local Skill Registry

Use the `skillz` CLI to manage skills in this repository. The project-root `.skillz-lock` is the source of truth for which skill directories are managed by skillz; directories absent from the lock belong to the project or another installer.

## Install a skill

Run commands from anywhere inside the repository:

```bash
skillz <name>
skillz install <name>
skillz i <name>
```

The CLI finds the project's agent directory, installs the full skill package under its `skills/` subdirectory, and updates `.skillz-lock`. It prefers an existing `.agents`, then `.github`, then `.codex`, and creates `.agents` at the Git root when none exists.

To require the exact version currently available from the local registry:

```bash
skillz <name> --version <version>
skillz <name>@<version>
```

The local registry contains one current version per skill. Do not claim that an unavailable historical version can be resolved; the command must fail on a version mismatch.

## Update managed skills

```bash
skillz update
```

This replaces every skill listed in `.skillz-lock` with the current local-registry copy and updates its locked metadata. Use `skillz update <name>` to update one managed skill. Updates replace managed directories, so make source changes in the registry rather than editing installed copies.

## Boundaries

- Do not manually add unrelated skills to `.skillz-lock`.
- Do not remove or overwrite unlisted skill directories.
- Do not hand-edit installed copies when the registry source should change.
- Global installation with `skillz <name> --global` writes to `~/.agents/skills` and is intentionally not tracked by a project lockfile.
- Use `skillz list` to inspect available local-registry names, versions, and authors.
