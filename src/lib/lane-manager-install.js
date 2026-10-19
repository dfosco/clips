import fs from 'node:fs';
import path from 'node:path';

// These live skills are maintained by their checkout, never by a refresh.
export const LIVE_SKILL_NAMES = ['clips', 'lane-manager'];

export function isLiveSkill(target) {
  const name = path.basename(target);
  if (!LIVE_SKILL_NAMES.includes(name)) return false;
  let current = path.resolve(target);
  // Inspect only the skill hierarchy, not OS aliases such as /var -> /private/var.
  for (let depth = 0; depth < 3; depth += 1) {
    try { if (fs.lstatSync(current).isSymbolicLink()) return true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const root = path.resolve(target, '../../..');
  try {
    return fs.existsSync(path.join(root, '.git')) &&
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name === '@dfosco/clips' &&
      path.resolve(target) === path.join(root, '.agents', 'skills', name);
  } catch { return false; }
}

export function findLiveSkill(skillsRoot) {
  return LIVE_SKILL_NAMES.find(name => isLiveSkill(path.join(skillsRoot, name)));
}

// Preserve the original helper for existing callers.
export function isLiveLaneManager(target) {
  return path.basename(target) === 'lane-manager' && isLiveSkill(target);
}
