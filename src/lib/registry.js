import fs from 'node:fs';
import path from 'node:path';
import { getUserStoreDir, projectConfigPath, readJsonObject } from './storage-paths.js';
import { withRecordLock } from './journal.js';

const REGISTRY_VERSION = 1;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function getSystemClipsDir(options) {
  return getUserStoreDir(options);
}
export const getSystemLanesDir = getSystemClipsDir;

export function getRegistryPath() {
  return path.join(getSystemClipsDir(), 'projects.json');
}

export function normalizeProjectId(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 64);
  return normalized || 'project';
}

export function validateProjectId(value) {
  if (!PROJECT_ID_PATTERN.test(String(value))) {
    throw new Error('Invalid project_id. Use 1-64 lowercase letters, numbers, underscores, or hyphens, starting with a letter or number.');
  }
  return value;
}

function readProjectConfig(repoRoot) {
  const configPath = projectConfigPath(repoRoot);
  try {
    return readJsonObject(configPath);
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

export function effectiveProjectId(repoRoot) {
  const config = readProjectConfig(repoRoot);
  return config.project_id || normalizeProjectId(path.basename(repoRoot));
}

function canonicalPath(repoRoot) {
  return fs.realpathSync(path.resolve(repoRoot));
}

function writeRegistry(projectPaths, registryPath = getRegistryPath()) {
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${registryPath}.${process.pid}.tmp`;
  const previous = fs.existsSync(registryPath) ? readJsonObject(registryPath) : {};
  const entries = new Map((previous.projects || []).map(entry => [typeof entry === 'string' ? entry : entry.path, typeof entry === 'string' ? {} : entry]));
  fs.writeFileSync(tempPath, `${JSON.stringify({ ...previous, version: REGISTRY_VERSION, projects: projectPaths.map(projectPath => ({ ...entries.get(projectPath), path: projectPath })) }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, registryPath);
}

export function readProjectRegistry({ prune = true, registryPath = getRegistryPath() } = {}) {
  if (!fs.existsSync(registryPath)) return { projects: [], warnings: [] };

  let parsed;
  try {
    parsed = readJsonObject(registryPath);
    if ((parsed.version !== undefined && parsed.version !== REGISTRY_VERSION) || !Array.isArray(parsed.projects) ||
        parsed.projects.some(entry => typeof (typeof entry === 'string' ? entry : entry?.path) !== 'string')) {
      throw new Error('Project registry is invalid');
    }
  } catch (error) {
    return { projects: [], warnings: [{ kind: 'invalid_registry', message: `Could not read project registry: ${error.message}` }] };
  }

  const warnings = [];
  const livePaths = [];
  const seen = new Set();
  for (const entry of Array.isArray(parsed.projects) ? parsed.projects : []) {
    const entryPath = typeof entry === 'string' ? entry : entry?.path;
    if (!entryPath) continue;
    let repoRoot;
    try {
      repoRoot = canonicalPath(entryPath);
    } catch {
      warnings.push({ kind: 'stale_project', path: entryPath, project_id: normalizeProjectId(path.basename(entryPath)), message: `${prune ? 'Removed unavailable' : 'Unavailable'} Lanes project: ${entryPath}` });
      continue;
    }
    let configPath;
    try { configPath = projectConfigPath(repoRoot); }
    catch (error) {
      warnings.push({ kind: 'project_data', message: error.message, path: repoRoot });
      livePaths.push(repoRoot);
      continue;
    }
    if (!fs.existsSync(configPath)) {
      warnings.push({ kind: 'stale_project', path: entryPath, project_id: normalizeProjectId(path.basename(repoRoot)), message: `${prune ? 'Removed unavailable' : 'Unavailable'} Lanes project: ${entryPath}` });
      continue;
    }
    if (!seen.has(repoRoot)) {
      seen.add(repoRoot);
      livePaths.push(repoRoot);
    }
  }

  if (prune && livePaths.length !== (Array.isArray(parsed.projects) ? parsed.projects.length : 0)) {
    writeRegistry(livePaths, registryPath);
  }

  const ids = new Set();
  const projects = [];
  for (const repoRoot of livePaths) {
    let id;
    try { id = effectiveProjectId(repoRoot); }
    catch (error) {
      warnings.push({ kind: 'project_data', message: error.message, path: repoRoot });
      continue;
    }
    if (ids.has(id.toLowerCase())) {
      warnings.push({ kind: 'duplicate_project_id', path: repoRoot, project_id: id, message: `Skipped duplicate project_id '${id}' at ${repoRoot}.` });
      continue;
    }
    ids.add(id.toLowerCase());
    projects.push({ id, label: path.basename(repoRoot), path: repoRoot });
  }
  return { projects, warnings };
}

export function assertProjectIdAvailable(projectId, repoRoot, options = {}) {
  const canonicalRoot = canonicalPath(repoRoot);
  const { projects } = readProjectRegistry({ prune: false, ...options });
  const collision = projects.find((project) => project.path !== canonicalRoot && project.id.toLowerCase() === projectId.toLowerCase());
  if (collision) throw new Error(`project_id '${projectId}' is already used by ${collision.path}.`);
}

export function ensureProjectIdentity(repoRoot, options = {}) {
  const canonicalRoot = canonicalPath(repoRoot);
  const configPath = projectConfigPath(canonicalRoot);
  const config = readProjectConfig(canonicalRoot);
  const baseId = config.project_id || normalizeProjectId(path.basename(canonicalRoot));
  if (config.project_id) {
    validateProjectId(config.project_id);
    assertProjectIdAvailable(config.project_id, canonicalRoot, options);
    return config.project_id;
  }

  const existingIds = new Set(readProjectRegistry({ prune: false, ...options }).projects.filter((project) => project.path !== canonicalRoot).map((project) => project.id.toLowerCase()));
  let projectId = baseId;
  let suffix = 2;
  while (existingIds.has(projectId.toLowerCase())) projectId = `${baseId.slice(0, 61)}-${suffix++}`;
  if (projectId !== baseId) {
    fs.writeFileSync(configPath, `${JSON.stringify({ ...config, project_id: projectId }, null, 2)}\n`);
  }
  return projectId;
}

export function registerProject(repoRoot, options = {}) {
  const canonicalRoot = canonicalPath(repoRoot);
  const registryPath = options.registryPath || getRegistryPath();
  return withRecordLock(registryPath, () => {
    const registry = readProjectRegistry({ ...options, prune: false });
    if (registry.warnings.some(warning => warning.kind === 'invalid_registry')) throw new Error(registry.warnings[0].message);
    const previous = fs.existsSync(registryPath) ? readJsonObject(registryPath).projects : [];
    const paths = [...new Set(previous.map(entry => typeof entry === 'string' ? entry : entry.path))];
    if (!paths.includes(canonicalRoot)) paths.push(canonicalRoot);
    writeRegistry(paths, registryPath);
    return { id: effectiveProjectId(canonicalRoot), label: path.basename(canonicalRoot), path: canonicalRoot, warnings: registry.warnings };
  });
}
