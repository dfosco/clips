import fs from 'node:fs';
import path from 'node:path';
import { getClipsDbDir, getRepoRoot } from './core.js';

export const BOARD_COLUMNS = [
  { id: 'open', label: 'Open' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'closed', label: 'Closed' },
  { id: 'not_planned', label: 'Not planned' },
];

const VALID_STATUSES = new Set(['open', 'in_progress', 'closed', 'not_planned', 'duplicate']);

function normalizeStatus(status) {
  const value = typeof status === 'string' ? status : 'open';
  return VALID_STATUSES.has(value) ? value : 'open';
}

function columnForStatus(status) {
  if (status === 'duplicate') return 'not_planned';
  return BOARD_COLUMNS.some((column) => column.id === status) ? status : 'open';
}

function formatRef(username, goalId, taskId = null) {
  return `#${[username, goalId, taskId].filter(Boolean).join('#')}`;
}

function orderedTasks(goal) {
  const tasks = goal._taskOrder?.filter((taskId) => goal.tasks[taskId]).map((taskId) => goal.tasks[taskId]);
  if (tasks?.length) return tasks;

  return Object.values(goal.tasks).sort((left, right) => {
    const leftNumber = Number.parseInt(left.task_id.replace('t', ''), 10);
    const rightNumber = Number.parseInt(right.task_id.replace('t', ''), 10);
    return leftNumber - rightNumber;
  });
}

function parseChangeRecord(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const titleLine = lines.find((line) => line.startsWith('# CR-')) || '';
  const titleMatch = titleLine.match(/^# (CR-\d+):\s*(.+)$/);
  if (!titleMatch) return null;

  const field = (name) => {
    const marker = `**${name}:**`;
    return lines.find((line) => line.startsWith(marker))?.slice(marker.length).trim() || '';
  };
  const covers = field('Covers')
    .split(',')
    .map((ref) => ref.trim())
    .filter((ref) => ref && ref !== 'Untracked');

  return {
    id: titleMatch[1],
    title: titleMatch[2],
    status: field('Status'),
    type: field('Type'),
    covers,
    markdown: lines.join('\n'),
    path: filePath,
  };
}

export function readChangeRecords(recordsDir = path.join(getRepoRoot(), 'docs', 'records', 'cr')) {
  if (!fs.existsSync(recordsDir)) return { records: [], warnings: [] };

  const records = [];
  const warnings = [];
  for (const file of fs.readdirSync(recordsDir).filter((name) => /^CR-\d+.*\.md$/.test(name)).sort()) {
    const filePath = path.join(recordsDir, file);
    try {
      const record = parseChangeRecord(filePath);
      if (record) records.push(record);
    } catch (error) {
      warnings.push({ path: filePath, message: error.message });
    }
  }
  return { records, warnings };
}

function recordMatchesRef(record, ref, shortRef) {
  return record.covers.some((cover) => cover === ref || cover === shortRef);
}

function recordSummary(record) {
  const { markdown, path: recordPath, ...summary } = record;
  return summary;
}

function linkedRecords(records, ref, shortRef) {
  return records.filter((record) => recordMatchesRef(record, ref, shortRef)).map(recordSummary);
}

function readGithubCache(dbDir) {
  const filePath = path.join(dbDir, '_github.jsonl');
  if (!fs.existsSync(filePath)) return { records: [], warnings: [] };
  const latest = new Map();
  const warnings = [];
  for (const [index, line] of fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).entries()) {
    try {
      const event = JSON.parse(line);
      if (event.event === 'github_pr_synced' && event.pr_number) latest.set(`${event.repository || ''}#${event.pr_number}`, event);
    } catch (error) {
      warnings.push({ path: filePath, message: `Invalid JSON at line ${index + 1}: ${error.message}` });
    }
  }
  return { records: [...latest.values()], warnings };
}

function prMatchesRef(pr, ref, shortRef) {
  return (pr.covers || []).some((cover) => cover === ref || cover === shortRef);
}

function linkedPrs(prs, ref, shortRef) {
  return prs.filter((pr) => prMatchesRef(pr, ref, shortRef));
}

function linkedPrsByCr(prs, recordId) {
  return prs.filter((pr) => (pr.cr_ids || []).includes(recordId));
}

export function parseGoalFile(filePath, goalId) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean);
  let goal = { goal_id: goalId, tasks: {}, _taskOrder: [] };

  for (const [index, line] of lines.entries()) {
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSON at line ${index + 1}: ${error.message}`);
    }

    switch (event.event) {
      case 'created':
      case 'goal_created':
        goal = { ...goal, ...event, tasks: goal.tasks, _taskOrder: goal._taskOrder };
        break;
      case 'updated':
        goal = { ...goal, ...event };
        break;
      case 'status_changed':
        goal.status = event.status;
        goal.closed_commit_sha = event.status === 'closed' ? (event.commit_sha || event.closed_commit_sha || event.commit || null) : null;
        break;
      case 'github_synced':
        goal.issue_number = event.issue_number;
        goal.issue_url = event.issue_url;
        break;
      case 'github_pr_synced':
        goal.github_prs = goal.github_prs || {};
        goal.github_prs[`${event.repository || ''}#${event.pr_number}`] = event;
        break;
      case 'task_created':
        goal.tasks[event.task_id] = {
          task_id: event.task_id,
          title: event.title,
          description: event.description || '',
          status: 'open',
        };
        goal._taskOrder.push(event.task_id);
        break;
      case 'task_updated':
        if (goal.tasks[event.task_id]) goal.tasks[event.task_id] = { ...goal.tasks[event.task_id], ...event };
        break;
      case 'task_status_changed':
        if (goal.tasks[event.task_id]) {
          goal.tasks[event.task_id].status = event.status;
          goal.tasks[event.task_id].closed_commit_sha = event.status === 'closed' ? (event.commit_sha || event.closed_commit_sha || event.commit || null) : null;
        }
        break;
      case 'task_github_synced':
        if (goal.tasks[event.task_id]) {
          goal.tasks[event.task_id].issue_number = event.issue_number;
          goal.tasks[event.task_id].issue_url = event.issue_url;
        }
        break;
      case 'tasks_reordered':
        goal._taskOrder = Array.isArray(event.order) ? event.order : goal._taskOrder;
        break;
      default:
        break;
    }
  }

  return goal;
}

export function discoverBoardGoals(dbDir = getClipsDbDir()) {
  if (!fs.existsSync(dbDir)) return [];

  const entries = fs.readdirSync(dbDir, { withFileTypes: true });
  const discovered = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith('g') && entry.name.endsWith('.jsonl')) {
      discovered.push({ username: null, goalId: entry.name.slice(0, -'.jsonl'.length), filePath: path.join(dbDir, entry.name) });
      continue;
    }

    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const userDir = path.join(dbDir, entry.name);
    for (const file of fs.readdirSync(userDir)) {
      if (file.endsWith('.jsonl')) {
        discovered.push({ username: entry.name, goalId: file.slice(0, -'.jsonl'.length), filePath: path.join(userDir, file) });
      }
    }
  }

  return discovered.sort((left, right) => `${left.username || ''}/${left.goalId}`.localeCompare(`${right.username || ''}/${right.goalId}`));
}

function normalizeGoal(rawGoal, username, records, allPrs) {
  const goalStatus = normalizeStatus(rawGoal.status);
  const source = rawGoal.issue_number ? 'github' : 'local';
  const goalRef = formatRef(username, rawGoal.goal_id);
  const shortGoalRef = formatRef(null, rawGoal.goal_id);
  const goalPrs = Object.values(rawGoal.github_prs || {});

  return {
    goal_id: rawGoal.goal_id,
    ref: goalRef,
    username,
    title: rawGoal.title || rawGoal.goal_id,
    description: rawGoal.description || '',
    status: goalStatus,
    issue_number: rawGoal.issue_number || null,
    issue_url: rawGoal.issue_url || null,
    source,
    closed_commit_sha: goalStatus === 'closed' ? rawGoal.closed_commit_sha || null : null,
    linked_crs: linkedRecords(records, goalRef, shortGoalRef),
    linked_prs: [...new Map([...linkedPrs(allPrs, goalRef, shortGoalRef), ...goalPrs].map((pr) => [`${pr.repository || ''}#${pr.pr_number}`, pr])).values()],
    tasks: orderedTasks(rawGoal).map((rawTask) => {
      const status = normalizeStatus(rawTask.status);
      const taskRef = formatRef(username, rawGoal.goal_id, rawTask.task_id);
      const shortTaskRef = formatRef(null, rawGoal.goal_id, rawTask.task_id);
      return {
        task_id: rawTask.task_id,
        ref: taskRef,
        title: rawTask.title || 'Untitled task',
        description: rawTask.description || '',
        status,
        column: columnForStatus(status),
        issue_number: rawTask.issue_number || null,
        issue_url: rawTask.issue_url || null,
        source,
        goal_id: rawGoal.goal_id,
        goal_title: rawGoal.title || rawGoal.goal_id,
        goal_status: goalStatus,
        closed_commit_sha: status === 'closed' ? rawTask.closed_commit_sha || null : null,
        linked_crs: linkedRecords(records, taskRef, shortTaskRef),
        linked_prs: [...new Map([...linkedPrs(allPrs, taskRef, shortTaskRef), ...goalPrs.filter((pr) => prMatchesRef(pr, taskRef, shortTaskRef))].map((pr) => [`${pr.repository || ''}#${pr.pr_number}`, pr])).values()],
      };
    }),
  };
}

export function readBoardData({ dbDir = getClipsDbDir(), recordsDir = path.join(getRepoRoot(), 'docs', 'records', 'cr') } = {}) {
  const warnings = [];
  const goals = [];
  const changeRecords = readChangeRecords(recordsDir);
  const githubCache = readGithubCache(dbDir);
  const allPrs = [...githubCache.records];
  warnings.push(...changeRecords.warnings);
  warnings.push(...githubCache.warnings);

  for (const entry of discoverBoardGoals(dbDir)) {
    try {
      const rawGoal = parseGoalFile(entry.filePath, entry.goalId);
      allPrs.push(...Object.values(rawGoal.github_prs || {}));
      goals.push(normalizeGoal(rawGoal, entry.username, changeRecords.records, allPrs));
    } catch (error) {
      warnings.push({ path: entry.filePath, message: error.message });
    }
  }

  const uniquePrs = [...new Map(allPrs.map((pr) => [`${pr.repository || ''}#${pr.pr_number}`, pr])).values()];
  const records = changeRecords.records.map((record) => ({ ...record, linked_prs: uniquePrs.filter((pr) => (pr.cr_ids || []).includes(record.id)) }));
  for (const goal of goals) {
    goal.linked_prs = [...new Map(goal.linked_prs.map((pr) => [`${pr.repository || ''}#${pr.pr_number}`, pr])).values()];
    for (const task of goal.tasks) task.linked_prs = [...new Map(task.linked_prs.map((pr) => [`${pr.repository || ''}#${pr.pr_number}`, pr])).values()];
  }
  return { version: 1, generated_at: new Date().toISOString(), goals, change_records: records, github_prs: uniquePrs, warnings };
}
