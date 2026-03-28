// Task management commands
import fs from 'fs';
import { appendEvent, readGoalWithTasks, goalExists, parseRef, parseArgs, normalizeGoalId, normalizeTaskId } from '../lib/core.js';
import { pushGoal } from '../lib/sync.js';

function generateTaskId(goalId) {
  const goal = readGoalWithTasks(goalId);
  if (!goal) return 't01';
  
  const existingTasks = Object.values(goal.tasks);
  const sequentialIds = existingTasks
    .map(t => t.task_id)
    .filter(id => /^t\d+$/.test(id))
    .map(id => parseInt(id.replace('t', ''), 10));
  
  const maxId = sequentialIds.length > 0 ? Math.max(...sequentialIds) : 0;
  const nextId = maxId + 1;
  return `t${nextId.toString().padStart(2, '0')}`;
}

function createTask(goalId, data) {
  if (!goalExists(goalId)) {
    console.error(JSON.stringify({ error: `Goal ${goalId} not found` }));
    process.exit(1);
  }
  
  const taskId = generateTaskId(goalId);
  const event = {
    event: 'task_created',
    goal_id: goalId,
    task_id: taskId,
    timestamp: new Date().toISOString(),
    title: data.title,
    description: data.description || ''
  };
  
  appendEvent(goalId, event);
  try { pushGoal(goalId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: goalId, task_id: taskId }));
  return taskId;
}

function createTasks(goalId, tasksArray) {
  if (!goalExists(goalId)) {
    console.error(JSON.stringify({ error: `Goal ${goalId} not found` }));
    process.exit(1);
  }
  
  const goal = readGoalWithTasks(goalId);
  const existingTasks = goal ? Object.values(goal.tasks) : [];
  const sequentialIds = existingTasks
    .map(t => t.task_id)
    .filter(id => /^t\d+$/.test(id))
    .map(id => parseInt(id.replace('t', ''), 10));
  let nextId = sequentialIds.length > 0 ? Math.max(...sequentialIds) + 1 : 1;
  
  const results = [];
  for (let i = 0; i < tasksArray.length; i++) {
    const task = tasksArray[i];
    const taskId = `t${(nextId++).toString().padStart(2, '0')}`;
    const event = {
      event: 'task_created',
      goal_id: goalId,
      task_id: taskId,
      timestamp: new Date().toISOString(),
      title: task.title,
      description: task.description || ''
    };
    // Skip sync for all but last task in batch
    const isLast = i === tasksArray.length - 1;
    appendEvent(goalId, event, { skipSync: !isLast });
    results.push({ task_id: taskId, title: task.title });
  }
  
  try { pushGoal(goalId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: goalId, tasks: results }));
}

function updateTask(goalId, taskId, data) {
  if (!goalExists(goalId)) {
    console.error(JSON.stringify({ error: `Goal ${goalId} not found` }));
    process.exit(1);
  }
  
  const event = {
    event: 'task_updated',
    goal_id: goalId,
    task_id: taskId,
    timestamp: new Date().toISOString(),
    ...data
  };
  appendEvent(goalId, event);
  try { pushGoal(goalId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: goalId, task_id: taskId }));
}

export function changeTaskStatus(goalId, taskId, status) {
  const validStatuses = ['draft', 'to_do', 'in_progress', 'done', 'skipped', 'closed', 'archived'];
  
  if (!validStatuses.includes(status)) {
    console.error(JSON.stringify({ error: `Invalid status. Valid: ${validStatuses.join(', ')}` }));
    process.exit(1);
  }
  
  const event = {
    event: 'task_status_changed',
    goal_id: goalId,
    task_id: taskId,
    timestamp: new Date().toISOString(),
    status: status
  };
  appendEvent(goalId, event);
  try { pushGoal(goalId); } catch (e) { /* sync is best-effort */ }
  console.log(JSON.stringify({ success: true, goal_id: goalId, task_id: taskId, status: status }));
}

function showGoalWithTasks(goalId) {
  const goal = readGoalWithTasks(goalId);
  if (!goal) {
    console.error(JSON.stringify({ error: 'Goal not found' }));
    process.exit(1);
  }
  goal.tasks = Object.values(goal.tasks);
  console.log(JSON.stringify(goal, null, 2));
}

/**
 * Reorder tasks in a goal
 * @param {string} goalId - Goal ID
 * @param {string[]} newOrder - Array of task IDs in new order, e.g. ["t3", "t1", "t2"]
 */
function reorderTasks(goalId, newOrder) {
  const goal = readGoalWithTasks(goalId);
  if (!goal) {
    console.error(JSON.stringify({ error: `Goal ${goalId} not found` }));
    process.exit(1);
  }
  
  // Check goal is in draft status
  if (goal.status !== 'draft') {
    console.error(JSON.stringify({ 
      error: `Can only reorder tasks when goal is in draft status (current: ${goal.status})` 
    }));
    process.exit(1);
  }
  
  // Check no tasks have been started
  const tasks = Object.values(goal.tasks);
  const startedTask = tasks.find(t => t.status && t.status !== 'draft' && t.status !== 'to_do');
  if (startedTask) {
    console.error(JSON.stringify({ 
      error: `Cannot reorder: task ${startedTask.task_id} has status '${startedTask.status}'` 
    }));
    process.exit(1);
  }
  
  // Validate all task IDs exist
  const existingIds = tasks.map(t => t.task_id);
  for (const id of newOrder) {
    if (!existingIds.includes(id)) {
      console.error(JSON.stringify({ error: `Task ${id} not found in goal ${goalId}` }));
      process.exit(1);
    }
  }
  
  // Check all tasks are included
  if (newOrder.length !== existingIds.length) {
    console.error(JSON.stringify({ 
      error: `New order must include all ${existingIds.length} tasks, got ${newOrder.length}` 
    }));
    process.exit(1);
  }
  
  // Create reorder event
  const event = {
    event: 'tasks_reordered',
    goal_id: goalId,
    timestamp: new Date().toISOString(),
    order: newOrder
  };
  appendEvent(goalId, event);
  try { pushGoal(goalId); } catch (e) { /* sync is best-effort */ }
  
  console.log(JSON.stringify({ 
    success: true, 
    goal_id: goalId, 
    new_order: newOrder 
  }));
}

export function runTaskCommand(args) {
  const [command, ...rest] = args;
  
  switch (command) {
    case 'create': {
      const goalId = normalizeGoalId(rest[0]);
      createTask(goalId, JSON.parse(rest[1]));
      break;
    }
    case 'create-batch': {
      const goalId = normalizeGoalId(rest[0]);
      // Support --stdin flag to read JSON from stdin (avoids shell escaping issues)
      if (rest.includes('--stdin')) {
        const stdinData = fs.readFileSync(0, 'utf8').trim();
        try {
          createTasks(goalId, JSON.parse(stdinData));
        } catch (e) {
          console.error(JSON.stringify({ error: `Invalid JSON from stdin: ${e.message}` }));
          process.exit(1);
        }
      } else {
        try {
          createTasks(goalId, JSON.parse(rest[1]));
        } catch (e) {
          console.error(JSON.stringify({ error: `Invalid JSON argument: ${e.message}` }));
          process.exit(1);
        }
      }
      break;
    }
    case 'update': {
      // Supports: g001 t1 json, g1 t1 json, #g001#t1 json
      const parsed = parseArgs(rest.slice(0, 2));
      const jsonArg = rest.length > 2 ? rest[2] : rest[1];
      if (!parsed || !parsed.goalId) {
        console.error('Error: Could not parse goal/task ID');
        process.exit(1);
      }
      const taskId = parsed.taskId || normalizeTaskId(rest[1]);
      updateTask(parsed.goalId, taskId, JSON.parse(jsonArg));
      break;
    }
    case 'status': {
      // Supports: g001 t1 done, g1 t1 done, #g001#t1 done
      const parsed = parseArgs(rest.slice(0, 2));
      const statusArg = rest.length > 2 ? rest[2] : rest[1];
      if (!parsed || !parsed.goalId) {
        console.error('Error: Could not parse goal/task ID');
        process.exit(1);
      }
      const taskId = parsed.taskId || normalizeTaskId(rest[1]);
      changeTaskStatus(parsed.goalId, taskId, statusArg);
      break;
    }
    case 'show': {
      const goalId = normalizeGoalId(rest[0]);
      showGoalWithTasks(goalId);
      break;
    }
    case 'reorder': {
      const goalId = normalizeGoalId(rest[0]);
      reorderTasks(goalId, JSON.parse(rest[1]));
      break;
    }
    default:
      console.log(`Usage: clips task <command> [args]

Commands:
  create <goal_id> <json>          Create a single task
  create-batch <goal_id> <json>    Create multiple tasks (or --stdin)
  update <goal_id> <task_id> <json> Update a task
  status <goal_id> <task_id> <status> Change task status
  show <goal_id>                   Show goal with all tasks
  reorder <goal_id> <json>         Reorder tasks (draft goals only)

Flexible ID formats:
  Goal: #g001, g001, g1
  Task: #t4, t4
  Combined: #g001#t1, g001 t1, g1 t1

Examples:
  clips task create g001 '{"title":"Add auth"}'
  clips task create-batch g001 '[{"title":"Task 1"},{"title":"Task 2"}]'
  echo '[{"title":"Task 1"}]' | clips task create-batch g001 --stdin
  clips task status g1 t1 done
  clips task status #g001#t1 done
  clips task reorder g001 '["t3","t1","t2"]'
`);
  }
}
