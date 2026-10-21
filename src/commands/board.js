import path from 'node:path';
import { readBoardData } from '../lib/board.js';
import { getClipsDir, tryGetRepoRoot } from '../lib/core.js';

/**
 * The read-only machine interface consumed by Paseo and other local integrations.
 * Unlike "view all --json", it includes Lanes and preserves Goal/Task relationships.
 * Resolve the common repository root so linked git worktrees read the same Clips store.
 */
export function readCurrentBoard(cwd = process.cwd()) {
  const root = tryGetRepoRoot(cwd, { requireClips: true });
  if (!root) throw new Error('No Lanes store in this Git repository. Run lanes init first.');
  const clipsDir = getClipsDir(root);
  return readBoardData({
    dbDir: path.join(clipsDir, 'db'),
    recordsDir: path.join(clipsDir, 'records', 'cr'),
    componentsDir: path.join(clipsDir, 'components'),
  });
}

export function runBoardCommand(args = []) {
  const unknown = args.filter((arg) => arg !== '--json');
  if (unknown.length) throw new Error(`Unknown board option: ${unknown[0]}. Use lanes board --json.`);
  console.log(JSON.stringify(readCurrentBoard()));
}
