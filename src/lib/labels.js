import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { getConfigPath, writeConfig } from './config.js';
import { getRepoRoot } from './core.js';
import { withRecordLock } from './journal.js';

const ID = /^[a-z0-9][a-z0-9_-]{0,79}$/;

export function validateLabel(label) {
  if (!label || typeof label !== 'object' || typeof label.id !== 'string' || !ID.test(label.id)) throw new Error('Label id must be a lowercase slug (up to 80 characters)');
  if (typeof label.name !== 'string' || !label.name.trim() || label.name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(label.name)) {
    throw new Error('Label name must be nonempty text up to 80 characters');
  }
  if (typeof label.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(label.color)) throw new Error('Label color must be #RRGGBB');
  return { ...label, name: label.name.trim(), color: label.color.toLowerCase() };
}

export function labelCatalog(config) {
  const labels = config.labels ?? [];
  if (!Array.isArray(labels)) throw new Error('Project labels must be an array');
  const result = labels.map(validateLabel);
  if (new Set(result.map((l) => l.id)).size !== result.length) throw new Error('Duplicate label id');
  if (new Set(result.map((l) => l.name.toLowerCase())).size !== result.length) throw new Error('Duplicate label name');
  return result;
}

// Mutations fail on malformed configuration rather than replacing it with defaults.
export function readLabelConfig(repoRoot = getRepoRoot()) {
  const file = getConfigPath(repoRoot);
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Project config must be an object');
  return config;
}

export function withLabelCatalog(operation, repoRoot = getRepoRoot()) {
  return withRecordLock(getConfigPath(repoRoot), () => {
    const config = readLabelConfig(repoRoot);
    const retired = config.label_retired_ids ?? [];
    if (!Array.isArray(retired) || retired.some((id) => typeof id !== 'string' || !ID.test(id))) throw new Error('Invalid retired label ids');
    return operation(labelCatalog(config), (labels, retiredIds = retired) => writeConfig({
      ...config, labels: labelCatalog({ labels }), label_retired_ids: retiredIds,
    }, repoRoot), retired);
  });
}

export function projectLabels(record, catalog) {
  const ids = Array.isArray(record.label_ids) ? record.label_ids : [];
  return { ...record, label_ids: ids, labels: ids.map((id) => catalog.find((l) => l.id === id)).filter(Boolean) };
}

export function projectGoalLabels(goal, catalog) {
  return { ...projectLabels(goal, catalog), tasks: Object.fromEntries(Object.entries(goal.tasks || {}).map(([id, task]) => [id, projectLabels(task, catalog)])) };
}

export function createLabel(data, repoRoot) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Provide a label object');
  const slug = String(data.name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = data.id ?? (slug || `label-${randomUUID().slice(0, 8)}`);
  const label = validateLabel({ id, name: data.name, color: data.color });
  return withLabelCatalog((labels, save, retired) => {
    if (retired.includes(label.id)) {
      if (data.id !== undefined) throw new Error(`Label id ${label.id} is retired; supply a new id to preserve historical identity`);
      label.id = `${label.id.slice(0, 65)}-${randomUUID().slice(0, 8)}`;
    }
    save([...labels, label]);
    return label;
  }, repoRoot);
}

export function updateLabel(id, data, repoRoot) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some((k) => !['name', 'color'].includes(k))) {
    throw new Error('Label updates accept name and color only; identities are immutable');
  }
  return withLabelCatalog((labels, save) => {
    const old = labels.find((l) => l.id === id);
    if (!old) throw new Error(`Label ${id} not found`);
    const label = validateLabel({ ...old, ...data });
    save(labels.map((l) => l.id === id ? label : l));
    return label;
  }, repoRoot);
}
