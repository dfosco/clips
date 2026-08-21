// Bidirectional GitHub Issues sync engine
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  appendEvent,
  readGoalWithTasks,
  getClipsDbDir,
  goalExists,
  getOrderedTasks,
  normalizeGoalId,
} from './core.js';
import { readConfig, isCollaborationEnabled } from './config.js';
import { effectiveVerificationMode } from './behavior.js';

const GITHUB_CACHE_FILE = '_github.jsonl';

function runGh(args) {
  return spawnSync('gh', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

function repositoryFromRemote() {
  const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  if (result.status !== 0) return '';
  return result.stdout.trim().replace(/^git@github\.com:/, '').replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
}

function cachePath() {
  return path.join(getClipsDbDir(), GITHUB_CACHE_FILE);
}

function prKey(pr) {
  return `${pr.repository || ''}#${pr.pr_number}`;
}

export function parsePlanningRefs(text = '') {
  const covers = [...text.matchAll(/(?:^|[^\w])(#(?:[a-z][\w-]*#)?g\d+(?:#t\d+)?)/gi)].map((match) => match[1]);
  const crIds = [...text.matchAll(/(?:^|[^\w])(CR-\d+)\b/gi)].map((match) => match[1].toUpperCase());
  return { covers: [...new Set(covers)], cr_ids: [...new Set(crIds)] };
}

export function normalizePullRequest(pr, repository = repositoryFromRemote()) {
  const body = pr.body || '';
  const refs = parsePlanningRefs(`${pr.title || ''}\n${body}`);
  const author = typeof pr.author === 'string' ? pr.author : pr.author?.login || pr.author?.name || '';
  const repo = typeof pr.repository === 'string' ? pr.repository : pr.repository?.nameWithOwner || repository;
  return {
    event: 'github_pr_synced',
    repository: repo,
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

export function buildTaskIssueBody(task, goal, parentIssueNumber = null) {
  const sections = [];
  if (parentIssueNumber) sections.push(`Sub-issue of #${parentIssueNumber}`);
  if (task.description) sections.push(formatDescription(task.description));
  if (task.behavior) sections.push(`## Behavior\n\n${formatBehaviorBlock(task.behavior)}`);
  sections.push(`## Verification Mode\n\n\`${effectiveVerificationMode(goal?.verification_mode, task.verification_mode)}\``);
  return sections.join('\n\n').trim();
}

export function buildIssueBody(goal) {
  const config = readConfig();
  let body = '';

  if (goal.description) {
    const desc = formatDescription(goal.description);
    if (desc) {
      body += `## Description\n\n${desc}\n\n`;
    }
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
        body += `- ${text}\n`;
      }
      body += '\n';
    }
  }

  const tasks = getOrderedTasks(goal);
  if (tasks.length > 0) {
    body += `## Tasks\n\n`;
    for (const task of tasks) {
      const checked = ['closed', 'not_planned', 'duplicate'].includes(task.status) ? 'x' : ' ';
      if (config.tasks_as_issues && task.issue_number) {
        body += `- [${checked}] #${task.issue_number} ${task.title}\n`;
      } else {
        body += `- [${checked}] **#${goal.goal_id}#${task.task_id}**: ${task.title}\n`;
        if (task.description) {
          body += `${String(task.description).split(/\r?\n/).map((line) => `  ${line}`).join('\n')}\n`;
        }
        body += `  - Verification: \`${effectiveVerificationMode(goal.verification_mode, task.verification_mode)}\`\n`;
        if (task.behavior) {
          body += `  - Behavior:\n\n${formatBehaviorBlock(task.behavior, '    ')}\n`;
        }
      }
    }
  }

  body += `\n---\n_Managed by clips • Goal ID: #${goal.goal_id}_`;

  return body;
}

// ── Parsing ───────────────────────────────────────────────────────

export function parseTaskList(body) {
  if (!body) return [];
  const results = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^- \[([ xX])\] (.+)/);
    if (m) {
      results.push({
        title: m[2].trim(),
        done: m[1].toLowerCase() === 'x',
      });
    }
  }
  return results;
}

// ── Lookup ────────────────────────────────────────────────────────

export function findGoalByIssueNumber(issueNumber) {
  const dbDir = getClipsDbDir();
  if (!fs.existsSync(dbDir)) return null;

  function scanDir(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const found = scanDir(path.join(dir, entry.name));
        if (found) return found;
      } else if (entry.name.endsWith('.jsonl')) {
        const filePath = path.join(dir, entry.name);
        const content = fs.readFileSync(filePath, 'utf8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (
              event.event === 'github_synced' &&
              event.issue_number === issueNumber
            ) {
              return event.goal_id;
            }
          } catch {
            // skip malformed lines
          }
        }
      }
    }
    return null;
  }

  return scanDir(dbDir);
}

// ── Import ────────────────────────────────────────────────────────

export function importIssue(issueData) {
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
      status: issueData.state === 'closed' || issueData.state === 'CLOSED' ? 'closed' : 'open',
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
      issue_url: '',
    },
  );

  // tasks from body checkboxes
  const tasks = parseTaskList(issueData.body);
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

  return goalId;
}

// ── Pull ──────────────────────────────────────────────────────────

export function pullAllIssues() {
  const result = runGh([
      'issue',
      'list',
      '--state',
      'all',
      '--json',
      'number,title,body,state,createdAt,updatedAt',
      '--limit',
      '1000',
  ]);

  if (result.status !== 0) {
    throw new Error(result.stderr || 'gh issue list failed');
  }

  const issues = JSON.parse(result.stdout);
  let imported = 0;
  let updated = 0;

  for (const issue of issues) {
    const existingGoalId = findGoalByIssueNumber(issue.number);
    if (existingGoalId) {
      // Already imported — check if status diverged
      const goal = readGoalWithTasks(existingGoalId);
      if (!goal) continue;

      const ghClosed = issue.state === 'CLOSED' || issue.state === 'closed';
      const localClosed = ['closed', 'not_planned', 'duplicate'].includes(goal.status);

      if (ghClosed && !localClosed) {
        appendEvent(
          existingGoalId,
          {
            event: 'status_changed',
            goal_id: existingGoalId,
            timestamp: new Date().toISOString(),
            status: 'closed',
          },
        );
        updated++;
      } else if (!ghClosed && localClosed) {
        appendEvent(
          existingGoalId,
          {
            event: 'status_changed',
            goal_id: existingGoalId,
            timestamp: new Date().toISOString(),
            status: 'open',
          },
        );
        updated++;
      }
    } else {
      importIssue(issue);
      imported++;
    }
  }

  return { imported, updated, total: issues.length };
}

export function pullAllPullRequests() {
  const result = runGh([
    'pr', 'list', '--state', 'all', '--json',
    'number,title,body,state,url,repository,headRefName,author,createdAt,updatedAt,mergedAt',
    '--limit', '1000',
  ]);
  if (result.status !== 0) throw new Error(result.stderr || 'gh pr list failed');

  const imported = [];
  const updated = [];
  const unchanged = [];
  const unmatched = [];
  const repository = repositoryFromRemote();
  const rawPullRequests = JSON.parse(result.stdout);
  if (!Array.isArray(rawPullRequests)) throw new Error('gh pr list returned a non-array response');
  for (const raw of rawPullRequests) {
    const pr = normalizePullRequest(raw, repository);
    const linkedOutcome = appendPullRequestToGoals(pr);
    const outcome = linkedOutcome || appendCachedPullRequest(pr);
    if (!linkedOutcome) unmatched.push(pr);
    if (outcome === 'imported') imported.push(pr);
    else if (outcome === 'updated') updated.push(pr);
    else if (outcome === 'unchanged') unchanged.push(pr);
  }
  return { imported, updated, unchanged, unmatched, total: rawPullRequests.length };
}

export function pullAllGithub() {
  const result = {
    issues: { imported: 0, updated: 0, total: 0 },
    pull_requests: { imported: [], updated: [], unchanged: [], unmatched: [], total: 0 },
    warnings: [],
  };
  try {
    result.issues = pullAllIssues();
  } catch (error) {
    result.warnings.push({ source: 'issues', message: error.message });
  }
  try {
    result.pull_requests = pullAllPullRequests();
  } catch (error) {
    result.warnings.push({ source: 'pull_requests', message: error.message });
  }
  return result;
}

// ── Push ──────────────────────────────────────────────────────────

export function pushGoal(goalId) {
  if (!isCollaborationEnabled()) {
    return { skipped: true };
  }

  const goal = readGoalWithTasks(goalId);
  if (!goal) return;

  const config = readConfig();
  const title = `[Goal] ${goal.title}`;
  const body = buildIssueBody(goal);

  try {
    if (!goal.issue_number) {
      // Create new issue
      const res = spawnSync(
        'gh',
        ['issue', 'create', '--title', title, '--body-file', '-'],
        { input: body, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      if (res.status !== 0) {
        throw new Error(res.stderr || 'gh issue create failed');
      }

      const issueUrl = res.stdout.trim();
      const issueNumber = parseInt(issueUrl.split('/').pop(), 10);

      appendEvent(
        goalId,
        {
          event: 'github_synced',
          goal_id: goalId,
          timestamp: new Date().toISOString(),
          issue_number: issueNumber,
          issue_url: issueUrl,
        },
      );

      // Create sub-issues for tasks when tasks_as_issues is enabled
      if (config.tasks_as_issues) {
        const tasks = getOrderedTasks(goal);
        for (const task of tasks) {
          if (task.issue_number) continue;
          const taskRes = spawnSync(
            'gh',
            ['issue', 'create', '--title', task.title, '--body-file', '-'],
            {
              input: buildTaskIssueBody(task, goal, issueNumber),
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
          if (taskRes.status !== 0) continue;
          const taskUrl = taskRes.stdout.trim();
          const taskIssueNum = parseInt(taskUrl.split('/').pop(), 10);
          appendEvent(
            goalId,
            {
              event: 'task_github_synced',
              goal_id: goalId,
              task_id: task.task_id,
              timestamp: new Date().toISOString(),
              issue_number: taskIssueNum,
              issue_url: taskUrl,
            },
          );
        }
      }
    } else {
      const num = goal.issue_number;

      // Update issue title & body
      const editRes = spawnSync(
        'gh',
        ['issue', 'edit', String(num), '--title', title, '--body-file', '-'],
        { input: body, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      if (editRes.status !== 0) {
        throw new Error(editRes.stderr || 'gh issue edit failed');
      }

      // Close / reopen based on local status
      const shouldBeClosed = ['closed', 'not_planned', 'duplicate'].includes(goal.status);
      if (shouldBeClosed) {
        spawnSync('gh', ['issue', 'close', String(num)], {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } else {
        // Reopen if currently closed on GitHub
        const viewRes = spawnSync(
          'gh',
          ['issue', 'view', String(num), '--json', 'state'],
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
        );
        if (viewRes.status === 0) {
          try {
            const remote = JSON.parse(viewRes.stdout);
            if (
              remote.state === 'CLOSED' ||
              remote.state === 'closed'
            ) {
              spawnSync('gh', ['issue', 'reopen', String(num)], {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
              });
            }
          } catch {
            // ignore parse errors
          }
        }
      }

      // Manage sub-issues when tasks_as_issues is enabled
      if (config.tasks_as_issues) {
        const tasks = getOrderedTasks(goal);
        for (const task of tasks) {
          if (!task.issue_number) continue;
          spawnSync(
            'gh',
            ['issue', 'edit', String(task.issue_number), '--title', task.title, '--body-file', '-'],
            {
              input: buildTaskIssueBody(task, goal, num),
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
            },
          );
          const taskDone = ['closed', 'not_planned', 'duplicate'].includes(task.status);
          if (taskDone) {
            spawnSync('gh', ['issue', 'close', String(task.issue_number)], {
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
          } else {
            spawnSync('gh', ['issue', 'reopen', String(task.issue_number)], {
              encoding: 'utf8',
              stdio: ['pipe', 'pipe', 'pipe'],
            });
          }
        }
      }
    }
  } catch (error) {
    console.error(`sync: push failed for ${goalId}: ${error.message}`);
  }
}

// ── Sync single goal ──────────────────────────────────────────────

export function syncGoal(goalId) {
  const goal = readGoalWithTasks(goalId);
  if (!goal) return { skipped: false, pulls: null };
  const pulls = pullAllGithub();
  if (isCollaborationEnabled()) pushGoal(goalId);
  return { skipped: false, pulls };
}

// ── Sync all ──────────────────────────────────────────────────────

export function syncAll() {
  const pullResult = pullAllGithub();

  const dbDir = getClipsDbDir();
  let pushed = 0;

  if (fs.existsSync(dbDir)) {
    const scanGoals = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          scanGoals(path.join(dir, entry.name));
        } else if (entry.name.endsWith('.jsonl') && entry.name !== GITHUB_CACHE_FILE) {
          const gId = entry.name.replace('.jsonl', '');
          const goal = readGoalWithTasks(gId);
          if (goal) {
            if (isCollaborationEnabled()) {
              pushGoal(gId);
              pushed++;
            }
          }
        }
      }
    };
    scanGoals(dbDir);
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
  };
}
