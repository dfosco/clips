# ADR-001: Separate planning state from repository records

**Status:** Accepted
**Date:** 2026-08-11
**Decision basis:** 0a77da5591a377dbcc65135bacf3fb55cf1573b5
**Supersedes:** None

## Context

Clips needs to coordinate work across interactive and autonomous agent sessions. Goals and tasks are useful as a mutable agenda, while CRs, ADRs, and FDRs explain what was actually changed and decided. Treating all of them as the same hierarchy creates unnecessary records and couples scheduling state to the source repository.

The repository also needs a durable account of work when there is no pull request. A CR fills that role: it is the local review packet for a change, with the same intent as a PR. ADRs and FDRs are longer-lived project documentation, not a required receipt for every task.

## Decision

1. Goals and tasks are planning artifacts. They live in an external clips workflow store and may be mirrored to GitHub Issues. They are not committed to the source repository.
2. A CR is required for every non-trivial, reviewable repository diff. A CR may cover one task, several tasks, or a complete small goal. There is no required Goal-to-CR or Task-to-CR cardinality.
3. A task that produces no repository change does not need a CR. Small bug fixes and feature iterations still receive a small CR, but do not require a new ADR or FDR.
4. An ADR is created only for a durable cross-cutting architectural decision. An FDR is created only for durable current user-visible behavior or feature rationale. Existing records should be updated when they remain the right record.
5. A CR records `Branch`, `Base branch`, `Base commit`, and optional `Parent CR`. `Parent CR` expresses a stacked review dependency; it is not a child-task relationship and does not require a separate stack artifact.
6. The supervisor owns selection and mutation of external planning state. Workers own source changes and committed repository records in isolated worktrees. Neither role manufactures human-owned approval states.

## Consequences

The repository contains concise, durable change history without accumulating one design record per task. The external workflow store can change status, scheduling, ownership, and wake-up state without dirtying the source repository. A worker can resume from the same CR and worktree for implementation, CI repair, or review feedback.

The current CLI's `.clips/db/` JSONL layout is a compatibility implementation detail. Moving goals and tasks out of the repository requires a later storage migration. Until then, existing commands may continue to use that layout, but new repository records must live under `docs/records/` and be committed with their changes.

Stacked CRs require topological review: a dependent CR cannot be accepted against a changed parent without revalidation. The base branch and commit remain the Git source of truth, so CR metadata must be updated when the review basis changes.

## Related

- [CR-001](../cr/CR-001-redefine-clips-artifact-model.md)
- [CR template](../cr/CR-TEMPLATE.md)
- [FDR template](../fdr/FDR-TEMPLATE.md)
