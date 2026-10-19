import { parseRef, formatRef, readGoalWithTasks, appendEvent } from '../lib/core.js';
import { discoverBoardGoals, parseGoalFile } from '../lib/board.js';
import { readTrack, trackPath } from '../lib/tracks.js';
import { laneToTrackId, listLanes, normalizeLaneId } from '../lib/lanes.js';
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

export function deleteLabel(id) {
  return withLabelCatalog((labels, save, retired) => {
    if (!labels.some((l) => l.id === id)) throw new Error(`Label ${id} not found`);
    const assigned = [];
    for (const lane of listLanes()) if (lane.label_ids?.includes(id)) assigned.push(`#${lane.lane_id}`);
    for (const entry of discoverBoardGoals()) {
      const goal = parseGoalFile(entry.filePath, entry.goalId);
      if (goal.label_ids?.includes(id)) assigned.push(formatRef(entry));
      for (const task of Object.values(goal.tasks)) if (task.label_ids?.includes(id)) assigned.push(formatRef({ ...entry, taskId: task.task_id }));
    }
    if (assigned.length) throw new Error(`Label ${id} is assigned to ${assigned.join(', ')}. Remove those assignments before deleting it.`);
    save(labels.filter((l) => l.id !== id), [...new Set([...retired, id])]);
    return { deleted: id };
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
    case 'delete':
      if (args.length !== 1) throw new Error('Use clips label delete <id>');
      result = deleteLabel(args[0]); break;
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
  delete <id>               Delete an unassigned definition; assigned labels are refused
  add <ref> <id>            Assign to a Lane, Goal, or full Task ref
  remove <ref> <id>         Remove an assignment; leaves the definition intact

Catalogs are project-scoped. Quote #refs. Names are unique ignoring case.
Assignments are journal events; labels do not change status or acceptance.`);
      return;
  }
  console.log(JSON.stringify(result));
}
