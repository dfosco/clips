import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const COPILOT_SKILL_NAMES = ['clips', 'lane-manager'];
const STATE_VERSION = 1;

export function provisionCopilotDependencies(repositoryRoot, {
  runNpm = execFileSync,
} = {}) {
  const pluginRoot = path.join(fs.realpathSync(repositoryRoot), 'plugins', 'copilot');
  const packagePath = path.join(pluginRoot, 'package.json');
  const lockPath = path.join(pluginRoot, 'package-lock.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  if (!manifest.dependencies?.['@github/copilot-sdk']) {
    throw new Error('Copilot extension package.json must declare @github/copilot-sdk');
  }
  if (!Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 2 ||
      lock.packages?.['']?.dependencies?.['@github/copilot-sdk'] !== manifest.dependencies['@github/copilot-sdk']) {
    throw new Error('Copilot package-lock.json is missing or does not match the SDK dependency in package.json');
  }
  runNpm('npm', ['ci', '--omit=dev', '--prefix', pluginRoot], { stdio: 'inherit' });
  return { pluginRoot, packagePath, lockPath, command: ['npm', 'ci', '--omit=dev', '--prefix', pluginRoot] };
}

function readState(stateFile) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.version !== STATE_VERSION || !Array.isArray(state.targets)) {
      throw new Error(`Unsupported Copilot install state at ${stateFile}`);
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function targetEntry(target) {
  try { return fs.lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function pointsTo(target, source) {
  try { return fs.realpathSync(target) === source; }
  catch { return false; }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function replaceWithLink({ target, source, backupRoot, name }) {
  const existing = targetEntry(target);
  if (existing && pointsTo(target, source)) {
    return { target, source, changed: false, created: false, backup: null };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.clips-${process.pid}-${randomUUID()}`;
  fs.symlinkSync(source, temporary, 'dir');
  let backup = null;
  let movedExisting = false;
  try {
    if (existing) {
      fs.mkdirSync(backupRoot, { recursive: true });
      const backupDir = fs.mkdtempSync(path.join(backupRoot, `${name}-`));
      backup = path.join(backupDir, 'previous');
      fs.renameSync(target, backup);
      movedExisting = true;
    }
    fs.renameSync(temporary, target);
    return { target, source, changed: true, created: true, backup };
  } catch (error) {
    if (movedExisting && !targetEntry(target)) fs.renameSync(backup, target);
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function rollbackApplied(entries) {
  for (const entry of [...entries].reverse()) {
    if (!entry.changed || !entry.created) continue;
    if (!targetEntry(entry.target)) continue;
    if (!fs.lstatSync(entry.target).isSymbolicLink() || !pointsTo(entry.target, entry.source)) {
      throw new Error(`Copilot install rollback stopped: ${entry.target} no longer points to ${entry.source}`);
    }
    fs.unlinkSync(entry.target);
    if (entry.backup) fs.renameSync(entry.backup, entry.target);
  }
}

export function copilotInstallPaths({
  repositoryRoot,
  home = os.homedir(),
  copilotHome = process.env.COPILOT_HOME || path.join(home, '.copilot'),
} = {}) {
  const root = fs.realpathSync(repositoryRoot);
  const extensionSource = fs.realpathSync(path.join(root, 'plugins', 'copilot'));
  const extensionTarget = path.join(copilotHome, 'extensions', 'clips-workspaces');
  const skillsRoot = path.join(copilotHome, 'skills');
  const targets = [{ name: 'clips-workspaces', target: extensionTarget, source: extensionSource }];
  const hostSkill = fs.realpathSync(path.join(extensionSource, 'skills', 'clips-copilot'));
  if (!fs.statSync(path.join(hostSkill, 'SKILL.md')).isFile()) throw new Error('Copilot host skill is missing SKILL.md');
  targets.push({ name: 'skill-clips-copilot', target: path.join(skillsRoot, 'clips-copilot'), source: hostSkill });
  for (const name of COPILOT_SKILL_NAMES) {
    const source = fs.realpathSync(path.join(root, '.agents', 'skills', name));
    if (!fs.statSync(path.join(source, 'SKILL.md')).isFile()) throw new Error(`Canonical ${name} skill is missing SKILL.md`);
    targets.push({ name: `skill-${name}`, target: path.join(skillsRoot, name), source });
  }
  return targets;
}

export function installCopilot({
  repositoryRoot,
  home = os.homedir(),
  copilotHome = process.env.COPILOT_HOME || path.join(home, '.copilot'),
  clipsHome = process.env.CLIPS_HOME || path.join(home, '.clips'),
  runNpm = execFileSync,
  installLink = replaceWithLink,
} = {}) {
  const root = fs.realpathSync(repositoryRoot);
  const stateFile = path.join(clipsHome, 'copilot-workspaces-install.json');
  const previous = readState(stateFile);
  const previousByTarget = new Map((previous?.targets || []).map(item => [item.target, item]));
  const backupRoot = path.join(clipsHome, 'copilot-backups');
  const applied = [];

  try {
    const dependencies = provisionCopilotDependencies(root, { runNpm });
    const results = copilotInstallPaths({ repositoryRoot: root, home, copilotHome }).map(spec => {
      const result = installLink({ ...spec, backupRoot, name: spec.name });
      if (!result.changed) {
        const prior = previousByTarget.get(result.target);
        if (prior?.source === result.source) {
          result.created = prior.created;
          result.backup = prior.backup || null;
        }
      }
      applied.push(result);
      return result;
    });
    const state = {
      version: STATE_VERSION,
      repository: root,
      installed_at: new Date().toISOString(),
      targets: results.map(({ target, source, created, backup }) => ({ target, source, created, backup })),
    };
    atomicJson(stateFile, state);
    return { stateFile, dependencies, results };
  } catch (error) {
    try { rollbackApplied(applied); }
    catch (rollbackError) { error.message += `; rollback also failed: ${rollbackError.message}`; }
    throw error;
  }
}

export function rollbackCopilotInstall({
  home = os.homedir(),
  clipsHome = process.env.CLIPS_HOME || path.join(home, '.clips'),
} = {}) {
  const stateFile = path.join(clipsHome, 'copilot-workspaces-install.json');
  const state = readState(stateFile);
  if (!state) return { rolledBack: false, reason: 'No Copilot installation receipt exists.' };

  for (const entry of [...state.targets].reverse()) {
    if (!entry.created) continue;
    if (!targetEntry(entry.target)) continue;
    if (!fs.lstatSync(entry.target).isSymbolicLink() || !pointsTo(entry.target, entry.source)) {
      throw new Error(`Copilot rollback stopped: ${entry.target} no longer points to the installed source ${entry.source}`);
    }
  }
  rollbackApplied(state.targets.map(entry => ({ ...entry, changed: true })));
  fs.unlinkSync(stateFile);
  return { rolledBack: true, restored: state.targets.filter(entry => entry.created).map(entry => entry.target) };
}
