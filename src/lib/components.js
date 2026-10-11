// Durable system components: responsibility and contract identity independent
// of the goals and tasks that change their implementation.
import fs from 'node:fs';
import path from 'node:path';
import {
  getRepoRoot, normalizeComponentId, parseRef, formatRef,
} from './core.js';
import { appendJsonEvent, assertExpectedRevision, readJsonEvents, withRecordLock } from './journal.js';
import { extensionsFields, isPlainObject, referenceList, sectionsFields } from './work-fields.js';

export { normalizeComponentId } from './core.js';

export const CLIPS_COMPONENTS_DIR = '.clips/components';
const STATUSES = new Set(['active', 'retired']);
const TEXT_FIELDS = ['title', 'responsibility', 'contract', 'decisions'];
const INPUT_FIELDS = new Set([
  ...TEXT_FIELDS, 'dependencies', 'source_refs', 'status', 'sections', 'extensions', 'expected_revision',
]);

export function getClipsComponentsDir(repoRoot = getRepoRoot()) {
  return path.join(repoRoot, CLIPS_COMPONENTS_DIR);
}

function normalizedNamespace(username) {
  if (username == null) return null;
  if (typeof username !== 'string' || !/^[a-z][a-z0-9_-]*$/i.test(username)) {
    throw new Error(`Invalid component namespace: ${username}`);
  }
  return username.toLowerCase();
}

function componentIdentity(componentId, username) {
  const id = normalizeComponentId(componentId);
  if (!id) throw new Error(`Invalid component ID: ${componentId}`);
  return { componentId: id, username: normalizedNamespace(username) };
}

function exactPath(componentsDir, componentId, username) {
  return path.join(componentsDir, ...(username ? [username] : []), `${componentId}.jsonl`);
}

export function getComponentFilePath(componentId, username = null, {
  componentsDir = getClipsComponentsDir(),
} = {}) {
  const identity = componentIdentity(componentId, username);
  // Components describe the shared repository. A user's configuration must
  // never change the record addressed by an unqualified component reference.
  return exactPath(componentsDir, identity.componentId, identity.username);
}

export function componentExists(componentId, username = null, options = {}) {
  return fs.existsSync(getComponentFilePath(componentId, username, options));
}

function validateRevision(revision, { allowZero = false } = {}) {
  if (!Number.isSafeInteger(revision) || revision < (allowZero ? 0 : 1)) {
    throw new Error(`revision must be a ${allowZero ? 'non-negative' : 'positive'} integer`);
  }
}

function identityFromFile(file, componentsDir) {
  const parent = path.dirname(file);
  return {
    componentId: path.basename(file, '.jsonl'),
    username: path.resolve(parent) === path.resolve(componentsDir) ? null : path.basename(parent),
  };
}

function replayComponent(events, identity, revision) {
  if (!events.length) return null;
  if (revision !== undefined) {
    validateRevision(revision);
    if (revision > events.length) {
      throw new Error(`Component ${formatRef(identity)} has no revision #r${revision}`);
    }
  }
  const count = revision ?? events.length;
  let component = null;
  for (const event of events.slice(0, count)) {
    const { event: eventName, timestamp, component_id: _id, revision: _revision, ...fields } = event;
    if (eventName === 'component_created') {
      if (component) throw new Error(`Component ${formatRef(identity)} has multiple creation events`);
      component = {
        responsibility: '', contract: '', decisions: '', dependencies: [], source_refs: [],
        sections: {}, extensions: {}, status: 'active',
        ...fields,
        created_at: timestamp,
      };
    } else if (component && ['component_updated', 'component_status_changed'].includes(eventName)) {
      Object.assign(component, fields);
    } else {
      throw new Error(`Invalid component event: ${eventName}`);
    }
    if (timestamp) component.updated_at = timestamp;
  }
  return {
    ...component,
    component_id: identity.componentId,
    username: identity.username,
    ref: formatRef(identity),
    revision: count,
  };
}

export function readComponent(componentId, username = null, {
  revision, componentsDir = getClipsComponentsDir(),
} = {}) {
  if (revision !== undefined) validateRevision(revision);
  const file = getComponentFilePath(componentId, username, { componentsDir });
  return replayComponent(readJsonEvents(file), identityFromFile(file, componentsDir), revision);
}

export function readComponentHistory(componentId, username = null, { revision, componentsDir = getClipsComponentsDir() } = {}) {
  if (revision !== undefined) validateRevision(revision);
  const file = getComponentFilePath(componentId, username, { componentsDir });
  const events = readJsonEvents(file);
  if (revision !== undefined && revision > events.length) {
    throw new Error(`Component ${formatRef(identityFromFile(file, componentsDir))} has no revision #r${revision}`);
  }
  return events.slice(0, revision ?? events.length).map((event, index) => ({ ...event, revision: index + 1 }));
}

export function listComponents({ componentsDir = getClipsComponentsDir(), username, onError } = {}) {
  if (!fs.existsSync(componentsDir)) return [];
  const files = [];
  const collect = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^c\d+\.jsonl$/.test(entry.name)) files.push(path.join(dir, entry.name));
    }
  };
  if (username !== undefined) {
    const namespace = normalizedNamespace(username);
    collect(namespace ? path.join(componentsDir, namespace) : componentsDir);
  } else {
    collect(componentsDir);
    for (const entry of fs.readdirSync(componentsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && /^[a-z][a-z0-9_-]*$/i.test(entry.name)) collect(path.join(componentsDir, entry.name));
    }
  }
  return files.map((file) => {
    try { return replayComponent(readJsonEvents(file), identityFromFile(file, componentsDir)); }
    catch (error) {
      if (!onError) throw error;
      onError({ path: file, message: error.message });
      return null;
    }
  })
    .filter(Boolean)
    .sort((left, right) => (left.username || '').localeCompare(right.username || '')
      || Number(left.component_id.slice(1)) - Number(right.component_id.slice(1)));
}

// The revision check and append share one stream lock. A caller updating a
// snapshot should always pass its observed revision to avoid a lost update.
export function appendComponentEvent(componentId, event, {
  username = null, expectedRevision, componentsDir = getClipsComponentsDir(),
} = {}) {
  if (!isPlainObject(event)) throw new Error('Component event must be a JSON object');
  const identity = componentIdentity(componentId, username);
  if (expectedRevision !== undefined) validateRevision(expectedRevision, { allowZero: true });
  const file = getComponentFilePath(identity.componentId, identity.username, { componentsDir });
  return withRecordLock(file, () => {
    const events = readJsonEvents(file);
    assertExpectedRevision(expectedRevision, events.length, formatRef(identityFromFile(file, componentsDir)));
    if (event.event === 'component_created') {
      if (events.length) throw new Error(`Component ${formatRef(identity)} already exists`);
    } else if (!events.length) {
      throw new Error(`Component ${formatRef(identity)} not found`);
    } else if (!['component_updated', 'component_status_changed'].includes(event.event)) {
      throw new Error(`Invalid component event: ${event.event}`);
    }
    const nextEvent = {
      ...event,
      component_id: identity.componentId,
      timestamp: event.timestamp || new Date().toISOString(),
    };
    appendJsonEvent(file, nextEvent);
    return events.length + 1;
  });
}

function componentFields(data, previous = {}, { creating = false } = {}) {
  if (!isPlainObject(data)) throw new Error('Component data must be a JSON object');
  const unsupported = Object.keys(data).filter((field) => !INPUT_FIELDS.has(field));
  if (unsupported.length) {
    throw new Error(`Unsupported component fields: ${unsupported.join(', ')}. Use sections for Markdown or extensions for custom JSON`);
  }
  if (Object.hasOwn(data, 'expected_revision')) validateRevision(data.expected_revision, { allowZero: true });
  const fields = {};
  for (const name of TEXT_FIELDS) {
    if (!Object.hasOwn(data, name)) continue;
    if (typeof data[name] !== 'string' || (name === 'title' && !data[name].trim())) {
      throw new Error(`${name} must be ${name === 'title' ? 'a non-empty string' : 'a string'}`);
    }
    fields[name] = name === 'title' ? data[name].trim() : data[name];
  }
  if (creating && !fields.title) throw new Error('Component title is required');
  if (Object.hasOwn(data, 'dependencies')) {
    fields.dependencies = referenceList(data.dependencies, 'dependencies').map((ref) => {
      const parsed = parseRef(ref);
      if (!parsed?.componentId || parsed.criterionId || parsed.taskId || parsed.goalId) {
        throw new Error(`Invalid component dependency: ${ref}`);
      }
      return formatRef(parsed);
    });
    if (new Set(fields.dependencies).size !== fields.dependencies.length) throw new Error('Duplicate component dependency');
  }
  if (Object.hasOwn(data, 'source_refs')) fields.source_refs = referenceList(data.source_refs, 'source_refs');
  if (Object.hasOwn(data, 'status')) {
    if (!STATUSES.has(data.status)) throw new Error('Component status must be active or retired');
    fields.status = data.status;
  }
  return {
    ...(creating ? {
      responsibility: '', contract: '', decisions: '', dependencies: [], source_refs: [],
      sections: {}, extensions: {}, status: 'active',
    } : {}),
    ...fields,
    ...sectionsFields(data, previous),
    ...extensionsFields(data, previous),
  };
}

export function createComponent(data, { username = null, componentsDir = getClipsComponentsDir() } = {}) {
  const namespace = normalizedNamespace(username);
  const fields = componentFields(data, {}, { creating: true });
  if (data.expected_revision !== undefined && data.expected_revision !== 0) {
    throw new Error('A new component must have expected_revision 0');
  }
  const directory = namespace ? path.join(componentsDir, namespace) : componentsDir;
  return withRecordLock(path.join(directory, '.catalog'), () => {
    const existing = listComponents({ componentsDir, username: namespace });
    const next = Math.max(0, ...existing.map((component) => Number(component.component_id.slice(1)))) + 1;
    const componentId = `c${String(next).padStart(3, '0')}`;
    appendComponentEvent(componentId, { event: 'component_created', ...fields }, {
      username: namespace, expectedRevision: 0, componentsDir,
    });
    return readComponent(componentId, namespace, { componentsDir });
  });
}

export function updateComponent(componentId, data, { username = null, componentsDir = getClipsComponentsDir() } = {}) {
  const previous = readComponent(componentId, username, { componentsDir });
  if (!previous) throw new Error(`Component ${formatRef(componentIdentity(componentId, username))} not found`);
  const fields = componentFields(data, previous);
  appendComponentEvent(previous.component_id, { event: 'component_updated', ...fields }, {
    username: previous.username,
    expectedRevision: data.expected_revision ?? previous.revision,
    componentsDir,
  });
  return readComponent(previous.component_id, previous.username, { componentsDir });
}

export function changeComponentStatus(componentId, status, options = {}) {
  return updateComponent(componentId, { status, ...(options.expectedRevision === undefined ? {} : { expected_revision: options.expectedRevision }) }, options);
}
