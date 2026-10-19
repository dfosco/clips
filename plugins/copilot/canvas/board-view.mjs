// Host-independent view boundary. Paseo references and parity cases: PARITY.md.
export const active = (status) => !['closed', 'not_planned', 'duplicate'].includes(status);
export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const e = escapeHtml;
const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ chevron: '<path d="m9 5 7 7-7 7"/>', back: '<path d="M19 12H5m6-6-6 6 6 6"/>', refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/>', more: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>', project: '<path d="M3 7h7l2-3h9v16H3Z"/>', plus: '<path d="M12 5v14M5 12h14"/>' })[name] || ''}</svg>`;

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
  const claimed = new Set(record.kind === 'lane' ? (record.manager_claim?.owners || []).filter((owner) => owner.runtime === 'copilot-sdk').map((owner) => owner.session_id) : []);
  return (state.projectSessions || []).filter((session) => session.recordRef === record.ref || claimed.has(session.id || session.sessionId));
}
export function executionFor(record, state) {
  const sessions = sessionsFor(record, state);
  const status = sessions.some((s) => s.status === 'running') ? 'running' : sessions.some((s) => s.status === 'attention') ? 'attention' : sessions.some((s) => s.status === 'error') ? 'error' : sessions.length && sessions.every((s) => s.status === 'idle') ? 'idle' : sessions.length ? 'unknown' : 'none';
  return { sessions, status };
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
const labels = (record) => (record.labels || []).map((label) => `<span class="label-chip" style="--label:${/^#[0-9a-f]{6}$/i.test(label.color) ? label.color : '#8a8f98'}"><span aria-hidden="true"></span>${e(label.name || label.id)}</span>`).join('');
const statusText = (status) => ({ in_progress: 'In Progress', not_planned: 'Not planned', duplicate: 'Duplicate', closed: 'Closed', open: 'Open' })[status] || status || 'Open';
const expanded = (record, ui) => ui.expanded.get(record.ref) ?? (record.kind === 'goal' && (Boolean(ui.search.trim()) || ui.filter === 'running'));
function description(record, ui) {
  const text = String(record.description || '').trim();
  if (!text) return '';
  const long = text.length > 240;
  const full = ui.descriptions.has(record.ref);
  return `<div class="record-context"><p>${e(long && !full ? text.slice(0, 240).trimEnd() + '…' : text)}</p>${long ? `<button class="text-action" data-description="${e(record.ref)}" aria-expanded="${full}">${full ? 'Show less' : 'Show more'}</button>` : ''}</div>`;
}
function actions(record, state) {
  const { sessions, status } = executionFor(record, state);
  const owners = record.kind === 'lane' ? record.manager_claim?.owners || [] : [];
  const label = ({ running: `Running · ${sessions.filter((s) => s.status === 'running').length} agent${sessions.filter((s) => s.status === 'running').length === 1 ? '' : 's'}`, attention: 'Needs input', error: 'Session error', idle: 'Session idle', unknown: 'Activity unavailable', none: owners.length ? 'Manager unavailable' : 'No bound session' })[status];
  const currentId = state.hostCapabilities?.currentSessionId;
  const conflicting = (state.projectSessions || []).some((s) => (s.id || s.sessionId) === currentId && s.recordRef && (s.recordKind !== 'lane' || record.kind !== 'lane') && s.recordRef !== record.ref);
  const canSend = active(record.status) && state.hostCapabilities?.canSendToCurrentSession && !conflicting && !sessions.length && (record.kind !== 'lane' || (state.hostCapabilities?.hostIdConfigured && !owners.length && record.manager_claim && !record.manager_claim_error));
  const reason = !active(record.status) ? 'This record is not open.' : conflicting ? 'This session already owns other work. Open a separate session.' : record.kind === 'lane' && !state.hostCapabilities?.hostIdConfigured ? 'An observed host identity is required for Lane management.' : 'Work is sent to this current joined session; no session is created.';
  return `<div class="work-actions"><span class="runtime-status ${status}"><span class="status-dot" aria-hidden="true"></span>${e(label)}</span>${sessions.slice(0, 1).map((s) => `<button class="quiet" data-session="${e(s.id || s.sessionId)}">${s.joined ? 'Open current session' : 'Open session'}</button>`).join('')}${!sessions.length ? `<button class="primary" data-send="${e(record.ref)}" ${canSend ? '' : 'disabled'} title="${e(reason)}">${record.kind === 'lane' ? 'Use as manager' : 'Send to this session'}</button>` : ''}<button class="icon-button record-menu-trigger" data-menu="${e(record.ref)}" aria-label="More actions for ${e(record.ref)}">${icon('more')}</button></div>`;
}
function criteria(record) {
  if (!record.acceptance_criteria?.length) return '';
  return `<section class="criteria"><h3>Acceptance criteria</h3>${record.acceptance_criteria.map((criterion, i) => `<p>${e(typeof criterion === 'string' ? criterion : `${criterion.id || `A${i + 1}`} · ${criterion.description}`)}</p>`).join('')}</section>`;
}
function workCard(record, state, ui, tasks = []) {
  const isExpanded = expanded(record, ui);
  const isLane = record.kind === 'lane';
  const details = ['scope', 'plan', 'decisions'].filter((field) => record[field]).map((field) => `<section class="record-context"><h3>${field[0].toUpperCase() + field.slice(1)}</h3><p>${e(record[field])}</p></section>`).join('');
  const body = `<div class="work-row"><div class="record-heading"><button class="disclosure ${isExpanded ? 'expanded' : ''}" data-expand="${e(record.ref)}" aria-label="${isExpanded ? 'Collapse' : 'Expand'} ${record.kind} ${e(record.ref)}" aria-expanded="${isExpanded}">${icon('chevron')}</button><div class="record-title"><div class="record-meta">${e(record.ref)} <span>${e(statusText(record.status))}</span></div>${isLane ? `<button class="lane-title" data-lane="${e(record.ref)}" title="Focus Lane">${e(record.title)}</button>` : `<button class="goal-title" data-expand="${e(record.ref)}" aria-expanded="${isExpanded}">${e(record.title)}</button>`}<div class="labels">${labels(record)}</div></div></div>${actions(record, state)}${description(record, ui)}${isExpanded ? `${criteria(record)}${details}${record.blocked_by?.length ? `<p class="notice">Blocked by ${e(record.blocked_by.join(', '))}</p>` : ''}` : ''}</div>`;
  return `<article class="work-card ${record.kind}" data-record="${e(record.ref)}">${body}${record.kind === 'goal' && isExpanded ? `<div class="goal-tasks">${tasks.map((task) => workCard({ ...task, kind: 'task' }, state, ui)).join('') || `<p class="empty">${record.tasks?.length ? 'No Tasks match the current filter.' : 'No Tasks in this Goal yet.'}</p>`}</div>` : ''}</article>`;
}
const closedToggle = (key, group, ui) => ui.filter === 'open' && group.closedGoals.length ? `<button class="text-action closed-toggle" data-closed="${e(key)}">${ui.closed.has(key) ? 'Hide closed goals' : 'Show closed goals'}</button>` : '';
function emptyGroup(group, goals) { return `<p class="empty">${!goals.length ? 'No Goals in this lane yet.' : group.canRevealClosed ? (group.closedGoals.length === goals.length ? 'All goals are closed.' : 'Closed goals are hidden.') : 'No Goals match the current filter.'}</p>`; }
export function renderBoard(state, ui) {
  const lane = laneForFocus(state);
  const allGoals = state.goals || [];
  const scopedGoals = lane ? goalsForLane(lane, allGoals) : allGoals;
  const scopedLanes = lane ? [lane] : state.lanes || [];
  const records = [...scopedLanes.map((r) => ({ ...r, kind: 'lane' })), ...scopedGoals.map((r) => ({ ...r, kind: 'goal' })), ...scopedGoals.flatMap((g) => (g.tasks || []).map((r) => ({ ...r, kind: 'task' })))];
  const running = (kind) => records.filter((r) => r.kind === kind && executionFor(r, state).status === 'running').length;
  const runningSessions = new Set(records.flatMap((r) => sessionsFor(r, state)).filter((s) => s.status === 'running').map((s) => s.id || s.sessionId));
  const exec = (record) => executionFor(record, state);
  const group = (parent, goals, key) => goalGroup(parent, goals, ui.filter, ui.search, ui.filter !== 'open' || ui.closed.has(key), exec);
  let columns;
  if (lane) {
    const grouped = group(lane, scopedGoals, lane.ref);
    columns = `${closedToggle(lane.ref, grouped, ui)}<div class="board-columns goal-columns" data-scroll-key="goals:${e(lane.ref)}" aria-label="Lane goals">${grouped.entries.map(({ goal, tasks }) => `<section class="board-column">${workCard({ ...goal, kind: 'goal' }, state, ui, tasks)}</section>`).join('') || emptyGroup(grouped, scopedGoals)}</div>`;
  } else {
    const assigned = new Set((state.lanes || []).flatMap((l) => goalsForLane(l, allGoals).map((g) => g.ref)));
    const groups = [...(state.lanes || []).map((l) => ({ lane: l, goals: goalsForLane(l, allGoals), key: l.ref })), { lane: null, goals: allGoals.filter((g) => !assigned.has(g.ref)), key: 'unassigned' }];
    columns = `<div class="board-columns lane-columns" data-scroll-key="lanes" aria-label="Project lanes">${groups.map(({ lane: l, goals, key }) => {
      const grouped = group(l ? { ...l, kind: 'lane' } : null, goals, key);
      if (!grouped.showLane) return '';
      return `<section class="board-column" data-lane-column="${e(key)}">${l ? workCard({ ...l, kind: 'lane' }, state, ui) : '<h2 class="unassigned-title">Goals outside Lanes</h2>'}${closedToggle(key, grouped, ui)}<div class="lane-goals">${grouped.entries.map(({ goal, tasks }) => workCard({ ...goal, kind: 'goal' }, state, ui, tasks)).join('') || emptyGroup(grouped, goals)}</div></section>`;
    }).join('') || '<p class="empty">No Clips work matches this filter.</p>'}</div>`;
  }
  const projectRoot = (state.projectSessions || []).find((s) => s.joined)?.gitRoot || state.projectPath || '';
  const projectName = projectRoot.split(/[\\/]/).filter(Boolean).at(-1) || 'Choose project';
  return `${lane ? `<button class="back-link" data-back>${icon('back')}Back to Clips</button>` : ''}<header class="work-header"><div><h1>${e(lane?.title || 'Clips')}</h1><p>${lane ? `${e(lane.ref)} · Goals and Tasks` : 'Plan in Clips · Execute in Copilot'}</p>${lane ? `<div class="labels">${labels(lane)}</div>` : ''}</div><div class="top-actions">${lane ? `<button class="icon-button" data-menu="${e(lane.ref)}" aria-label="More actions for Lane">${icon('more')}</button>` : ''}<button class="icon-button" data-command="refresh" aria-label="Refresh Clips">${icon('refresh')}</button><button class="icon-button" data-command="project" aria-label="Choose project">${icon('project')}</button><button class="icon-button" data-command="create_goal" aria-label="New Goal">${icon('plus')}</button></div></header>${lane ? description({ ...lane, kind: 'lane' }, ui) : ''}<div class="project-picker"><button class="project-tab selected" data-command="project" title="${e(state.projectPath)}">${e(projectName)}</button><button class="text-action" data-command="create_lane">New Lane</button></div><section class="work-filters" aria-label="Work filters"><strong>Running now · ${running('task')} Tasks, ${running('goal')} Goals, ${running('lane')} Lanes</strong><input type="search" data-control-key="search" aria-label="Search Clips work" placeholder="${lane ? 'Search this lane’s Goals and Tasks' : 'Search Lanes, Goals and Tasks'}" value="${e(ui.search)}"><div class="filter-chips">${['open', 'running', 'all'].map((filter) => `<button data-filter="${filter}" aria-pressed="${ui.filter === filter}" class="filter-chip ${ui.filter === filter ? 'selected' : ''}">${filter[0].toUpperCase() + filter.slice(1)}${filter === 'running' && runningSessions.size ? ` · ${runningSessions.size}` : ''}</button>`).join('')}</div></section>${columns}`;
}

export function createBoardView(element, { onFocus, onAction, onCommand, onOpenSession } = {}) {
  let state;
  let project;
  let lastHtml;
  let lastFocus;
  const ui = { search: '', filter: 'open', expanded: new Map(), descriptions: new Set(), closed: new Set() };
  const doc = element.ownerDocument;
  function render() {
    const html = renderBoard(state, ui);
    if (html === lastHtml) return;
    const focused = element.contains(doc.activeElement) ? doc.activeElement : null;
    const key = focused?.dataset.controlKey;
    const selection = key && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    const scrolls = [...element.querySelectorAll('[data-scroll-key]')].map((node) => [node.dataset.scrollKey, node.scrollLeft, node.scrollTop]);
    element.innerHTML = html;
    lastHtml = html;
    for (const [scrollKey, x, y] of scrolls) {
      const node = [...element.querySelectorAll('[data-scroll-key]')].find((node) => node.dataset.scrollKey === scrollKey);
      if (node) { node.scrollLeft = x; node.scrollTop = y; }
    }
    if (key) {
      const node = [...element.querySelectorAll('[data-control-key]')].find((node) => node.dataset.controlKey === key);
      node?.focus({ preventScroll: true });
      if (selection) { try { node.setSelectionRange(...selection); } catch { /* Search controls need not support a selection range. */ } }
    }
  }
  element.addEventListener('input', (event) => {
    if (event.target.dataset.controlKey !== 'search') return;
    ui.search = event.target.value;
    render();
  });
  element.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const data = button.dataset;
    if ('back' in data) return void onFocus?.(null);
    if (data.lane) return void onFocus?.(data.lane);
    if (data.command) return void onCommand?.(data.command, null, button);
    if (data.menu) return void onCommand?.('menu', data.menu, button);
    if (data.session) return void onOpenSession?.(data.session);
    if (data.send) return void onAction?.('launch', { ref: data.send });
    if (data.filter) ui.filter = data.filter;
    if (data.closed) ui.closed.has(data.closed) ? ui.closed.delete(data.closed) : ui.closed.add(data.closed);
    if (data.description) ui.descriptions.has(data.description) ? ui.descriptions.delete(data.description) : ui.descriptions.add(data.description);
    if (data.expand) {
      const record = [...(state.lanes || []).map((r) => ({ ...r, kind: 'lane' })), ...(state.goals || []).map((r) => ({ ...r, kind: 'goal' })), ...(state.goals || []).flatMap((g) => (g.tasks || []).map((r) => ({ ...r, kind: 'task' })))].find((r) => r.ref === data.expand);
      if (record) ui.expanded.set(record.ref, !expanded(record, ui));
    }
    render();
  });
  return {
    update(next) {
      if (project !== next.projectPath) {
        project = next.projectPath;
        lastFocus = undefined;
        ui.expanded.clear(); ui.descriptions.clear(); ui.closed.clear(); ui.search = ''; ui.filter = 'open';
      }
      state = next;
      // Old agent/programmatic Goal/Task focus becomes Lane context + inline details.
      const oldGoal = (state.goals || []).find((g) => g.ref === state.focus || (g.tasks || []).some((t) => t.ref === state.focus));
      if (oldGoal && state.focus !== lastFocus) {
        ui.search = '';
        ui.filter = 'open';
        ui.expanded.set(oldGoal.ref, true);
        if (state.focus !== oldGoal.ref) ui.expanded.set(state.focus, true);
        const parent = laneForFocus(state);
        const selectedTask = (oldGoal.tasks || []).find((task) => task.ref === state.focus);
        if ([oldGoal, selectedTask].some((record) => record && !active(record.status) && record.status !== 'closed')) ui.filter = 'all';
        else if (oldGoal.status === 'closed' || selectedTask?.status === 'closed') ui.closed.add(parent?.ref || 'unassigned');
      }
      lastFocus = state.focus;
      render();
    },
    ui,
  };
}
