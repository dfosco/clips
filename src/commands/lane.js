import { discoverGoals } from '../lib/goal-discovery.js';
import { appendEvent, formatRef, readGoalWithTasks } from '../lib/core.js';
import { readJsonInput } from '../lib/json-input.js';
import { appendLaneEvent, laneToTrackId, listLanes, nextLaneId, normalizeLaneId, readLane, readLaneHistory, validateLane } from '../lib/lanes.js';
import { autoSyncGoal, autoSyncTrack } from '../lib/sync.js';
import { reportAutoSyncResult } from './sync-output.js';
import { listLaneClaims, mutateLaneClaim, readLaneClaim } from '../lib/lane-claims.js';
import { inspectManagerRegistrations, listManagerRegistrations, mutateManagerRegistration } from '../lib/lane-registrations.js';

const STATUSES = new Set(['open', 'in_progress', 'not_planned', 'duplicate']);

function parseLaneRef(ref) {
  const match = String(ref || '').match(/^#?([lr]\d+)(?:#r(\d+))?$/i);
  if (!match) throw new Error(`Invalid lane ref: ${ref}`);
  return { laneId: normalizeLaneId(match[1]), revision: match[2] ? Number(match[2]) : undefined };
}

function syncLane(laneId) {
  const result = autoSyncTrack(laneToTrackId(laneId));
  reportAutoSyncResult(result, `#${laneId}`);
}

function goalsForLane(laneId) {
  return discoverGoals()
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
  if (!refs.length) throw new Error('Add at least one goal: lanes lane <lane> add <goal...>');
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
    const result = autoSyncGoal(goalId);
    reportAutoSyncResult(result, `#${goalId}`);
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
  let all = false;
  for (let index = 0; index < rawArgs.length; index++) {
    if (rawArgs[index] === '--json') continue;
    if (rawArgs[index] === '--all') {
      if (all) throw new Error('--all may only be specified once');
      all = true;
      continue;
    }
    if (rawArgs[index] === '--project') {
      if (options.project || !rawArgs[index + 1] || rawArgs[index + 1].startsWith('--')) throw new Error('--project requires one project ID or explicit path');
      options.project = rawArgs[++index];
      continue;
    }
    args.push(rawArgs[index]);
  }
  if (all && (action !== 'list' || options.project)) throw new Error('--all is only supported by list, without --project');
  if (action === 'list') {
    if (args.length) throw new Error('Usage: lanes lane manager list [--all | --project <id-or-path>] [--json]');
    console.log(JSON.stringify(all || options.project ? listManagerRegistrations(options) : listLaneClaims(), null, 2));
    return;
  }
  if (action === 'inspect') {
    if (args.length !== 1) throw new Error('Usage: lanes lane manager inspect <lane> [--project <id-or-path>] [--json]');
    if (options.project) {
      console.log(JSON.stringify(inspectManagerRegistrations(args[0], options), null, 2));
      return;
    }
    const laneId = requireLane(args[0]);
    console.log(JSON.stringify(readLaneClaim(laneId), null, 2));
    return;
  }
  if (['register', 'unregister'].includes(action)) {
    if (!options.project) throw new Error(`${action} requires --project <id-or-path> and an explicit Lane`);
    console.log(JSON.stringify(mutateManagerRegistration(args[0], action, readJsonInput(args.slice(1)), options), null, 2));
    return;
  }
  if (['claim', 'share', 'release', 'handover'].includes(action)) {
    if (options.project) throw new Error('--project selects advisory registrations, not ownership mutations; run ownership commands in the target repository');
    const laneId = requireLane(args[0]);
    console.log(JSON.stringify(mutateLaneClaim(laneId, action, readJsonInput(args.slice(1))), null, 2));
    return;
  }
  console.log(`Usage: lanes lane manager <command>

Commands (JSON output):
  list                      List this repository's Lane ownership and history
  list --all                Discover central working associations from any cwd
  list --project <target>   List one project's working associations
  inspect <lane> --project <target>
                            Inspect Lane, ownership, registrations and warnings
  register <lane> --project <target> <json>
                            Create, refresh or reactivate your working association
  unregister <lane> --project <target> <json>
                            Stop only your association; retain its history
  inspect <lane>            Read ownership and revision (unclaimed starts at 0)
  claim <lane> <json>       Claim only an unowned Lane; never displaces a manager
  share <lane> <json>       Existing manager explicitly adds another owner
  release <lane> <json>     Release only the calling manager's own claim
  handover <lane> <json>    Replace one owner with explicit user authorization

Registration targets are project IDs or absolute/explicit relative paths.
Register/unregister require expected_revision and actor {runtime,session_id};
optional actor fields: host, workspace_id, contact. Supply observed values only.
Registration revision is per actor, repository and Lane; absent starts at 0.
Register accepts optional runtime_observation {status,observed_at,source}.
Stored status working/stopped is not live status. Native live_status is unknown;
timestamps describe saved observations, not a lease, heartbeat or scheduler.
Global reads retain stale associations and report unavailable/corrupt state.
Registration never claims, releases, or replaces ownership.
Actor identity is asserted by the caller, not authenticated by this CLI.

Ownership mutations require expected_revision and actor {host,runtime,session_id}.
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
    if (status === 'closed') throw new Error('Use lanes lane close <lane> <json> so closure captures the strategic retrospective');
    if (!STATUSES.has(status)) throw new Error(`Invalid lane status: ${status}`);
    appendLaneEvent(laneId, { event: 'lane_status_changed', status });
    syncLane(laneId);
    console.log(JSON.stringify({ success: true, lane_id: laneId, status }));
    return;
  }
  console.log(`Usage: lanes lane <command>

Commands:
  create <json>              Create a strategic lane
  update <lane> <json>       Update title, description, or product goals
  <lane> add <goal...>       Add or move goals into the lane
  show <lane[#rN]>           Show the lane and its goals
  history <lane[#rN]>        Show lane history
  manager <command>         Discover/register working managers or manage ownership
  status <lane> <status>     Set open, in_progress, not_planned, or duplicate
  close <lane> <json>        Close with optional summary, decision log, system overview,
                             product_goals_achieved, and optional media/components
  closure fill <lane> <json> Fill only empty retrospective fields on a closed lane

Lane refs use #l1. Historical Track refs such as #r1 are accepted as aliases.
Host identity and Lane claims are not prerequisites for work.
Work ownership is advisory; storage and revision protections still apply.`);
}
