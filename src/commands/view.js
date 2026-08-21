// View command - display goals and tasks
import fs from 'fs';
import path from 'path';
import { parseRef, readGoalWithTasks, getClipsDbDir, getCurrentUsername, formatRef } from '../lib/core.js';
import { readConfig } from '../lib/config.js';

const STATUS_ICONS = {
  open: '🟢',
  in_progress: '🟠',
  closed: '🟣',
  not_planned: '⚪',
  duplicate: '⚪',
};

const STATUS_COLORS = {
  open: '\x1b[32m',
  in_progress: '\x1b[33m',
  closed: '\x1b[35m',
  not_planned: '\x1b[90m',
  duplicate: '\x1b[90m',
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

function formatStatus(status) {
  const icon = STATUS_ICONS[status] || '❓';
  const color = STATUS_COLORS[status] || '';
  return `${color}${icon} ${status}${RESET}`;
}

function formatVerificationMode(mode) {
  return mode === 'behavior_and_tests' ? 'behavior + tests' : 'behavior';
}

function wrapText(text, width, indent = '') {
  if (!text) return '';
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length > width) {
      lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine = (currentLine + ' ' + word).trim();
    }
  }
  if (currentLine) lines.push(currentLine);
  
  return lines.map((line, i) => (i === 0 ? '' : indent) + line).join('\n');
}

function viewGoal(goalId, username = null) {
  const goal = readGoalWithTasks(goalId, username);
  if (!goal) {
    const refStr = username ? `#${username}#${goalId}` : `#${goalId}`;
    console.error(`Error: Goal ${refStr} not found`);
    process.exit(1);
  }
  
  // Read view config
  const config = readConfig();
  const viewConfig = config.view || {};
  const hideTaskStatuses = viewConfig.hide_task_statuses || ['archived'];
  
  const tasks = Object.values(goal.tasks);
  const completedTasks = tasks.filter(t => ['closed', 'not_planned', 'duplicate'].includes(t.status)).length;
  
  // Build display ref with username prefix
  const displayRef = formatRef({ username, goalId: goal.goal_id }, { includeUsername: !!username });
  
  console.log();
  console.log(`${BOLD}┌─────────────────────────────────────────────────────────────┐${RESET}`);
  console.log(`${BOLD}│${RESET} ${BOLD}${displayRef}${RESET} ${goal.title}`);
  console.log(`${BOLD}├─────────────────────────────────────────────────────────────┤${RESET}`);
  console.log(`${BOLD}│${RESET} Status: ${formatStatus(goal.status)}`);
  console.log(`${BOLD}│${RESET} Verification: ${formatVerificationMode(goal.verification_mode)}`);
  if (goal.issue_number) {
    console.log(`${BOLD}│${RESET} GitHub: #${goal.issue_number} ${DIM}${goal.issue_url || ''}${RESET}`);
  }
  console.log(`${BOLD}│${RESET} Tasks:  ${completedTasks}/${tasks.length} complete`);
  console.log(`${BOLD}└─────────────────────────────────────────────────────────────┘${RESET}`);
  
  if (goal.description) {
    console.log();
    console.log(`${BOLD}Description${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────${RESET}`);
    console.log(wrapText(goal.description, 60));
  }
  
  if (goal.acceptance_criteria && goal.acceptance_criteria.length > 0) {
    console.log();
    console.log(`${BOLD}Acceptance Criteria${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────${RESET}`);
    for (const criterion of goal.acceptance_criteria) {
      console.log(`  • ${criterion}`);
    }
  }

  if (goal.behavior) {
    console.log();
    console.log(`${BOLD}Behavior${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────${RESET}`);
    console.log(goal.behavior);
  }
  
  if (tasks.length > 0) {
    console.log();
    console.log(`${BOLD}Tasks${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────${RESET}`);
    for (const task of tasks) {
      // Skip tasks with hidden statuses
      if (hideTaskStatuses.includes(task.status)) continue;
      
      // Checkbox symbol and color per status
      let checkbox, color;
      switch (task.status) {
        case 'closed':
          checkbox = 'x'; color = DIM; break;
        case 'not_planned':
          checkbox = '-'; color = DIM; break;
        case 'duplicate':
          checkbox = '~'; color = DIM; break;
        case 'open':
          checkbox = ' '; color = '\x1b[32m'; break; // green
        case 'in_progress':
          checkbox = '·'; color = '\x1b[38;5;208m'; break; // orange
        default:
          checkbox = ' '; color = ''; break;
      }
      // Show task ref with username if viewing namespaced goal
      const taskRef = formatRef({ username, goalId: goal.goal_id, taskId: task.task_id }, { includeUsername: !!username });
      console.log(`  ${color}[${checkbox}]${RESET} ${BOLD}${taskRef}${RESET}: ${task.title}`);
      if (task.description) {
        console.log(`      ${DIM}${wrapText(task.description, 50, '      ')}${RESET}`);
      }
    }
  }
  
  console.log();
}

function viewTask(goalId, taskId, username = null) {
  const goal = readGoalWithTasks(goalId, username);
  if (!goal) {
    const refStr = username ? `#${username}#${goalId}` : `#${goalId}`;
    console.error(`Error: Goal ${refStr} not found`);
    process.exit(1);
  }
  
  const task = goal.tasks[taskId];
  if (!task) {
    const refStr = username ? `#${username}#${goalId}#${taskId}` : `#${goalId}#${taskId}`;
    console.error(`Error: Task ${refStr} not found`);
    process.exit(1);
  }
  
  // Build display refs with username prefix
  const taskRef = formatRef({ username, goalId, taskId }, { includeUsername: !!username });
  const goalRef = formatRef({ username, goalId }, { includeUsername: !!username });
  
  console.log();
  console.log(`${BOLD}┌─────────────────────────────────────────────────────────────┐${RESET}`);
  console.log(`${BOLD}│${RESET} ${BOLD}${taskRef}${RESET} ${task.title}`);
  console.log(`${BOLD}├─────────────────────────────────────────────────────────────┤${RESET}`);
  console.log(`${BOLD}│${RESET} Status: ${formatStatus(task.status)}`);
  console.log(`${BOLD}│${RESET} Goal:   ${DIM}${goalRef} ${goal.title}${RESET}`);
  console.log(`${BOLD}│${RESET} Verification: ${formatVerificationMode(task.effective_verification_mode)}`);
  if (task.issue_number) {
    console.log(`${BOLD}│${RESET} GitHub: #${task.issue_number}`);
  }
  console.log(`${BOLD}└─────────────────────────────────────────────────────────────┘${RESET}`);
  
  if (task.description) {
    console.log();
    console.log(`${BOLD}Description${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────${RESET}`);
    console.log(wrapText(task.description, 60));
  }

  if (task.behavior) {
    console.log();
    console.log(`${BOLD}Behavior${RESET}`);
    console.log(`${DIM}─────────────────────────────────────────${RESET}`);
    console.log(task.behavior);
  }
  
  console.log();
}

/**
 * Discover all goals in the db directory
 * Returns array of { username, goalId, filePath } objects
 * Scans both legacy root-level and namespaced user directories
 */
function discoverGoals() {
  const clipsDbDir = getClipsDbDir();
  if (!fs.existsSync(clipsDbDir)) {
    return [];
  }
  
  const goals = [];
  const entries = fs.readdirSync(clipsDbDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name.startsWith('g')) {
      // Legacy root-level goal (e.g., g001.jsonl)
      goals.push({
        username: null,
        goalId: entry.name.replace('.jsonl', ''),
        filePath: path.join(clipsDbDir, entry.name)
      });
    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      // User namespace directory (e.g., dfosco/)
      const userDir = path.join(clipsDbDir, entry.name);
      const userFiles = fs.readdirSync(userDir).filter(f => f.endsWith('.jsonl'));
      for (const file of userFiles) {
        goals.push({
          username: entry.name,
          goalId: file.replace('.jsonl', ''),
          filePath: path.join(userDir, file)
        });
      }
    }
  }
  
  return goals;
}

function listAllGoals(showAll = false, showAllUsers = false) {
  const clipsDbDir = getClipsDbDir();
  if (!fs.existsSync(clipsDbDir)) {
    console.log(`${DIM}No goals yet. Create one with: clips goal create '{"title":"..."}'${RESET}`);
    return;
  }
  
  const allGoals = discoverGoals();
  if (allGoals.length === 0) {
    console.log(`${DIM}No goals yet. Create one with: clips goal create '{"title":"..."}'${RESET}`);
    return;
  }
  
  // Read view config (ignored if showAll is true)
  const config = readConfig();
  const viewConfig = config.view || {};
  const hideGoalStatuses = showAll ? [] : (viewConfig.hide_goal_statuses || ['archived']);
  const hideTaskStatuses = showAll ? [] : (viewConfig.hide_task_statuses || ['archived']);
  const hideTasksForGoalStatuses = showAll ? [] : (viewConfig.hide_tasks_for_goal_statuses || ['closed']);
  
  // Get current user for filtering and display
  const currentUser = getCurrentUsername();
  
  // Group goals by username
  const goalsByUser = new Map();
  for (const goalEntry of allGoals) {
    const key = goalEntry.username || '_legacy';
    if (!goalsByUser.has(key)) {
      goalsByUser.set(key, []);
    }
    goalsByUser.get(key).push(goalEntry);
  }
  
  // Determine which users to show
  let usersToShow;
  if (showAllUsers) {
    // Show all users
    usersToShow = Array.from(goalsByUser.keys());
  } else if (currentUser && goalsByUser.has(currentUser)) {
    // Show only current user's namespaced goals
    usersToShow = [currentUser];
    // Also include legacy goals (assumed to be current user's)
    if (goalsByUser.has('_legacy')) {
      usersToShow.push('_legacy');
    }
  } else {
    // No current user configured, show all
    usersToShow = Array.from(goalsByUser.keys());
  }
  
  console.log();
  console.log(`${BOLD}Goals${RESET}`);
  console.log(`${DIM}═════════════════════════════════════════════════════════════${RESET}`);
  
  for (const userKey of usersToShow) {
    const userGoals = goalsByUser.get(userKey) || [];
    
    // Show user header when viewing multiple users
    if (showAllUsers && userKey !== '_legacy') {
      console.log();
      console.log(`${DIM}┌── @${userKey} ──────────────────────────────────────────────┐${RESET}`);
    }
    
    for (const goalEntry of userGoals) {
      const goal = readGoalWithTasks(goalEntry.goalId, goalEntry.username);
      if (!goal) continue;
      
      // Skip goals with hidden statuses
      if (hideGoalStatuses.includes(goal.status)) continue;
      
      const tasks = Object.values(goal.tasks);
      const completedTasks = tasks.filter(t => ['closed', 'not_planned', 'duplicate'].includes(t.status)).length;
      const taskInfo = tasks.length > 0 ? `${DIM}[${completedTasks}/${tasks.length}]${RESET}` : '';
      
      // Build display ref - show username prefix when viewing all users
      const displayRef = formatRef(
        { username: goalEntry.username, goalId: goal.goal_id }, 
        { includeUsername: showAllUsers && goalEntry.username }
      );
      
      console.log();
      console.log(`  ${formatStatus(goal.status)} ${BOLD}${displayRef}${RESET} ${goal.title} ${taskInfo} ${DIM}[${formatVerificationMode(goal.verification_mode)}]${RESET}`);
      
      // Hide tasks if goal status is in hideTasksForGoalStatuses
      if (hideTasksForGoalStatuses.includes(goal.status)) continue;
      
      if (tasks.length > 0) {
        for (const task of tasks) {
          // Skip tasks with hidden statuses
          if (hideTaskStatuses.includes(task.status)) continue;
          
          // Checkbox symbol and color per status
          let checkbox, color;
          switch (task.status) {
            case 'closed':
              checkbox = 'x'; color = DIM; break;
            case 'not_planned':
              checkbox = '-'; color = DIM; break;
            case 'duplicate':
              checkbox = '~'; color = DIM; break;
            case 'open':
              checkbox = ' '; color = '\x1b[32m'; break; // green
            case 'in_progress':
              checkbox = '·'; color = '\x1b[38;5;208m'; break; // orange
            default:
              checkbox = ' '; color = ''; break;
          }
          console.log(`     ${color}[${checkbox}]${RESET} ${DIM}#${task.task_id}${RESET} ${task.title} ${DIM}[${formatVerificationMode(task.effective_verification_mode)}]${RESET}`);
        }
      }
    }
    
    // Close user section
    if (showAllUsers && userKey !== '_legacy') {
      console.log(`${DIM}└──────────────────────────────────────────────────────────────┘${RESET}`);
    }
  }
  
  console.log();
  
  // Show hints
  if (!showAll && !showAllUsers) {
    console.log(`${DIM}Run \`clips view all\` to see hidden entries, \`clips view --all-users\` for all users${RESET}`);
    console.log();
  } else if (!showAll) {
    console.log(`${DIM}Run \`clips view all\` to see entries hidden by clips.config.json${RESET}`);
    console.log();
  }
}

export function runViewCommand(args) {
  // Parse flags
  const showAllUsers = args.includes('--all-users') || args.includes('-u');
  const filteredArgs = args.filter(a => !a.startsWith('-'));
  const [ref] = filteredArgs;
  
  if (!ref) {
    listAllGoals(false, showAllUsers);
  } else if (ref === 'all') {
    listAllGoals(true, showAllUsers);
  } else {
    const parsed = parseRef(ref);
    if (!parsed) {
      console.error('Error: Invalid reference. Use #goal_id, #goal_id#task_id, or #username#goal_id');
      process.exit(1);
    }
    
    if (parsed.taskId) {
      viewTask(parsed.goalId, parsed.taskId, parsed.username);
    } else {
      viewGoal(parsed.goalId, parsed.username);
    }
  }
}
