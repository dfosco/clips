// Bidirectional GitHub Issues sync engine
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { createHash } from 'node:crypto';
import {
  appendEvent,
  readGoalWithTasks,
  getClipsDbDir,
  getClipsRecordsDir,
  getOrderedTasks,
  formatRef,
  parseRef,
} from './core.js';
import { readConfig } from './config.js';
import { effectiveVerificationMode } from './behavior.js';
import { goalCompletionError, normalizeAdrId, normalizeGoalType } from './goal-type.js';
import { appendTrackEvent, listTracks, readTrack } from './tracks.js';
import { laneToTrackId, normalizeLaneId, trackToLaneId } from './lanes.js';
import { discoverGoals } from './goal-discovery.js';
import { readCollaborationConfig } from './collaboration.js';
import { githubPullRequestKey, remoteIdentityFromUrl } from './github-identity.js';

const GITHUB_CACHE_FILE = '_github.jsonl';
const DEFINITE_SPAWN_FAILURES = new Set([
  'EACCES', 'EAGAIN', 'EINVAL', 'EISDIR', 'EMFILE', 'ENFILE', 'ENOENT',
  'ENOEXEC', 'ENOMEM', 'ENOTDIR', 'EPERM', 'ETXTBSY',
]);

function remoteOrigin() {
  const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  let host;
  let repository;
  const ssh = value.match(/^(?:[^@]+@)?([^:]+):(.+)$/);
  if (ssh && !value.includes('://')) {
    host = ssh[1].toLowerCase();
    repository = ssh[2];
  } else {
    let url;
    try { url = new URL(value); }
    catch { return null; }
    if (!['https:', 'http:'].includes(url.protocol)) return null;
    host = url.hostname.toLowerCase();
    repository = url.pathname;
  }
  if (host === 'ssh.github.com') host = 'github.com';
  repository = repository.replace(/^\/+/, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return null;
  return { host, repository };
}

function repositoryFromRemote() {
  return remoteOrigin()?.repository || '';
}

function collaborationEnabled() {
  return readCollaborationConfig().collaboration;
}

function createEffectTracker() {
  return { requested: [], completed: [], failures: [] };
}

function argsForOrigin(args, origin) {
  if (!['issue', 'pr'].includes(args[0])) return args;
  if (!origin) throw new Error(`GitHub origin remote is required for \`gh ${args[0]}\` commands`);
  const targeted = [...args];
  const repoIndex = targeted.indexOf('--repo');
  if (repoIndex >= 0) targeted.splice(repoIndex, 2);
  targeted.push('--repo', origin.repository);
  return targeted;
}

function remoteCall(args, { input, effects, label = `gh ${args.join(' ')}`, allowNotFound = false } = {}) {
  const origin = remoteOrigin();
  const targetArgs = argsForOrigin(args, origin);
  const effect = { action: label };
  effects?.requested.push(effect);
  const result = spawnSync('gh', targetArgs, {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: origin ? { ...process.env, GH_HOST: origin.host, GH_REPO: origin.repository } : process.env,
  });
  if (result.error || result.status !== 0) {
    const status = httpStatus(result.stderr || result.stdout || '');
    if (allowNotFound && status === 404 && !result.error) {
      effects?.completed.push({ ...effect, outcome: 'not_found' });
      return { notFound: true, status };
    }
    const detail = result.error?.code === 'ENOENT'
      ? 'GitHub CLI `gh` is not installed or not on PATH'
      : result.error?.message || result.stderr?.trim() || `gh ${targetArgs.join(' ')} exited with status ${result.status}`;
    const error = new Error(detail, result.error ? { cause: result.error } : undefined);
    error.httpStatus = status;
    if (effects) effects.failures.push({ ...effect, message: error.message });
    throw error;
  }
  effects?.completed.push(effect);
  return result;
}

function httpStatus(message) {
  const match = String(message).match(/\bHTTP\s+(\d{3})\b/i);
  return match ? Number(match[1]) : null;
}

function ghJson(args, { input, effects, label, allowNotFound = false } = {}) {
  const result = remoteCall(args, { input, effects, label, allowNotFound });
  if (result.notFound) return result;
  if (!result.stdout.trim()) return null;
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    const message = `gh ${args.join(' ')} returned invalid JSON: ${error.message}`;
    effects?.failures.push({ action: label || `gh ${args.join(' ')}`, message });
    throw new Error(message, { cause: error });
  }
}

function ghText(args, { input, effects, label } = {}) {
  return remoteCall(args, { input, effects, label }).stdout.trim();
}

function effectsSummary(effects) {
  return {
    requested: effects.requested,
    completed: effects.completed,
    failures: effects.failures,
  };
}

function cachePath() {
  return path.join(getClipsDbDir(), GITHUB_CACHE_FILE);
}

function prKey(pr) {
  return githubPullRequestKey(pr);
}

function repositoryName(value) {
  return typeof value === 'string' ? value : value?.nameWithOwner || value?.name || '';
}

function remoteRecordMatches(record, origin) {
  if (!origin) return true;
  const storedRepository = repositoryName(record.repository);
  if (storedRepository && storedRepository.toLowerCase() !== origin.repository.toLowerCase()) return false;
  if (record.remote_host && String(record.remote_host).toLowerCase() !== origin.host) return false;
  const linked = remoteIdentityFromUrl(record.issue_url);
  return !linked || (linked.host === origin.host && linked.repository === origin.repository.toLowerCase());
}

export function parsePlanningRefs(text = '') {
  const covers = [...text.matchAll(/(?:^|[^\w])(#(?:[a-z][\w-]*#)?g\d+(?:#t\d+)?)/gi)].map((match) => match[1]);
  const crIds = [...text.matchAll(/(?:^|[^\w])(CR-\d+)\b/gi)].map((match) => match[1].toUpperCase());
  return { covers: [...new Set(covers)], cr_ids: [...new Set(crIds)] };
}

export function normalizePullRequest(pr, repository = repositoryFromRemote(), host = remoteOrigin()?.host) {
  const body = pr.body || '';
  const refs = parsePlanningRefs(`${pr.title || ''}\n${body}`);
  const author = typeof pr.author === 'string' ? pr.author : pr.author?.login || pr.author?.name || '';
  const remoteIdentity = remoteIdentityFromUrl(pr.url || pr.html_url);
  const repo = repositoryName(pr.repository) || remoteIdentity?.repository || repository;
  return {
    event: 'github_pr_synced',
    repository: repo,
    remote_host: remoteIdentity?.host || pr.remote_host || host || '',
    pr_number: Number(pr.number ?? pr.pr_number),
    title: pr.title || '',
    body,
    url: pr.url || pr.html_url || '',
    state: String(pr.state || 'OPEN').toLowerCase(),
    merged: Boolean(pr.mergedAt || pr.merged),
    head_ref: pr.headRefName || pr.head_ref || '',
    author,
    created_at: pr.createdAt || pr.created_at || '',
    updated_at: pr.updatedAt || pr.updated_at || '',
    covers: refs.covers,
    cr_ids: refs.cr_ids,
  };
}

function samePullRequest(left, right) {
  return JSON.stringify({ ...left, event: undefined }) === JSON.stringify({ ...right, event: undefined });
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function readCachedPullRequests() {
  try {
    const latest = new Map();
    for (const event of readJsonl(cachePath())) {
      if (event.event === 'github_pr_synced' && event.pr_number) latest.set(prKey(event), event);
    }
    return { records: [...latest.values()], warnings: [] };
  } catch (error) {
    return { records: [], warnings: [{ path: cachePath(), message: error.message }] };
  }
}

function appendCachedPullRequest(pr) {
  const filePath = cachePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const cached = readCachedPullRequests().records.find((item) => prKey(item) === prKey(pr));
  if (cached && samePullRequest(cached, pr)) return 'unchanged';
  fs.appendFileSync(filePath, `${JSON.stringify(pr)}\n`);
  return cached ? 'updated' : 'imported';
}

function findGoalTarget(ref) {
  const match = ref.match(/^#?(?:([a-z][\w-]*)#)?(g\d+)$/i);
  if (!match) return null;
  const username = match[1] || null;
  const goalId = match[2].toLowerCase();
  const dbDir = getClipsDbDir();
  if (username && fs.existsSync(path.join(dbDir, username, `${goalId}.jsonl`))) return { goalId, username };
  if (fs.existsSync(path.join(dbDir, `${goalId}.jsonl`))) return { goalId, username: null };
  return null;
}

function appendPullRequestToGoals(pr) {
  const targets = new Map();
  for (const cover of pr.covers) {
    const goalRef = cover.match(/^#?(?:[a-z][\w-]*#)?g\d+/i)?.[0];
    const target = goalRef && findGoalTarget(goalRef);
    if (target) targets.set(`${target.username || ''}/${target.goalId}`, target);
  }
  if (!targets.size) return false;
  let hadExisting = false;
  let changed = false;
  let updatedExisting = false;
  for (const target of targets.values()) {
    const existing = readGoalWithTasks(target.goalId, target.username);
    const previous = existing?.github_prs?.[prKey(pr)];
    if (previous) {
      hadExisting = true;
      if (samePullRequest(previous, pr)) continue;
      updatedExisting = true;
    }
    appendEvent(target.goalId, pr, target.username ? { username: target.username } : {});
    changed = true;
  }
  if (!changed) return 'unchanged';
  return hadExisting || updatedExisting ? 'updated' : 'imported';
}

function generateGoalId() {
  const dbDir = getClipsDbDir();
  if (!fs.existsSync(dbDir)) return 'g001';
  const files = fs.readdirSync(dbDir).filter(f => f.endsWith('.jsonl'));
  const ids = files
    .map(f => f.replace('.jsonl', ''))
    .filter(id => /^g\d+$/.test(id))
    .map(id => parseInt(id.replace('g', ''), 10));
  const max = ids.length > 0 ? Math.max(...ids) : 0;
  return `g${(max + 1).toString().padStart(3, '0')}`;
}

// ── Markdown helpers ──────────────────────────────────────────────

function formatDescription(description) {
  if (!description) return '';
  if (typeof description === 'string') return description;

  let formatted = '';
  if (description.summary) {
    formatted += description.summary;
  }
  if (description.details) {
    if (formatted) formatted += '\n\n';
    formatted += description.details;
  }
  if (!formatted) {
    for (const [key, value] of Object.entries(description)) {
      if (typeof value === 'string') {
        formatted += `**${key}**: ${value}\n`;
      } else if (Array.isArray(value)) {
        formatted += `**${key}**:\n`;
        for (const item of value) {
          formatted += `- ${item}\n`;
        }
      } else if (typeof value === 'object' && value !== null) {
        formatted += `**${key}**: ${JSON.stringify(value)}\n`;
      }
    }
  }
  return formatted.trim();
}

function formatBehaviorBlock(behavior, indent = '') {
  const content = String(behavior || '').trim();
  if (!content) return '';
  const lines = content.split(/\r?\n/).map((line) => `${indent}${line}`).join('\n');
  return `${indent}\`\`\`gherkin\n${lines}\n${indent}\`\`\``;
}

function workDetails(record, ref, { criteria = true } = {}) {
  const sections = [];
  for (const [label, field] of [['Scope', 'scope'], ['Plan', 'plan'], ['Decisions', 'decisions'], ['Change record', 'record']]) {
    if (record[field]) sections.push(`## ${label}\n\n${record[field]}`);
  }
  if (record.components?.length) sections.push(`## Components\n\n${record.components.join(', ')}`);
  if (record.owner) sections.push(`Owner: ${record.owner}`);
  if (record.acceptance_owner) sections.push(`Acceptance owner: ${record.acceptance_owner}`);
  if (criteria && record.acceptance_criteria?.length) {
    sections.push(`## Acceptance criteria\n\n${record.acceptance_criteria.map((item, index) => {
      const id = typeof item === 'string' ? `A${index + 1}` : item.id || `A${index + 1}`;
      const text = typeof item === 'string' ? item : item.description || item.text;
      return `- ${text} \`${ref}#${id}\``;
    }).join('\n')}`);
  }
  if (record.acceptance) {
    const { accepted_by, summary, artifact, criteria: assessments } = record.acceptance;
    sections.push(`## Acceptance\n\nAccepted by: ${accepted_by}\n\n${summary}\n\nArtifact: ${typeof artifact === 'string' ? artifact : JSON.stringify(artifact)}\n\n${(assessments || []).map((item) => `- ${ref}#${item.id}: ${item.status}${item.reason ? ` (${item.reason})` : ''}${item.evidence ? ` — ${typeof item.evidence === 'string' ? item.evidence : JSON.stringify(item.evidence)}` : ''}`).join('\n')}`);
  }
  for (const [heading, markdown] of Object.entries(record.sections || {})) sections.push(`## ${heading}\n\n${markdown}`);
  return sections.join('\n\n');
}

function externalIssueTitle(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/^\s*#(?:[a-z][\w-]*#)?[glr]\d+(?:#t\d+)?\s*(?:(?::|-)\s*)?/i, '')
    .trim();
}

function markdownLabel(value) {
  return externalIssueTitle(value).replace(/\\/g, '\\\\').replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

function createMarker(kind, ref) {
  const token = createHash('sha256').update(`${kind}\0${ref}`).digest('hex');
  return `<!-- lanes-sync-${kind}-${token} -->`;
}

function issueUrlForRecord(record, origin = remoteOrigin()) {
  if (!record?.issue_number || !origin || !remoteRecordMatches(record, origin)) return null;
  return `https://${origin.host}/${origin.repository}/issues/${record.issue_number}`;
}

function linkedTitle(record, localRef, origin) {
  const label = markdownLabel(record.title || localRef);
  const url = issueUrlForRecord(record, origin);
  return `${url ? `[${label}](${url})` : label} \`${localRef}\``;
}

function goalRef(goal, username = goal.username || null) {
  return goal.goal_id ? formatRef({ username, goalId: goal.goal_id }) : '#goal';
}

function taskRef(goal, task, username = goal.username || null) {
  return goal.goal_id && task.task_id
    ? formatRef({ username, goalId: goal.goal_id, taskId: task.task_id })
    : '#goal#task';
}

function goalsForLane(laneId) {
  const trackId = `r${String(laneId).replace(/^l/i, '').padStart(3, '0')}`;
  return discoverGoals().flatMap(({ username, goalId }) => {
    const goal = readGoalWithTasks(goalId, username);
    return goal?.track_id === trackId ? [{ ...goal, username }] : [];
  });
}

export function buildLaneIssueBody(track, options = {}) {
  const laneId = trackToLaneId(track.track_id || `r${String(track.lane_id).replace(/^l/i, '').padStart(3, '0')}`);
  const origin = options.origin ?? remoteOrigin();
  const goals = options.goals ?? goalsForLane(laneId);
  const sections = [
    `<!-- clips-lane: ${laneId} -->`,
    createMarker('lane', `#${laneId}`),
    track.description || '',
  ];
  if (track.product_goals?.length) sections.push(`## Product goals\n\n${track.product_goals.map((item) => `- ${item}`).join('\n')}`);
  if (track.legacy_acceptance_criteria?.length || track.acceptance_criteria?.length) {
    const criteria = track.legacy_acceptance_criteria || track.acceptance_criteria;
    sections.push(`## Legacy Track criteria\n\n${criteria.map((item) => `- ${item}`).join('\n')}`);
  }
  if (goals.length) {
    sections.push(`## Goals\n\n${goals.map((goal) => {
      const checked = ['closed', 'not_planned', 'duplicate'].includes(goal.status) ? 'x' : ' ';
      return `- [${checked}] ${linkedTitle(goal, goalRef(goal), origin)}`;
    }).join('\n')}`);
  }
  if (track.closure) {
    sections.push(`## Closure summary\n\n${track.closure.summary || ''}`);
    if (track.closure.product_goals_achieved?.length) sections.push(`## Product goals achieved\n\n${track.closure.product_goals_achieved.map((item) => `- ${item}`).join('\n')}`);
    if (track.closure.decision_log) sections.push(`## Decision log\n\n${track.closure.decision_log}`);
    if (track.closure.system_overview) sections.push(`## System overview\n\n${track.closure.system_overview}`);
    if (track.closure.components?.length) sections.push(`## Components worked on\n\n${track.closure.components.map((item) => `- ${item}`).join('\n')}`);
    if (track.closure.media?.length) sections.push(`## Product media\n\n${track.closure.media.map((item) => {
      const media = typeof item === 'string' ? { src: item } : item;
      return media.caption ? `- [${media.caption}](${media.src})` : `- ${media.src}`;
    }).join('\n')}`);
  }
  return sections.filter(Boolean).join('\n\n');
}

export function buildTaskIssueBody(task, goal, parentIssueNumber = null, { username = goal?.username || null } = {}) {
  const sections = [];
  if (parentIssueNumber) sections.push(`Sub-issue of #${parentIssueNumber}`);
  if (task.description) sections.push(formatDescription(task.description));
  const details = workDetails(task, taskRef(goal || {}, task, username));
  if (details) sections.push(details);
  if (task.behavior) sections.push(`## Behavior\n\n${formatBehaviorBlock(task.behavior)}`);
  sections.push(`## Verification Mode\n\n\`${effectiveVerificationMode(goal?.verification_mode, task.verification_mode)}\``);
  sections.push(createMarker('task', taskRef(goal || {}, task, username)));
  return sections.join('\n\n').trim();
}

export function buildIssueBody(goal, { username = goal.username || null, config = readConfig(undefined, { strict: true }), origin = remoteOrigin() } = {}) {
  let body = '';
  if (goal.track_id) body += `Lane: #${trackToLaneId(goal.track_id)}\n\n`;
  if (goal.blocked_by?.length) body += `Blocked by: ${goal.blocked_by.map((id) => id.startsWith('#') ? id : `#${id}`).join(', ')}\n\n`;

  if (goal.description) {
    const desc = formatDescription(goal.description);
    if (desc) {
      body += `## Description\n\n${desc}\n\n`;
    }
  }

  body += `## Goal Type\n\n\`${goal.type || 'building'}\`\n\n`;

  if (goal.adr_id) {
    body += `## ADR\n\n\`${goal.adr_id}\`\n\n`;
  }

  if (goal.behavior) {
    body += `## Behavior\n\n${formatBehaviorBlock(goal.behavior)}\n\n`;
  }

  body += `## Verification Mode\n\n\`${effectiveVerificationMode(goal.verification_mode)}\`\n\n`;

  if (goal.acceptance_criteria) {
    const criteria = Array.isArray(goal.acceptance_criteria)
      ? goal.acceptance_criteria
      : Object.values(goal.acceptance_criteria);
    if (criteria.length > 0) {
      body += `## Acceptance Criteria\n\n`;
      for (const criterion of criteria) {
        const text =
          typeof criterion === 'string'
            ? criterion
            : criterion.text || criterion.description || JSON.stringify(criterion);
        body += `- ${typeof criterion === 'object' && criterion.id ? `#${goal.goal_id}#${criterion.id}: ` : ''}${text}\n`;
      }
      body += '\n';
    }
  }

  const details = workDetails(goal, `#${goal.goal_id}`, { criteria: false });
  if (details) body += `${details}\n\n`;

  const tasks = getOrderedTasks(goal);
  if (tasks.length > 0) {
    body += `## Tasks\n\n`;
    for (const task of tasks) {
      const checked = ['closed', 'not_planned', 'duplicate'].includes(task.status) ? 'x' : ' ';
      if (config.tasks_as_issues && task.issue_number) {
        body += `- [${checked}] ${linkedTitle(task, taskRef(goal, task, username), origin)}\n`;
      } else {
          body += `- [${checked}] ${linkedTitle(task, taskRef(goal, task, username), origin)}\n`;
        if (task.description) {
          body += `${String(task.description).split(/\r?\n/).map((line) => `  ${line}`).join('\n')}\n`;
        }
        const details = workDetails(task, `#${goal.goal_id}#${task.task_id}`);
        if (details) body += details.split('\n').map((line) => `  ${line}`).join('\n') + '\n';
        body += `  - Verification: \`${effectiveVerificationMode(goal.verification_mode, task.verification_mode)}\`\n`;
        if (task.behavior) {
          body += `  - Behavior:\n\n${formatBehaviorBlock(task.behavior, '    ')}\n`;
        }
      }
    }
  }

  body += `\n---\n_Managed by clips • Goal ID: #${goal.goal_id}_\n\n${createMarker('goal', formatRef({ username, goalId: goal.goal_id }))}`;

  return body;
}

// ── Parsing ───────────────────────────────────────────────────────

export function parseTaskList(body) {
  if (!body) return [];
  const results = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^- \[([ xX])\] (.+)/);
    if (m) {
      let title = m[2].trim();
      let closing = -1;
      let escaped = false;
      for (let index = 1; index < title.length - 1; index++) {
        if (escaped) { escaped = false; continue; }
        if (title[index] === '\\') { escaped = true; continue; }
        if (title[index] === ']' && title[index + 1] === '(') {
          closing = index;
          break;
        }
      }
      const markdownLink = closing > 0
        ? title.slice(closing).match(/^\]\(https?:\/\/[^)\s]+\)(?:\s+`#[^`]+`)?$/)
        : null;
      if (markdownLink) {
        title = title.slice(1, closing);
      }
      else {
        title = title
          .replace(/\s+`#(?:[a-z][\w-]*#)?g\d+(?:#t\d+)?`$/i, '')
          .replace(/^\*\*#(?:[a-z][\w-]*#)?g\d+(?:#t\d+)?\*\*:\s*/i, '')
          .replace(/^#\d+\s+/, '');
      }
      title = title.replace(/\\([\\[\]])/g, '$1');
      results.push({
        title: title.trim(),
        done: m[1].toLowerCase() === 'x',
      });
    }
  }
  return results;
}

export function parseGoalMetadata(body = '') {
  const typeMatch = body.match(/^## Goal Type\s*\n+`([^`]+)`/mi);
  let type = 'building';
  let typeExplicit = false;
  try {
    type = normalizeGoalType(typeMatch?.[1]?.trim());
    typeExplicit = Boolean(typeMatch);
  } catch {
    type = 'building';
  }

  const adrMatch = body.match(/^## ADR\s*\n+`([^`]+)`/mi);
  let adrId = null;
  if (adrMatch) {
    try { adrId = normalizeAdrId(adrMatch[1].trim()); } catch { /* ignore invalid remote metadata */ }
  }
  return { type, adr_id: adrId, type_explicit: typeExplicit, adr_explicit: Boolean(adrId) };
}

// ── Lookup ────────────────────────────────────────────────────────

export function findGoalByIssueNumber(issueNumber, origin = remoteOrigin(), goals = localManagedGoals()) {
  return goals.find((goal) =>
    goal.issue_number === issueNumber && remoteRecordMatches(goal, origin)) || null;
}

function findTaskByIssueNumber(issueNumber, origin, goals = localManagedGoals()) {
  for (const goal of goals) {
    const task = getOrderedTasks(goal).find((item) =>
      item.issue_number === issueNumber && remoteRecordMatches(item, origin));
    if (task) return { goal, task };
  }
  return null;
}

function isExplicitlyAttachedIssue(issue, origin, goals = localManagedGoals(), tracks = listTracks()) {
  const records = [...tracks, ...goals, ...goals.flatMap((goal) => getOrderedTasks(goal))];
  return records.some((record) => (record.attachments || []).some((attachment) =>
    attachment.source !== 'legacy'
      && attachment.type === 'github_issue'
      && attachment.number === issue.number
      && String(attachment.host || '').toLowerCase() === origin.host
      && String(attachment.repository || '').toLowerCase() === origin.repository.toLowerCase()));
}

// ── Import ────────────────────────────────────────────────────────

export function importIssue(issueData, { origin = remoteOrigin() } = {}) {
  const goalId = generateGoalId();
  const dbDir = getClipsDbDir();
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const config = readConfig();
  const maxLen = config.body_max_length;
  const desc = issueData.body || '';
  const clippedDesc = maxLen && desc.length > maxLen
    ? desc.slice(0, maxLen) + '…'
    : desc;
  const metadata = parseGoalMetadata(issueData.body);

  // goal_created
  appendEvent(
    goalId,
    {
      event: 'goal_created',
      goal_id: goalId,
      timestamp: issueData.createdAt,
      title: issueData.title,
      description: clippedDesc,
      acceptance_criteria: [],
      type: metadata.type,
      status: 'open',
    },
  );

  // github_synced
  appendEvent(
    goalId,
    {
      event: 'github_synced',
      goal_id: goalId,
      timestamp: new Date().toISOString(),
      issue_number: issueData.number,
      issue_url: issueData.url || (origin ? `https://${origin.host}/${origin.repository}/issues/${issueData.number}` : ''),
      ...(origin ? { repository: origin.repository, remote_host: origin.host } : {}),
    },
  );

  if (metadata.adr_id) {
    appendEvent(goalId, {
      event: 'adr_attached',
      goal_id: goalId,
      timestamp: issueData.createdAt,
      adr_id: metadata.adr_id,
    });
  }

  // Legacy planning checkboxes outside an explicit Tasks section remain prose.
  // Both old type labels can now contain an explicitly declared task list.
  const taskSection = issueData.body?.match(/^## Tasks\s*\n([\s\S]*?)(?=^## |^---|$(?![\s\S]))/m)?.[1];
  const tasks = parseTaskList(taskSection ?? (metadata.type === 'planning' ? '' : issueData.body));
  tasks.forEach((task, idx) => {
    const taskId = `t${String(idx + 1).padStart(2, '0')}`;
    appendEvent(
      goalId,
      {
        event: 'task_created',
        goal_id: goalId,
        task_id: taskId,
        timestamp: issueData.createdAt,
        title: task.title,
        description: '',
        status: 'open',
      },
    );
    if (task.done) {
      appendEvent(
        goalId,
        {
          event: 'task_status_changed',
          goal_id: goalId,
          task_id: taskId,
          timestamp: issueData.createdAt,
          status: 'closed',
        },
      );
    }
  });

  const remoteClosed = issueData.state === 'closed' || issueData.state === 'CLOSED';
  const importedGoal = readGoalWithTasks(goalId);
  if (remoteClosed && !goalCompletionError(importedGoal, { recordsDir: getClipsRecordsDir('adr') })) {
    appendEvent(goalId, {
      event: 'status_changed',
      goal_id: goalId,
      timestamp: issueData.updatedAt || issueData.createdAt,
      status: 'closed',
    });
  }

  return goalId;
}

// ── Pull ──────────────────────────────────────────────────────────

export function pullAllIssues({ effects = createEffectTracker() } = {}) {
  if (!collaborationEnabled()) {
    return { imported: 0, updated: 0, total: 0, skipped: true };
  }

  const origin = remoteOrigin();
  if (!origin) throw new Error('GitHub origin remote is required to sync issues');
  const result = remoteCall([
      'issue',
      'list',
      '--state',
      'all',
      '--json',
      'number,title,body,state,url,createdAt,updatedAt',
      '--limit',
      '1000',
  ], { effects, label: 'pull.issues' });
  const issues = JSON.parse(result.stdout);
  if (!Array.isArray(issues)) throw new Error('gh issue list returned a non-array response');
  const localGoals = localManagedGoals();
  const localTracks = listTracks();
  const pendingMarkers = new Set([
    ...localTracks,
    ...localGoals,
    ...localGoals.flatMap((goal) => getOrderedTasks(goal)),
  ].map((record) => record.github_create_pending?.marker).filter((marker) => typeof marker === 'string'));
  let imported = 0;
  let updated = 0;

  for (const issue of issues) {
    if (typeof issue.body === 'string' && [...pendingMarkers].some((marker) => issue.body.includes(marker))) continue;
    if (issue.body?.includes('<!-- clips-track:') || issue.body?.includes('<!-- clips-lane:')) continue;
    const existingGoal = findGoalByIssueNumber(issue.number, origin, localGoals);
    if (existingGoal) {
      // Already imported — check if status diverged
      let goal = existingGoal;
      if (!goal) continue;
      if (goal.github_unlinked) continue;

      const metadata = parseGoalMetadata(issue.body);
      if (metadata.type_explicit && metadata.type !== goal.type) {
        appendEvent(goal.goal_id, {
          event: 'updated', goal_id: goal.goal_id,
          timestamp: issue.updatedAt || new Date().toISOString(), type: metadata.type,
        }, goal.username ? { username: goal.username } : {});
        goal = readGoalWithTasks(goal.goal_id, goal.username);
        updated++;
      }
      if (metadata.adr_explicit && metadata.adr_id && metadata.adr_id !== goal.adr_id) {
        appendEvent(goal.goal_id, {
          event: 'adr_attached', goal_id: goal.goal_id,
          timestamp: issue.updatedAt || new Date().toISOString(), adr_id: metadata.adr_id,
        }, goal.username ? { username: goal.username } : {});
        goal = readGoalWithTasks(goal.goal_id, goal.username);
        updated++;
      }

      const ghClosed = issue.state === 'CLOSED' || issue.state === 'closed';
      const localClosed = ['closed', 'not_planned', 'duplicate'].includes(goal.status);

      if (ghClosed && !localClosed && !goalCompletionError(goal, { recordsDir: getClipsRecordsDir('adr') })) {
        appendEvent(
          goal.goal_id,
          {
            event: 'status_changed',
            goal_id: goal.goal_id,
            timestamp: new Date().toISOString(),
            status: 'closed',
          },
          goal.username ? { username: goal.username } : {},
        );
        updated++;
      } else if (!ghClosed && localClosed) {
        appendEvent(
          goal.goal_id,
          {
            event: 'status_changed',
            goal_id: goal.goal_id,
            timestamp: new Date().toISOString(),
            status: 'open',
          },
          goal.username ? { username: goal.username } : {},
        );
        updated++;
      }
    } else if (findTaskByIssueNumber(issue.number, origin, localGoals)
      || isExplicitlyAttachedIssue(issue, origin, localGoals, localTracks)) {
      continue;
    } else {
      importIssue(issue, { origin });
      imported++;
    }
  }

  return { imported, updated, total: issues.length };
}

export function pullAllPullRequests({ effects = createEffectTracker() } = {}) {
  if (!collaborationEnabled()) {
    return { imported: [], updated: [], unchanged: [], unmatched: [], total: 0, skipped: true };
  }

  const origin = remoteOrigin();
  if (!origin) throw new Error('GitHub origin remote is required to sync pull requests');
  const result = remoteCall([
    'pr', 'list', '--state', 'all', '--json',
    'number,title,body,state,url,headRefName,author,createdAt,updatedAt,mergedAt',
    '--limit', '1000',
  ], { effects, label: 'pull.pull_requests' });

  const imported = [];
  const updated = [];
  const unchanged = [];
  const unmatched = [];
  const rawPullRequests = JSON.parse(result.stdout);
  if (!Array.isArray(rawPullRequests)) throw new Error('gh pr list returned a non-array response');
  for (const raw of rawPullRequests) {
    const pr = normalizePullRequest(raw, origin.repository, origin.host);
    const linkedOutcome = appendPullRequestToGoals(pr);
    const outcome = linkedOutcome || appendCachedPullRequest(pr);
    if (!linkedOutcome) unmatched.push(pr);
    if (outcome === 'imported') imported.push(pr);
    else if (outcome === 'updated') updated.push(pr);
    else if (outcome === 'unchanged') unchanged.push(pr);
  }
  return { imported, updated, unchanged, unmatched, total: rawPullRequests.length };
}

export function pullAllGithub({ effects = createEffectTracker() } = {}) {
  const result = {
    issues: { imported: 0, updated: 0, total: 0 },
    pull_requests: { imported: [], updated: [], unchanged: [], unmatched: [], total: 0 },
    warnings: [],
  };
  if (!collaborationEnabled()) return { ...result, skipped: true };

  try {
    result.issues = pullAllIssues({ effects });
  } catch (error) {
    result.warnings.push({ source: 'issues', message: error.message });
  }
  try {
    result.pull_requests = pullAllPullRequests({ effects });
  } catch (error) {
    result.warnings.push({ source: 'pull_requests', message: error.message });
  }
  return result;
}

// ── Push ──────────────────────────────────────────────────────────

function recordFailure(effects, action, error) {
  if (!effects.failures.some((item) => item.action === action && item.message === error.message)) {
    effects.failures.push({ action, message: error.message });
  }
}

function requireRemoteOrigin() {
  const origin = remoteOrigin();
  if (!origin) throw new Error('GitHub origin remote must be a valid HTTPS or SSH repository URL');
  return origin;
}

function assertManagedRepository(record, origin, label) {
  if (record?.issue_number && !remoteRecordMatches(record, origin)) {
    throw new Error(`${label} is linked to a different GitHub host or repository; refusing to sync it through the current origin`);
  }
}

function parseCreatedIssueUrl(value, origin, label) {
  let url;
  try { url = new URL(String(value).trim()); }
  catch { throw new Error(`${label} may have been created remotely, but gh returned an invalid issue URL; no local mapping was saved`); }
  const parts = url.pathname.match(/^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/);
  if (url.protocol !== 'https:' || !parts || url.host.toLowerCase() !== origin.host
    || `${parts[1]}/${parts[2]}`.toLowerCase() !== origin.repository.toLowerCase()) {
    throw new Error(`${label} may have been created remotely, but gh returned an issue URL outside the current origin; no local mapping was saved`);
  }
  const number = Number(parts[3]);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`${label} may have been created remotely, but gh returned an unsafe issue number; no local mapping was saved`);
  }
  return { number, url: `https://${origin.host}/${origin.repository}/${'issues'}/${number}` };
}

function recoverCreatedIssue(marker, origin, effects, label) {
  const issues = ghJson(
    ['api', '--paginate', '--slurp', `repos/${origin.repository}/issues?state=all&per_page=100`],
    { effects, label: `reconcile_create.${label}` },
  );
  if (!Array.isArray(issues)) throw new Error(`Cannot reconcile pending ${label} creation: GitHub returned an invalid issue list`);
  const matches = issues.flat(Infinity).filter((issue) => typeof issue?.body === 'string' && issue.body.includes(marker));
  if (matches.length === 0) {
    throw new Error(`Pending ${label} creation is unresolved; no matching remote issue was found. Refusing to create a duplicate.`);
  }
  if (matches.length !== 1) {
    throw new Error(`Pending ${label} creation matched multiple remote issues. Refusing to choose a mapping.`);
  }
  return parseCreatedIssueUrl(matches[0].html_url || matches[0].url, origin, label);
}

function isDefiniteCreateRejection(error) {
  if (Number.isInteger(error.httpStatus)
    && error.httpStatus >= 400
    && error.httpStatus < 500
    && ![408, 425].includes(error.httpStatus)) return true;
  return DEFINITE_SPAWN_FAILURES.has(error.cause?.code);
}

function createOrRecoverIssue({
  kind,
  ref,
  title,
  body,
  record,
  origin,
  effects,
  appendPending,
  cancelPending,
}) {
  const marker = createMarker(kind, ref);
  if (record.github_create_pending) {
    if (record.github_create_pending.marker !== marker) {
      throw new Error(`Pending ${kind} creation marker for ${ref} is missing or corrupt; refusing to create a duplicate`);
    }
    try {
      return { ...recoverCreatedIssue(marker, origin, effects, `${kind} ${ref}`), recovered: true };
    } catch (error) {
      recordFailure(effects, `reconcile.${kind} ${ref}`, error);
      throw error;
    }
  }

  appendPending(marker);
  try {
    return {
      ...parseCreatedIssueUrl(
        ghText(['issue', 'create', '--title', title, '--body-file', '-'], {
          input: body,
          effects,
          label: `create.${kind} ${ref}`,
        }),
        origin,
        `${kind} ${ref}`,
      ),
      recovered: false,
    };
  } catch (error) {
    recordFailure(effects, `create.${kind} ${ref}`, error);
    if (isDefiniteCreateRejection(error)) {
      try {
        cancelPending();
      } catch (cancelError) {
        recordFailure(effects, `cancel_create.${kind} ${ref}`, cancelError);
        throw new Error(`${error.message}; pending create intent could not be cleared: ${cancelError.message}`, {
          cause: cancelError,
        });
      }
    }
    throw error;
  }
}

function issueId(number, origin, effects, label) {
  const issue = ghJson(['api', `repos/${origin.repository}/issues/${number}`], {
    effects,
    label: label || `read.issue.${number}`,
  });
  const remote = remoteIdentityFromUrl(issue?.html_url);
  if (!issue || !Number.isSafeInteger(issue.id) || issue.id <= 0
    || (issue.number != null && Number(issue.number) !== Number(number))
    || (issue.html_url && (!remote || remote.host !== origin.host || remote.repository !== origin.repository.toLowerCase()
      || remote.number !== Number(number)))) {
    throw new Error(`GitHub issue #${number} returned invalid identity data`);
  }
  return issue.id;
}

function managedParentExists(parent, records, origin, effects) {
  for (const record of records) {
    if (record.issue_number !== parent.number || !remoteRecordMatches(record, origin)) continue;
    const id = Number.isSafeInteger(record.issue_id)
      ? record.issue_id
      : issueId(record.issue_number, origin, effects, `hierarchy.read_managed_parent #${record.issue_number}`);
    if (id === parent.id) return true;
  }
  return false;
}

function currentParentIdentity(parent, origin, childRef) {
  if (!Number.isSafeInteger(parent?.number) || parent.number <= 0
    || !Number.isSafeInteger(parent?.id) || parent.id <= 0) {
    throw new Error(`GitHub returned corrupt parent identity data for ${childRef}`);
  }
  const remote = parent.html_url ? remoteIdentityFromUrl(parent.html_url) : null;
  if (parent.html_url && (!remote
    || remote.host !== origin.host
    || remote.repository !== origin.repository.toLowerCase()
    || remote.number !== parent.number)) {
    throw new Error(`GitHub returned a parent from a different host or repository for ${childRef}`);
  }
  return {
    host: remote?.host || origin.host,
    repository: remote?.repository || origin.repository.toLowerCase(),
    number: parent.number,
    id: parent.id,
  };
}

function explicitSubIssueUnsupported(error) {
  return error.httpStatus === 404
    && /sub[- ]issues?.{0,40}(?:not supported|unavailable|not enabled)|(?:not supported|unavailable|not enabled).{0,40}sub[- ]issues?/i.test(error.message);
}

function reconcileIssueParent({
  child,
  desiredParent,
  knownParents,
  origin,
  effects,
  diagnostics,
  childRef,
}) {
  if (!child?.issue_number) return { skipped: true, reason: 'child issue is not managed' };
  assertManagedRepository(child, origin, childRef);
  const childId = issueId(child.issue_number, origin, effects, `hierarchy.read_child ${childRef}`);
  let desiredId = null;
  if (desiredParent) {
    if (!desiredParent.issue_number) return { skipped: true, reason: 'parent issue is not managed' };
    assertManagedRepository(desiredParent, origin, `Parent of ${childRef}`);
    desiredId = issueId(desiredParent.issue_number, origin, effects, `hierarchy.read_parent #${desiredParent.issue_number}`);
  }
  const parentResult = ghJson(['api', `repos/${origin.repository}/issues/${child.issue_number}/parent`], {
    effects,
    label: `hierarchy.read_current_parent ${childRef}`,
    allowNotFound: true,
  });
  const currentParent = parentResult?.notFound ? null : parentResult
    ? currentParentIdentity(parentResult, origin, childRef)
    : null;
  if (desiredParent && currentParent?.host === origin.host
    && currentParent.repository === origin.repository.toLowerCase()
    && currentParent.number === desiredParent.issue_number
    && currentParent.id === desiredId) {
    return { unchanged: true, parent_issue_number: currentParent.number };
  }
  if (currentParent && !managedParentExists(currentParent, knownParents, origin, effects)) {
    diagnostics.push({
      source: 'sub_issues',
      ref: childRef,
      message: `Preserved existing external parent #${currentParent.number}; no authority to replace it.`,
    });
    return { preserved: true, reason: 'external_parent' };
  }

  if (!desiredParent && !currentParent) return { unchanged: true };
  const args = desiredParent
    ? ['api', '-X', 'POST', `repos/${origin.repository}/issues/${desiredParent.issue_number}/sub_issues`,
      '-F', `sub_issue_id=${childId}`, '-F', `replace_parent=${currentParent ? 'true' : 'false'}`]
    : ['api', '-X', 'DELETE', `repos/${origin.repository}/issues/${currentParent.number}/sub_issues`,
      '-F', `sub_issue_id=${childId}`];
  const action = desiredParent
    ? `hierarchy.link ${childRef} -> #${desiredParent.issue_number}`
    : `hierarchy.unlink ${childRef} from #${currentParent.number}`;
  try {
    ghJson(args, { effects, label: action });
  } catch (error) {
    if (!explicitSubIssueUnsupported(error)) throw error;
    effects.failures = effects.failures.filter((item) => item.action !== action || item.message !== error.message);
    effects.completed.push({ action, outcome: 'unsupported' });
    diagnostics.push({
      source: 'sub_issues',
      ref: childRef,
      message: 'GitHub explicitly reported that sub-issues are unsupported; using linked checkbox lists instead.',
    });
    return { unsupported: true, fallback: 'linked_checklist' };
  }
  return { changed: true };
}

function localManagedGoals() {
  return discoverGoals().flatMap(({ username, goalId }) => {
    const goal = readGoalWithTasks(goalId, username);
    return goal ? [{ ...goal, username }] : [];
  });
}

export function pushTrack(trackId, { effects = createEffectTracker(), diagnostics = [] } = {}) {
  if (!collaborationEnabled()) return { skipped: true, effects: effectsSummary(effects) };
  const track = readTrack(trackId);
  if (!track) throw new Error(`Lane ${trackId} not found`);
  const origin = requireRemoteOrigin();
  assertManagedRepository(track, origin, `Lane #${trackToLaneId(track.track_id)}`);
  const laneId = trackToLaneId(track.track_id);
  const title = `[Lane] ${externalIssueTitle(track.title)}`;
  const body = buildLaneIssueBody(track, { origin });
  let issueNumber = track.issue_number;
  let issueUrl = track.issue_url;
  let recovered = false;
  if (!issueNumber) {
    const created = createOrRecoverIssue({
      kind: 'lane',
      ref: `#${laneId}`,
      title,
      body,
      record: track,
      origin,
      effects,
      appendPending: (marker) => appendTrackEvent(trackId, {
        event: 'lane_github_create_pending',
        lane_id: laneId,
        marker,
      }),
      cancelPending: () => appendTrackEvent(trackId, {
        event: 'lane_github_create_cancelled',
        lane_id: laneId,
      }),
    });
    recovered = created.recovered;
    issueNumber = created.number;
    issueUrl = created.url;
    appendTrackEvent(trackId, {
      event: 'lane_github_synced',
      lane_id: laneId,
      issue_number: issueNumber,
      issue_url: issueUrl,
      repository: origin.repository,
      remote_host: origin.host,
    });
  } else {
    ghText(['issue', 'edit', String(issueNumber), '--title', title, '--body-file', '-'], {
      input: body, effects, label: `update.lane #${laneId}`,
    });
  }

  const current = readTrack(trackId);
  if (recovered) {
    ghText(['issue', 'edit', String(issueNumber), '--title', `[Lane] ${externalIssueTitle(current.title)}`, '--body-file', '-'], {
      input: buildLaneIssueBody(current, { origin }),
      effects,
      label: `update.lane #${laneId}`,
    });
  }
  const remote = ghJson(['api', `repos/${origin.repository}/issues/${issueNumber}`], {
    effects,
    label: `read.lane_state #${laneId}`,
  });
  if (!remote || !['open', 'closed'].includes(String(remote.state).toLowerCase())) {
    throw new Error(`GitHub returned invalid state for Lane #${laneId}`);
  }
  const desiredState = ['closed', 'not_planned', 'duplicate'].includes(current.status) ? 'closed' : 'open';
  if (String(remote.state).toLowerCase() !== desiredState) {
    ghText(['issue', desiredState === 'closed' ? 'close' : 'reopen', String(issueNumber)], {
      effects, label: `${desiredState === 'closed' ? 'close' : 'reopen'}.lane #${laneId}`,
    });
  }

  const knownLanes = listTracks();
  for (const goal of goalsForLane(laneId)) {
    if (!goal.issue_number || goal.github_unlinked) continue;
    try {
      reconcileIssueParent({
        child: goal,
        desiredParent: current,
        knownParents: knownLanes,
        origin,
        effects,
        diagnostics,
        childRef: goalRef(goal),
      });
    } catch (error) {
      recordFailure(effects, `hierarchy.goal ${goalRef(goal)}`, error);
      diagnostics.push({ source: 'sub_issues', ref: goalRef(goal), message: error.message });
    }
  }
  return { lane_id: laneId, issue_number: issueNumber, issue_url: issueUrl, effects: effectsSummary(effects), diagnostics };
}

export function reconcileGoalParent(goalId, { username = null, effects = createEffectTracker(), diagnostics = [] } = {}) {
  if (!collaborationEnabled()) return { skipped: true, effects: effectsSummary(effects) };
  const goal = readGoalWithTasks(goalId, username);
  if (!goal?.issue_number || goal.github_unlinked) return { skipped: true, reason: 'goal issue is not managed' };
  const origin = requireRemoteOrigin();
  assertManagedRepository(goal, origin, `Goal ${formatRef({ username, goalId })}`);
  let desiredParent = goal.track_id ? readTrack(goal.track_id) : null;
  if (goal.track_id && !desiredParent) throw new Error(`Lane ${trackToLaneId(goal.track_id)} referenced by Goal ${goalId} was not found`);
  if (desiredParent && !desiredParent.issue_number) {
    pushTrack(desiredParent.track_id, { effects, diagnostics });
    desiredParent = readTrack(desiredParent.track_id);
  }
  return reconcileIssueParent({
    child: goal,
    desiredParent,
    knownParents: listTracks(),
    origin,
    effects,
    diagnostics,
    childRef: formatRef({ username, goalId }),
  });
}

function reconcileTaskParent(goal, task, { effects, diagnostics, origin }) {
  if (!task.issue_number || !goal.issue_number) return { skipped: true };
  const knownGoals = localManagedGoals();
  return reconcileIssueParent({
    child: task,
    desiredParent: goal,
    knownParents: knownGoals,
    origin,
    effects,
    diagnostics,
    childRef: taskRef(goal, task, goal.username || null),
  });
}

function updateRemoteIssueState(record, kind, ref, origin, effects) {
  const state = ghJson(['api', `repos/${origin.repository}/issues/${record.issue_number}`], {
    effects, label: `read.${kind}_state ${ref}`,
  });
  if (!state || !['open', 'closed'].includes(String(state.state).toLowerCase())) {
    throw new Error(`GitHub returned invalid state for ${ref}`);
  }
  const desiredState = ['closed', 'not_planned', 'duplicate'].includes(record.status) ? 'closed' : 'open';
  if (String(state.state).toLowerCase() !== desiredState) {
    ghText(['issue', desiredState === 'closed' ? 'close' : 'reopen', String(record.issue_number)], {
      effects,
      label: `${desiredState === 'closed' ? 'close' : 'reopen'}.${kind} ${ref}`,
    });
  }
}

export function pushGoal(goalId, { username = null, effects = createEffectTracker(), diagnostics = [] } = {}) {
  if (!collaborationEnabled()) return { skipped: true, effects: effectsSummary(effects) };
  let goal = readGoalWithTasks(goalId, username);
  if (!goal) return { skipped: true, reason: 'goal not found', effects: effectsSummary(effects) };
  if (goal.github_unlinked) return { skipped: true, reason: 'unlinked', effects: effectsSummary(effects) };
  const origin = requireRemoteOrigin();
  const ref = formatRef({ username, goalId });
  assertManagedRepository(goal, origin, `Goal ${ref}`);
  goal.username = username;
  const config = readCollaborationConfig();
  if (typeof config.tasks_as_issues !== 'boolean') throw new Error('tasks_as_issues configuration must be a boolean');
  const title = `[Goal] ${externalIssueTitle(goal.title)}`;
  let body = buildIssueBody(goal, { username, config, origin });
  const initialBody = body;
  const wasCreated = !goal.issue_number;
  let issueNumber = goal.issue_number;
  let issueUrl = goal.issue_url;
  let recoveredCreate = false;
  if (wasCreated) {
    const created = createOrRecoverIssue({
      kind: 'goal',
      ref,
      title,
      body,
      record: goal,
      origin,
      effects,
      appendPending: (marker) => appendEvent(goalId, {
        event: 'github_create_pending',
        goal_id: goalId,
        timestamp: new Date().toISOString(),
        marker,
      }, username ? { username } : {}),
      cancelPending: () => appendEvent(goalId, {
        event: 'github_create_cancelled',
        goal_id: goalId,
        timestamp: new Date().toISOString(),
      }, username ? { username } : {}),
    });
    recoveredCreate = created.recovered;
    issueNumber = created.number;
    issueUrl = created.url;
    appendEvent(goalId, {
      event: 'github_synced',
      goal_id: goalId,
      timestamp: new Date().toISOString(),
      issue_number: issueNumber,
      issue_url: issueUrl,
      repository: origin.repository,
      remote_host: origin.host,
    }, username ? { username } : {});
    goal = readGoalWithTasks(goalId, username);
  }

  const taskFailures = [];
  if (config.tasks_as_issues) {
    for (const task of getOrderedTasks(goal)) {
      const taskId = task.task_id;
      const taskIdentity = taskRef(goal, task, username);
      try {
        assertManagedRepository(task, origin, `Task ${taskIdentity}`);
        const taskBody = buildTaskIssueBody(task, goal, issueNumber, { username });
        if (!task.issue_number) {
          const created = createOrRecoverIssue({
            kind: 'task',
            ref: taskIdentity,
            title: externalIssueTitle(task.title),
            body: taskBody,
            record: task,
            origin,
            effects,
            appendPending: (marker) => appendEvent(goalId, {
              event: 'task_github_create_pending',
              goal_id: goalId,
              task_id: taskId,
              timestamp: new Date().toISOString(),
              marker,
            }, username ? { username } : {}),
            cancelPending: () => appendEvent(goalId, {
              event: 'task_github_create_cancelled',
              goal_id: goalId,
              task_id: taskId,
              timestamp: new Date().toISOString(),
            }, username ? { username } : {}),
          });
          appendEvent(goalId, {
              event: 'task_github_synced',
              goal_id: goalId,
              task_id: taskId,
              timestamp: new Date().toISOString(),
              issue_number: created.number,
              issue_url: created.url,
              repository: origin.repository,
              remote_host: origin.host,
            }, username ? { username } : {});
          if (created.recovered) {
            ghText(['issue', 'edit', String(created.number), '--title', externalIssueTitle(task.title), '--body-file', '-'], {
              input: taskBody,
              effects,
              label: `update.task ${taskIdentity}`,
            });
          }
          updateRemoteIssueState({ ...task, issue_number: created.number }, 'task', taskIdentity, origin, effects);
        } else {
          ghText(['issue', 'edit', String(task.issue_number), '--title', externalIssueTitle(task.title), '--body-file', '-'], {
            input: taskBody, effects, label: `update.task ${taskIdentity}`,
          });
          updateRemoteIssueState(task, 'task', taskIdentity, origin, effects);
        }
      } catch (error) {
        recordFailure(effects, `sync.task ${taskIdentity}`, error);
        taskFailures.push({ ref: taskIdentity, message: error.message });
      }
    }
  }

  goal = readGoalWithTasks(goalId, username);
  goal.username = username;
  body = buildIssueBody(goal, { username, config, origin });
  if (!wasCreated || recoveredCreate || body !== initialBody) {
    ghText(['issue', 'edit', String(issueNumber), '--title', title, '--body-file', '-'], {
      input: body, effects, label: `update.goal ${ref}`,
    });
  }
  updateRemoteIssueState({ ...goal, issue_number: issueNumber }, 'goal', ref, origin, effects);

  if (config.tasks_as_issues) {
    for (const task of getOrderedTasks(goal)) {
      if (!task.issue_number) continue;
      const taskIdentity = taskRef(goal, task, username);
      try {
        reconcileTaskParent(goal, task, { effects, diagnostics, origin });
      } catch (error) {
        recordFailure(effects, `hierarchy.task ${taskIdentity}`, error);
        diagnostics.push({ source: 'sub_issues', ref: taskIdentity, message: error.message });
      }
    }
  }

  try {
    reconcileGoalParent(goalId, { username, effects, diagnostics });
  } catch (error) {
    recordFailure(effects, `hierarchy.goal ${ref}`, error);
    diagnostics.push({ source: 'sub_issues', ref, message: error.message });
  }

  return {
    goal_id: goalId,
    issue_number: issueNumber,
    issue_url: issueUrl,
    partial: taskFailures.length > 0,
    failures: taskFailures,
    effects: effectsSummary(effects),
    diagnostics,
  };
}

function automaticSyncResult(kind, ref, effects, diagnostics, result, error = null) {
  if (error && effects.failures.length === 0) recordFailure(effects, `auto_sync.${kind} ${ref}`, error);
  const failed = effects.failures.length > 0 || Boolean(result?.partial) || Boolean(error);
  return {
    status: result?.skipped ? result.reason ? 'skipped' : 'disabled' : failed ? 'partial' : 'synced',
    success: !failed,
    ...(result?.skipped && result.reason ? { reason: result.reason } : {}),
    ...(error ? { error: error.message } : {}),
    effects: effectsSummary(effects),
    diagnostics,
  };
}

export function autoSyncGoal(goalId, { username = null } = {}) {
  const effects = createEffectTracker();
  const diagnostics = [];
  const ref = formatRef({ username, goalId });
  try {
    const result = pushGoal(goalId, { username, effects, diagnostics });
    return automaticSyncResult('goal', ref, effects, diagnostics, result);
  } catch (error) {
    return automaticSyncResult('goal', ref, effects, diagnostics, null, error);
  }
}

export function autoSyncTrack(trackId, { kind = 'lane' } = {}) {
  const effects = createEffectTracker();
  const diagnostics = [];
  const ref = kind === 'lane' ? `#${trackToLaneId(trackId)}` : `#${trackId}`;
  try {
    const result = pushTrack(trackId, { effects, diagnostics });
    return automaticSyncResult(kind, ref, effects, diagnostics, result);
  } catch (error) {
    return automaticSyncResult(kind, ref, effects, diagnostics, null, error);
  }
}

// ── Sync single goal ──────────────────────────────────────────────

export function syncGoal(goalId, { username = null } = {}) {
  const effects = createEffectTracker();
  const diagnostics = [];
  if (!collaborationEnabled()) return { skipped: true, pulls: null, effects: effectsSummary(effects), diagnostics };
  const goal = readGoalWithTasks(goalId, username);
  if (!goal) return { skipped: false, success: false, pulls: null, effects: effectsSummary(effects), diagnostics,
    failures: [{ action: `sync.goal ${goalId}`, message: 'Goal not found' }] };
  const pulls = pullAllGithub({ effects });
  try { pushGoal(goalId, { username, effects, diagnostics }); }
  catch (error) { recordFailure(effects, `sync.goal ${formatRef({ username, goalId })}`, error); }
  return {
    skipped: false,
    success: effects.failures.length === 0 && pulls.warnings.length === 0,
    pulls,
    effects: effectsSummary(effects),
    diagnostics: [...diagnostics, ...pulls.warnings],
  };
}

// ── Sync all ──────────────────────────────────────────────────────

export function syncAll() {
  const effects = createEffectTracker();
  const diagnostics = [];
  if (!collaborationEnabled()) {
    return {
      pulled: { imported: 0, updated: 0, prs_imported: 0, prs_updated: 0, prs_unchanged: 0, prs_unmatched: 0, warnings: [] },
      pushed: 0,
      skipped: true,
      success: true,
      effects: effectsSummary(effects),
      diagnostics,
    };
  }

  const pullResult = pullAllGithub({ effects });
  const tracks = listTracks();
  for (const track of tracks) {
    if (track.issue_number) continue;
    try { pushTrack(track.track_id, { effects, diagnostics }); }
    catch (error) { recordFailure(effects, `sync.lane #${trackToLaneId(track.track_id)}`, error); }
  }

  let pushed = 0;
  for (const { username, goalId } of discoverGoals()) {
    const goal = readGoalWithTasks(goalId, username);
    if (!goal || goal.github_unlinked) continue;
    try {
      const result = pushGoal(goalId, { username, effects, diagnostics });
      if (!result.skipped) pushed++;
    } catch (error) {
      recordFailure(effects, `sync.goal ${formatRef({ username, goalId })}`, error);
    }
  }

  for (const track of tracks) {
    try { pushTrack(track.track_id, { effects, diagnostics }); }
    catch (error) { recordFailure(effects, `sync.lane #${trackToLaneId(track.track_id)}`, error); }
  }

  return {
    pulled: {
      imported: pullResult.issues.imported,
      updated: pullResult.issues.updated,
      prs_imported: pullResult.pull_requests.imported.length,
      prs_updated: pullResult.pull_requests.updated.length,
      prs_unchanged: pullResult.pull_requests.unchanged.length,
      prs_unmatched: pullResult.pull_requests.unmatched.length,
      warnings: pullResult.warnings,
    },
    pushed,
    skipped: false,
    success: effects.failures.length === 0 && pullResult.warnings.length === 0,
    effects: effectsSummary(effects),
    diagnostics: [...diagnostics, ...pullResult.warnings],
  };
}

function localSyncRecords(ref) {
  if (!ref) return { lanes: listTracks(), goals: localManagedGoals(), relatedGoals: [] };
  if (/^#?[lr]\d+$/i.test(ref)) {
    const laneId = normalizeLaneId(ref);
    const lane = readTrack(laneToTrackId(laneId));
    if (!lane) throw new Error(`Lane ${laneId} not found`);
    return { lanes: [lane], goals: goalsForLane(laneId), relatedGoals: [] };
  }
  const parsed = parseRef(ref);
  if (!parsed?.goalId || parsed.revision != null || parsed.criterionId || parsed.componentId) {
    throw new Error(`Sync preview requires a current Goal or Task reference: ${ref}`);
  }
  const goal = readGoalWithTasks(parsed.goalId, parsed.username);
  if (!goal) throw new Error(`Goal ${parsed.goalId} not found`);
  if (parsed.taskId && !goal.tasks?.[parsed.taskId]) {
    throw new Error(`Task ${parsed.taskId} not found in Goal ${parsed.goalId}`);
  }
  goal.username = parsed.username || null;
  const lanes = [];
  let relatedGoals = [];
  if (!goal.github_unlinked && goal.track_id) {
    const lane = readTrack(goal.track_id);
    if (!lane) throw new Error(`Lane ${trackToLaneId(goal.track_id)} referenced by Goal ${parsed.goalId} was not found`);
    if (!lane.issue_number) {
      lanes.push(lane);
      relatedGoals = goalsForLane(trackToLaneId(goal.track_id));
    }
  }
  return { lanes, goals: [goal], relatedGoals };
}

export function previewSync(ref = null) {
  const config = readCollaborationConfig();
  if (typeof config.tasks_as_issues !== 'boolean') throw new Error('tasks_as_issues configuration must be a boolean');
  const { lanes, goals, relatedGoals = [] } = localSyncRecords(ref);
  const laneOnly = Boolean(ref && /^#?[lr]\d+$/i.test(ref));
  const plannedWrites = [];
  const plannedRelationships = new Map();
  const issueAction = (record) => record.github_create_pending
    ? 'reconcile_pending_create'
    : record.issue_number ? 'update_managed_issue' : 'create_managed_issue';
  const planRelationship = (record, relation, parentRef, trigger) => {
    const localRef = relation === 'goal_task'
      ? taskRef(record.goal, record.task)
      : goalRef(record);
    plannedRelationships.set(`${relation}:${localRef}`, {
      kind: 'relationship',
      relation,
      ref: localRef,
      parent_ref: parentRef,
      action: 'reconcile_parent_if_supported',
      trigger,
    });
  };
  if (config.collaboration) {
    for (const lane of lanes) {
      plannedWrites.push({
        kind: 'lane',
        ref: `#${trackToLaneId(lane.track_id)}`,
        action: issueAction(lane),
      });
    }
    for (const goal of laneOnly ? [] : goals) {
      const localRef = goalRef(goal);
      plannedWrites.push({
        kind: 'goal',
        ref: localRef,
        action: goal.github_unlinked ? 'skip_unlinked' : issueAction(goal),
      });
      if (!goal.github_unlinked && config.tasks_as_issues) {
        for (const task of getOrderedTasks(goal)) {
          plannedWrites.push({
            kind: 'task',
            ref: taskRef(goal, task),
            action: issueAction(task),
          });
          planRelationship({ goal, task }, 'goal_task', localRef, 'goal_sync');
        }
      }
      if (!goal.github_unlinked) {
        planRelationship(
          goal,
          'lane_goal',
          goal.track_id ? `#${trackToLaneId(goal.track_id)}` : null,
          'goal_sync',
        );
      }
    }
    if (laneOnly) {
      for (const goal of goals.filter((item) => item.issue_number && !item.github_unlinked)) {
        planRelationship(goal, 'lane_goal', `#${trackToLaneId(goal.track_id)}`, 'lane_sync');
      }
    } else {
      for (const goal of relatedGoals.filter((item) => item.issue_number && !item.github_unlinked)) {
        planRelationship(goal, 'lane_goal', goal.track_id ? `#${trackToLaneId(goal.track_id)}` : null, 'parent_lane_creation');
      }
    }
    plannedWrites.push(...plannedRelationships.values());
  }
  return {
    mode: 'preview',
    requested_ref: ref,
    execution_scope: ref && !laneOnly && parseRef(ref)?.taskId ? 'whole_goal' : laneOnly ? 'lane' : ref ? 'goal' : 'project',
    collaboration_enabled: config.collaboration,
    network_accessed: false,
    remote_state: 'unknown',
    authentication: 'unknown_until_explicit_sync',
    hierarchy_capability: 'unknown_until_explicit_sync',
    planned_reads: config.collaboration && !laneOnly
      ? ['issues.list', 'pull_requests.list', 'managed_issue_states', 'sub_issue_relationships']
      : config.collaboration ? ['managed_issue_states', 'sub_issue_relationships'] : [],
    planned_writes: plannedWrites,
    diagnostics: config.collaboration ? [] : ['GitHub collaboration is disabled; no remote actions are planned.'],
  };
}
