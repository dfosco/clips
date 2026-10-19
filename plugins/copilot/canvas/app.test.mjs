import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let i = 0; i < 8; i++) await tick(); }

test('actual app wires Lane columns, menus, canonical close/create, and Back against stale refresh', async (t) => {
  const html = await fs.readFile(new URL('./index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1/canvas/index.html?instanceId=panel&token=fixture', pretendToBeVisual: true });
  const globals = Object.fromEntries(['window', 'document', 'location', 'fetch', 'setTimeout', 'clearTimeout'].map((key) => [key, globalThis[key]]));
  let interval;
  dom.window.setInterval = (callback) => { interval = callback; return 1; };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  let state = {
    projectPath: '/repo', focus: null,
    lanes: [{ ref: '#l001', lane_id: 'l001', title: 'Lane', status: 'open', goal_refs: ['#alice#g001'], manager_claim: { owners: [] } }, { ref: '#l002', lane_id: 'l002', title: 'Closed Lane', status: 'closed', goal_refs: [] }],
    goals: [{ ref: '#alice#g001', goal_id: 'g001', title: 'Goal', status: 'open', tasks: [{ ref: '#alice#g001#t01', title: 'Task', status: 'open' }] }],
    projectSessions: [], labels: [], warnings: [], hostCapabilities: { canSendToCurrentSession: true, currentSessionId: 'host', hostIdConfigured: false },
  };
  const calls = [];
  let blockRefresh = false;
  let releaseRefresh;
  const fetchMock = async (_url, options) => {
    const request = JSON.parse(options.body); calls.push(request);
    let result;
    if (request.action === 'context') result = { projectPath: '/repo' };
    else if (request.action === 'refresh') {
      result = structuredClone(state);
      if (blockRefresh) { blockRefresh = false; await new Promise((resolve) => { releaseRefresh = resolve; }); }
    } else {
      if (request.action === 'focus') state.focus = request.input.ref;
      if (request.action === 'clear_focus') state.focus = null;
      if (request.action === 'set_status') { const target = [...state.goals, ...state.goals.flatMap((g) => g.tasks)].find((r) => r.ref === request.input.ref); target.status = request.input.status; }
      if (request.action === 'set_project') state.projectPath = request.input.projectPath;
      result = { state: structuredClone(state) };
    }
    return { ok: true, json: async () => ({ result }) };
  };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, location: dom.window.location, fetch: fetchMock, setTimeout: () => 1, clearTimeout: () => {} });
  t.after(() => { Object.assign(globalThis, globals); dom.window.close(); });
  const source = (await fs.readFile(new URL('./app.js', import.meta.url), 'utf8')).replace('import(`/canvas/board-view.mjs?${params}`)', `import(${JSON.stringify(new URL('./board-view.mjs', import.meta.url).href)})`);
  // Only module transport is replaced for Node; the real HTTP auth route is covered separately.
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const doc = dom.window.document;
  const click = (selector) => { const node = doc.querySelector(selector); assert.ok(node, selector); node.click(); };
  assert.ok(doc.querySelector('.lane-columns'));
  click('[data-lane="#l001"]'); await settle(); assert.ok(doc.querySelector('.goal-columns'));
  blockRefresh = true; interval(); await settle(); assert.ok(releaseRefresh);
  click('[data-back]'); await settle(); assert.ok(doc.querySelector('.lane-columns'));
  releaseRefresh(); await settle(); assert.ok(doc.querySelector('.lane-columns'), 'old focused response cannot undo Back');
  click('[data-filter="all"]'); click('[data-menu="#l002"]');
  assert.equal(doc.querySelector('#menu-status').value, 'closed');
  assert.equal(doc.querySelector('#menu-status option[value="closed"]').disabled, true);
  doc.querySelector('#record-menu-dialog').close();
  click('[data-menu="#alice#g001"]'); click('#menu-new-task');
  assert.equal(doc.querySelector('#parent-goal').value, '#alice#g001');
  doc.querySelector('#create-title-input').value = 'New Task'; doc.querySelector('#create-acceptance').value = 'Observable result.';
  doc.querySelector('#create-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await settle();
  assert.equal(calls.find((c) => c.action === 'create_task').input.goal_ref, '#alice#g001');
  click('[data-expand="#alice#g001"]');
  click('[data-menu="#alice#g001#t01"]');
  assert.ok(doc.querySelector('#menu-status option[value="closed"]'));
  doc.querySelector('#menu-status').value = 'closed'; click('#menu-status-save'); await settle();
  assert.deepEqual(calls.find((c) => c.action === 'set_status').input, { ref: '#alice#g001#t01', status: 'closed', expectedProjectPath: '/repo' });
  click('[data-menu="#alice#g001"]'); click('#menu-close-goal');
  assert.equal(doc.querySelector('#close-dialog').open, true);
  click('#close-confirm'); await settle();
  assert.deepEqual(calls.filter((c) => c.action === 'set_status').at(-1).input, { ref: '#alice#g001', status: 'closed', expectedProjectPath: '/repo' });
  assert.equal(doc.querySelector('#close-dialog').open, false);
  assert.equal(doc.querySelector('.sidebar'), null);
  // Project selection shares the same invalidation/serialization as Back.
  blockRefresh = true; interval(); await settle();
  click('[data-command="project"]');
  doc.querySelector('#project-path-input').value = '/other';
  doc.querySelector('#project-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  assert.match(doc.querySelector('.project-tab').textContent, /other/);
  releaseRefresh(); await settle();
  assert.match(doc.querySelector('.project-tab').textContent, /other/, 'old project refresh cannot overwrite selection');
});
