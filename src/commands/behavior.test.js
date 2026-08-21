import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const tempDirs = [];

function createRepository() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-behavior-'));
  tempDirs.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  fs.mkdirSync(path.join(cwd, '.clips'), { recursive: true });
  fs.writeFileSync(
    path.join(cwd, '.clips', 'clips.config.json'),
    `${JSON.stringify({ collaboration: false })}\n`,
  );
  return cwd;
}

function runClips(cwd, args) {
  return execFileSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
}

afterEach(() => {
  for (const cwd of tempDirs.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('goal and task behavior fields', () => {
  it('stores behavior and resolves inherited and overridden modes', () => {
    const cwd = createRepository();
    runClips(cwd, ['goal', 'create', JSON.stringify({
      title: 'Manage to-dos',
      behavior: 'Feature: Manage to-dos',
      verification_mode: 'behavior_and_tests',
    })]);
    runClips(cwd, ['task', 'create', 'g001', JSON.stringify({
      title: 'Add to-dos',
      behavior: 'Scenario: Add a to-do',
    })]);
    runClips(cwd, ['task', 'create', 'g001', JSON.stringify({
      title: 'Describe empty state',
      verification_mode: 'behavior',
    })]);

    const goal = JSON.parse(runClips(cwd, ['goal', 'show', 'g001']));
    expect(goal).toMatchObject({
      behavior: 'Feature: Manage to-dos',
      verification_mode: 'behavior_and_tests',
    });
    expect(goal.tasks[0]).toMatchObject({
      behavior: 'Scenario: Add a to-do',
      effective_verification_mode: 'behavior_and_tests',
    });
    expect(goal.tasks[1]).toMatchObject({
      verification_mode: 'behavior',
      effective_verification_mode: 'behavior',
    });

    const goalView = runClips(cwd, ['view', 'g001']);
    expect(goalView).toContain('Verification: behavior + tests');
    expect(goalView).toContain('Feature: Manage to-dos');

    const taskView = runClips(cwd, ['view', '#g001#t01']);
    expect(taskView).toContain('Verification: behavior + tests');
    expect(taskView).toContain('Scenario: Add a to-do');
  });

  it('rejects unknown verification modes', () => {
    const cwd = createRepository();
    const result = spawnSync(process.execPath, [
      cliPath,
      'goal',
      'create',
      JSON.stringify({ title: 'Invalid goal', verification_mode: 'tdd' }),
    ], { cwd, encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Invalid verification_mode');
  });
});
