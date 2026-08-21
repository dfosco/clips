# ADR-002: Use living CRs as development records

**Status:** Accepted
**Date:** 2026-08-20
**Decision basis:** 1de71171e7ca2c5064351798234ba53fbc7650e9
**Supersedes:** ADR-001

## Context

Goals and tasks need to remain stable planning contracts: goals describe outcomes and tasks identify delegatable slices. Implementation plans, repository discoveries, verification choices, and deviations change while development is underway. Putting that volatile detail into tasks blurs planning with implementation and makes task history harder to trust.

A CR already acts as the repository-native review packet for a change. Treating it only as an after-the-fact summary loses the most useful review window: before and during implementation, when assumptions and technical choices can still be challenged. A Draft CR can fill this gap and align with the familiar Draft PR lifecycle without requiring a hosted provider.

FDRs do not currently have a distinct responsibility. Behavior-rich goals describe intended outcomes, each CR records the behavior delta for its change, and product documentation describes current user-visible truth. A separate feature-decision record would duplicate those sources until real history-reconstruction pain demonstrates a need.

## Decision

1. Goals and tasks remain external planning artifacts. A task states the outcome, scope, constraints, and observable completion conditions; it does not need a detailed technical design.
2. Every non-trivial, reviewable repository diff has exactly one active CR. The CR is created as `Draft` before source implementation begins.
3. A Draft CR records the proposed design, expected boundaries, repository-native verification strategy, risks, and unresolved product questions. During development it records meaningful discoveries, decisions, and deviations, but not raw chain-of-thought or a microstep diary.
4. Before a CR moves to `In Review`, its author consolidates the record around the actual implementation, resulting behavior, changed files, compatibility impact, and verification evidence. Superseded draft claims are replaced or clearly resolved.
5. `In Review` means implementation and author-run verification are complete. Human-owned approval states remain human-owned.
6. A Draft PR is the hosted counterpart of a Draft CR. The CR preserves repository-native rationale and verification; the PR carries the Git diff, checks, discussion, and reviewers. Either may exist without the other.
7. ADRs remain reserved for durable cross-cutting architectural decisions.
8. FDRs are removed from the current artifact model. Current behavior belongs in goals, CR behavior sections, and product documentation. Historical records and CR references remain unchanged.
9. Supervisors own external planning-state mutation. Workers own source changes and living repository records in their isolated worktrees.

## Consequences

Reviewers can inspect and challenge an implementation approach before completion, then use the same CR to understand what changed and how it was verified. Agents gain a structured place to report reviewable judgment without bloating tasks or reconstructing a post-mortem.

Tasks stay durable when technical details change. One CR may still cover one task, several tasks, or a complete small goal; one task may also lead to a replacement CR if an implementation attempt is abandoned. `Parent CR` continues to express only a stacked review dependency.

Maintainers must keep Draft CRs useful rather than exhaustive. Only information that affects scope, behavior, design, risk, compatibility, or verification belongs in development updates. Before review, the result must stand on its own.

Removing FDRs reduces ceremony but gives product documentation a clearer responsibility for consolidated current behavior. If reconstructing feature behavior across many CRs becomes painful, the project can introduce a dedicated current-state artifact based on demonstrated need.

## Related

- [ADR-001](ADR-001-separate-planning-state-from-repository-records.md)
- [CR-007](../cr/CR-007-living-draft-change-records.md)
- [CR template](../cr/CR-TEMPLATE.md)
