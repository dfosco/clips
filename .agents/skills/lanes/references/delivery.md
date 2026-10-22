# Bounded delivery and review gates

Use these rules for Lane Dev assignments and handoffs. Project preferences are
read with `lanes config lane_dev_max_tasks`, `lane_validation_mode`,
`lane_commit_mode`, and `lane_pr_mode`; their defaults are `3`, `human`,
`after_validation`, and `none`. Preferences guide procedure. They do not enforce
scheduling, confer acceptance authority, prove host capability, or authorize
external actions.

## Bounded assignments and retirement

Assign a finite batch of persisted Tasks, normally one. Do not exceed the
configured per-session Task cap, count known earlier assignments, and return the
batch when its defined work is done even below the cap. Allow only bounded
rework against the same contract. Do not reuse a session to evade a host quota.

Before handoff, return exact refs and request revisions, final artifact identity
and changed paths, criterion-level checks and results, commands/environment,
decisions, failures, blockers, remaining inputs, and any active writes or
external effects. Preserve recoverable work. The manager reviews the evidence
and confirms the handoff is stable before using a discovered, supported,
authorized non-destructive archive/close action. Read back the host state.
Preserve source, worktrees, transcripts and association history. A human review
wait does not require keeping an idle worker alive.

## Validation, acceptance, and user review

Run automated checks on the actual candidate before commit. Record the candidate
(commit plus any dirty diff, tree, or immutable artifact), each criterion and
check, observed result, responsible actor and next action. A failure blocks
acceptance and commit; repair and rerun affected checks. Later source changes
invalidate affected evidence.

An authorized agent may accept engineering Tasks when each criterion is met.
Task acceptance does not close its Goal. The default human gate applies to the
integrated Goal. The manager attaches a Goal CR for the exact committed
candidate, covered scope, criteria and checks, then separately submits a pinned
review request. Attaching a CR alone does not request review. Request explicit
`approved`, `changes_requested`, or `deferred` disposition. The user may
coalesce selected Goal reviews into one Lane CR. Covered scope receives one
review decision, not duplicate Goal and Lane approvals. CR attachments request
candidate review; ADR approval settles a decision and does not accept
implementation. A review inbox holds actionable requests pinned to candidate,
content and coverage. A generic waiting label is not a review request. Never
claim human approval before the user responds. If the candidate changes,
refresh the request and affected checks. A stale attachment retains immutable
`attachment.content` alongside `current_content`, pinned/current SHA-256
identities, and read identities so the reviewer can see the original pin and
the current-content warning together.

Goal completion requires approval of the exact candidate and fulfillment of the
configured delivery endpoint. The manager records attributed evidence/receipt
and closes the Goal only then. `changes_requested` returns bounded affected
work to a dev and requires a new candidate-bound review request. `deferred` leaves
an explicit user wait with its next owner and action; do not continue unrelated
or endless work. Deferral is not final: the assigned reviewer may later record a
new decision against the same still-current candidate. A pending Goal review
does not keep an idle dev assigned after its handoff has been confirmed.

`lane_validation_mode=agent` is an explicit opt-out only where no named human
gate applies. Manager analysis and agent Task acceptance do not replace the
required user decision on the Goal CR. Use a ready-for-review state only when
the candidate is complete, the request is actionable, and the host supports it.

## Commit and PR boundaries

`lane_commit_mode=after_validation` means the dev commits after automated checks
pass and before manager analysis or user validation. The assignment must
authorize the dev-owned local commit. Stage only owned, verified paths, inspect
the staged diff, preserve unrelated changes, and record the commit identity.
Recheck evidence affected by hooks or generated files. `manual` leaves an
explicit commit handoff with candidate, paths and next owner.

`lane_pr_mode` describes the desired result: `none`, `prepare`, `draft`, or
`ready`. It never authorizes network writes, publication, review-state changes,
messages or reviewer requests. PR materialization requires collaboration enabled,
mode `draft` or `ready`, and explicit `--confirm`; it is allowed while the
review awaits a decision. `draft` uses `gh pr create --draft`; `ready` uses
`gh pr create`. Verify local/remote branch tips against the pinned base/head
SHAs before invoking `gh`. Materialization records a separate PR association
without changing review status. PR creation is only a review surface. It is not
approval, merge, delivery completion, Task acceptance or Goal acceptance. Modes
`none` and `prepare` prohibit materialization. Follow the user's explicit
external-action approval rules. Do not push unless separately authorized.

`lanes attachment add <ref> '<json>'` accepts optional `purpose: "cr"` or
`"adr"`; purpose labels use and grants no authority. Remote CR/ADR references
may be attached, but only readable local Markdown with purpose `cr` can be
pinned for review. A Goal review covers the Goal and required Task obligations;
a Task review covers only that Task; a Lane review requires explicit selected
in-Lane Goal/Task coverage. Fully covered requests coalesce; partial overlaps
reject and identify uncovered obligations. Request reuse compares reviewer,
intent, attachment content, coverage pins, candidate commits and branch refs.

`review show <id> --json` returns a numeric revision. Supplying it as
`expected_revision` to `review decide` or `review complete` is optional in the
CLI and recommended for race-safe UI callers. The UI sends it to prevent a
decision or completion against a revision that changed after display. `show` shows immutable
pinned `attachment.content`, current content, SHA-256 identities and read
identities when content has changed. Candidate pins include immutable base/head
commit SHAs and the matching `base_ref`/`head_ref`; head must remain current
`HEAD` and base an ancestor. Verify both named branch tips against those SHAs
before materialization.

`review decide <id> --file payload.json` accepts optional `expected_revision`,
the exact pinned base/head, and an actor matching the assigned reviewer. Only
`awaiting_review`, `changes_requested`, and `deferred` are actionable. A
deferred review can receive an explicit later decision without changing its
content. Superseded and delivered reviews remain terminal; exact retries do not
reopen them. Approval remains one decision for covered obligations, whether
submitted by the reviewer or imported from the linked PR.

`review complete <id> --file payload.json` requires an approved exact candidate
and endpoint evidence. Payload shape is `{actor, candidate:{base,head},
endpoint, expected_revision?}`. URL endpoints are `{type:"github_pr"|"url",url}`;
`github_pr` requires an HTTPS GitHub pull URL and `url` an absolute HTTP/HTTPS
URL. They are evidence links, not proof of merge, and still require a non-stale
candidate. A local Git proof is `{type:"git",ref:"main",commit:"<full SHA>"}`.
It requires a local branch name, the recorded commit to equal that branch's
current tip, the approved head to be an ancestor, and identical delivered and
approved trees. It permits expected HEAD/base-ref movement from a real
merge/fast-forward; changes to the attachment, CR, coverage, or Lane contract,
and missing candidate objects still reject. Completion does not perform a merge.
It records `delivered_by` and endpoint evidence only; it does not authenticate
the actor or close/accept the Goal or Tasks. A delivered review is a historical
receipt: `review show` reports `stale:false` after delivery, and later unrelated
HEAD/base movement does not reclassify that evidence.

`review pr import <id> --event <PullRequestReview-GraphQL-node-ID> --json` is a
read-only import from an already linked PR. It queries only the supplied review
node ID with `gh api graphql`, then verifies the PR URL, pinned base/head OIDs,
review-event commit OID and valid submission time, event ID, and author login
against the assigned reviewer. Only GitHub `APPROVED` and `CHANGES_REQUESTED`
events import. It records the GitHub review node ID, login, state, commit OID,
PR URL, `submittedAt` and body as local decision provenance. Reimporting the
same event is idempotent; reusing its ID with changed data rejects. Stale
candidates reject. PR creation, merge state and aggregate `reviewDecision` do
not imply approval. Import performs no external writes or continuous sync. It
records a decision on the existing pinned review, not a second approval surface.

The manager owns shared Lanes records and cross-Task coordination and integration
oversight. Assigned devs resolve technical conflicts and execute their own
integration, checks and authorized commits. Workers return evidence and proposed
record updates unless assigned as their writer. A completed worker can be retired
while the Goal's human review remains pending, once its handoff has been reviewed
and confirmed stable.
