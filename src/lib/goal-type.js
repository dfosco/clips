import fs from 'node:fs';
import path from 'node:path';

export const GOAL_TYPES = ['planning', 'building'];
export const DEFAULT_GOAL_TYPE = 'building';

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function normalizeGoalType(type) {
  const value = type === undefined ? DEFAULT_GOAL_TYPE : type;
  if (!GOAL_TYPES.includes(value)) {
    throw new Error(`Invalid goal type '${value}'. Valid: ${GOAL_TYPES.join(', ')}`);
  }
  return value;
}

export function goalTypeFields(data = {}, { defaultType = false } = {}) {
  if (!hasOwn(data, 'type')) return defaultType ? { type: DEFAULT_GOAL_TYPE } : {};
  return { type: normalizeGoalType(data.type) };
}

export function normalizeAdrId(adrId) {
  const value = String(adrId || '').toUpperCase();
  if (!/^ADR-\d+$/.test(value)) throw new Error('ADR ID must use the format ADR-NNN');
  return value;
}

export function adrRecordExists(recordsDir, adrId) {
  if (!recordsDir || !fs.existsSync(recordsDir)) return false;
  return [recordsDir, path.join(recordsDir, 'archived')].some((directory) => (
    fs.existsSync(directory) && fs.readdirSync(directory, { withFileTypes: true }).some((entry) => (
      entry.isFile()
      && entry.name.endsWith('.md')
      && (entry.name === `${adrId}.md` || entry.name.startsWith(`${adrId}-`))
    ))
  ));
}

export function goalCompletionError(goal, { recordsDir } = {}) {
  const type = normalizeGoalType(goal?.type);
  if (type === 'planning') {
    if (!goal?.adr_id) return 'Cannot close a planning goal until an ADR is attached';
    if (recordsDir && !adrRecordExists(recordsDir, goal.adr_id)) {
      return `Cannot close a planning goal because ${goal.adr_id} is missing from .clips/records/adr`;
    }
    return null;
  }

  const taskCount = Array.isArray(goal?.tasks)
    ? goal.tasks.length
    : Object.keys(goal?.tasks || {}).length;
  return taskCount > 0 ? null : 'Cannot close a building goal without tasks';
}
