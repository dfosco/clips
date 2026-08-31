// Goal management commands
import fs from 'fs';
import { CLIPS_DB_DIR, appendEvent, readGoalWithTasks, getClipsDbDir, getClipsRecordsDir, getCurrentCommitSha, parseRef } from '../lib/core.js';
import { pushGoal } from '../lib/sync.js';
import { planningBehaviorFields } from '../lib/behavior.js';
import { discoverBoardGoals } from '../lib/board.js';
import { adrRecordExists, goalCompletionError, goalTypeFields, normalizeAdrId } from '../lib/goal-type.js';

// Normalize goal ID by stripping # prefix if present
function normalizeGoalId(goalId) {
  const parsed = parseRef(goalId);
  return parsed ? parsed.goalId : goalId;
}

function generateId() {
  const clipsDbDir = getClipsDbDir();
  if (!fs.existsSync(clipsDbDir)) {
    return 'g001';
  }
  
  const files = fs.readdirSync(clipsDbDir).filter(f => f.endsWith('.jsonl'));
  const sequentialIds = files
    .map(f => f.replace('.jsonl', ''))
    .filter(id => /^g\d+$/.test(id))
    .map(id => parseInt(id.replace('g', ''), 10));
  
  const maxId = sequentialIds.length > 0 ? Math.max(...sequentialIds) : 0;
  const nextId = maxId + 1;
  return `g${nextId.toString().padStart(3, '0')}`;
}

function createGoal(data) {
  const clipsDbDir = getClipsDbDir();
  const goalId = generateId();
  const event = {
    event: 'goal_created',
    goal_id: goalId,
    timestamp: new Date().toISOString(),
    title: data.title,
    description: data.description || '',
    acceptance_criteria: data.acceptance_criteria || [],
    ...goalTypeFields(data, { defaultType: true }),
    ...planningBehaviorFields(data, { defaultMode: true }),
    status: 'open'
  };
  
  if (!fs.existsSync(clipsDbDir)) {
    fs.mkdirSync(clipsDbDir, { recursive: true });
  }
  
  appendEvent(goalId, event);
  try { pushGoal(goalId); } catch (e) { /* sync is best-effort */ }
  const synced = readGoalWithTasks(goalId);
  const result = { success: true, goal_id: goalId };
  if (synced && synced.issue_number) result.issue_number = synced.issue_number;
  console.log(JSON.stringify(result));
  return goalId;
}

function updateGoal(goalId, data) {
  const normalizedId = normalizeGoalId(goalId);
  const goal = readGoalWithTasks(normalizedId);
  if (!goal) throw new Error(`Goal ${normalizedId} not found`);
  const allowedFields = new Set(['title', 'description', 'acceptance_criteria', 'behavior', 'verification_mode', 'type']);
  const unsupportedFields = Object.keys(data).filter((field) => !allowedFields.has(field));
  if (unsupportedFields.length > 0) throw new Error(`Unsupported goal fields: ${unsupportedFields.join(', ')}`);
  const typeFields = goalTypeFields(data);
  if (typeFields.type && typeFields.type !== goal.type) {
    if (goal.status === 'closed') throw new Error('Cannot change the type of a closed goal');
    if (typeFields.type === 'planning' && Object.keys(goal.tasks).length > 0) {
      throw new Error('Cannot change a goal with tasks to planning');
    }
    if (typeFields.type === 'building' && goal.adr_id && adrRecordExists(getClipsRecordsDir('adr'), goal.adr_id)) {
      throw new Error('Cannot change a goal with an attached ADR to building');
    }
  }
  const behaviorFields = planningBehaviorFields(data);
  const updateFields = {};
  for (const field of ['title', 'description', 'acceptance_criteria']) {
    if (Object.prototype.hasOwnProperty.call(data, field)) updateFields[field] = data[field];
  }
  const event = {
    event: 'updated',
    goal_id: normalizedId,
    timestamp: new Date().toISOString(),
    ...updateFields,
    ...typeFields,
    ...behaviorFields,
  };
  appendEvent(normalizedId, event);
  if (typeFields.type === 'building' && goal.adr_id) {
    appendEvent(normalizedId, {
      event: 'adr_detached',
      goal_id: normalizedId,
      timestamp: new Date().toISOString(),
      adr_id: goal.adr_id,
    });
  }
  try { pushGoal(normalizedId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: normalizedId }));
}

function changeStatus(goalId, status) {
  const normalizedId = normalizeGoalId(goalId);
  const validStatuses = ['open', 'in_progress', 'closed', 'not_planned', 'duplicate'];
  
  if (!validStatuses.includes(status)) {
    console.error(JSON.stringify({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` }));
    process.exit(1);
  }

  const goal = readGoalWithTasks(normalizedId);
  if (!goal) throw new Error(`Goal ${normalizedId} not found`);
  if (status === 'closed') {
    const completionError = goalCompletionError(goal, { recordsDir: getClipsRecordsDir('adr') });
    if (completionError) throw new Error(completionError);
  }
  
  const event = {
    event: 'status_changed',
    goal_id: normalizedId,
    timestamp: new Date().toISOString(),
    status: status,
    commit_sha: status === 'closed' ? getCurrentCommitSha() : null,
  };
  appendEvent(normalizedId, event);
  try { pushGoal(normalizedId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: normalizedId, status: status }));
}

function attachAdr(goalId, adrId) {
  const normalizedId = normalizeGoalId(goalId);
  const goal = readGoalWithTasks(normalizedId);
  if (!goal) throw new Error(`Goal ${normalizedId} not found`);
  if (goal.type !== 'planning') throw new Error('ADRs can only be attached to planning goals');
  if (goal.status === 'closed') throw new Error('Cannot replace the ADR on a closed planning goal');

  const normalizedAdrId = normalizeAdrId(adrId);
  const recordsDir = getClipsRecordsDir('adr');
  if (!adrRecordExists(recordsDir, normalizedAdrId)) throw new Error(`${normalizedAdrId} not found in .clips/records/adr`);

  appendEvent(normalizedId, {
    event: 'adr_attached',
    goal_id: normalizedId,
    timestamp: new Date().toISOString(),
    adr_id: normalizedAdrId,
  });
  try { pushGoal(normalizedId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: normalizedId, adr_id: normalizedAdrId }));
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
  }, { username });
  return { goal_id: goalId, username, issue_number: goal.issue_number };
}

function unlinkGoal(goalRef) {
  const parsed = parseRef(goalRef);
  const normalizedId = parsed?.goalId || normalizeGoalId(goalRef);
  const username = parsed?.username || null;
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
  const results = discoverBoardGoals(getClipsDbDir())
    .map(({ goalId, username }) => unlinkGoalRecord(goalId, username))
    .filter(Boolean);
  console.log(JSON.stringify({
    success: true,
    unlinked: results.length,
    goals: results.map(({ goal_id: goalId, username }) => username ? `#${username}#${goalId}` : `#${goalId}`),
  }));
}

function showGoal(goalId) {
  const normalizedId = normalizeGoalId(goalId);
  const goal = readGoalWithTasks(normalizedId);
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
  
  const files = fs.readdirSync(clipsDbDir).filter(f => f.endsWith('.jsonl'));
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
      createGoal(JSON.parse(rest[0]));
      break;
    case 'update':
      updateGoal(rest[0], JSON.parse(rest[1]));
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
      console.log(`Usage: clips goal <command> [args]

Commands:
  create <json>        Create a new goal
  update <id> <json>   Update goal properties
  attach-adr <id> <adr> Attach an existing ADR to a planning goal
  unlink <id|--all>    Disconnect one or all goals and their tasks from GitHub

Goal fields:
  type                 planning | building (default: building)

Behavior fields:
  behavior             Optional Gherkin-style behavior text
  verification_mode    behavior | behavior_and_tests

Internal (prefer 'clips view' for browsing):
  status <id> <status> Change goal status
  show <id>            Show goal as JSON
  list                 List all goals as JSON

Tip: Use 'clips view' to see goals and tasks in a readable format.
`);
  }
}
