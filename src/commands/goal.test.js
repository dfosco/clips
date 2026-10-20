import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const tempDirs = [];

function createLinkedGoal() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-goal-'));
  tempDirs.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  fs.mkdirSync(path.join(cwd, '.clips', 'db'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.clips', 'records', 'cr'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.clips', 'clips.config.json'), `${JSON.stringify({ collaboration: false })}\n`);
  const events = [
    { event: 'goal_created', goal_id: 'g001', title: 'Linked goal', status: 'open' },
    { event: 'github_synced', goal_id: 'g001', issue_number: 42, issue_url: 'https://github.com/acme/app/issues/42' },
    { event: 'task_created', goal_id: 'g001', task_id: 't01', title: 'Linked task' },
    { event: 'task_github_synced', goal_id: 'g001', task_id: 't01', issue_number: 43, issue_url: 'https://github.com/acme/app/issues/43' },
  ];
  fs.writeFileSync(path.join(cwd, '.clips', 'db', 'g001.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
  return cwd;
}

function runClips(cwd, args, env = process.env) {
  return execFileSync(process.execPath, [cliPath, ...args], { cwd, env, encoding: 'utf8' });
}

function runClipsResult(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
}

function createWorkspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-goal-type-'));
  tempDirs.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  fs.mkdirSync(path.join(cwd, '.clips', 'db'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.clips', 'records', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.clips', 'clips.config.json'), `${JSON.stringify({ collaboration: false })}\n`);
  return cwd;
}

afterEach(() => {
  for (const cwd of tempDirs.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('goal unlink', () => {
  it('durably removes goal and task issue links without invoking GitHub', () => {
    const cwd = createLinkedGoal();
    const first = JSON.parse(runClips(cwd, ['goal', 'unlink', 'g001']));
    expect(first).toMatchObject({ success: true, goal_id: 'g001', unlinked: true, issue_number: 42 });

    const goal = JSON.parse(runClips(cwd, ['goal', 'show', 'g001']));
    expect(goal).toMatchObject({ goal_id: 'g001', github_unlinked: true });
    expect(goal.issue_number).toBeUndefined();
    expect(goal.tasks[0].issue_number).toBeUndefined();

    expect(goal.issue_url).toBeUndefined();
    expect(goal.tasks[0].issue_url).toBeUndefined();

    const eventPath = path.join(cwd, '.clips', 'db', 'g001.jsonl');
    const eventCount = fs.readFileSync(eventPath, 'utf8').trim().split('\n').length;
    expect(JSON.parse(runClips(cwd, ['goal', 'unlink', '#g001']))).toMatchObject({ unlinked: false });
    expect(fs.readFileSync(eventPath, 'utf8').trim().split('\n')).toHaveLength(eventCount);

    const binDir = path.join(cwd, 'bin');
    const markerPath = path.join(cwd, 'gh-called');
    fs.mkdirSync(binDir);
    fs.writeFileSync(path.join(binDir, 'gh'), `#!/bin/sh\nprintf called >> "${markerPath}"\nexit 1\n`);
    fs.chmodSync(path.join(binDir, 'gh'), 0o755);
    fs.writeFileSync(path.join(cwd, '.clips', 'clips.config.json'), `${JSON.stringify({ collaboration: true })}\n`);
    runClips(cwd, ['goal', 'update', 'g001', JSON.stringify({ title: 'Still local' })], {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
    });
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it('unlinks every linked goal and skips goals that are already local', () => {
    const cwd = createLinkedGoal();
    fs.writeFileSync(
      path.join(cwd, '.clips', 'db', 'g002.jsonl'),
      `${JSON.stringify({ event: 'goal_created', goal_id: 'g002', title: 'Local goal', status: 'open' })}\n`,
    );
    fs.writeFileSync(
      path.join(cwd, '.clips', 'db', 'g003.jsonl'),
      `${[
        { event: 'goal_created', goal_id: 'g003', title: 'Another linked goal', status: 'open' },
        { event: 'github_synced', goal_id: 'g003', issue_number: 44, issue_url: 'https://github.com/acme/app/issues/44' },
      ].map((event) => JSON.stringify(event)).join('\n')}\n`,
    );

    const result = JSON.parse(runClips(cwd, ['goal', 'unlink', '--all']));
    expect(result).toEqual({ success: true, unlinked: 2, goals: ['#g001', '#g003'] });
    expect(JSON.parse(runClips(cwd, ['goal', 'show', 'g001']))).toMatchObject({ github_unlinked: true });
    expect(JSON.parse(runClips(cwd, ['goal', 'show', 'g003']))).toMatchObject({ github_unlinked: true });
    expect(JSON.parse(runClips(cwd, ['goal', 'show', 'g002'])).github_unlinked).toBeUndefined();

    expect(JSON.parse(runClips(cwd, ['goal', 'unlink', '--all']))).toEqual({
      success: true,
      unlinked: 0,
      goals: [],
    });
  });
});

describe('legacy goal metadata in the unified work model', () => {
  it('allows either legacy goal label to contain tasks and close without an ADR', () => {
    const cwd = createWorkspace();
    for (const type of ['planning', 'building']) {
      const created = JSON.parse(runClips(cwd, ['goal', 'create', JSON.stringify({
        title: 'Choose and implement storage', type,
        plan: 'Compare the available stores, then implement the chosen boundary.',
        decisions: 'Use the existing local store.',
      })]));
      runClips(cwd, ['task', 'create', created.goal_id, JSON.stringify({ title: 'Compare stores' })]);
      expect(JSON.parse(runClips(cwd, ['goal', 'show', created.goal_id]))).toMatchObject({
        type, plan: 'Compare the available stores, then implement the chosen boundary.',
        decisions: 'Use the existing local store.', tasks: [{ title: 'Compare stores' }],
      });
      expect(JSON.parse(runClips(cwd, ['goal', 'status', created.goal_id, 'closed']))).toMatchObject({ status: 'closed' });
      expect(JSON.parse(runClips(cwd, ['goal', 'show', created.goal_id])).acceptance).toBeUndefined();
    }
  });

  it('preserves optional legacy ADR metadata across type changes', () => {
    const cwd = createWorkspace();
    const created = JSON.parse(runClips(cwd, ['goal', 'create', JSON.stringify({ title: 'Build the feature' })]));
    fs.writeFileSync(path.join(cwd, '.clips', 'records', 'adr', 'ADR-001-storage.md'), '# ADR-001: Storage\n');
    runClips(cwd, ['goal', 'attach-adr', created.goal_id, 'adr-001']);
    runClips(cwd, ['task', 'create', created.goal_id, JSON.stringify({ title: 'Implement' })]);
    runClips(cwd, ['goal', 'update', created.goal_id, JSON.stringify({ type: 'planning' })]);
    runClips(cwd, ['goal', 'update', created.goal_id, JSON.stringify({ type: 'building' })]);
    expect(JSON.parse(runClips(cwd, ['goal', 'show', created.goal_id]))).toMatchObject({ type: 'building', adr_id: 'ADR-001' });
  });

  it('retains legacy defaults and rejects accidental system-field mutation', () => {
    const cwd = createWorkspace();
    fs.writeFileSync(path.join(cwd, '.clips', 'db', 'g099.jsonl'), `${JSON.stringify({
      event: 'goal_created', goal_id: 'g099', title: 'Legacy goal', status: 'open',
    })}\n`);
    expect(JSON.parse(runClips(cwd, ['goal', 'show', 'g099'])).type).toBe('building');
    const invalid = runClipsResult(cwd, ['goal', 'create', JSON.stringify({ title: 'Invalid', type: 'research' })]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Invalid goal type 'research'");
    const updateStatus = runClipsResult(cwd, ['goal', 'update', 'g099', JSON.stringify({ status: 'closed' })]);
    expect(updateStatus.status).toBe(1);
    expect(updateStatus.stderr).toContain('Unsupported goal fields: status');
  });
});
