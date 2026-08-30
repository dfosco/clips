import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { setupGitExclude } from './init.js';

const tempDirs = [];
const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');

function createGitRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-init-'));
  tempDirs.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  return cwd;
}

afterEach(() => {
  for (const cwd of tempDirs.splice(0)) {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

describe('setupGitExclude', () => {
  it('adds .clips to the repository-local Git exclude file', () => {
    const cwd = createGitRepo();

    expect(setupGitExclude(cwd)).toBe(true);

    const excludePath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd,
      encoding: 'utf8'
    }).trim();
    expect(fs.readFileSync(path.resolve(cwd, excludePath), 'utf8')).toContain('.clips\n');
  });

  it('does not add a duplicate entry on repeated initialization', () => {
    const cwd = createGitRepo();

    expect(setupGitExclude(cwd)).toBe(true);
    expect(setupGitExclude(cwd)).toBe(false);

    const excludePath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd,
      encoding: 'utf8'
    }).trim();
    const content = fs.readFileSync(path.resolve(cwd, excludePath), 'utf8');
    expect(content.match(/^\.clips$/gm)).toHaveLength(1);
    expect(content).not.toContain('.dots');
  });

  it('initializes local-only and never invokes GitHub during init or sync', () => {
    const cwd = createGitRepo();
    const binDir = path.join(cwd, 'bin');
    const markerPath = path.join(cwd, 'gh-called');
    const ghPath = path.join(binDir, 'gh');
    fs.mkdirSync(binDir);
    fs.writeFileSync(ghPath, `#!/bin/sh\nprintf called >> "${markerPath}"\nprintf '[]\\n'\n`);
    fs.chmodSync(ghPath, 0o755);
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, CLIPS_HOME: path.join(cwd, 'system-clips') };

    execFileSync(process.execPath, [cliPath, 'init'], { cwd, env });

    const config = JSON.parse(fs.readFileSync(path.join(cwd, '.clips', 'clips.config.json'), 'utf8'));
    expect(config.collaboration).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.clips', 'records', 'cr'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.clips', 'records', 'adr'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.clips', 'records', 'fdr'))).toBe(true);
    expect(fs.existsSync(markerPath)).toBe(false);

    execFileSync(process.execPath, [cliPath, 'goal', 'create', JSON.stringify({ title: 'Local goal' })], { cwd, env });
    execFileSync(process.execPath, [cliPath, 'task', 'create', 'g001', JSON.stringify({ title: 'Local task' })], { cwd, env });
    expect(fs.existsSync(markerPath)).toBe(false);

    const syncOutput = execFileSync(process.execPath, [cliPath, 'sync'], { cwd, env, encoding: 'utf8' });
    expect(syncOutput).toContain('GitHub sync disabled');
    expect(fs.existsSync(markerPath)).toBe(false);

    fs.writeFileSync(
      path.join(cwd, '.clips', 'clips.config.json'),
      `${JSON.stringify({ ...config, collaboration: 'false' })}\n`,
    );
    execFileSync(process.execPath, [cliPath, 'sync'], { cwd, env });
    expect(fs.existsSync(markerPath)).toBe(false);
  });
});
