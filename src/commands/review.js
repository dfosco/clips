import { readJsonInput } from '../lib/json-input.js';
import { completeReview, decideReview, importReviewPrDecision, listReviews, materializeReviewPr, openReview, previewReviewPr, requestReview, showReview } from '../lib/reviews.js';

function print(value) { console.log(JSON.stringify(value, null, 2)); }

function requireJsonFlag(args, usage) {
  if (args.length !== 1 || args[0] !== '--json') throw new Error(`Usage: ${usage}`);
}

function showHelp() {
  console.log(`Usage: lanes review <command> [args]

Commands:
  request <Lane|Goal|Task-ref> --file <payload>  Create or reuse a pinned review request
  open <record-ref|review-id> [--json]            Export the exact pinned Markdown and print its path
  list --json                                     List review requests and stale state
  show <review-id> --json                         Show the pinned review candidate and CR content
  decide <review-id> --file <payload>             Record an explicit reviewer decision
  pr preview <review-id> --json                   Preview the pinned PR materialization
  pr materialize <review-id> --confirm            Create an authorized draft/ready PR with gh
  pr import <review-id> --event <GitHub-review-id> --json  Import one verified external review decision
  complete <review-id> --file <payload>           Record approved delivery endpoint evidence

Request JSON: attachment_id, reviewer, candidate {base, head}, summary,
validation, and optional covers [refs]. A Goal is the default review unit and
pins each child Task obligation. Lane reviews require explicit selected covers.
Candidate head must equal current Git HEAD and base must be its ancestor.

Decision JSON: decision (approved|changes_requested|deferred), actor,
candidate {base, head}, comment, and optional expected_revision. The actor must
match the assigned reviewer. Review approval is separate from Task/Goal
engineering acceptance. PR materialization is allowed before approval as the
review surface and never marks work delivered. It requires collaboration,
lane_pr_mode draft or ready, and --confirm; draft creates a draft PR. Modes none
and prepare do not publish. Branch tips must still match the pinned commits. A reviewer can explicitly decide again from deferred
using the same candidate and current expected_revision. Use pr import only with an exact GitHub review node ID. It uses read-only
gh api graphql and requires exact PR base/head, event commit, and assigned reviewer login. It never infers approval from PR
creation, merge, or aggregate review state.
Use complete only after approval, with {actor, candidate:{base,head},
endpoint:{type,url} or {type:"git",ref,commit}, expected_revision?}; URL endpoints
record evidence only. A Git endpoint requires a local branch tip that contains
the approved head and has the exact approved tree. It records delivery evidence
but does not close a Goal or Task. No command authenticates actor identity. A
later source commit makes the review stale and requires a new request.`);
}

export function runReviewCommand(args) {
  const [action, ...rest] = args;
  if (!action || action === '--help' || action === '-h') return showHelp();
  if (action === 'request') {
    if (rest.length < 2 || rest[1] !== '--file') throw new Error('Usage: lanes review request <record-ref> --file <payload>');
    print(requestReview(rest[0], readJsonInput(rest.slice(1))));
    return;
  }
  if (action === 'list') {
    requireJsonFlag(rest, 'lanes review list --json');
    print(listReviews());
    return;
  }
  if (action === 'open') {
    if (rest.length < 1 || rest.length > 2 || (rest.length === 2 && rest[1] !== '--json')) {
      throw new Error('Usage: lanes review open <record-ref|review-id> [--json]');
    }
    const result = openReview(rest[0]);
    if (rest[1] === '--json') print(result);
    else console.log(result.path);
    return;
  }
  if (action === 'show') {
    if (rest.length !== 2 || rest[1] !== '--json') throw new Error('Usage: lanes review show <review-id> --json');
    print(showReview(rest[0]));
    return;
  }
  if (action === 'decide') {
    if (rest.length < 2 || rest[1] !== '--file') throw new Error('Usage: lanes review decide <review-id> --file <payload>');
    print(decideReview(rest[0], readJsonInput(rest.slice(1))));
    return;
  }
  if (action === 'complete') {
    if (rest.length < 2 || rest[1] !== '--file') throw new Error('Usage: lanes review complete <review-id> --file <payload>');
    print(completeReview(rest[0], readJsonInput(rest.slice(1))));
    return;
  }
  if (action === 'pr') {
    const [prAction, reviewId, flag] = rest;
    if (prAction === 'preview') {
      if (rest.length !== 3 || flag !== '--json') throw new Error('Usage: lanes review pr preview <review-id> --json');
      print(previewReviewPr(reviewId));
      return;
    }
    if (prAction === 'materialize') {
      if (rest.length !== 3 || flag !== '--confirm') throw new Error('Usage: lanes review pr materialize <review-id> --confirm');
      print(materializeReviewPr(reviewId, { confirmed: true }));
      return;
    }
    if (prAction === 'import') {
      if (rest.length !== 5 || rest[2] !== '--event' || rest[4] !== '--json') {
        throw new Error('Usage: lanes review pr import <review-id> --event <GitHub-review-id> --json');
      }
      print(importReviewPrDecision(reviewId, rest[3]));
      return;
    }
    throw new Error('Usage: lanes review pr <preview|materialize|import> <review-id> <flags>');
  }
  showHelp();
}
