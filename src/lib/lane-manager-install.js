import fs from 'node:fs';
import path from 'node:path';

// A live Lane Manager is maintained by its source checkout, never by a refresh.
export function isLiveLaneManager(target) {
  if (path.basename(target) !== 'lane-manager') return false;
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
      path.resolve(target) === path.join(root, '.agents', 'skills', 'lane-manager');
  } catch { return false; }
}
