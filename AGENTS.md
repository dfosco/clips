# AGENTS

## Skills

Skills are detailed guides that describe how and when to use specific tools and workflows in this repository.

| Skill | Path | Description |
|-------|------|-------------|
| **clips** | `.agents/skills/clips/SKILL.md` | Local workflow — create goals, tasks, CRs, and ADRs; optionally sync GitHub after opt-in. Read this skill when the user wants to track work, plan features, manage issues, records, or status. |

## Quick Reference

- **Track work:** `clips goal create '{"title":"..."}'` → `clips task create-batch g001 '[...]'`
- **Check status:** `clips view`
- **Update progress:** `clips task status g1 t1 closed`
- **Enable GitHub:** `clips config collaboration true` → `clips sync`

## Artifact boundary

- Goals, tasks, CRs, ADRs, and other record instances are local workflow state under `.clips/`. Do not commit them.
- CRs are living review packets for repository changes under `.clips/records/cr/`. Every non-trivial reviewable diff gets exactly one active CR.
- Create a Draft CR before source implementation. Record proposed design and verification, then meaningful discoveries, decisions, and deviations during work.
- Move a CR to `In Review` only after consolidating actual behavior, implementation, compatibility impact, and verification evidence.
- Record reviewable reasoning, not raw chain-of-thought or a microstep diary.
- ADRs under `.clips/records/adr/` record rare, durable cross-cutting architectural decisions. Current user-visible behavior belongs in goals, CR behavior sections, and committed product documentation.
- A CR may cover one task, several tasks, or a whole small goal. It may update an existing ADR without creating a new record.
- CR metadata must include `Branch`, `Base branch`, `Base commit`, and optional `Parent CR`.
- Committed `docs/records/*-TEMPLATE.md` files define schemas only. Copy templates into `.clips/records/` for record instances; never stage those instances.
