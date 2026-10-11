# Example: restore the selected workspace

This is a fictional worked example of the records for a small feature. The
candidate names, results, paths, and test observations below are illustrative;
no workspace feature or verification run is claimed by this document.

## Contents

- [Optional strategic Lane](#optional-strategic-lane)
- [Feature and component boundaries](#feature-and-component-boundaries)
- [Goal with plan and decisions](#goal-with-plan-and-decisions)
- [Task requests](#task-requests)
- [The same tasks after execution](#the-same-tasks-after-execution)
- [Goal acceptance](#goal-acceptance)
- [Revisions and extensions](#revisions-and-extensions)

## Optional strategic Lane

A small feature does not need a Lane merely because Lanes exist. Use one when
the feature belongs to a sustained product frame that will contain multiple
engineering outcomes.

For example, this goal could be one part of:

### `#l1` Workspace continuity

**Description:** Make returning to the product feel continuous across reloads,
workspace switching, and later session-restoration work.

**Product goals:**

- Users return to the right working context quickly.
- Context restoration feels predictable rather than magical or lossy.

The Lane can contain `#g1` below plus future independent goals. Those goals
retain their own plans, criteria, verification, and acceptance. Merely sharing
`#l1` does not make them dependent on one another.

If the strategic workstream later closes, the Lane stores a retrospective such
as:

```json
{
  "summary": "Workspace continuity now covers reload and switching.",
  "decision_log": "We standardized restoration on stable workspace IDs and kept the workspace list authoritative.",
  "system_overview": "Workspace preference persists the ID; workspace selection validates and consumes it.",
  "product_goals_achieved": [
    "Users return to their intended working context after reload"
  ],
  "media": [
    {"src":"screenshots/workspace-restored.png","caption":"Workspace restored after reload"}
  ]
}
```

That closure is a product/system narrative, not a second engineering acceptance
receipt.

## Feature and component boundaries

Requested behavior: when the user reloads the app, restore the last selected
workspace if it still exists. Otherwise choose the normal default. Unavailable
browser storage must not prevent the app from opening.

The feature uses two components. They would remain useful across later work;
they are not created again for every task.

### `#c1` Workspace preference

**Responsibility:** Persist the selected workspace ID for this browser.

**Contract:**

- `readWorkspacePreference()` returns a nonempty stored ID or no preference.
- `writeWorkspacePreference(id)` attempts to persist the ID.
- Storage access failures leave the app usable; neither operation throws into
  the caller.
- The stored ID is an opaque reference. This component does not decide whether
  that workspace still exists.

**Implementation references:** `src/workspace-preference.js` and its adjacent
tests.

**Dependencies:** None.

**Named decision:** Store a stable ID rather than copying workspace data.
The workspace list remains authoritative. Rationale is also in `#g1`.

This definition is the initial `#c1#r1` snapshot.

### `#c2` Workspace selection

**Responsibility:** Choose the active workspace and preserve the user's choice.

**Contract:**

- Restore the stored preference only when its ID appears in the current
  workspace list.
- Use the existing default selection when there is no usable preference.
- Persist a newly selected workspace through `#c1`.
- Preserve existing empty-list behavior.

**Implementation references:** `src/workspace-selection.js` and its adjacent
tests.

**Dependencies:** `#c1`.

**Named integration agreement:** Implement against the storage behavior captured
in `#c1#r1`. Reconcile a changed promise before integration.

The dependency describes the system: selection consumes preference storage.
It does not, by itself, prohibit parallel implementation.

## Goal with plan and decisions

### `#g1` Restore the last available workspace

**Description:** Make reload preserve the user's selected workspace when it
remains available, while retaining a usable fallback.

**Scope:** Browser-local selection persistence and startup restoration. Existing
workspace creation, deletion, and default selection behavior remain the basis
for deciding what is available.

**Components:** `#c1`, `#c2`.

**Acceptance owner:** Coordinator, acting within the feature's delegated
implementation and verification authority. A separate human product approval
would still need that person's actual decision.

**Acceptance criteria:**

| Ref | Condition |
|---|---|
| `#g1#A1` | Reload restores the last selected workspace if it still exists. |
| `#g1#A2` | A missing or deleted preference uses the existing default. |
| `#g1#A3` | Unavailable storage leaves startup and selection usable. |

**Plan:**

1. Agree the two component boundaries and inspect the existing default behavior.
2. Assign persistence to `#g1#t1` and selection integration to `#g1#t2`.
   Their source ownership is separate, so implementation can proceed in parallel.
3. Review each result against its task criteria.
4. Integrate the real components and check reload, stale preference, and
   unavailable-storage behavior.
5. Accept the goal against the integrated candidate.

**Decisions:**

- **Persist the ID.** Workspace objects may change. Read current data after
  reload and validate the preference against it.
- **Preserve the default.** Persistence should improve continuity without
  changing existing fallback selection policy.
- **Treat storage as optional.** Startup must remain usable in environments
  where browser storage is unavailable.

These are named sections in the goal. They do not require a separate plan ID,
ADR, or numbered decision record.

## Task requests

### `#g1#t1` Persist the selected workspace ID

**Description:** Implement the preference reader and writer described by
`#c1#r1`.

**Scope:** Own `src/workspace-preference.js` and its adjacent tests. Preserve the
failure behavior in the component contract. Do not decide workspace availability
inside persistence.

**Components:** `#c1#r1`.

**Owner:** Persistence worker.

**Acceptance owner:** Coordinator.

**Work blockers:** None.

**Acceptance criteria:**

| Ref | Condition |
|---|---|
| `#g1#t1#A1` | After writing an ID, the reader returns that ID. |
| `#g1#t1#A2` | Missing storage and storage access errors produce no preference and do not escape into callers. |

**Verification:** Use the repository's existing test runner for round-trip,
missing-key, and throwing-storage cases.

**Implementation steps:**

1. Implement the small storage adapter.
2. Exercise the contract with the existing test conventions.
3. Return the candidate, actual results, and material notes to the coordinator.

The steps have no persistent IDs. The task is the request and the future change
record; there is no parallel CR.

### `#g1#t2` Restore and update workspace selection

**Description:** Integrate preference storage with startup and workspace
selection according to `#c2`.

**Scope:** Own `src/workspace-selection.js` and its adjacent tests. Use the
agreed `#c1#r1` interface and the current workspace list. Preserve existing
empty-list and fallback behavior.

**Components:** `#c2`, `#c1#r1`.

**Owner:** Selection worker.

**Acceptance owner:** Coordinator.

**Work blockers:** None for implementation against the agreed interface.

**Acceptance criteria:**

| Ref | Condition |
|---|---|
| `#g1#t2#A1` | Startup selects the stored ID when it is present in the current workspace list. |
| `#g1#t2#A2` | A missing or unknown stored ID retains the existing default selection. |
| `#g1#t2#A3` | Selecting another workspace sends its ID to the preference writer. |

**Named integration gate:** Local development can use a fixture for `#c1`.
The goal's integration check waits for the real persistence result. Fixtures do
not prove that the integrated reload behavior works.

**Verification:** Use existing tests for known, missing, and unknown IDs and for
selection changes. Return evidence and the implementation candidate.

If implementation itself could not proceed without `#g1#t1`, this task would
instead list that reference in `blocked_by`. The plan makes the present
integration gate explicit without serializing work that can proceed.

## The same tasks after execution

The original descriptions and criteria remain present. Each task adds its actual
result and acceptance. The following observations illustrate what a completed
record would contain; they are not results from this repository.

### `#g1#t1` result and acceptance

**Record:** Implemented the preference adapter. It stores the opaque ID, returns
no preference for missing data, and catches storage access failures. The
implementation stayed within the component contract.

**Candidate:** `DEMO-PERSISTENCE-CANDIDATE`, an illustrative immutable artifact.

**Criterion evidence:**

| Ref | Assessment | Illustrative evidence |
|---|---|---|
| `#g1#t1#A1` | Satisfied | The round-trip test wrote `workspace-b` and read `workspace-b` from the same adapter. |
| `#g1#t1#A2` | Satisfied | Missing-key, unavailable-storage, and throwing-reader/writer cases completed without an escaping error. |

**Accepted by:** Coordinator.

**Status after acceptance:** `closed`.

A structured receipt would have this shape:

```json
{
  "artifact": {
    "candidate": "DEMO-PERSISTENCE-CANDIDATE",
    "kind": "illustrative example, not real verification"
  },
  "accepted_by": "Coordinator",
  "summary": "The preference reader and writer satisfy the agreed storage boundary.",
  "criteria": [
    {
      "id": "A1",
      "status": "satisfied",
      "evidence": {
        "check": "Existing round-trip test",
        "observed": "workspace-b was read after writing workspace-b",
        "candidate": "DEMO-PERSISTENCE-CANDIDATE"
      }
    },
    {
      "id": "A2",
      "status": "satisfied",
      "evidence": {
        "check": "Missing and throwing storage cases",
        "observed": "No preference or successful return; no error escaped",
        "candidate": "DEMO-PERSISTENCE-CANDIDATE"
      }
    }
  ]
}
```

In actual use, the CLI adds the accepted time and request snapshot. Replace all
illustrative candidate and evidence values with observed facts before accepting.

### `#g1#t2` result and acceptance

**Record:** Startup now reads the preference and validates it against the
current workspace list. Invalid preferences use the existing default. Selection
changes call the preference writer. Empty-list behavior is preserved.

**Candidate:** `DEMO-SELECTION-CANDIDATE`, an illustrative immutable artifact.

**Criterion evidence:**

| Ref | Assessment | Illustrative evidence |
|---|---|---|
| `#g1#t2#A1` | Satisfied | With `workspace-b` present, startup selected the stored ID. |
| `#g1#t2#A2` | Satisfied | Missing and unknown IDs selected the existing default; the empty-list case retained its prior behavior. |
| `#g1#t2#A3` | Satisfied | Selecting `workspace-c` called the preference writer with that ID. |

**Accepted by:** Coordinator.

**Status after acceptance:** `closed`.

The task may have been verified with a storage fixture. Its receipt should say
so. The goal still needs evidence from the integrated components.

## Goal acceptance

**Integrated candidate:** `DEMO-INTEGRATED-CANDIDATE`.

**Record:** The persistence and selection changes were combined, and the final
candidate was checked through reload and failure paths.

| Ref | Assessment | Illustrative integrated evidence |
|---|---|---|
| `#g1#A1` | Satisfied | Selected workspace B, reloaded with the real preference adapter, and observed B selected. |
| `#g1#A2` | Satisfied | Removed B from the available list and reloaded; observed the existing default. Repeated with no stored ID. |
| `#g1#A3` | Satisfied | Disabled storage access and reloaded; startup completed and workspace selection remained usable. |

**Accepted by:** Coordinator.

**Status after acceptance:** `closed`.

The goal receipt uses the same criterion/evidence structure as task receipts,
with the integrated candidate as its artifact. No criterion or child task was
waived in this example. The goal's evidence establishes the combined behavior;
two closed task statuses do not substitute for that check.

If the user had authorized omitting a task, its real `not_planned` disposition
and a reasoned goal exception would remain visible. It would not be described as
implemented.

## Revisions and extensions

If the preference implementation moves to a different file, update `#c1`'s
source reference. The component keeps its identity. A later snapshot might be
`#c1#r2`, while `#c1#r1` still recovers the prior definition.

If the behavior promise changes instead, update the contract, identify affected
tasks, and reconcile their requests before integration. A task tied to
`#c1#r1` does not silently agree to a new promise merely because current
`#c1` changed. Recheck evidence affected by the change.

Reordering the task's criteria keeps `A1` and `A2`. Removing `A2` retires
its ID; a genuinely new condition receives a new ID. Refining the same condition
can retain its ID, while the new wording and any acceptance invalidation remain
in history.

An agent could add a useful named section without changing the core model:

```json
{
  "sections": {
    "Support note": "When diagnosing restoration, compare the stored ID with the current workspace list."
  },
  "extensions": {
    "handoff": {
      "support_doc": "docs/workspace-troubleshooting.md"
    }
  }
}
```

The extension adds context. It does not change acceptance authority or hide a
new obligation. The task still owns its request and result; the goal owns
coordination; the components own their shared boundaries. Transient worker
updates can stay in the existing squad log or session handoff.
