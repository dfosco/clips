// Shared, side-effect-free validation for durable work agreements.
// These helpers record assertions and evidence supplied by a caller; they do not
// execute verification or decide whether an actor has authority to accept work.
import { isDeepStrictEqual } from 'node:util';

export function isPlainObject(value) {
  return value !== null && typeof value === 'object'
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function assertObject(value, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be a JSON object`);
}

function assertJson(value, label = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) assertJson(item, label);
    return;
  }
  if (isPlainObject(value)) {
    for (const item of Object.values(value)) assertJson(item, label);
    return;
  }
  throw new Error(`${label} must contain only JSON values`);
}

function text(value, label, { empty = true, nullable = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || (!empty && !value.trim())) {
    throw new Error(`${label} must be ${nullable ? 'null or ' : ''}${empty ? 'a string' : 'a non-empty string'}`);
  }
  return value;
}

export function normalizeCriterionId(value) {
  const id = String(value || '').toUpperCase();
  if (!/^A[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id.slice(1)))) {
    throw new Error(`Invalid acceptance criterion ID '${value}'; use A1, A2, ...`);
  }
  return id;
}

// Legacy string criteria acquire deterministic IDs on first use. New IDs are
// allocated above the retained high-water mark, including deleted criteria.
export function normalizeAcceptanceCriteria(criteria = [], previous = {}, { allowEmpty = false } = {}) {
  if (!Array.isArray(criteria)) throw new Error('acceptance_criteria must be an array');
  const old = Array.isArray(previous.acceptance_criteria) ? previous.acceptance_criteria : [];
  const occupied = new Set(old.filter(isPlainObject).filter((item) => item.id).map((item) => normalizeCriterionId(item.id)));
  let legacyNext = 1;
  const oldItems = old.map((item) => {
    if (typeof item === 'string') {
      while (occupied.has(`A${legacyNext}`)) legacyNext++;
      const id = `A${legacyNext++}`;
      occupied.add(id);
      return { id, description: item };
    }
    assertObject(item, 'acceptance criterion');
    // Previous state can contain a blank legacy criterion. It must be possible
    // to read or repair it even though new requests require observable text.
    return { ...item, id: normalizeCriterionId(item.id), description: text(item.description, 'criterion description') };
  });
  const historicalNext = Math.max(1, ...oldItems.map((item) => Number(item.id.slice(1)) + 1));
  let nextId = Math.max(historicalNext, Number.isSafeInteger(previous.acceptance_criteria_next_id) ? previous.acceptance_criteria_next_id : 1);
  const retiredBelow = nextId;
  const oldById = new Map(oldItems.map((item) => [item.id, item]));
  const explicitIds = criteria.filter(isPlainObject).filter((item) => item.id !== undefined).map((item) => normalizeCriterionId(item.id));
  if (new Set(explicitIds).size !== explicitIds.length) throw new Error('Duplicate acceptance criterion ID');
  const reserved = new Set(explicitIds);
  const used = new Set();
  const normalized = criteria.map((input) => {
    const item = typeof input === 'string' ? { description: input } : input;
    assertObject(item, 'acceptance criterion');
    assertJson(item, 'acceptance criterion');
    const description = text(item.description, 'criterion description', { empty: allowEmpty });
    let id;
    if (item.id !== undefined) {
      id = normalizeCriterionId(item.id);
      if (!oldById.has(id) && Number(id.slice(1)) < retiredBelow) {
        throw new Error(`Acceptance criterion ${id} was retired or reserved; use a new ID`);
      }
    } else {
      const existing = oldItems.find((candidate) => candidate.description === description && !used.has(candidate.id) && !reserved.has(candidate.id));
      if (existing) id = existing.id;
      else {
        while (reserved.has(`A${nextId}`) || used.has(`A${nextId}`)) nextId++;
        id = `A${nextId++}`;
      }
    }
    if (used.has(id)) throw new Error(`Duplicate acceptance criterion ID ${id}`);
    used.add(id);
    nextId = Math.max(nextId, Number(id.slice(1)) + 1);
    return { ...(oldById.get(id) || {}), ...item, id, description };
  });
  return { acceptance_criteria: normalized, acceptance_criteria_next_id: nextId };
}

export function acceptanceCriteriaFields(data, previous = {}) {
  if (!Object.hasOwn(data, 'acceptance_criteria')) return {};
  return normalizeAcceptanceCriteria(data.acceptance_criteria, previous);
}

export function sectionsFields(data, previous = {}) {
  if (!Object.hasOwn(data, 'sections')) return {};
  assertObject(data.sections, 'sections');
  const sections = new Map(Object.entries(previous.sections || {}));
  for (const [heading, markdown] of Object.entries(data.sections)) {
    if (!heading.trim()) throw new Error('Section headings must not be empty');
    if (markdown === null) sections.delete(heading);
    else sections.set(heading, text(markdown, `Section '${heading}'`));
  }
  return { sections: Object.fromEntries(sections) };
}

function mergeJson(previous, patch) {
  const result = new Map(Object.entries(isPlainObject(previous) ? previous : {}));
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) result.delete(key);
    else result.set(key, isPlainObject(value) ? mergeJson(result.get(key), value) : structuredClone(value));
  }
  return Object.fromEntries(result);
}

export function extensionsFields(data, previous = {}) {
  if (!Object.hasOwn(data, 'extensions')) return {};
  assertObject(data.extensions, 'extensions');
  assertJson(data.extensions, 'extensions');
  return { extensions: mergeJson(previous.extensions, data.extensions) };
}

export function referenceList(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array of references`);
  const refs = value.map((ref) => text(ref, `${label} reference`, { empty: false }).trim());
  if (new Set(refs).size !== refs.length) throw new Error(`Duplicate ${label} reference`);
  return refs;
}

export function workFields(data, previous = {}, { kind = 'task', creating = false } = {}) {
  assertObject(data, `${kind} data`);
  const fields = {};
  for (const name of ['title', 'description', 'scope', 'record', ...(kind === 'goal' ? ['plan', 'decisions'] : [])]) {
    if (Object.hasOwn(data, name)) fields[name] = text(data[name], name, { empty: name !== 'title' });
  }
  for (const name of ['owner', 'acceptance_owner']) {
    if (Object.hasOwn(data, name)) fields[name] = text(data[name], name, { nullable: true, empty: false });
  }
  if (Object.hasOwn(data, 'components')) fields.components = referenceList(data.components, 'components');
  if (creating && !Object.hasOwn(data, 'title')) throw new Error('title is required');
  if (creating) {
    fields.description ??= '';
    fields.scope ??= '';
    fields.record ??= '';
    fields.components ??= [];
    fields.sections = {};
    fields.extensions = {};
  }
  return {
    ...fields,
    ...(creating && !Object.hasOwn(data, 'acceptance_criteria') ? normalizeAcceptanceCriteria([], previous) : acceptanceCriteriaFields(data, previous)),
    ...sectionsFields(data, previous),
    ...extensionsFields(data, previous),
  };
}

export const WORK_FIELDS = Object.freeze([
  'title', 'description', 'scope', 'components', 'owner', 'acceptance_owner', 'record',
  'acceptance_criteria', 'sections', 'extensions', 'behavior', 'verification_mode',
  'blocked_by', 'expected_revision',
]);

export function validateWorkInput(data, { kind = 'task', extra = [] } = {}) {
  assertObject(data, `${kind} data`);
  const allowed = new Set([...WORK_FIELDS, ...(kind === 'goal' ? ['plan', 'decisions', 'type', 'track_id'] : []), ...extra]);
  const unsupported = Object.keys(data).filter((field) => !allowed.has(field));
  if (unsupported.length) {
    throw new Error(`Unsupported ${kind} fields: ${unsupported.join(', ')}. Use sections for Markdown or extensions for custom JSON`);
  }
  if (Object.hasOwn(data, 'expected_revision') && (!Number.isSafeInteger(data.expected_revision) || data.expected_revision < 0)) {
    throw new Error('expected_revision must be a non-negative integer');
  }
}

// Plan, owner, record, sections and extensions can change without changing the
// obligation. Authoritative expectations belong in description/scope/criteria.
export function requestSnapshot(record, { kind = 'task' } = {}) {
  const fields = ['title', 'description', 'scope', 'components', 'acceptance_owner', 'acceptance_criteria', 'behavior', 'verification_mode', 'blocked_by'];
  if (kind === 'goal') fields.push('decisions');
  else fields.push('effective_verification_mode');
  const snapshot = {};
  for (const field of fields) {
    if (Object.hasOwn(record, field)) snapshot[field] = structuredClone(record[field]);
  }
  snapshot.acceptance_criteria = normalizeAcceptanceCriteria(record.acceptance_criteria || [], record, { allowEmpty: true }).acceptance_criteria;
  return snapshot;
}

function comparisonSnapshot(record, options) {
  const snapshot = requestSnapshot(record, options);
  snapshot.acceptance_criteria.sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  for (const key of ['components', 'blocked_by']) {
    if (Array.isArray(snapshot[key])) snapshot[key].sort();
  }
  return snapshot;
}

export function workRequestChanged(previous, next, options = {}) {
  return !isDeepStrictEqual(comparisonSnapshot(previous, options), comparisonSnapshot(next, options));
}

export function invalidateAcceptanceFields(previous, patch, { kind = 'task', reason, force = false, timestamp = new Date().toISOString() } = {}) {
  const changed = workRequestChanged(previous, { ...previous, ...patch }, { kind });
  if (!force && !changed) return {};
  if (!previous.acceptance) return previous.status === 'closed' ? { status: 'open', closed_commit_sha: null } : {};
  return {
    acceptance: null,
    acceptance_history: [...(previous.acceptance_history || []), {
      ...previous.acceptance,
      invalidated_at: timestamp,
      invalidation_reason: reason || 'The work agreement changed',
    }],
    ...(previous.status === 'closed' ? { status: 'open', closed_commit_sha: null } : {}),
  };
}

function evidenceValue(value, label) {
  if (typeof value === 'string') return text(value, label, { empty: false });
  if (Array.isArray(value) && value.length > 0) {
    for (const item of value) evidenceValue(item, label);
    return structuredClone(value);
  }
  if (isPlainObject(value) && Object.keys(value).length > 0) {
    assertJson(value, label);
    return structuredClone(value);
  }
  throw new Error(`${label} must be non-empty evidence text, an object, or an array`);
}

export function acceptanceFields(record, receipt, { kind = 'task', timestamp = new Date().toISOString(), request = null } = {}) {
  assertObject(receipt, 'Acceptance receipt');
  const allowed = new Set(['artifact', 'accepted_by', 'summary', 'criteria', 'exceptions', 'expected_revision']);
  const unsupported = Object.keys(receipt).filter((key) => !allowed.has(key));
  if (unsupported.length) throw new Error(`Unsupported acceptance receipt fields: ${unsupported.join(', ')}`);
  if (typeof receipt.artifact !== 'string' && !isPlainObject(receipt.artifact)) throw new Error('artifact must be a non-empty string or object identifying the delivered result');
  const artifact = evidenceValue(receipt.artifact, 'artifact');
  const acceptedBy = text(receipt.accepted_by, 'accepted_by', { empty: false });
  if (record.acceptance_owner && record.acceptance_owner !== acceptedBy) {
    throw new Error(`Acceptance owner is '${record.acceptance_owner}'; accepted_by must match that owner`);
  }
  const summary = text(receipt.summary, 'summary', { empty: false });
  if (!Array.isArray(receipt.criteria)) throw new Error('Acceptance receipt criteria must be an array');
  const expected = normalizeAcceptanceCriteria(record.acceptance_criteria || [], record).acceptance_criteria;
  const expectedIds = new Set(expected.map((criterion) => criterion.id));
  const seen = new Set();
  const criteria = receipt.criteria.map((item) => {
    assertObject(item, 'Criterion evidence');
    const unsupportedFields = Object.keys(item).filter((key) => !['id', 'status', 'evidence', 'reason'].includes(key));
    if (unsupportedFields.length) throw new Error(`Unsupported criterion evidence fields: ${unsupportedFields.join(', ')}`);
    const id = normalizeCriterionId(item.id);
    if (!expectedIds.has(id)) throw new Error(`Unknown acceptance criterion ${id}`);
    if (seen.has(id)) throw new Error(`Duplicate evidence for acceptance criterion ${id}`);
    seen.add(id);
    if (!['satisfied', 'waived'].includes(item.status)) throw new Error(`${id} status must be satisfied or waived`);
    const result = { id, status: item.status };
    if (item.status === 'waived' || Object.hasOwn(item, 'reason')) result.reason = text(item.reason, `${id} waiver reason`, { empty: false });
    if (item.status === 'satisfied' || Object.hasOwn(item, 'evidence')) result.evidence = evidenceValue(item.evidence, `${id} evidence`);
    return result;
  });
  const missing = expected.filter((item) => !seen.has(item.id));
  if (missing.length) throw new Error(`Missing acceptance evidence: ${missing.map((item) => item.id).join(', ')}`);
  const acceptance = {
    artifact, accepted_by: acceptedBy, summary, criteria, accepted_at: timestamp,
    request_snapshot: request || requestSnapshot(record, { kind }),
    ...(Number.isInteger(record.revision) ? { request_revision: record.revision } : {}),
  };
  if (Object.hasOwn(receipt, 'exceptions')) {
    if (!Array.isArray(receipt.exceptions)) throw new Error('exceptions must be an array');
    acceptance.exceptions = receipt.exceptions.map((item) => {
      assertObject(item, 'Acceptance exception');
      if (Object.keys(item).some((key) => !['ref', 'reason'].includes(key))) throw new Error('Acceptance exceptions contain ref and reason');
      return { ref: text(item.ref, 'Exception ref', { empty: false }), reason: text(item.reason, 'Exception reason', { empty: false }) };
    });
  }
  return {
    acceptance,
    ...(record.acceptance ? { acceptance_history: [...(record.acceptance_history || []), { ...record.acceptance, superseded_at: timestamp }] } : {}),
    status: 'closed',
  };
}
