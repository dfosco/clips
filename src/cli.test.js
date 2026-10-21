import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cli = path.resolve(process.cwd(), 'src/cli.js');
const tempDirs = [];

function run(...args) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-cli-'));
  tempDirs.push(cwd);
  return spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, LANES_HOME: '', CLIPS_HOME: path.join(cwd, 'home') },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('CLI command surface', () => {
  it('advertises retained commands without the retired web entrypoint', () => {
    const result = run('--help');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).not.toMatch(/^\s+(?:clips )?web\b/m);
    for (const command of ['init', 'dev', 'prod', 'view', 'history', 'goal', 'lane', 'task', 'component', 'record', 'sync', 'config']) {
      expect(result.stdout).toMatch(new RegExp(`^\\s+${command}\\b`, 'm'));
    }
  });

  it.each([
    ['web'],
    ['web', '--help'],
    ['web', '--host', '127.0.0.1', '--port', '0'],
  ])('rejects the removed command without launching a server: %j', (...args) => {
    const result = run(...args);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Unknown command: web');
  });

  it.each(['dev', 'prod'])('retains the %s installation-switching command', (command) => {
    const result = run(command, '--help');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Usage: lanes ${command}`);
  });
});
