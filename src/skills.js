import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsRoot = path.join(packageRoot, '.agents', 'skills');

function defineSkill(name) {
  const sourceDir = path.join(skillsRoot, name);
  return Object.freeze({
    name,
    sourceDir,
    manifestPath: path.join(sourceDir, 'SKILL.md'),
  });
}

/**
 * Importable skill assets bundled by @dfosco/clips.
 *
 * Consumers can treat these descriptors like library components:
 *   import { clipsSkill, loopzSkill } from '@dfosco/clips/skills';
 */
export const clipsSkill = defineSkill('clips');
export const loopzSkill = defineSkill('loopz');

export const skills = Object.freeze({
  clips: clipsSkill,
  loopz: loopzSkill,
});

export function getSkill(name) {
  return skills[name] ?? null;
}
