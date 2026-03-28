// Shared utilities for clips commands
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { readConfig } from './config.js';

export const CLIPS_DIR = '.clips';
export const CLIPS_DB_DIR = '.clips/db';

/**
 * Check if auto-commit is enabled (reads config directly to avoid circular imports)
 */
function isAutoCommitEnabled() {
  try {
    const configPath = path.join(getClipsDir(), 'clips.config.json');
    if (!fs.existsSync(configPath)) return true;
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.collaboration === false) return false;
    return config.auto_commit !== false;
  } catch (e) {
    return true;
  }
}

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
export function normalizeGoalId(input) {
  if (!input) return null;
  
  let id = input.replace(/^#/, '').toLowerCase();
  
  // Check if it exists as-is
  if (goalExists(id)) return id;
  
  // Try expanding short form: g1 → g001, g12 → g012
  const shortMatch = id.match(/^g(\d+)$/);
  if (shortMatch) {
    const num = shortMatch[1].padStart(3, '0');
    const expanded = `g${num}`;
    if (goalExists(expanded)) return expanded;
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
  if (!ref) return null;
  
  const input = ref.trim();
  
  // Full namespaced format: #username#g001#t4 or #username#g001
  const fullNamespaced = input.match(/^#?([a-z][a-z0-9_-]*)#(g\d+)(?:#(t\d+))?$/i);
  if (fullNamespaced) {
    return {
      username: fullNamespaced[1].toLowerCase(),
      goalId: normalizeGoalId(fullNamespaced[2]),
      taskId: fullNamespaced[3] ? normalizeTaskId(fullNamespaced[3]) : null
    };
  }
  
  // Combined format: #g001#t4 or g001#t4 (no username - defaults to current user)
  const combinedHash = input.match(/^#?([a-z0-9-]+)#([a-z0-9]+)$/i);
  if (combinedHash) {
    return {
      username: null, // Will default to current user
      goalId: normalizeGoalId(combinedHash[1]),
      taskId: normalizeTaskId(combinedHash[2])
    };
  }
  
  // Combined format with dash: g1-t4 or g001-t4
  const combinedDash = input.match(/^#?([a-z][a-z0-9]*)-([a-z0-9]+)$/i);
  if (combinedDash) {
    return {
      username: null,
      goalId: normalizeGoalId(combinedDash[1]),
      taskId: normalizeTaskId(combinedDash[2])
    };
  }
  
  // Task only: #t4 or t4
  const taskOnly = input.match(/^#?(t\d+)$/i);
  if (taskOnly) {
    return {
      username: null,
      goalId: null,
      taskId: normalizeTaskId(taskOnly[1])
    };
  }
  
  // Goal only (or non-numeric ID like dfosco for notepad)
  const goalOnly = input.match(/^#?([a-z0-9_-]+)$/i);
  if (goalOnly) {
    return {
      username: null,
      goalId: normalizeGoalId(goalOnly[1]),
      taskId: null
    };
  }
  
  return null;
}

/**
 * Format a ref object back into string form
 * @param {{ username?: string, goalId: string, taskId?: string }} ref
 * @param {{ includeUsername?: boolean }} options - if includeUsername is true, always include username
 * @returns {string} Formatted ref like #username#g001#t01 or #g001#t01
 */
export function formatRef(ref, options = {}) {
  if (!ref || !ref.goalId) return null;
  
  const parts = [];
  
  // Include username if specified in ref or options request it
  const username = ref.username || (options.includeUsername ? getCurrentUsername() : null);
  if (username) {
    parts.push(username);
  }
  
  parts.push(ref.goalId);
  
  if (ref.taskId) {
    parts.push(ref.taskId);
  }
  
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
    if (goalParsed && !goalParsed.taskId) {
      // Check if second looks like a task ID
      const taskParsed = parseRef(second);
      if (taskParsed && taskParsed.taskId && !taskParsed.goalId) {
        return {
          username: goalParsed.username,
          goalId: goalParsed.goalId,
          taskId: taskParsed.taskId
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
          taskId
        };
      }
    }
  }
  
  // Fall back to parsing first arg
  return parseRef(args[0]);
}

export function getRepoRoot() {
  // Use --git-common-dir to find main repo even from worktrees
  const gitDir = execSync('git rev-parse --git-common-dir', { encoding: 'utf8' }).trim();
  const absGitDir = path.resolve(gitDir);
  return path.dirname(absGitDir);
}

export function getClipsDir() {
  return path.join(getRepoRoot(), CLIPS_DIR);
}

export function getClipsDbDir() {
  return path.join(getRepoRoot(), CLIPS_DB_DIR);
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

/**
 * Commit .clips/ changes and push to remote
 * Flow: pull --rebase → add → commit → push (with retry)
 */
export function commitAndPush(message = 'clips update') {
  if (!isAutoCommitEnabled()) return;

  const root = getRepoRoot();
  try {
    // Pull first to reduce conflicts
    execSync('git pull --rebase 2>/dev/null || true', { encoding: 'utf8', stdio: 'pipe', cwd: root });

    // Stage .clips/
    execSync('git add .clips/', { encoding: 'utf8', stdio: 'pipe', cwd: root });

    // Check if there are staged changes
    try {
      execSync('git diff --cached --quiet .clips/', { encoding: 'utf8', stdio: 'pipe', cwd: root });
      return; // No changes to commit
    } catch {
      // diff --quiet exits non-zero when there ARE changes — proceed
    }

    // Commit
    execSync(`git commit -m "${message}"`, { encoding: 'utf8', stdio: 'pipe', cwd: root });

    // Push with retry
    try {
      execSync('git push 2>/dev/null', { encoding: 'utf8', stdio: 'pipe', cwd: root });
    } catch {
      execSync('git pull --rebase 2>/dev/null || true', { encoding: 'utf8', stdio: 'pipe', cwd: root });
      execSync('git push 2>/dev/null', { encoding: 'utf8', stdio: 'pipe', cwd: root });
    }
  } catch (e) {
    // Best-effort — don't crash on git failures
  }
}

export function appendEvent(goalId, event, options = {}) {
  // Validate no undefined values in event
  const undefinedKeys = Object.entries(event)
    .filter(([_, value]) => value === undefined)
    .map(([key]) => key);
  
  if (undefinedKeys.length > 0) {
    throw new Error(`Cannot append event with undefined values: ${undefinedKeys.join(', ')}`);
  }

  const filePath = getGoalFilePath(goalId, options.username);
  
  // Ensure parent directory exists for namespaced paths
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  
  // Ensure file ends with newline before appending (fix corruption)
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content.length > 0 && !content.endsWith('\n')) {
      fs.appendFileSync(filePath, '\n');
    }
  }
  
  fs.appendFileSync(filePath, JSON.stringify(event) + '\n');
}

export function readGoalWithTasks(goalId, username = null) {
  const filePath = getGoalFilePath(goalId, username);
  if (!fs.existsSync(filePath)) return null;
  
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  let goal = { goal_id: goalId, tasks: {} };
  
  for (const line of lines) {
    const event = JSON.parse(line);
    switch (event.event) {
      case 'created':  // legacy
      case 'goal_created':
        goal = { ...goal, ...event, tasks: {} };
        break;
      case 'updated':
        goal = { ...goal, ...event };
        break;
      case 'status_changed':
        goal.status = event.status;
        break;
      case 'github_synced':
        goal.issue_number = event.issue_number;
        goal.issue_url = event.issue_url;
        break;
      case 'task_created':
        goal.tasks[event.task_id] = {
          task_id: event.task_id,
          title: event.title,
          description: event.description,
          status: 'open'
        };
        goal._taskOrder = goal._taskOrder || [];
        goal._taskOrder.push(event.task_id);
        break;
      case 'task_updated':
        if (goal.tasks[event.task_id]) {
          goal.tasks[event.task_id] = { ...goal.tasks[event.task_id], ...event };
        }
        break;
      case 'task_status_changed':
        if (goal.tasks[event.task_id]) {
          goal.tasks[event.task_id].status = event.status;
        }
        break;
      case 'task_github_synced':
        if (goal.tasks[event.task_id]) {
          goal.tasks[event.task_id].issue_number = event.issue_number;
        }
        break;
      case 'tasks_reordered':
        goal._taskOrder = event.order;
        break;
    }
  }
  
  return goal;
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
