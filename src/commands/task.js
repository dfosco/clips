// A task is one work contract: a change request before, a change record after.
import { appendEvent, readGoalWithTasks, getGoalFilePath, getCurrentCommitSha, normalizeGoalId, parseRef, normalizeTaskId } from '../lib/core.js';
import { pushGoal } from '../lib/sync.js';
import { effectiveVerificationMode, planningBehaviorFields } from '../lib/behavior.js';
import { acceptanceFields, invalidateAcceptanceFields, referenceList, validateWorkInput, workFields } from '../lib/work-fields.js';
import { readJsonInput } from '../lib/json-input.js';
import { resolveComponentBasis } from '../lib/component-basis.js';

function mutableRef(parsed) {
  if (parsed?.revision != null || parsed?.criterionId || parsed?.componentId) {
    throw new Error('Use a current goal/task reference for mutations; use expected_revision to reject stale updates');
  }
}

function goalTarget(ref, { write = true } = {}) {
  const parsed = parseRef(ref);
  if (!parsed?.goalId || parsed.taskId || parsed.componentId || parsed.criterionId) throw new Error('Provide a goal reference');
  if (write) mutableRef(parsed);
  return { goalId: parsed.goalId, username: parsed.username || null, revision: parsed.revision };
}

function taskTarget(args) {
  const first = parseRef(args[0]);
  mutableRef(first);
  if (first?.goalId && first.taskId) return { ...first, consumed: 1 };
  if (!first?.goalId) throw new Error('Provide a goal and task reference');
  const second = parseRef(args[1]);
  mutableRef(second);
  let taskId = second?.taskId && !second.goalId ? second.taskId : null;
  if (!taskId && /^\d+$/.test(args[1] || '')) taskId = normalizeTaskId(`t${args[1]}`);
  if (!taskId) throw new Error('Provide a goal and task reference');
  return { goalId: first.goalId, username: first.username || null, taskId, consumed: 2 };
}

function loadGoal(target) {
  const goal = readGoalWithTasks(target.goalId, target.username);
  if (!goal) throw new Error(`Goal ${target.goalId} not found`);
  return goal;
}

function loadTask(target) {
  const goal = loadGoal(target);
  const task = goal.tasks?.[target.taskId];
  if (!task) throw new Error(`Task ${target.taskId} not found in goal ${target.goalId}`);
  return { goal, task };
}

function expectedRevision(data, current) {
  if (Object.hasOwn(data, 'expected_revision') && (!Number.isSafeInteger(data.expected_revision) || data.expected_revision < 0)) {
    throw new Error('expected_revision must be a non-negative integer');
  }
  return data.expected_revision ?? current?.revision ?? 0;
}

function syncGoal(target) {
  if (!target.username) try { pushGoal(target.goalId); } catch (error) { /* best effort */ }
}

function nextTaskNumber(goal) {
  return Math.max(0, ...Object.keys(goal.tasks || {}).filter((id) => /^t\d+$/.test(id)).map((id) => Number(id.slice(1)))) + 1;
}

// Work dependencies retain qualified refs. Local refs are validated against the
// candidate task graph, including forward references within create-batch.
function taskDependencies(refs, target, candidateGoal) {
  const refKey = (ref) => `${getGoalFilePath(ref.goalId, ref.username)}${ref.taskId ? `#${ref.taskId}` : ''}`;
  const targetKey = refKey(target);
  const parseDependency = (value, context) => {
    const parsed = parseRef(value);
    if (!parsed || parsed.componentId || parsed.criterionId || parsed.revision != null || (!parsed.goalId && !parsed.taskId)) {
      throw new Error(`Invalid task dependency: ${value}`);
    }
    const username = parsed.username || context.username || null;
    return {
      goalId: normalizeGoalId(parsed.goalId || context.goalId, username),
      taskId: parsed.taskId || null,
      username,
    };
  };
  const parsed = referenceList(refs, 'blocked_by').map((ref) => parseDependency(ref, target));
  if (new Set(parsed.map(refKey)).size !== parsed.length) throw new Error('Duplicate task dependency');
  const read = (ref) => getGoalFilePath(ref.goalId, ref.username) === getGoalFilePath(target.goalId, target.username)
    ? candidateGoal : readGoalWithTasks(ref.goalId, ref.username);
  const seen = new Set();
  const visit = (ref) => {
    const key = refKey(ref);
    if (key === targetKey || (!ref.taskId && getGoalFilePath(ref.goalId, ref.username) === getGoalFilePath(target.goalId, target.username))) {
      throw new Error('Task dependency cycle (a task cannot depend on itself or its containing goal)');
    }
    if (seen.has(key)) return;
    seen.add(key);
    const goal = read(ref);
    const dependency = ref.taskId ? goal?.tasks?.[ref.taskId] : goal;
    if (!dependency) throw new Error(`Blocking work #${ref.goalId}${ref.taskId ? `#${ref.taskId}` : ''} not found`);
    for (const upstream of dependency.blocked_by || []) visit(parseDependency(upstream, ref));
    if (!ref.taskId) for (const task of Object.values(goal.tasks || {})) visit({ ...ref, taskId: task.task_id });
  };
  for (const dependency of parsed) visit(dependency);
  return parsed.map((ref) => `#${ref.username ? `${ref.username}#` : ''}${ref.goalId}${ref.taskId ? `#${ref.taskId}` : ''}`);
}

function createTasks(target, inputs, { single = false } = {}) {
  const goal = loadGoal(target);
  if (!Array.isArray(inputs) || inputs.length === 0) throw new Error('create-batch requires a non-empty array of tasks');
  let nextId = nextTaskNumber(goal);
  const prepared = inputs.map((data) => {
    validateWorkInput(data);
    const taskId = `t${String(nextId++).padStart(2, '0')}`;
    return {
      data,
      event: {
        event: 'task_created', goal_id: target.goalId, task_id: taskId, timestamp: new Date().toISOString(),
        ...workFields(data, {}, { creating: true }),
        ...planningBehaviorFields(data, { allowInheritedMode: true }),
        blocked_by: Object.hasOwn(data, 'blocked_by') ? data.blocked_by : [],
        status: 'open',
      },
    };
  });
  const candidate = { ...goal, tasks: { ...goal.tasks } };
  for (const { event } of prepared) candidate.tasks[event.task_id] = event;
  for (const { data, event } of prepared) {
    event.blocked_by = taskDependencies(Object.hasOwn(data, 'blocked_by') ? data.blocked_by : [], { ...target, taskId: event.task_id }, candidate);
    if (expectedRevision(data, null) !== 0) throw new Error('A new task must have expected_revision 0');
  }
  for (const { data, event } of prepared) {
    appendEvent(target.goalId, event, { username: target.username, expectedRevision: expectedRevision(data, null) });
  }
  syncGoal(target);
  const tasks = prepared.map(({ event }) => ({ task_id: event.task_id, title: event.title }));
  console.log(JSON.stringify(single
    ? { success: true, goal_id: target.goalId, task_id: tasks[0].task_id }
    : { success: true, goal_id: target.goalId, tasks }));
}

function updateTask(target, data) {
  const { goal, task } = loadTask(target);
  validateWorkInput(data);
  const fields = {
    ...workFields(data, task),
    ...planningBehaviorFields(data, { allowInheritedMode: true }),
  };
  if (Object.hasOwn(data, 'blocked_by')) {
    const candidate = { ...goal, tasks: { ...goal.tasks, [target.taskId]: { ...task, blocked_by: data.blocked_by } } };
    fields.blocked_by = taskDependencies(data.blocked_by, target, candidate);
  }
  const nextMode = effectiveVerificationMode(goal.verification_mode, Object.hasOwn(fields, 'verification_mode') ? fields.verification_mode : task.verification_mode);
  const invalidation = invalidateAcceptanceFields(task, { ...fields, effective_verification_mode: nextMode });
  appendEvent(target.goalId, {
    event: 'task_updated', goal_id: target.goalId, task_id: target.taskId, timestamp: new Date().toISOString(),
    ...fields, ...invalidation,
  }, { username: target.username, expectedRevision: expectedRevision(data, task) });
  syncGoal(target);
  console.log(JSON.stringify({ success: true, goal_id: target.goalId, task_id: target.taskId }));
}

export function changeTaskStatus(goalId, taskId, status, { username = null } = {}) {
  const target = { goalId, taskId, username };
  const { task } = loadTask(target);
  const valid = ['open', 'in_progress', 'closed', 'not_planned', 'duplicate'];
  if (!valid.includes(status)) throw new Error(`Invalid status. Valid: ${valid.join(', ')}`);
  const invalidation = status !== 'closed'
    ? invalidateAcceptanceFields(task, {}, { force: true, reason: `Status changed to ${status}` }) : {};
  appendEvent(goalId, {
    event: 'task_status_changed', goal_id: goalId, task_id: taskId, timestamp: new Date().toISOString(),
    ...invalidation,
    status,
    commit_sha: status === 'closed' ? getCurrentCommitSha() : null,
  }, { username, expectedRevision: task.revision });
  syncGoal(target);
  console.log(JSON.stringify({ success: true, goal_id: goalId, task_id: taskId, status }));
}

function acceptTask(target, receipt) {
  const { task } = loadTask(target);
  if (receipt.exceptions?.length) throw new Error('Task acceptance waivers belong on its criteria; exceptions are used for goal child tasks');
  const fields = acceptanceFields(task, receipt);
  fields.acceptance.component_basis = resolveComponentBasis(task);
  appendEvent(target.goalId, {
    event: 'task_updated', goal_id: target.goalId, task_id: target.taskId, timestamp: new Date().toISOString(),
    ...fields, closed_commit_sha: null,
  }, { username: target.username, expectedRevision: expectedRevision(receipt, task) });
  syncGoal(target);
  console.log(JSON.stringify({ success: true, goal_id: target.goalId, task_id: target.taskId, status: 'closed', accepted: true }));
}

function showGoalWithTasks(target) {
  const goal = readGoalWithTasks(target.goalId, target.username, target.revision == null ? {} : { revision: target.revision });
  if (!goal) throw new Error(`Goal ${target.goalId} not found`);
  goal.tasks = Object.values(goal.tasks);
  console.log(JSON.stringify(goal, null, 2));
}

function reorderTasks(target, order) {
  const goal = loadGoal(target);
  if (!Array.isArray(order)) throw new Error('Task order must be an array');
  const normalized = order.map((id) => normalizeTaskId(id));
  const existing = Object.keys(goal.tasks || {});
  if (normalized.length !== existing.length || new Set(normalized).size !== existing.length || normalized.some((id) => !existing.includes(id))) {
    throw new Error(`New order must include each of the ${existing.length} tasks exactly once`);
  }
  appendEvent(target.goalId, {
    event: 'tasks_reordered', goal_id: target.goalId, timestamp: new Date().toISOString(), order: normalized,
  }, { username: target.username, expectedRevision: goal.revision });
  syncGoal(target);
  console.log(JSON.stringify({ success: true, goal_id: target.goalId, new_order: normalized }));
}

export function runTaskCommand(args) {
  const [command, ...rest] = args;
  switch (command) {
    case 'create':
      createTasks(goalTarget(rest[0]), [readJsonInput(rest.slice(1))], { single: true });
      break;
    case 'create-batch':
      createTasks(goalTarget(rest[0]), readJsonInput(rest.slice(1)));
      break;
    case 'update': {
      const target = taskTarget(rest);
      updateTask(target, readJsonInput(rest.slice(target.consumed)));
      break;
    }
    case 'accept': {
      const target = taskTarget(rest);
      acceptTask(target, readJsonInput(rest.slice(target.consumed)));
      break;
    }
    case 'status': {
      const target = taskTarget(rest);
      if (rest.length !== target.consumed + 1) throw new Error('Provide one task status');
      changeTaskStatus(target.goalId, target.taskId, rest[target.consumed], target);
      break;
    }
    case 'show':
      showGoalWithTasks(goalTarget(rest[0], { write: false }));
      break;
    case 'reorder':
      reorderTasks(goalTarget(rest[0]), readJsonInput(rest.slice(1)));
      break;
    default:
      console.log(`Usage: clips task <command> [args]

Commands:
  create <goal> <json>         Create a change request
  create-batch <goal> <json>   Create multiple task requests
  update <goal> <task> <json>  Refine a request or its change record
  accept <goal> <task> <json>  Record acceptance and close this task only
  status <goal> <task> <status> Administrative status change
  show <goal>                 Show goal with tasks as JSON
  reorder <goal> <json>       Reorder tasks without changing their identities

Fields:
  title, description         Title and requested outcome
  scope, components          Change boundaries and affected component refs
  acceptance_criteria        Strings or {id: "A1", description: "..."} entries
  owner, acceptance_owner    Work and acceptance responsibility
  blocked_by                 Task or goal references, including qualified refs
  record                     Markdown implementation/result record
  sections, extensions       Additional Markdown sections and custom JSON
  behavior                   Optional behavior specification
  verification_mode          behavior | behavior_and_tests | null (inherit)
  expected_revision          Reject a stale update or acceptance

Acceptance receipt:
  artifact, accepted_by, summary, criteria: [{id, status, evidence, reason?}]
  Every criterion needs satisfied evidence or an explicit reasoned waiver.
  This records supplied evidence; it does not run tests or authenticate actors.
  A status-only close does not create an acceptance receipt.
  Declared components are pinned in acceptance.component_basis. Pin refs before
  work when the negotiated baseline must remain fixed; changes in a component's
  own journal do not automatically invalidate existing work acceptance.

JSON input: one argument, --file <path>, or --stdin.
Use g1 t1 or a combined '#g1#t1' reference. Quote #refs in shells.
Request-affecting edits reopen accepted work and retain the old receipt;
record/section/extension notes and task ownership do not change the obligation.
`);
  }
}
