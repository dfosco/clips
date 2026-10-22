import {
  appendEvent, formatRef, getRepoRoot, parseRef, readGoalWithTasks,
} from '../lib/core.js';
import { readJsonInput } from '../lib/json-input.js';
import { appendLaneEvent, normalizeLaneId, readLane } from '../lib/lanes.js';
import {
  newAttachmentId, normalizeAttachmentInput, readRecordAttachment,
} from '../lib/attachments.js';

function laneRef(ref) {
  const match = String(ref || '').match(/^#?([lr]\d+)(?:#r(\d+))?$/i);
  if (!match) return null;
  return { laneId: normalizeLaneId(match[1]), revision: match[2] ? Number(match[2]) : undefined };
}

function resolveRecord(ref, { write = false } = {}) {
  const lane = laneRef(ref);
  if (lane) {
    if (write && lane.revision !== undefined) throw new Error('Attachment changes require a current Lane reference, not a historical revision');
    const record = readLane(lane.laneId, undefined, lane.revision === undefined ? {} : { revision: lane.revision });
    if (!record) throw new Error(`Lane ${lane.laneId} not found`);
    return { kind: 'lane', ref: `#${lane.laneId}`, record };
  }

  const parsed = parseRef(ref);
  if (!parsed || !parsed.goalId || parsed.componentId || parsed.criterionId) {
    throw new Error('Use a Lane, Goal, or Task reference: #l1, #g1, or #g1#t1');
  }
  if (write && parsed.revision !== undefined) throw new Error('Attachment changes require a current Goal or Task reference, not a historical revision');
  const options = parsed.taskId
    ? (parsed.revision === undefined ? {} : { taskId: parsed.taskId, taskRevision: parsed.revision })
    : (parsed.revision === undefined ? {} : { revision: parsed.revision });
  const goal = readGoalWithTasks(parsed.goalId, parsed.username, options);
  if (!goal) throw new Error(`Goal ${parsed.goalId} not found`);
  const record = parsed.taskId ? goal.tasks[parsed.taskId] : goal;
  if (!record) throw new Error(`Task ${formatRef(parsed)} not found`);
  return {
    kind: parsed.taskId ? 'task' : 'goal',
    ref: formatRef({ username: parsed.username, goalId: parsed.goalId, taskId: parsed.taskId }),
    record,
    goal,
    username: parsed.username,
  };
}

function appendAttachmentEvent(target, event, expectedRevision) {
  const expected = expectedRevision ?? target.record.revision;
  if (target.kind === 'lane') {
    appendLaneEvent(target.record.lane_id, event, undefined, { expectedRevision: expected });
    return { revision: target.record.revision + 1 };
  }
  appendEvent(target.goal.goal_id, {
    ...event,
    goal_id: target.goal.goal_id,
    ...(target.kind === 'task' ? { task_id: target.record.task_id } : {}),
    timestamp: new Date().toISOString(),
  }, { username: target.username, expectedRevision: expected });
  return {
    revision: target.record.revision + 1,
    ...(target.kind === 'task' ? { goal_revision: target.goal.revision + 1 } : {}),
  };
}

function addAttachment(ref, input) {
  const target = resolveRecord(ref, { write: true });
  const repoRoot = getRepoRoot();
  const { attachment: normalized, expectedRevision } = normalizeAttachmentInput(input, { repoRoot });
  const attachment = { id: newAttachmentId(), ...normalized };
  const revision = appendAttachmentEvent(target, {
    event: 'attachment_added',
    attachment,
  }, expectedRevision);
  console.log(JSON.stringify({ success: true, ref: target.ref, attachment, ...revision }));
}

function listAttachments(ref) {
  const target = resolveRecord(ref);
  console.log(JSON.stringify({
    ref: target.ref,
    revision: target.record.revision,
    content_semantics: 'Markdown content is read from the current file, including for historical record revisions.',
    attachments: target.record.attachments || [],
  }, null, 2));
}

function readAttachment(ref, id) {
  const target = resolveRecord(ref);
  const attachment = (target.record.attachments || []).find((item) => item.id === id);
  if (!attachment) throw new Error(`Attachment ${id} not found on ${target.ref}`);
  const display = readRecordAttachment(target.record, id, { repoRoot: getRepoRoot() });
  console.log(JSON.stringify({
    ref: target.ref,
    revision: target.record.revision,
    attachment: display,
  }, null, 2));
}

function parseExpectedRevision(args) {
  let expectedRevision;
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '--expected-revision' || expectedRevision !== undefined || !/^(0|[1-9]\d*)$/.test(args[index + 1] || '')) {
      throw new Error('Use --expected-revision <non-negative integer> at most once');
    }
    expectedRevision = Number(args[++index]);
    if (!Number.isSafeInteger(expectedRevision)) throw new Error('expected_revision must be a non-negative integer');
  }
  return expectedRevision;
}

function detachAttachment(ref, id, args) {
  const target = resolveRecord(ref, { write: true });
  const attachment = (target.record.attachments || []).find((item) => item.id === id);
  if (!attachment) throw new Error(`Attachment ${id} not found on ${target.ref}`);
  if (attachment.source === 'legacy') {
    throw new Error('Legacy GitHub attachments are read-only here; detach managed links using the existing collaboration command');
  }
  const expectedRevision = parseExpectedRevision(args);
  const revision = appendAttachmentEvent(target, {
    event: 'attachment_removed',
    attachment_id: id,
  }, expectedRevision);
  console.log(JSON.stringify({ success: true, ref: target.ref, attachment_id: id, ...revision }));
}

export function runAttachmentCommand(args) {
  const [action, ...rest] = args;
  if (action === 'add') {
    if (rest.length < 2) throw new Error('Usage: lanes attachment add <record-ref> <JSON|--file path|--stdin>');
    addAttachment(rest[0], readJsonInput(rest.slice(1)));
    return;
  }
  if (action === 'list') {
    if (rest.length !== 1) throw new Error('Usage: lanes attachment list <record-ref>');
    listAttachments(rest[0]);
    return;
  }
  if (action === 'read') {
    if (rest.length !== 2) throw new Error('Usage: lanes attachment read <record-ref> <attachment-id>');
    readAttachment(rest[0], rest[1]);
    return;
  }
  if (action === 'detach') {
    if (rest.length < 2) throw new Error('Usage: lanes attachment detach <record-ref> <attachment-id> [--expected-revision n]');
    detachAttachment(rest[0], rest[1], rest.slice(2));
    return;
  }
  console.log(`Usage: lanes attachment <command> [args]

Commands:
  add <record-ref> <JSON|--file path|--stdin>  Add a live reference
  list <record-ref>                            List attached references
  read <record-ref> <attachment-id>            Read Markdown or remote metadata
  detach <record-ref> <attachment-id>          Remove only the association

Attachment JSON types:
  markdown      { "type": "markdown", "path": "docs/plan.md", "title": "Plan", "purpose": "cr" }
  url           { "type": "url", "url": "https://example.com/design", "purpose": "adr" }
  github_issue  { "type": "github_issue", "url": "https://github.com/org/repo/issues/12", "purpose": "cr" }
  github_pr     { "type": "github_pr", "url": "https://github.com/org/repo/pull/13", "purpose": "adr" }

Purpose is optional. Supported values are cr and adr; attachments without a
purpose retain their existing behavior.

Markdown reads always use the current file. Historical record refs retain reference
metadata but do not retain document contents. URLs are never fetched. Attachment
changes do not enable collaboration or publish to GitHub.`);
}
