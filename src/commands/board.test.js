import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readCurrentBoard } from './board.js';

const paths = [];
afterEach(() => {
  for (const dir of paths.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('read-only board CLI contract', () => {
  it('reads the canonical Clips store from a checkout and a linked worktree', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-board-'));
    paths.push(repo);
    execFileSync('git', ['init', '-q', repo]);
    execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com']);
    execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# Sample');
    execFileSync('git', ['-C', repo, 'add', '.']);
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'Initial commit']);
    fs.mkdirSync(path.join(repo, '.clips', 'db'), { recursive: true });
    const first = readCurrentBoard(repo);
    expect(first).toMatchObject({ version: 1, lanes: [], goals: [], warnings: [] });

    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-board-worktree-'));
    fs.rmdirSync(worktree);
    paths.push(worktree);
    execFileSync('git', ['-C', repo, 'worktree', 'add', '-qb', 'test-worktree', worktree]);
    const linked = readCurrentBoard(worktree);
    expect(linked.goals).toEqual(first.goals);
    expect(linked.lanes).toEqual(first.lanes);
  });

  it('rejects directories that have not been initialized', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-no-board-'));
    paths.push(repo);
    execFileSync('git', ['init', '-q', repo]);
    expect(() => readCurrentBoard(repo)).toThrow(/lanes init/i);
  });
});
