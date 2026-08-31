---
name: clips-review-change
description: Review a Clips CR, ADR, or repository diff against its exact basis and workflow contract without changing implementation unless requested. Routed by the main Clips skill for review.
---

# Review a change or decision

Review the artifact, not its author's confidence. A CR or ADR is a map to the evidence; it is not evidence by itself.

## Ground the review

For a CR:

1. Read the CR and resolve its `Branch`, `Base branch`, `Base commit`, `Parent CR`, and `Covers` metadata.
2. Run `clips view` for the covered goal and tasks.
3. Inspect the actual diff against the recorded base and confirm the CR still describes it.
4. Read relevant ADRs, tests, and product documentation.
5. Check whether verification evidence applies to the current head SHA and real behavior.

For an ADR:

1. Read the planning goal and decision criteria.
2. Check that the Context fairly represents constraints and alternatives.
3. Test whether the Decision is specific enough to guide future work.
4. Check Consequences for costs, compatibility, reversibility, and unresolved risk.
5. Distinguish direct evidence from inference.

## Judge findings

Prioritize correctness, behavior regressions, missing invariants, data loss, security, compatibility, stale basis metadata, and unsupported verification claims. Do not inflate style preferences into blockers.

Classify findings as:

- `Act on` for defects or gaps that should block readiness;
- `Consider` for real tradeoffs whose cost-benefit is uncertain;
- `Noted` for valid low-priority observations;
- `Dismissed` when an apparent issue is disproved by context or evidence.

Lead with findings and cite concrete files, refs, or record sections. Say when no findings remain.

## Lifecycle

A review request is read-only unless the user also asks for changes. Do not implement fixes, rewrite the record, or mutate workflow status on your own.

When the user explicitly accepts a reviewed record, use the CLI:

```bash
clips record status <CR-or-ADR> accepted
```

When implementation changes after review, return the CR to Draft through `clips record status <CR> draft`, update and reverify it, then move it to In Review again. Never edit status text manually.
