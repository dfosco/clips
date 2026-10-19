import test from 'node:test';
import assert from 'node:assert/strict';
import { mount, state, task, goal } from './test-harness.mjs';

test('actual built shadcn React UI preserves Lane focus, inline context, independent description and Back', async (t) => {
  const s = state(); s.goals[0].description = 'x'.repeat(300);
  const f = await mount(t, s);
  assert.ok(f.query('.lane-columns')); assert.ok(f.query('[data-slot="card"]')); assert.ok(f.query('svg.octicon'));
  assert.equal(f.query('[data-record="#alice#g002"]'), null);
  await f.click('[data-description="#alice#g001"]');
  assert.equal(f.query('[data-record="#alice#g001#t01"]'), null);
  await f.click('[data-lane="#l001"]'); await f.wait(() => f.query('.goal-columns'));
  await f.click('[data-expand="#alice#g001"]');
  assert.ok(f.query('[data-record="#alice#g001#t01"]'));
  assert.match(f.window.document.body.textContent, /Concrete plan/); assert.match(f.window.document.body.textContent, /Concrete decision/);
  await f.click('[data-back]'); assert.ok(f.query('.lane-columns')); assert.equal(f.getServer().focus, null);
  await f.click('[data-closed]'); assert.ok(f.query('[data-record="#alice#g002"]'));
  assert.equal(f.query('button button'), null);
});
test('built UI hierarchical search, observed Running and explicit terminal focus remain correct across refresh', async (t) => {
  const f = await mount(t);
  await f.input('#work-search', 'needle'); assert.ok(f.query('[data-record="#alice#g001#t01"]'));
  assert.match(f.window.document.body.textContent, /Lane one/);
  const search = f.query('#work-search'); search.focus(); search.setSelectionRange(2, 2); f.query('.board-columns').scrollLeft = 81;
  await f.click('[data-command="refresh"]'); assert.equal(f.query('#work-search'), search); assert.equal(search.selectionStart, 2); assert.equal(f.query('.board-columns').scrollLeft, 81);
  await f.click('[data-filter="running"]'); assert.equal(f.query('[data-record="#alice#g001"]'), null);
  f.setServer({ ...state(), focus: task.ref, goals: [{ ...goal, tasks: [{ ...task, status: 'duplicate' }] }] });
  await f.click('[data-command="refresh"]'); assert.ok(f.query('[data-record="#alice#g001#t01"]')); assert.equal(f.query('#work-search').value, '');
  assert.equal(f.query('[data-filter="all"]').getAttribute('aria-checked'), 'true');
});
test('built dialogs use discovered ids, Task closure and exact project-fenced canonical record actions', async (t) => {
  const f = await mount(t, { ...state(), focus: task.ref });
  const menu = f.query('[data-menu="#alice#g001#t01"]'); menu.focus();
  await f.click('[data-menu="#alice#g001#t01"]'); assert.ok(f.query('[role="dialog"][aria-labelledby]'));
  const button = [...f.window.document.querySelectorAll('button')].find((b) => b.textContent === 'Update status'); button.click();
  await f.wait(() => f.query('#record-status'));
  assert.ok([...f.query('#record-status').options].some((o) => o.value === 'closed'));
  await f.input('#record-status', 'closed'); f.query('#canvas-dialog-form').requestSubmit();
  await f.wait(() => !f.query('[role="dialog"]'));
  assert.deepEqual(f.calls.find((c) => c.action === 'set_status').input, { ref: task.ref, status: 'closed', expectedProjectPath: '/A' });
  await f.wait(() => f.window.document.activeElement === menu);
  assert.ok(f.window.document.activeElement === menu, 'closing dialog returns focus to its trigger');
  await f.click('[data-command="project"]'); await f.wait(() => f.query('#clips-project-choice option[value="B"]'));
  await f.input('#clips-project-choice', 'B'); f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => !f.query('[role="dialog"]'));
  assert.deepEqual(f.calls.find((c) => c.action === 'set_project').input, { projectId: 'B' }); assert.equal(f.getServer().projectPath, '/B'); assert.match(f.window.document.body.textContent, /Lane Beta/);
});
test('old-project refresh is discarded after actual built chooser selection; next mutation targets B', async (t) => {
  let block = false; let release; let entered;
  const gate = new Promise((r) => { release = r; }); const start = new Promise((r) => { entered = r; });
  const f = await mount(t, state(), async ({ action, captured }) => { if (action === 'refresh' && block) { block = false; entered(); await gate; return { result: captured }; } });
  block = true; void f.click('[data-command="refresh"]'); await start;
  await f.click('[data-command="project"]'); await f.wait(() => f.query('#clips-project-choice option[value="B"]'));
  await f.input('#clips-project-choice', 'B'); f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => f.getServer().projectPath === '/B'); release(); await f.wait(() => !f.query('[role="dialog"]'));
  assert.match(f.window.document.body.textContent, /Lane Beta/); assert.doesNotMatch(f.window.document.body.textContent, /Lane one/);
  await f.click('[data-expand="#alice#g001"]'); await f.click('[data-menu="#alice#g001#t01"]');
  [...f.window.document.querySelectorAll('button')].find((b) => b.textContent === 'Update status').click(); await f.wait(() => f.query('#record-status'));
  f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => f.calls.some((c) => c.action === 'set_status'));
  assert.equal(f.calls.find((c) => c.action === 'set_status').input.expectedProjectPath, '/B');
});
test('failed selected-store refresh clears old board; empty/diagnostic chooser never substitutes a project', async (t) => {
  let fail = false;
  const f = await mount(t, state(), ({ action }) => fail && action === 'refresh' ? { error: 'Selected Clips store unavailable' } : action === 'list_projects' ? { result: { projects: [], diagnostics: [{ code: 'invalid_registry', message: 'Registry is invalid.' }], userScope: 'local' } } : null);
  fail = true; await f.click('[data-command="refresh"]'); assert.equal(f.query('[data-record]'), null); assert.match(f.window.document.body.textContent, /store unavailable/);
  await f.click('button'); await f.wait(() => f.query('[role="dialog"]'));
  assert.match(f.window.document.body.textContent, /No available Clips projects/); assert.match(f.window.document.body.textContent, /Registry is invalid/);
  assert.equal(f.query('button[type="submit"]').disabled, true); assert.equal(f.calls.some((c) => c.action === 'set_project'), false);
});
test('Task Run exists only in kebab, sends exact bound Task once, suppresses pending repeats and surfaces failure', async (t) => {
  let release; let started; const gate = new Promise((r) => { release = r; }); const entered = new Promise((r) => { started = r; });
  const f = await mount(t, { ...state(), focus: task.ref }, async ({ action }) => { if (action === 'launch') { started(); await gate; return { error: 'Joined send failed; binding retained' }; } });
  assert.equal(f.query('[data-record="#alice#g001#t01"] [data-send]'), null);
  const trigger = f.query('[data-menu="#alice#g001#t01"]'); trigger.focus(); await f.click('[data-menu="#alice#g001#t01"]');
  const run = f.query('[data-task-run]'); assert.ok(run); assert.equal(run.disabled, false);
  run.click(); run.click(); await entered; await f.wait(() => f.query('[data-task-run]').disabled);
  assert.equal(f.calls.filter((c) => c.action === 'launch').length, 1); assert.deepEqual(f.calls.find((c) => c.action === 'launch').input, { ref: task.ref, expectedProjectPath: '/A' });
  release(); await f.wait(() => f.window.document.body.textContent.includes('Joined send failed'));
  assert.ok(f.query('[role="dialog"]')); f.query('[role="dialog"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await f.wait(() => !f.query('[role="dialog"]')); await f.wait(() => f.window.document.activeElement === trigger);
  assert.ok(f.query('[data-send="#alice#g001"]'), 'Goal placement unchanged');
});
test('occupied/running Task menu navigates existing session and cannot launch; closed/capability/role/project gates disable Run', async (t) => {
  for (const scenario of ['occupied','closed','capability','role','project','running-current']) {
    const s = { ...state(), focus: task.ref };
    if (scenario === 'occupied') s.projectSessions.push({ id: 'existing', recordRef: task.ref, status: 'running' });
    if (scenario === 'closed') s.goals[0].tasks[0].status = 'closed';
    if (scenario === 'capability') s.hostCapabilities.canSendToCurrentSession = false;
    if (scenario === 'role') Object.assign(s.projectSessions[0], { recordRef: '#l999', recordKind: 'lane' });
    if (scenario === 'project') s.projectSessions = [];
    if (scenario === 'running-current') s.projectSessions[0].status = 'running';
    const f = await mount(t, s); await f.click('[data-menu="#alice#g001#t01"]');
    if (scenario === 'occupied') { assert.equal(f.query('[data-task-run]'), null); assert.ok(f.query('[data-task-open-session="existing"]')); }
    else assert.equal(f.query('[data-task-run]').disabled, true, scenario);
    assert.equal(f.calls.some((c) => c.action === 'launch'), false);
  }
});
test('observed manager-claim activity keeps the Lane visible under Running even without a local record binding', async (t) => {
  const s = state(); s.lanes[0].manager_claim.owners = [{ runtime: 'copilot-sdk', session_id: 'manager' }];
  s.projectSessions.push({ id: 'manager', status: 'running' });
  const f = await mount(t, s); await f.click('[data-filter="running"]');
  assert.ok(f.query('[data-lane-column="#l001"]')); assert.match(f.window.document.body.textContent, /Running now · 0 Tasks, 0 Goals, 1 Lanes/);
});
test('actual shadcn forms preserve exact label add/remove and namespaced parent Task creation', async (t) => {
  const s = { ...state(), focus: task.ref }; s.goals[0].tasks[0].labels = [{ id: 'urgent', name: 'Urgent' }];
  const f = await mount(t, s);
  await f.click('[data-menu="#alice#g001#t01"]');
  [...f.window.document.querySelectorAll('button')].find((b) => b.textContent === 'Labels').click(); await f.wait(() => f.query('#label-choice'));
  await f.input('#label-choice', 'urgent'); f.query('[data-operation="add"]').click(); await f.wait(() => f.calls.some((c) => c.action === 'add_label'));
  assert.deepEqual(f.calls.find((c) => c.action === 'add_label').input, { ref: task.ref, labelId: 'urgent', expectedProjectPath: '/A' });
  await f.wait(() => !f.query('[role="dialog"]'));
  await f.click('[data-menu="#alice#g001#t01"]'); [...f.window.document.querySelectorAll('button')].find((b) => b.textContent === 'Labels').click(); await f.wait(() => f.query('#assigned-choice'));
  await f.input('#assigned-choice', 'urgent'); f.query('[data-operation="remove"]').click(); await f.wait(() => f.calls.some((c) => c.action === 'remove_label')); await f.wait(() => !f.query('[role="dialog"]'));
  assert.equal(f.calls.find((c) => c.action === 'remove_label').input.ref, task.ref);
  await f.click('[data-menu="#alice#g001"]'); [...f.window.document.querySelectorAll('button')].find((b) => b.textContent === 'New Task').click(); await f.wait(() => f.query('#record-title'));
  assert.equal(f.query('#record-parent').value, goal.ref);
  await f.input('#record-title', 'Scoped Task'); await f.input('#record-description', 'Description'); await f.input('#record-criteria', 'Observable result');
  f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => f.calls.some((c) => c.action === 'create_task'));
  assert.deepEqual(f.calls.find((c) => c.action === 'create_task').input, { title: 'Scoped Task', description: 'Description', goal_ref: goal.ref, acceptance_criteria: ['Observable result'], expectedProjectPath: '/A' });
});

test('overview Lane and outside-Lanes groups enclose header and inset contrasting Goals in shadcn surfaces', async (t) => {
  const s = state(); s.goals.push({ ...structuredClone(goal), ref: '#alice#g003', title: 'Outside Goal', tasks: [] });
  const f = await mount(t, s);
  for (const [key, headerRef, goalRef] of [['#l001', '#l001', goal.ref], ['unassigned', null, '#alice#g003']]) {
    const column = f.query(`[data-lane-column="${key}"]`); assert.ok(column);
    assert.equal(column.dataset.slot, 'card'); assert.equal(column.dataset.variant, 'lane');
    assert.equal(column.querySelector(':scope > [data-slot="card-footer"]'), null);
    assert.ok(column.classList.contains('has-[>[data-slot=card-footer]]:pb-0'), 'only a direct footer may remove outer bottom padding');
    for (const style of ['border', 'border-border', 'bg-muted', 'rounded-xl']) assert.ok(column.classList.contains(style), `${key} ${style}`);
    const header = column.querySelector(':scope > [data-slot="card-header"]');
    const content = column.querySelector(':scope > [data-slot="card-content"]'); assert.ok(header && content);
    assert.ok(header.classList.contains('px-(--card-spacing)')); assert.ok(content.classList.contains('px-(--card-spacing)'));
    if (headerRef) assert.ok(header.querySelector(`[data-record="${headerRef}"]`)); else assert.match(header.textContent, /Goals outside Lanes/);
    const nestedGoal = content.querySelector(`.lane-goals > [data-record="${goalRef}"]`); assert.ok(nestedGoal);
    assert.equal(nestedGoal.dataset.variant, 'inset'); assert.ok(nestedGoal.classList.contains('bg-background'));
    assert.equal(nestedGoal.classList.contains('bg-muted'), false);
  }
  await f.click('[data-lane="#l001"]'); await f.wait(() => f.query('.goal-columns'));
  assert.equal(f.query('[data-lane-column]'), null); assert.equal(f.query('[data-variant="lane"]'), null, 'focused Goal columns remain distinct');
  await f.click('[data-back]'); await f.wait(() => f.query('.lane-columns'));
  assert.ok(f.query('[data-lane-column="#l001"] [data-record="#alice#g001"]'));
  assert.ok(f.query('[data-lane-column="unassigned"] [data-record="#alice#g003"]'));
});


test('built nested cards wrap full titles and reserve a fixed menu track independently of status/actions', async (t) => {
  const s = { ...state(), focus: task.ref };
  const long = 'Unbroken' + 'abcdefghij'.repeat(30);
  s.lanes[0].title = `Lane ${long}`; s.goals[0].title = `Goal ${long}`; s.goals[0].tasks[0].title = `Task ${long}`;
  s.goals[0].tasks[0].labels[0].name = long;
  s.goals[0].tasks[0].description = long;
  const f = await mount(t, s, ({ action }) => action === 'open_session' ? { result: { url: '#joined' } } : null);
  const check = (ref, title) => {
    const card = f.query(`[data-record="${ref}"]`); assert.ok(card);
    const heading = card.querySelector(':scope > [data-slot="card-header"] [data-variant="record"]');
    assert.equal(heading.textContent, title); assert.equal(heading.dataset.size, 'record');
    for (const c of ['min-w-0', 'flex-1', 'shrink', 'whitespace-normal', '[overflow-wrap:anywhere]', 'min-h-11']) assert.ok(heading.classList.contains(c), `${ref} title ${c}`);
    for (const c of ['w-full', 'shrink-0', 'truncate', 'whitespace-nowrap']) assert.equal(heading.classList.contains(c), false, `${ref} title must not inherit ${c}`);
    const footer = card.querySelector(':scope > [data-slot="card-footer"] > .record-actions');
    for (const c of ['grid', 'min-w-0', 'grid-cols-[minmax(0,1fr)_2.5rem]']) assert.ok(footer.classList.contains(c), c);
    assert.equal(footer.classList.contains('flex-wrap'), false);
    const menu = footer.querySelector(`[data-menu="${ref}"]`);
    for (const c of ['col-start-2', 'row-start-1', 'size-10']) assert.ok(menu.classList.contains(c), c);
    assert.equal(menu.classList.contains('ml-auto'), false);
    const status = footer.querySelector('.runtime-status');
    for (const c of ['col-start-1', 'row-start-1', 'min-w-0', '[overflow-wrap:anywhere]']) assert.ok(status.classList.contains(c), c);
    for (const action of footer.querySelectorAll('[data-send], [data-session]')) {
      for (const c of ['min-h-10', 'min-w-0', 'max-w-full', 'whitespace-normal', '[overflow-wrap:anywhere]']) assert.ok(action.classList.contains(c), c);
      assert.ok(action.closest('.row-start-2.col-start-1'), 'action is in its own shrinkable track');
      assert.equal(action.classList.contains('whitespace-nowrap'), false);
    }
    return footer;
  };
  const goalFooter = check(goal.ref, s.goals[0].title); assert.ok(goalFooter.querySelector('[data-send]'));
  const taskFooter = check(task.ref, s.goals[0].tasks[0].title); assert.equal(taskFooter.querySelector('[data-send]'), null);
  const badge = f.query(`[data-record="${task.ref}"] [data-slot="badge"]`);
  assert.equal(badge.textContent, long); assert.ok(badge.classList.contains('h-auto')); assert.ok(badge.classList.contains('[overflow-wrap:anywhere]'));
  await f.click('[data-back]'); await f.wait(() => f.query('.lane-columns'));
  check('#l001', s.lanes[0].title);
  // Occupied/current-session actions use the same separate action track; Task Run stays absent.
  s.projectSessions[0].recordRef = task.ref; s.projectSessions[0].recordKind = 'task'; s.projectSessions[0].status = 'running';
  f.setServer(s); await f.click('[data-command="refresh"]');
  const occupied = check(task.ref, s.goals[0].tasks[0].title);
  assert.match(occupied.querySelector('.runtime-status').textContent, /Running/);
  const open = occupied.querySelector('[data-session="joined"]'); assert.ok(open); assert.equal(open.textContent, 'Open current session');
  await f.click('[data-session="joined"]'); assert.equal(f.calls.find((c) => c.action === 'open_session').input.sessionId, 'joined'); assert.equal(f.calls.some((c) => c.action === 'launch'), false);
  await f.click(`[data-menu="${task.ref}"]`); assert.equal(f.query('[data-task-run]'), null); assert.ok(f.query('[data-task-open-session="joined"]'));
});
