import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cli = path.resolve('src/cli.js');
const roots = [];
const payload = { context: 'Final task context and exact checks for the manager.', agent_id: 'dev-1', manager_id: 'manager-1' };

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-handoff-cli-')));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const env = { ...process.env, LANES_HOME: path.join(root, 'user-store'), LANES_SWITCH_INIT: '1', CLIPS_SWITCH_INIT: '1' };
  const invoke = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8', ...options });
  for (const args of [
    ['init', '--store-only'], ['goal', 'create', '{"title":"Goal"}'],
    ['task', 'create', 'g1', '{"title":"Task"}'],
  ]) {
    const result = invoke(args);
    if (result.status !== 0) throw new Error(result.stderr);
  }
  return { root, env, invoke };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('handoff CLI', () => {
  it('supports JSON, file and stdin input with canonical Goal attachment readback', () => {
    const f = fixture();
    const file = path.join(f.root, 'handoff.json');
    fs.writeFileSync(file, JSON.stringify(payload));
    const calls = [
      { args: [JSON.stringify(payload)] },
      { args: ['--file', file] },
      { args: ['--stdin'], input: JSON.stringify(payload) },
    ];
    for (const call of calls) {
      const result = f.invoke(['handoff', 'record', '#g1#t1', ...call.args], { input: call.input });
      expect(result.status, result.stderr).toBe(0);
      const output = JSON.parse(result.stdout);
      expect(output).toMatchObject({ success: true, goal_ref: '#g001', source_ref: '#g001#t01', context: payload.context });
      const readback = f.invoke(['attachment', 'read', output.goal_ref, output.attachment.id]);
      expect(readback.status, readback.stderr).toBe(0);
      expect(JSON.parse(readback.stdout).attachment).toMatchObject({ status: 'available' });
      expect(JSON.parse(readback.stdout).attachment.content).toContain(payload.context);
    }
    const goal = JSON.parse(f.invoke(['view', '#g1', '--json']).stdout);
    expect(goal.attachments).toHaveLength(3);
    expect(goal.status).toBe('open');
    expect(goal.tasks.t01.status).toBe('open');
  });

  it('uses the common store from a linked worktree and preserves exact retry identity', () => {
    const f = fixture();
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'fixture'], { cwd: f.root });
    const worktree = path.join(f.root, 'linked-worktree');
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree], { cwd: f.root });
    const request = { ...payload, handoff_id: '79dc0cc2-4fd7-4394-9794-95965075f390' };
    const created = f.invoke(['handoff', 'record', '#g1#t1', JSON.stringify(request)], { cwd: worktree });
    expect(created.status, created.stderr).toBe(0);
    const output = JSON.parse(created.stdout);
    expect(fs.existsSync(path.join(f.root, output.attachment.path))).toBe(true);
    expect(fs.existsSync(path.join(worktree, '.lanes'))).toBe(false);
    const retry = f.invoke(['handoff', 'record', '#g001#t01', JSON.stringify(request)]);
    expect(retry.status, retry.stderr).toBe(0);
    expect(JSON.parse(retry.stdout)).toEqual(output);
    const readback = f.invoke(['attachment', 'read', '#g1', output.attachment.id], { cwd: worktree });
    expect(JSON.parse(readback.stdout).attachment.content).toContain(payload.context);
  });

  it('advertises the command and rejects bad argument shapes without success output', () => {
    const f = fixture();
    expect(f.invoke(['--help']).stdout).toMatch(/^\s+handoff record/m);
    expect(f.invoke(['handoff', '--help']).stdout).toContain('does not prove');
    for (const args of [
      ['handoff', 'record'], ['handoff', 'record', '#g1'], ['handoff', 'fold', '#g1'],
      ['handoff', 'record', '#g1', '{invalid}'],
      ['handoff', 'record', '#g1', JSON.stringify(payload), '--extra'],
    ]) {
      const failed = f.invoke(args);
      expect(failed.status).toBe(1);
      expect(failed.stdout).toBe('');
      expect(failed.stderr).toContain('lanes handoff:');
    }
  });
});
