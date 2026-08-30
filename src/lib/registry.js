import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REGISTRY_VERSION = 1;
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function getSystemClipsDir() {
  return process.env.CLIPS_HOME ? path.resolve(process.env.CLIPS_HOME) : path.join(os.homedir(), '.clips');
}

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
  const configPath = path.join(repoRoot, '.clips', 'clips.config.json');
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return {};
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
  fs.writeFileSync(tempPath, `${JSON.stringify({ version: REGISTRY_VERSION, projects: projectPaths.map((projectPath) => ({ path: projectPath })) }, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, registryPath);
}

export function readProjectRegistry({ prune = true, registryPath = getRegistryPath() } = {}) {
  if (!fs.existsSync(registryPath)) return { projects: [], warnings: [] };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
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
      warnings.push({ kind: 'stale_project', project_id: normalizeProjectId(path.basename(entryPath)), message: `Removed unavailable Clips project: ${entryPath}` });
      continue;
    }
    if (!fs.existsSync(path.join(repoRoot, '.clips', 'clips.config.json'))) {
      warnings.push({ kind: 'stale_project', project_id: normalizeProjectId(path.basename(repoRoot)), message: `Removed unavailable Clips project: ${entryPath}` });
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
    const id = effectiveProjectId(repoRoot);
    if (ids.has(id.toLowerCase())) {
      warnings.push({ kind: 'duplicate_project_id', project_id: id, message: `Skipped duplicate project_id '${id}' at ${repoRoot}.` });
      continue;
    }
    ids.add(id.toLowerCase());
    projects.push({ id, label: path.basename(repoRoot), path: repoRoot });
  }
  return { projects, warnings };
}

export function assertProjectIdAvailable(projectId, repoRoot, options = {}) {
  const canonicalRoot = canonicalPath(repoRoot);
  const { projects } = readProjectRegistry(options);
  const collision = projects.find((project) => project.path !== canonicalRoot && project.id.toLowerCase() === projectId.toLowerCase());
  if (collision) throw new Error(`project_id '${projectId}' is already used by ${collision.path}.`);
}

export function ensureProjectIdentity(repoRoot, options = {}) {
  const canonicalRoot = canonicalPath(repoRoot);
  const configPath = path.join(canonicalRoot, '.clips', 'clips.config.json');
  const config = readProjectConfig(canonicalRoot);
  const baseId = config.project_id || normalizeProjectId(path.basename(canonicalRoot));
  if (config.project_id) {
    validateProjectId(config.project_id);
    assertProjectIdAvailable(config.project_id, canonicalRoot, options);
    return config.project_id;
  }

  const existingIds = new Set(readProjectRegistry(options).projects.filter((project) => project.path !== canonicalRoot).map((project) => project.id.toLowerCase()));
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
  const registry = readProjectRegistry(options);
  const paths = registry.projects.map((project) => project.path);
  if (!paths.includes(canonicalRoot)) paths.push(canonicalRoot);
  writeRegistry(paths, options.registryPath || getRegistryPath());
  return { id: effectiveProjectId(canonicalRoot), label: path.basename(canonicalRoot), path: canonicalRoot, warnings: registry.warnings };
}
