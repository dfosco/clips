import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cli = path.resolve('src/cli.js');
const roots = [];
const flag = '--lane-max-active-agents';

function workspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-config-cli-'));
  roots.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  fs.mkdirSync(path.join(cwd, '.clips'));
  return cwd;
}

function run(cwd, ...args) {
  return spawnSync(process.execPath, [cli, 'config', ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, CLIPS_HOME: path.join(cwd, 'home') },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Lane worker limit CLI', () => {
  it('documents the flag and persists numeric overrides through both interfaces', () => {
    const cwd = workspace();
    const configPath = path.join(cwd, '.clips', 'clips.config.json');
    expect(run(cwd, '--help')).toMatchObject({ status: 0, stderr: '' });
    expect(run(cwd, '--help').stdout).toContain('--lane-max-active-agents <N>');
    expect(run(cwd, 'lane_max_active_agents')).toMatchObject({ status: 0, stdout: '5\n' });
    expect(fs.existsSync(configPath)).toBe(false);
    expect(run(cwd, flag, '3').status).toBe(0);
    expect(run(cwd, 'lane_max_active_agents').stdout).toBe('3\n');
    expect(run(cwd, 'lane_max_active_agents', '7').status).toBe(0);
    expect(JSON.parse(fs.readFileSync(configPath, 'utf8')).lane_max_active_agents).toBe(7);
    expect(run(cwd).stdout).toContain('lane_max_active_agents: 7');
    expect(run(cwd, 'collaboration', 'true').status).toBe(0);
    expect(run(cwd, 'collaboration').stdout).toBe('true\n');
  });

  it.each([
    [flag], [flag, '0'], [flag, '-1'], [flag, '1.5'], [flag, 'abc'], [flag, ''],
    [flag, '4', 'extra'], [flag, '4', flag, '3'], [`${flag}=4`],
    ['collaboration', 'true', flag, '3'],
  ].map((args) => [args]))('rejects invalid flag forms without modifying configuration: %j', (args) => {
    const cwd = workspace();
    const file = path.join(cwd, '.clips', 'clips.config.json');
    const before = '{"username":"keep-me","custom":{"keep":true},"lane_max_active_agents":2}\n';
    fs.writeFileSync(file, before);
    const result = run(cwd, ...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/positive|Usage:|Unknown config option/);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('fails visibly on invalid stored limits and repairs only the requested value', () => {
    const cwd = workspace();
    const file = path.join(cwd, '.clips', 'clips.config.json');
    fs.writeFileSync(file, '{"lane_max_active_agents":0,"custom":"keep"}\n');
    expect(run(cwd, 'lane_max_active_agents')).toMatchObject({ status: 1, stdout: '' });
    expect(run(cwd).stderr).toContain('positive safe integer');
    expect(run(cwd, flag, '2').status).toBe(0);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ lane_max_active_agents: 2, custom: 'keep' });
  });
});
