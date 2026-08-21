# CR-007: Make Draft CRs living development records

**Status:** In Review
**Type:** Documentation
**Branch:** main
**Base branch:** main
**Base commit:** 1de71171e7ca2c5064351798234ba53fbc7650e9
**Parent CR:** None
**Covers:** #g003

## Why

Tasks define outcomes, but they should not carry volatile implementation detail. A CR should begin before implementation and serve as the active review packet for one repository change, rather than being reconstructed as a post-mortem after the code is complete.

Draft CRs need to expose the agent's proposed design, repository-native verification approach, important assumptions, discoveries, and plan deviations. They must communicate reviewable reasoning without becoming raw chain-of-thought or a microstep diary.

FDRs overlap with behavior-rich goals, living CRs, and product documentation. Keeping them in the default artifact model adds ceremony without a distinct current need.

## Proposed approach

- Define a Draft, development-update, and In Review lifecycle for CRs.
- Put proposed design and verification strategy in the Draft CR before source implementation.
- Record only meaningful discoveries, decisions, and deviations while work proceeds.
- Consolidate the record around the actual implementation and evidence before moving it to `In Review`.
- Keep tasks as stable outcome contracts; keep CRs as implementation-specific review packets; describe draft PRs as their hosted counterparts.
- Remove FDRs from the current workflow and delete the FDR template without rewriting historical CRs.
- Supersede ADR-001 with an ADR that preserves its planning boundary and narrows repository records to CRs and ADRs.

## Development updates

- The Clips skill embeds canonical CR and ADR templates in addition to linking repository templates. Both copies needed the same lifecycle and artifact-boundary updates to avoid conflicting agent instructions.
- Superseding ADR-001 left its historical decision intact, but deleting the FDR template would have broken a link in its Related section. The link was removed while the supersession link to ADR-002 was retained.
- No scope deviations were required.

## Result

CRs now have an explicit living lifecycle across project guidance, agent workflow, and canonical templates. Agents create a Draft CR before source implementation, record the proposed design and repository-native verification strategy, maintain concise development updates for meaningful discoveries and deviations, then consolidate the actual result and evidence before moving the record to `In Review`.

The artifact model now contains external goals and tasks plus committed CRs and rare cross-cutting ADRs. FDRs are removed from current guidance and their template is deleted. ADR-002 records the replacement model and supersedes ADR-001 without rewriting its historical decision.

## Behavior

- Tasks remain stable outcome contracts; volatile technical planning belongs in the Draft CR for the active implementation attempt.
- A Draft CR exposes proposed design, expected boundaries, risks, unresolved questions, and verification strategy before source work starts.
- Development updates contain reviewable decisions and deviations, not raw chain-of-thought, every command, or a microstep diary.
- `In Review` means implementation and author-run verification are complete. It does not imply human approval.
- Draft CRs and Draft PRs are counterparts with distinct storage and review roles; either may exist without the other.
- Current user-visible truth belongs in goals, CR behavior sections, and product documentation. New FDRs are no longer part of the standard workflow.

## Files changed

| File | Semantic role |
|---|---|
| `AGENTS.md` | Repository-wide living CR and artifact-boundary rules. |
| `README.md` | Public artifact model, living lifecycle, and CR/PR distinction. |
| `.agents/skills/clips/SKILL.md` | Agent workflow and embedded canonical record templates. |
| `docs/records/cr/CR-TEMPLATE.md` | Canonical living CR structure. |
| `docs/records/adr/ADR-TEMPLATE.md` | Current ADR scope and related-record guidance. |
| `docs/records/adr/ADR-001-separate-planning-state-from-repository-records.md` | Superseded decision status and link to replacement decision. |
| `docs/records/adr/ADR-002-use-living-crs-as-development-records.md` | Durable decision establishing living CRs and removing FDRs from current model. |
| `docs/records/cr/CR-007-living-draft-change-records.md` | Living review packet and verification evidence for this change. |
| `docs/records/fdr/FDR-TEMPLATE.md` | Deleted obsolete FDR template. |

## Verification strategy

- Inspect repository documentation and skill guidance for consistent CR lifecycle and artifact boundaries.
- Search current, non-historical guidance for obsolete FDR requirements.
- Run repository-native documentation checks available through the existing test command.
- Run `git diff --check` on the completed change.

## Verification results

- [x] `npm test` — passed; CLI reported `clips v1.2.1`.
- [x] `npm run test:all` — passed; 6 test files and 30 tests passed.
- [x] `rg -n -i "\bFDRs?\b|feature decision record" AGENTS.md README.md .agents/skills/clips/SKILL.md docs/records/adr/ADR-TEMPLATE.md docs/records/cr/CR-TEMPLATE.md` — no obsolete FDR workflow found in current guidance.
- [x] `test ! -e docs/records/fdr/FDR-TEMPLATE.md` — passed; current FDR template is absent.
- [x] `git -c core.fsmonitor=false diff --check` — passed with no whitespace errors.

## Compatibility and operations

No runtime, planning-data, or CLI compatibility impact. Historical CRs and ADR-001's original decision remain intact. Removing the FDR template changes current guidance only; existing repository-specific FDR records remain readable and are not deleted.

## Documentation and records

- Added ADR-002 and superseded ADR-001.
- Updated repository and agent guidance plus CR and ADR templates.
- Deleted the current FDR template.

## Review

- [x] Proposed approach reviewed
- [x] Meaningful decisions and deviations captured
- [x] Changed files inspected
- [x] Verification evidence reviewed
- [x] CR branch and base verified
- [x] Stacked dependency reviewed: none
- [ ] Ready to merge
