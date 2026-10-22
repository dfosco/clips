import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBoardData } from '../lib/board.js';
import { readRecordAttachment } from '../lib/attachments.js';

const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const tempDirs = [];

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-attachments-'));
  tempDirs.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  fs.mkdirSync(path.join(root, '.clips', 'db'), { recursive: true });
  fs.mkdirSync(path.join(root, '.clips', 'records', 'cr'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), '{"collaboration":false}\n');
  const env = {
    ...process.env,
    HOME: path.join(root, 'home'),
    LANES_HOME: path.join(root, 'home', '.lanes'),
    CLIPS_HOME: path.join(root, 'home', '.clips'),
    CLIPS_SWITCH_INIT: '1',
    LANES_SWITCH_INIT: '1',
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  return { root, env };
}

function run(root, env, ...args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: root, env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function failed(root, env, ...args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd: root, env, encoding: 'utf8' });
}

function appendEvent(file, event) {
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
}

function board(root) {
  const dbDir = path.join(root, '.clips', 'db');
  return readBoardData({
    dbDir,
    recordsDir: path.join(root, '.clips', 'records', 'cr'),
    componentsDir: path.join(root, '.clips', 'components'),
    projectPath: root,
    claimsDir: path.join(root, '.claims'),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('first-class live attachments', () => {
  it('attaches, reads, histories, and detaches references on Lanes, Goals, and Tasks without syncing', () => {
    const { root, env } = workspace();
    const planPath = path.join(root, 'docs', 'plan.md');
    fs.mkdirSync(path.dirname(planPath));
    fs.writeFileSync(planPath, '# Initial plan\n');
    run(root, env, 'lane', 'create', '{"title":"Lane"}');
    run(root, env, 'goal', 'create', JSON.stringify({
      title: 'Goal',
      lane_id: 'l001',
      sections: { 'Existing context': 'Keep this note.' },
      extensions: { custom: { keep: true } },
    }));
    run(root, env, 'task', 'create', 'g001', JSON.stringify({
      title: 'Task',
      extensions: { task_context: { keep: true } },
    }));

    const binDir = path.join(root, 'bin');
    const marker = path.join(root, 'gh-called');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'gh'), `#!/bin/sh\nprintf called >> "${marker}"\nexit 1\n`);
    fs.chmodSync(path.join(binDir, 'gh'), 0o755);
    env.PATH = `${binDir}:${env.PATH}`;
    const configPath = path.join(root, '.clips', 'clips.config.json');
    fs.writeFileSync(configPath, '{"collaboration":true}\n');
    const collaborationConfig = fs.readFileSync(configPath, 'utf8');

    const input = JSON.stringify({ type: 'markdown', path: 'docs/plan.md', title: 'Plan', purpose: 'cr' });
    const lane = run(root, env, 'attachment', 'add', '#l1', input);
    const goal = run(root, env, 'attachment', 'add', '#g1', input);
    const task = run(root, env, 'attachment', 'add', '#g1#t1', JSON.stringify({
      type: 'markdown', path: 'docs/plan.md', title: 'Plan', purpose: 'cr', expected_revision: 1,
    }));
    expect(failed(root, env, 'attachment', 'read', '#g1', '/etc/passwd').stderr).toContain('not found');
    const secondTask = run(root, env, 'attachment', 'add', '#g1#t1', JSON.stringify({
      type: 'url', url: 'https://example.test/task-context',
    }));
    expect(new Set([lane.attachment.id, goal.attachment.id, task.attachment.id]).size).toBe(3);
    const taskAttachments = run(root, env, 'attachment', 'list', '#g1#t1');
    expect(taskAttachments.revision).toBe(3);
    expect(taskAttachments.attachments[0]).toMatchObject({
      id: task.attachment.id, type: 'markdown', path: 'docs/plan.md', purpose: 'cr',
    });
    expect(taskAttachments.attachments).toHaveLength(2);
    expect(run(root, env, 'view', '#g1', '--json').attachments[0]).toMatchObject({
      id: goal.attachment.id, type: 'markdown', path: 'docs/plan.md', purpose: 'cr',
    });
    expect(run(root, env, 'goal', 'show', 'g1')).toMatchObject({
      sections: { 'Existing context': 'Keep this note.' },
      extensions: { custom: { keep: true } },
    });
    expect(run(root, env, 'view', '#l1', '--json').attachments[0]).toMatchObject({
      id: lane.attachment.id, type: 'markdown', path: 'docs/plan.md', purpose: 'cr',
    });
    expect(run(root, env, 'lane', 'history', '#l1', '--json').at(-1)).toMatchObject({
      event: 'attachment_added', attachment: { id: lane.attachment.id },
    });
    expect(run(root, env, 'history', '#g1', '--json').find((event) => event.attachment?.id === goal.attachment.id)).toMatchObject({
      event: 'attachment_added',
    });

    fs.writeFileSync(planPath, '# Updated plan\n');
    const current = run(root, env, 'attachment', 'read', '#g1#t1', task.attachment.id);
    expect(current.attachment).toMatchObject({
      status: 'available',
      content: '# Updated plan\n',
      content_semantics: 'current_file',
    });
    const historical = run(root, env, 'attachment', 'read', '#g1#t1#r2', task.attachment.id);
    expect(historical.attachment.content).toBe('# Updated plan\n');
    expect(historical.attachment.content_semantics).toBe('current_file');

    const taskHistory = run(root, env, 'history', '#g1#t1', '--json');
    const added = taskHistory.find((event) => event.event === 'attachment_added');
    expect(added.attachment).toMatchObject({ id: task.attachment.id, path: 'docs/plan.md' });
    expect(added).not.toHaveProperty('content');

    const stale = failed(root, env, 'attachment', 'detach', '#g1#t1', task.attachment.id, '--expected-revision', '1');
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain('Revision conflict');
    expect(run(root, env, 'attachment', 'detach', '#g1#t1', task.attachment.id)).toMatchObject({
      success: true, attachment_id: task.attachment.id, revision: 4,
    });
    expect(run(root, env, 'attachment', 'read', '#g1#t1#r2', task.attachment.id).attachment.content).toBe('# Updated plan\n');
    expect(failed(root, env, 'attachment', 'read', '#g1#t1', task.attachment.id).stderr).toContain('not found');
    expect(run(root, env, 'attachment', 'list', '#g1#t1').attachments.map((attachment) => attachment.id)).toEqual([secondTask.attachment.id]);
    expect(fs.readFileSync(planPath, 'utf8')).toBe('# Updated plan\n');
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(collaborationConfig);

    const currentBoard = board(root);
    expect(currentBoard.lanes[0].attachments[0]).toMatchObject({ id: lane.attachment.id, content: '# Updated plan\n' });
    expect(currentBoard.goals[0].attachments[0]).toMatchObject({ id: goal.attachment.id, content: '# Updated plan\n' });
    expect(currentBoard.goals[0].tasks[0].attachments[0]).toMatchObject({ id: secondTask.attachment.id, status: 'remote' });
    expect(currentBoard.lanes[0].attachments[0]).not.toHaveProperty('path');
    run(root, env, 'attachment', 'detach', '#g1', goal.attachment.id);
    run(root, env, 'attachment', 'detach', '#l1', lane.attachment.id);
    expect(run(root, env, 'attachment', 'list', '#g1').attachments).toEqual([]);
    expect(run(root, env, 'attachment', 'list', '#l1').attachments).toEqual([]);
    expect(fs.readFileSync(planPath, 'utf8')).toBe('# Updated plan\n');
  });

  it('keeps deleted references attached and reports missing and permission-denied reads separately', () => {
    const { root, env } = workspace();
    const planPath = path.join(root, 'temporary.md');
    fs.writeFileSync(planPath, '# Temporary\n');
    run(root, env, 'goal', 'create', '{"title":"Goal"}');
    const attached = run(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'markdown', path: 'temporary.md',
    }));
    fs.unlinkSync(planPath);
    expect(run(root, env, 'attachment', 'read', '#g1', attached.attachment.id).attachment).toMatchObject({
      status: 'missing', content: null,
    });
    expect(run(root, env, 'attachment', 'list', '#g1').attachments).toHaveLength(1);
    expect(board(root).goals[0].attachments[0]).toMatchObject({ status: 'missing', content: null });

    const record = run(root, env, 'goal', 'show', 'g1');
    const readFile = fs.readFileSync;
    const permission = Object.assign(new Error('denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
      if (String(file) === planPath) throw permission;
      return readFile.call(fs, file, ...args);
    });
    expect(readRecordAttachment(record, attached.attachment.id, { repoRoot: root })).toMatchObject({
      status: 'unreadable', error: 'Permission denied while reading the attached Markdown file.',
    });
  });

  it('validates typed remote identities and preserves host and repository distinctions without fetching', () => {
    const { root, env } = workspace();
    run(root, env, 'goal', 'create', '{"title":"Goal"}');
    const ghe = run(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'github_issue', url: 'https://git.example.test/acme/app/issues/12',
    }));
    const github = run(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'github_issue', url: 'https://github.com/acme/app/issues/12',
    }));
    const pull = run(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'github_pr', url: 'https://git.example.test/acme/other/pull/12', purpose: 'adr',
    }));
    run(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'url', url: 'http://docs.example.test/design',
    }));
    expect(ghe.attachment).toMatchObject({ host: 'git.example.test', repository: 'acme/app', number: 12 });
    expect(github.attachment.host).toBe('github.com');
    expect(pull.attachment).toMatchObject({ type: 'github_pr', repository: 'acme/other', number: 12, purpose: 'adr' });
    expect(new Set([ghe.attachment.id, github.attachment.id, pull.attachment.id]).size).toBe(3);
    expect(run(root, env, 'attachment', 'read', '#g1', ghe.attachment.id).attachment).toMatchObject({
      status: 'remote', content: null, content_semantics: 'not_fetched',
    });
    expect(failed(root, env, 'attachment', 'add', '#g1', '{"type":"url","url":"javascript:alert(1)"}').status).not.toBe(0);
    expect(failed(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'github_issue', url: 'https://github.com/acme/app/issues/12', repository: 'acme/elsewhere',
    })).status).not.toBe(0);
    expect(failed(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'github_pr', url: 'https://github.com/acme/app/issues/12',
    })).status).not.toBe(0);
    expect(failed(root, env, 'attachment', 'add', '#g1', JSON.stringify({
      type: 'url', url: 'https://example.test/cr', purpose: 'decision',
    })).stderr).toContain('purpose must be cr or adr');
  });

  it('projects legacy GitHub issue and PR fields as read-only typed attachments', () => {
    const { root, env } = workspace();
    run(root, env, 'lane', 'create', '{"title":"Lane"}');
    run(root, env, 'goal', 'create', '{"title":"Goal","lane_id":"l1"}');
    run(root, env, 'task', 'create', 'g1', '{"title":"Task"}');
    appendEvent(path.join(root, '.clips', 'db', 'tracks', 'r001.jsonl'), {
      event: 'lane_github_synced', lane_id: 'l001', issue_number: 5,
      issue_url: 'https://git.example.test/acme/app/issues/5',
    });
    const goalPath = path.join(root, '.clips', 'db', 'g001.jsonl');
    appendEvent(goalPath, {
      event: 'github_synced', goal_id: 'g001', issue_number: 6,
      issue_url: 'https://git.example.test/acme/app/issues/6',
    });
    appendEvent(goalPath, {
      event: 'task_github_synced', goal_id: 'g001', task_id: 't01', issue_number: 7,
      issue_url: 'https://git.example.test/acme/app/issues/7',
    });
    appendEvent(goalPath, {
      event: 'github_pr_synced', goal_id: 'g001', repository: 'acme/app', pr_number: 8,
      url: 'https://git.example.test/acme/app/pull/8', title: 'Legacy PR',
    });

    expect(run(root, env, 'attachment', 'list', '#l1').attachments[0]).toMatchObject({
      type: 'github_issue', number: 5, source: 'legacy',
    });
    expect(run(root, env, 'view', '#g1#t1', '--json').attachments[0]).toMatchObject({
      type: 'github_issue', number: 7, source: 'legacy',
    });
    expect(run(root, env, 'view', '#g1', '--json').attachments.map((attachment) => attachment.type)).toEqual([
      'github_issue', 'github_pr',
    ]);
    const currentBoard = board(root);
    expect(currentBoard.lanes[0].attachments[0]).toMatchObject({ type: 'github_issue', number: 5 });
    expect(currentBoard.goals[0].attachments.map((attachment) => attachment.type)).toEqual(['github_issue', 'github_pr']);
    const legacyId = currentBoard.goals[0].attachments[0].id;
    expect(failed(root, env, 'attachment', 'detach', '#g1', legacyId).stderr).toContain('read-only');
  });

  it('does not reopen accepted Goal or Task agreements when attachments change', () => {
    const { root, env } = workspace();
    fs.writeFileSync(path.join(root, 'acceptance.md'), '# Accepted result\n');
    run(root, env, 'goal', 'create', JSON.stringify({
      title: 'Accepted Goal',
      acceptance_criteria: ['Goal result is delivered'],
    }));
    run(root, env, 'task', 'create', 'g1', JSON.stringify({
      title: 'Accepted Task',
      acceptance_criteria: ['Task result is delivered'],
    }));
    run(root, env, 'task', 'accept', 'g1', 't1', JSON.stringify({
      artifact: 'source tree',
      accepted_by: 'test-agent',
      summary: 'Task result verified',
      criteria: [{ id: 'A1', status: 'satisfied', evidence: 'The task output is present.' }],
    }));
    run(root, env, 'goal', 'accept', 'g1', JSON.stringify({
      artifact: 'source tree',
      accepted_by: 'test-agent',
      summary: 'Goal result verified',
      criteria: [{ id: 'A1', status: 'satisfied', evidence: 'The goal output is present.' }],
    }));

    run(root, env, 'attachment', 'add', '#g1', JSON.stringify({ type: 'markdown', path: 'acceptance.md' }));
    run(root, env, 'attachment', 'add', '#g1#t1', JSON.stringify({ type: 'markdown', path: 'acceptance.md' }));
    const accepted = run(root, env, 'goal', 'show', 'g1');
    expect(accepted).toMatchObject({ status: 'closed', acceptance: { summary: 'Goal result verified' } });
    expect(accepted.tasks[0]).toMatchObject({ status: 'closed', acceptance: { summary: 'Task result verified' } });
  });

  it('supports namespaced records and explicit external paths through record-scoped IDs', () => {
    const { root, env } = workspace();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-external-'));
    tempDirs.push(outside);
    const externalFile = path.join(outside, 'artifact.md');
    fs.writeFileSync(externalFile, '# External artifact\n');
    fs.mkdirSync(path.join(root, '.clips', 'db', 'alice'), { recursive: true });
    fs.writeFileSync(path.join(root, '.clips', 'db', 'alice', 'g009.jsonl'), [
      { event: 'goal_created', goal_id: 'g009', title: 'Namespaced goal', status: 'open' },
      { event: 'task_created', goal_id: 'g009', task_id: 't01', title: 'Namespaced task', status: 'open' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n');
    const added = run(root, env, 'attachment', 'add', '#alice#g009', JSON.stringify({
      type: 'markdown', path: externalFile,
    }));
    expect(added.attachment.path).toBe(externalFile);
    expect(run(root, env, 'attachment', 'read', '#alice#g009', added.attachment.id).attachment.content).toBe('# External artifact\n');
    const taskAdded = run(root, env, 'attachment', 'add', '#alice#g009#t1', JSON.stringify({
      type: 'markdown', path: externalFile,
    }));
    expect(run(root, env, 'attachment', 'read', '#alice#g009#t1', taskAdded.attachment.id).attachment.content).toBe('# External artifact\n');
    expect(run(root, env, 'history', '#alice#g009', '--json')).toHaveLength(4);
    expect(run(root, env, 'history', '#alice#g009#t1', '--json')).toHaveLength(2);
  });

  it('fails explicitly when an attachment journal entry is corrupt', () => {
    const { root, env } = workspace();
    run(root, env, 'goal', 'create', '{"title":"Goal"}');
    run(root, env, 'attachment', 'add', '#g1', '{"type":"url","url":"https://example.test/design"}');
    const journal = path.join(root, '.clips', 'db', 'g001.jsonl');
    const events = fs.readFileSync(journal, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    events.at(-1).attachment.type = 'unsupported';
    fs.writeFileSync(journal, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
    expect(failed(root, env, 'attachment', 'list', '#g1').stderr).toContain('Corrupt attachment state');
  });
});
