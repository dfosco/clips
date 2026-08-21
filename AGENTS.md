# AGENTS

## Skills

Skills are detailed guides that describe how and when to use specific tools and workflows in this repository.

| Skill | Path | Description |
|-------|------|-------------|
| **clips** | `.agents/skills/clips/SKILL.md` | Planning workflow — create goals and tasks, sync with GitHub Issues, view progress, and keep repository records separate. Read this skill when the user wants to track work, plan features, manage issues, or check status. |

## Quick Reference

- **Track work:** `clips goal create '{"title":"..."}'` → `clips task create-batch g001 '[...]'`
- **Check status:** `clips view`
- **Update progress:** `clips task status g1 t1 closed`
- **Sync with GitHub:** `clips sync`

## Artifact boundary

- Goals and tasks are planning state. Keep them in the external clips workflow store; GitHub Issues are an optional mirror.
- CRs are living, committed review packets for repository changes. Every non-trivial reviewable diff gets exactly one active CR.
- Create a Draft CR before source implementation. Record proposed design and verification, then meaningful discoveries, decisions, and deviations during work.
- Move a CR to `In Review` only after consolidating actual behavior, implementation, compatibility impact, and verification evidence.
- Record reviewable reasoning, not raw chain-of-thought or a microstep diary.
- ADRs record rare, durable cross-cutting architectural decisions. Current user-visible behavior belongs in goals, CR behavior sections, and product documentation.
- A CR may cover one task, several tasks, or a whole small goal. It may update an existing ADR without creating a new record.
- CR metadata must include `Branch`, `Base branch`, `Base commit`, and optional `Parent CR`.
- Workers may commit records in their isolated worktree. Supervisors may update external planning state, but must not edit source or repository records.
