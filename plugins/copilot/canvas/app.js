const params = new URLSearchParams(location.search);
const instanceId = params.get('instanceId');
const token = params.get('token');
// Module requests are independently authenticated; ESM does not inherit queries.
const { createBoardView, escapeHtml: e } = await import(`/canvas/board-view.mjs?${params}`).catch((error) => {
  document.getElementById('board-view').textContent = 'The new layout module could not load. Run extensions_reload in this Copilot session, then reopen Clips Work. Data Refresh does not reload provider modules.';
  throw error;
});
const $ = (selector) => document.querySelector(selector);
let currentState;
let selectedProjectPath = '';
let createKind;
let menuRef;
let closingRef;
let navigationVersion = 0;
let refreshVersion = 0;
let pendingMutations = 0;
let mutationQueue = Promise.resolve();
let renderedProject;

async function call(action, input = {}) {
  const response = await fetch(`/api/${encodeURIComponent(instanceId)}?token=${encodeURIComponent(token)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, input }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `Canvas request failed (${response.status}).`);
  return payload.result;
}
function showMessage(text, error = false) {
  const box = $('#message');
  box.hidden = false; box.className = `message ${error ? 'error' : ''}`; box.textContent = text;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { box.hidden = true; }, 6500);
}
function records() {
  return [...(currentState?.lanes || []).map((r) => ({ ...r, kind: 'lane' })), ...(currentState?.goals || []).map((g) => ({ ...g, kind: 'goal' })), ...(currentState?.goals || []).flatMap((g) => (g.tasks || []).map((t) => ({ ...t, kind: 'task', goal_ref: g.ref })))];
}
function record(ref) {
  const found = records().find((r) => r.ref === ref);
  if (!found) throw new Error('The record is no longer in this project. Refresh before acting.');
  return found;
}
async function openSession(sessionId) {
  try { const result = await call('open_session', { sessionId }); window.top.location.assign(result.url); }
  catch (error) { showMessage(error.message, true); }
}
const board = createBoardView($('#board-view'), {
  onFocus: (ref) => { void act(ref ? 'focus' : 'clear_focus', ref ? { ref } : {}); },
  onAction: (action, input) => { void act(action, input); },
  onOpenSession: openSession,
  onCommand: (command, ref, anchor) => {
    try {
      if (command === 'refresh') return void act('refresh');
      if (command === 'project') {
        $('#project-path-input').value = currentState?.projectPath || selectedProjectPath;
        return $('#project-dialog').showModal();
      }
      if (command === 'menu') return openMenu(ref, anchor);
      if (command.startsWith('create_')) return openCreate(command.slice(7));
    } catch (error) { showMessage(error.message, true); }
  },
});
function sessionHtml(session) {
  const id = session.id || session.sessionId;
  return `<article class="session-card"><div><strong>${e(session.summary || `Copilot session ${id}`)}</strong><code>${e(id)}</code><small>${e(session.statusLabel || 'Activity unavailable')}${session.appVisible === 'unverified' ? ' · App visibility unverified' : ''}</small><small>${e(session.workingDirectory || 'Working directory unavailable')}</small>${session.model?.modelId ? `<small>Model: ${e(session.model.modelId)}${session.model.reasoningEffort ? ` · ${e(session.model.reasoningEffort)}` : ''}${session.mode ? ` · ${e(typeof session.mode === 'string' ? session.mode : JSON.stringify(session.mode))}` : ''}</small>` : ''}</div><div class="session-actions"><button data-open-session="${e(id)}">${session.joined ? 'Open current session' : 'Open in Copilot App'}</button><button data-steer="${e(id)}" ${session.steerable ? '' : 'disabled'}>Steer</button></div></article>`;
}
function render() {
  if (renderedProject && renderedProject !== currentState.projectPath) {
    for (const id of ['record-menu-dialog', 'label-dialog', 'close-dialog', 'create-dialog']) {
      const dialog = document.getElementById(id);
      if (dialog.open) dialog.close();
    }
    menuRef = undefined; closingRef = undefined;
  }
  renderedProject = currentState.projectPath;
  selectedProjectPath = currentState.projectPath;
  board.update(currentState);
  const sessions = currentState.projectSessions || [];
  $('#session-count').textContent = sessions.length ? ` · ${sessions.length}` : '';
  const html = sessions.map(sessionHtml).join('') || '<p class="muted">No Copilot sessions are listed for this project.</p>';
  if ($('#project-sessions').innerHTML !== html) $('#project-sessions').innerHTML = html;
  $('#session-warnings').textContent = (currentState.warnings || []).join(' ');
  $('#session-warnings').hidden = !currentState.warnings?.length;
}
function act(action, input = {}) {
  if (action === 'refresh') {
    if (pendingMutations) return Promise.resolve(null);
    return runAction(action, input, navigationVersion, ++refreshVersion);
  }
  ++navigationVersion;
  ++pendingMutations;
  const projectAtRequest = currentState?.projectPath;
  const work = mutationQueue.then(() => runAction(action, input, undefined, undefined, projectAtRequest));
  mutationQueue = work.catch(() => {});
  return work.finally(() => { --pendingMutations; });
}
async function runAction(action, input, navigationAtStart, refreshAtStart, projectAtRequest) {
  try {
    if (action !== 'refresh' && action !== 'set_project' && currentState?.projectPath !== projectAtRequest) {
      throw new Error('The selected project changed before this action ran. Review the new project before acting.');
    }
    const result = await call(action, action === 'refresh' || action === 'set_project' ? input : { ...input, expectedProjectPath: projectAtRequest });
    if (action === 'refresh' && (navigationAtStart !== navigationVersion || refreshAtStart !== refreshVersion)) return null;
    currentState = result?.state || (action === 'refresh' ? result : await call('refresh'));
    render();
    if (action === 'launch') showMessage(`Sent work to current session ${result.session?.id || result.session?.sessionId}.`);
    else if (action === 'steer') showMessage('Message sent through the joined session.');
    else if (action === 'set_status') showMessage('Clips record status updated.');
    else if (action.endsWith('_label')) showMessage('Clips label assignment updated.');
    return result;
  } catch (error) { showMessage(error.message, true); return null; }
}
function openMenu(ref, anchor) {
  const work = record(ref);
  menuRef = ref;
  $('#menu-title').textContent = `${work.ref} · ${work.title}`;
  $('#menu-focus-lane').hidden = work.kind !== 'lane';
  $('#menu-new-task').hidden = work.kind !== 'goal';
  $('#menu-close-goal').hidden = work.kind !== 'goal' || work.status === 'closed';
  const statuses = ['open', 'in_progress', 'not_planned', 'duplicate'];
  // Keep the actual closed Lane value visible; Lane closure still needs its retrospective.
  if (work.status === 'closed' || work.kind === 'task') statuses.push('closed');
  $('#menu-status').innerHTML = statuses.map((status) => `<option value="${status}" ${work.status === status ? 'selected' : ''} ${work.kind === 'lane' && status === 'closed' ? 'disabled' : ''}>${e(status.replaceAll('_', ' '))}</option>`).join('');
  $('#record-menu-dialog').showModal();
  const rect = anchor.getBoundingClientRect();
  const dialog = $('#record-menu-dialog');
  dialog.style.left = `${Math.max(12, Math.min(rect.right - 260, window.innerWidth - 280))}px`;
  dialog.style.top = `${Math.max(12, Math.min(rect.bottom + 5, window.innerHeight - dialog.offsetHeight - 12))}px`;
}
function openLabels(ref) {
  const work = record(ref);
  menuRef = ref;
  $('#label-record').textContent = `${work.ref} · ${work.title}`;
  $('#label-choice').innerHTML = '<option value="">Choose label</option>' + (currentState.labels || []).map((l) => `<option value="${e(l.id)}">${e(l.name)}</option>`).join('');
  $('#assigned-label-choice').innerHTML = '<option value="">Choose assigned label</option>' + (work.labels || []).map((l) => `<option value="${e(l.id)}">${e(l.name)}</option>`).join('');
  $('#label-dialog').showModal();
}
function openCreate(kind, parentRef) {
  if (!currentState) return;
  createKind = kind;
  const title = `Create ${kind[0].toUpperCase() + kind.slice(1)}`;
  $('#create-title').textContent = title; $('#create-submit').textContent = title;
  $('#create-title-input').value = ''; $('#create-description').value = ''; $('#create-acceptance').value = '';
  $('#acceptance-field').hidden = kind !== 'task';
  const select = $('#parent-goal');
  if (kind === 'task') {
    select.innerHTML = (currentState.goals || []).map((goal) => `<option value="${e(goal.ref)}" ${parentRef === goal.ref ? 'selected' : ''}>${e(goal.title)} · ${e(goal.ref)}</option>`).join('');
    $('#parent-label-text').textContent = 'Parent Goal';
  } else if (kind === 'goal') {
    select.innerHTML = '<option value="">No Lane</option>' + (currentState.lanes || []).map((lane) => `<option value="${e(lane.ref)}" ${currentState.focus === lane.ref ? 'selected' : ''}>${e(lane.title)}</option>`).join('');
    $('#parent-label-text').textContent = 'Lane (optional)';
  }
  select.required = kind === 'task'; $('#parent-field').hidden = kind === 'lane';
  $('#create-dialog').showModal(); $('#create-title-input').focus();
}
for (const button of document.querySelectorAll('[data-close-dialog]')) button.addEventListener('click', () => button.closest('dialog').close());
$('#menu-focus-lane').addEventListener('click', () => { $('#record-menu-dialog').close(); void act('focus', { ref: menuRef }); });
$('#menu-labels').addEventListener('click', () => { $('#record-menu-dialog').close(); openLabels(menuRef); });
$('#menu-new-task').addEventListener('click', () => { $('#record-menu-dialog').close(); openCreate('task', menuRef); });
$('#menu-close-goal').addEventListener('click', () => {
  const work = record(menuRef); closingRef = menuRef;
  $('#record-menu-dialog').close(); $('#close-record-name').textContent = `${work.ref} · ${work.title}`; $('#close-dialog').showModal();
});
$('#close-confirm').addEventListener('click', async () => { if (await act('set_status', { ref: closingRef, status: 'closed' })) $('#close-dialog').close(); });
$('#menu-status-save').addEventListener('click', async () => { if (await act('set_status', { ref: menuRef, status: $('#menu-status').value })) $('#record-menu-dialog').close(); });
$('#add-label').addEventListener('click', async () => { if (await act('add_label', { ref: menuRef, labelId: $('#label-choice').value })) { $('#label-dialog').close(); openLabels(menuRef); } });
$('#remove-label').addEventListener('click', async () => { if (await act('remove_label', { ref: menuRef, labelId: $('#assigned-label-choice').value })) { $('#label-dialog').close(); openLabels(menuRef); } });
$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (await act('set_project', { projectPath: $('#project-path-input').value })) $('#project-dialog').close();
});
$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = { title: $('#create-title-input').value, description: $('#create-description').value };
  if (createKind === 'goal' && $('#parent-goal').value) input.lane_id = $('#parent-goal').value;
  if (createKind === 'task') { input.goal_ref = $('#parent-goal').value; input.acceptance_criteria = $('#create-acceptance').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
  if (await act(`create_${createKind}`, input)) $('#create-dialog').close();
});
$('#project-sessions').addEventListener('click', async (event) => {
  const button = event.target.closest('button');
  if (!button || button.disabled) return;
  if (button.dataset.openSession) return openSession(button.dataset.openSession);
  if (button.dataset.steer) {
    const prompt = window.prompt('Message to send to this joined Copilot session:');
    if (prompt?.trim()) await act('steer', { sessionId: button.dataset.steer, prompt });
  }
});
try {
  const context = await call('context'); selectedProjectPath = context.projectPath || '';
  const state = await call('refresh'); currentState = state; render();
} catch (error) {
  $('#board-view').innerHTML = `<p class="notice danger">Could not read the canonical Clips board: ${e(error.message)}</p><button id="repair-project">Choose project</button>`;
  $('#repair-project').addEventListener('click', () => { $('#project-path-input').value = selectedProjectPath; $('#project-dialog').showModal(); });
  if (/working directory|project path|No Clips store/i.test(error.message)) $('#project-dialog').showModal();
}
window.setInterval(() => { if (!document.hidden) void act('refresh'); }, 20000);
