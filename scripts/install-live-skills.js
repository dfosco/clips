// Run from the maintained checkout: node scripts/install-live-skills.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_SKILL_NAMES } from '../src/lib/lane-manager-install.js';
import { installLiveSkill } from './install-lane-manager.js';

export function installClipsSkills({
  sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.agents/skills'),
  ...options
} = {}) {
  // Validate both sources before replacing any existing installation.
  const sources = LIVE_SKILL_NAMES.map(name => {
    const source = fs.realpathSync(path.join(sourceRoot, name));
    if (!fs.statSync(path.join(source, 'SKILL.md')).isFile()) throw new Error(`${name} source is missing SKILL.md`);
    return { name, source };
  });
  return sources.flatMap(({ name, source }) => installLiveSkill({ ...options, name, source }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(installClipsSkills(), null, 2));
}
