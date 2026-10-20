// Shared utilities for clips commands
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { readConfig } from './config.js';
import { effectiveVerificationMode } from './behavior.js';
import { normalizeGoalType } from './goal-type.js';
import { isDeepStrictEqual } from 'node:util';
import { appendJsonEvent, assertExpectedRevision, readJsonEvents, withRecordLock } from './journal.js';
import { invalidateAcceptanceFields, normalizeAcceptanceCriteria, workRequestChanged } from './work-fields.js';

export const CLIPS_DIR = '.clips';
export const CLIPS_DB_DIR = '.clips/db';
export const CLIPS_RECORDS_DIR = '.clips/records';

/**
 * Get the current username from config
 * Falls back to null if not configured
 * @returns {string|null}
 */
export function getCurrentUsername() {
  try {
    const config = readConfig();
    return config.username || config.notepad_username || null;
  } catch (e) {
    return null;
  }
}

/**
 * Normalize a goal ID to canonical form
 * Accepts: #g001, g001, g1, #g1 → g001 (if exists in db)
 * Also accepts non-numeric IDs like: dfosco, my-goal
 */
export function normalizeGoalId(input, username = null) {
  if (!input) return null;
  
  let id = input.replace(/^#/, '').toLowerCase();
  
  // Check if it exists as-is
  if (goalExists(id, username)) return id;
  
  // Try expanding short form: g1 → g001, g12 → g012
  const shortMatch = id.match(/^g(\d+)$/);
  if (shortMatch) {
    const num = shortMatch[1].padStart(3, '0');
    const expanded = `g${num}`;
    if (goalExists(expanded, username)) return expanded;
  }
  
  return id; // Return as-is, let caller handle non-existence
}

/**
 * Normalize a task ID to canonical form
 * Accepts: #t4, t4, t04 → t04 (zero-padded to 2 digits)
 */
export function normalizeTaskId(input) {
  if (!input) return null;
  let id = input.replace(/^#/, '').toLowerCase();
  
  // Expand short form: t4 → t04
  const match = id.match(/^t(\d+)$/);
  if (match) {
    const num = match[1].padStart(2, '0');
    return `t${num}`;
  }
  
  return id;
}

export function normalizeComponentId(input) {
  const match = String(input || '').replace(/^#/, '').match(/^c(\d+)$/i);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) < 1) return null;
  return `c${String(Number(match[1])).padStart(3, '0')}`;
}

/**
 * Parse a ref string into username, goalId, and taskId
 * Flexible formats:
 *   Full: #username#g001#t4 (namespaced to user)
 *   Goal+Task: #g001#t4, g001#t4, g001 t4, g1 t4, g1-t4
 *   Goal only: #g001, g001, g1, #g1, username (notepad)
 *   Task only: #t4, t4
 * 
 * When username is not specified, defaults to current user from config.
 */
export function parseRef(ref) {
  if (typeof ref !== 'string' || !ref.trim()) return null;
  const input = ref.trim().replace(/^#/, '').replace(/^(g\d+)-(t\d+)$/i, '$1#$2');
  const parts = input.split('#');
  const parsed = { username: null, goalId: null, taskId: null };
  // Suffixes address the record's history and a criterion inside that record.
  // Accept either input order, but format revision before criterion.
  while (parts.length > 1 && /^(r|a)\d+$/i.test(parts.at(-1))) {
    const suffix = parts.pop();
    const number = Number(suffix.slice(1));
    if (!Number.isSafeInteger(number) || number < 1) return null;
    const key = suffix[0].toLowerCase() === 'r' ? 'revision' : 'criterionId';
    if (Object.hasOwn(parsed, key)) return null;
    parsed[key] = key === 'revision' ? number : `A${number}`;
  }
  if (parts.some((part) => !/^[a-z0-9_-]+$/i.test(part))) return null;
  if (parts.length === 3 && /^t\d+$/i.test(parts[2])) {
    parsed.username = parts[0].toLowerCase();
    parsed.goalId = normalizeGoalId(parts[1], parsed.username);
    parsed.taskId = normalizeTaskId(parts[2]);
  } else if (parts.length === 2 && /^t\d+$/i.test(parts[1])) {
    parsed.goalId = normalizeGoalId(parts[0]);
    parsed.taskId = normalizeTaskId(parts[1]);
  } else if (parts.length === 2) {
    parsed.username = parts[0].toLowerCase();
    if (/^c\d+$/i.test(parts[1])) {
      parsed.componentId = normalizeComponentId(parts[1]);
      if (!parsed.componentId) return null;
    } else {
      parsed.goalId = normalizeGoalId(parts[1], parsed.username);
    }
  } else if (parts.length === 1) {
    if (/^t\d+$/i.test(parts[0])) parsed.taskId = normalizeTaskId(parts[0]);
    else if (/^c\d+$/i.test(parts[0])) {
      parsed.componentId = normalizeComponentId(parts[0]);
      if (!parsed.componentId) return null;
    } else parsed.goalId = normalizeGoalId(parts[0]);
  } else return null;
  if (parsed.componentId && parsed.criterionId) return null;
  return parsed;
}

/**
 * Format a ref object back into string form
 * @param {{ username?: string, goalId: string, taskId?: string }} ref
 * @param {{ includeUsername?: boolean }} options - if includeUsername is true, always include username
 * @returns {string} Formatted ref like #username#g001#t01 or #g001#t01
 */
export function formatRef(ref, options = {}) {
  if (!ref || (!ref.goalId && !ref.taskId && !ref.componentId)) return null;
  
  const parts = [];
  
  // Include username if specified in ref or options request it
  const username = ref.username || (options.includeUsername ? getCurrentUsername() : null);
  if (username) {
    parts.push(username);
  }
  
  if (ref.componentId) parts.push(ref.componentId);
  else if (ref.goalId) parts.push(ref.goalId);
  
  if (ref.taskId) {
    parts.push(ref.taskId);
  }
  if (ref.revision !== undefined) parts.push(`r${ref.revision}`);
  if (ref.criterionId) parts.push(ref.criterionId);
  
  return '#' + parts.join('#');
}

/**
 * Parse multiple args that may represent goal and task
 * Handles: ['g001', 't4'], ['g1', 't4'], ['#g001#t4'], ['#user#g001#t4']
 */
export function parseArgs(args) {
  if (!args || args.length === 0) return null;
  
  // Single arg - parse as ref
  if (args.length === 1) {
    return parseRef(args[0]);
  }
  
  // Two args - goal and task separately
  if (args.length >= 2) {
    const first = args[0];
    const second = args[1];
    
    // Check if first looks like a goal ID
    const goalParsed = parseRef(first);
    if (goalParsed?.goalId && !goalParsed.taskId && !goalParsed.revision && !goalParsed.criterionId) {
      // Check if second looks like a task ID
      const taskParsed = parseRef(second);
      if (taskParsed && taskParsed.taskId && !taskParsed.goalId) {
        return {
          username: goalParsed.username,
          goalId: goalParsed.goalId,
          taskId: taskParsed.taskId,
          ...(taskParsed.revision ? { revision: taskParsed.revision } : {}),
          ...(taskParsed.criterionId ? { criterionId: taskParsed.criterionId } : {}),
        };
      }
      // Second might be task without t prefix in some contexts
      const taskMatch = second.match(/^#?(t?\d+)$/i);
      if (taskMatch) {
        let taskId = taskMatch[1].toLowerCase();
        if (!taskId.startsWith('t')) taskId = 't' + taskId;
        return {
          username: goalParsed.username,
          goalId: goalParsed.goalId,
          taskId: normalizeTaskId(taskId)
        };
      }
    }
  }
  
  // Fall back to parsing first arg
  return parseRef(args[0]);
}

export function getRepoRoot(cwd = process.cwd()) {
  // Use --git-common-dir to find main repo even from worktrees
  const gitDir = execSync('git rev-parse --git-common-dir', {
    cwd,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  const absGitDir = path.resolve(cwd, gitDir);
  return fs.realpathSync(path.dirname(absGitDir));
}

export function tryGetRepoRoot(cwd = process.cwd(), { requireClips = false } = {}) {
  try {
    const repoRoot = getRepoRoot(cwd);
    if (requireClips && !fs.existsSync(path.join(repoRoot, CLIPS_DIR))) return null;
    return repoRoot;
  } catch {
    return null;
  }
}

/**
 * Return the repository commit associated with a planning status change.
 * Status changes are appended after the implementation commit in the normal
 * workflow, so HEAD is the commit that produced the completed work.
 */
export function getCurrentCommitSha() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim() || null;
  } catch {
    return null;
  }
}

export function getClipsDir(repoRoot = getRepoRoot()) {
  return path.join(repoRoot, CLIPS_DIR);
}

export function getClipsDbDir(repoRoot = getRepoRoot()) {
  return path.join(repoRoot, CLIPS_DB_DIR);
}

export function getClipsRecordsDir(recordType = null, repoRoot = getRepoRoot()) {
  const recordsDir = path.join(repoRoot, CLIPS_RECORDS_DIR);
  return recordType ? path.join(recordsDir, recordType) : recordsDir;
}

/**
 * Get the file path for a goal, supporting namespaced and legacy locations
 * Namespaced: .clips/db/{username}/{goalId}.jsonl
 * Legacy: .clips/db/{goalId}.jsonl
 * 
 * @param {string} goalId - The goal ID
 * @param {string} [username] - Optional username for namespacing
 * @returns {string} Path to the goal file
 */
export function getGoalFilePath(goalId, username = null) {
  const dbDir = getClipsDbDir();
  
  // If username provided, use namespaced path
  if (username) {
    return path.join(dbDir, username, `${goalId}.jsonl`);
  }
  
  // Check if namespaced file exists for current user
  const currentUser = getCurrentUsername();
  if (currentUser) {
    const namespacedPath = path.join(dbDir, currentUser, `${goalId}.jsonl`);
    if (fs.existsSync(namespacedPath)) {
      return namespacedPath;
    }
  }
  
  // Fall back to legacy root-level path
  return path.join(dbDir, `${goalId}.jsonl`);
}

/**
 * Check if a goal exists (checks both namespaced and legacy locations)
 */
export function goalExists(goalId, username = null) {
  const dbDir = getClipsDbDir();
  
  // If username specified, only check that namespace
  if (username) {
    return fs.existsSync(path.join(dbDir, username, `${goalId}.jsonl`));
  }
  
  // Check legacy location first
  if (fs.existsSync(path.join(dbDir, `${goalId}.jsonl`))) {
    return true;
  }
  
  // Check namespaced location for current user
  const currentUser = getCurrentUsername();
  if (currentUser) {
    return fs.existsSync(path.join(dbDir, currentUser, `${goalId}.jsonl`));
  }
  
  return false;
}

export function appendEvent(goalId, event, options = {}) {
  const filePath = getGoalFilePath(goalId, options.username);
  return withRecordLock(filePath, () => {
    const events = readJsonEvents(filePath);
    const current = events.length ? replayGoalEvents(events, goalId) : null;
    const target = event.task_id ? current?.tasks[event.task_id] : current;
    const ref = formatRef({ username: options.username, goalId, taskId: event.task_id });
    assertExpectedRevision(options.expectedRevision, target?.revision || 0, ref);
    if (['created', 'goal_created', 'task_created'].includes(event.event) && target) {
      throw new Error(`Record ${ref} already exists; read it before retrying creation`);
    }
    if (event.task_id && event.event !== 'task_created' && !target) {
      throw new Error(`Task ${ref} not found`);
    }
    appendJsonEvent(filePath, event);
  });
}

// Older versions stored both criterion maps and objects with `text` rather
// than `description`. Read those historical shapes without rewriting the log.
// Map keys and old IDs are retained so later legacy amendments keep identity.
function readableCriteria(value, previous) {
  const prior = Array.isArray(previous.acceptance_criteria) ? previous.acceptance_criteria : [];
  const entries = Array.isArray(value) ? value.map((item) => [null, item])
    : value && typeof value === 'object' ? Object.entries(value) : [];
  return entries.map(([key, value]) => {
    if (key === null && typeof value === 'string') return value;
    const item = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : { description: String(value) };
    if (typeof item.description !== 'string' && typeof item.text === 'string') item.description = item.text;
    if (typeof item.description !== 'string') item.description = JSON.stringify(value);
    if (key !== null) item.legacy_key = key;
    if (item.id !== undefined && !/^A[1-9]\d*$/i.test(String(item.id))) {
      item.legacy_id = item.id;
      delete item.id;
    }
    if (item.id === undefined) {
      const match = prior.find((old) => (key !== null && old.legacy_key === key)
        || (item.legacy_id !== undefined && old.legacy_id === item.legacy_id));
      if (match) item.id = match.id;
      else if (key && /^A[1-9]\d*$/i.test(key)) item.id = key;
    }
    return item;
  });
}

function normalizeWorkRecord(record, previous = {}) {
  const fields = normalizeAcceptanceCriteria(readableCriteria(record.acceptance_criteria, previous), previous, { allowEmpty: true });
  return { ...record, ...fields,
    acceptance_criteria_next_id: Math.max(fields.acceptance_criteria_next_id, record.acceptance_criteria_next_id || 1),
    behavior: record.behavior || '',
  };
}

function assertSnapshotRevision(revision, label) {
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
    throw new Error(`${label} must be a positive integer`);
  }
}

/** Replay the durable model for current and historical record views.
 * Goal revisions count all events in its aggregate stream. A task revision counts
 * events affecting that task, including changes to inherited verification mode.
 * Reading a task revision stops at the event that first produced that snapshot.
 */
export function replayGoalEvents(events, goalId, { revision, taskId, taskRevision, onEvent } = {}) {
  assertSnapshotRevision(revision, 'revision');
  assertSnapshotRevision(taskRevision, 'taskRevision');
  if (taskRevision !== undefined && !taskId) throw new Error('taskRevision requires taskId');
  if (revision !== undefined && revision > events.length) throw new Error(`Revision r${revision} not found for #${goalId}`);
  let goal = { goal_id: goalId, tasks: {}, _taskOrder: [], revision: 0 };
  let foundTaskRevision = false;
  for (let index = 0; index < (revision ?? events.length); index++) {
    const event = events[index];
    const previousGoal = goal;
    const previousTask = event.task_id ? goal.tasks[event.task_id] : null;
    goal = { ...goal, tasks: { ...goal.tasks }, _taskOrder: [...(goal._taskOrder || [])] };
    const affectedTasks = new Set();
    switch (event.event) {
      case 'created':
      case 'goal_created':
        goal = { ...goal, ...event, tasks: goal.tasks, _taskOrder: goal._taskOrder };
        break;
      case 'updated':
        goal = { ...goal, ...event, tasks: goal.tasks, _taskOrder: goal._taskOrder };
        break;
      case 'status_changed':
        goal = { ...goal, ...event };
        goal.closed_commit_sha = event.status === 'closed' ? (event.commit_sha || event.closed_commit_sha || event.commit || null) : null;
        break;
      case 'github_synced':
        goal.issue_number = event.issue_number;
        goal.issue_url = event.issue_url;
        goal.github_unlinked = false;
        break;
      case 'github_unlinked':
        delete goal.issue_number;
        delete goal.issue_url;
        goal.github_unlinked = true;
        for (const [id, task] of Object.entries(goal.tasks)) {
          const updated = { ...task };
          delete updated.issue_number;
          delete updated.issue_url;
          goal.tasks[id] = updated;
          affectedTasks.add(id);
        }
        break;
      case 'github_pr_synced':
        goal.github_prs = { ...(goal.github_prs || {}), [`${event.repository || ''}#${event.pr_number}`]: event };
        break;
      case 'adr_attached':
        goal.adr_id = event.adr_id;
        break;
      case 'adr_detached':
        delete goal.adr_id;
        break;
      case 'task_created':
        goal.tasks[event.task_id] = { ...event, description: event.description || '', status: event.status || 'open' };
        if (!goal._taskOrder.includes(event.task_id)) goal._taskOrder.push(event.task_id);
        affectedTasks.add(event.task_id);
        break;
      case 'task_updated':
        if (previousTask) {
          goal.tasks[event.task_id] = { ...previousTask, ...event };
          affectedTasks.add(event.task_id);
        }
        break;
      case 'task_status_changed':
        if (previousTask) {
          goal.tasks[event.task_id] = { ...previousTask, ...event,
            closed_commit_sha: event.status === 'closed' ? (event.commit_sha || event.closed_commit_sha || event.commit || null) : null,
          };
          affectedTasks.add(event.task_id);
        }
        break;
      case 'task_github_synced':
        if (previousTask) {
          if (!goal.github_unlinked) goal.tasks[event.task_id] = { ...previousTask, issue_number: event.issue_number, issue_url: event.issue_url };
          affectedTasks.add(event.task_id);
        }
        break;
      case 'tasks_reordered':
        if (Array.isArray(event.order)) goal._taskOrder = event.order;
        break;
    }
    goal = normalizeWorkRecord(goal, previousGoal);
    goal.type = normalizeGoalType(goal.type);
    goal.verification_mode = effectiveVerificationMode(goal.verification_mode);
    let childAgreementChanged = event.event === 'task_created';
    for (const [id, raw] of Object.entries(goal.tasks)) {
      const previous = previousGoal.tasks[id];
      let task = normalizeWorkRecord(raw, previous || {});
      task.effective_verification_mode = effectiveVerificationMode(goal.verification_mode, task.verification_mode);
      const inheritedModeChanged = previous && previous.effective_verification_mode !== task.effective_verification_mode;
      if (inheritedModeChanged) affectedTasks.add(id);
      if (previous && affectedTasks.has(id)) {
        const requestChanged = workRequestChanged(previous, task);
        const explicitlyAccepted = event.task_id === id && event.acceptance;
        if ((requestChanged || inheritedModeChanged) && !explicitlyAccepted) {
          const invalidation = invalidateAcceptanceFields(previous, task, {
            force: inheritedModeChanged, timestamp: event.timestamp || null,
            reason: inheritedModeChanged ? 'Inherited verification requirements changed' : 'The task agreement changed',
          });
          // Command-created invalidations already contain the historical receipt.
          if (!Object.hasOwn(event, 'acceptance') || event.task_id !== id) task = { ...task, ...invalidation };
        }
        if (previous.acceptance && task.status !== 'closed' && task.acceptance) {
          task = { ...task, ...invalidateAcceptanceFields(previous, {}, { force: true, timestamp: event.timestamp || null, reason: 'The task was reopened' }) };
          if (event.event === 'task_status_changed') task.status = event.status;
        }
        if (requestChanged || previous.status !== task.status || !isDeepStrictEqual(previous.acceptance, task.acceptance)) childAgreementChanged = true;
      }
      task.revision = (previous?.revision || 0) + (affectedTasks.has(id) ? 1 : 0);
      goal.tasks[id] = task;
    }
    if (previousGoal.revision) {
      const explicitGoalAcceptance = !event.task_id && event.acceptance;
      if (!explicitGoalAcceptance && !Object.hasOwn(event, 'acceptance')) {
        goal = { ...goal, ...invalidateAcceptanceFields(previousGoal, goal, {
          kind: 'goal', timestamp: event.timestamp || null,
        }) };
      }
      if (previousGoal.acceptance && (childAgreementChanged || (goal.status !== 'closed' && goal.acceptance))) {
        goal = { ...goal, ...invalidateAcceptanceFields(previousGoal, {}, {
          kind: 'goal', force: true, timestamp: event.timestamp || null,
          reason: childAgreementChanged ? 'A child task agreement, disposition, or acceptance changed' : 'The goal was reopened',
        }) };
        if (event.event === 'status_changed') goal.status = event.status;
      }
    }
    goal.revision = index + 1;
    onEvent?.(event, goal, affectedTasks);
    if (taskRevision !== undefined && goal.tasks[taskId]?.revision === taskRevision) {
      foundTaskRevision = true;
      break;
    }
  }
  if (taskRevision !== undefined && !foundTaskRevision) throw new Error(`Revision r${taskRevision} not found for #${goalId}#${taskId}`);
  goal.lane_id = goal.track_id ? `l${String(goal.track_id).replace(/^r/i, '')}` : (goal.lane_id ?? null);
  return goal;
}

export function readGoalWithTasks(goalId, username = null, options = {}) {
  const filePath = getGoalFilePath(goalId, username);
  if (!fs.existsSync(filePath)) return null;
  return replayGoalEvents(readJsonEvents(filePath), goalId, options);
}

export function readGoalHistory(goalId, username = null, { taskId, revision } = {}) {
  const filePath = getGoalFilePath(goalId, username);
  if (!fs.existsSync(filePath)) return null;
  const events = readJsonEvents(filePath);
  if (!taskId) {
    if (revision !== undefined) replayGoalEvents(events, goalId, { revision });
    return events.slice(0, revision).map((event, index) => ({ ...event, revision: index + 1 }));
  }
  const history = [];
  let previous = 0;
  replayGoalEvents(events, goalId, { taskId, taskRevision: revision, onEvent(event, snapshot) {
    const current = snapshot.tasks[taskId]?.revision || 0;
    if (current > previous) history.push({ ...event, revision: current, goal_revision: snapshot.revision });
    previous = current;
  } });
  if (revision !== undefined && previous !== revision) throw new Error(`Revision r${revision} not found for #${goalId}#${taskId}`);
  return history;
}

export function run(cmd, opts = {}) {
  const DIM = '\x1b[2m';
  const RESET = '\x1b[0m';
  
  try {
    if (opts.dim) {
      const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe', ...opts });
      if (output) {
        console.log(`${DIM}${output.trim()}${RESET}`);
      }
      return output;
    }
    return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
  } catch (e) {
    if (opts.silent) return null;
    throw e;
  }
}

/**
 * Get tasks as an array in their defined order
 */
export function getOrderedTasks(goal) {
  if (goal._taskOrder && goal._taskOrder.length > 0) {
    return goal._taskOrder
      .filter(id => goal.tasks[id])
      .map(id => goal.tasks[id]);
  }
  // Fallback: sort by task_id (t1, t2, t3...)
  return Object.values(goal.tasks).sort((a, b) => {
    const numA = parseInt(a.task_id.replace('t', ''), 10);
    const numB = parseInt(b.task_id.replace('t', ''), 10);
    return numA - numB;
  });
}

export function getNextPendingTask(goal) {
  const tasks = getOrderedTasks(goal);
  return tasks.find(t => t.status === 'open');
}
