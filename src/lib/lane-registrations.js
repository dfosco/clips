// Working associations are advisory. Neither registration nor freshness proves liveness.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getClipsDbDir, getRepoRoot } from './core.js';
import { assertExpectedRevision, withRecordLock } from './journal.js';
import { getRepositoryIdentity, readLaneClaim } from './lane-claims.js';
import { normalizeLaneId, readLane } from './lanes.js';
import { effectiveProjectId, getSystemClipsDir, readProjectRegistry } from './registry.js';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a nonempty string`);
  return value.trim();
}

function actorIdentity(value) {
  if (!object(value)) throw new Error('actor must include observed runtime and session_id');
  const actor = { ...value };
  for (const key of ['runtime', 'session_id']) actor[key] = text(value[key], `actor.${key}`);
  for (const key of ['host', 'workspace_id', 'contact']) {
    if (value[key] !== undefined) actor[key] = text(value[key], `actor.${key}`);
  }
  return actor;
}

function actorKey(actor) {
  return [actor.host ?? null, actor.runtime, actor.session_id];
}

function observation(value) {
  if (!object(value)) throw new Error('runtime_observation must include status, observed_at and source');
  const result = { ...value };
  for (const key of ['status', 'observed_at', 'source']) result[key] = text(value[key], `runtime_observation.${key}`);
  if (!Number.isFinite(Date.parse(result.observed_at))) throw new Error('runtime_observation.observed_at must be a timestamp');
  return result;
}

function directory(options) {
  return options.registrationsDir || path.join(getSystemClipsDir(), 'lane-managers');
}

function registrationId(project, laneId, actor) {
  return digest([project.repository_id, laneId, actorKey(actor)]);
}

function validateProject(project) {
  if (!object(project) || !path.isAbsolute(text(project.path, 'project.path'))
    || !path.isAbsolute(text(project.repository_id, 'project.repository_id'))) throw new Error('Invalid registration project');
  text(project.id, 'project.id');
}

function invalidRegistration(file, error) {
  return new Error(`Invalid Lane registration ${file || '(in memory)'}: ${error.message}. Repair explicitly; the stored association was not changed.`);
}

export function validateManagerRegistration(state, file) {
  try {
    if (!object(state) || state.version !== 1) throw new Error('Unsupported registration version');
    validateProject(state.project);
    const actor = actorIdentity(state.actor);
    if (JSON.stringify(actor) !== JSON.stringify(state.actor)) throw new Error('Invalid stored actor');
    if (normalizeLaneId(state.lane_id) !== state.lane_id) throw new Error('Invalid Lane ID');
    if (state.registration_id !== registrationId(state.project, state.lane_id, actor)
      || (file && path.basename(file) !== `${state.registration_id}.json`)) throw new Error('Registration identity mismatch');
    if (!Number.isSafeInteger(state.revision) || state.revision < 1
      || !Array.isArray(state.history) || state.history.length !== state.revision) throw new Error('Invalid registration revision/history');
    let status;
    for (const [index, entry] of state.history.entries()) {
      if (!object(entry) || entry.revision !== index + 1 || !['register', 'unregister'].includes(entry.action)
        || !Number.isFinite(Date.parse(entry.timestamp))) throw new Error('Invalid registration history');
      if (JSON.stringify(actorKey(actorIdentity(entry.actor))) !== JSON.stringify(actorKey(actor))) throw new Error('Registration history actor mismatch');
      if (entry.action === 'unregister' && status !== 'working') throw new Error('Invalid unregister history');
      if (entry.runtime_observation !== undefined) observation(entry.runtime_observation);
      status = entry.action === 'register' ? 'working' : 'stopped';
    }
    if (state.status !== status || state.registered_at !== state.history[0].timestamp
      || state.updated_at !== state.history.at(-1).timestamp) throw new Error('Registration history/state mismatch');
    if (state.status === 'stopped' && state.stopped_at !== state.updated_at) throw new Error('Invalid stopped_at');
    if (state.runtime_observation !== undefined) observation(state.runtime_observation);
    return state;
  } catch (error) {
    throw invalidRegistration(file, error);
  }
}

function load(file) {
  let source;
  try { source = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let state;
  try { state = JSON.parse(source); }
  catch (error) { throw invalidRegistration(file, error); }
  return validateManagerRegistration(state, file);
}

function storedRegistrations(options) {
  const dir = directory(options);
  let files;
  try { files = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort(); }
  catch (error) { if (error.code === 'ENOENT') return { registrations: [], warnings: [] }; throw error; }
  const registrations = [], warnings = [];
  for (const name of files) {
    const file = path.join(dir, name);
    try {
      const state = load(file);
      if (!state) throw new Error('Registration disappeared while being read; retry discovery');
      registrations.push(state);
    } catch (error) {
      warnings.push({ kind: 'invalid_registration', file, message: error.message });
    }
  }
  return { registrations, warnings };
}

function liveProject(projectPath) {
  const root = getRepoRoot(projectPath);
  if (!fs.statSync(getClipsDbDir(root)).isDirectory()) throw new Error(`Project is not initialized: ${root}`);
  const project = { id: effectiveProjectId(root), path: root, repository_id: getRepositoryIdentity(root) };
  validateProject(project);
  return project;
}

function availability(project, laneId) {
  try {
    const current = liveProject(project.path);
    if (current.repository_id !== project.repository_id) throw new Error('Repository identity changed at the stored path');
    if (laneId) {
      const lane = readLane(laneId, getClipsDbDir(current.path));
      if (!lane) throw new Error(`Lane #${laneId} is missing from ${current.path}`);
      return { status: 'available', current_project: current, lane };
    }
    return { status: 'available', current_project: current };
  } catch (error) {
    return { status: 'unavailable', message: error.message };
  }
}

function catalog(options) {
  const stored = storedRegistrations(options);
  const registry = readProjectRegistry({ prune: false, ...(options.registryPath ? { registryPath: options.registryPath } : {}) });
  const warnings = [...registry.warnings, ...stored.warnings];
  const projects = new Map();
  for (const entry of registry.projects) {
    try {
      const project = liveProject(entry.path);
      projects.set(project.repository_id, project);
    } catch (error) {
      const recorded = stored.registrations.find((state) => state.project.path === entry.path)?.project;
      projects.set(recorded?.repository_id || entry.path, {
        ...recorded, id: entry.id, path: entry.path,
        availability: { status: 'unavailable', message: error.message },
      });
    }
  }
  for (const state of stored.registrations) {
    if (!projects.has(state.project.repository_id)) projects.set(state.project.repository_id, state.project);
  }
  return { ...stored, warnings, projects: [...projects.values()] };
}

function explicitPath(selector) {
  return path.isAbsolute(selector) || selector.startsWith('.') || selector.includes(path.sep);
}

function canonicalMissingPath(projectPath) {
  let parent = projectPath;
  const suffix = [];
  while (true) {
    try { return path.join(fs.realpathSync(parent), ...suffix); }
    catch (error) {
      if (error.code !== 'ENOENT' || path.dirname(parent) === parent) throw error;
      suffix.unshift(path.basename(parent));
      parent = path.dirname(parent);
    }
  }
}

export function resolveManagerProject(selector, options = {}) {
  const target = text(selector, '--project');
  if (explicitPath(target)) {
    const projectPath = path.resolve(target);
    try { return liveProject(projectPath); }
    catch (error) {
      if (!options.allowUnavailable) throw new Error(`Cannot access project ${projectPath}: ${error.message}`);
      const projects = storedRegistrations(options).registrations.map((entry) => entry.project);
      let matches = projects.filter((project) => project.path === projectPath);
      if (!matches.length) {
        const canonical = canonicalMissingPath(projectPath);
        matches = projects.filter((project) => project.path === canonical);
      }
      const identities = new Set(matches.map((project) => project.repository_id));
      if (identities.size > 1) throw new Error(`Ambiguous stored project path: ${projectPath}`);
      if (matches.length) return matches[0];
      throw new Error(`Cannot access project ${projectPath}: ${error.message}`);
    }
  }
  const data = catalog(options);
  if (data.warnings.some((warning) => warning.kind === 'invalid_registry'
    || (warning.kind === 'duplicate_project_id' && warning.project_id?.toLowerCase() === target.toLowerCase()))) {
    throw new Error(`Cannot resolve project '${target}' from an invalid or ambiguous registry; use an explicit project path`);
  }
  const matches = data.projects.filter((project) => project.id.toLowerCase() === target.toLowerCase());
  if (matches.length !== 1) throw new Error(`${matches.length ? 'Ambiguous' : 'Unknown'} project '${target}'; use an explicit project path`);
  const { availability: diagnostic, ...project } = matches[0];
  if (!project.repository_id) throw new Error(`Cannot access project ${project.path}: ${diagnostic.message}`);
  if (!options.allowUnavailable) {
    const observed = availability(project);
    if (observed.status !== 'available') throw new Error(`Cannot access project ${project.path}: ${observed.message}`);
    return observed.current_project;
  }
  return project;
}

function projectRegistration(state) {
  const observed = availability(state.project, state.lane_id);
  return {
    ...state,
    live_status: 'unknown',
    freshness: {
      updated_at: state.updated_at,
      age_seconds: Math.max(0, Math.floor((Date.now() - Date.parse(state.updated_at)) / 1000)),
      runtime_observed_at: state.runtime_observation?.observed_at ?? null,
    },
    availability: observed,
  };
}

export function listManagerRegistrations(options = {}) {
  const data = catalog(options);
  const project = options.project ? resolveManagerProject(options.project, { ...options, allowUnavailable: true }) : null;
  return {
    projects: data.projects.filter((entry) => !project || entry.repository_id === project.repository_id)
      .map((entry) => ({ ...entry, availability: entry.availability || availability(entry) })),
    registrations: data.registrations.filter((entry) => !project || entry.project.repository_id === project.repository_id).map(projectRegistration),
    warnings: data.warnings,
  };
}

export function inspectManagerRegistrations(ref, options = {}) {
  const laneId = normalizeLaneId(ref);
  const project = resolveManagerProject(options.project, { ...options, allowUnavailable: true });
  const stored = storedRegistrations(options);
  const observed = availability(project, laneId);
  const warnings = [...stored.warnings];
  let claim = null;
  if (observed.status === 'available') {
    try { claim = readLaneClaim(laneId, { projectPath: project.path, claimsDir: options.claimsDir }); }
    catch (error) { warnings.push({ kind: 'lane_claim', message: error.message }); }
  } else warnings.push({ kind: 'unavailable_lane', message: observed.message });
  return {
    project, lane_id: laneId, lane: observed.lane ?? null, claim,
    registrations: stored.registrations.filter((entry) => entry.project.repository_id === project.repository_id && entry.lane_id === laneId).map(projectRegistration),
    warnings,
  };
}

export function mutateManagerRegistration(ref, action, data, options = {}) {
  if (!['register', 'unregister'].includes(action)) throw new Error(`Unknown registration operation: ${action}`);
  if (!object(data)) throw new Error('Registration request must be an object');
  const allowed = ['actor', 'expected_revision', ...(action === 'register' ? ['runtime_observation'] : [])];
  for (const key of Object.keys(data)) if (!allowed.includes(key)) throw new Error(`Unsupported ${action} field: ${key}`);
  if (!Number.isSafeInteger(data.expected_revision) || data.expected_revision < 0) throw new Error('expected_revision is required and must be a non-negative integer; inspect registrations first');
  const actor = actorIdentity(data.actor);
  const runtimeObservation = data.runtime_observation === undefined ? undefined : observation(data.runtime_observation);
  const laneId = normalizeLaneId(ref);
  const project = resolveManagerProject(options.project, { ...options, allowUnavailable: action === 'unregister' });
  if (action === 'register') {
    const observed = availability(project, laneId);
    if (observed.status !== 'available') throw new Error(`Cannot register Lane #${laneId}: ${observed.message}`);
  }
  const id = registrationId(project, laneId, actor);
  const file = path.join(directory(options), `${id}.json`);
  const state = withRecordLock(file, () => {
    const previous = load(file);
    assertExpectedRevision(data.expected_revision, previous?.revision ?? 0, `#${laneId} manager registration`);
    if (action === 'unregister') {
      if (!previous) throw new Error('No registration for this actor; unregister only stops your own association');
      if (previous.status === 'stopped') return previous;
    }
    const timestamp = new Date().toISOString();
    const revision = (previous?.revision ?? 0) + 1;
    const updatedActor = { ...previous?.actor, ...actor };
    const entry = {
      revision, action, timestamp, actor: updatedActor,
      ...(runtimeObservation === undefined ? {} : { runtime_observation: runtimeObservation }),
    };
    const updated = {
      ...previous, version: 1, registration_id: id, project: { ...previous?.project, ...project }, lane_id: laneId,
      revision, actor: updatedActor, status: action === 'register' ? 'working' : 'stopped',
      registered_at: previous?.registered_at ?? timestamp, updated_at: timestamp,
      stopped_at: action === 'unregister' ? timestamp : null,
      ...(runtimeObservation === undefined ? {} : { runtime_observation: { ...previous?.runtime_observation, ...runtimeObservation } }),
      history: [...(previous?.history ?? []), entry],
    };
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(updated, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return updated;
  });
  return projectRegistration(state);
}
