import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cli = path.resolve('src/cli.js');
const roots = [];
const flag = '--lane-max-active-agents';

function workspace({ git = true } = {}) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-config-cli-'));
  roots.push(cwd);
  if (git) execFileSync('git', ['init', '--quiet'], { cwd });
  fs.mkdirSync(path.join(cwd, '.clips'));
  return cwd;
}

function run(cwd, ...args) {
  return runCli(cwd, 'config', ...args);
}

function runCli(cwd, ...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, HOME: path.join(cwd, 'home-dir'), LANES_HOME: '', CLIPS_HOME: path.join(cwd, 'home') },
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Lane worker limit CLI', () => {
  it('documents the flag and persists numeric overrides through both interfaces', () => {
    const cwd = workspace();
    const configPath = path.join(cwd, '.lanes', 'lanes.config.json');
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

  it('reads and writes user model preferences outside Git, then resolves project overrides and inheritance', () => {
    const cwd = workspace({ git: false });
    const userConfig = path.join(cwd, 'home', 'lanes.config.json');
    expect(run(cwd, '--help').stdout).toContain('lanes config --user <model-key> [value]');
    expect(run(cwd, '--user', 'lane_dev_model', 'opaque-provider/model@revision')).toMatchObject({ status: 0, stderr: '' });
    expect(run(cwd, '--user', 'lane_dev_model').stdout).toBe('opaque-provider/model@revision\n');
    expect(run(cwd, 'lane_dev_model').status).toBe(1);
    expect(run(cwd, '--user', 'lane_manager_model').stdout).toBe('(not set)\n');
    expect(JSON.parse(fs.readFileSync(userConfig, 'utf8'))).toEqual({
      lane_dev_model: 'opaque-provider/model@revision',
    });
    expect(run(cwd, '--user', 'lane_dev_model', '--unset').status).toBe(0);
    expect(JSON.parse(fs.readFileSync(userConfig, 'utf8'))).toEqual({});
  });

  it('applies project > user > built-in defaults and removes overrides without pinning defaults', () => {
    const cwd = workspace();
    const userConfig = path.join(cwd, 'home', 'lanes.config.json');
    const projectConfig = path.join(cwd, '.lanes', 'lanes.config.json');
    expect(run(cwd, 'lane_manager_model').stdout).toBe('gpt-6.1-sol\n');
    expect(run(cwd, 'lane_manager_reasoning_effort').stdout).toBe('high\n');
    expect(run(cwd, 'lane_dev_model').stdout).toBe('gpt-6-luna\n');
    expect(run(cwd, 'lane_dev_reasoning_effort').stdout).toBe('high\n');

    expect(run(cwd, '--user', 'lane_dev_model', 'user-model').status).toBe(0);
    expect(run(cwd, 'lane_dev_model').stdout).toBe('user-model\n');
    expect(run(cwd, 'lane_dev_model', 'project-model').status).toBe(0);
    expect(run(cwd, 'lane_dev_model').stdout).toBe('project-model\n');
    expect(run(cwd, 'lane_dev_model', '--unset').status).toBe(0);
    expect(run(cwd, 'lane_dev_model').stdout).toBe('user-model\n');
    expect(run(cwd, '--user', 'lane_dev_model', '--unset').status).toBe(0);
    expect(run(cwd, 'lane_dev_model').stdout).toBe('gpt-6-luna\n');

    expect(run(cwd, 'collaboration', 'true').status).toBe(0);
    expect(runCli(cwd, 'init', '--store-only').status).toBe(0);
    const project = JSON.parse(fs.readFileSync(projectConfig, 'utf8'));
    expect(project.collaboration).toBe(true);
    expect(project).not.toHaveProperty('lane_manager_model');
    expect(project).not.toHaveProperty('lane_manager_reasoning_effort');
    expect(project).not.toHaveProperty('lane_dev_model');
    expect(project).not.toHaveProperty('lane_dev_reasoning_effort');
    expect(JSON.parse(fs.readFileSync(userConfig, 'utf8'))).toEqual({});
  });

  it('rejects invalid preference shapes and refuses malformed user config without overwriting', () => {
    const cwd = workspace({ git: false });
    expect(run(cwd, '--user', 'lane_dev_model', '').status).toBe(1);
    expect(run(cwd, '--user', 'lane_dev_model', '--unset').status).toBe(0);

    const userConfig = path.join(cwd, 'home', 'lanes.config.json');
    fs.writeFileSync(userConfig, '{"lane_dev_model":42}\n');
    const before = fs.readFileSync(userConfig, 'utf8');
    expect(run(cwd, '--user', 'lane_dev_model').status).toBe(1);
    expect(run(cwd, '--user', 'lane_dev_model', 'valid-model').status).toBe(1);
    expect(fs.readFileSync(userConfig, 'utf8')).toBe(before);

    fs.writeFileSync(userConfig, '[]\n');
    const malformed = fs.readFileSync(userConfig, 'utf8');
    expect(run(cwd, '--user', 'lane_dev_model', 'valid-model').status).toBe(1);
    expect(fs.readFileSync(userConfig, 'utf8')).toBe(malformed);
  });

  it('refuses unrelated project config updates when the stored JSON is malformed', () => {
    const cwd = workspace();
    const projectConfig = path.join(cwd, '.clips', 'clips.config.json');
    const malformed = '{"lane_dev_model":"saved-model",\n';
    fs.writeFileSync(projectConfig, malformed);

    const result = run(cwd, 'collaboration', 'true');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Could not read config file');
    expect(fs.readFileSync(projectConfig, 'utf8')).toBe(malformed);
  });
});
