import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getRepoRoot } from '../../../src/lib/core.js';
import { getRegistryPath, getSystemClipsDir, validateProjectId } from '../../../src/lib/registry.js';

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_DIAGNOSTICS = 20;
const hash = (parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// Resolve missing descendants too, so an unavailable home and a symlink to its
// existing parent retain the same persistence scope. This never creates a path.
async function resolvedPath(input) {
  const absolute = path.resolve(input);
  try { return await fs.realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(await resolvedPath(parent), path.basename(absolute));
  }
}

async function readJson(file) {
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > MAX_JSON_BYTES) throw new Error('Expected a JSON file of at most 1 MiB.');
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

/**
 * Read only the existing local-user Clips project registry. options.clipsHome
 * overrides CLIPS_HOME/default home for isolated callers/tests; it is not a
 * project path or a second registry. No cwd inference, registration or pruning.
 *
 * The canonical registry reader filters local .clips/config before resolving
 * worktrees and treats corrupt config as {}. Read its supported schema here so
 * Git common-root normalization and strict validation happen in the right order.
 */
export async function discoverClipsProjects(options = {}) {
  if (!object(options) || (options.clipsHome !== undefined &&
      (typeof options.clipsHome !== 'string' || !options.clipsHome.trim() || options.clipsHome.includes('\0')))) {
    throw new TypeError('clipsHome must be a non-empty local path when provided.');
  }
  const home = options.clipsHome === undefined ? getSystemClipsDir() : path.resolve(options.clipsHome);
  const registryPath = options.clipsHome === undefined ? getRegistryPath() : path.join(home, 'projects.json');
  const diagnostics = [];
  let suppressed = 0;
  const report = (code, message, projectId) => {
    if (diagnostics.length < MAX_DIAGNOSTICS) diagnostics.push({ code, message, ...(projectId ? { projectId } : {}) });
    else suppressed += 1;
  };
  const finish = (projects, userScope) => {
    if (suppressed) diagnostics.push({ code: 'diagnostics_truncated', message: `${suppressed} additional discovery diagnostics omitted.` });
    return { projects, diagnostics, userScope };
  };
  let canonicalHome;
  try { canonicalHome = await resolvedPath(home); }
  catch {
    // An inaccessible home cannot yield a selectable project. Keep a stable
    // lexical scope until it becomes accessible; never substitute another home.
    canonicalHome = path.resolve(home);
    report('unavailable_home', 'The configured Clips home is unavailable.');
  }
  const userScope = `clips-user-${hash([canonicalHome, os.userInfo().username])}`;
  let registry;
  try { registry = await readJson(registryPath); }
  catch (error) {
    report(error.code === 'ENOENT' ? 'missing_registry' : error.code === 'EACCES' || error.code === 'EPERM' ? 'unavailable_registry' : 'invalid_registry',
      error.code === 'ENOENT' ? 'No local-user Clips project registry exists in the configured Clips home.' : 'The local-user Clips project registry is unreadable or invalid.');
    return finish([], userScope);
  }
  if (!object(registry) || !Array.isArray(registry.projects) || (registry.version !== undefined && registry.version !== 1)) {
    report('invalid_registry', 'The local-user Clips project registry has an unsupported structure or version.');
    return finish([], userScope);
  }

  const projects = [];
  const stores = new Set();
  for (const [index, entry] of registry.projects.entries()) {
    const registeredPath = typeof entry === 'string' ? entry : object(entry) ? entry.path : null;
    if (typeof registeredPath !== 'string' || !path.isAbsolute(registeredPath) || registeredPath.includes('\0')) {
      report('invalid_entry', `Registry entry ${index + 1} has no absolute project path.`);
      continue;
    }
    let projectRoot;
    try {
      // The same shared-worktree/store rule used by `clips board --json`.
      projectRoot = getRepoRoot(await fs.realpath(registeredPath));
    } catch {
      report('stale_project', `Registry entry ${index + 1} is unavailable or is no longer a Git repository.`);
      continue;
    }
    let storeRoot;
    try {
      storeRoot = await fs.realpath(path.join(projectRoot, '.clips'));
      if (!(await fs.stat(storeRoot)).isDirectory()) throw new Error('Not a directory.');
      await fs.access(storeRoot, constants.R_OK | constants.X_OK);
    } catch {
      report('unavailable_store', `Registry entry ${index + 1} has no available canonical Clips store.`);
      continue;
    }
    const id = `clips-project-${hash([storeRoot])}`;
    let config;
    try {
      config = await readJson(path.join(storeRoot, 'clips.config.json'));
      if (!object(config)) throw new Error('Not a configuration object.');
      if (config.project_id != null) {
        if (typeof config.project_id !== 'string') throw new Error('Invalid project_id.');
        validateProjectId(config.project_id);
      }
      for (const key of ['username', 'notepad_username']) {
        if (config[key] != null && typeof config[key] !== 'string') throw new Error('Invalid username.');
      }
      // A missing db is a valid empty board; an existing unreadable/non-directory
      // db would fail the real board read and must not look like an empty board.
      try {
        const db = path.join(storeRoot, 'db');
        if (!(await fs.stat(db)).isDirectory()) throw new Error('Not a directory.');
        await fs.access(db, constants.R_OK | constants.X_OK);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } catch (error) {
      const unavailable = ['ENOENT', 'EACCES', 'EPERM'].includes(error.code);
      report(unavailable ? 'unavailable_config' : 'invalid_config',
        unavailable ? 'A registered project has no readable canonical Clips configuration or board directory.' : 'A registered project has an invalid canonical Clips configuration or board directory.', id);
      continue;
    }
    if (stores.has(storeRoot)) continue;
    stores.add(storeRoot);
    projects.push({
      id,
      name: config.project_id || path.basename(projectRoot),
      projectRoot,
      storeRoot,
      username: config.username || config.notepad_username || null,
    });
  }
  return finish(projects, userScope);
}

/** Re-discover on every choice; a removed/stale id never falls back to cwd. */
export async function resolveClipsProject(id, options = {}) {
  if (typeof id !== 'string' || !/^clips-project-[a-f0-9]{64}$/.test(id)) {
    throw new TypeError('Choose a valid discovered Clips project ID.');
  }
  const { projects } = await discoverClipsProjects(options);
  const project = projects.find((candidate) => candidate.id === id);
  if (!project) throw new Error('The selected Clips project is no longer available in this user registry. Choose an available project.');
  return project;
}
