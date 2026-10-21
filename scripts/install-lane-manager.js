// Run from the maintained checkout: node scripts/install-lane-manager.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_SKILL_NAMES } from '../src/lib/lane-manager-install.js';
import { getSystemClipsDir } from '../src/lib/registry.js';

export function installLiveSkill({
  name,
  source,
  home = os.homedir(),
  codexHome = process.env.CODEX_HOME || path.join(home, '.codex'),
  backupRoot = path.join(getSystemClipsDir({ home }), 'skill-backups'),
} = {}) {
  if (!LIVE_SKILL_NAMES.includes(name)) throw new Error(`Unsupported live skill: ${name}`);
  source = fs.realpathSync(source);
  if (!fs.statSync(path.join(source, 'SKILL.md')).isFile()) throw new Error(`${name} source is missing SKILL.md`);
  const targets = [...new Set([
    path.join(home, '.agents', 'skills', name),
    path.join(codexHome, 'skills', name),
  ])];
  return targets.map((target) => {
    let existing;
    try { existing = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // Also protect a canonical directory reached through a linked parent.
    if (existing && fs.existsSync(target) && fs.realpathSync(target) === source) {
      return { target, source, changed: false };
    }
    if (target === source) return { target, source, changed: false };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.live-${process.pid}`;
    // Do not overwrite a previous incomplete setup's staging entry.
    fs.symlinkSync(source, temporary, 'dir');
    let backup;
    try {
      if (existing) {
        fs.mkdirSync(backupRoot, { recursive: true });
        const backupDir = fs.mkdtempSync(path.join(backupRoot, `${name}-`));
        backup = path.join(backupDir, 'skill');
        fs.renameSync(target, backup);
      }
      try { fs.renameSync(temporary, target); }
      catch (error) { if (backup) fs.renameSync(backup, target); throw error; }
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    return { target, source, backup, changed: true };
  });
}

export function installLaneManager(options = {}) {
  return installLiveSkill({
    ...options,
    name: 'lane-manager',
    source: options.source || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.agents/skills/lane-manager'),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(installLaneManager(), null, 2));
}
