import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createCanvasService } from './service.mjs';

function fixture() {
  const calls = [];
  const sessions = [];
  const board = {
    lanes: [{ ref: '#l001', lane_id: 'l001', title: 'Lane', status: 'in_progress', description: 'Lane context', labels: [], manager_claim: { revision: 0, owners: [] }, goal_refs: ['#g001'] }],
    goals: [{ ref: '#g001', goal_id: 'g001', lane_id: 'l001', title: 'Goal', status: 'open', description: 'Goal context', labels: [], blocked_by: [], tasks: [
      { ref: '#g001#t01', goal_id: 'g001', goal_ref: '#g001', goal_title: 'Goal', task_id: 't01', title: 'Task', status: 'open', description: 'Task context', labels: [] },
    ] }],
    labels: [{ id: 'urgent', name: 'Urgent', color: '#ff0000' }],
    warnings: [],
  };
  const runtime = {
    async hostCapabilities() { return { appSessionVisibilityVerified: true, canSendToCurrentSession: true, hostIdConfigured: true }; },
    async listBoard(projectPath) { calls.push(['listBoard', projectPath]); return board; },
    async viewRecord(ref, projectPath) { calls.push(['viewRecord', ref, projectPath]); return { ref, title: 'Full record' }; },
    async recordCommand(args, projectPath) { calls.push(['recordCommand', args, projectPath]); return { ok: true }; },
    async listSessions(projectPath) { calls.push(['listSessions', projectPath]); return { sessions }; },
    async launchRecord(input) {
      calls.push(['launchRecord', input]);
      const session = { id: `session-${sessions.length + 1}`, sessionId: `session-${sessions.length + 1}`, recordRef: input.ref, status: 'unknown', appVisible: 'unverified', navigationUrl: `ghapp://sessions/session-${sessions.length + 1}` };
      sessions.push(session);
      return session;
    },
    async steerSession(id, prompt) { calls.push(['steerSession', id, prompt]); },
    appSessionUrl(id) { return `ghapp://sessions/${id}`; },
  };
  return { calls, sessions, board, runtime };
}

test('canvas focus persists per open instance and Tasks are exposed only for a focused Goal', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-focus-'));
  const f = fixture();
  let service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'instance-one', sessionId: 'host-a', session: { workingDirectory: '/repo' } });
  await service.open({ instanceId: 'instance-two', sessionId: 'host-b', session: { workingDirectory: '/repo' } });
  await service.dispatch('instance-one', 'focus', { ref: '#g001' });
  await service.dispatch('instance-two', 'focus', { ref: '#l001' });
  const one = await service.state('instance-one');
  const two = await service.state('instance-two');
  assert.equal(one.focus, '#g001');
  assert.equal(one.outline.tasksExpanded, true);
  assert.equal(one.outline.tasks[0].ref, '#g001#t01');
  assert.equal(two.focus, '#l001');
  assert.equal(two.outline.tasksExpanded, false);

  await service.shutdown();
  service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); });
  await service.open({ instanceId: 'instance-one', sessionId: 'host-a', session: { workingDirectory: '/repo' } });
  assert.equal((await service.state('instance-one')).focus, '#g001');
});

test('human and agent actions share canonical record operations and reject unsafe inputs', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-actions-'));
  const f = fixture();
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'actions', sessionId: 'host', session: { workingDirectory: '/repo' } });
  await service.dispatch('actions', 'set_status', { ref: '#g001#t01', status: 'in_progress' });
  await service.action({ instanceId: 'actions', actionName: 'add_label', input: { ref: '#g001', labelId: 'urgent' } });
  const create = await service.dispatch('actions', 'create_task', { goal_ref: '#g001', title: 'New Task', description: 'Details', acceptance_criteria: ['The action is observable.'] });
  assert.ok(create.state);
  assert.deepEqual(f.calls.find((call) => call[0] === 'recordCommand' && call[1][0] === 'task')[1].slice(0, 4), ['task', 'status', '#g001#t01', 'in_progress']);
  assert.deepEqual(f.calls.find((call) => call[0] === 'recordCommand' && call[1][0] === 'label')[1], ['label', 'add', '#g001', 'urgent']);
  const taskCreate = f.calls.find((call) => call[0] === 'recordCommand' && call[1][0] === 'task' && call[1][1] === 'create')[1];
  assert.equal(taskCreate[2], '#g001');
  assert.deepEqual(JSON.parse(taskCreate[3]).acceptance_criteria, ['The action is observable.']);
  await assert.rejects(service.dispatch('actions', 'create_task', { goal_ref: '#g001', title: 'Weak Task' }), /needs 1–12 observable acceptance criteria/);
  await assert.rejects(service.dispatch('actions', 'set_status', { ref: '#g001', status: 'force' }), /Unsupported Clips status/);
  await assert.rejects(service.dispatch('actions', 'set_status', { ref: '#l001', status: 'closed' }), /Unsupported Lane status/);
  await assert.rejects(service.dispatch('actions', 'run_shell', { command: 'echo nope' }), /Unsupported canvas action/);
  await assert.rejects(service.action({ instanceId: 'other', actionName: 'refresh' }), /Open Clips Work/);
});

test('launches bind only the actual returned session ID and refuses to replace an owned Lane', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-launch-'));
  const f = fixture();
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'launch', sessionId: 'host', session: { workingDirectory: '/repo' } });
  const result = await service.dispatch('launch', 'launch', { ref: '#g001' });
  assert.equal(result.session.id, 'session-1');
  assert.deepEqual((await service.state('launch')).relatedSessions.map((session) => session.id), ['session-1']);
  assert.equal(f.calls.find((call) => call[0] === 'launchRecord')[1].model, undefined, 'host model choice is not replaced');
  f.board.lanes[0].manager_claim.owners = [{ runtime: 'copilot-sdk', session_id: 'manager-existing', host: 'host-x' }];
  await assert.rejects(service.dispatch('launch', 'launch', { ref: '#l001' }), /already has a claimed manager/);
  assert.equal(f.calls.filter((call) => call[0] === 'launchRecord').length, 1);
});

test('missing host working directory requires explicit absolute project selection', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-project-'));
  const f = fixture();
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'no-cwd', sessionId: 'host', session: {} });
  await assert.rejects(service.state('no-cwd'), /did not provide a working directory/);
  await assert.rejects(service.dispatch('no-cwd', 'set_project', { projectPath: 'relative/path' }), /absolute local repository path/);
  const selected = await service.dispatch('no-cwd', 'set_project', { projectPath: '/explicit/project' });
  assert.equal(selected.projectPath, '/explicit/project');
});

test('unverified Copilot App capability and unreadable Lane ownership fail closed', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-capability-'));
  const f = fixture();
  f.runtime.hostCapabilities = async () => ({ appSessionVisibilityVerified: false, hostIdConfigured: false });
  f.sessions.push({ id: 'session-1', sessionId: 'session-1', appVisible: 'unverified', navigationUrl: 'ghapp://sessions/session-1' });
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'unverified', sessionId: 'host', session: { workingDirectory: '/repo' } });
  assert.equal((await service.state('unverified')).hostCapabilities.appSessionVisibilityVerified, false);
  await assert.rejects(service.dispatch('unverified', 'launch', { ref: '#g001' }), /requires a joined current session/);
  assert.deepEqual(await service.dispatch('unverified', 'open_session', { sessionId: 'session-1' }), {
    sessionId: 'session-1', url: 'ghapp://sessions/session-1', appVisibility: 'unverified',
  });
  await assert.rejects(service.dispatch('unverified', 'steer', { sessionId: 'session-1', prompt: 'Continue' }), /not joined here/);
  assert.equal(f.calls.some((call) => call[0] === 'launchRecord'), false);

  f.runtime.hostCapabilities = async () => ({ appSessionVisibilityVerified: true, canSendToCurrentSession: true, hostIdConfigured: true });
  f.board.lanes[0].manager_claim = null;
  f.board.lanes[0].manager_claim_error = 'corrupt claim';
  await assert.rejects(service.dispatch('unverified', 'launch', { ref: '#l001' }), /Ownership for Lane.*unavailable/);
  assert.equal(f.calls.some((call) => call[0] === 'launchRecord'), false);
});

test('local canvas bridge requires its per-process token and binds routes to opened instances', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-http-'));
  const f = fixture();
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  const opened = await service.open({ instanceId: 'web-instance', sessionId: 'host', session: { workingDirectory: '/repo' } });
  const canvasUrl = new URL(opened.url);
  const token = canvasUrl.searchParams.get('token');
  const index = await fetch(opened.url);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /app.js\?instanceId=web-instance&amp;token=/);
  const bad = await fetch(`${canvasUrl.origin}/api/web-instance?token=wrong`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'refresh' }) });
  assert.equal(bad.status, 403);
  const good = await fetch(`${canvasUrl.origin}/api/web-instance?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'focus', input: { ref: '#g001' } }) });
  assert.equal(good.status, 200);
  assert.equal((await good.json()).result.focus, '#g001');
  await service.open({ instanceId: 'other-instance', sessionId: 'other-host', session: { workingDirectory: '/repo' } });
  const crossInstance = await fetch(`${canvasUrl.origin}/api/other-instance?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'focus', input: { ref: '#l001' } }) });
  assert.equal(crossInstance.status, 403, 'one open canvas token cannot mutate another canvas instance');
});

test('same panel IDs in different sessions and projects retain independent focus and project choice', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-panel-scope-'));
  const f = fixture();
  const services = [];
  const make = () => { const service = createCanvasService({ runtime: f.runtime, dataDir }); services.push(service); return service; };
  t.after(async () => { await Promise.all(services.map(service => service.shutdown())); await rm(dataDir, { recursive: true, force: true }); });
  const a = make();
  const ctx = { instanceId: 'same', sessionId: 'session-a', input: { projectPath: '/initial' }, session: { workingDirectory: '/host-cwd' } };
  const first = await a.open(ctx);
  await a.dispatch('same', 'focus', { ref: '#g001' });
  assert.equal((await a.open(ctx)).url, first.url, 'reopening preserves the live token');
  await a.dispatch('same', 'set_project', { projectPath: '/chosen' });
  assert.equal((await a.state('same')).focus, null, 'focus does not cross projects');
  await a.dispatch('same', 'focus', { ref: '#l001' });
  const b = make();
  await b.open({ ...ctx, sessionId: 'session-b' });
  assert.equal((await b.state('same')).focus, null);
  assert.equal((await b.state('same')).projectPath, '/initial');
  await a.shutdown();
  const reopened = make();
  await reopened.open(ctx);
  assert.equal((await reopened.state('same')).projectPath, '/chosen');
  assert.equal((await reopened.state('same')).focus, '#l001');
  await reopened.dispatch('same', 'set_project', { projectPath: '/initial' });
  assert.equal((await reopened.state('same')).focus, '#g001');
});

test('canonical board survives a session catalog outage with an explicit warning', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-catalog-outage-'));
  const f = fixture();
  f.runtime.listSessions = async () => { throw new Error('catalog unavailable'); };
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'panel', sessionId: 'host', input: { projectPath: '/repo' } });
  const state = await service.state('panel');
  assert.equal(state.goals[0].ref, '#g001');
  assert.match(state.warnings[0], /catalog unavailable/);
});

test('namespaced status and Task creation preserve the exact selected canonical ref', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-namespaced-actions-'));
  const f = fixture();
  f.board.goals[0].ref = '#alice#g001';
  f.board.goals[0].tasks[0].ref = '#alice#g001#t01';
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'panel', sessionId: 'host', input: { projectPath: '/repo' } });
  await service.dispatch('panel', 'set_status', { ref: '#alice#g001', status: 'in_progress' });
  await service.dispatch('panel', 'set_status', { ref: '#alice#g001#t01', status: 'in_progress' });
  await service.dispatch('panel', 'create_task', { goal_ref: '#alice#g001', title: 'Task', acceptance_criteria: ['Observable.'] });
  const commands = f.calls.filter(([kind]) => kind === 'recordCommand').map(([, args]) => args);
  assert.deepEqual(commands[0], ['goal', 'status', '#alice#g001', 'in_progress']);
  assert.deepEqual(commands[1], ['task', 'status', '#alice#g001#t01', 'in_progress']);
  assert.equal(commands[2][2], '#alice#g001');
});

test('authenticated layout module loads through the real asset route and Back persists explicit null focus', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-layout-assets-'));
  const f = fixture();
  let service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  const ctx = { instanceId: 'layout', sessionId: 'host', input: { projectPath: '/repo' } };
  const opened = new URL((await service.open(ctx)).url);
  const html = await (await fetch(opened)).text();
  assert.match(html, /id="board-view"/);
  assert.doesNotMatch(html, /class="sidebar"/);
  const app = new URL('/canvas/app.js', opened); app.search = opened.search;
  const source = await (await fetch(app)).text();
  assert.match(source, /board-view\.mjs\?\$\{params\}/);
  const module = new URL('/canvas/board-view.mjs', opened); module.search = opened.search;
  const response = await fetch(module); assert.equal(response.status, 200);
  assert.match(await response.text(), /export function createBoardView/);
  module.search = ''; assert.equal((await fetch(module)).status, 403);
  await service.dispatch('layout', 'focus', { ref: '#l001' });
  const back = await service.dispatch('layout', 'clear_focus'); assert.equal(back.state.focus, null);
  assert.equal((await service.state('layout')).outline, null);
  await service.shutdown(); service = createCanvasService({ runtime: f.runtime, dataDir });
  await service.open(ctx);
  assert.equal((await service.state('layout')).focus, null);
});

test('alternate provider fallback never promotes joined steerability into App visibility proof', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-capability-fallback-'));
  const f = fixture(); delete f.runtime.hostCapabilities;
  f.sessions.push({ id: 'joined', steerable: true, joined: true, appVisible: 'unverified' });
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'fallback', sessionId: 'host', input: { projectPath: '/repo' } });
  assert.equal((await service.state('fallback')).hostCapabilities.appSessionVisibilityVerified, false);
});

test('project-context guard rejects stale actions and in-flight mutation keeps its original project', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-project-action-race-'));
  const f = fixture();
  let releaseBoard; let boardEntered;
  const entered = new Promise((resolve) => { boardEntered = resolve; });
  const gate = new Promise((resolve) => { releaseBoard = resolve; });
  const originalList = f.runtime.listBoard;
  let pause = true;
  f.runtime.listBoard = async (project) => {
    if (pause && project === '/A') { pause = false; boardEntered(); await gate; }
    return originalList(project);
  };
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'race', sessionId: 'host', input: { projectPath: '/A' } });
  const pending = service.dispatch('race', 'set_status', { ref: '#g001', status: 'in_progress', expectedProjectPath: '/A' });
  await entered;
  await service.dispatch('race', 'set_project', { projectPath: '/B' });
  releaseBoard(); await pending;
  assert.equal(f.calls.find(([kind]) => kind === 'recordCommand')[2], '/A');
  await assert.rejects(service.dispatch('race', 'set_status', { ref: '#g001', status: 'closed', expectedProjectPath: '/A' }), /selected project changed/);
  assert.equal(f.calls.filter(([kind]) => kind === 'recordCommand').length, 1);
});
