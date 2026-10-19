const params = new URLSearchParams(location.search);
const instanceId = params.get('instanceId');
const token = params.get('token');
const $ = (selector) => document.querySelector(selector);
let currentState = null;
let createKind = null;

async function call(action, input = {}) {
  const response = await fetch(`/api/${encodeURIComponent(instanceId)}?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, input }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || `Canvas request failed (${response.status}).`);
  return payload.result;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function statusLabel(status) {
  return status || 'open';
}

function labelBadges(record) {
  return (record.labels || []).map((label) => `<span class="label-chip" style="--label:${escapeHtml(label.color || '#8a8f98')}">${escapeHtml(label.name || label.id)}</span>`).join('');
}

function recordButton(record, selected = false) {
  const type = record.kind === 'lane' ? 'Lane' : record.kind === 'task' ? 'Task' : 'Goal';
  const status = record.kind === 'lane' ? (record.status || 'open') : statusLabel(record.status);
  return `<button class="record-link ${selected ? 'selected' : ''}" data-focus="${escapeHtml(record.ref)}" type="button">
    <span class="record-title"><span class="kind-dot ${record.kind}"></span><span class="title-text">${escapeHtml(record.title || record.ref)}</span></span>
    <span class="record-meta"><span>${type}</span><span>${escapeHtml(status)}</span></span>
    ${labelBadges(record)}
  </button>`;
}

function renderTree() {
  const lanes = currentState.lanes || [];
  const goals = currentState.goals || [];
  const used = new Set();
  const sections = lanes.map((lane) => {
    const laneGoals = goals.filter((goal) => goal.lane_id === lane.lane_id);
    laneGoals.forEach((goal) => used.add(goal.ref));
    const expandedGoal = currentState.focus === lane.ref ? null : laneGoals.find((goal) => goal.ref === currentState.focus);
    const goalItems = laneGoals.map((goal) => {
      const taskList = currentState.focus === goal.ref
        ? `<div class="task-list" aria-label="Tasks for focused Goal">${(goal.tasks || []).map((task) => recordButton({ ...task, kind: 'task' }, currentState.focus === task.ref)).join('')}</div>`
        : '';
      return `<div class="goal-branch">${recordButton({ ...goal, kind: 'goal' }, currentState.focus === goal.ref || currentState.focus === expandedGoal?.ref)}${taskList}</div>`;
    }).join('');
    return `<section class="tree-section"><div class="tree-lane">${recordButton({ ...lane, kind: 'lane' }, currentState.focus === lane.ref)}</div>${goalItems || '<p class="empty-tree">No Goals in this Lane.</p>'}</section>`;
  }).join('');
  const unassigned = goals.filter((goal) => !used.has(goal.ref));
  const unassignedHtml = unassigned.length ? `<section class="tree-section"><h2>Unassigned Goals</h2>${unassigned.map((goal) => `<div class="goal-branch">${recordButton({ ...goal, kind: 'goal' }, currentState.focus === goal.ref)}${currentState.focus === goal.ref ? `<div class="task-list" aria-label="Tasks for focused Goal">${(goal.tasks || []).map((task) => recordButton({ ...task, kind: 'task' }, currentState.focus === task.ref)).join('')}</div>` : ''}</div>`).join('')}</section>` : '';
  $('#record-tree').innerHTML = `${sections}${unassignedHtml}${!sections && !unassignedHtml ? '<p class="empty-tree">No Lanes or Goals yet. Create one to begin.</p>' : ''}`;
  document.querySelectorAll('[data-focus]').forEach((button) => button.addEventListener('click', () => act('focus', { ref: button.dataset.focus })));
}

function sessionCard(session, claimed = false) {
  const id = session.id || session.sessionId;
  const title = session.summary || `Copilot session ${id}`;
  const ownerContact = session.contact ? `<small>${escapeHtml(session.contact)}</small>` : '';
  const navigable = session.navigationUrl;
  const navigationLabel = session.appVisible === 'verified_by_host_check' ? 'Go to agent' : 'Open in Copilot App';
  const navigationNote = session.appVisible === 'verified_by_host_check'
    ? ''
    : '<small>App visibility is unverified; this opens the documented session link.</small>';
  return `<article class="session-card">
    <div><strong>${escapeHtml(title)}</strong><code>${escapeHtml(id)}</code><small>${escapeHtml(session.statusLabel || 'Status not exposed by Copilot SDK')}${session.appVisibilityLabel ? ` · ${escapeHtml(session.appVisibilityLabel)}` : ''}</small><small>${escapeHtml(session.workingDirectory || 'Working directory unavailable')} · Copilot App workspace identity is not exposed by the SDK</small>${ownerContact}</div>
    <div class="session-actions">${navigable ? `<a class="button quiet" href="${escapeHtml(session.navigationUrl)}" data-open-session="${escapeHtml(id)}">${navigationLabel}</a>${navigationNote}` : '<button class="quiet" type="button" disabled title="No Copilot App session link is available">Go to agent</button>'}<button class="quiet" type="button" data-steer="${escapeHtml(id)}" ${session.steerable === true ? '' : 'disabled title="Copilot App steering is not verified on this host"'}>Steer</button></div>
  </article>`;
}

function renderSessions() {
  const sessions = currentState.projectSessions || [];
  $('#project-sessions').innerHTML = sessions.length ? sessions.map((session) => sessionCard(session)).join('') : '<p class="muted">No Copilot sessions are listed for this project. A newly started session is recorded only after the SDK returns its real session ID.</p>';
  document.querySelectorAll('[data-open-session]').forEach((anchor) => anchor.addEventListener('click', async (event) => {
    event.preventDefault();
    try {
      const result = await call('open_session', { sessionId: anchor.dataset.openSession });
      anchor.href = result.url;
      anchor.target = '_top';
      anchor.rel = 'noopener';
      window.top.location.assign(result.url);
    } catch (error) { showMessage(error.message, true); }
  }));
  document.querySelectorAll('[data-steer]').forEach((button) => button.addEventListener('click', async () => {
    const prompt = window.prompt('Message to send to this Copilot session:');
    if (prompt?.trim()) await act('steer', { sessionId: button.dataset.steer, prompt });
  }));
}

function renderManager(record) {
  const claim = record.manager_claim;
  if (record.manager_claim_error) return `<div class="notice danger"><strong>Ownership unavailable.</strong> ${escapeHtml(record.manager_claim_error)}. Do not start a replacement manager until this is resolved.</div>`;
  const owners = claim?.owners || [];
  if (!owners.length) return '<p class="muted">No Lane Manager claim. Starting a manager uses the actual Copilot session ID and claims the Lane before sending its prompt.</p>';
  return `<div class="manager-list">${owners.map((owner) => {
    const found = (currentState.projectSessions || []).find((session) => (session.id || session.sessionId) === owner.session_id);
    return `<article class="manager-card"><div><strong>${escapeHtml(owner.session_id)}</strong><small>${escapeHtml(owner.runtime)} on ${escapeHtml(owner.host)} · ${found ? escapeHtml(found.statusLabel || 'Status not exposed') : 'Session unavailable on this host'}</small>${owner.contact ? `<small>Contact: ${escapeHtml(owner.contact)}</small>` : ''}</div>${found ? sessionCard(found, true) : ''}</article>`;
  }).join('')}</div><p class="muted">Claims remain when a manager is stopped or disconnected. The canvas will not replace claimed owners.</p>`;
}

function renderDetail() {
  const outline = currentState.outline;
  if (!outline) {
    $('#record-detail').innerHTML = '<div class="welcome"><h2>Choose work to focus</h2><p>Focus is saved independently for this open canvas. Project records remain in the canonical Clips store.</p></div>';
    return;
  }
  const record = outline.record;
  const description = record.description || '';
  const long = description.trim().length > 220 || description.split(/\r?\n/).length > 3;
  const related = currentState.relatedSessions || [];
  const isLane = outline.kind === 'lane';
  const parentGoal = outline.kind === 'goal' ? record : outline.kind === 'task' ? currentState.goals.find((goal) => goal.ref === record.goal_ref) : null;
  const strategicLane = parentGoal?.lane_id ? currentState.lanes.find((lane) => lane.lane_id === parentGoal.lane_id) : null;
  const hasOwners = (record.manager_claim?.owners || []).length > 0;
  const launchLabel = isLane ? 'Start Lane Manager' : 'Start Copilot session';
  const hostVerified = currentState.hostCapabilities?.appSessionVisibilityVerified === true;
  const launchDisabled = !hostVerified || (isLane && (hasOwners || record.manager_claim_error || !record.manager_claim || currentState.hostCapabilities?.hostIdConfigured !== true)) || (!isLane && related.length > 0);
  const launchReason = !hostVerified
    ? 'Starting and steering are disabled until SDK sessions are confirmed visible and steerable in the Copilot App on this host. Existing sessions can still be opened through their documented app links while visibility remains unverified.'
    : isLane && currentState.hostCapabilities?.hostIdConfigured !== true
      ? 'Lane management also requires an observed Copilot host identity.'
      : !isLane && related.length > 0
        ? 'This record already has an exactly bound session. Use Go to agent or Steer below; session activity status is not exposed.'
        : isLane && hasOwners
          ? 'This Lane is already claimed. Contact or navigate to its owner; this canvas will not replace it.'
          : isLane && (!record.manager_claim || record.manager_claim_error)
            ? 'Lane ownership cannot be read, so a manager must not be started.'
            : '';
  const statusOptions = outline.kind === 'lane' ? ['open', 'in_progress', 'not_planned', 'duplicate'] : ['open', 'in_progress', 'closed', 'not_planned', 'duplicate'];
  const tasks = outline.kind === 'goal' ? outline.tasks : [];
  $('#record-detail').innerHTML = `
    <div class="record-heading"><div><div class="eyebrow">${escapeHtml(outline.kind)} · ${escapeHtml(record.ref)}</div><h2>${escapeHtml(record.title || record.ref)}</h2></div>
      <details class="kebab"><summary aria-label="More record actions">•••</summary><div class="kebab-menu"><strong>Labels</strong><div>${labelBadges(record) || '<span class="muted">No labels</span>'}</div><div class="label-editor"><select id="label-choice" aria-label="Choose label"><option value="">Choose label</option>${(currentState.labels || []).map((label) => `<option value="${escapeHtml(label.id)}">${escapeHtml(label.name)}</option>`).join('')}</select><button id="add-label" class="quiet" type="button">Add</button></div><div class="label-editor"><select id="remove-label-choice" aria-label="Choose assigned label"><option value="">Choose assigned label</option>${(record.labels || []).map((label) => `<option value="${escapeHtml(label.id)}">${escapeHtml(label.name)}</option>`).join('')}</select><button id="remove-label" class="quiet" type="button">Remove</button></div></div></details>
    </div>
    <div class="context-line"><span class="status-pill">${escapeHtml(statusLabel(record.status))}</span>${record.blocked_by?.length ? `<span class="blocked">Blocked by ${escapeHtml(record.blocked_by.join(', '))}</span>` : ''}${isLane && record.manager_claim_error ? '<span class="blocked">Ownership unavailable</span>' : ''}</div>
    ${description ? `<section class="description"><h3>Description</h3><p id="description-text" class="description-text ${long ? 'collapsed' : ''}">${escapeHtml(description)}</p>${long ? '<button id="description-toggle" class="quiet small" type="button" aria-expanded="false">Expand description</button>' : ''}</section>` : '<p class="muted description-empty">No description was recorded.</p>'}
    ${outline.kind === 'task' && parentGoal ? `<section class="context-section"><h3>Goal context</h3><button class="inline-link" type="button" data-focus="${escapeHtml(parentGoal.ref)}">${escapeHtml(parentGoal.title || parentGoal.ref)}</button>${parentGoal.description ? `<p class="parent-description">${escapeHtml(parentGoal.description)}</p>` : ''}</section>` : ''}
    ${strategicLane ? `<section class="context-section"><h3>Strategic Lane context</h3><button class="inline-link" type="button" data-focus="${escapeHtml(strategicLane.ref)}">${escapeHtml(strategicLane.title || strategicLane.ref)}</button>${strategicLane.description ? `<p class="parent-description">${escapeHtml(strategicLane.description)}</p>` : ''}</section>` : ''}
    ${isLane ? `<section class="context-section"><h3>Lane Managers</h3>${renderManager(record)}</section>` : ''}
    ${outline.kind === 'lane' ? `<section class="context-section"><h3>Goals</h3><div class="focused-goals">${outline.goals.length ? outline.goals.map((goal) => recordButton({ ...goal, kind: 'goal' }, false)).join('') : '<p class="muted">No Goals in this Lane.</p>'}</div></section>` : ''}
    ${outline.kind === 'goal' ? `<section class="context-section"><h3>Tasks <span class="count">${tasks.length}</span></h3><p class="muted">Tasks are shown only while their parent Goal is focused.</p><div class="focused-tasks">${tasks.length ? tasks.map((task) => recordButton({ ...task, kind: 'task' }, false)).join('') : '<p class="muted">No Tasks in this Goal.</p>'}</div></section>` : ''}
    <section class="context-section agent-section"><div class="section-head"><div><h3>${isLane ? 'Claimed manager sessions' : 'Sessions bound to this record'}</h3><p class="muted">Only durable Lane claims or exact IDs launched here are attributed to this record. Copilot sessions use this project path; the SDK does not expose an App-managed workspace ID.</p></div><button id="launch-record" class="primary" type="button" ${launchDisabled ? 'disabled' : ''}>${escapeHtml(launchLabel)}</button></div>
      ${launchReason ? `<p class="notice">${escapeHtml(launchReason)}</p>` : ''}
      ${related.length ? `<div class="session-list">${related.map((session) => sessionCard(session, isLane)).join('')}</div>` : isLane && hasOwners ? '<p class="notice">A manager is claimed but its session is not visible in this project session list. Contact the owner; no replacement action is available.</p>' : '<p class="muted">No session is durably bound to this record.</p>'}
    </section>
    <section class="context-section status-editor"><label for="status-choice">Record status</label><select id="status-choice">${statusOptions.map((status) => `<option value="${status}" ${record.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select><button id="save-status" class="quiet" type="button">Update status</button>${outline.kind !== 'lane' ? '<small class="muted">Closing a Goal or Task is administrative and does not record technical acceptance.</small>' : ''}</section>`;
  document.querySelectorAll('[data-focus]').forEach((button) => button.addEventListener('click', () => act('focus', { ref: button.dataset.focus })));
  $('#description-toggle')?.addEventListener('click', (event) => {
    const paragraph = $('#description-text');
    const expanded = event.currentTarget.getAttribute('aria-expanded') === 'true';
    paragraph.classList.toggle('collapsed', expanded);
    event.currentTarget.setAttribute('aria-expanded', String(!expanded));
    event.currentTarget.textContent = expanded ? 'Expand description' : 'Collapse description';
  });
  $('#launch-record')?.addEventListener('click', () => act('launch', { ref: record.ref }));
  $('#save-status')?.addEventListener('click', () => act('set_status', { ref: record.ref, status: $('#status-choice').value }));
  $('#add-label')?.addEventListener('click', () => act('add_label', { ref: record.ref, labelId: $('#label-choice').value }));
  $('#remove-label')?.addEventListener('click', () => act('remove_label', { ref: record.ref, labelId: $('#remove-label-choice').value }));
}

function render() {
  $('#project-path').textContent = currentState.projectPath;
  renderTree();
  renderDetail();
  renderSessions();
}

function showMessage(text, isError = false) {
  const box = $('#message');
  box.hidden = false;
  box.className = `message ${isError ? 'error' : ''}`;
  box.textContent = text;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => { box.hidden = true; }, 5000);
}

async function act(action, input = {}) {
  try {
    const result = await call(action, input);
    if (result?.state) currentState = result.state;
    else if (action === 'refresh') currentState = result;
    else currentState = await call('refresh');
    if (action === 'launch') showMessage(`Started Copilot session ${result.session?.id || result.session?.sessionId}; App visibility is unverified.`);
    else if (action === 'steer') showMessage('Message sent to the selected Copilot SDK session.');
    else if (action === 'set_status') showMessage('Clips record status updated.');
    else if (action.endsWith('_label')) showMessage('Clips label assignment updated.');
    render();
    return result;
  } catch (error) {
    showMessage(error.message, true);
    throw error;
  }
}

function openCreate(kind) {
  createKind = kind;
  const title = kind === 'lane' ? 'Create Lane' : kind === 'goal' ? 'Create Goal' : 'Create Task';
  $('#create-title').textContent = title;
  $('#create-submit').textContent = title;
  $('#create-title-input').value = '';
  $('#create-description').value = '';
  $('#create-acceptance').value = '';
  $('#acceptance-field').hidden = kind !== 'task';
  const field = $('#parent-field');
  const select = $('#parent-goal');
  if (kind === 'task') {
    const goals = currentState.goals || [];
    const selected = currentState.outline?.kind === 'goal' ? currentState.focus : '';
    select.innerHTML = goals.map((goal) => `<option value="${escapeHtml(goal.ref)}" ${goal.ref === selected ? 'selected' : ''}>${escapeHtml(goal.title)} · ${escapeHtml(goal.ref)}</option>`).join('');
    $('#parent-label').firstChild.textContent = 'Parent Goal';
    field.hidden = false;
    select.required = true;
  } else if (kind === 'goal') {
    select.innerHTML = `<option value="">No Lane</option>${(currentState.lanes || []).map((lane) => `<option value="${escapeHtml(lane.ref)}">${escapeHtml(lane.title)}</option>`).join('')}`;
    $('#parent-label').firstChild.textContent = 'Lane (optional)';
    field.hidden = false;
    select.required = false;
  } else field.hidden = true;
  $('#create-dialog').showModal();
  $('#create-title-input').focus();
}

$('#refresh').addEventListener('click', () => act('refresh').catch(() => {}));
$('#choose-project').addEventListener('click', () => {
  $('#project-path-input').value = currentState?.projectPath || '';
  $('#project-dialog').showModal();
});
$('#project-cancel').addEventListener('click', () => $('#project-dialog').close());
$('#project-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    currentState = await call('set_project', { projectPath: $('#project-path-input').value });
    $('#project-dialog').close();
    render();
    showMessage('Opened the selected Clips project.');
  } catch (error) { showMessage(error.message, true); }
});
$('#new-lane').addEventListener('click', () => openCreate('lane'));
$('#new-goal').addEventListener('click', () => openCreate('goal'));
$('#new-task').addEventListener('click', () => openCreate('task'));
$('#create-cancel').addEventListener('click', () => $('#create-dialog').close());
$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = { title: $('#create-title-input').value, description: $('#create-description').value };
  if (createKind === 'goal' && $('#parent-goal').value) input.lane_id = $('#parent-goal').value;
  if (createKind === 'task') {
    input.goal_ref = $('#parent-goal').value;
    input.acceptance_criteria = $('#create-acceptance').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  try {
    await act(`create_${createKind}`, input);
    $('#create-dialog').close();
  } catch {}
});

act('refresh').catch((error) => {
  $('#record-tree').innerHTML = `<p class="notice danger">Could not read the canonical Clips board: ${escapeHtml(error.message)}</p><p class="muted">Open this canvas from a Copilot session whose working directory is the intended repository, or supply a project path when the canvas is opened.</p>`;
  if (/working directory|project path/i.test(error.message)) $('#project-dialog').showModal();
});
window.setInterval(() => { if (!document.hidden) act('refresh').catch(() => {}); }, 20000);
