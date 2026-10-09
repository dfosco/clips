import { appendTrackEvent, listTracks, nextTrackId, normalizeTrackId, readTrack } from '../lib/tracks.js';
import { discoverBoardGoals } from '../lib/board.js';
import { appendEvent, readGoalWithTasks } from '../lib/core.js';
import { pushGoal, pushTrack } from '../lib/sync.js';

const STATUSES = new Set(['open', 'in_progress', 'closed', 'not_planned', 'duplicate']);
function syncTrack(id) {
  try { pushTrack(id); }
  catch (error) { console.error(`sync: track push failed for ${id}: ${error.message}`); }
}

function requireTrack(ref) {
  const id = normalizeTrackId(ref);
  if (!readTrack(id)) throw new Error(`Track ${id} not found`);
  return id;
}

function trackWithGoals(track) {
  const goals = discoverBoardGoals().map(({ goalId, username }) => readGoalWithTasks(goalId, username))
    .filter((goal) => goal?.track_id === track.track_id)
    .map((goal) => ({ goal_id: goal.goal_id, title: goal.title, status: goal.status }));
  return { ...track, goals, goal_count: goals.length, completed_goal_count: goals.filter((goal) => goal.status === 'closed').length };
}

function addGoals(trackRef, refs) {
  const trackId = requireTrack(trackRef);
  if (!refs.length) throw new Error('Add at least one goal: clips track <track> add <goal...>');

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

  const added = [];
  const moved = [];
  const unchanged = [];
  for (const goal of goals) {
    if (goal.track_id === trackId) {
      unchanged.push(goal.goal_id);
      continue;
    }
    appendEvent(goal.goal_id, {
      event: 'updated',
      goal_id: goal.goal_id,
      timestamp: new Date().toISOString(),
      track_id: trackId,
    });
    added.push(goal.goal_id);
    if (goal.track_id) moved.push({ goal_id: goal.goal_id, from_track_id: goal.track_id });
  }
  for (const goalId of added) {
    try { pushGoal(goalId); }
    catch (error) { console.error(`sync: goal push failed for ${goalId}: ${error.message}`); }
  }
  console.log(JSON.stringify({ success: true, track_id: trackId, added, moved, unchanged }));
}

export function runTrackCommand([action, ...args]) {
  if (/^#?r\d+$/i.test(action || '') && args[0] === 'add') {
    addGoals(action, args.slice(1));
    return;
  }
  if (action === 'create') {
    const data = JSON.parse(args[0] || '{}');
    if (typeof data.title !== 'string' || !data.title.trim()) throw new Error('Track title is required');
    const id = nextTrackId();
    appendTrackEvent(id, { event: 'track_created', title: data.title.trim(), description: data.description || '', acceptance_criteria: data.acceptance_criteria || [], status: 'open' });
    syncTrack(id);
    console.log(JSON.stringify({ success: true, track_id: id }));
    return;
  }
  if (action === 'list') {
    console.log(JSON.stringify(listTracks().map(trackWithGoals), null, 2));
    return;
  }
  if (action === 'show') {
    console.log(JSON.stringify(trackWithGoals(readTrack(requireTrack(args[0]))), null, 2));
    return;
  }
  if (action === 'update') {
    const id = requireTrack(args[0]);
    const data = JSON.parse(args[1] || '{}');
    const allowed = ['title', 'description', 'acceptance_criteria'];
    if (Object.keys(data).some((key) => !allowed.includes(key))) throw new Error('Unsupported track field');
    if (Object.hasOwn(data, 'title') && (typeof data.title !== 'string' || !data.title.trim())) throw new Error('Track title is required');
    if (Object.hasOwn(data, 'acceptance_criteria') && (!Array.isArray(data.acceptance_criteria) || data.acceptance_criteria.some((value) => typeof value !== 'string'))) throw new Error('acceptance_criteria must be an array of strings');
    appendTrackEvent(id, { event: 'track_updated', ...data });
    syncTrack(id);
    console.log(JSON.stringify({ success: true, track_id: id }));
    return;
  }
  if (action === 'status') {
    const id = requireTrack(args[0]);
    if (!STATUSES.has(args[1])) throw new Error('Invalid track status');
    appendTrackEvent(id, { event: 'track_status_changed', status: args[1] });
    syncTrack(id);
    console.log(JSON.stringify({ success: true, track_id: id, status: args[1] }));
    return;
  }
  console.log('Usage: clips track <create JSON|update REF JSON|status REF STATUS|show REF|list|REF add GOAL...>');
}
