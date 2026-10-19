import { parseRef, formatRef, readGoalWithTasks, appendEvent } from '../lib/core.js';
import { discoverBoardGoals, parseGoalFile } from '../lib/board.js';
import { readTrack, trackPath } from '../lib/tracks.js';
import { laneToTrackId, listLanes, normalizeLaneId, trackToLaneId } from '../lib/lanes.js';
import { appendJsonEvent, withRecordLock } from '../lib/journal.js';
import { createLabel, updateLabel, readLabelConfig, labelCatalog, withLabelCatalog } from '../lib/labels.js';
import { readJsonInput } from '../lib/json-input.js';

export function assignLabel(ref, id, add) {
  return withLabelCatalog((catalog) => {
    // Removal also permits an orphan ID so damaged/imported assignments can be repaired.
    if (add && !catalog.some((l) => l.id === id)) throw new Error(`Label ${id} not found`);
    const apply = (record) => add ? [...new Set([...(record.label_ids || []), id])]
      : (record.label_ids || []).filter((value) => value !== id);
    if (/^#?[lr]\d+$/i.test(ref)) {
      const lane = normalizeLaneId(ref);
      const track = laneToTrackId(lane);
      return withRecordLock(trackPath(track), () => {
        const record = readTrack(track);
        if (!record) throw new Error(`Lane #${lane} not found`);
        const label_ids = apply(record);
        appendJsonEvent(trackPath(track), { event: 'lane_updated', lane_id: lane, track_id: track, label_ids, timestamp: new Date().toISOString() });
        return { ref: `#${lane}`, label_ids };
      });
    }
    const parsed = parseRef(ref);
    if (!parsed?.goalId || parsed.componentId || parsed.revision || parsed.criterionId || !/^g\d+$/.test(parsed.goalId)) {
      throw new Error('Labels require a current Lane, Goal, or full Task reference');
    }
    const goal = readGoalWithTasks(parsed.goalId, parsed.username);
    const record = parsed.taskId ? goal?.tasks[parsed.taskId] : goal;
    if (!record) throw new Error(`Record ${ref} not found`);
    const label_ids = apply(record);
    appendEvent(parsed.goalId, {
      event: parsed.taskId ? 'task_updated' : 'updated', goal_id: parsed.goalId,
      ...(parsed.taskId ? { task_id: parsed.taskId } : {}), label_ids, timestamp: new Date().toISOString(),
    }, { username: parsed.username, expectedRevision: record.revision });
    return { ref: formatRef(parsed), label_ids };
  });
}

function collectLabelUses(id) {
  const uses = [];
  for (const lane of listLanes()) {
    if (lane.label_ids?.includes(id)) uses.push({ ref: `#${lane.lane_id}`, kind: 'lane', status: lane.status || 'open' });
  }
  for (const entry of discoverBoardGoals()) {
    const goal = parseGoalFile(entry.filePath, entry.goalId);
    if (goal.label_ids?.includes(id)) uses.push({ ref: formatRef(entry), kind: 'goal', status: goal.status || 'open' });
    for (const task of Object.values(goal.tasks)) {
      if (task.label_ids?.includes(id)) uses.push({
        ref: formatRef({ ...entry, taskId: task.task_id }), kind: 'task', status: task.status || 'open',
      });
    }
  }
  return uses;
}

export function labelUses(id) {
  return withLabelCatalog((labels) => {
    if (!labels.some((label) => label.id === id)) throw new Error(`Label ${id} not found`);
    const uses = collectLabelUses(id);
    return { id, uses, count: uses.length };
  });
}

function replacementLabelIds(labelIds, sourceId, replacement) {
  const current = Array.isArray(labelIds) ? labelIds : [];
  const withoutSource = current.filter((value) => value !== sourceId);
  if (!replacement || replacement.kind === 'none') return withoutSource;
  return [...new Set([...withoutSource, replacement.id])];
}

function migrateUse(use, sourceId, replacement) {
  if (use.kind === 'lane') {
    const laneId = normalizeLaneId(use.ref);
    const trackId = laneToTrackId(laneId);
    return withRecordLock(trackPath(trackId), () => {
      const lane = readTrack(trackId);
      if (!lane) throw new Error(`Record ${use.ref} disappeared while replacing label ${sourceId}`);
      const label_ids = replacementLabelIds(lane.label_ids, sourceId, replacement);
      appendJsonEvent(trackPath(trackId), {
        event: 'lane_updated', lane_id: trackToLaneId(trackId), track_id: trackId,
        label_ids, timestamp: new Date().toISOString(),
      });
      return { ref: use.ref, label_ids };
    });
  }

  const parsed = parseRef(use.ref);
  if (!parsed?.goalId || !/^g\d+$/.test(parsed.goalId)) throw new Error(`Cannot update label use ${use.ref}`);
  const goal = readGoalWithTasks(parsed.goalId, parsed.username);
  const record = parsed.taskId ? goal?.tasks[parsed.taskId] : goal;
  if (!record) throw new Error(`Record ${use.ref} disappeared while replacing label ${sourceId}`);
  const label_ids = replacementLabelIds(record.label_ids, sourceId, replacement);
  appendEvent(parsed.goalId, {
    event: parsed.taskId ? 'task_updated' : 'updated', goal_id: parsed.goalId,
    ...(parsed.taskId ? { task_id: parsed.taskId } : {}), label_ids,
    // These replay events are metadata-only; carry the existing acceptance so
    // normal update invalidation does not reopen accepted closed work.
    acceptance: record.acceptance ?? null,
    timestamp: new Date().toISOString(),
  }, { username: parsed.username, expectedRevision: record.revision });
  return { ref: use.ref, label_ids };
}

export function deleteLabel(id, replacement) {
  return withLabelCatalog((labels, save, retired) => {
    if (!labels.some((label) => label.id === id)) throw new Error(`Label ${id} not found`);
    if (replacement?.kind === 'label') {
      if (replacement.id === id) throw new Error('A label cannot replace itself');
      if (!labels.some((label) => label.id === replacement.id)) throw new Error(`Replacement label ${replacement.id} not found or is no longer active`);
    } else if (replacement && replacement.kind !== 'none') {
      throw new Error('Choose an active replacement label or none');
    }

    const uses = collectLabelUses(id);
    if (uses.length && !replacement) {
      throw new Error(`Label ${id} is assigned to ${uses.map((use) => use.ref).join(', ')}. Remove those assignments or choose a replacement label before deleting it.`);
    }

    // The catalog lock held by withLabelCatalog also serializes label assignments.
    // Keep the source definition until every append succeeds. If a later append
    // fails, retrying scans the remaining uses and safely converges.
    const migrated = uses.map((use) => migrateUse(use, id, replacement));
    save(labels.filter((label) => label.id !== id), [...new Set([...retired, id])]);
    return { deleted: id, replacement: replacement || null, migrated };
  });
}

export function runLabelCommand([action, ...args]) {
  let result;
  switch (action) {
    case 'list':
      if (args.some((a) => a !== '--json')) throw new Error('Use clips label list [--json]');
      result = labelCatalog(readLabelConfig()); break;
    case 'create': result = createLabel(readJsonInput(args)); break;
    case 'edit':
    case 'update': result = updateLabel(args[0], readJsonInput(args.slice(1))); break;
    case 'recolor':
      if (args.length !== 2) throw new Error('Use clips label recolor <id> <#RRGGBB>');
      result = updateLabel(args[0], { color: args[1] }); break;
    case 'uses':
      if (args.length < 1 || args.slice(1).some((arg) => arg !== '--json')) throw new Error('Use clips label uses <id> [--json]');
      result = labelUses(args[0]); break;
    case 'delete': {
      if (!args.length) throw new Error('Use clips label delete <id> [--replace-with <active-id> | --remove-assignments]');
      let replacement;
      for (let index = 1; index < args.length; index += 1) {
        if (args[index] === '--replace-with' && args[index + 1] && !replacement) {
          replacement = { kind: 'label', id: args[index + 1] };
          index += 1;
        } else if (args[index] === '--remove-assignments' && !replacement) replacement = { kind: 'none' };
        else throw new Error('Use clips label delete <id> [--replace-with <active-id> | --remove-assignments]');
      }
      result = deleteLabel(args[0], replacement); break;
    }
    case 'add':
    case 'remove':
      if (args.length !== 2) throw new Error(`Use clips label ${action} <ref> <id>`);
      result = assignLabel(args[0], args[1], action === 'add'); break;
    default:
      if (action && !['--help', '-h'].includes(action)) throw new Error(`Unknown label command: ${action}`);
      console.log(`Usage: clips label <command>

  list [--json]             List the project catalog
  create <json>             Create {id?, name, color}; default id is a name slug
  edit <id> <json>          Edit {name?, color?}; id stays fixed
  recolor <id> <#RRGGBB>    Change a label color (quote # values)
  uses <id> [--json]        List current Lane, Goal, and Task uses
  delete <id> [replacement] Delete an unassigned label, or replace/remove its uses first
    --replace-with <id>     Move assignments to another active label
    --remove-assignments    Remove assignments (distinct from a label named "none")
  add <ref> <id>            Assign to a Lane, Goal, or full Task ref
  remove <ref> <id>         Remove an assignment; leaves the definition intact

Catalogs are project-scoped. Quote #refs. Names are unique ignoring case.
Assignments are journal events; labels do not change status or acceptance.`);
      return;
  }
  console.log(JSON.stringify(result));
}
