// Durable coordination ownership. Runtime liveness never releases a manager.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getSystemClipsDir } from './registry.js';
import { normalizeLaneId } from './lanes.js';
import { assertExpectedRevision, withRecordLock } from './journal.js';

const ACTIONS = new Set(['claim', 'share', 'release', 'handover']);
const digest = (value) => createHash('sha256').update(value).digest('hex');

export function getRepositoryIdentity(projectPath = process.cwd()) {
  const cwd = fs.realpathSync(path.resolve(projectPath));
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  return fs.realpathSync(path.resolve(cwd, common));
}

function text(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a nonempty string`);
  return value.trim();
}

function identity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Manager identity must include observed host, runtime and session_id');
  const result = {};
  for (const key of ['host', 'runtime', 'session_id']) result[key] = text(value[key], key);
  for (const key of ['workspace_id', 'contact']) if (value[key] !== undefined) result[key] = text(value[key], key);
  return result;
}

export function sameManager(left, right) {
  return ['host', 'runtime', 'session_id'].every((key) => left[key] === right[key]);
}

function context(options = {}) {
  const repository_id = getRepositoryIdentity(options.projectPath);
  // Lanes are repository-global. A caller must not fork ownership by username.
  if (options.namespace !== undefined && options.namespace !== '') throw new Error('Lanes do not have ownership namespaces');
  const namespace = '';
  return {
    repository_id, namespace,
    directory: path.join(options.claimsDir || path.join(getSystemClipsDir(), 'lane-claims'), digest(repository_id), digest(namespace)),
  };
}

function empty(laneId, ctx) {
  return { version: 1, repository_id: ctx.repository_id, namespace: ctx.namespace, lane_id: laneId, revision: 0, owners: [], history: [] };
}

function ownersValid(owners) {
  if (!Array.isArray(owners)) throw new Error('owners must be an array');
  const seen = new Set();
  for (const owner of owners) {
    const normalized = identity(owner);
    if (Object.entries(normalized).some(([key, value]) => owner[key] !== value)) throw new Error('Invalid manager identity');
    if (!Number.isFinite(Date.parse(owner.claimed_at))) throw new Error('Invalid claimed_at');
    const key = JSON.stringify([owner.host, owner.runtime, owner.session_id]);
    if (seen.has(key)) throw new Error('Duplicate manager identity');
    seen.add(key);
  }
}

function authorization(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Handover requires explicit user authorization: {by, reason}');
  return { by: text(value.by, 'authorization.by'), reason: text(value.reason, 'authorization.reason') };
}

function invalidClaim(file, error) {
  return new Error(`Invalid Lane claim ${file || '(in memory)'}: ${error.message}. Ownership is unknown; repair the state explicitly before claiming.`);
}

export function validateLaneClaim(state, { file, laneId, repositoryId, namespace } = {}) {
  try {
    if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1
      || !path.isAbsolute(text(state.repository_id, 'repository_id')) || state.namespace !== ''
      || normalizeLaneId(state.lane_id) !== state.lane_id
      || (repositoryId !== undefined && state.repository_id !== repositoryId)
      || (namespace !== undefined && state.namespace !== namespace)
      || (laneId !== undefined && state.lane_id !== normalizeLaneId(laneId))) throw new Error('Claim identity/version mismatch');
    if (file && (path.basename(file) !== `${state.lane_id}.json`
      || path.basename(path.dirname(file)) !== digest(state.namespace)
      || path.basename(path.dirname(path.dirname(file))) !== digest(state.repository_id))) throw new Error('Claim storage identity mismatch');
    if (!Number.isSafeInteger(state.revision) || state.revision < 1 || !Array.isArray(state.history) || state.history.length !== state.revision) throw new Error('Invalid claim revision/history');
    ownersValid(state.owners);
    let prior = [];
    for (const [index, entry] of state.history.entries()) {
      if (entry.revision !== index + 1 || !ACTIONS.has(entry.action) || !Number.isFinite(Date.parse(entry.timestamp))) throw new Error('Invalid claim history entry');
      identity(entry.actor);
      ownersValid(entry.owners_before);
      ownersValid(entry.owners_after);
      if (JSON.stringify(entry.owners_before) !== JSON.stringify(prior)) throw new Error('Discontinuous claim history');
      if (entry.action === 'handover') authorization(entry.authorization);
      prior = entry.owners_after;
    }
    if (JSON.stringify(prior) !== JSON.stringify(state.owners)) throw new Error('Claim owners/history mismatch');
    return state;
  } catch (error) {
    throw invalidClaim(file, error);
  }
}

function load(file, laneId, ctx) {
  let source;
  try { source = fs.readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return empty(laneId, ctx); throw error; }
  let state;
  try { state = JSON.parse(source); }
  catch (error) { throw invalidClaim(file, error); }
  return validateLaneClaim(state, { file, laneId, repositoryId: ctx.repository_id, namespace: ctx.namespace });
}

export function readLaneClaim(ref, options = {}) {
  const ctx = context(options);
  const laneId = normalizeLaneId(ref);
  return load(path.join(ctx.directory, `${laneId}.json`), laneId, ctx);
}

export function listLaneClaims(options = {}) {
  const ctx = context(options);
  let files;
  try { files = fs.readdirSync(ctx.directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return files.filter((file) => /^l\d+\.json$/.test(file)).sort().map((file) => load(path.join(ctx.directory, file), file.slice(0, -5), ctx));
}

function conflict(state) {
  const error = new Error(`Lane #${state.lane_id} is managed by ${JSON.stringify(state.owners)}. Contact the manager before overlapping work; use explicit sharing or user-authorized handover. Current revision r${state.revision}.`);
  error.code = 'LANE_CLAIM_CONFLICT';
  error.claim = state;
  return error;
}

export function mutateLaneClaim(ref, action, data, options = {}) {
  if (!ACTIONS.has(action)) throw new Error(`Unknown Lane manager operation: ${action}`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Claim request must be an object');
  const allowed = new Set(['expected_revision', 'actor', ...(action === 'share' || action === 'handover' ? ['owner'] : []), ...(action === 'handover' ? ['from', 'authorization'] : [])]);
  for (const key of Object.keys(data)) if (!allowed.has(key)) throw new Error(`Unsupported ${action} field: ${key}`);
  if (!Number.isSafeInteger(data.expected_revision) || data.expected_revision < 0) throw new Error('expected_revision is required and must be a non-negative integer; inspect the claim first');
  const actor = identity(data.actor);
  const target = ['share', 'handover'].includes(action) ? identity(data.owner) : null;
  const auth = action === 'handover' ? authorization(data.authorization) : null;
  const from = action === 'handover' && data.from ? identity(data.from) : actor;
  const ctx = context(options);
  const laneId = normalizeLaneId(ref);
  const file = path.join(ctx.directory, `${laneId}.json`);
  return withRecordLock(file, () => {
    const state = load(file, laneId, ctx);
    assertExpectedRevision(data.expected_revision, state.revision, `#${laneId} manager claim`);
    const own = state.owners.find((owner) => sameManager(owner, actor));
    const timestamp = new Date().toISOString();
    let owners = [...state.owners];
    if (action === 'claim') {
      if (own) return state;
      if (owners.length) throw conflict(state);
      owners.push({ ...actor, claimed_at: timestamp });
    } else if (action === 'share') {
      if (!own) throw conflict(state);
      if (owners.some((owner) => sameManager(owner, target))) return state;
      owners.push({ ...target, claimed_at: timestamp });
    } else if (action === 'release') {
      if (!own) throw conflict(state);
      owners = owners.filter((owner) => !sameManager(owner, actor));
    } else {
      if (!owners.some((owner) => sameManager(owner, from))) throw new Error('Handover source is not a current manager; inspect the claim again');
      if (sameManager(from, target)) throw new Error('Handover source and target must differ');
      owners = owners.filter((owner) => !sameManager(owner, from));
      if (!owners.some((owner) => sameManager(owner, target))) owners.push({ ...target, claimed_at: timestamp });
    }
    const revision = state.revision + 1;
    const entry = { revision, action, timestamp, actor, owners_before: state.owners, owners_after: owners, ...(auth ? { authorization: auth } : {}) };
    const updated = { ...state, revision, owners, history: [...state.history, entry] };
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
    return updated;
  });
}
