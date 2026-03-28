// Goal management commands
import fs from 'fs';
import { CLIPS_DB_DIR, appendEvent, readGoalWithTasks, getClipsDbDir, parseRef, syncBeforeMutation } from '../lib/core.js';
import { pushGoal } from '../lib/sync.js';

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
  syncBeforeMutation();
  const clipsDbDir = getClipsDbDir();
  const goalId = generateId();
  const event = {
    event: 'goal_created',
    goal_id: goalId,
    timestamp: new Date().toISOString(),
    title: data.title,
    description: data.description,
    acceptance_criteria: data.acceptance_criteria || [],
    status: 'draft'
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
  syncBeforeMutation();
  const normalizedId = normalizeGoalId(goalId);
  const event = {
    event: 'updated',
    goal_id: normalizedId,
    timestamp: new Date().toISOString(),
    ...data
  };
  appendEvent(normalizedId, event);
  try { pushGoal(normalizedId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: normalizedId }));
}

function changeStatus(goalId, status) {
  syncBeforeMutation();
  const normalizedId = normalizeGoalId(goalId);
  const validStatuses = ['draft', 'to_do', 'in_progress', 'done', 'skipped', 'closed', 'archived'];
  
  if (!validStatuses.includes(status)) {
    console.error(JSON.stringify({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` }));
    process.exit(1);
  }
  
  const event = {
    event: 'status_changed',
    goal_id: normalizedId,
    timestamp: new Date().toISOString(),
    status: status
  };
  appendEvent(normalizedId, event);
  try { pushGoal(normalizedId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: normalizedId, status: status }));
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

Internal (prefer 'clips view' for browsing):
  status <id> <status> Change goal status
  show <id>            Show goal as JSON
  list                 List all goals as JSON

Tip: Use 'clips view' to see goals and tasks in a readable format.
`);
  }
}
