import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { formatRef, getClipsDir, getRepoRoot, parseRef, readGoalWithTasks } from './core.js';
import { attachmentsForRecord, readRecordAttachment } from './attachments.js';
import { readLane, normalizeLaneId } from './lanes.js';
import { appendJsonEvent, readJsonEvents, withRecordLock } from './journal.js';
import { readConfig } from './config.js';
import { isPlainObject, requestSnapshot } from './work-fields.js';

const REVIEW_ID = /^rev-[0-9a-f-]{36}$/i;
const DECISIONS = new Set(['approved', 'changes_requested', 'deferred']);
const REVIEWABLE_STATES = new Set(['awaiting_review', 'changes_requested', 'deferred']);
const TERMINAL_STATES = new Set(['superseded', 'delivered']);

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(canonical(value));
  return createHash('sha256').update(bytes).digest('hex');
}

function contractOf(record) {
  return canonical(requestSnapshot(record, { kind: record.task_id ? 'task' : 'goal' }));
}

function git(repoRoot, args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function verifyBranchTip(refName, expectedSha, repoRoot, { requireLocal = false } = {}) {
  const refs = git(repoRoot, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'])
    .split('\n').filter(Boolean).map((line) => {
      const [ref, sha] = line.split(' ');
      const name = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '');
      return { ref, name, sha };
    }).filter((item) => item.name === refName);
  const local = refs.filter((item) => item.ref.startsWith('refs/heads/'));
  const remote = refs.filter((item) => item.ref.startsWith('refs/remotes/'));
  if ((!local.length && !remote.length) || (requireLocal && !local.length)
    || [...local, ...remote].some((item) => item.sha !== expectedSha)) {
    throw new Error(`Candidate branch ${refName} no longer points to its pinned commit`);
  }
}

function verifyLocalBranchTip(refName, expectedSha, repoRoot) {
  try {
    const ref = `refs/heads/${refName}`;
    const tip = git(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
    if (tip !== expectedSha) throw new Error('moved');
  } catch {
    throw new Error(`Local candidate branch ${refName} no longer points to its pinned commit`);
  }
}

function branchForCommit(sha, label, repoRoot) {
  const refs = git(repoRoot, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'])
    .split('\n').filter(Boolean).map((line) => {
      const [ref, tip] = line.split(' ');
      return { ref, tip, name: ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '') };
    }).filter((item) => item.tip === sha);
  const unique = new Map(refs.map((item) => [item.name, item]));
  if (unique.size !== 1) throw new Error(`candidate.${label} must include a branch name when its commit does not identify one unique branch`);
  return [...unique.values()][0].name;
}

function resolveCommit(value, label, repoRoot) {
  const input = requiredText(value, `candidate.${label}`);
  if (input.startsWith('-')) throw new Error(`candidate.${label} must identify a Git commit`);
  try {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(input)) {
      const valid = git(repoRoot, ['check-ref-format', '--branch', input]);
      const branches = git(repoRoot, ['for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes'])
        .split('\n').filter(Boolean).map((line) => {
          const [ref, sha] = line.split(' ');
          const name = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\/[^/]+\//, '');
          return { ref, sha, name };
        }).filter((item) => item.name === valid || item.ref === `refs/heads/${valid}`);
      const tips = new Set(branches.map((item) => item.sha));
      if (tips.size !== 1) throw new Error('branch not found or ambiguous');
      return [...tips][0];
    }
    return git(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${input}^{commit}`]);
  } catch {
    throw new Error(`candidate.${label} must identify an existing branch or Git commit`);
  }
}

function normalizeCandidate(value, repoRoot, { requireHead = false, verifyBranches = true } = {}) {
  if (!isPlainObject(value)) throw new Error('candidate must contain base and head commits');
  const base = resolveCommit(value.base, 'base', repoRoot);
  const head = resolveCommit(value.head, 'head', repoRoot);
  if (base === head) throw new Error('candidate.base and candidate.head must be different commits');
  try { git(repoRoot, ['merge-base', '--is-ancestor', base, head]); }
  catch { throw new Error('candidate.base must be an ancestor of candidate.head'); }
  const currentHead = git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (requireHead && head !== currentHead) throw new Error('candidate.head must equal the current Git HEAD');
  const headRef = value.head_ref || (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(String(value.head))
    ? String(value.head).replace(/^refs\/heads\//, '') : head === currentHead
    ? git(repoRoot, ['symbolic-ref', '--short', 'HEAD']) : branchForCommit(head, 'head', repoRoot));
  const baseRef = value.base_ref || (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(String(value.base))
    ? String(value.base).replace(/^refs\/heads\//, '') : branchForCommit(base, 'base', repoRoot));
  if (verifyBranches) {
    verifyLocalBranchTip(baseRef, base, repoRoot);
    verifyLocalBranchTip(headRef, head, repoRoot);
  }
  return { base, head, base_ref: requiredText(baseRef, 'candidate.base_ref'), head_ref: requiredText(headRef, 'candidate.head_ref') };
}

function laneTarget(ref) {
  const match = String(ref || '').match(/^#?([lr]\d+)$/i);
  if (!match) return null;
  const laneId = normalizeLaneId(match[1]);
  const record = readLane(laneId);
  if (!record) throw new Error(`Lane ${laneId} not found`);
  return { kind: 'lane', ref: `#${laneId}`, record };
}

function resolveTarget(ref) {
  const lane = laneTarget(ref);
  if (lane) return lane;
  const parsed = parseRef(ref);
  if (!parsed?.goalId || parsed.componentId || parsed.criterionId || parsed.revision) {
    throw new Error('Use a current Lane, Goal, or Task reference');
  }
  const goal = readGoalWithTasks(parsed.goalId, parsed.username || null);
  if (!goal) throw new Error(`Goal ${parsed.goalId} not found`);
  if (parsed.taskId) {
    const task = goal.tasks[parsed.taskId];
    if (!task) throw new Error(`Task ${parsed.taskId} not found in Goal ${parsed.goalId}`);
    return { kind: 'task', ref: formatRef(parsed), record: task, goal, username: parsed.username || null };
  }
  return { kind: 'goal', ref: formatRef(parsed), record: goal, goal, username: parsed.username || null };
}

function readCoveredRef(ref, target) {
  const parsed = parseRef(ref);
  if (!parsed?.goalId || parsed.componentId || parsed.criterionId || parsed.revision) {
    throw new Error(`Invalid covered work reference: ${ref}`);
  }
  const username = parsed.username || target.username || null;
  const goal = readGoalWithTasks(parsed.goalId, username);
  if (!goal) throw new Error(`Covered Goal ${ref} not found`);
  if (target.kind === 'goal' && (goal.goal_id !== target.goal.goal_id || username !== target.username)) {
    throw new Error(`Covered work ${ref} must belong to ${target.ref}`);
  }
  if (target.kind === 'task' && (parsed.goalId !== target.goal.goal_id || parsed.taskId !== target.record.task_id || username !== target.username)) {
    throw new Error(`Task review coverage must be exactly ${target.ref}`);
  }
  if (target.kind === 'lane' && goal.lane_id !== target.record.lane_id) {
    throw new Error(`Covered work ${ref} must belong to Lane ${target.ref}`);
  }
  if (parsed.taskId) {
    const task = goal.tasks[parsed.taskId];
    if (!task) throw new Error(`Covered Task ${ref} not found`);
    return { ref: formatRef({ username, goalId: parsed.goalId, taskId: parsed.taskId }), records: [task], username, goal };
  }
  const goalRef = formatRef({ username, goalId: parsed.goalId });
  // A Goal is a review unit for its required Task obligations too. Pin the
  // task contracts, while ignoring owner, status, result, and acceptance metadata.
  return { ref: goalRef, records: [goal, ...Object.values(goal.tasks)], username, goal };
}

function normalizeCoverage(target, values) {
  let refs = values;
  if (refs === undefined && target.kind === 'goal') refs = [target.ref];
  if (refs === undefined && target.kind === 'task') refs = [target.ref];
  if (!Array.isArray(refs) || refs.length === 0) {
    throw new Error(target.kind === 'lane' ? 'Lane reviews require explicit covers refs' : 'covers must be a non-empty array');
  }
  const snapshots = [];
  const coveredObligations = new Set();
  for (const value of refs) {
    const ref = requiredText(value, 'covered ref');
    const covered = readCoveredRef(ref, target);
    if (snapshots.some((item) => item.ref === covered.ref)) throw new Error(`Duplicate covered ref ${covered.ref}`);
    snapshots.push({
      ref: covered.ref,
      obligations: covered.records.map((record) => ({
        ref: record.task_id ? formatRef({ username: covered.username, goalId: covered.goal.goal_id, taskId: record.task_id }) : covered.ref,
        revision: record.revision,
        contract: contractOf(record),
        contract_hash: digest(contractOf(record)),
      })),
    });
    for (const obligation of snapshots.at(-1).obligations) {
      if (coveredObligations.has(obligation.ref)) throw new Error(`Overlapping review coverage includes ${obligation.ref} more than once`);
      coveredObligations.add(obligation.ref);
    }
  }
  return snapshots;
}

function targetAttachment(target, attachmentId, repoRoot = getRepoRoot()) {
  const attachment = attachmentsForRecord(target.record).find((item) => item.id === attachmentId);
  if (!attachment) throw new Error(`Attachment ${attachmentId} not found on ${target.ref}`);
  if (attachment.purpose !== 'cr') throw new Error(`Attachment ${attachmentId} must have purpose "cr" to request review`);
  const display = readRecordAttachment(target.record, attachmentId, { repoRoot });
  if (display.status !== 'available' || typeof display.content !== 'string') {
    throw new Error(`CR attachment ${attachmentId} must be readable Markdown to request review`);
  }
  const identity = {
    id: attachment.id, type: attachment.type, title: attachment.title, purpose: attachment.purpose,
    ...(attachment.path === undefined ? {} : { path: attachment.path }),
    ...(attachment.url === undefined ? {} : { url: attachment.url }),
    ...(attachment.host === undefined ? {} : { host: attachment.host }),
    ...(attachment.repository === undefined ? {} : { repository: attachment.repository }),
    ...(attachment.number === undefined ? {} : { number: attachment.number }),
  };
  return {
    attachment: identity,
    content: display.content,
    read_identity: { status: display.status, content_semantics: display.content_semantics },
    content_hash: digest(display.content === null ? identity : display.content),
  };
}

function reviewFile(repoRoot = getRepoRoot()) {
  return path.join(getClipsDir(repoRoot), 'db', 'reviews.jsonl');
}

function replayReviews(events) {
  const reviews = new Map();
  for (const event of events) {
    if (event.event === 'review_requested') {
      if (!isPlainObject(event.review) || typeof event.review.id !== 'string' || !REVIEW_ID.test(event.review.id)) {
        throw new Error('Corrupt review history: invalid review request');
      }
      if (reviews.has(event.review.id)) throw new Error(`Corrupt review history: duplicate review ${event.review.id}`);
      for (const id of event.supersedes || []) {
        const previous = reviews.get(id);
        if (!previous || TERMINAL_STATES.has(previous.status)) throw new Error(`Corrupt review history: cannot supersede ${id}`);
        reviews.set(id, { ...previous, status: 'superseded', superseded_reason: event.supersede_reason,
          superseded_at: event.timestamp, revision: previous.revision + 1 });
      }
      reviews.set(event.review.id, { ...event.review, status: 'awaiting_review', revision: 1 });
    } else if (event.event === 'review_decided' || event.event === 'review_superseded'
      || event.event === 'review_pr_linked' || event.event === 'review_delivered'
      || event.event === 'review_external_decision_imported') {
      const previous = reviews.get(event.review_id);
      if (!previous) throw new Error(`Corrupt review history: unknown review ${event.review_id}`);
      const update = { ...previous, revision: previous.revision + 1 };
      if (event.event === 'review_decided') Object.assign(update, { status: event.decision, decision: event.decision,
        actor: event.actor, decision_candidate: event.candidate, comment: event.comment, decided_at: event.timestamp });
      if (event.event === 'review_superseded') Object.assign(update, { status: 'superseded', superseded_reason: event.reason, superseded_at: event.timestamp });
      if (event.event === 'review_pr_linked') Object.assign(update, { pull_request: event.pull_request });
      if (event.event === 'review_delivered') Object.assign(update, { status: 'delivered', delivery: event.delivery,
        delivered_by: event.actor, delivered_at: event.timestamp });
      if (event.event === 'review_external_decision_imported') Object.assign(update, {
        status: event.decision, decision: event.decision, actor: event.provenance.login,
        decision_candidate: event.candidate, comment: event.provenance.body, decided_at: event.provenance.submitted_at,
        external_decision: event.provenance,
      });
      reviews.set(event.review_id, update);
    } else throw new Error(`Corrupt review history: unsupported event ${event.event}`);
  }
  return [...reviews.values()];
}

function readReviews(repoRoot = getRepoRoot()) {
  return replayReviews(readJsonEvents(reviewFile(repoRoot)));
}

function appendReviewEvent(event, repoRoot = getRepoRoot()) {
  const file = reviewFile(repoRoot);
  withRecordLock(file, () => {
    if (event.expected_revision !== undefined) {
      const current = replayReviews(readJsonEvents(file)).find((item) => item.id === event.review_id);
      if (!current) throw new Error(`Review ${event.review_id} not found`);
      if (current.revision !== event.expected_revision) {
        throw new Error(`Revision conflict for ${event.review_id}: expected r${event.expected_revision}, current r${current.revision}`);
      }
    }
    appendJsonEvent(file, { ...event, timestamp: new Date().toISOString() });
  });
}

function staleReasons(review, repoRoot = getRepoRoot()) {
  const reasons = [];
  let target;
  try { target = resolveTarget(review.ref); }
  catch { return ['review_target_missing']; }
  try {
    const current = targetAttachment(target, review.attachment_id, repoRoot);
    if (digest(current.attachment) !== review.attachment_identity_hash) reasons.push('attachment_changed');
    if (current.content_hash !== review.content_hash) reasons.push('attachment_content_changed');
  } catch { reasons.push('attachment_unavailable'); }
  try {
    const coverage = normalizeCoverage(target, review.covers);
    const prior = new Map(review.coverage_snapshots.flatMap((snapshot) => snapshot.obligations.map((item) => [item.ref, item.contract_hash])));
    for (const snapshot of coverage) for (const obligation of snapshot.obligations) {
      if (prior.get(obligation.ref) !== obligation.contract_hash) reasons.push(`contract_changed:${obligation.ref}`);
    }
    if (prior.size !== coverage.reduce((sum, snapshot) => sum + snapshot.obligations.length, 0)) reasons.push('coverage_changed');
  } catch { reasons.push('coverage_unavailable'); }
  if (target.kind === 'lane') {
    const currentTarget = canonical({ title: target.record.title, description: target.record.description,
      product_goals: target.record.product_goals || [] });
    if (digest(currentTarget) !== review.target_contract_hash) reasons.push('lane_contract_changed');
  }
  try {
    const base = resolveCommit(review.candidate.base, 'base', repoRoot);
    const head = resolveCommit(review.candidate.head, 'head', repoRoot);
    const currentHead = git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
    if (head !== currentHead) reasons.push('candidate_head_moved');
    try { verifyLocalBranchTip(review.candidate.base_ref, base, repoRoot); }
    catch { reasons.push('candidate_base_moved'); }
    try { verifyLocalBranchTip(review.candidate.head_ref, head, repoRoot); }
    catch { reasons.push('candidate_head_moved'); }
  } catch { reasons.push('candidate_unavailable'); }
  return [...new Set(reasons)];
}

function publicReview(review, { detail = false, repoRoot = getRepoRoot() } = {}) {
  // A delivered record is a historical receipt for its pinned artifact. Later
  // branch movement cannot invalidate that delivery evidence retroactively.
  const stale = review.status === 'delivered' ? [] : staleReasons(review, repoRoot);
  const result = {
    id: review.id,
    ref: review.ref,
    title: review.title,
    status: review.status,
    attachment_id: review.attachment_id,
    reviewer: review.reviewer,
    candidate: review.candidate,
    covers: review.covers,
    summary: review.summary,
    validation: review.validation,
    ...(review.delivery_intent ? { delivery_intent: review.delivery_intent } : {}),
    revision: review.revision,
    created_at: review.created_at,
    stale: stale.length > 0,
    stale_reasons: stale,
    ...(review.decision ? { decision: review.decision, actor: review.actor, comment: review.comment, decided_at: review.decided_at } : {}),
    ...(review.delivery ? { delivery: review.delivery, delivered_by: review.delivered_by, delivered_at: review.delivered_at } : {}),
    ...(review.pull_request ? { pull_request: review.pull_request } : {}),
    ...(review.external_decision ? { external_decision: review.external_decision } : {}),
  };
  if (!detail) return result;
  let attachment;
  try {
    const target = resolveTarget(review.ref);
    const current = targetAttachment(target, review.attachment_id, repoRoot);
    attachment = {
      id: review.attachment_id,
      purpose: 'cr',
      title: review.title,
      content: review.content_snapshot,
      current_content: current.content,
      read_identity: { pinned: review.content_read_identity, current: current.read_identity },
      content_identity: { sha256: review.content_hash, current_sha256: current.content_hash },
    };
  } catch (error) {
    attachment = { id: review.attachment_id, purpose: 'cr', content: review.content_snapshot, current_content: null,
      read_identity: { pinned: review.content_read_identity, current: { status: 'unavailable', error: error.message } },
      content_identity: { sha256: review.content_hash, current_sha256: null } };
  }
  return { ...result, attachment, content_identity: { sha256: review.content_hash }, coverage_snapshots: review.coverage_snapshots };
}

export function listReviews({ repoRoot = getRepoRoot() } = {}) {
  return { reviews: readReviews(repoRoot).map((review) => publicReview(review, { repoRoot })) };
}

export function showReview(id, { repoRoot = getRepoRoot() } = {}) {
  if (!REVIEW_ID.test(String(id))) throw new Error(`Invalid review id: ${id}`);
  const review = readReviews(repoRoot).find((item) => item.id === id);
  if (!review) throw new Error(`Review ${id} not found`);
  return publicReview(review, { detail: true, repoRoot });
}

export function requestReview(ref, input, { repoRoot = getRepoRoot() } = {}) {
  if (!isPlainObject(input)) throw new Error('Review request must be a JSON object');
  const target = resolveTarget(ref);
  const reviewer = requiredText(input.reviewer, 'reviewer');
  const summary = requiredText(input.summary, 'summary');
  if (!Object.hasOwn(input, 'validation')) throw new Error('validation is required');
  const candidate = normalizeCandidate(input.candidate, repoRoot, { requireHead: true });
  const delivery = input.delivery === undefined ? null : input.delivery;
  if (delivery !== null && !isPlainObject(delivery)) throw new Error('delivery must be a JSON object when provided');
  const pinned = targetAttachment(target, input.attachment_id, repoRoot);
  const coverageSnapshots = normalizeCoverage(target, input.covers);
  const covers = coverageSnapshots.map((item) => item.ref);
  const targetContract = target.kind === 'lane' ? canonical({
    title: target.record.title, description: target.record.description, product_goals: target.record.product_goals || [],
  }) : null;
  const currentHead = git(repoRoot, ['rev-parse', '--verify', 'HEAD^{commit}']);
  const review = {
    id: `rev-${randomUUID()}`,
    ref: target.ref,
    title: pinned.attachment.title,
    attachment_id: input.attachment_id,
    attachment_identity_hash: digest(pinned.attachment),
    reviewer,
    candidate,
    covers,
    coverage_snapshots: coverageSnapshots,
    summary,
    validation: input.validation,
    delivery_intent: delivery,
    content_hash: pinned.content_hash,
    content_snapshot: pinned.content,
    content_read_identity: pinned.read_identity,
    target_contract: targetContract,
    target_contract_hash: targetContract ? digest(targetContract) : null,
    created_at: new Date().toISOString(),
  };
  const file = reviewFile(repoRoot);
  let result;
  withRecordLock(file, () => {
    const reviews = replayReviews(readJsonEvents(file));
    const exactIntent = (item) => item.ref === review.ref
      && digest(item.covers) === digest(review.covers)
      && digest(item.coverage_snapshots.map((snapshot) => snapshot.obligations.map((obligation) => obligation.contract_hash)))
        === digest(review.coverage_snapshots.map((snapshot) => snapshot.obligations.map((obligation) => obligation.contract_hash)))
      && item.candidate.base === candidate.base && item.candidate.head === candidate.head
      && item.candidate.base_ref === candidate.base_ref && item.candidate.head_ref === candidate.head_ref
      && item.attachment_id === review.attachment_id
      && item.attachment_identity_hash === review.attachment_identity_hash && item.content_hash === review.content_hash
      && item.reviewer === reviewer && item.summary === summary
      && digest(item.validation) === digest(review.validation) && digest(item.delivery_intent ?? null) === digest(delivery);
    const duplicate = reviews.find(exactIntent);
    if (duplicate) { result = publicReview(duplicate, { repoRoot }); return; }

    const newObligations = new Set(coverageSnapshots.flatMap((snapshot) => snapshot.obligations.map((item) => item.ref)));
    const supersedes = [];
    for (const existing of reviews) {
      if (TERMINAL_STATES.has(existing.status)) continue;
      const obligations = new Set(existing.coverage_snapshots.flatMap((snapshot) => snapshot.obligations.map((item) => item.ref)));
      const overlap = [...obligations].filter((item) => newObligations.has(item));
      if (!overlap.length) continue;
      const uncovered = [...obligations].filter((item) => !newObligations.has(item));
      if (uncovered.length) {
        throw new Error(`Review ${existing.id} overlaps this request but also covers ${uncovered.join(', ')}; include the uncovered obligations or resolve that review first`);
      }
      supersedes.push(existing.id);
    }
    const supersedeReason = `A new review request fully covers ${covers.join(', ')}`;
    appendJsonEvent(file, { event: 'review_requested', review, ...(supersedes.length ? { supersedes, supersede_reason: supersedeReason } : {}),
      timestamp: new Date().toISOString() });
    result = publicReview({ ...review, status: 'awaiting_review', revision: 1 }, { repoRoot });
  });
  return result;
}

export function decideReview(id, input, { repoRoot = getRepoRoot() } = {}) {
  if (!isPlainObject(input)) throw new Error('Review decision must be a JSON object');
  const reviews = readReviews(repoRoot);
  const current = reviews.find((item) => item.id === id);
  if (!current) throw new Error(`Review ${id} not found`);
  if (!REVIEWABLE_STATES.has(current.status)) throw new Error(`Review ${id} is not actionable (status: ${current.status})`);
  if (input.expected_revision !== undefined && input.expected_revision !== current.revision) {
    throw new Error(`Revision conflict for ${id}: expected r${input.expected_revision}, current r${current.revision}`);
  }
  const actor = requiredText(input.actor, 'actor');
  if (actor !== current.reviewer) throw new Error(`Decision actor must match the assigned reviewer (${current.reviewer})`);
  if (!DECISIONS.has(input.decision)) throw new Error(`decision must be one of: ${[...DECISIONS].join(', ')}`);
  const candidate = normalizeCandidate(input.candidate, repoRoot, { verifyBranches: false });
  if (candidate.base !== current.candidate.base || candidate.head !== current.candidate.head) {
    throw new Error('Decision candidate must exactly match the reviewed base and head commits');
  }
  const reasons = staleReasons(current, repoRoot);
  if (reasons.length) {
    appendReviewEvent({ event: 'review_superseded', review_id: current.id, expected_revision: current.revision,
      reason: `Stale review: ${reasons.join(', ')}` }, repoRoot);
    throw new Error(`Review ${id} is stale: ${reasons.join(', ')}`);
  }
  const comment = input.comment === undefined ? '' : String(input.comment);
  appendReviewEvent({ event: 'review_decided', review_id: id, decision: input.decision, actor,
    candidate, comment, expected_revision: current.revision }, repoRoot);
  return publicReview(readReviews(repoRoot).find((item) => item.id === id), { repoRoot });
}

export function previewReviewPr(id, { repoRoot = getRepoRoot() } = {}) {
  const detail = showReview(id, { repoRoot });
  if (detail.stale) throw new Error(`Review ${id} is stale: ${detail.stale_reasons.join(', ')}`);
  const body = [
    detail.attachment.content ? detail.attachment.content.trim() : `# ${detail.title}`,
    '',
    detail.summary,
    '',
    '## Validation',
    typeof detail.validation === 'string' ? detail.validation : JSON.stringify(detail.validation, null, 2),
    '',
    '## Covered work',
    ...detail.covers.map((ref) => `- ${ref}`),
  ].join('\n');
  return { review_id: id, title: detail.title, body, base: detail.candidate.base,
    head: detail.candidate.head, base_ref: detail.candidate.base_ref, head_ref: detail.candidate.head_ref,
    covers: detail.covers, link: { type: 'github_pr', url: null }, status: detail.status };
}

export function materializeReviewPr(id, { confirmed = false, repoRoot = getRepoRoot(), spawn = spawnSync } = {}) {
  if (!confirmed) throw new Error('PR materialization requires the explicit --confirm flag');
  const current = readReviews(repoRoot).find((item) => item.id === id);
  if (!current) throw new Error(`Review ${id} not found`);
  if (!REVIEWABLE_STATES.has(current.status) && current.status !== 'approved') {
    throw new Error(`Review ${id} cannot materialize a PR in status ${current.status}`);
  }
  if (current.pull_request) return { ...previewReviewPr(id, { repoRoot }), link: current.pull_request.url,
    pull_request: current.pull_request, status: current.status };
  const preview = previewReviewPr(id, { repoRoot });
  const config = readConfig(repoRoot, { strict: true });
  if (config.collaboration !== true) throw new Error('GitHub collaboration is disabled; enable with lanes config collaboration true');
  if (!['draft', 'ready'].includes(config.lane_pr_mode)) {
    throw new Error(`lane_pr_mode '${config.lane_pr_mode}' does not authorize PR materialization; use draft or ready`);
  }
  verifyBranchTip(current.candidate.base_ref, current.candidate.base, repoRoot, { requireLocal: true });
  verifyBranchTip(current.candidate.head_ref, current.candidate.head, repoRoot, { requireLocal: true });
  const args = ['pr', 'create', '--title', preview.title, '--body', preview.body,
    '--base', preview.base_ref, '--head', preview.head_ref];
  if (config.lane_pr_mode === 'draft') args.push('--draft');
  const result = spawn('gh', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw new Error(`Unable to run gh pr create: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`gh pr create failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
  const url = String(result.stdout || '').trim().split(/\s+/).find((part) => /^https:\/\//i.test(part));
  if (!url) throw new Error('gh pr create did not return a pull request URL');
  const pullRequest = { type: 'github_pr', url, mode: config.lane_pr_mode, candidate: current.candidate };
  appendReviewEvent({ event: 'review_pr_linked', review_id: id, expected_revision: current.revision,
    pull_request: pullRequest }, repoRoot);
  return { ...preview, link: url, pull_request: pullRequest, status: current.status };
}

export function importReviewPrDecision(id, eventId, { repoRoot = getRepoRoot(), spawn = spawnSync } = {}) {
  const selectedEventId = requiredText(eventId, 'GitHub review event ID');
  const current = readReviews(repoRoot).find((item) => item.id === id);
  if (!current) throw new Error(`Review ${id} not found`);
  const prior = readJsonEvents(reviewFile(repoRoot)).find((event) =>
    event.event === 'review_external_decision_imported' && event.provenance.event_id === selectedEventId);
  if (prior && prior.review_id !== id) throw new Error(`GitHub review event ${selectedEventId} was already imported for another local review`);
  if (!current.pull_request?.url) throw new Error(`Review ${id} has no linked GitHub pull request`);
  if (!REVIEWABLE_STATES.has(current.status) && !prior) throw new Error(`Review ${id} is not actionable (status: ${current.status})`);
  const stale = staleReasons(current, repoRoot);
  if (stale.length) throw new Error(`Review ${id} is stale: ${stale.join(', ')}`);
  const prUrl = new URL(current.pull_request.url);
  const match = prUrl.hostname.toLowerCase() === 'github.com'
    ? prUrl.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?$/) : null;
  if (prUrl.protocol !== 'https:' || !match || prUrl.username || prUrl.password) {
    throw new Error('Linked pull request must be an HTTPS github.com pull request URL');
  }
  const query = 'query($id:ID!){node(id:$id){... on PullRequestReview{id author{login} state commit{oid} submittedAt body pullRequest{url baseRefOid headRefOid}}}}';
  const result = spawn('gh', ['api', 'graphql', '-f', `query=${query}`, '-F', `id=${selectedEventId}`], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`Unable to run read-only gh api graphql: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`gh api graphql failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
  let payload;
  try { payload = JSON.parse(result.stdout || ''); } catch { throw new Error('gh api graphql returned invalid JSON'); }
  if (payload.errors?.length) throw new Error(`GitHub review query failed: ${payload.errors.map((error) => error.message).join('; ')}`);
  const external = payload.data?.node;
  if (!external || external.id !== selectedEventId || !external.pullRequest) throw new Error(`GitHub review event ${selectedEventId} was not found`);
  const pr = external.pullRequest;
  if (pr.url !== current.pull_request.url) throw new Error('GitHub pull request URL does not match the linked review surface');
  if (pr.baseRefOid !== current.candidate.base || pr.headRefOid !== current.candidate.head) {
    throw new Error('GitHub pull request base/head commits do not match the pinned local candidate');
  }
  if (typeof external.author?.login !== 'string' || external.author.login.toLowerCase() !== current.reviewer.toLowerCase()) {
    throw new Error(`GitHub review actor must match assigned reviewer ${current.reviewer}`);
  }
  if (external.commit?.oid !== current.candidate.head) throw new Error('GitHub review event commit does not match the pinned candidate head');
  const decisions = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes_requested' };
  const decision = decisions[external.state];
  if (!decision) throw new Error('GitHub review event must be APPROVED or CHANGES_REQUESTED');
  if (typeof external.submittedAt !== 'string' || !Number.isFinite(Date.parse(external.submittedAt))) {
    throw new Error('GitHub review event is missing valid submittedAt provenance');
  }
  const provenance = { provider: 'github', event_id: selectedEventId, login: external.author.login,
    state: external.state, submitted_at: external.submittedAt, commit: external.commit.oid,
    pull_request_url: pr.url, body: external.body || '' };
  const file = reviewFile(repoRoot);
  let alreadyImported = false;
  withRecordLock(file, () => {
    const latest = replayReviews(readJsonEvents(file)).find((item) => item.id === id);
    if (!latest) throw new Error(`Review ${id} not found`);
    const replayed = readJsonEvents(file).find((event) => event.event === 'review_external_decision_imported'
      && event.provenance.event_id === selectedEventId);
    if (replayed) {
      if (replayed.review_id !== id) throw new Error(`GitHub review event ${selectedEventId} was already imported for another local review`);
      if (digest(replayed.provenance) !== digest(provenance) || replayed.decision !== decision
        || digest(replayed.candidate) !== digest(latest.candidate)) {
        throw new Error(`GitHub review event ${selectedEventId} changed since it was imported`);
      }
      alreadyImported = true;
      return;
    }
    if (latest.revision !== current.revision) throw new Error(`Revision conflict for ${id}: expected r${current.revision}, current r${latest.revision}`);
    if (!REVIEWABLE_STATES.has(latest.status)) throw new Error(`Review ${id} is not actionable (status: ${latest.status})`);
    const latestStale = staleReasons(latest, repoRoot);
    if (latestStale.length) throw new Error(`Review ${id} is stale: ${latestStale.join(', ')}`);
    appendJsonEvent(file, { event: 'review_external_decision_imported', review_id: id, decision,
      actor: external.author.login, candidate: latest.candidate, provenance, comment: external.body || '',
      timestamp: new Date().toISOString() });
  });
  if (alreadyImported) return publicReview(readReviews(repoRoot).find((item) => item.id === id), { repoRoot });
  return publicReview(readReviews(repoRoot).find((item) => item.id === id), { repoRoot });
}

export function completeReview(id, input, { repoRoot = getRepoRoot() } = {}) {
  if (!isPlainObject(input)) throw new Error('Review completion must be a JSON object');
  const current = readReviews(repoRoot).find((item) => item.id === id);
  if (!current) throw new Error(`Review ${id} not found`);
  if (current.status !== 'approved') throw new Error(`Review ${id} must be approved before delivery completion`);
  if (input.expected_revision !== undefined && input.expected_revision !== current.revision) {
    throw new Error(`Revision conflict for ${id}: expected r${input.expected_revision}, current r${current.revision}`);
  }
  const actor = requiredText(input.actor, 'actor');
  const candidate = normalizeCandidate(input.candidate, repoRoot, { verifyBranches: false });
  if (candidate.base !== current.candidate.base || candidate.head !== current.candidate.head) {
    throw new Error('Completion candidate must exactly match the approved base and head commits');
  }
  if (!isPlainObject(input.endpoint) || !['github_pr', 'url', 'git'].includes(input.endpoint.type)) {
    throw new Error('endpoint.type must be github_pr, url, or git');
  }
  let endpoint;
  if (input.endpoint.type === 'git') {
    if (Object.keys(input.endpoint).some((key) => !['type', 'ref', 'commit'].includes(key))) {
      throw new Error('git endpoint accepts only type, ref, and commit');
    }
    const ref = requiredText(input.endpoint.ref, 'endpoint.ref');
    const commit = requiredText(input.endpoint.commit, 'endpoint.commit');
    let branch;
    try { branch = git(repoRoot, ['check-ref-format', '--branch', ref]); }
    catch { throw new Error('endpoint.ref must be a local Git branch name'); }
    if (branch !== ref) throw new Error('endpoint.ref must be a local Git branch name');
    let deliveredCommit;
    try { deliveredCommit = git(repoRoot, ['rev-parse', '--verify', '--end-of-options', `refs/heads/${branch}^{commit}`]); }
    catch { throw new Error(`Local delivery branch ${branch} was not found`); }
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commit) || commit !== deliveredCommit) {
      throw new Error('endpoint.commit must exactly match the current local delivery branch tip');
    }
    const approvedHead = current.candidate.head;
    try { git(repoRoot, ['merge-base', '--is-ancestor', approvedHead, deliveredCommit]); }
    catch { throw new Error('Local delivery commit must contain the approved candidate head'); }
    const approvedTree = git(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${approvedHead}^{tree}`]);
    const deliveredTree = git(repoRoot, ['rev-parse', '--verify', '--end-of-options', `${deliveredCommit}^{tree}`]);
    if (approvedTree !== deliveredTree) throw new Error('Local delivery commit tree must exactly match the approved candidate tree');
    const reasons = staleReasons(current, repoRoot).filter((reason) => !['candidate_head_moved', 'candidate_base_moved'].includes(reason));
    if (reasons.length) throw new Error(`Review ${id} is stale: ${reasons.join(', ')}`);
    endpoint = { type: 'git', ref: branch, commit: deliveredCommit, approved_head: approvedHead, tree: approvedTree };
  } else {
    const reasons = staleReasons(current, repoRoot);
    if (reasons.length) throw new Error(`Review ${id} is stale: ${reasons.join(', ')}`);
    if (Object.keys(input.endpoint).some((key) => !['type', 'url'].includes(key))) {
      throw new Error('URL endpoint accepts only type and url');
    }
    const endpointUrl = requiredText(input.endpoint.url, 'endpoint.url');
    let parsedUrl;
    try { parsedUrl = new URL(endpointUrl); } catch { throw new Error('endpoint.url must be an absolute HTTP or HTTPS URL'); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
      throw new Error('endpoint.url must be an absolute HTTP or HTTPS URL');
    }
    if (input.endpoint.type === 'github_pr'
      && (parsedUrl.protocol !== 'https:' || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*\/?$/.test(parsedUrl.pathname))) {
      throw new Error('github_pr endpoint must be an HTTPS pull request URL');
    }
    endpoint = { type: input.endpoint.type, url: parsedUrl.toString() };
  }
  appendReviewEvent({ event: 'review_delivered', review_id: id, expected_revision: current.revision,
    actor, candidate, delivery: endpoint }, repoRoot);
  return publicReview(readReviews(repoRoot).find((item) => item.id === id), { repoRoot });
}
