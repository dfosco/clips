import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { CONFIG_NAMES, STORE_NAMES } from './storage-paths.js';
import { validateLaneClaim } from './lane-claims.js';
import { validateManagerRegistration } from './lane-registrations.js';
import { validateProjectId } from './registry.js';

function stat(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function resolvedPath(directory) {
  const suffix = [];
  let parent = path.resolve(directory);
  while (!stat(parent)) {
    suffix.unshift(path.basename(parent));
    parent = path.dirname(parent);
  }
  return path.join(fs.realpathSync(parent), ...suffix);
}

function conflict(file, field = '') {
  throw new Error(`Migration conflict at ${file}${field ? ` (${field})` : ''}. No state was migrated; reconcile the differing content explicitly.`);
}

function mergeObjects(left, right, file, field = '') {
  if (isDeepStrictEqual(left, right)) return left;
  if (!object(left) || !object(right)) return conflict(file, field);
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    Object.defineProperty(result, key, {
      enumerable: true, configurable: true, writable: true,
      value: Object.hasOwn(left, key) ? mergeObjects(left[key], value, file, field ? `${field}.${key}` : key) : value,
    });
  }
  return result;
}

function parseState(buffer, file, relative) {
  const value = JSON.parse(buffer.toString('utf8'));
  if (!object(value)) throw new Error(`Invalid state ${file}: expected a JSON object`);
  if (CONFIG_NAMES.includes(relative)) {
    for (const key of ['collaboration', 'tasks_as_issues']) {
      if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new Error(`Invalid config ${file}: ${key} must be a boolean`);
    }
    if (value.lane_max_active_agents !== undefined && (!Number.isSafeInteger(value.lane_max_active_agents) || value.lane_max_active_agents < 1)) {
      throw new Error(`Invalid config ${file}: lane_max_active_agents must be a positive safe integer`);
    }
    for (const key of ['username', 'agent_dir', 'project_id']) {
      if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') throw new Error(`Invalid config ${file}: ${key} must be a string or null`);
    }
    if (value.view !== undefined && !object(value.view)) throw new Error(`Invalid config ${file}: view must be an object`);
    if (value.project_id !== undefined && value.project_id !== null) validateProjectId(value.project_id);
  }
  if (relative === 'projects.json' && ((value.version !== undefined && value.version !== 1) ||
      !Array.isArray(value.projects) || value.projects.some(entry => {
        const location = typeof entry === 'string' ? entry : entry?.path;
        return typeof location !== 'string' || !path.isAbsolute(location);
      }))) throw new Error(`The Lanes project registry is invalid: ${file}`);
  if (relative === 'installation.json' && (
    (value.mode !== undefined && !['dev', 'prod'].includes(value.mode)) ||
    (value.projects !== undefined && !object(value.projects)) ||
    ['prod_package', 'dev_checkout'].some(key => value[key] !== undefined && (typeof value[key] !== 'string' || !path.isAbsolute(value[key]))) ||
    !validFileReceipts(value.projects) || !validFileReceipts(value.skill_installations)
  )) throw new Error(`Invalid installation state: ${file}`);
  if (relative === 'copilot-workspaces-install.json' && (
    value.version !== 1 || typeof value.repository !== 'string' || !path.isAbsolute(value.repository) || !Array.isArray(value.targets) ||
    value.targets.some(entry => !object(entry) || ['target', 'source'].some(key => typeof entry[key] !== 'string' || !path.isAbsolute(entry[key])) ||
      typeof entry.created !== 'boolean' || (entry.backup !== null && (typeof entry.backup !== 'string' || !path.isAbsolute(entry.backup))))
  )) throw new Error(`Invalid Copilot install state: ${file}`);
  if (relative.startsWith(`lane-claims${path.sep}`)) validateLaneClaim(value, { file });
  if (relative.startsWith(`lane-managers${path.sep}`)) validateManagerRegistration(value, file);
  return value;
}

function validFileReceipts(receipts) {
  return receipts === undefined || object(receipts) && Object.entries(receipts).every(([target, receipt]) =>
    path.isAbsolute(target) && object(receipt) && object(receipt.files) &&
    Object.entries(receipt.files).every(([file, hash]) =>
      file.length && !path.isAbsolute(file) && !file.split(/[/\\]/).includes('..') && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)));
}

function jsonState(relative) {
  return CONFIG_NAMES.includes(relative) || ['projects.json', 'installation.json', 'copilot-workspaces-install.json'].includes(relative) ||
    /^(lane-claims|lane-managers)[/\\].*\.json$/.test(relative);
}

function snapshot(directory) {
  const entries = new Map();
  if (!stat(directory)) return entries;
  if (!fs.statSync(directory).isDirectory()) throw new Error(`Not a state directory: ${directory}`);
  const walk = (relative) => {
    for (const name of fs.readdirSync(path.join(directory, relative)).sort()) {
      const key = path.join(relative, name);
      const file = path.join(directory, key);
      const entry = fs.lstatSync(file);
      const journal = /^(db|components)[/\\].*\.jsonl$/.test(key);
      if ((jsonState(key) || journal) && entry.isDirectory()) throw new Error(`Invalid state file: ${file} is a directory`);
      if (['db', 'components', 'records', 'lane-claims', 'lane-managers'].includes(key) && entry.isFile()) {
        throw new Error(`Invalid state directory: ${file} is a file`);
      }
      if (/\.(json|jsonl)\.lock$/.test(name) || name === '.lanes-migration.lock') {
        throw new Error(`State is being written: ${file}. Wait for the writer or explicitly repair a stale lock before migrating.`);
      }
      if (entry.isSymbolicLink()) {
        if (CONFIG_NAMES.includes(key) && CONFIG_NAMES.some(name => {
          const other = path.join(directory, name);
          return other !== file && stat(other)?.isFile() && fs.realpathSync(file) === fs.realpathSync(other);
        })) {
          const data = fs.readFileSync(file);
          parseState(data, file, key);
          entries.set(key, { type: 'file', data, mode: fs.statSync(file).mode });
          continue;
        }
        if (jsonState(key) || journal || ['db', 'components', 'records', 'lane-claims', 'lane-managers'].includes(key.split(path.sep)[0])) {
          throw new Error(`Cannot migrate linked state safely: ${file}`);
        }
        entries.set(key, { type: 'link', target: fs.readlinkSync(file), mode: entry.mode });
      } else if (entry.isDirectory()) {
        entries.set(key, { type: 'directory', mode: entry.mode });
        walk(key);
      } else if (entry.isFile()) {
        const data = fs.readFileSync(file);
        if (jsonState(key)) parseState(data, file, key);
        if (journal) {
          for (const [index, line] of data.toString('utf8').split('\n').entries()) {
            if (!line.trim()) continue;
            try { if (!object(JSON.parse(line))) throw new Error('Expected an event object'); }
            catch (error) { throw new Error(`Invalid journal ${file}, line ${index + 1}: ${error.message}`); }
          }
        }
        entries.set(key, { type: 'file', data, mode: entry.mode });
      } else throw new Error(`Unsupported state entry: ${file}`);
    }
  };
  walk('');
  return entries;
}

function mergeRegistry(left, right, file) {
  const { projects: leftProjects, ...leftFields } = left;
  const { projects: rightProjects, ...rightFields } = right;
  const result = mergeObjects(leftFields, rightFields, file);
  const entries = new Map();
  for (const entry of [...leftProjects, ...rightProjects]) {
    const value = typeof entry === 'string' ? { path: entry } : entry;
    let key = path.resolve(value.path);
    try { key = fs.realpathSync(key); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const previous = entries.get(key);
    entries.set(key, previous ? mergeObjects(previous, { ...value, path: previous.path }, file, key) : value);
  }
  return { ...result, projects: [...entries.values()] };
}

function mergeEntries(sources, target, mappings) {
  const merged = new Map();
  for (const source of sources) {
    for (const [original, originalEntry] of source.entries) {
      const key = CONFIG_NAMES.includes(original) ? CONFIG_NAMES[0] : original;
      let entry = originalEntry;
      if (['installation.json', 'copilot-workspaces-install.json'].includes(key)) {
        const previous = parseState(entry.data, path.join(source.directory, original), key);
        const value = remap(previous, mappings);
        if (key === 'installation.json' && value.skill_installations) {
          value.skill_installations = Object.fromEntries(Object.entries(value.skill_installations).map(([directory, receipt]) => [remap(directory, mappings), receipt]));
        }
        if (!isDeepStrictEqual(previous, value)) entry = { ...entry, data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`) };
      } else if (entry.type === 'link') {
        const from = path.resolve(path.dirname(path.join(source.directory, original)), entry.target);
        const to = remap(from, mappings);
        entry = { ...entry, target: path.isAbsolute(entry.target) ? to : path.relative(path.dirname(path.join(target, key)), to) || '.' };
      }
      let previous = merged.get(key);
      if (!previous) { merged.set(key, entry); continue; }
      if (previous.type !== entry.type) conflict(path.join(target, key));
      previous = { ...previous, mode: previous.mode & entry.mode };
      merged.set(key, previous);
      if (entry.type === 'directory') continue;
      if (entry.type === 'link') {
        if (previous.target !== entry.target) conflict(path.join(target, key));
      } else if (!previous.data.equals(entry.data)) {
        if (jsonState(key)) {
          const file = path.join(target, key);
          const left = JSON.parse(previous.data);
          const right = JSON.parse(entry.data);
          if (isDeepStrictEqual(left, right)) continue;
          if (![CONFIG_NAMES[0], 'projects.json', 'installation.json'].includes(key)) conflict(file);
          const value = key === 'projects.json' ? mergeRegistry(left, right, file) : mergeObjects(left, right, file);
          merged.set(key, { ...previous, data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`) });
        } else conflict(path.join(target, key));
      }
    }
  }
  return merged;
}

function remap(value, mappings) {
  if (typeof value === 'string') {
    const mapping = mappings.find(([from]) => value === from || value.startsWith(`${from}${path.sep}`));
    return mapping ? mapping[1] + value.slice(mapping[0].length) : value;
  }
  if (Array.isArray(value)) return value.map(item => remap(item, mappings));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, mappings)]));
  return value;
}

function materialize(directory, entries, mode) {
  fs.mkdirSync(directory, { mode: 0o700 });
  for (const [key, entry] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.join(directory, key);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (entry.type === 'directory') fs.mkdirSync(file, { recursive: true });
    else if (entry.type === 'link') fs.symlinkSync(entry.target, file);
    else fs.writeFileSync(file, entry.data, { mode: entry.mode & 0o777 });
  }
  for (const [key, entry] of [...entries].reverse()) {
    if (entry.type === 'directory') fs.chmodSync(path.join(directory, key), entry.mode & 0o777);
  }
  fs.chmodSync(directory, mode);
}

// Preflight every source before staging either scope. Backups remain available
// until both replacements succeed; an I/O failure rolls the replacements back.
export function migrateStorage(repoRoot, { home = os.homedir(), env = process.env } = {}) {
  const override = env.LANES_HOME || env.CLIPS_HOME;
  const userTarget = override ? path.resolve(override) : path.join(home, STORE_NAMES[0]);
  const specs = [
    { target: path.join(repoRoot, STORE_NAMES[0]), paths: STORE_NAMES.map(name => path.join(repoRoot, name)) },
    { target: userTarget, paths: override ? [userTarget] : STORE_NAMES.map(name => path.join(home, name)) },
  ];
  if (specs[0].paths.map(resolvedPath).some(project => specs[1].paths.map(resolvedPath).some(user =>
    user === project || user.startsWith(`${project}${path.sep}`) || project.startsWith(`${user}${path.sep}`)
  ))) throw new Error('Project and user stores must not overlap.');
  for (const spec of specs) {
    for (const directory of spec.paths) {
      if (stat(directory)?.isSymbolicLink() && !spec.paths.some(other => other !== directory &&
          stat(other)?.isDirectory() && resolvedPath(directory) === resolvedPath(other))) {
        throw new Error(`Cannot migrate linked store safely: ${directory}. Only aliases between the selected .lanes and .clips directories are supported.`);
      }
    }
  }
  const plans = specs.map(spec => ({
    ...spec,
    sources: spec.paths.map(directory => ({ directory, entries: snapshot(directory), exists: Boolean(stat(directory)) })),
  }));
  const mappings = plans.flatMap(plan => plan.paths.filter(directory => directory !== plan.target)
    .flatMap(directory => [...new Set([directory, resolvedPath(directory)])].map(from => [from, plan.target])))
    .sort(([a], [b]) => b.length - a.length);
  for (const plan of plans) {
    plan.entries = mergeEntries(plan.sources, plan.target, mappings);
    plan.changed = plan.sources.some(source => source.exists && source.directory !== plan.target) ||
      !isDeepStrictEqual(plan.entries, plan.sources.find(source => source.directory === plan.target)?.entries);
  }
  const active = plans.filter(plan => plan.changed);
  const locks = [];
  const moved = [];
  const installed = [];
  let rollbackFailed = false;
  try {
    for (const parent of [...new Set(plans.map(plan => resolvedPath(path.dirname(plan.target))))]) {
      fs.mkdirSync(parent, { recursive: true });
      const lock = path.join(parent, '.lanes-migration.lock');
      const fd = fs.openSync(lock, 'wx');
      locks.push(lock);
      try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid })); }
      finally { fs.closeSync(fd); }
    }
    for (const plan of active) {
      plan.stage = `${plan.target}.migration-${randomUUID()}`;
      const sources = plan.sources.filter(source => source.exists);
      const mode = sources.length ? sources.reduce((mode, source) => mode & fs.statSync(source.directory).mode, 0o777) : 0o700;
      materialize(plan.stage, plan.entries, mode);
    }
    for (const plan of plans) {
      for (const source of plan.sources) {
        if (source.exists !== Boolean(stat(source.directory)) || !isDeepStrictEqual(source.entries, snapshot(source.directory))) {
          throw new Error(`State changed during migration: ${source.directory}. Retry after writers finish.`);
        }
      }
    }
    for (const plan of active) {
      for (const source of plan.sources.filter(source => source.exists)) {
        const backup = `${source.directory}.backup-${randomUUID()}`;
        fs.renameSync(source.directory, backup);
        moved.push({ source: source.directory, backup });
      }
      fs.renameSync(plan.stage, plan.target);
      installed.push(plan.target);
    }
  } catch (error) {
    const failures = [];
    for (const directory of installed.reverse()) {
      try { fs.rmSync(directory, { recursive: true, force: true }); }
      catch (failure) { failures.push(failure.message); }
    }
    for (const move of moved.reverse()) {
      try { fs.renameSync(move.backup, move.source); }
      catch (failure) { failures.push(`${move.backup}: ${failure.message}`); }
    }
    if (failures.length) {
      rollbackFailed = true;
      throw new Error(`Migration failed: ${error.message}. Rollback needs explicit recovery; backups and migration locks were retained. ${failures.join('; ')}`, { cause: error });
    }
    throw error;
  } finally {
    for (const plan of active) if (plan.stage && stat(plan.stage)) fs.rmSync(plan.stage, { recursive: true, force: true });
    if (!rollbackFailed) for (const lock of locks) fs.unlinkSync(lock);
  }
  for (const move of moved) fs.rmSync(move.backup, { recursive: true, force: true });
  return { migrated: active.length > 0, projectDir: specs[0].target, userDir: userTarget };
}
