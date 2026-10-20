import fs from 'node:fs';
import path from 'node:path';
import { getClipsDbDir } from './core.js';

export function discoverGoals(dbDir = getClipsDbDir()) {
  if (!fs.existsSync(dbDir)) return [];

  const entries = fs.readdirSync(dbDir, { withFileTypes: true });
  const discovered = [];

  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith('g') && entry.name.endsWith('.jsonl')) {
      discovered.push({ username: null, goalId: entry.name.slice(0, -'.jsonl'.length), filePath: path.join(dbDir, entry.name) });
      continue;
    }

    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'tracks' || entry.name === 'lanes') continue;
    const userDir = path.join(dbDir, entry.name);
    for (const file of fs.readdirSync(userDir)) {
      if (!file.startsWith('_') && file.endsWith('.jsonl')) {
        discovered.push({ username: entry.name, goalId: file.slice(0, -'.jsonl'.length), filePath: path.join(userDir, file) });
      }
    }
  }

  return discovered.sort((left, right) => `${left.username || ''}/${left.goalId}`.localeCompare(`${right.username || ''}/${right.goalId}`));
}
