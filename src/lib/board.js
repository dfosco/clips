import fs from 'node:fs';
import path from 'node:path';
import { getClipsDbDir, getClipsRecordsDir } from './core.js';
import { effectiveVerificationMode } from './behavior.js';
import { normalizeGoalType } from './goal-type.js';
import { listTracks } from './tracks.js';

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

export function readChangeRecords(recordsDir = getClipsRecordsDir('cr')) {
  if (!fs.existsSync(recordsDir)) return { records: [], warnings: [] };

  const records = [];
  const warnings = [];
  for (const file of fs.readdirSync(recordsDir).filter((name) => /^CR-\d+.*\.md$/.test(name)).sort()) {
    const filePath = path.join(recordsDir, file);
    try {
      const record = parseChangeRecord(filePath);
      if (record && record.status !== 'Archived') records.push(record);
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
        goal.github_unlinked = false;
        break;
      case 'github_unlinked':
        delete goal.issue_number;
        delete goal.issue_url;
        goal.github_unlinked = true;
        for (const task of Object.values(goal.tasks)) {
          delete task.issue_number;
          delete task.issue_url;
        }
        break;
      case 'github_pr_synced':
        goal.github_prs = goal.github_prs || {};
        goal.github_prs[`${event.repository || ''}#${event.pr_number}`] = event;
        break;
      case 'adr_attached':
        goal.adr_id = event.adr_id;
        break;
      case 'adr_detached':
        delete goal.adr_id;
        break;
      case 'task_created':
        goal.tasks[event.task_id] = {
          task_id: event.task_id,
          title: event.title,
          description: event.description || '',
          behavior: event.behavior || '',
          ...(Object.prototype.hasOwnProperty.call(event, 'verification_mode')
            ? { verification_mode: event.verification_mode }
            : {}),
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
        if (goal.tasks[event.task_id] && !goal.github_unlinked) {
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
  const goalVerificationMode = effectiveVerificationMode(rawGoal.verification_mode);
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
    type: normalizeGoalType(rawGoal.type),
    adr_id: rawGoal.adr_id || null,
    track_id: rawGoal.track_id || null,
    blocked_by: rawGoal.blocked_by || [],
    behavior: rawGoal.behavior || '',
    verification_mode: goalVerificationMode,
    effective_verification_mode: goalVerificationMode,
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
        behavior: rawTask.behavior || '',
        verification_mode: rawTask.verification_mode || null,
        effective_verification_mode: effectiveVerificationMode(
          goalVerificationMode,
          rawTask.verification_mode,
        ),
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

export function readBoardData({ dbDir = getClipsDbDir(), recordsDir = getClipsRecordsDir('cr') } = {}) {
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
  const tracks = listTracks(dbDir).map((track) => {
    const members = goals.filter((goal) => goal.track_id === track.track_id);
    return { ...track, ref: `#${track.track_id}`, goal_refs: members.map((goal) => goal.ref), goal_count: members.length, completed_goal_count: members.filter((goal) => goal.status === 'closed').length };
  });
  return { version: 1, generated_at: new Date().toISOString(), tracks, goals, change_records: records, github_prs: uniquePrs, warnings };
}

function qualifyRef(projectId, ref) {
  return `${projectId}#${String(ref).replace(/^#/, '')}`;
}

function qualifyRecord(project, record) {
  const { path: recordPath, ...safeRecord } = record;
  return {
    ...safeRecord,
    key: `${project.id}#${record.id}`,
    project_id: project.id,
    project_label: project.label,
    covers: record.covers.map((ref) => qualifyRef(project.id, ref)),
    linked_prs: (record.linked_prs || []).map((pr) => ({ ...pr, project_id: project.id, project_label: project.label })),
  };
}

function qualifyRecordSummary(project, record) {
  return qualifyRecord(project, { ...record, linked_prs: record.linked_prs || [] });
}

export function readProjectBoard(project) {
  const localBoard = readBoardData({
    dbDir: path.join(project.path, '.clips', 'db'),
    recordsDir: path.join(project.path, '.clips', 'records', 'cr'),
  });
  const goals = localBoard.goals.map((goal) => {
    const ref = qualifyRef(project.id, goal.ref);
    return {
      ...goal,
      ref,
      track_ref: goal.track_id ? qualifyRef(project.id, `#${goal.track_id}`) : null,
      blocked_by: goal.blocked_by.map((id) => qualifyRef(project.id, `#${id}`)),
      project_id: project.id,
      project_label: project.label,
      linked_crs: (goal.linked_crs || []).map((record) => qualifyRecordSummary(project, record)),
      linked_prs: (goal.linked_prs || []).map((pr) => ({ ...pr, project_id: project.id, project_label: project.label })),
      tasks: goal.tasks.map((task) => ({
        ...task,
        ref: qualifyRef(project.id, task.ref),
        goal_ref: ref,
        project_id: project.id,
        project_label: project.label,
        linked_crs: (task.linked_crs || []).map((record) => qualifyRecordSummary(project, record)),
        linked_prs: (task.linked_prs || []).map((pr) => ({ ...pr, project_id: project.id, project_label: project.label })),
      })),
    };
  });

  return {
    tracks: localBoard.tracks.map((track) => ({ ...track, ref: qualifyRef(project.id, track.ref), project_id: project.id, project_label: project.label, goal_refs: track.goal_refs.map((ref) => qualifyRef(project.id, ref)) })),
    goals,
    change_records: localBoard.change_records.map((record) => qualifyRecord(project, record)),
    github_prs: localBoard.github_prs.map((pr) => ({ ...pr, project_id: project.id, project_label: project.label })),
    warnings: localBoard.warnings.map((warning) => ({
      kind: 'project_data',
      project_id: project.id,
      project_label: project.label,
      message: warning.message,
    })),
  };
}

export function readWorkspaceBoard({ projects, availableProjects = projects, scope = 'all', warnings = [] }) {
  const board = {
    version: 2,
    generated_at: new Date().toISOString(),
    scope,
    projects: availableProjects.map(({ id, label }) => ({ id, label })),
    default_project_ids: projects.map((project) => project.id),
    goals: [],
    tracks: [],
    change_records: [],
    github_prs: [],
    warnings: [...warnings],
  };

  for (const project of projects) {
    try {
      const projectBoard = readProjectBoard(project);
      board.goals.push(...projectBoard.goals);
      board.tracks.push(...projectBoard.tracks);
      board.change_records.push(...projectBoard.change_records);
      board.github_prs.push(...projectBoard.github_prs);
      board.warnings.push(...projectBoard.warnings);
    } catch (error) {
      board.warnings.push({
        kind: 'project_data',
        project_id: project.id,
        project_label: project.label,
        message: `Could not read project data: ${error.message}`,
      });
    }
  }
  return board;
}
