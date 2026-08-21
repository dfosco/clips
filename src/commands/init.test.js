import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { setupGitExclude } from './init.js';

const tempDirs = [];

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
});
