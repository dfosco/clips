---
name: one-shot
description: Fast, single-pass implementation mode. Use when the user says "one-shot", "one shot, go", "prioritize speed", or asks to skip planning, delegation, and broad testing in favor of immediate development.
metadata:
  author: Daniel Fosco
  version: "2026.8.21"
---

# One Shot

> Triggered by: "one-shot", "one shot, go", "prioritize speed over correctness", "development over testing", "no sub-agents"

Execute the requested change immediately in one focused pass. Optimize for delivery speed and working implementation rather than exhaustive investigation, review, or test coverage.

## Operating mode

1. **Act immediately.** Do not present a plan, create tracking artifacts, or ask for confirmation when a reasonable implementation choice exists.
2. **Work directly.** Do not launch sub-agents, factories, or delegated reviews. Use direct repository and editing tools only.
3. **Explore narrowly.** Read only the files and nearby conventions needed to make the change safely. Avoid broad architecture surveys and speculative searches.
4. **Implement once.** Make one coherent, surgical edit that addresses the full request. Do not add unrelated refactors, abstractions, documentation, or tests.
5. **Validate minimally.** Prefer the fastest targeted check that can catch syntax, type, build, or behavior regressions in the changed surface. Do not run broad test suites unless the change is high-risk or the targeted check fails.
6. **Finish concisely.** Report the outcome and any material limitation. Do not add a retrospective, optional follow-ups, or an offer to continue.

## Priority order

When tradeoffs are necessary, use this order:

1. User intent and safety constraints
2. A working end-to-end implementation
3. Speed and minimal scope
4. Existing codebase conventions
5. Targeted validation
6. Additional tests, polish, and documentation

## Guardrails

- "One shot" removes ceremony, not responsibility. Never bypass security, privacy, or destructive-action safeguards.
- Do not knowingly ship broken code. If the direct approach fails, fix the failure rather than stopping at a partial result.
- Do not silently guess when ambiguity could cause irreversible harm or substantial wasted work; ask only in that case.
- Preserve unrelated user changes in a dirty worktree.
- Do not claim success unless the requested outcome is present and the minimal relevant check passes.

## Default interpretation

Treat this request:

> Prioritize speed over correctness, development over testing. No sub-agents. One shot, GO.

as:

> Implement now, directly and in one focused pass. Favor a complete practical change over exhaustive analysis and test coverage. Use no delegation, avoid ceremony and unrelated work, run only the smallest meaningful validation, and preserve mandatory safety and repository constraints.
