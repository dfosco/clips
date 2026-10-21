import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const syncModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'src', 'lib', 'sync.js')).href;
const coreModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'src', 'lib', 'core.js')).href;
const tempDirs = [];

function createWorkspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-sync-type-'));
  tempDirs.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/app.git'], { cwd });
  vi.stubEnv('HOME', path.join(cwd, 'home'));
  vi.stubEnv('LANES_HOME', path.join(cwd, 'home', '.lanes'));
  vi.stubEnv('CLIPS_HOME', path.join(cwd, 'home', '.clips'));
  fs.mkdirSync(path.join(cwd, 'home'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.clips', 'db'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.clips', 'records', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.clips', 'clips.config.json'), `${JSON.stringify({ collaboration: false })}\n`);
  return cwd;
}

function importIssue(cwd, issue) {
  execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { importIssue } from ${JSON.stringify(syncModuleUrl)}; importIssue(${JSON.stringify(issue)});`,
  ], { cwd });
}

function showGoal(cwd, goalId) {
  return JSON.parse(execFileSync(process.execPath, [cliPath, 'goal', 'show', goalId], { cwd, encoding: 'utf8' }));
}

function readGoal(cwd, goalId, options = {}) {
  const source = `import { readGoalWithTasks } from ${JSON.stringify(coreModuleUrl)}; console.log(JSON.stringify(readGoalWithTasks(${JSON.stringify(goalId)}, null, ${JSON.stringify(options)})));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], { cwd, encoding: 'utf8' }));
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const cwd of tempDirs.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('typed goal issue import', () => {
  it('imports an explicit task section for either legacy type without requiring an ADR', () => {
    const cwd = createWorkspace();
    importIssue(cwd, {
      number: 3, title: 'Plan and deliver',
      body: '## Goal Type\n\n`planning`\n\n- [ ] A planning note\n\n## Tasks\n\n- [x] Deliver the agreed change\n\n---\nfooter',
      state: 'CLOSED', createdAt: '2026-10-11T00:00:00Z',
    });
    const goal = showGoal(cwd, 'g001');
    expect(goal.tasks).toHaveLength(1);
    expect(goal.tasks[0]).toMatchObject({ title: 'Deliver the agreed change', status: 'closed' });
    expect(goal.acceptance).toBeUndefined();
  });

  it('preserves planning metadata without importing checkboxes as tasks', () => {
    const cwd = createWorkspace();
    importIssue(cwd, {
      number: 1,
      title: 'Choose storage',
      body: '## Goal Type\n\n`planning`\n\n## ADR\n\n`ADR-004`\n\n- [ ] Compare databases',
      state: 'CLOSED',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T01:00:00.000Z',
    });

    expect(showGoal(cwd, 'g001')).toMatchObject({
      type: 'planning',
      adr_id: 'ADR-004',
      status: 'closed',
      tasks: [],
    });

    fs.writeFileSync(path.join(cwd, '.clips', 'records', 'adr', 'ADR-004-storage.md'), '# ADR-004: Storage\n');
    execFileSync(process.execPath, [cliPath, 'goal', 'status', 'g001', 'closed'], { cwd });
    expect(showGoal(cwd, 'g001').status).toBe('closed');
  });

  it('imports administrative closure independently of task acceptance', () => {
    const cwd = createWorkspace();
    importIssue(cwd, {
      number: 1,
      title: 'Empty build',
      body: '## Goal Type\n\n`building`',
      state: 'CLOSED',
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    importIssue(cwd, {
      number: 2,
      title: 'Build import',
      body: '## Goal Type\n\n`building`\n\n- [x] Implement importer',
      state: 'CLOSED',
      createdAt: '2026-08-31T00:00:00.000Z',
    });

    expect(showGoal(cwd, 'g001').status).toBe('closed');
    expect(showGoal(cwd, 'g001').acceptance).toBeUndefined();
    expect(showGoal(cwd, 'g002')).toMatchObject({ type: 'building', status: 'closed' });
    expect(showGoal(cwd, 'g002').tasks).toHaveLength(1);
  });

  it('reopens a remotely closed issue when the local goal is open but incomplete', () => {
    const cwd = createWorkspace();
    fs.writeFileSync(path.join(cwd, '.clips', 'clips.config.json'), `${JSON.stringify({ collaboration: true })}\n`);
    fs.writeFileSync(path.join(cwd, '.clips', 'db', 'g001.jsonl'), `${[
      { event: 'goal_created', goal_id: 'g001', title: 'Choose storage', type: 'planning', status: 'open' },
      { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://github.com/acme/app/issues/7' },
    ].map((event) => JSON.stringify(event)).join('\n')}\n`);
    const binDir = path.join(cwd, 'bin');
    const markerPath = path.join(cwd, 'gh-calls');
    fs.mkdirSync(binDir);
    const ghPath = path.join(binDir, 'gh');
    fs.writeFileSync(ghPath, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MARKER_PATH"\ncase "$*" in\n  "api repos/acme/app/issues/7") printf \'{"id":7,"state":"CLOSED"}\\n\';;\n  "api repos/acme/app/issues/7/parent") echo "gh: Not Found (HTTP 404)" >&2; exit 1;;\nesac\n');
    fs.chmodSync(ghPath, 0o755);

    execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import { pushGoal } from ${JSON.stringify(syncModuleUrl)}; pushGoal('g001');`,
    ], {
      cwd,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, MARKER_PATH: markerPath },
    });

    expect(fs.readFileSync(markerPath, 'utf8')).toContain('issue reopen 7');
  });

  it('preserves remote repository identity in current and historical Goal and Task replay', () => {
    const cwd = createWorkspace();
    const file = path.join(cwd, '.clips', 'db', 'g001.jsonl');
    fs.writeFileSync(file, [
      { event: 'goal_created', goal_id: 'g001', title: 'Goal', status: 'open' },
      { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://git.example.test/acme/app/issues/7', repository: 'acme/app', remote_host: 'git.example.test' },
      { event: 'task_created', goal_id: 'g001', task_id: 't01', title: 'Task', status: 'open' },
      { event: 'task_github_synced', goal_id: 'g001', task_id: 't01', issue_number: 8, issue_url: 'https://git.example.test/acme/app/issues/8', repository: 'acme/app', remote_host: 'git.example.test' },
    ].map(JSON.stringify).join('\n') + '\n');

    const current = readGoal(cwd, 'g001');
    expect(current).toMatchObject({ repository: 'acme/app', remote_host: 'git.example.test' });
    expect(current.tasks.t01).toMatchObject({ repository: 'acme/app', remote_host: 'git.example.test' });
    expect(readGoal(cwd, 'g001', { revision: 2 })).toMatchObject({
      repository: 'acme/app', remote_host: 'git.example.test',
    });
    expect(readGoal(cwd, 'g001', { taskId: 't01', taskRevision: 2 }).tasks.t01).toMatchObject({
      repository: 'acme/app', remote_host: 'git.example.test',
    });

    fs.writeFileSync(path.join(cwd, '.clips', 'db', 'g002.jsonl'), [
      { event: 'goal_created', goal_id: 'g002', title: 'Legacy', status: 'open' },
      { event: 'github_synced', goal_id: 'g002', issue_number: 9, issue_url: '' },
    ].map(JSON.stringify).join('\n') + '\n');
    const legacyGoal = readGoal(cwd, 'g002');
    expect(legacyGoal.issue_number).toBe(9);
    expect(legacyGoal.repository).toBeUndefined();
    expect(legacyGoal.remote_host).toBeUndefined();
  });

  it('replays same-number pull requests from separate hosts without collapsing them', () => {
    const cwd = createWorkspace();
    const events = [
      { event: 'goal_created', goal_id: 'g001', title: 'Goal', status: 'open' },
      {
        event: 'github_pr_synced',
        repository: 'acme/app',
        remote_host: 'github.com',
        pr_number: 12,
        title: 'Public',
        url: 'https://github.com/acme/app/pull/12',
      },
      {
        event: 'github_pr_synced',
        repository: 'acme/app',
        remote_host: 'git.example.test',
        pr_number: 12,
        title: 'Enterprise',
        url: 'https://git.example.test/acme/app/pull/12',
      },
    ];
    fs.writeFileSync(path.join(cwd, '.clips', 'db', 'g001.jsonl'), `${events.map(JSON.stringify).join('\n')}\n`);

    expect(Object.values(readGoal(cwd, 'g001').github_prs).map((pr) => pr.title).sort()).toEqual(['Enterprise', 'Public']);
  });
});
