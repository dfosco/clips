import { discoverBoardGoals } from '../lib/board.js';
import { appendEvent, formatRef, readGoalWithTasks } from '../lib/core.js';
import { readJsonInput } from '../lib/json-input.js';
import { appendLaneEvent, laneToTrackId, listLanes, nextLaneId, normalizeLaneId, readLane, readLaneHistory, validateLane } from '../lib/lanes.js';
import { pushGoal, pushTrack } from '../lib/sync.js';
import { listLaneClaims, mutateLaneClaim, readLaneClaim } from '../lib/lane-claims.js';

const STATUSES = new Set(['open', 'in_progress', 'not_planned', 'duplicate']);

function parseLaneRef(ref) {
  const match = String(ref || '').match(/^#?([lr]\d+)(?:#r(\d+))?$/i);
  if (!match) throw new Error(`Invalid lane ref: ${ref}`);
  return { laneId: normalizeLaneId(match[1]), revision: match[2] ? Number(match[2]) : undefined };
}

function syncLane(laneId) {
  try { pushTrack(laneToTrackId(laneId)); }
  catch (error) { console.error(`sync: lane push failed for ${laneId}: ${error.message}`); }
}

function goalsForLane(laneId) {
  return discoverBoardGoals()
    .map(({ goalId, username }) => ({ goal: readGoalWithTasks(goalId, username), username }))
    .filter(({ goal }) => goal?.lane_id === laneId);
}

function laneWithGoals(lane) {
  const members = goalsForLane(lane.lane_id);
  const goals = members.map(({ goal, username }) => ({
    ref: formatRef({ username, goalId: goal.goal_id }, { includeUsername: !!username }),
    goal_id: goal.goal_id,
    title: goal.title,
    status: goal.status,
  }));
  return {
    ...lane,
    goals,
    goal_count: goals.length,
    completed_goal_count: goals.filter((goal) => goal.status === 'closed').length,
  };
}

function requireLane(ref) {
  const laneId = validateLane(ref);
  return laneId;
}

function stringList(value, name, { required = false } = {}) {
  if (value === undefined && !required) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${name} must be an array of nonempty strings`);
  }
  if (required && value.length === 0) throw new Error(`${name} must contain at least one entry`);
  return value.map((item) => item.trim());
}

function mediaList(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('media must be an array');
  return value.map((item) => {
    if (typeof item === 'string' && item.trim()) return { src: item.trim() };
    if (item && typeof item === 'object' && !Array.isArray(item) && typeof item.src === 'string' && item.src.trim()) {
      return { ...item, src: item.src.trim() };
    }
    throw new Error('media entries must be nonempty strings or objects with a nonempty src');
  });
}

function laneFields(data, { creating = false } = {}) {
  if (Object.hasOwn(data, 'acceptance_criteria')) {
    throw new Error('Lanes do not use technical acceptance criteria; use product_goals and goal acceptance instead');
  }
  const allowed = new Set(['title', 'description', 'product_goals']);
  const unsupported = Object.keys(data).filter((key) => !allowed.has(key));
  if (unsupported.length) throw new Error(`Unsupported lane fields: ${unsupported.join(', ')}`);
  const result = {};
  if (creating || Object.hasOwn(data, 'title')) {
    if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('Lane title is required');
    result.title = data.title.trim();
  }
  if (creating || Object.hasOwn(data, 'description')) {
    if (data.description !== undefined && typeof data.description !== 'string') throw new Error('description must be a string');
    result.description = data.description || '';
  }
  if (Object.hasOwn(data, 'product_goals')) result.product_goals = stringList(data.product_goals, 'product_goals');
  else if (creating) result.product_goals = [];
  return result;
}

function addGoals(laneRef, refs) {
  const laneId = requireLane(laneRef);
  if (!refs.length) throw new Error('Add at least one goal: clips lane <lane> add <goal...>');
  const goals = [];
  const seen = new Set();
  for (const ref of refs) {
    const match = String(ref).match(/^#?g(\d+)$/i);
    if (!match) throw new Error(`Invalid goal ref: ${ref}`);
    const goalId = `g${match[1].padStart(3, '0')}`;
    if (seen.has(goalId)) continue;
    seen.add(goalId);
    const goal = readGoalWithTasks(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    goals.push(goal);
  }

  const added = [], moved = [], unchanged = [];
  for (const goal of goals) {
    if (goal.lane_id === laneId) {
      unchanged.push(goal.goal_id);
      continue;
    }
    appendEvent(goal.goal_id, {
      event: 'updated',
      goal_id: goal.goal_id,
      timestamp: new Date().toISOString(),
      lane_id: laneId,
      track_id: laneToTrackId(laneId),
    });
    added.push(goal.goal_id);
    if (goal.lane_id) moved.push({ goal_id: goal.goal_id, from_lane_id: goal.lane_id });
  }
  for (const goalId of added) {
    try { pushGoal(goalId); }
    catch (error) { console.error(`sync: goal push failed for ${goalId}: ${error.message}`); }
  }
  console.log(JSON.stringify({ success: true, lane_id: laneId, added, moved, unchanged }));
}

function closeLane(ref, data) {
  const laneId = requireLane(ref);
  const lane = readLane(laneId);
  if (lane.status === 'closed') throw new Error(`Lane ${laneId} is already closed`);
  for (const field of ['summary', 'decision_log', 'system_overview']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`${field} must be a string`);
  }
  const productGoalsAchieved = stringList(data.product_goals_achieved, 'product_goals_achieved') || [];
  const explicitComponents = stringList(data.components, 'components') || [];
  const members = goalsForLane(laneId);
  const derivedComponents = new Set(explicitComponents);
  const goalDecisions = [];
  const goalSnapshot = [];
  for (const { goal, username } of members) {
    const ref = formatRef({ username, goalId: goal.goal_id }, { includeUsername: !!username });
    goalSnapshot.push({ ref, title: goal.title, status: goal.status });
    if (goal.decisions?.trim()) goalDecisions.push({ ref, title: goal.title, decisions: goal.decisions });
    for (const component of goal.components || []) derivedComponents.add(component);
    for (const task of Object.values(goal.tasks || {})) for (const component of task.components || []) derivedComponents.add(component);
  }
  const closure = {
    closed_at: new Date().toISOString(),
    summary: (data.summary || '').trim(),
    decision_log: (data.decision_log || '').trim(),
    goal_decisions: goalDecisions,
    system_overview: (data.system_overview || '').trim(),
    components: [...derivedComponents],
    product_goals_achieved: productGoalsAchieved,
    media: mediaList(data.media),
    goals: goalSnapshot,
  };
  appendLaneEvent(laneId, { event: 'lane_closed', status: 'closed', closure });
  syncLane(laneId);
  console.log(JSON.stringify({ success: true, lane_id: laneId, status: 'closed', closure }));
}

function fillLaneClosure(ref, data) {
  const laneId = requireLane(ref);
  const lane = readLane(laneId);
  if (lane.status !== 'closed' || !lane.closure) throw new Error(`Lane ${laneId} must be closed before its retrospective can be filled`);

  const updates = {};
  for (const field of ['summary', 'decision_log', 'system_overview']) {
    if (data[field] !== undefined && typeof data[field] !== 'string') throw new Error(`${field} must be a string`);
    if (!String(lane.closure[field] || '').trim() && typeof data[field] === 'string' && data[field].trim()) {
      updates[field] = data[field].trim();
    }
  }
  const productGoalsAchieved = stringList(data.product_goals_achieved, 'product_goals_achieved') || [];
  if (!(lane.closure.product_goals_achieved || []).length && productGoalsAchieved.length) {
    updates.product_goals_achieved = productGoalsAchieved;
  }

  if (Object.keys(updates).length) {
    appendLaneEvent(laneId, { event: 'lane_closure_updated', closure: updates });
    syncLane(laneId);
  }
  console.log(JSON.stringify({ success: true, lane_id: laneId, updated: Object.keys(updates).length > 0, fields: Object.keys(updates) }));
}

function runManagerCommand([action, ...rawArgs]) {
  const options = {};
  const args = [];
  for (let index = 0; index < rawArgs.length; index++) {
    if (rawArgs[index] === '--json') continue;
    args.push(rawArgs[index]);
  }
  if (action === 'list') {
    if (args.length) throw new Error('Usage: clips lane manager list [--json]');
    console.log(JSON.stringify(listLaneClaims(options), null, 2));
    return;
  }
  if (action === 'inspect') {
    if (args.length !== 1) throw new Error('Usage: clips lane manager inspect <lane> [--json]');
    const laneId = requireLane(args[0]);
    console.log(JSON.stringify(readLaneClaim(laneId, options), null, 2));
    return;
  }
  if (['claim', 'share', 'release', 'handover'].includes(action)) {
    const laneId = requireLane(args[0]);
    console.log(JSON.stringify(mutateLaneClaim(laneId, action, readJsonInput(args.slice(1)), options), null, 2));
    return;
  }
  console.log(`Usage: clips lane manager <command>

Commands (JSON output):
  list                      List this repository's Lane ownership and history
  inspect <lane>            Read ownership and revision (unclaimed starts at 0)
  claim <lane> <json>       Claim only an unowned Lane; never displaces a manager
  share <lane> <json>       Existing manager explicitly adds another owner
  release <lane> <json>     Release only the calling manager's own claim
  handover <lane> <json>    Replace one owner with explicit user authorization

All mutations require expected_revision and actor {host,runtime,session_id}.
Optional actor fields: workspace_id, contact. Use observed identities, not labels.
share/handover also require owner {host,runtime,session_id,...}.
handover requires authorization {by,reason}; optional from identifies an owner
being replaced when the calling actor is not that owner. Other owners remain.
JSON input: one argument, --file <path>, or --stdin.
Option: --json. Lanes are repository-global; usernames do not fork ownership.
Inspect and contact existing managers before overlapping work. Offline ownership
persists. Authorization records the user's instruction; it is not authentication.`);
}

export function runLaneCommand([action, ...args]) {
  if (action === 'manager') {
    runManagerCommand(args);
    return;
  }
  if (/^#?[lr]\d+$/i.test(action || '') && args[0] === 'add') {
    addGoals(action, args.slice(1));
    return;
  }
  if (action === 'create') {
    const data = laneFields(readJsonInput(args), { creating: true });
    const laneId = nextLaneId();
    appendLaneEvent(laneId, { event: 'lane_created', ...data, status: 'open' });
    syncLane(laneId);
    console.log(JSON.stringify({ success: true, lane_id: laneId }));
    return;
  }
  if (action === 'list') {
    console.log(JSON.stringify(listLanes().map(laneWithGoals), null, 2));
    return;
  }
  if (action === 'show') {
    const { laneId, revision } = parseLaneRef(args[0]);
    const lane = readLane(laneId, undefined, { revision });
    if (!lane) throw new Error(`Lane ${laneId} not found`);
    console.log(JSON.stringify(laneWithGoals(lane), null, 2));
    return;
  }
  if (action === 'history') {
    const { laneId, revision } = parseLaneRef(args[0]);
    const history = readLaneHistory(laneId, undefined, { revision });
    if (!history) throw new Error(`Lane ${laneId} not found`);
    console.log(JSON.stringify(history, null, 2));
    return;
  }
  if (action === 'update') {
    const laneId = requireLane(args[0]);
    const data = laneFields(readJsonInput(args.slice(1)));
    appendLaneEvent(laneId, { event: 'lane_updated', ...data });
    syncLane(laneId);
    console.log(JSON.stringify({ success: true, lane_id: laneId }));
    return;
  }
  if (action === 'close') {
    closeLane(args[0], readJsonInput(args.slice(1)));
    return;
  }
  if (action === 'closure' && args[0] === 'fill') {
    fillLaneClosure(args[1], readJsonInput(args.slice(2)));
    return;
  }
  if (action === 'status') {
    const laneId = requireLane(args[0]);
    const status = args[1];
    if (status === 'closed') throw new Error('Use clips lane close <lane> <json> so closure captures the strategic retrospective');
    if (!STATUSES.has(status)) throw new Error(`Invalid lane status: ${status}`);
    appendLaneEvent(laneId, { event: 'lane_status_changed', status });
    syncLane(laneId);
    console.log(JSON.stringify({ success: true, lane_id: laneId, status }));
    return;
  }
  console.log(`Usage: clips lane <command>

Commands:
  create <json>              Create a strategic lane
  update <lane> <json>       Update title, description, or product goals
  <lane> add <goal...>       Add or move goals into the lane
  show <lane[#rN]>           Show the lane and its goals
  history <lane[#rN]>        Show lane history
  manager <command>         Inspect, claim, share, release, or hand over management
  status <lane> <status>     Set open, in_progress, not_planned, or duplicate
  close <lane> <json>        Close with optional summary, decision log, system overview,
                             product_goals_achieved, and optional media/components
  closure fill <lane> <json> Fill only empty retrospective fields on a closed lane

Lane refs use #l1. Historical Track refs such as #r1 are accepted as aliases.`);
}
