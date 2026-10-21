// Goal management commands
import fs from 'fs';
import { appendEvent, readGoalWithTasks, getClipsDbDir, getClipsRecordsDir, getGoalFilePath, getCurrentCommitSha, normalizeGoalId as canonicalGoalId, parseRef } from '../lib/core.js';
import { autoSyncGoal } from '../lib/sync.js';
import { reportAutoSyncResult } from './sync-output.js';
import { planningBehaviorFields } from '../lib/behavior.js';
import { discoverGoals } from '../lib/goal-discovery.js';
import { adrRecordExists, goalTypeFields, normalizeAdrId } from '../lib/goal-type.js';
import { validateTrack } from '../lib/tracks.js';
import { laneToTrackId, trackToLaneId, validateLane } from '../lib/lanes.js';
import { acceptanceFields, invalidateAcceptanceFields, referenceList, requestSnapshot, validateWorkInput, workFields } from '../lib/work-fields.js';
import { readJsonInput } from '../lib/json-input.js';
import { resolveComponentBasis } from '../lib/component-basis.js';

function goalTarget(ref, { write = false } = {}) {
  const parsed = parseRef(ref);
  if (!parsed?.goalId || parsed.taskId || parsed.componentId || parsed.criterionId) throw new Error('Provide a goal reference');
  if (write && parsed.revision != null) throw new Error('Historical goal revisions are read-only; use expected_revision on an update');
  return { goalId: parsed.goalId, username: parsed.username || null, revision: parsed.revision };
}

function goalDependencies(refs, target) {
  const parseDependency = (ref, context) => {
    const parsed = goalTarget(ref);
    const username = parsed.username || context.username || null;
    return { ...parsed, username, goalId: canonicalGoalId(parsed.goalId, username) };
  };
  const parsedRefs = referenceList(refs, 'blocked_by').map((ref) => parseDependency(ref, target));
  const key = ({ goalId, username }) => getGoalFilePath(goalId, username);
  const keys = parsedRefs.map(key);
  if (new Set(keys).size !== keys.length) throw new Error('Duplicate goal dependency');
  for (const dependency of parsedRefs) {
    if (dependency.revision != null) throw new Error('Dependencies must refer to current goals, not historical revisions');
    if (key(dependency) === key(target)) throw new Error('A goal cannot block itself');
    if (!readGoalWithTasks(dependency.goalId, dependency.username)) throw new Error(`Blocking goal ${dependency.goalId} not found`);
    const seen = new Set();
    const visit = (current) => {
      if (key(current) === key(target)) throw new Error('Goal dependency cycle');
      if (seen.has(key(current))) return;
      seen.add(key(current));
      for (const upstream of readGoalWithTasks(current.goalId, current.username)?.blocked_by || []) visit(parseDependency(upstream, current));
    };
    visit(dependency);
  }
  return parsedRefs.map(({ goalId, username }) => username ? `#${username}#${goalId}` : goalId);
}

function expectedRevision(data, current) {
  if (Object.hasOwn(data, 'expected_revision') && (!Number.isSafeInteger(data.expected_revision) || data.expected_revision < 0)) {
    throw new Error('expected_revision must be a non-negative integer');
  }
  return data.expected_revision ?? current?.revision ?? 0;
}

function syncGoal(goalId, username) {
  // Explicit other-user records must not accidentally synchronize a local goal
  // with the same numeric ID. The sync command owns namespaced synchronization.
  if (username) return;
  const result = autoSyncGoal(goalId);
  reportAutoSyncResult(result, `#${goalId}`);
}

function goalLaneFields(data) {
  if (Object.hasOwn(data, 'lane_id')) {
    if (data.lane_id == null) return { lane_id: null, track_id: null };
    const laneId = validateLane(data.lane_id);
    return { lane_id: laneId, track_id: laneToTrackId(laneId) };
  }
  if (Object.hasOwn(data, 'track_id')) {
    const trackId = validateTrack(data.track_id);
    return { track_id: trackId, lane_id: trackId ? trackToLaneId(trackId) : null };
  }
  return {};
}

function generateId() {
  const clipsDbDir = getClipsDbDir();
  if (!fs.existsSync(clipsDbDir)) {
    return 'g001';
  }
  
  const sequentialIds = discoverGoals(clipsDbDir)
    .map(({ goalId }) => goalId)
    .filter(id => /^g\d+$/.test(id))
    .map(id => parseInt(id.replace('g', ''), 10));
  
  const maxId = sequentialIds.length > 0 ? Math.max(...sequentialIds) : 0;
  const nextId = maxId + 1;
  return `g${nextId.toString().padStart(3, '0')}`;
}

function createGoal(data) {
  validateWorkInput(data, { kind: 'goal' });
  const clipsDbDir = getClipsDbDir();
  const goalId = generateId();
  const event = {
    event: 'goal_created',
    goal_id: goalId,
    timestamp: new Date().toISOString(),
    ...workFields(data, {}, { kind: 'goal', creating: true }),
    ...goalLaneFields(data),
    blocked_by: goalDependencies(Object.hasOwn(data, 'blocked_by') ? data.blocked_by : [], { goalId, username: null }),
    ...goalTypeFields(data, { defaultType: true }),
    ...planningBehaviorFields(data, { defaultMode: true }),
    status: 'open'
  };
  
  if (!fs.existsSync(clipsDbDir)) {
    fs.mkdirSync(clipsDbDir, { recursive: true });
  }
  
  appendEvent(goalId, event, { expectedRevision: expectedRevision(data, null) });
  syncGoal(goalId, null);
  const synced = readGoalWithTasks(goalId);
  const result = { success: true, goal_id: goalId };
  if (synced && synced.issue_number) result.issue_number = synced.issue_number;
  console.log(JSON.stringify(result));
  return goalId;
}

function updateGoal(goalId, data) {
  const { goalId: normalizedId, username } = goalTarget(goalId, { write: true });
  const goal = readGoalWithTasks(normalizedId, username);
  if (!goal) throw new Error(`Goal ${normalizedId} not found`);
  validateWorkInput(data, { kind: 'goal' });
  const typeFields = goalTypeFields(data);
  const behaviorFields = planningBehaviorFields(data);
  const updateFields = { ...workFields(data, goal, { kind: 'goal' }), ...typeFields, ...behaviorFields };
  Object.assign(updateFields, goalLaneFields(data));
  if (Object.hasOwn(data, 'blocked_by')) updateFields.blocked_by = goalDependencies(data.blocked_by, { goalId: normalizedId, username });
  const event = {
    event: 'updated',
    goal_id: normalizedId,
    timestamp: new Date().toISOString(),
    ...updateFields,
    ...invalidateAcceptanceFields(goal, updateFields, { kind: 'goal' }),
  };
  appendEvent(normalizedId, event, { username, expectedRevision: expectedRevision(data, goal) });
  syncGoal(normalizedId, username);
  console.log(JSON.stringify({ success: true, goal_id: normalizedId }));
}

function changeStatus(goalId, status) {
  const { goalId: normalizedId, username } = goalTarget(goalId, { write: true });
  const validStatuses = ['open', 'in_progress', 'closed', 'not_planned', 'duplicate'];
  
  if (!validStatuses.includes(status)) {
    console.error(JSON.stringify({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` }));
    process.exit(1);
  }

  const goal = readGoalWithTasks(normalizedId, username);
  if (!goal) throw new Error(`Goal ${normalizedId} not found`);
  
  const event = {
    event: 'status_changed',
    goal_id: normalizedId,
    timestamp: new Date().toISOString(),
    status: status,
    commit_sha: status === 'closed' ? getCurrentCommitSha() : null,
    ...(status !== 'closed' ? invalidateAcceptanceFields(goal, {}, { kind: 'goal', force: true, reason: `Status changed to ${status}` }) : {}),
  };
  event.status = status;
  appendEvent(normalizedId, event, { username, expectedRevision: goal.revision });
  syncGoal(normalizedId, username);
  console.log(JSON.stringify({ success: true, goal_id: normalizedId, status: status }));
}

function attachAdr(goalId, adrId) {
  const { goalId: normalizedId, username } = goalTarget(goalId, { write: true });
  const goal = readGoalWithTasks(normalizedId, username);
  if (!goal) throw new Error(`Goal ${normalizedId} not found`);

  const normalizedAdrId = normalizeAdrId(adrId);
  const recordsDir = getClipsRecordsDir('adr');
  if (!adrRecordExists(recordsDir, normalizedAdrId)) throw new Error(`${normalizedAdrId} not found in ${recordsDir}`);

  appendEvent(normalizedId, {
    event: 'adr_attached',
    goal_id: normalizedId,
    timestamp: new Date().toISOString(),
    adr_id: normalizedAdrId,
  }, { username, expectedRevision: goal.revision });
  syncGoal(normalizedId, username);
  console.log(JSON.stringify({ success: true, goal_id: normalizedId, adr_id: normalizedAdrId }));
}

function acceptGoal(goalRef, receipt) {
  const { goalId, username } = goalTarget(goalRef, { write: true });
  const goal = readGoalWithTasks(goalId, username);
  if (!goal) throw new Error(`Goal ${goalId} not found`);
  const fields = acceptanceFields(goal, receipt, { kind: 'goal' });
  fields.acceptance.component_basis = resolveComponentBasis(goal);
  const tasks = Object.values(goal.tasks || {});
  const unresolved = tasks.filter((task) => !['closed', 'not_planned', 'duplicate'].includes(task.status));
  if (unresolved.length) throw new Error(`Cannot accept goal with unresolved tasks: ${unresolved.map((task) => task.task_id).join(', ')}`);
  const waivedTasks = tasks.filter((task) => ['not_planned', 'duplicate'].includes(task.status));
  const accounted = new Set();
  for (const exception of fields.acceptance.exceptions || []) {
    const parsed = parseRef(exception.ref);
    const referencedFile = parsed?.goalId ? getGoalFilePath(parsed.goalId, parsed.username || username) : getGoalFilePath(goalId, username);
    if (!parsed?.taskId || parsed.criterionId || parsed.revision != null || referencedFile !== getGoalFilePath(goalId, username)) {
      throw new Error(`Goal exception must identify one of its waived tasks: ${exception.ref}`);
    }
    if (!waivedTasks.some((task) => task.task_id === parsed.taskId)) throw new Error(`Exception ${exception.ref} is not a not_planned or duplicate task`);
    if (accounted.has(parsed.taskId)) throw new Error(`Duplicate exception for ${parsed.taskId}`);
    accounted.add(parsed.taskId);
  }
  const missing = waivedTasks.filter((task) => !accounted.has(task.task_id));
  if (missing.length) throw new Error(`Explicit exceptions are required for: ${missing.map((task) => task.task_id).join(', ')}`);
  fields.acceptance.task_basis = tasks.map((task) => ({
    task_id: task.task_id,
    revision: task.revision || 0,
    status: task.status,
    request_snapshot: requestSnapshot(task),
    acceptance: task.acceptance || null,
  }));
  appendEvent(goalId, {
    event: 'updated', goal_id: goalId, timestamp: new Date().toISOString(),
    ...fields, closed_commit_sha: null,
  }, { username, expectedRevision: expectedRevision(receipt, goal) });
  syncGoal(goalId, username);
  console.log(JSON.stringify({ success: true, goal_id: goalId, status: 'closed', accepted: true }));
}

function unlinkGoalRecord(goalId, username = null) {
  const goal = readGoalWithTasks(goalId, username);
  if (!goal?.issue_number) return null;

  appendEvent(goalId, {
    event: 'github_unlinked',
    goal_id: goalId,
    timestamp: new Date().toISOString(),
    issue_number: goal.issue_number,
    issue_url: goal.issue_url || '',
  }, { username, expectedRevision: goal.revision });
  return { goal_id: goalId, username, issue_number: goal.issue_number };
}

function unlinkGoal(goalRef) {
  const { goalId: normalizedId, username } = goalTarget(goalRef, { write: true });
  const goal = readGoalWithTasks(normalizedId, username);
  if (!goal) {
    console.error(JSON.stringify({ error: 'Goal not found' }));
    process.exit(1);
  }

  const result = unlinkGoalRecord(normalizedId, username);
  if (!result) {
    console.log(JSON.stringify({ success: true, goal_id: normalizedId, unlinked: false }));
    return;
  }

  console.log(JSON.stringify({
    success: true,
    goal_id: normalizedId,
    unlinked: true,
    issue_number: result.issue_number,
  }));
}

function unlinkAllGoals() {
  const results = discoverGoals(getClipsDbDir())
    .map(({ goalId, username }) => unlinkGoalRecord(goalId, username))
    .filter(Boolean);
  console.log(JSON.stringify({
    success: true,
    unlinked: results.length,
    goals: results.map(({ goal_id: goalId, username }) => username ? `#${username}#${goalId}` : `#${goalId}`),
  }));
}

function showGoal(goalId) {
  const { goalId: normalizedId, username, revision } = goalTarget(goalId);
  const goal = readGoalWithTasks(normalizedId, username, revision == null ? {} : { revision });
  if (!goal) {
    console.error(JSON.stringify({ error: 'Goal not found' }));
    process.exit(1);
  }
  // Convert tasks object to array for display
  goal.tasks = Object.values(goal.tasks);
  console.log(JSON.stringify(goal, null, 2));
}

function listGoals() {
  const clipsDbDir = getClipsDbDir();
  if (!fs.existsSync(clipsDbDir)) {
    console.log(JSON.stringify([]));
    return;
  }
  
  const files = fs.readdirSync(clipsDbDir).filter(f => /^g\d+\.jsonl$/.test(f));
  const goals = files.map(f => {
    const goalId = f.replace('.jsonl', '');
    const goal = readGoalWithTasks(goalId);
    if (goal) {
      goal.tasks = Object.values(goal.tasks);
    }
    return goal;
  }).filter(Boolean);
  
  console.log(JSON.stringify(goals, null, 2));
}

export function runGoalCommand(args) {
  const [command, ...rest] = args;
  
  switch (command) {
    case 'create':
      createGoal(readJsonInput(rest));
      break;
    case 'update':
      updateGoal(rest[0], readJsonInput(rest.slice(1)));
      break;
    case 'accept':
      acceptGoal(rest[0], readJsonInput(rest.slice(1)));
      break;
    case 'assign':
      updateGoal(rest[0], { lane_id: rest[1] === 'null' || rest[1] === 'none' ? null : rest[1] });
      break;
    case 'status':
      changeStatus(rest[0], rest[1]);
      break;
    case 'attach-adr':
      attachAdr(rest[0], rest[1]);
      break;
    case 'unlink':
      if (rest[0] === '--all') unlinkAllGoals();
      else unlinkGoal(rest[0]);
      break;
    case 'show':
      showGoal(rest[0]);
      break;
    case 'list':
      listGoals();
      break;
    default:
      console.log(`Usage: lanes goal <command> [args]

Commands:
  create <json>        Create a new goal
  update <id> <json>   Update goal properties
  assign <id> <lane|null>  Assign or move a goal to a strategic lane
  accept <id> <json>   Accept an outcome with artifact and criterion evidence
  attach-adr <id> <adr> Attach a legacy ADR reference (optional)
  unlink <id|--all>    Disconnect one or all goals and their tasks from GitHub

Goal fields:
  plan, decisions      Markdown plan and durable design decisions
  scope, components    Scope text and affected component refs
  acceptance_criteria  Strings or {id: "A1", description: "..."} entries
  owner                Advisory work responsibility, not an execution lock
  acceptance_owner     Expected accepting actor for receipt consistency
  record               Markdown outcome/change record
  sections, extensions Additional Markdown sections and custom JSON
  expected_revision    Reject an update based on a stale record revision
  type                 Legacy planning | building label (default: building)
  lane_id              Optional l001 strategic lane ref
  track_id             Legacy r001 Track ref (read/write compatibility)
  blocked_by           Array of goal refs

Behavior fields:
  behavior             Optional Gherkin-style behavior text
  verification_mode    behavior | behavior_and_tests

JSON input: one argument, --file <path>, or --stdin.
Host identity and Lane claims are not prerequisites for work.
Acceptance receipt: artifact, accepted_by, summary, criteria [{id, status,
evidence, reason?}]; status is satisfied or waived (waivers need a reason).
Goal acceptance requires resolved tasks and explicit exceptions for any
not_planned/duplicate children. Status closure alone is administrative.
Declared component refs are resolved to pinned revisions in the receipt.
Pin refs before work when a negotiated baseline must remain fixed.

Internal (prefer 'lanes view' for browsing):
  status <id> <status> Change goal status
  show <id>            Show goal as JSON
  list                 List all goals as JSON

Tip: Use 'lanes view' to see goals and tasks in a readable format.
`);
  }
}
