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
import { readConfig } from './config.js';

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

export function buildIssueBody(goal) {
  const config = readConfig();
  let body = '';

  if (goal.description) {
    const desc = formatDescription(goal.description);
    if (desc) {
      body += `## Description\n\n${desc}\n\n`;
    }
  }

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
          body += `  ${task.description}\n`;
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

  const clippedDesc =
    issueData.body && issueData.body.length > 200
      ? issueData.body.slice(0, 200) + '…'
      : issueData.body || '';

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
    { skipSync: true },
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
    { skipSync: true },
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
      { skipSync: true },
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
        { skipSync: true },
      );
    }
  });

  return goalId;
}

// ── Pull ──────────────────────────────────────────────────────────

export function pullAllIssues() {
  const result = spawnSync(
    'gh',
    [
      'issue',
      'list',
      '--state',
      'all',
      '--json',
      'number,title,body,state,createdAt,updatedAt',
      '--limit',
      '1000',
    ],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

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
          { skipSync: true },
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
          { skipSync: true },
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

// ── Push ──────────────────────────────────────────────────────────

export function pushGoal(goalId) {
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
        { skipSync: true },
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
              input: `Sub-issue of #${issueNumber}\n\n${task.description || ''}`.trim(),
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
            { skipSync: true },
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
  if (!goal || !goal.issue_number) {
    pushGoal(goalId);
    return;
  }

  // Pull latest state for this single issue
  const viewRes = spawnSync(
    'gh',
    [
      'issue',
      'view',
      String(goal.issue_number),
      '--json',
      'number,title,body,state,createdAt,updatedAt',
    ],
    { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

  if (viewRes.status === 0) {
    try {
      const remote = JSON.parse(viewRes.stdout);
      const ghClosed = remote.state === 'CLOSED' || remote.state === 'closed';
      const localClosed = ['closed', 'not_planned', 'duplicate'].includes(goal.status);

      if (ghClosed && !localClosed) {
        appendEvent(
          goalId,
          {
            event: 'status_changed',
            goal_id: goalId,
            timestamp: new Date().toISOString(),
            status: 'closed',
          },
          { skipSync: true },
        );
      } else if (!ghClosed && localClosed) {
        appendEvent(
          goalId,
          {
            event: 'status_changed',
            goal_id: goalId,
            timestamp: new Date().toISOString(),
            status: 'open',
          },
          { skipSync: true },
        );
      }
    } catch {
      // ignore parse errors
    }
  }

  pushGoal(goalId);
}

// ── Sync all ──────────────────────────────────────────────────────

export function syncAll() {
  const pullResult = pullAllIssues();

  const dbDir = getClipsDbDir();
  let pushed = 0;

  if (fs.existsSync(dbDir)) {
    const scanGoals = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          scanGoals(path.join(dir, entry.name));
        } else if (entry.name.endsWith('.jsonl')) {
          const gId = entry.name.replace('.jsonl', '');
          const goal = readGoalWithTasks(gId);
          if (goal) {
            pushGoal(gId);
            pushed++;
          }
        }
      }
    };
    scanGoals(dbDir);
  }

  return {
    pulled: { imported: pullResult.imported, updated: pullResult.updated },
    pushed,
  };
}
