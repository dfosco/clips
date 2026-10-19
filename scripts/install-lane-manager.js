// Run from the maintained checkout: node scripts/install-lane-manager.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function installLaneManager({
  source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.agents/skills/lane-manager'),
  home = os.homedir(),
  codexHome = process.env.CODEX_HOME || path.join(home, '.codex'),
  backupRoot = path.join(process.env.CLIPS_HOME || path.join(home, '.clips'), 'skill-backups'),
} = {}) {
  source = fs.realpathSync(source);
  if (!fs.statSync(path.join(source, 'SKILL.md')).isFile()) throw new Error('Lane Manager source is missing SKILL.md');
  const targets = [...new Set([
    path.join(home, '.agents', 'skills', 'lane-manager'),
    path.join(codexHome, 'skills', 'lane-manager'),
  ])];
  return targets.map((target) => {
    let existing;
    try { existing = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing?.isSymbolicLink() && fs.existsSync(target) && fs.realpathSync(target) === source) {
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
        const backupDir = fs.mkdtempSync(path.join(backupRoot, 'lane-manager-'));
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(installLaneManager(), null, 2));
}
