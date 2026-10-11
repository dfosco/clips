// View command - display goals and tasks
import fs from 'fs';
import path from 'path';
import { parseRef, readGoalWithTasks, getClipsDbDir, getCurrentUsername, formatRef } from '../lib/core.js';
import { readConfig } from '../lib/config.js';
import { readComponent } from '../lib/components.js';
import { renderComponent } from './component.js';
import { listLanes, normalizeLaneId, readLane } from '../lib/lanes.js';

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

function viewGoal(goalId, username = null, options = {}) {
  const goal = readGoalWithTasks(goalId, username, options);
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
  console.log(`${BOLD}│${RESET} Revision: r${goal.revision}`);
  if (goal.lane_id) console.log(`${BOLD}│${RESET} Lane:   #${goal.lane_id}`);
  if (goal.blocked_by?.length) console.log(`${BOLD}│${RESET} Blocked by: ${goal.blocked_by.map((id) => id.startsWith('#') ? id : `#${id}`).join(', ')}`);
  console.log(`${BOLD}│${RESET} Verification: ${formatVerificationMode(goal.verification_mode)}`);
  if (goal.adr_id) {
    console.log(`${BOLD}│${RESET} ADR:    ${goal.adr_id}`);
  }
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
      console.log(`  ${displayRef}#${criterion.id}: ${criterion.description}`);
    }
  }

  printWorkFields(goal, displayRef, { criteria: false });

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

function viewTask(goalId, taskId, username = null, options = {}) {
  const goal = readGoalWithTasks(goalId, username, { taskId, taskRevision: options.revision });
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
  console.log(`${BOLD}│${RESET} Revision: r${task.revision}`);
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

  printWorkFields(task, taskRef);

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
      const userFiles = fs.readdirSync(userDir).filter(f => /^g\d+\.jsonl$/.test(f));
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

function laneGoals(laneId) {
  return discoverGoals()
    .map(({ goalId, username }) => ({ goal: readGoalWithTasks(goalId, username), username }))
    .filter(({ goal }) => goal?.lane_id === laneId);
}

function printLaneGoals(members) {
  console.log(`  Goals (${members.length})`);
  if (!members.length) {
    console.log(`    ${DIM}None yet${RESET}`);
    return;
  }
  for (const { goal, username } of members) {
    const ref = formatRef({ username, goalId: goal.goal_id }, { includeUsername: !!username });
    console.log(`    ${formatStatus(goal.status)} ${BOLD}${ref}${RESET} ${goal.title}`);
  }
}

function viewLane(ref) {
  const match = String(ref || '').match(/^#?([lr]\d+)(?:#r(\d+))?$/i);
  if (!match) throw new Error(`Invalid lane ref: ${ref}`);
  const id = normalizeLaneId(match[1]);
  const lane = readLane(id, undefined, { revision: match[2] ? Number(match[2]) : undefined });
  if (!lane) {
    console.error(`Error: Lane #${id} not found`);
    process.exit(1);
  }
  const members = laneGoals(id);
  console.log();
  console.log(`${BOLD}#${id} ${lane.title}${RESET}`);
  console.log(`Status: ${formatStatus(lane.status)}`);
  console.log(`Revision: r${lane.revision}`);
  console.log(`Progress: ${members.filter(({ goal }) => goal.status === 'closed').length}/${members.length} goals closed`);
  if (lane.issue_number) console.log(`GitHub: #${lane.issue_number} ${DIM}${lane.issue_url || ''}${RESET}`);
  console.log();
  console.log(`${BOLD}Description${RESET}`);
  console.log(lane.description ? wrapText(lane.description, 60) : `${DIM}No description${RESET}`);
  if (lane.product_goals?.length) {
    console.log();
    console.log(`${BOLD}Product goals${RESET}`);
    for (const item of lane.product_goals) console.log(`  • ${item}`);
  }
  if (lane.closure) {
    console.log();
    console.log(`${BOLD}Lane closure${RESET}`);
    console.log(lane.closure.summary);
    console.log(`Product goals achieved: ${lane.closure.product_goals_achieved?.length || 0}`);
    console.log(`Components: ${lane.closure.components?.join(', ') || 'None recorded'}`);
    console.log(`Media: ${lane.closure.media?.length || 0} item(s)`);
  } else if (lane.legacy_acceptance_criteria?.length) {
    console.log();
    console.log(`${BOLD}Legacy Track criteria${RESET}`);
    for (const criterion of lane.legacy_acceptance_criteria) console.log(`  • ${criterion}`);
  }
  console.log();
  printLaneGoals(members);
  console.log();
}

function listAllGoals(showAll = false, showAllUsers = false) {
  const clipsDbDir = getClipsDbDir();
  if (!fs.existsSync(clipsDbDir)) {
    console.log(`${DIM}No goals yet. Create one with: clips goal create '{"title":"..."}'${RESET}`);
    return;
  }
  
  const allGoals = discoverGoals();
  if (allGoals.length === 0) {
    const lanes = listLanes();
    if (lanes.length) {
      console.log();
      console.log(`${BOLD}Lanes${RESET}`);
      for (const lane of lanes) {
        console.log(`  #${lane.lane_id} ${lane.title} [${lane.status}] 0/0 goals closed`);
        console.log(`    ${lane.description || 'No description'}`);
        printLaneGoals([]);
      }
      console.log();
    }
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
  const lanes = listLanes();
  if (lanes.length) {
    console.log(`${BOLD}Lanes${RESET}`);
    for (const lane of lanes) {
      const members = laneGoals(lane.lane_id);
      console.log(`  #${lane.lane_id} ${lane.title} [${lane.status}] ${members.filter(({ goal }) => goal.status === 'closed').length}/${members.length} goals closed`);
      console.log(`    ${lane.description || 'No description'}`);
      printLaneGoals(members);
    }
    console.log();
  }
  
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
      const resultInfo = goal.adr_id ? ` ${DIM}[${goal.adr_id}]${RESET}` : '';
      console.log(`  ${formatStatus(goal.status)} ${BOLD}${displayRef}${RESET} ${goal.title} ${taskInfo} ${DIM}[${goal.type}] [${formatVerificationMode(goal.verification_mode)}]${goal.lane_id ? ` [#${goal.lane_id}]` : ''}${goal.blocked_by?.length ? ` [blocked by ${goal.blocked_by.map((id) => id.startsWith('#') ? id : `#${id}`).join(', ')}]` : ''}${RESET}${resultInfo}`);
      
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

function printWorkFields(record, ref, { criteria = true } = {}) {
  for (const [label, name] of [['Scope', 'scope'], ['Plan', 'plan'], ['Decisions', 'decisions'], ['Change record', 'record']]) {
    if (record[name]) console.log(`\n${BOLD}${label}${RESET}\n${record[name]}`);
  }
  if (record.owner) console.log(`Owner: ${record.owner}`);
  if (record.acceptance_owner) console.log(`Acceptance owner: ${record.acceptance_owner}`);
  if (record.components?.length) console.log(`Components: ${record.components.join(', ')}`);
  if (record.blocked_by?.length) console.log(`Blocked by: ${record.blocked_by.join(', ')}`);
  if (criteria && record.acceptance_criteria?.length) {
    console.log(`\n${BOLD}Acceptance criteria${RESET}`);
    for (const item of record.acceptance_criteria) console.log(`${ref}#${item.id}: ${item.description}`);
  }
  if (record.acceptance) {
    console.log(`\n${BOLD}Acceptance${RESET}`);
    console.log(JSON.stringify(record.acceptance, null, 2));
  } else if (record.status === 'closed') console.log('\nClosed administratively; no acceptance receipt recorded.');
  for (const [heading, markdown] of Object.entries(record.sections || {})) console.log(`\n${BOLD}${heading}${RESET}\n${markdown}`);
  if (Object.keys(record.extensions || {}).length) console.log(`\nExtensions\n${JSON.stringify(record.extensions, null, 2)}`);
}

export function resolveViewRecord(parsed) {
  let record;
  if (parsed.componentId) {
    record = readComponent(parsed.componentId, parsed.username, { revision: parsed.revision });
  } else {
    if (!parsed.goalId) throw new Error('A task reference needs a goal. Use #g1#t1 or add --goal #g1.');
    const goal = readGoalWithTasks(parsed.goalId, parsed.username, parsed.taskId
      ? { taskId: parsed.taskId, taskRevision: parsed.revision }
      : { revision: parsed.revision });
    record = parsed.taskId ? goal?.tasks[parsed.taskId] : goal;
  }
  if (!record) throw new Error(`Record ${formatRef(parsed)} not found`);
  const ref = formatRef(parsed);
  if (parsed.criterionId) {
    const criterion = record.acceptance_criteria?.find((item) => item.id === parsed.criterionId);
    if (!criterion) throw new Error(`Acceptance criterion ${ref} not found`);
    return { ...criterion, ref, record_revision: record.revision,
      acceptance: record.acceptance?.criteria?.find((item) => item.id === parsed.criterionId) || null,
    };
  }
  return { ...record, ref };
}

export function runViewCommand(args) {
  const showAllUsers = args.includes('--all-users') || args.includes('-u');
  const json = args.includes('--json');
  const goalIndex = args.indexOf('--goal');
  const goalContext = goalIndex >= 0 ? parseRef(args[goalIndex + 1]) : null;
  if (goalIndex >= 0 && (!goalContext?.goalId || goalContext.taskId || goalContext.revision || goalContext.criterionId)) throw new Error('--goal requires a current goal reference');
  const filteredArgs = args.filter((arg, index) => index !== goalIndex && (goalIndex < 0 || index !== goalIndex + 1) && !arg.startsWith('-'));
  const [ref] = filteredArgs;
  if (!ref || ref === 'all') {
    if (json) {
      const currentUser = getCurrentUsername();
      const goals = discoverGoals().filter((entry) => showAllUsers || !currentUser || !entry.username || entry.username === currentUser)
        .map((entry) => ({ ...readGoalWithTasks(entry.goalId, entry.username), ref: formatRef(entry) }));
      console.log(JSON.stringify(goals, null, 2));
    } else listAllGoals(ref === 'all', showAllUsers);
    return;
  }
  if (/^#?[lr]\d+(?:#r\d+)?$/i.test(ref)) {
    const match = String(ref).match(/^#?([lr]\d+)(?:#r(\d+))?$/i);
    const lane = readLane(normalizeLaneId(match[1]), undefined, { revision: match[2] ? Number(match[2]) : undefined });
    if (!lane) throw new Error(`${/^#?r/i.test(ref) ? 'Track' : 'Lane'} ${ref} not found`);
    if (json) console.log(JSON.stringify(lane, null, 2));
    else viewLane(ref);
    return;
  }
  const parsed = parseRef(ref);
  if (!parsed) throw new Error('Invalid reference. Use #l1, #g1, #g1#t1, #c1, or a nested #rN / #A1 reference.');
  if (parsed.taskId && !parsed.goalId && goalContext) {
    parsed.goalId = goalContext.goalId;
    parsed.username = goalContext.username;
  }
  if (json || parsed.criterionId || parsed.componentId) {
    const record = resolveViewRecord(parsed);
    if (json) console.log(JSON.stringify(record, null, 2));
    else if (parsed.componentId) console.log(renderComponent(record));
    else {
      console.log(`${record.ref}: ${record.description}\nRecord revision: r${record.record_revision}`);
      if (record.acceptance) console.log(JSON.stringify(record.acceptance, null, 2));
    }
  } else if (parsed.taskId) {
    if (!parsed.goalId) throw new Error('Use a full goal/task reference, or --goal #g1 for a contextual task reference');
    viewTask(parsed.goalId, parsed.taskId, parsed.username, { revision: parsed.revision });
  } else viewGoal(parsed.goalId, parsed.username, { revision: parsed.revision });
}
