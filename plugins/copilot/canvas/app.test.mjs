import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount, state, task, goal, lane } from './test-harness.mjs';

const disabled = (element) => element.disabled || element.getAttribute('aria-disabled') === 'true';
async function selectMenu(f, label) {
  await f.wait(() => f.query('[role="menu"]'));
  const item = [...f.window.document.querySelectorAll('[role="menuitem"]')].find((element) => element.textContent.trim() === label);
  assert.ok(item, `Menu item: ${label}`); item.click();
}
async function focusLane(f) {
  await f.click('[data-menu="#l001"]'); await selectMenu(f, 'Focus Lane');
  await f.wait(() => f.query('.goal-columns'));
}
async function recordMenuAction(f, ref, label) {
  await f.click(`[data-menu="${ref}"]`);
  await selectMenu(f, label);
  await f.wait(() => !f.query('[role="menu"]'));
}
async function globalNew(f, kind) {
  await f.click('[data-command="new"]');
  assert.equal(f.query('[role="dialog"]'), null);
  await f.click(`[data-command="create_${kind}"]`);
  await f.wait(() => f.query('[role="dialog"]'));
}

test('every Lane and record metadata kebab stays an anchored dropdown at narrow and regular widths', async (t) => {
  for (const viewportWidth of [360, 767, 768, 1400]) for (const surface of ['lane-info', 'focused-header', 'goal-metadata', 'task-metadata']) {
    const s = state();
    s.lanes[0].ref = '#l002';
    if (surface === 'focused-header') s.focus = '#l002';
    if (surface === 'task-metadata') s.focus = task.ref;
    const f = await mount(t, s, undefined, { viewportWidth });
    const selector = surface === 'lane-info' ? '[data-lane-column="#l002"] > .clips-board-lane-header [data-menu="#l002"]'
      : surface === 'focused-header' ? '.clips-board-project-header [data-menu="#l002"]'
      : `[data-record="${surface === 'goal-metadata' ? goal.ref : task.ref}"] [data-menu="${surface === 'goal-metadata' ? goal.ref : task.ref}"]`;
    const trigger = f.query(selector);
    assert.ok(trigger, `${surface} has its actual kebab trigger`);
    let anchorTop = 80; let anchorReads = 0;
    trigger.getBoundingClientRect = () => {
      anchorReads++;
      return new f.window.DOMRect(100, anchorTop, 28, 28);
    };
    trigger.focus(); trigger.click();
    await f.wait(() => f.query('[role="menu"]'));
    assert.equal(f.query('[role="dialog"]'), null, `${surface}: initial click is not a form`);
    assert.ok(['true', 'menu'].includes(trigger.getAttribute('aria-haspopup')));
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    const menu = f.query('[role="menu"]');
    assert.ok(menu.querySelector('[role="menuitem"]'));
    assert.match(menu.className, /ActionList/, `${surface}: actual Primer menu`);
    assert.equal(menu.parentElement.dataset.variant, 'anchored', `${surface} at ${viewportWidth}px stays anchored`);
    assert.equal(menu.closest('[data-component="ActionMenu.Overlay"]').getAttribute('role'), 'none');
    assert.equal(f.query('[aria-modal="true"]'), null, `${surface}: no responsive modal/sheet`);
    assert.ok(f.mediaQueries.includes('(max-width: calc(768px - 0.02px))'), 'the real narrow responsive hook was exercised');
    const overlayTop = () => parseFloat(f.query('[data-component="ActionMenu.Overlay"]')?.style.getPropertyValue('--top'));
    await f.wait(() => anchorReads > 0 && overlayTop() > 0);
    const firstTop = overlayTop();
    menu.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await f.wait(() => !f.query('[role="menu"]'));
    await f.wait(() => f.window.document.activeElement === trigger);
    anchorTop += 40;
    trigger.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true, cancelable: true }));
    await f.wait(() => f.query('[role="menu"]'));
    assert.equal(f.query('[role="dialog"]'), null, `${surface}: keyboard opens only dropdown`);
    const first = f.query('[role="menuitem"]');
    await f.wait(() => f.window.document.activeElement === first);
    await f.wait(() => overlayTop() === firstTop + 40);
    await selectMenu(f, 'Update status');
    await f.wait(() => f.query('#record-status'));
    assert.equal(f.query('[role="menu"]'), null, `${surface}: selecting an explicit form item closes menu`);
    f.query('[role="dialog"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await f.wait(() => !f.query('[role="dialog"]'));
    await f.wait(() => f.window.document.activeElement === trigger);
    assert.equal(f.calls.some(call => call.action === 'set_status'), false);
  }
});

test('expanded Lane Goal Task and focused Lane content has top and bottom Show less controls with safe collapse focus', async (t) => {
  for (const surface of ['lane', 'goal', 'task', 'focused-lane']) {
    const s = state();
    const ref = surface === 'goal' ? goal.ref : surface === 'task' ? task.ref : lane.ref;
    const full = `Full context for ${ref}. `.repeat(30);
    s.lanes[0].description = full;
    s.goals[0].description = full;
    s.goals[0].tasks[0].description = full;
    s.focus = surface === 'focused-lane' ? lane.ref : surface === 'task' ? goal.ref : null;
    const f = await mount(t, s);
    const container = surface === 'focused-lane' ? f.query('.clips-board-lane-context') : f.query(`[data-record="${ref}"]`);
    const controls = () => [...container.querySelectorAll(`[data-expand="${ref}"]`)];
    assert.equal(controls().length, 1, `${surface}: one collapsed control`);
    assert.equal(controls()[0].textContent, 'Show more');
    assert.equal(controls()[0].getAttribute('aria-expanded'), 'false');
    controls()[0].click();
    await f.wait(() => controls().length === 2);
    const [top, bottom] = controls();
    for (const button of [top, bottom]) {
      assert.equal(button.textContent, 'Show less');
      assert.equal(button.getAttribute('aria-expanded'), 'true');
      assert.equal(button.dataset.size, 'small');
    }
    const description = container.querySelector('.clips-board-description');
    assert.equal(description.textContent, full.trim());
    assert.ok(top.compareDocumentPosition(description) & f.window.Node.DOCUMENT_POSITION_FOLLOWING, `${surface}: upper control precedes full content`);
    assert.ok(description.compareDocumentPosition(bottom) & f.window.Node.DOCUMENT_POSITION_FOLLOWING, `${surface}: lower control follows full content`);
    if (surface === 'goal') {
      const tasks = container.querySelector(':scope > .goal-tasks');
      assert.ok(tasks);
      assert.ok(tasks.compareDocumentPosition(bottom) & f.window.Node.DOCUMENT_POSITION_FOLLOWING, 'bottom Goal control follows expanded Task hierarchy');
    }
    bottom.focus(); bottom.click();
    await f.wait(() => controls().length === 1 && f.window.document.activeElement === controls()[0]);
    assert.equal(controls()[0].textContent, 'Show more');
    assert.equal(controls()[0].getAttribute('aria-expanded'), 'false');
    assert.equal(bottom.isConnected, false);
    controls()[0].click();
    await f.wait(() => controls().length === 2);
    controls()[0].focus(); controls()[0].click();
    await f.wait(() => controls().length === 1 && f.window.document.activeElement === controls()[0]);
    assert.equal(controls()[0].textContent, 'Show more');
    assert.equal(f.calls.some(call => ['launch', 'set_status', 'focus', 'clear_focus'].includes(call.action)), false, 'disclosure is local presentation only');
  }
});

test('Lane overview and focus retain truthful read-only history without navigation for unknown or idle sessions', async (t) => {
  const s = state();
  s.lanes[0].manager_claim.owners = [
    { runtime: 'copilot-sdk', session_id: 'manager' },
    { runtime: 'copilot-sdk', session_id: 'missing' },
  ];
  s.workBindings = { '#l001': ['manager', 'manager', 'earlier'], '#bob#l001': ['unrelated'] };
  s.projectSessions.push(
    { id: 'manager', name: 'Security migration plans', recordRef: '#l001', status: 'unknown' },
    { id: 'earlier', name: 'Earlier session', recordRef: '#g999', status: 'idle' },
    { id: 'unrelated', summary: 'Unrelated Lane worker', status: 'running' },
    { id: 'task-worker', summary: 'Nested task work', recordRef: task.ref, status: 'running' },
  );
  const f = await mount(t, s, ({ action, input }) => action === 'open_session' ? { result: { url: `#${input.sessionId}` } } : null, { loadStyles: true });
  const check = (container) => {
    assert.equal(container.querySelector('[data-session]'), null);
    const manager = container.querySelector('[data-association="manager"]');
    assert.match(manager.textContent, /Security migration plans/);
    assert.equal(manager.querySelector('button'), null);
    assert.ok(manager.classList.contains('clips-board-session-association'));
    const title = manager.querySelector('.clips-board-session-title');
    assert.equal(title.textContent, 'Security migration plans');
    assert.equal(f.window.getComputedStyle(title).fontSize, 'var(--text-body-size-small)');
    assert.equal(f.window.getComputedStyle(title).fontWeight, 'var(--base-text-weight-semibold)');
    assert.equal(f.window.getComputedStyle(manager).display, 'grid');
    assert.equal(manager.querySelector('.clips-board-session-provenance').parentElement, manager);
    assert.equal(title.nextElementSibling, manager.querySelector('.clips-board-session-provenance'));
    assert.match(manager.textContent, /Saved work association \+ Session record reference \+ Lane manager session$/);
    assert.match(container.querySelector('[data-association="earlier"]').textContent, /Earlier sessionSaved work association · Idle/);
    const missing = container.querySelector('[data-association="missing"]');
    assert.equal(missing, null, 'unlisted associations are retained in data, not displayed as UUID cards');
    assert.equal(container.querySelector('.runtime-status'), null);
    assert.doesNotMatch(container.textContent, /Activity unavailable|Session unavailable|Manager claim|No associated sessions/);
    assert.doesNotMatch(container.textContent, /Running:|agent[s]?|Unrelated Lane worker|Nested task work/);
  };
  check(f.query('[data-record="#l001"]'));
  await focusLane(f);
  check(f.query('[data-lane-session-context="#l001"]'));
  await f.click('[data-menu="#l001"]');
  assert.equal(f.query('[data-session]'), null);
  assert.equal(f.calls.some(call => call.action === 'open_session'), false);
  assert.deepEqual(f.getServer().lanes[0].manager_claim, s.lanes[0].manager_claim);
  assert.equal(f.calls.some((call) => call.action === 'launch'), false);
  const css = await readFile(new URL('./dist/style.css', import.meta.url), 'utf8');
  const subcard = css.match(/\.clips-board-session-association\{([^}]*)\}/)?.[1];
  assert.ok(subcard);
  assert.match(subcard, /padding:var\(--base-size-8\)/);
  assert.match(subcard, /border:var\(--borderWidth-thin\) solid var\(--borderColor-muted\)/);
  assert.match(subcard, /border-radius:var\(--borderRadius-medium\)/);
  assert.match(subcard, /background:var\(--bgColor-muted\)/);
});

test('claim-only missing manager has no fabricated navigation or running state and does not disable Run', async (t) => {
  const s = state();
  s.lanes[0].status = 'in_progress';
  s.lanes[0].manager_claim.owners = [{ runtime: 'copilot-sdk', session_id: 'not-listed' }];
  const f = await mount(t, s);
  const card = f.query('[data-record="#l001"]');
  assert.equal(card.querySelector('.runtime-status'), null);
  assert.equal(card.querySelector('[data-association="not-listed"]'), null);
  assert.equal(card.querySelector('.record-actions'), null);
  assert.doesNotMatch(card.textContent, /unavailable|No associated sessions/);
  assert.equal(card.querySelector('[data-session]'), null);
  await f.click('[data-menu="#l001"]');
  assert.equal(disabled(f.query('[data-run="#l001"]')), false);
  await selectMenu(f, 'Run in this session');
  await f.wait(() => f.calls.some(call => call.action === 'launch'));
  assert.deepEqual(f.calls.find((call) => call.action === 'launch').input, { ref: '#l001', expectedProjectPath: '/A' });
  assert.deepEqual(f.getServer().lanes[0].manager_claim, s.lanes[0].manager_claim);
});

test('empty associations and unavailable activity leave no placeholder footer or empty content gap', async (t) => {
  for (const focus of [null, '#l001', task.ref]) {
    const s = { ...state(), focus };
    s.goals[0].tasks[0].description = '';
    const f = await mount(t, s, undefined, { loadStyles: true });
    for (const container of f.window.document.querySelectorAll('[data-record], [data-lane-session-context]')) {
      assert.equal(container.querySelector('.runtime-status'), null);
      assert.equal(container.querySelector('.record-actions'), null);
      assert.doesNotMatch(container.textContent, /No associated sessions|Activity unavailable|Direct (lane|goal|task) associations:/);
      const content = container.querySelector(':scope > .clips-work-card-content');
      if (content && !content.children.length) assert.equal(f.window.getComputedStyle(content).display, 'none');
    }
  }
});

test('session sub-cards never display kickoff prompts or stale UUID-only associations as titles', async (t) => {
  const s = { ...state(), focus: task.ref };
  const stale = 'd9d34afd-3cdd-48ea-919c-a6f8b34edbeb';
  const summary = 'You are the ordinary dev execution owner for canonical Clips Goal #g001. Read the persisted instructions before acting.';
  s.workBindings = { [goal.ref]: [stale, 'named', 'prompt-only'] };
  s.projectSessions.push(
    { id: 'named', name: 'Security migration plans', summary, status: 'unknown' },
    { id: 'prompt-only', name: `${summary}\n\nMore kickoff instructions`, summary, status: 'running' },
  );
  const f = await mount(t, s);
  const card = f.query(`[data-record="${goal.ref}"]`);
  assert.equal(card.querySelector(`[data-association="${stale}"]`), null);
  assert.equal(card.querySelector('[data-association="named"] .clips-board-session-title').textContent, 'Security migration plans');
  assert.equal(card.querySelector('[data-association="prompt-only"] .clips-board-session-title').textContent, 'Copilot session');
  assert.equal(card.textContent.includes(summary), false);
  assert.equal(card.textContent.includes(stale), false);
  await f.click(`[data-menu="${goal.ref}"]`);
  const go = f.query('[data-session="prompt-only"]');
  assert.equal(go.textContent, 'Go to sessionCopilot session');
  assert.equal(go.textContent.includes(summary), false);
  assert.deepEqual(f.getServer().workBindings[goal.ref], [stale, 'named', 'prompt-only'], 'presentation does not delete history');
});

test('Task Go to session menu names observed ongoing targets and opens the exact selected session', async (t) => {
  const s = { ...state(), focus: task.ref, workBindings: { [task.ref]: ['earlier'] } };
  s.projectSessions.push({ id: 'earlier', name: 'Previous implementation', recordRef: '#g999', status: 'running' }, { id: 'review', name: 'Review candidate', recordRef: task.ref, status: 'attention' });
  const f = await mount(t, s, ({ action, input }) => action === 'open_session' ? { result: { url: `#${input.sessionId}` } } : null);
  for (const [id, name] of [['earlier', 'Previous implementation'], ['review', 'Review candidate']]) {
    await f.click(`[data-menu="${task.ref}"]`);
    const item = f.query(`[data-task-open-session="${id}"]`);
    assert.equal(item.textContent.replace(name, '').trim(), 'Go to session');
    assert.ok(item.getAttribute('aria-label').includes(`(${id}) for ${task.ref}`));
    item.click();
    await f.wait(() => !f.query('[role="menu"]'));
  }
  assert.deepEqual(f.calls.filter((call) => call.action === 'open_session').map((call) => call.input), ['earlier', 'review'].map((sessionId) => ({ sessionId, expectedProjectPath: '/A' })));
  assert.equal(f.calls.some((call) => call.action === 'launch'), false);
  assert.equal(f.query('.clips-app-session[aria-label="Current session"] h3').textContent, 'Current session');
});

test('actual built Primer UI preserves Lane focus, unified full-card expansion and Back', async (t) => {
  const s = state(); s.goals[0].description = 'x'.repeat(300);
  const f = await mount(t, s);
  assert.ok(f.query('.lane-columns')); assert.ok(f.query('.clips-work-card')); assert.ok(f.query('[data-component="Button"]')); assert.ok(f.query('svg.octicon'));
  assert.equal(f.query('[data-record="#alice#g002"]'), null);
  await f.click(`[data-expand="${goal.ref}"]`);
  assert.ok(f.query('[data-record="#alice#g001#t01"]'), 'Show more expands hierarchy as well as full description');
  assert.match(f.window.document.body.textContent, /Concrete plan/); assert.match(f.window.document.body.textContent, /Concrete decision/);
  await f.click(`[data-expand="${goal.ref}"]`);
  assert.equal(f.query('[data-record="#alice#g001#t01"]'), null);
  await focusLane(f);
  await f.click(`[data-expand="${goal.ref}"]`);
  assert.ok(f.query('[data-record="#alice#g001#t01"]'));
  assert.match(f.window.document.body.textContent, /Concrete plan/); assert.match(f.window.document.body.textContent, /Concrete decision/);
  await f.click('[data-back]'); assert.ok(f.query('.lane-columns')); assert.equal(f.getServer().focus, null);
  await f.click('[data-menu="#l001"]'); await f.click('[data-closed="#l001"]'); assert.ok(f.query('[data-record="#alice#g002"]'));
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
  await f.click('[data-menu="#alice#g001#t01"]'); assert.ok(f.query('[role="menu"]')); assert.equal(f.query('[role="dialog"]'), null);
  await selectMenu(f, 'Update status');
  await f.wait(() => f.query('#record-status'));
  assert.ok([...f.query('#record-status').options].some((o) => o.value === 'closed'));
  await f.input('#record-status', 'closed'); f.query('#canvas-dialog-form').requestSubmit();
  await f.wait(() => !f.query('[role="dialog"]'));
  assert.deepEqual(f.calls.find((c) => c.action === 'set_status').input, { ref: task.ref, status: 'closed', expectedProjectPath: '/A' });
  await f.wait(() => f.window.document.activeElement === menu);
  assert.ok(f.window.document.activeElement === menu, 'closing dialog returns focus to its trigger');
  await f.click('[data-back]');
  await f.wait(() => f.query('[data-project-tab="B"]')); await f.click('[data-project-tab="B"]'); await f.wait(() => f.getServer().projectPath === '/B');
  assert.deepEqual(f.calls.find((c) => c.action === 'set_project').input, { projectId: 'B' }); assert.equal(f.getServer().projectPath, '/B'); assert.match(f.window.document.body.textContent, /Lane Beta/);
});
test('old-project refresh is discarded after actual built tab selection; next mutation targets B', async (t) => {
  let block = false; let release; let entered;
  const gate = new Promise((r) => { release = r; }); const start = new Promise((r) => { entered = r; });
  const f = await mount(t, state(), async ({ action, captured }) => { if (action === 'refresh' && block) { block = false; entered(); await gate; return { result: captured }; } });
  block = true; void f.click('[data-command="refresh"]'); await start;
  await f.wait(() => f.query('[data-project-tab="B"]')); await f.click('[data-project-tab="B"]');
  await f.wait(() => f.getServer().projectPath === '/B'); release(); await f.wait(() => !f.query('[role="dialog"]'));
  assert.match(f.window.document.body.textContent, /Lane Beta/); assert.doesNotMatch(f.window.document.body.textContent, /Lane one/);
  await f.click(`[data-expand="${goal.ref}"]`); await f.click('[data-menu="#alice#g001#t01"]');
  await selectMenu(f, 'Update status'); await f.wait(() => f.query('#record-status'));
  f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => f.calls.some((c) => c.action === 'set_status'));
  assert.equal(f.calls.find((c) => c.action === 'set_status').input.expectedProjectPath, '/B');
});
test('failed selected-store refresh clears old board; inline empty discovery never substitutes a project', async (t) => {
  let fail = false;
  const f = await mount(t, state(), ({ action }) => fail && action === 'refresh' ? { error: 'Selected Clips store unavailable' } : action === 'list_projects' ? { result: { projects: [], diagnostics: [{ code: 'invalid_registry', message: 'Registry is invalid.' }], userScope: 'local' } } : null);
  fail = true; await f.click('[data-command="refresh"]'); assert.equal(f.query('[data-record]'), null); assert.match(f.window.document.body.textContent, /store unavailable/);
  await f.wait(() => f.window.document.body.textContent.includes('Registry is invalid'));
  assert.match(f.window.document.body.textContent, /No available Clips projects/);
  assert.equal(f.query('[role="dialog"]'), null); assert.equal(f.query('[data-project-tab]'), null);
  assert.equal(f.calls.some((c) => c.action === 'set_project'), false);
});
test('Task Run exists only in anchored kebab, sends exact Task once and surfaces pending failure without a modal', async (t) => {
  let release; let started; const gate = new Promise((r) => { release = r; }); const entered = new Promise((r) => { started = r; });
  const f = await mount(t, { ...state(), focus: task.ref }, async ({ action }) => { if (action === 'launch') { started(); await gate; return { error: 'Joined send failed; binding retained' }; } });
  assert.equal(f.query('[data-record="#alice#g001#t01"] [data-send]'), null);
  const trigger = f.query('[data-menu="#alice#g001#t01"]'); trigger.focus(); await f.click('[data-menu="#alice#g001#t01"]');
  const run = f.query('[data-task-run]'); assert.ok(run); assert.equal(disabled(run), false);
  run.click(); run.click(); await entered; await f.wait(() => disabled(f.query('[data-menu="#alice#g001#t01"]')));
  assert.equal(f.calls.filter((c) => c.action === 'launch').length, 1); assert.deepEqual(f.calls.find((c) => c.action === 'launch').input, { ref: task.ref, expectedProjectPath: '/A' });
  release(); await f.wait(() => f.window.document.body.textContent.includes('Joined send failed'));
  assert.equal(f.query('[role="dialog"]'), null); await f.wait(() => f.window.document.activeElement === trigger);
  assert.equal(f.query('[data-send]'), null, 'all record Run actions are menu-only');
});
test('only visible expansion and metadata kebab are inline while every Run sends its exact ref once through the current-session action', async (t) => {
  for (const ref of ['#l001', goal.ref, task.ref]) {
    const s = { ...state(), focus: ref === '#l001' ? null : task.ref };
    s.workBindings = { [ref]: ['other-session'] };
    s.projectSessions.push({ id: 'other-session', summary: 'Other ongoing work', recordRef: ref, status: 'running' });
    let release, entered;
    const gate = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { entered = resolve; });
    t.after(() => release());
    const f = await mount(t, s, async ({ action }) => {
      if (action === 'launch') { entered(); await gate; return { result: s }; }
    });
    for (const card of f.window.document.querySelectorAll('[data-record]')) {
      const ownButtons = [...card.querySelectorAll('button')].filter(button => button.closest('[data-record]') === card);
      assert.deepEqual(new Set(ownButtons), new Set([card.querySelector(`[data-menu="${card.dataset.record}"]`), ...card.querySelectorAll(`:scope > .clips-board-details-toggle [data-expand="${card.dataset.record}"]`)].filter(Boolean)));
    }
    assert.doesNotMatch(f.window.document.body.textContent, /Send to this session|Closed goals are hidden\./);
    const trigger = f.query(`[data-menu="${ref}"]`);
    trigger.focus(); await f.click(`[data-menu="${ref}"]`);
    assert.equal(f.query('[role="menu"] [data-expand]'), null, 'expansion is outside the kebab');
    const run = f.query(`[data-run="${ref}"]`);
    assert.equal(run.textContent, 'Run in this session'); assert.equal(disabled(run), false);
    assert.ok(f.query('[data-session="other-session"]'), 'association navigation does not reserve Run');
    run.click(); run.click(); await started;
    await f.wait(() => disabled(trigger));
    for (const control of f.window.document.querySelectorAll('[data-expand]')) assert.equal(disabled(control), true);
    assert.deepEqual(f.calls.filter(call => call.action === 'launch').map(call => call.input), [{ ref, expectedProjectPath: '/A' }]);
    assert.equal(f.calls.some(call => call.action === 'open_session'), false);
    assert.equal(f.query('[role="dialog"]'), null);
    release();
    await f.wait(() => !disabled(trigger));
    await f.wait(() => f.window.document.activeElement === trigger);
    assert.match(f.window.document.body.textContent, /Message sent through the current joined Copilot session/);
  }
});
test('Go to session is available only for observed associated running or attention sessions across all record kinds', async (t) => {
  for (const ref of ['#l001', goal.ref, task.ref]) {
    const s = { ...state(), focus: ref === '#l001' ? null : task.ref };
    const statuses = ['running', 'attention', 'idle', 'error', 'unknown', 'ended', 'closed'];
    s.workBindings = { [ref]: [...statuses, 'missing'] };
    s.projectSessions.push(...statuses.map(status => ({ id: status, name: `${status} target`, recordRef: ref, status })));
    s.projectSessions.push({ id: 'unrelated', summary: 'Unrelated active work', status: 'running', recordRef: '#g999' });
    const f = await mount(t, s, ({ action }) => action === 'open_session' ? { result: { url: '#target' } } : null);
    const trigger = f.query(`[data-menu="${ref}"]`);
    for (const id of ['running', 'attention']) {
      await f.click(`[data-menu="${ref}"]`);
      assert.deepEqual([...f.window.document.querySelectorAll('[role="menu"] [data-session]')].map(item => item.dataset.session), ['running', 'attention']);
      const item = f.query(`[data-session="${id}"]`);
      assert.equal(item.textContent.replace(`${id} target`, '').trim(), 'Go to session');
      assert.match(item.getAttribute('aria-label'), new RegExp(`${id} target.*${id}`));
      await f.click(`[data-session="${id}"]`);
      await f.wait(() => f.window.document.activeElement === trigger);
    }
    assert.deepEqual(f.calls.filter(call => call.action === 'open_session').map(call => call.input), ['running', 'attention'].map(sessionId => ({ sessionId, expectedProjectPath: '/A' })));
    assert.equal(f.calls.some(call => ['launch', 'focus'].includes(call.action)), false, 'Go never focuses the Lane or launches work');
  }
});
test('all record status badges use actual Primer Label success accent and done variants', async (t) => {
  for (const [status, variant] of [['in_progress', 'success'], ['open', 'accent'], ['closed', 'done']]) {
    const s = { ...state(), focus: task.ref };
    s.lanes[0].status = status; s.goals[0].status = status; s.goals[0].tasks[0].status = status;
    const f = await mount(t, s);
    for (const ref of ['#l001', goal.ref, task.ref]) {
      const label = f.query(`[data-record-status="${ref}"]`);
      assert.ok(label); assert.equal(label.dataset.status, status);
      assert.equal(label.dataset.variant, variant);
      assert.match(label.className, /prc-Label-/);
    }
  }
});
test('an otherwise empty Lane omits the closed-hidden sentence but keeps menu-only closed Goal reveal', async (t) => {
  const s = state();
  for (const record of s.goals) record.status = 'closed';
  const f = await mount(t, s);
  assert.equal(f.query('[data-record="#alice#g001"]'), null);
  assert.doesNotMatch(f.window.document.body.textContent, /Closed goals are hidden\./);
  const trigger = f.query('[data-menu="#l001"]');
  await f.click('[data-menu="#l001"]'); await f.click('[data-closed="#l001"]');
  await f.wait(() => f.query('[data-record="#alice#g001"]') && f.query('[data-record="#alice#g002"]'));
  await f.wait(() => f.window.document.activeElement === trigger);
  await f.click('[data-menu="#l001"]'); await f.click('[data-closed="#l001"]');
  await f.wait(() => !f.query('[data-record="#alice#g001"]') && !f.query('[data-record="#alice#g002"]'));
  assert.doesNotMatch(f.window.document.body.textContent, /Closed goals are hidden\./);
});
test('Task menu keeps navigation alongside Run; only lifecycle and actual send capability disable it', async (t) => {
  for (const scenario of ['occupied','closed','capability','role','project','running-current']) {
    const s = { ...state(), focus: task.ref };
    if (scenario === 'occupied') s.projectSessions.push({ id: 'existing', recordRef: task.ref, status: 'running' });
    if (scenario === 'closed') s.goals[0].tasks[0].status = 'closed';
    if (scenario === 'capability') s.hostCapabilities.canSendToCurrentSession = false;
    if (scenario === 'role') Object.assign(s.projectSessions[0], { recordRef: '#l999', recordKind: 'lane' });
    if (scenario === 'project') s.projectSessions = [];
    if (scenario === 'running-current') s.projectSessions[0].status = 'running';
    const f = await mount(t, s); await f.click('[data-menu="#alice#g001#t01"]');
    if (scenario === 'occupied') assert.ok(f.query('[data-task-open-session="existing"]'));
    assert.equal(disabled(f.query('[data-task-run]')), ['closed', 'capability'].includes(scenario), scenario);
    assert.equal(f.calls.some((c) => c.action === 'launch'), false);
  }
});
test('Lane Run remains available without host identity and with existing or unreadable ownership', async (t) => {
  for (const scenario of ['missing-host', 'owned', 'unreadable']) {
    const s = state();
    s.hostCapabilities.hostIdConfigured = false;
    if (scenario === 'owned') {
      s.lanes[0].manager_claim.owners = [{ runtime: 'copilot-sdk', session_id: 'manager' }];
      s.projectSessions.push({ id: 'manager', status: 'running' });
    }
    if (scenario === 'unreadable') {
      s.lanes[0].manager_claim = null;
      s.lanes[0].manager_claim_error = 'Unreadable advisory metadata';
    }
    const f = await mount(t, s);
    await f.click('[data-menu="#l001"]');
    assert.equal(disabled(f.query('[data-run="#l001"]')), false, scenario);
    if (scenario === 'owned') assert.ok(f.query('[data-session="manager"]'));
  }
});
test('observed manager-claim activity keeps the Lane visible under Running even without a local record binding', async (t) => {
  const s = state(); s.lanes[0].manager_claim.owners = [{ runtime: 'copilot-sdk', session_id: 'manager' }];
  s.projectSessions.push({ id: 'manager', status: 'running' });
  const f = await mount(t, s); await f.click('[data-filter="running"]');
  assert.ok(f.query('[data-lane-column="#l001"]'));
  assert.equal(f.query('[data-filter="running"]').textContent, 'Running sessions · 1');
  assert.match(f.query('[data-record="#l001"] .runtime-status').textContent, /Direct lane associations: 1 listed · Running: 1/);
  assert.equal(f.query('.clips-board-running'), null);
});
test('actual Primer forms preserve exact label add/remove and namespaced parent Task creation', async (t) => {
  const s = { ...state(), focus: task.ref }; s.goals[0].tasks[0].labels = [{ id: 'urgent', name: 'Urgent' }];
  const f = await mount(t, s);
  await f.click('[data-menu="#alice#g001#t01"]');
  await selectMenu(f, 'Labels'); await f.wait(() => f.query('#label-choice'));
  await f.input('#label-choice', 'urgent'); f.query('[data-operation="add"]').click(); await f.wait(() => f.calls.some((c) => c.action === 'add_label'));
  assert.deepEqual(f.calls.find((c) => c.action === 'add_label').input, { ref: task.ref, labelId: 'urgent', expectedProjectPath: '/A' });
  await f.wait(() => !f.query('[role="dialog"]'));
  await f.click('[data-menu="#alice#g001#t01"]'); await selectMenu(f, 'Labels'); await f.wait(() => f.query('#assigned-choice'));
  await f.input('#assigned-choice', 'urgent'); f.query('[data-operation="remove"]').click(); await f.wait(() => f.calls.some((c) => c.action === 'remove_label')); await f.wait(() => !f.query('[role="dialog"]'));
  assert.equal(f.calls.find((c) => c.action === 'remove_label').input.ref, task.ref);
  await f.click('[data-menu="#alice#g001"]'); await selectMenu(f, 'New Task'); await f.wait(() => f.query('#record-title'));
  assert.equal(f.query('#record-parent').value, goal.ref);
  await f.input('#record-title', 'Scoped Task'); await f.input('#record-description', 'Description'); await f.input('#record-criteria', 'Observable result');
  f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => f.calls.some((c) => c.action === 'create_task'));
  assert.deepEqual(f.calls.find((c) => c.action === 'create_task').input, { title: 'Scoped Task', description: 'Description', goal_ref: goal.ref, acceptance_criteria: ['Observable result'], expectedProjectPath: '/A' });
});

test('overview Lane and outside-Lanes groups enclose compact headers and contrasting Primer record cards', async (t) => {
  const s = state(); s.goals.push({ ...structuredClone(goal), ref: '#alice#g003', title: 'Outside Goal', tasks: [] });
  const f = await mount(t, s);
  for (const [key, headerRef, goalRef] of [['#l001', '#l001', goal.ref], ['unassigned', null, '#alice#g003']]) {
    const column = f.query(`[data-lane-column="${key}"]`); assert.ok(column);
    assert.ok(column.classList.contains('clips-board-lane-column'));
    const header = column.querySelector(':scope > .clips-board-lane-header, :scope > .clips-board-unassigned-header');
    const content = column.querySelector(':scope > .clips-board-lane-goals'); assert.ok(header && content);
    if (headerRef) assert.equal(header.dataset.record, headerRef); else assert.match(header.textContent, /Goals outside Lanes/);
    assert.equal(header.tagName, 'HEADER');
    assert.equal(header.classList.contains('clips-work-card'), false);
    assert.equal(header.classList.contains('work-card'), false);
    if (headerRef) {
      assert.equal(header.querySelector('button[aria-label^="New Goal"]'), null);
      assert.ok(header.querySelector(`[data-menu="${headerRef}"]`));
    } else assert.ok(header.querySelector('button[aria-label^="New Goal"]'));
    assert.ok(header.querySelector('[data-component="CounterLabel"]'));
    const nestedGoal = content.querySelector(`:scope > [data-record="${goalRef}"]`); assert.ok(nestedGoal);
    assert.ok(nestedGoal.classList.contains('clips-work-card'));
    assert.equal(nestedGoal.classList.contains('clips-board-lane-header'), false);
  }
  await focusLane(f);
  assert.equal(f.query('[data-lane-column]'), null); assert.equal(f.query('.clips-board-lane-header'), null, 'focused Goal columns remain distinct');
  await f.click('[data-back]'); await f.wait(() => f.query('.lane-columns'));
  assert.ok(f.query('[data-lane-column="#l001"] [data-record="#alice#g001"]'));
  assert.ok(f.query('[data-lane-column="unassigned"] [data-record="#alice#g003"]'));
  const css = await readFile(new URL('./dist/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.clips-board-lane-column\{[^}]*background:var\(--bgColor-muted\)/);
  assert.match(css, /\.clips-work-card\{[^}]*background:var\(--bgColor-default\)/);
  assert.match(css, /\.clips-work-card\{[^}]*border:var\(--borderWidth-thin\) solid var\(--borderColor-default\)/);
  assert.match(css, /\.clips-board-lane-column\{[^}]*gap:0[^}]*padding:0/);
  assert.match(css, /\.clips-board-lane-header\{[^}]*background:var\(--bgColor-default\)/);
  assert.match(css, /\.clips-board-lane-header\{[^}]*border-bottom:var\(--borderWidth-thin\) solid var\(--borderColor-default\)/);
});


test('built nested Primer cards wrap full titles and keep menus separate from titles and actions', async (t) => {
  const s = { ...state(), focus: task.ref };
  const long = 'Unbroken' + 'abcdefghij'.repeat(30);
  s.lanes[0].title = `Lane ${long}`; s.goals[0].title = `Goal ${long}`; s.goals[0].tasks[0].title = `Task ${long}`;
  s.goals[0].tasks[0].labels[0].name = long;
  s.goals[0].tasks[0].description = long;
  const f = await mount(t, s, ({ action }) => action === 'open_session' ? { result: { url: '#joined' } } : null);
  const check = (ref, title, running = false) => {
    const card = f.query(`[data-record="${ref}"]`); assert.ok(card);
    const heading = card.querySelector(':scope > .clips-work-card-header .clips-work-card-title');
    assert.equal(heading.textContent, title);
    assert.match(heading.tagName, /^H[1-6]$/); assert.equal(heading.querySelector('button'), null);
    const row = card.querySelector(':scope > .clips-work-card-header > .clips-work-card-meta-row');
    assert.ok(row);
    const menu = row.querySelector(`[data-menu="${ref}"]`);
    assert.ok(menu); assert.ok(menu.getAttribute('aria-label'));
    assert.equal(row.querySelector('code').textContent, ref);
    assert.ok(row.querySelector(`[data-record-status="${ref}"]`));
    assert.equal(heading.contains(menu), false);
    const status = card.querySelector(':scope > .clips-work-card-content > .runtime-status');
    assert.equal(Boolean(status), running);
    if (status) assert.equal(status.contains(menu), false);
    const footer = card.querySelector(':scope > .record-actions');
    if (footer) {
      assert.equal(footer.querySelector('button'), null, 'session sub-card footer has no controls');
      assert.equal(footer.contains(status), false);
    }
    assert.equal(card.querySelector('[data-run], [data-session]'), null);
    return row;
  };
  check(goal.ref, s.goals[0].title);
  check(task.ref, s.goals[0].tasks[0].title);
  const badge = f.query(`[data-record="${task.ref}"] .clips-board-label`);
  assert.equal(badge.textContent, long);
  const css = await readFile(new URL('./dist/style.css', import.meta.url), 'utf8');
  assert.match(css, /\.clips-work-card-title[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.clips-board \.clips-board-label\{[^}]*white-space:normal/);
  assert.match(css, /\.clips-board \.clips-board-label\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.clips-board-column\{[^}]*max-width:calc\(100vw - var\(--base-size-32\)\)/);
  await f.click('[data-back]'); await f.wait(() => f.query('.lane-columns'));
  check('#l001', s.lanes[0].title);
  // Association navigation and Run both remain menu-only while work is ongoing.
  s.projectSessions[0].recordRef = task.ref; s.projectSessions[0].recordKind = 'task'; s.projectSessions[0].status = 'running';
  f.setServer(s); await f.click('[data-command="refresh"]');
  check(task.ref, s.goals[0].tasks[0].title, true);
  assert.match(f.query(`[data-record="${task.ref}"] .runtime-status`).textContent, /Running/);
  await f.click(`[data-menu="${task.ref}"]`);
  const open = f.query('[data-session="joined"]'); assert.ok(open); assert.equal(open.textContent.replace('Current session', '').trim(), 'Go to session');
  await f.click('[data-session="joined"]'); assert.equal(f.calls.find((c) => c.action === 'open_session').input.sessionId, 'joined'); assert.equal(f.calls.some((c) => c.action === 'launch'), false);
  await f.click(`[data-menu="${task.ref}"]`); assert.equal(disabled(f.query('[data-task-run]')), false); assert.ok(f.query('[data-task-open-session="joined"]'));
});

test('Primer filter radios retain roving keyboard focus and Lane add uses exact parent refs', async (t) => {
  const f = await mount(t);
  const open = f.query('[data-filter="open"]'); open.focus();
  open.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  await f.wait(() => f.query('[data-filter="running"]').getAttribute('aria-checked') === 'true');
  assert.equal(f.window.document.activeElement, f.query('[data-filter="running"]'));
  assert.equal(f.query('[data-filter="open"]').tabIndex, -1);
  f.query('[data-filter="running"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
  await f.wait(() => f.query('[data-filter="all"]').getAttribute('aria-checked') === 'true');
  await recordMenuAction(f, '#l001', 'New Goal');
  await f.wait(() => f.query('#record-parent'));
  assert.equal(f.query('#record-parent').value, '#l001');
  f.query('[role="dialog"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await f.wait(() => !f.query('[role="dialog"]'));
});

test('Primer required text controls reject blank title, criteria and session prompts without dispatch', async (t) => {
  for (const kind of ['lane', 'task', 'steer']) {
    const f = await mount(t, { ...state(), focus: kind === 'lane' ? null : task.ref });
    if (kind === 'lane') await globalNew(f, 'lane');
    if (kind === 'task') {
      await f.click('[data-menu="#alice#g001"]');
      await selectMenu(f, 'New Task');
      await f.wait(() => f.query('#record-title'));
      await f.input('#record-title', 'Valid task title');
    }
    if (kind === 'steer') {
      f.query('.clips-app-sessions').open = true;
      [...f.window.document.querySelectorAll('button')].find((b) => b.textContent === 'Steer').click();
      await f.wait(() => f.query('#steer-prompt'));
      await f.input('#steer-prompt', '   ');
    }
    await f.wait(() => f.query('#canvas-dialog-form'));
    f.query('#canvas-dialog-form').requestSubmit();
    await f.wait(() => f.window.document.body.textContent.includes('Complete the required fields'));
    assert.equal(f.calls.some((call) => ['create_lane', 'create_task', 'steer'].includes(call.action)), false, kind);
    assert.equal(f.query('[role="dialog"]').getAttribute('aria-modal'), 'true');
    assert.equal(f.window.document.activeElement.id, kind === 'lane' ? 'record-title' : kind === 'task' ? 'record-criteria' : 'steer-prompt');
  }
});

test('Primer Lane, focused Goal and steering forms preserve exact canonical payloads', async (t) => {
  const f = await mount(t);
  await globalNew(f, 'lane');
  await f.wait(() => f.query('#record-title'));
  await f.input('#record-title', 'New Lane'); await f.input('#record-description', 'Lane outcome');
  f.query('#canvas-dialog-form').requestSubmit();
  await f.wait(() => !f.query('[role="dialog"]'));
  assert.deepEqual(f.calls.find((call) => call.action === 'create_lane').input, { title: 'New Lane', description: 'Lane outcome', expectedProjectPath: '/A' });
  await focusLane(f);
  await globalNew(f, 'goal');
  await f.wait(() => f.query('#record-title'));
  assert.equal(f.query('#record-parent').value, '#l001');
  await f.input('#record-title', 'New Goal'); await f.input('#record-description', 'Goal outcome');
  f.query('#canvas-dialog-form').requestSubmit();
  await f.wait(() => !f.query('[role="dialog"]'));
  assert.deepEqual(f.calls.find((call) => call.action === 'create_goal').input, { title: 'New Goal', description: 'Goal outcome', lane_id: '#l001', expectedProjectPath: '/A' });
  f.query('.clips-app-sessions').open = true;
  [...f.window.document.querySelectorAll('button')].find((button) => button.textContent === 'Steer').click();
  await f.wait(() => f.query('#steer-prompt'));
  await f.input('#steer-prompt', 'Check the acceptance criteria.');
  f.query('#canvas-dialog-form').requestSubmit();
  await f.wait(() => !f.query('[role="dialog"]'));
  assert.deepEqual(f.calls.find((call) => call.action === 'steer').input, { sessionId: 'joined', prompt: 'Check the acceptance criteria.', expectedProjectPath: '/A' });
});

test('global New is an anchored menu and its creation forms preserve editable exact parent refs and original focus', async (t) => {
  const s = state();
  s.lanes.push({ ...structuredClone(s.lanes[0]), ref: '#alice#l002', title: 'Other Lane', goal_refs: [] });
  const f = await mount(t, s);
  const trigger = f.query('[data-command="new"]');
  assert.ok(trigger); assert.equal(trigger.textContent, 'New');
  assert.equal(f.query('[data-command="create_lane"]'), null, 'no standalone New Lane');
  assert.equal(f.query('[data-command="create_goal"]'), null, 'no standalone global New Goal');
  await f.click('[data-command="new"]');
  assert.equal(f.query('[role="dialog"]'), null);
  assert.equal(f.query('[role="menu"]').parentElement.closest('[data-variant]').dataset.variant, 'anchored');
  assert.deepEqual([...f.window.document.querySelectorAll('[role="menu"] [data-command]')].map(item => item.textContent), ['New Lane', 'New Goal', 'New Task']);
  await f.click('[data-command="create_lane"]'); await f.wait(() => f.query('#record-title'));
  assert.equal(f.query('#record-parent'), null);
  await f.input('#record-title', 'Global Lane'); await f.input('#record-description', 'Outcome');
  f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => !f.query('[role="dialog"]'));
  assert.deepEqual(f.calls.find(call => call.action === 'create_lane').input, { title: 'Global Lane', description: 'Outcome', expectedProjectPath: '/A' });
  await f.wait(() => f.window.document.activeElement === trigger);
  await focusLane(f);
  const focusedNew = f.query('[data-command="new"]');
  for (const parent of ['#alice#l002', '']) {
    await globalNew(f, 'goal');
    assert.equal(f.query('#record-parent').value, '#l001', 'focused Lane is an editable initial value only');
    await f.input('#record-parent', parent);
    await f.input('#record-title', 'Global Goal'); await f.input('#record-description', 'Goal outcome');
    f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => !f.query('[role="dialog"]'));
    const latest = f.calls.filter(call => call.action === 'create_goal').at(-1).input;
    assert.deepEqual(latest, { title: 'Global Goal', description: 'Goal outcome', ...(parent ? { lane_id: parent } : {}), expectedProjectPath: '/A' });
    await f.wait(() => f.window.document.activeElement === focusedNew);
  }
  await globalNew(f, 'task');
  assert.equal(f.query('#record-parent').value, '', 'global Task requires a deliberate Goal choice');
  assert.equal(f.query('#record-parent').required, true);
  await f.input('#record-title', 'Global Task'); await f.input('#record-description', 'Task outcome'); await f.input('#record-criteria', 'First condition\nSecond condition');
  f.query('#canvas-dialog-form').requestSubmit();
  assert.equal(f.query('#record-parent').checkValidity(), false);
  assert.equal(f.calls.some(call => call.action === 'create_task'), false);
  f.query('#canvas-dialog-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await f.wait(() => f.window.document.activeElement === f.query('#record-parent'));
  assert.equal(f.calls.some(call => call.action === 'create_task'), false);
  await f.input('#record-parent', goal.ref);
  f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => !f.query('[role="dialog"]'));
  assert.deepEqual(f.calls.find(call => call.action === 'create_task').input, { title: 'Global Task', description: 'Task outcome', goal_ref: goal.ref, acceptance_criteria: ['First condition', 'Second condition'], expectedProjectPath: '/A' });
  await f.wait(() => f.window.document.activeElement === focusedNew);
});

test('global Task creation blocks missing or invalid Goals without a creation RPC', async (t) => {
  const empty = state(); empty.goals = []; empty.lanes[0].goal_refs = [];
  const f = await mount(t, empty);
  await globalNew(f, 'task');
  assert.match(f.window.document.body.textContent, /No Goals are available.*Cancel and choose New Goal/);
  assert.equal(f.query('#record-parent').disabled, true);
  assert.equal(f.query('#canvas-dialog-form button[type="submit"]').disabled, true);
  f.query('#canvas-dialog-form').dispatchEvent(new f.window.Event('submit', { bubbles: true, cancelable: true }));
  await f.wait(() => f.window.document.body.textContent.includes('Create a Goal before creating a Task.'));
  assert.equal(f.calls.some(call => call.action === 'create_task'), false);
  f.query('[role="dialog"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await f.wait(() => f.window.document.activeElement === f.query('[data-command="new"]'));

  const valid = await mount(t);
  await globalNew(valid, 'task');
  await valid.input('#record-title', 'Task'); await valid.input('#record-criteria', 'Observable');
  valid.query('#record-parent').append(new valid.window.Option('Unavailable old Goal', '#alice#g999'));
  await valid.input('#record-parent', '#alice#g999');
  valid.query('#canvas-dialog-form').requestSubmit();
  await valid.wait(() => valid.window.document.body.textContent.includes('Choose an available Goal'));
  assert.equal(valid.calls.some(call => call.action === 'create_task'), false);
  assert.equal(valid.window.document.activeElement, valid.query('#record-parent'));
  assert.ok(valid.query('[role="dialog"]'));
});

test('global New creation preserves pending modal guards, visible errors and retry focus', async (t) => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  let first = true;
  const f = await mount(t, state(), async ({ action }) => {
    if (action === 'create_lane' && first) { first = false; entered(); await gate; return { error: 'Lane creation rejected' }; }
  });
  const trigger = f.query('[data-command="new"]');
  await globalNew(f, 'lane');
  await f.input('#record-title', 'Retry Lane');
  f.query('#canvas-dialog-form').requestSubmit(); await started;
  await f.wait(() => f.query('#canvas-dialog-form fieldset').disabled);
  assert.equal(trigger.disabled, true);
  f.query('[role="dialog"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(f.query('[role="dialog"]'));
  release();
  await f.wait(() => f.window.document.body.textContent.includes('Lane creation rejected'));
  assert.ok(f.query('[role="dialog"]')); assert.equal(f.query('#record-title').value, 'Retry Lane');
  f.query('#canvas-dialog-form').requestSubmit(); await f.wait(() => !f.query('[role="dialog"]'));
  await f.wait(() => f.window.document.activeElement === trigger);
  assert.equal(f.calls.filter(call => call.action === 'create_lane').length, 2);
});

test('in-card actions use small Primer controls while outside and form controls remain medium', async (t) => {
  const f = await mount(t);
  const check = () => {
    const buttons = [...f.window.document.querySelectorAll('[data-component="Button"]')];
    assert.ok(buttons.length);
    for (const button of buttons) {
      const inCard = button.closest('[data-record], .clips-app-session');
      if (inCard) assert.equal(button.dataset.size, 'small', button.textContent || button.getAttribute('aria-label'));
      else assert.ok(['small', 'medium'].includes(button.dataset.size), button.textContent || button.getAttribute('aria-label'));
    }
  };
  check();
  await f.click('[data-menu="#alice#g001"]'); await selectMenu(f, 'Update status'); await f.wait(() => f.query('[role="dialog"]')); check();
  const theme = await readFile(new URL('./ui/theme.css', import.meta.url), 'utf8');
  assert.doesNotMatch(theme, /40px|44px|min-height:\s*(40|44)|--control-(large|xlarge)-size/);
});

test('actual emitted title cascade wraps plain semantic headings without title controls or chevrons', async (t) => {
  const s = { ...state(), focus: task.ref };
  const title = 'Make Clips Work feel like GitHub Projects using Primer';
  s.lanes[0].title = title; s.goals[0].title = title; s.goals[0].tasks[0].title = 'Unbroken' + 'abcdefghij'.repeat(30);
  s.lanes[0].description = 'Long Lane context '.repeat(30);
  s.goals[0].tasks[0].description = 'Long Task context '.repeat(30);
  const f = await mount(t, s, undefined, { loadStyles: true });
  const check = (ref, expected) => {
    const card = f.query(`[data-record="${ref}"]`);
    const heading = card.querySelector(':scope > .clips-work-card-header .clips-work-card-title');
    assert.equal(heading.textContent, expected); assert.match(heading.tagName, /^H[1-6]$/);
    assert.equal(heading.querySelector('button'), null); assert.equal(heading.closest('button'), null);
    assert.equal(card.querySelector('.clips-work-card-expand'), null);
    const style = f.window.getComputedStyle(heading);
    assert.match(style.minWidth, /^0(px)?$/); assert.equal(style.whiteSpace, 'normal');
    assert.equal(style.fontSize, 'var(--text-body-size-medium)', 'record titles are not reduced with session titles');
    assert.equal(style.overflowWrap, 'anywhere');
    assert.notEqual(style.overflow, 'hidden'); assert.notEqual(style.textOverflow, 'ellipsis');
    const row = card.querySelector(':scope > .clips-work-card-header > .clips-work-card-meta-row');
    assert.ok(row.querySelector(`[data-menu="${ref}"]`)); assert.equal(row.querySelector('code').textContent, ref);
    assert.ok(row.querySelector(`[data-record-status="${ref}"]`));
    assert.equal(f.window.getComputedStyle(row).display, 'grid');
    assert.equal(row.contains(heading), false, 'metadata/menu and title stay in separate rows');
    const expansion = card.querySelector(`:scope > .clips-board-details-toggle [data-expand="${ref}"]`);
    assert.ok(expansion); assert.equal(expansion.tagName, 'BUTTON');
    assert.equal(expansion.dataset.size, 'small');
    assert.ok(['Show more', 'Show less'].includes(expansion.textContent));
  };
  check(goal.ref, title); check(task.ref, s.goals[0].tasks[0].title);
  await f.click(`[data-menu="${task.ref}"]`);
  assert.equal(f.window.document.querySelectorAll(`[role="menu"] [data-expand="${task.ref}"]`).length, 0, 'expansion is not duplicated in the menu');
  f.query('[role="menu"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await f.wait(() => !f.query('[role="menu"]'));
  await f.click('[data-back]'); await f.wait(() => f.query('.lane-columns'));
  check('#l001', title);
  const css = await readFile(new URL('./dist/style.css', import.meta.url), 'utf8');
  const metadata = css.match(/\.clips-work-card-meta-row\{([^}]*)\}/)?.[1];
  assert.ok(metadata);
  assert.match(metadata, /grid-template-columns:minmax\(0,1fr\) auto/);
  assert.doesNotMatch(metadata, /margin(?:-bottom)?:[^;}]*-/);
  const laneCard = f.query('[data-record="#l001"]');
  const laneTitle = laneCard.querySelector('.clips-work-card-title');
  const titleRow = laneTitle.parentElement;
  assert.equal(laneTitle.nextElementSibling?.getAttribute('aria-label'), '1 visible Goals');
  assert.equal(f.window.getComputedStyle(laneTitle).flexGrow, '0', 'Lane title does not stretch the counter to the far edge');
  assert.notEqual(f.window.getComputedStyle(titleRow).justifyContent, 'space-between');
  assert.equal(f.window.getComputedStyle(titleRow).gap, 'var(--base-size-4)');
});

test('real available project tabs select exact IDs and restore tab focus across project remount', async (t) => {
  const f = await mount(t);
  await f.wait(() => f.query('[data-project-tab="B"]'));
  assert.ok(f.query('.clips-board-view-bar [data-project-tab="B"]'), 'project tabs replace the original Board tab strip');
  assert.equal(f.query('.clips-board-project-header [data-project-tab]'), null);
  assert.equal(f.query('[data-command="project"]'), null, 'no project chooser trigger');
  assert.equal(f.query('[data-project-tab="A"]').getAttribute('aria-current'), 'page');
  assert.equal(f.query('[data-project-tab="B"]').textContent, 'Beta');
  await f.click('[data-project-tab="B"]');
  await f.wait(() => f.query('[data-project-tab="B"]')?.getAttribute('aria-current') === 'page');
  assert.equal(f.query('[role="dialog"]'), null, 'tabs are the sole project selector');
  assert.deepEqual(f.calls.find(call => call.action === 'set_project').input, { projectId: 'B' });
  await f.wait(() => f.window.document.activeElement === f.query('[data-project-tab="B"]'));
  assert.match(f.window.document.body.textContent, /Lane Beta/);
  assert.equal(f.query('[data-command="initialize"]'), null, 'selected board alone does not grant init eligibility');
  await focusLane(f);
  assert.equal(f.query('.clips-board-project-header h1').textContent, 'Lane Beta');
  assert.ok(f.query('.clips-board-project-header [data-back]'));
});

test('overview uses the larger Clips title without a brand icon or project-name heading and preserves paths actions tabs and Lane focus', async (t) => {
  const f = await mount(t, state(), undefined, { loadStyles: true });
  const check = (path) => {
    const heading = f.query('.clips-board-project-heading');
    assert.equal(heading.querySelector('h1').textContent, 'Clips');
    assert.equal(f.window.getComputedStyle(heading.querySelector('h1')).fontSize, 'var(--text-title-size-medium)');
    assert.equal(heading.querySelector('svg'), null);
    assert.equal(heading.querySelector('.clips-board-brand'), null);
    assert.equal(heading.querySelector('.clips-board-project-context').textContent, path);
    assert.ok(f.query('[data-command="new"]'));
    assert.ok(f.query('[data-command="refresh"]'));
  };
  check('/A');
  assert.equal(f.query('[data-project-tab="A"]').textContent, 'Alpha');
  await f.click('[data-project-tab="B"]');
  await f.wait(() => f.query('.clips-board-project-context').textContent === '/B');
  check('/B');
  assert.equal(f.query('[data-project-tab="B"]').getAttribute('aria-current'), 'page');
  await focusLane(f);
  assert.equal(f.query('.clips-board-project-heading h1').textContent, 'Lane Beta');
  assert.ok(f.query('[data-back]'));
  await f.click('[data-back]');
  await f.wait(() => f.query('.lane-columns'));
  check('/B');
});

test('global activity summary is absent without replacing unknown coverage and active-session associations never rewrite record lifecycle', async (t) => {
  for (const observed of [false, true]) {
    const s = state();
    s.goals[0].status = 'in_progress';
    s.projectSessions[0].status = observed ? 'running' : 'unknown';
    s.projectSessions.push({ ...s.projectSessions[0], recordRef: '#unrelated' });
    s.workBindings = { [goal.ref]: ['joined'], '#alice#g002': ['joined'] };
    const f = await mount(t, s);
    assert.equal(f.query('.clips-board-running'), null);
    assert.doesNotMatch(f.window.document.body.textContent, /Running now|Observed sessions|0 Tasks, 0 Goals, 0 Lanes/);
    assert.equal(f.query(`[data-record-status="${goal.ref}"]`).textContent, 'In progress');
    const running = f.query('[data-filter="running"]');
    assert.match(running.textContent, /^Running sessions/);
    assert.match(running.title, /associated.*observed running.*not.*record execution/i);
    await f.click('[data-filter="running"]');
    if (observed) {
      assert.equal(f.query('[data-record-status="#alice#g002"]').textContent, 'Closed', 'a historical association to a busy session does not reopen its record');
      assert.equal(running.textContent, 'Running sessions · 1', 'association filter deduplicates one real session across records');
      await f.click(`[data-menu="${goal.ref}"]`);
      assert.ok(f.query('[data-session="joined"]'), 'observed ongoing navigation is retained');
    } else {
      assert.equal(f.query(`[data-record="${goal.ref}"]`), null, 'unknown activity never qualifies as observed running');
    }
    assert.deepEqual(f.getServer().goals.map(record => record.status), ['in_progress', 'closed']);
    assert.equal(f.calls.some(call => ['set_status', 'launch'].includes(call.action)), false);
  }
});

test('compact custom project tabs retain raised borders, single-row labels and native busy selection', async (t) => {
  const projects = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Long project ' + 'abcdefghij'.repeat(25) }];
  let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const next = { ...state(), projectPath: '/B', selectedProject: projects[1] };
  const f = await mount(t, state(), async ({ action, setServer }) => {
    if (action === 'list_projects') return { result: { projects, userScope: 'local', diagnostics: [] } };
    if (action === 'set_project') { entered(); await gate; setServer(next); return { result: next }; }
    return null;
  }, { loadStyles: true });
  await f.wait(() => f.query('[data-project-tab="B"]'));
  const strip = f.query('.clips-board-view-bar .clips-board-project-tabs');
  assert.equal(strip.tagName, 'NAV'); assert.equal(strip.getAttribute('aria-label'), 'Clips projects');
  assert.equal(strip.querySelectorAll('ul > li > button').length, projects.length);
  const active = f.query('[data-project-tab="A"]');
  const other = f.query('[data-project-tab="B"]');
  for (const button of [active, other]) {
    assert.equal(button.dataset.component, 'Button'); assert.equal(button.type, 'button');
    assert.equal(button.dataset.size, 'small');
    assert.equal(button.querySelector('svg'), null, 'project tabs are text-only');
    assert.equal(button.tabIndex, 0); assert.ok(button.classList.contains('clips-board-project-tab'));
    assert.doesNotMatch(button.className, /UnderlineNav/);
  }
  assert.equal(active.closest('li').dataset.selected, 'true');
  assert.equal(f.window.getComputedStyle(active).borderBottomWidth, '0px');
  assert.equal(f.window.getComputedStyle(strip.querySelector('ul')).flexWrap, 'nowrap');
  const label = other.querySelector('[data-component="text"]');
  assert.equal(label.textContent, projects[1].name);
  assert.equal(f.window.getComputedStyle(label).whiteSpace, 'nowrap');
  assert.notEqual(f.window.getComputedStyle(label).textOverflow, 'ellipsis');
  const css = await readFile(new URL('./dist/style.css', import.meta.url), 'utf8');
  const baseRule = css.match(/\.clips-board-project-tabs \.clips-board-project-tab\{([^}]*)\}/)?.[1];
  assert.ok(baseRule, 'the actual raised-tab stylesheet rule is emitted');
  assert.match(baseRule, /(?:^|;)border:var\(--borderWidth-thin\) solid transparent(?:;|$)/);
  assert.match(baseRule, /(?:^|;)border-bottom:0(?:;|$)/);
  assert.match(baseRule, /border-radius:var\(--borderRadius-medium\) var\(--borderRadius-medium\) 0 0/);
  assert.match(baseRule, /(?:^|;)height:auto(?:;|$)/);
  assert.match(baseRule, /min-height:var\(--control-small-size\)/);
  assert.match(baseRule, /padding:var\(--base-size-4\) var\(--control-small-paddingInline-normal\)/);
  assert.match(baseRule, /font-size:var\(--text-body-size-small\)/);
  assert.match(baseRule, /line-height:var\(--text-body-lineHeight-small\)/);
  assert.doesNotMatch(baseRule, /max-height:|overflow:hidden|--control-medium-size/);
  const token = (name, seen = new Set()) => {
    assert.ok(!seen.has(name), `official ${name} token must not be cyclic`);
    seen.add(name);
    const value = css.match(new RegExp(`--${name}:([^;}]+)`))?.[1];
    assert.ok(value, `official ${name} token is present in the emitted stylesheet`);
    const alias = value.match(/^var\(--([A-Za-z0-9-]+)\)$/);
    if (alias) return token(alias[1], seen);
    assert.match(value, /^\d*\.?\d+(?:rem|px)?$/, `official ${name} token resolves to a numeric value`);
    return parseFloat(value);
  };
  const minimum = token('control-small-size') * 16;
  const blockPadding = token('base-size-4') * 16;
  const inlinePadding = token('control-small-paddingInline-normal') * 16;
  const font = token('text-body-size-small') * 16;
  assert.equal(minimum, 28); assert.ok(minimum < token('control-medium-size') * 16);
  assert.equal(blockPadding, 4); assert.equal(inlinePadding, 12); assert.equal(font, 12);
  const singleLine = Math.max(minimum, font * token('text-body-lineHeight-small') + 2 * blockPadding + 1);
  assert.equal(singleLine, 28.5, 'automatic height accommodates the extra padding at the standard 16px rem');
  assert.equal(f.window.getComputedStyle(active).boxSizing, 'border-box');
  assert.ok(f.query('.clips-board-project-header svg'), 'unrelated header icons remain');
  assert.ok(f.query('[data-record] svg'), 'unrelated record icons remain');
  const selectedRule = css.match(/\.clips-board-project-tabs \.clips-board-project-tab\[aria-current=page\][^{]*\{([^}]*)\}/)?.[1];
  assert.ok(selectedRule, 'the actual selected-tab stylesheet rule is emitted');
  assert.match(selectedRule.replace(/\s/g, ''), /margin-bottom:calc\(-1\*var\(--borderWidth-thin\)\)/);
  assert.match(selectedRule, /border-color:var\(--borderColor-default\)/);
  assert.match(selectedRule, /background:var\(--bgColor-default\)/);
  assert.doesNotMatch(selectedRule, /orange|underline|box-shadow|--underlineNav|--borderColor-(accent|severe)/i);
  const source = await readFile(new URL('./ui/board.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bUnderlineNav\b/, 'the underline component is not used for these tabs');
  other.focus(); other.click(); await started;
  await f.wait(() => [...strip.querySelectorAll('button')].every(button => button.disabled));
  assert.equal(active.getAttribute('aria-current'), 'page', 'pending selection does not move the current-project marker');
  other.click(); assert.equal(f.calls.filter(call => call.action === 'set_project').length, 1);
  assert.deepEqual(f.calls.find(call => call.action === 'set_project').input, { projectId: 'B' });
  release();
  await f.wait(() => f.query('[data-project-tab="B"]')?.getAttribute('aria-current') === 'page');
  await f.wait(() => f.window.document.activeElement === f.query('[data-project-tab="B"]'));
  assert.equal(f.window.getComputedStyle(f.query('[data-project-tab="B"]')).borderBottomWidth, '0px');
  assert.equal(f.query('[role="dialog"]'), null);
});

test('project overflow partitions actual measured fractional widths and reserves the final More or accessible Plus tab', async (t) => {
  const projects = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Gamma' }, { id: 'D', name: 'Delta' }];
  const widths = { A: 83.25, B: 96.5, C: 70.25, D: 121 };
  const f = await mount(t, state(), ({ action }) => action === 'list_projects' ? { result: { projects } } : null, {
    loadStyles: true, viewportWidth: 360, projectLayout: { available: 371, widths, more: 72, selectedMore: 72, plus: 28 },
  });
  const visible = () => [...f.window.document.querySelectorAll('[data-project-strip] button[data-project-id]')].map(tab => tab.dataset.projectId);
  const cases = [
    [371, ['A', 'B', 'C', 'D'], null],
    [370.999, ['A', 'B', 'C'], 'more'],
    [251.75, ['A', 'B'], 'more'],
    [251.749, ['A'], 'more'],
    [155.25, ['A'], 'more'],
    [155.249, [], 'more'],
    [72, [], 'more'],
    [71.999, [], 'plus'],
    [28, [], 'plus'],
    [371, ['A', 'B', 'C', 'D'], null],
  ];
  for (const [available, ids, kind] of cases) {
    f.setProjectLayout({ available }); f.resizeProjects();
    await f.wait(() => visible().join() === ids.join() && (f.query('[data-project-overflow]')?.dataset.projectOverflow || null) === kind);
    const strip = f.query('[data-project-strip]');
    assert.equal(f.window.getComputedStyle(strip.querySelector('ul')).flexWrap, 'nowrap');
    assert.notEqual(f.window.getComputedStyle(strip).overflow, 'hidden');
    const probes = strip.querySelector('.clips-board-project-tab-measurements');
    assert.equal(probes.getAttribute('aria-hidden'), 'true'); assert.ok(probes.hasAttribute('inert'));
    assert.equal(probes.querySelector('button, a, input'), null, 'measurement probes are not duplicate interactive tabs');
    for (const tab of strip.querySelectorAll('button[data-project-id]')) {
      assert.equal(tab.textContent, projects.find(project => project.id === tab.dataset.projectId).name);
      assert.equal(tab.querySelector('svg'), null);
    }
    if (!kind) { assert.equal(f.query('[data-project-overflow-menu]'), null); continue; }
    const trigger = f.query('[data-project-overflow]');
    assert.equal(strip.querySelector('ul').lastElementChild.contains(trigger), true);
    assert.ok(ids.reduce((sum, id) => sum + widths[id], 0) + (kind === 'more' ? 72 : 28) <= available);
    assert.match(trigger.getAttribute('aria-label'), /More projects/);
    if (kind === 'more') assert.equal(trigger.textContent, 'More'); else assert.ok(trigger.querySelector('svg'));
    trigger.focus(); await f.click('[data-project-overflow]');
    await f.wait(() => f.query('[data-project-overflow-menu]'));
    assert.equal(f.query('[role="dialog"]'), null);
    assert.equal(f.query('[data-project-overflow-menu]').parentElement.closest('[data-variant]').dataset.variant, 'anchored');
    const hidden = [...f.window.document.querySelectorAll('[data-project-overflow-item]')].map(item => item.dataset.projectOverflowItem);
    assert.deepEqual(hidden, projects.slice(ids.length).map(project => project.id));
    assert.deepEqual([...ids, ...hidden], projects.map(project => project.id), 'every exact project appears once');
    f.query('[role="menu"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await f.wait(() => !f.query('[data-project-overflow-menu]'));
    await f.wait(() => f.window.document.activeElement === trigger);
    trigger.dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await f.wait(() => f.query('[data-project-overflow-menu]'));
    await f.wait(() => f.window.document.activeElement === f.query('[data-project-overflow-item]'));
    f.query('[role="menu"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await f.wait(() => !f.query('[data-project-overflow-menu]') && f.window.document.activeElement === trigger);
  }
  assert.ok(f.projectMeasurements.some(read => Object.hasOwn(read.attributes, 'projectStrip')));
  for (const project of projects) assert.ok(f.projectMeasurements.some(read => read.attributes.projectMeasure === project.id && read.width === widths[project.id]));
});

test('responsive project tabs remeasure font readiness, loadingdone and changed project names or lists without count proxies', async (t) => {
  let projects = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Gamma' }, { id: 'D', name: 'Delta' }];
  const f = await mount(t, state(), ({ action }) => action === 'list_projects' ? { result: { projects } } : null, {
    projectLayout: { available: 371, widths: { A: 83.25, B: 96.5, C: 70.25, D: 121 }, more: 72, selectedMore: 72, plus: 28 },
  });
  const count = () => f.window.document.querySelectorAll('[data-project-strip] button[data-project-id]').length;
  await f.wait(() => count() === 4);
  f.setProjectLayout({ widths: { D: 122 } }); f.resolveFonts();
  await f.wait(() => count() === 3);
  f.setProjectLayout({ widths: { C: 250 } }); f.fontsLoaded();
  await f.wait(() => count() === 2);
  projects = projects.map(project => project.id === 'B' ? { ...project, name: 'A much longer Beta project name' } : project);
  f.setProjectLayout({ widths: { B: 300 } }); await f.click('[data-command="refresh"]');
  await f.wait(() => count() === 1);
  assert.ok(f.projectMeasurements.some(read => read.attributes.projectMeasure === 'B' && read.text === projects[1].name && read.width === 300));
  projects = [...projects, { id: 'E', name: 'Epsilon' }];
  f.setProjectLayout({ widths: { B: 96.5, C: 70.25, D: 121, E: 60 } }); await f.click('[data-command="refresh"]');
  await f.wait(() => count() === 3);
  await f.click('[data-project-overflow]');
  assert.deepEqual([...f.window.document.querySelectorAll('[data-project-overflow-item]')].map(item => item.dataset.projectOverflowItem), ['D', 'E']);
  f.query('[role="menu"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await f.wait(() => !f.query('[role="menu"]'));
  projects = projects.slice(0, 3); await f.click('[data-command="refresh"]');
  await f.wait(() => count() === 3 && !f.query('[data-project-overflow]'));
});

test('project resize transfers focus between visible tabs, More and Plus without leaving hidden focus', async (t) => {
  const projects = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Gamma' }, { id: 'D', name: 'Delta' }];
  const f = await mount(t, state(), ({ action }) => action === 'list_projects' ? { result: { projects } } : null, {
    projectLayout: { available: 371, widths: { A: 83.25, B: 96.5, C: 70.25, D: 121 }, more: 72, selectedMore: 72, plus: 28 },
  });
  await f.wait(() => f.query('[data-project-tab="D"]'));
  f.query('[data-project-tab="D"]').focus();
  f.setProjectLayout({ available: 155.25 }); f.resizeProjects();
  await f.wait(() => f.window.document.activeElement === f.query('[data-project-overflow="more"]'));
  f.setProjectLayout({ available: 50 }); f.resizeProjects();
  await f.wait(() => f.window.document.activeElement === f.query('[data-project-overflow="plus"]'));
  f.setProjectLayout({ available: 371 }); f.resizeProjects();
  await f.wait(() => !f.query('[data-project-overflow]') && f.window.document.activeElement === f.query('[data-project-tab="A"]'));
  f.setProjectLayout({ available: 155.25 }); f.resizeProjects();
  await f.wait(() => f.query('[data-project-overflow="more"]'));
  await f.click('[data-project-overflow]');
  f.query('[data-project-overflow-item="D"]').focus();
  f.setProjectLayout({ available: 371 }); f.resizeProjects();
  await f.wait(() => !f.query('[data-project-overflow-menu]') && f.window.document.activeElement === f.query('[data-project-tab="D"]'));
});

test('overflow project selection keeps exact IDs, pending guards and selected identity after remount', async (t) => {
  const projects = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Gamma' }];
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const f = await mount(t, state(), async ({ action, input, setServer }) => {
    if (action === 'list_projects') return { result: { projects } };
    if (action === 'set_project') {
      entered(); await gate;
      const next = { ...state(), projectPath: `/${input.projectId}`, selectedProject: projects.find(project => project.id === input.projectId) };
      setServer(next); return { result: next };
    }
  }, { projectLayout: { available: 155.25, widths: { A: 83.25, B: 96.5, C: 70.25 }, more: 72, selectedMore: 72, plus: 28 } });
  await f.wait(() => f.query('[data-project-tab="A"]'));
  await f.click('[data-project-overflow]');
  const item = f.query('[data-project-overflow-item="C"]'); item.click(); item.click(); await started;
  await f.wait(() => f.query('[data-project-overflow]').disabled);
  assert.equal(f.query('[data-project-tab="A"]').getAttribute('aria-current'), 'page');
  assert.deepEqual(f.calls.filter(call => call.action === 'set_project').map(call => call.input), [{ projectId: 'C' }]);
  release();
  await f.wait(() => f.query('[data-project-overflow]')?.getAttribute('aria-current') === 'page');
  const trigger = f.query('[data-project-overflow]');
  assert.equal(trigger.dataset.projectTab, 'C');
  assert.match(trigger.getAttribute('aria-label'), /selected project Gamma/);
  await f.wait(() => f.window.document.activeElement === trigger);
  await f.click('[data-project-overflow]');
  const selected = f.query('[data-project-overflow-item="C"]');
  assert.equal(selected.getAttribute('aria-checked') || selected.getAttribute('aria-selected'), 'true');
  assert.deepEqual([...f.window.document.querySelectorAll('[data-project-overflow-item]')].map(project => project.textContent), ['Beta', 'Gamma']);
  assert.equal(f.query('[role="dialog"]'), null);
  f.setProjectLayout({ selectedMore: 80 }); f.resizeProjects();
  await f.wait(() => !f.query('[data-project-overflow-menu]') && !f.query('button[data-project-id]'));
  assert.equal(f.query('[data-project-overflow]').dataset.projectOverflow, 'more', 'selected More width is reserved even when fewer tabs fit');
  f.setProjectLayout({ selectedMore: 160 }); f.resizeProjects();
  await f.wait(() => f.query('[data-project-overflow="plus"]') && f.query('button[data-project-id="A"]'));
  assert.equal(f.query('[data-project-overflow]').getAttribute('aria-current'), 'page');
  assert.match(f.query('[data-project-overflow]').getAttribute('aria-label'), /selected project Gamma/);
});

test('failed hidden-project selection keeps the selected board and original overflow focus without a fallback', async (t) => {
  const projects = [{ id: 'A', name: 'Alpha' }, { id: 'B', name: 'Beta' }, { id: 'C', name: 'Gamma' }];
  const f = await mount(t, state(), ({ action }) => {
    if (action === 'list_projects') return { result: { projects } };
    if (action === 'set_project') return { error: 'Hidden project is unavailable' };
  }, { projectLayout: { available: 155.25, widths: { A: 83.25, B: 96.5, C: 70.25 }, more: 72, selectedMore: 72, plus: 28 } });
  await f.wait(() => f.query('[data-project-overflow]'));
  const trigger = f.query('[data-project-overflow]');
  await f.click('[data-project-overflow]'); await f.click('[data-project-overflow-item="C"]');
  await f.wait(() => f.window.document.body.textContent.includes('Hidden project is unavailable'));
  await f.wait(() => f.window.document.activeElement === trigger);
  assert.equal(f.query('[data-project-tab="A"]').getAttribute('aria-current'), 'page');
  assert.match(f.window.document.body.textContent, /Lane one/);
  assert.deepEqual(f.calls.filter(call => call.action === 'set_project').map(call => call.input), [{ projectId: 'C' }]);
});

test('failed project choice and failed refresh never silently select a fallback tab', async (t) => {
  let failRefresh = false;
  const f = await mount(t, state(), ({ action }) => action === 'set_project' ? { error: 'Selected project unavailable' } : action === 'refresh' && failRefresh ? { error: 'Registry store unreadable' } : null);
  await f.wait(() => f.query('[data-project-tab="B"]'));
  const clicked = f.query('[data-project-tab="B"]');
  await f.click('[data-project-tab="B"]');
  await f.wait(() => f.window.document.body.textContent.includes('Selected project unavailable'));
  assert.equal(f.query('[data-project-tab="A"]').getAttribute('aria-current'), 'page');
  await f.wait(() => f.window.document.activeElement === clicked);
  failRefresh = true; await f.click('[data-command="refresh"]');
  await f.wait(() => !f.query('[data-record]'));
  assert.ok(f.query('.clips-app-recovery .clips-board-project-tabs [data-project-tab="A"]'), 'recovery reuses the same custom project navigation');
  assert.match(f.window.document.body.textContent, /Registry store unreadable/);
  assert.equal(f.calls.filter(call => call.action === 'set_project').length, 1);
});

test('delayed first load keeps one Clips recovery heading and right-side Refresh with an accessible spinner until loaded empty or error settles', async (t) => {
  for (const outcome of ['loaded', 'empty', 'error']) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    const f = await mount(t, state(), async ({ action }) => {
      if (action === 'list_projects' && outcome === 'empty') return { result: { projects: [], currentDirectory: '/actual-current', canInitializeCurrentDirectory: false } };
      if (action === 'refresh') {
        await gate;
        if (outcome !== 'loaded') return { error: outcome === 'empty' ? 'No available registered Clips projects' : 'Registry cannot be read' };
      }
    }, { waitForReady: false, loadStyles: true });
    await f.wait(() => f.query('.clips-app-loading-state'));
    const header = f.query('.clips-app-recovery-header');
    assert.equal(header.querySelector('h1').textContent, 'Clips');
    assert.equal(f.window.document.querySelectorAll('h1').length, 1);
    const refresh = f.query('[data-command="refresh"]');
    assert.ok(header.contains(refresh));
    assert.ok(refresh.closest('.clips-app-recovery-actions'));
    assert.equal(f.window.getComputedStyle(header).justifyContent, 'space-between');
    assert.equal(f.window.getComputedStyle(refresh.closest('.clips-app-recovery-actions')).marginInlineStart, 'auto');
    assert.equal(header.querySelector('h1').compareDocumentPosition(refresh) & f.window.Node.DOCUMENT_POSITION_FOLLOWING, f.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(f.query('.clips-app-loading-state').getAttribute('role'), 'status');
    assert.equal(f.query('.clips-app-loading-state').getAttribute('aria-live'), 'polite');
    const spinner = f.query('.clips-app-loading-state svg');
    assert.ok(spinner, 'the official Spinner renders in the content area');
    assert.equal(f.window.getComputedStyle(spinner).width, '20px');
    assert.equal(f.window.getComputedStyle(spinner).height, '20px');
    const dots = f.query('.clips-app-loading-dots');
    assert.ok(dots);
    assert.equal(f.query('.clips-app-start').getAttribute('aria-busy'), 'true');
    release();
    await f.wait(() => !f.query('.clips-app-loading-state'));
    assert.equal(dots.isConnected, false, `${outcome}: animation node is removed when loading settles`);
    assert.equal(spinner.isConnected, false);
    assert.equal(f.window.document.querySelectorAll('h1').length, 1);
    if (outcome === 'loaded') {
      assert.ok(f.query('.clips-board'));
      assert.equal(f.query('.clips-app-recovery-header'), null, 'loaded Board owns its single header');
      assert.equal(f.query('.clips-board-project-heading h1').textContent, 'Clips');
    } else {
      assert.equal(f.query('.clips-app-recovery-header h1').textContent, 'Clips');
      assert.ok(f.query('.clips-app-empty-title'));
      assert.equal(f.query('.clips-app-start').getAttribute('aria-busy'), 'false');
      assert.equal(disabled(f.query('[data-command="refresh"]')), false);
      assert.match(f.window.document.body.textContent, outcome === 'empty' ? /No available Clips projects/ : /Registry cannot be read/);
    }
  }
});

test('recovery tabs match the full loaded muted strip while preserving raised selection and measured overflow', async (t) => {
  for (const colorMode of ['light', 'dark']) {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    t.after(() => release());
    const projects = [
      { id: 'A', name: 'Alpha', projectRoot: '/A' },
      { id: 'B', name: 'Beta', projectRoot: '/B' },
      { id: 'C', name: 'Gamma', projectRoot: '/C' },
    ];
    const f = await mount(t, state(), async ({ action }) => {
      if (action === 'list_projects') return { result: { projects, selectedProject: { id: 'A' }, diagnostics: [] } };
      if (action === 'refresh') await gate;
    }, {
      waitForReady: false, loadStyles: true, colorMode,
      projectLayout: { available: 155.25, widths: { A: 83.25, B: 96.5, C: 70.25 }, more: 72, selectedMore: 72, plus: 28 },
    });
    await f.wait(() => f.query('.clips-app-project-tabs [data-project-overflow]'));
    const wrapper = f.query('.clips-app-project-tabs');
    const rules = [...f.window.document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
    const recovery = rules.find(rule => rule.selectorText === '.clips-app-project-tabs').style;
    const header = rules.find(rule => rule.selectorText === '.clips-app-recovery-header').style;
    assert.equal(wrapper.parentElement, f.query('.clips-app-recovery'));
    assert.equal(f.window.getComputedStyle(wrapper).display, 'flex');
    assert.equal(recovery.getPropertyValue('background'), 'var(--bgColor-muted)');
    assert.equal(recovery.getPropertyValue('background'), header.getPropertyValue('background'));
    assert.match(recovery.getPropertyValue('padding'), /^0(?:px)? var\(--base-size-16\)$/);
    assert.equal(recovery.getPropertyValue('border-bottom'), 'var(--borderWidth-thin) solid var(--borderColor-default)');
    const checkTabs = () => {
      const selected = f.query('[data-project-tab="A"]');
      assert.equal(selected.getAttribute('aria-current'), 'page');
      const style = f.window.getComputedStyle(selected);
      const selection = rules.find(rule => rule.selectorText?.includes('aria-current') && rule.selectorText.includes('clips-board-project-tabs') && selected.matches(rule.selectorText));
      assert.equal(selection.style.getPropertyValue('background'), 'var(--bgColor-default)');
      assert.equal(style.borderBottomWidth, '0px');
      assert.equal(style.borderRadius, 'var(--borderRadius-medium) var(--borderRadius-medium) 0 0');
      assert.equal(f.query('[data-project-tab="B"]'), null);
      assert.equal(f.query('[data-project-tab="C"]'), null);
    };
    checkTabs();
    await f.click('[data-project-overflow]');
    await f.wait(() => f.query('[role="menu"]'));
    assert.deepEqual([...f.window.document.querySelectorAll('[data-project-overflow-item]')].map(node => node.dataset.projectOverflowItem), ['B', 'C']);
    f.query('[role="menu"]').dispatchEvent(new f.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await f.wait(() => !f.query('[role="menu"]'));
    release();
    await f.wait(() => f.query('.clips-board-view-bar [data-project-overflow]'));
    const loaded = rules.find(rule => rule.selectorText === '.clips-board-view-bar').style;
    for (const property of ['background', 'padding', 'border-bottom']) assert.equal(loaded.getPropertyValue(property), recovery.getPropertyValue(property), `${colorMode}: matching ${property}`);
    assert.equal(wrapper.isConnected, false);
    checkTabs();
    assert.equal(f.calls.some(call => call.action === 'set_project'), false, 'the presentation transition does not change saved selection');
  }
});

test('loading dots use emitted discrete one-two-three CSS keyframes with a stable accessible label and reduced-motion fallback', async (t) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await mount(t, state(), async ({ action }) => { if (action === 'refresh') await gate; }, { waitForReady: false, loadStyles: true });
  await f.wait(() => f.query('.clips-app-loading-dots'));
  const status = f.query('.clips-app-loading-state');
  const visual = status.querySelector('p[aria-hidden="true"]');
  assert.equal(visual.textContent, 'Loading...');
  assert.equal(f.window.getComputedStyle(visual).color, 'var(--fgColor-muted)');
  const dots = visual.querySelector('.clips-app-loading-dots');
  assert.deepEqual([...dots.children].map(node => node.textContent), ['.', '.', '.'], 'static ASCII dots animate visually without changing live-region DOM');
  const spoken = f.window.document.createTreeWalker(status, f.window.NodeFilter.SHOW_TEXT, {
    acceptNode: node => node.parentElement.closest('[aria-hidden="true"]') ? f.window.NodeFilter.FILTER_REJECT : f.window.NodeFilter.FILTER_ACCEPT,
  });
  let accessibleText = '';
  while (spoken.nextNode()) accessibleText += spoken.currentNode.textContent;
  assert.equal(accessibleText.trim(), 'Loading', 'official Spinner exposes one stable accessible label');
  const rules = [...f.window.document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
  const timelines = [2, 3].map((child, index) => {
    const name = `clips-app-loading-${index ? 'third' : 'second'}-dot`;
    const animation = rules.find(rule => rule.selectorText?.replace(/\s/g, '') === `.clips-app-loading-dots>:nth-child(${child})`);
    assert.ok(animation);
    assert.deepEqual(new Set(animation.style.getPropertyValue('animation').split(/\s+/)), new Set([name, '1.5s', 'step-end', 'infinite']));
    const keyframes = rules.find(rule => rule.name === name);
    assert.ok(keyframes);
    const frames = [...keyframes.cssRules].flatMap(rule => rule.keyText.split(',').map(key => ({
      at: key.trim() === 'to' ? 100 : key.trim() === 'from' ? 0 : parseFloat(key),
      opacity: Number(rule.style.getPropertyValue('opacity')),
    }))).sort((a, b) => a.at - b.at);
    assert.deepEqual(frames.map(frame => frame.at), [0, index ? 66.667 : 33.333, 100]);
    assert.deepEqual(frames.map(frame => frame.opacity), [0, 1, 1]);
    return percent => frames.filter(frame => frame.at <= percent % 100).at(-1).opacity;
  });
  const visibleDotsAt = percent => 1 + timelines[0](percent) + timelines[1](percent);
  assert.deepEqual([0, 20, 34, 50, 67, 99, 100, 134, 167].map(visibleDotsAt), [1, 1, 2, 2, 3, 3, 1, 2, 3]);
  const reduced = rules.find(rule => rule.conditionText?.replace(/\s/g, '') === '(prefers-reduced-motion:reduce)');
  assert.ok(reduced);
  const reducedDots = [...reduced.cssRules].find(rule => rule.selectorText?.replace(/\s/g, '') === '.clips-app-loading-state .clips-app-loading-dots>span'.replace(/\s/g, ''));
  assert.equal(reducedDots.style.getPropertyValue('animation'), 'none');
  assert.equal(reducedDots.style.getPropertyValue('opacity'), '1');
  assert.equal([...reduced.cssRules].find(rule => rule.selectorText === '.clips-app-loading-state svg').style.getPropertyValue('animation'), 'none');
  release();
  await f.wait(() => f.query('.clips-board'));
  assert.equal(status.isConnected, false, 'removing the loading subtree removes its CSS animation without timers');
  assert.equal(f.query('.clips-app-loading-dots'), null);
  assert.equal(f.query('.clips-app-loading-state'), null);
});

test('failed recovery retry shows a fresh loading spinner then settles to one loaded Board header', async (t) => {
  let retry = false, release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const f = await mount(t, state(), async ({ action }) => {
    if (action !== 'refresh') return;
    if (!retry) return { error: 'Temporary registry failure' };
    await gate;
  }, { loadStyles: true });
  assert.match(f.window.document.body.textContent, /Temporary registry failure/);
  assert.equal(f.query('.clips-app-loading-state'), null);
  assert.equal(f.query('.clips-app-recovery-header h1').textContent, 'Clips');
  retry = true;
  await f.click('[data-command="refresh"]');
  await f.wait(() => f.query('.clips-app-loading-state'));
  assert.equal(f.window.document.querySelectorAll('h1').length, 1);
  release();
  await f.wait(() => f.query('.clips-board') && !f.query('.clips-app-loading-state'));
  assert.equal(f.query('.clips-app-recovery-header'), null);
  assert.equal(f.window.document.querySelectorAll('h1').length, 1);
  assert.equal(f.query('.clips-board-project-heading h1').textContent, 'Clips');
  assert.equal(f.query('[data-project-tab="A"]').getAttribute('aria-current'), 'page');
});

test('an older recovery refresh completion cannot clear the newer request loading state', async (t) => {
  let releaseOld, releaseNew, requests = 0, oldCompleted = false;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const newGate = new Promise(resolve => { releaseNew = resolve; });
  t.after(() => { releaseOld(); releaseNew(); });
  const f = await mount(t, state(), async ({ action }) => {
    if (action !== 'refresh') return;
    if (++requests === 1) {
      await oldGate; oldCompleted = true;
      return { error: 'Older refresh failed' };
    }
    await newGate;
  }, { waitForReady: false });
  await f.wait(() => f.query('.clips-app-loading-state'));
  await f.click('[data-command="refresh"]');
  await f.wait(() => requests === 2);
  releaseOld();
  await f.wait(() => oldCompleted);
  assert.ok(f.query('.clips-app-loading-state'));
  assert.equal(f.query('.clips-app-start').getAttribute('aria-busy'), 'true');
  releaseNew();
  await f.wait(() => f.query('.clips-board') && !f.query('.clips-app-loading-state'));
  assert.equal(f.window.document.querySelectorAll('h1').length, 1);
  assert.equal(f.query('.clips-board-project-heading h1').textContent, 'Clips');
  assert.doesNotMatch(f.window.document.body.textContent, /Older refresh failed/);
});

test('no-board recovery initializes actual current directory once and selects its new tab', async (t) => {
  let initialized = false; let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  t.after(() => release());
  const next = { ...state(), projectPath: '/current', selectedProject: { id: 'C', name: 'Current' } };
  const f = await mount(t, state(), async ({ action, setServer }) => {
    if (action === 'refresh' && !initialized) return { error: 'No available registered Clips projects' };
    if (action === 'list_projects') return { result: { projects: initialized ? [{ id: 'C', name: 'Current', projectRoot: '/current' }] : [], userScope: 'local', diagnostics: [], currentDirectory: '/current', currentProjectId: initialized ? 'C' : null, canInitializeCurrentDirectory: !initialized } };
    if (action === 'initialize_current_directory') {
      entered(); await gate; initialized = true; setServer(next);
      return { result: { state: next, projectId: 'C' } };
    }
    return null;
  });
  await f.wait(() => f.query('[data-command="initialize"]'));
  const button = f.query('[data-command="initialize"]');
  assert.equal(button.dataset.variant, 'invisible');
  assert.equal(button.parentElement, f.query('[data-command="refresh"]').parentElement);
  button.click(); await started; await f.wait(() => button.disabled);
  button.click(); assert.equal(f.calls.filter(call => call.action === 'initialize_current_directory').length, 1);
  assert.deepEqual(f.calls.find(call => call.action === 'initialize_current_directory').input, {});
  release();
  await f.wait(() => f.query('[data-project-tab="C"]')?.getAttribute('aria-current') === 'page');
  assert.equal(f.query('[data-command="initialize"]'), null);
  await f.wait(() => f.window.document.activeElement === f.query('[data-project-tab="C"]'));
  assert.equal(f.calls.some(call => call.action === 'set_project'), false, 'backend initialization supplies selected canonical state');
});

test('registry help and its inline current-directory code use official small type without changing other text', async (t) => {
  const directory = '/Users/dfosco/workspace/clips-copilot';
  const f = await mount(t, state(), ({ action }) => action === 'refresh' ? { error: 'Choose a project' } : action === 'list_projects' ? { result: { projects: [], currentDirectory: directory } } : null, { loadStyles: true });
  const help = f.query('.clips-app-empty > .clips-app-muted');
  assert.equal(help.textContent, `Boards come from your local Clips project registry.Current session directory: ${directory}`);
  assert.equal(help.querySelectorAll('br').length, 1);
  const code = help.querySelector('code');
  assert.equal(code.textContent, directory);
  assert.equal(f.window.getComputedStyle(help).fontSize, 'var(--text-body-size-small)');
  assert.equal(f.window.getComputedStyle(code).fontSize, f.window.getComputedStyle(help).fontSize);
  assert.equal(f.window.getComputedStyle(help).color.toLowerCase(), 'var(--fgcolor-muted)');
  assert.equal(f.window.getComputedStyle(help.parentElement).textAlign, 'center');
  const css = await readFile(new URL('./dist/style.css', import.meta.url), 'utf8');
  assert.match(css, /--text-body-size-small:var\(--base-text-size-xs\)/);
  assert.match(css, /--base-text-size-xs:0?\.75rem/);
  assert.match(css, /\.clips-app-muted\{[^}]*font-size:var\(--text-body-size-medium\)/, 'other muted surfaces retain medium type');
  assert.equal(f.query('.clips-app-empty-title').textContent, 'No available Clips projects');
});

test('init eligibility comes from actual directory even with another tab selected and errors remain visible', async (t) => {
  const f = await mount(t, state(), ({ action }) => action === 'list_projects' ? { result: { projects: [{ id: 'A', name: 'Alpha', projectRoot: '/A' }], currentDirectory: '/actual-current', currentProjectId: null, canInitializeCurrentDirectory: true, userScope: 'local', diagnostics: [] } } : action === 'initialize_current_directory' ? { error: 'Current repository is not writable' } : null);
  await f.wait(() => f.query('[data-command="initialize"]'));
  await f.click('[data-command="initialize"]');
  await f.wait(() => f.window.document.body.textContent.includes('Current repository is not writable'));
  assert.equal(f.getServer().projectPath, '/A');
  assert.deepEqual(f.calls.find(call => call.action === 'initialize_current_directory').input, {});
  await f.wait(() => !f.query('[data-command="initialize"]').disabled);
});
