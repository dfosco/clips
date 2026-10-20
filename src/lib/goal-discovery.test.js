import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverGoals } from './goal-discovery.js';

const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('discoverGoals', () => {
  it('discovers legacy and namespaced records while excluding reserved journals', () => {
    const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-discovery-'));
    tempDirs.push(dbDir);
    for (const file of [
      'g002.jsonl', 'g001.jsonl', 'notepad.jsonl', '_github.jsonl',
      'alice/g003.jsonl', 'alice/notepad.jsonl', 'alice/_github.jsonl',
      'tracks/g004.jsonl', 'lanes/g005.jsonl', '.hidden/g006.jsonl',
    ]) {
      const target = path.join(dbDir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, '{}\n');
    }

    const expected = [
      [null, 'g001'], [null, 'g002'], ['alice', 'g003'], ['alice', 'notepad'],
    ].map(([username, goalId]) => ({
      username, goalId, filePath: path.join(dbDir, username || '', `${goalId}.jsonl`),
    }));
    expect(discoverGoals(dbDir)).toEqual(expected);
  });

  it('returns no goals when the store is absent', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-discovery-'));
    tempDirs.push(root);
    expect(discoverGoals(path.join(root, 'missing'))).toEqual([]);
  });
});
