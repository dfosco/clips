// Host-independent view boundary. Paseo references and parity cases: PARITY.md.
import { relatedSessions, sessionAssociations } from './model.mjs';

export const active = (status) => !['closed', 'not_planned', 'duplicate'].includes(status);
export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);


export function goalsForLane(lane, goals) {
  return Array.isArray(lane.goal_refs) ? goals.filter((goal) => lane.goal_refs.includes(goal.ref)) : goals.filter((goal) => goal.lane_id === lane.lane_id);
}
export function laneForFocus(state) {
  const lanes = state.lanes || [];
  const direct = lanes.find((lane) => lane.ref === state.focus);
  if (direct) return direct;
  const goal = (state.goals || []).find((goal) => goal.ref === state.focus || (goal.tasks || []).some((task) => task.ref === state.focus));
  return goal ? lanes.find((lane) => goalsForLane(lane, [goal]).length) : undefined;
}
export function sessionsFor(record, state) {
  return relatedSessions(record, state.projectSessions || [], state.workBindings || {});
}
export function executionFor(record, state) {
  const associations = sessionAssociations(record, state.projectSessions || [], state.workBindings || {});
  const sessions = associations.flatMap(({ session }) => session ? [session] : []);
  const status = sessions.some((s) => s.status === 'running') ? 'running' : sessions.some((s) => s.status === 'attention') ? 'attention' : sessions.some((s) => s.status === 'error') ? 'error' : sessions.length && sessions.every((s) => s.status === 'idle') ? 'idle' : sessions.length ? 'unknown' : associations.length ? 'unavailable' : 'none';
  return { sessions, associations, status };
}
export function goalGroup(lane, goals, filter, search, includeClosed, execution) {
  const query = search.toLowerCase().trim();
  const hit = (work) => !query || [work.ref, work.title, work.description, ...(work.labels || []).map((label) => label.name)].some((value) => String(value || '').toLowerCase().includes(query));
  const visible = (work, ancestorHit) => (filter === 'running' ? execution(work).status === 'running' : filter === 'all' || active(work.status) || (includeClosed && work.status === 'closed')) && (ancestorHit || hit(work));
  const parentHit = lane ? hit(lane) : false;
  const closedGoals = goals.filter((goal) => goal.status === 'closed');
  const entries = goals.filter((goal) => includeClosed || goal.status !== 'closed').map((goal) => {
    const tasks = (goal.tasks || []).filter((task) => visible(task, parentHit || hit(goal)));
    return { goal, tasks, shown: visible(goal, parentHit) || tasks.length > 0 };
  }).filter((entry) => entry.shown);
  const canRevealClosed = filter === 'open' && !includeClosed && closedGoals.length > 0 && (!query || parentHit || closedGoals.some((goal) => hit(goal) || (goal.tasks || []).some(hit)));
  const showLane = lane ? (filter !== 'open' || active(lane.status)) && (visible(lane, false) || entries.length > 0 || canRevealClosed) : entries.length > 0 || canRevealClosed;
  return { entries, closedGoals, canRevealClosed, showLane };
}
