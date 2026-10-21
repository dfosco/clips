import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, realpath, rm, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createCanvasService as realCreateCanvasService } from './service.mjs';
import { CANVAS_BRIDGE_VERSION } from '../src/canvas-build.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverClipsProjects, resolveClipsProject } from '../src/project-discovery.js';
import { readCurrentBoard } from '../../../src/commands/board.js';
const fixtureProjects = ['/repo','/initial','/chosen','/explicit/project','/A','/B'].map((root) => ({ id: `project:${root}`, name: root, projectRoot: root, storeRoot: `${root}/.clips`, username: null }));
const fixtureDiscovery = { async discoverClipsProjects() { return { projects: fixtureProjects, userScope: 'user-one', diagnostics: [] }; }, async resolveClipsProject(id) { const project = fixtureProjects.find((p) => p.id === id); if (!project) throw new Error('Unknown project'); return project; } };
const createCanvasService = (options) => realCreateCanvasService({ projectDiscovery: fixtureDiscovery, ...options });

function fixture() {
  const calls = [];
  const sessions = [];
  const board = {
    generated_at: '2026-10-20T12:00:00.000Z',
    collaboration: { enabled: false, state: 'disabled', scope: 'project', automatic_mutation_sync: false, control: { command: 'untrusted descriptor' } },
    lanes: [{ ref: '#l001', lane_id: 'l001', title: 'Lane', status: 'in_progress', description: 'Lane context', labels: [], attachments: [{ id: 'att-123e4567-e89b-12d3-a456-426614174000', type: 'markdown', title: 'Lane notes', status: 'available' }], manager_claim: { revision: 0, owners: [] }, goal_refs: ['#g001'] }],
    goals: [{ ref: '#g001', goal_id: 'g001', lane_id: 'l001', title: 'Goal', status: 'open', description: 'Goal context', labels: [], blocked_by: [], attachments: [{ id: 'att-url', type: 'url', title: 'Design', url: 'https://example.com' }], tasks: [
      { ref: '#g001#t01', goal_id: 'g001', goal_ref: '#g001', goal_title: 'Goal', task_id: 't01', title: 'Task', status: 'open', description: 'Task context', labels: [], attachments: [{ id: 'att-123e4567-e89b-12d3-a456-426614174001', type: 'markdown', title: 'Task notes', status: 'missing' }] },
    ] }],
    labels: [{ id: 'urgent', name: 'Urgent', color: '#ff0000' }],
    warnings: [],
  };
  const runtime = {
    async hostCapabilities() { return { appSessionVisibilityVerified: true, canSendToCurrentSession: true, hostIdConfigured: true }; },
    async listBoard(projectPath) { calls.push(['listBoard', projectPath]); return board; },
    async viewRecord(ref, projectPath) { calls.push(['viewRecord', ref, projectPath]); return { ref, title: 'Full record' }; },
    async recordCommand(args, projectPath) { calls.push(['recordCommand', args, projectPath]); return { ok: true }; },
    async readAttachment(ref, attachmentId, projectPath) {
      calls.push(['readAttachment', ref, attachmentId, projectPath]);
      return { id: attachmentId, type: 'markdown', title: 'Live notes', status: 'available', content: '# Current content', content_semantics: 'current_file' };
    },
    async setCollaboration(enabled, projectPath) {
      calls.push(['setCollaboration', enabled, projectPath]);
      board.collaboration.enabled = enabled;
      board.collaboration.state = enabled ? 'enabled' : 'disabled';
      board.collaboration.automatic_mutation_sync = enabled;
      return 'updated locally';
    },
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

test('provider diagnostics report exact loaded renderer identity and sampled source freshness', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-diagnostics-'));
  const f = fixture(); f.runtime.diagnostics = async () => ({ source: 'fixture' });
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'diagnostics', sessionId: 'host', session: { workingDirectory: '/repo' } });
  const diagnostics = await service.dispatch('diagnostics', 'diagnostics');
  assert.equal(diagnostics.uiBuild.bridgeVersion, CANVAS_BRIDGE_VERSION);
  assert.match(diagnostics.uiBuild.manifestSha256, /^[a-f0-9]{64}$/);
  assert.match(diagnostics.uiAssets['app.js'], /^[a-f0-9]{64}$/);
  assert.equal(diagnostics.uiSourceStatus.observedAt, 'provider-load');
  assert.equal(typeof diagnostics.uiSourceStatus.matchesBuild, 'boolean');
  assert.deepEqual((await service.state('diagnostics')).uiAssets, diagnostics.uiAssets);
});

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
  await assert.rejects(service.dispatch('actions', 'set_status', { ref: '#g001', status: 'force' }), /Unsupported Lanes status/);
  await assert.rejects(service.dispatch('actions', 'set_status', { ref: '#l001', status: 'closed' }), /Unsupported Lane status/);
  await assert.rejects(service.dispatch('actions', 'run_shell', { command: 'echo nope' }), /Unsupported canvas action/);
  await assert.rejects(service.action({ instanceId: 'other', actionName: 'refresh' }), /Open Lanes in this canvas instance first/);
});

test('live attachment reads are record-scoped and collaboration toggles only local configuration', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-attachments-'));
  const f = fixture();
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'references', sessionId: 'host', session: { workingDirectory: '/repo' } });
  await service.dispatch('references', 'focus', { ref: '#g001' });

  const read = await service.dispatch('references', 'read_attachment', {
    ref: '#g001#t01', attachmentId: 'att-123e4567-e89b-12d3-a456-426614174001',
  });
  assert.deepEqual(read, {
    id: 'att-123e4567-e89b-12d3-a456-426614174001',
    type: 'markdown', title: 'Live notes', status: 'available',
    content: '# Current content', content_semantics: 'current_file',
  });
  assert.deepEqual(f.calls.find((call) => call[0] === 'readAttachment').slice(1), [
    '#g001#t01', 'att-123e4567-e89b-12d3-a456-426614174001', '/repo',
  ]);
  await assert.rejects(service.dispatch('references', 'read_attachment', {
    ref: '#g001#t01', attachmentId: 'att-123e4567-e89b-12d3-a456-426614174001', path: '/etc/passwd',
  }), /only the exact record reference and attachment ID/);
  await assert.rejects(service.dispatch('references', 'read_attachment', {
    ref: '#g001#t01', attachmentId: 'att-not-associated',
  }), /not associated/);

  const updated = await service.dispatch('references', 'set_collaboration', { enabled: true });
  assert.equal(updated.state.projectPath, '/repo');
  assert.equal(updated.state.focus, '#g001');
  assert.equal(updated.state.collaboration.enabled, true);
  assert.deepEqual(f.calls.find((call) => call[0] === 'setCollaboration').slice(1), [true, '/repo']);
  assert.equal(f.calls.some((call) => call[0] === 'recordCommand' && call[1][0] === 'sync'), false);
  await assert.rejects(service.dispatch('references', 'set_collaboration', { enabled: true, command: 'sync' }), /only an enabled boolean/);

  f.board.collaboration = { enabled: null, state: 'invalid', error: 'Malformed project config' };
  await assert.rejects(service.dispatch('references', 'set_collaboration', { enabled: false }), /Malformed project config/);
  assert.equal(f.calls.filter((call) => call[0] === 'setCollaboration').length, 1);
});

test('collaboration revalidates the selected project before runtime access', async (t) => {
  for (const invalidation of ['registry', 'user scope']) {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), `clips-canvas-collaboration-${invalidation.replace(' ', '-')}-`));
    const f = fixture();
    let projects = [...fixtureProjects];
    let userScope = 'user-one';
    const projectDiscovery = {
      ...fixtureDiscovery,
      async discoverClipsProjects() { return { projects, userScope, diagnostics: [] }; },
    };
    const service = createCanvasService({ runtime: f.runtime, dataDir, projectDiscovery });
    t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
    await service.open({ instanceId: `collaboration-${invalidation}`, sessionId: 'host', session: { workingDirectory: '/repo' } });
    if (invalidation === 'registry') projects = projects.filter((project) => project.projectRoot !== '/repo');
    else userScope = 'user-two';

    const callsBefore = f.calls.length;
    await assert.rejects(
      service.dispatch(`collaboration-${invalidation}`, 'set_collaboration', { enabled: true }),
      invalidation === 'registry' ? /no longer available/ : /user scope changed/,
    );
    assert.deepEqual(f.calls.slice(callsBefore), [], 'a stale project cannot trigger runtime reads or config writes');
  }
});

test('sends associate the actual session without using or replacing Lane ownership', async (t) => {
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
  await service.dispatch('launch', 'launch', { ref: '#l001' });
  assert.deepEqual(f.board.lanes[0].manager_claim.owners, [{ runtime: 'copilot-sdk', session_id: 'manager-existing', host: 'host-x' }]);
  assert.equal(f.calls.filter((call) => call[0] === 'launchRecord').length, 2);
});

test('concurrent record sends preserve every advisory association', async (t) => {
  const f = fixture();
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-associations-'));
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'concurrent', sessionId: 'current', session: { workingDirectory: '/repo' } });
  await Promise.all([
    service.dispatch('concurrent', 'launch', { ref: '#l001' }),
    service.dispatch('concurrent', 'launch', { ref: '#g001' }),
  ]);
  const state = await service.dispatch('concurrent', 'refresh');
  assert.deepEqual(Object.keys(state.workBindings).sort(), ['#g001', '#l001']);
});

test('focused Lane state includes claim-only provenance and earlier saved associations without fabricating navigation', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-claim-projection-'));
  const f = fixture();
  f.board.lanes[0].manager_claim.owners = [
    { runtime: 'copilot-sdk', session_id: 'manager' },
    { runtime: 'copilot-sdk', session_id: 'missing' },
  ];
  f.sessions.push({ id: 'manager', summary: 'Security migration plans', status: 'unknown' });
  const originalClaim = structuredClone(f.board.lanes[0].manager_claim);
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'claims', sessionId: 'host', input: { projectPath: '/repo' } });
  await service.dispatch('claims', 'launch', { ref: '#l001' });
  f.sessions.find((session) => session.id === 'session-2').recordRef = '#g001';
  const state = await service.state('claims');
  assert.deepEqual(state.relatedSessions.map((session) => session.id), ['session-2', 'manager']);
  assert.deepEqual(state.sessionAssociations.map(({ sessionId, sources }) => ({ sessionId, sources })), [
    { sessionId: 'session-2', sources: ['saved_binding'] },
    { sessionId: 'manager', sources: ['manager_claim'] },
    { sessionId: 'missing', sources: ['manager_claim'] },
  ]);
  assert.equal(state.sessionAssociations[2].session, null);
  assert.deepEqual(f.board.lanes[0].manager_claim, originalClaim);
  assert.equal((await service.dispatch('claims', 'open_session', { sessionId: 'manager', expectedProjectPath: '/repo' })).sessionId, 'manager');
  await assert.rejects(service.dispatch('claims', 'open_session', { sessionId: 'missing' }), /not in the current project session list/);
  await assert.rejects(service.dispatch('claims', 'open_session', { sessionId: 'manager', expectedProjectPath: '/other' }), /selected project changed/);
});

test('missing host directory defaults to first available only before explicit project choice', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-canvas-project-'));
  const f = fixture();
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'no-cwd', sessionId: 'host', session: {} });
  assert.equal((await service.state('no-cwd')).projectPath, '/repo');
  assert.equal((await service.dispatch('no-cwd', 'context')).selectionSource, 'first_available');
  await assert.rejects(service.dispatch('no-cwd', 'set_project', { projectPath: 'relative/path' }), /exact discovered Lanes project ID/);
  const selected = await service.dispatch('no-cwd', 'set_project', { projectId: 'project:/explicit/project' });
  assert.equal(selected.projectPath, '/explicit/project');
});

test('current registered project wins initial defaults and unavailable explicit selection never falls back', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-current-project-'));
  const f = fixture();
  let projects = [...fixtureProjects];
  const projectDiscovery = { ...fixtureDiscovery, async discoverClipsProjects() { return { projects, userScope: 'user-one', diagnostics: [] }; } };
  let service = createCanvasService({ runtime: f.runtime, dataDir, projectDiscovery });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  const ctx = { instanceId: 'defaults', sessionId: 'host', session: { workingDirectory: '/B' } };
  await service.open(ctx);
  assert.equal((await service.state('defaults')).projectPath, '/B');
  await service.dispatch('defaults', 'set_project', { projectId: 'project:/A' });
  await service.shutdown();
  service = createCanvasService({ runtime: f.runtime, dataDir, projectDiscovery });
  await service.open(ctx);
  assert.equal((await service.state('defaults')).projectPath, '/A');
  projects = projects.filter(p => p.projectRoot !== '/A');
  await assert.rejects(service.state('defaults'), /no longer available/);
  await service.shutdown();
  service = createCanvasService({ runtime: f.runtime, dataDir, projectDiscovery });
  await service.open(ctx);
  const context = await service.dispatch('defaults', 'context');
  assert.equal(context.selectionSource, 'saved'); assert.equal(context.projectPath, null);
  assert.match(context.selectionError, /no longer available/);
});

test('unavailable session directory metadata disables init without becoming a project-open gate', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-directory-metadata-'));
  const f = fixture();
  f.runtime.currentSession = async () => { throw new Error('metadata unavailable'); };
  const service = createCanvasService({ runtime: f.runtime, dataDir });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'metadata', sessionId: 'host', input: { projectPath: '/repo' } });
  const state = await service.state('metadata');
  assert.equal(state.projectPath, '/repo'); assert.equal(state.canInitializeCurrentDirectory, false);
  assert.ok(state.diagnostics.some(diagnostic => diagnostic.code === 'current_directory_unavailable' && diagnostic.message.includes('metadata unavailable')));
});

test('minimal initialization targets only actual session directory without a board and refreshes selection', async (t) => {
  const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), 'clips-current-init-')));
  execFileSync('git', ['init', '--quiet', dir]);
  const f = fixture(); let projects = []; let calls = 0; let release; let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const current = { id: 'project:current', name: 'Current', projectRoot: dir, storeRoot: path.join(dir, '.clips') };
  const projectDiscovery = {
    async discoverClipsProjects() { return { projects, userScope: 'local', diagnostics: [] }; },
    async resolveClipsProject(id) { const project = projects.find(p => p.id === id); if (!project) throw new Error('Unavailable'); return project; },
  };
  f.runtime.initializeProject = async target => {
    calls++; assert.equal(target, dir); entered(); await gate;
    execFileSync(process.execPath, [fileURLToPath(new URL('../../../src/cli.js', import.meta.url)), 'init', '--store-only'], { cwd: target, env: { ...process.env, LANES_HOME: path.join(dir, 'home'), CLIPS_HOME: path.join(dir, 'home') } });
    projects = [current];
  };
  const service = createCanvasService({ runtime: f.runtime, dataDir: path.join(dir, 'data'), projectDiscovery });
  t.after(async () => { release(); await service.shutdown(); await rm(dir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'init', sessionId: 'host', session: { workingDirectory: dir }, input: { projectPath: '/another-tab' } });
  await assert.rejects(service.state('init'), /No available|not an available registered/);
  const context = await service.dispatch('init', 'list_projects');
  assert.equal(context.currentDirectory, dir); assert.equal(context.canInitializeCurrentDirectory, true);
  for (const input of [{ projectPath: '/another-tab' }, { projectId: 'other' }, { currentDirectory: '/another-tab' }]) {
    await assert.rejects(service.dispatch('init', 'initialize_current_directory', input), /accepts no caller/);
  }
  const pending = service.dispatch('init', 'initialize_current_directory');
  await started;
  await assert.rejects(service.dispatch('init', 'initialize_current_directory'), /already pending/);
  release(); const result = await pending;
  assert.equal(calls, 1); assert.equal(result.projectId, current.id); assert.equal(result.state.projectPath, dir);
  assert.equal(result.state.canInitializeCurrentDirectory, false);
  assert.equal((await service.dispatch('init', 'list_projects')).currentProjectId, current.id);
  await assert.rejects(service.dispatch('init', 'initialize_current_directory'), /already has a Lanes store/);
});

test('saved explicit project and focus survive real project/default-home migration', async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'lanes-canvas-migration-')));
  const previous = Object.fromEntries(['HOME', 'LANES_HOME', 'CLIPS_HOME'].map(key => [key, process.env[key]]));
  const services = [];
  t.after(async () => {
    await Promise.all(services.map(service => service.shutdown()));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  });
  const home = path.join(root, 'user');
  process.env.HOME = home;
  delete process.env.LANES_HOME;
  delete process.env.CLIPS_HOME;
  await mkdir(path.join(home, '.clips'), { recursive: true });
  const projects = [];
  for (const name of ['current', 'chosen']) {
    const repo = path.join(root, name);
    await mkdir(path.join(repo, '.clips', 'db'), { recursive: true });
    execFileSync('git', ['init', '--quiet', repo]);
    await writeFile(path.join(repo, '.clips', 'clips.config.json'), '{}');
    await writeFile(path.join(repo, '.clips', 'db', 'g001.jsonl'), JSON.stringify({
      event: 'goal_created', goal_id: 'g001', title: name, timestamp: '2026-01-01T00:00:00.000Z',
    }) + '\n');
    projects.push(repo);
  }
  await writeFile(path.join(home, '.clips', 'projects.json'), JSON.stringify({ projects: projects.map(repo => ({ path: repo })) }));
  const make = () => {
    const f = fixture();
    f.runtime.listBoard = async repo => readCurrentBoard(repo);
    const service = realCreateCanvasService({ runtime: f.runtime, dataDir: path.join(root, 'canvas-data'),
      projectDiscovery: { discoverClipsProjects, resolveClipsProject } });
    services.push(service);
    return service;
  };
  const context = { instanceId: 'persisted', sessionId: 'actual-fixture', session: { workingDirectory: projects[0] } };
  const before = make();
  await before.open(context);
  const catalog = await before.dispatch('persisted', 'list_projects');
  const chosen = catalog.projects.find(project => project.projectRoot === projects[1]);
  await before.dispatch('persisted', 'set_project', { projectId: chosen.id });
  await before.dispatch('persisted', 'focus', { ref: '#g001' });
  await before.shutdown();
  execFileSync(process.execPath, [fileURLToPath(new URL('../../../src/cli.js', import.meta.url)),
    'init', '--skills-scope', 'project'], {
    cwd: projects[1], env: { ...process.env, LANES_SWITCH_INIT: '1', CLIPS_SWITCH_INIT: '1' }, stdio: 'pipe',
  });
  const after = make();
  await after.open(context);
  const state = await after.state('persisted');
  assert.equal(state.selectionSource, 'saved');
  assert.equal(state.selectedProject.id, chosen.id);
  assert.equal(state.projectPath, projects[1], 'saved choice must win over the current directory');
  assert.equal(state.selectedProject.storeRoot, path.join(projects[1], '.lanes'));
  assert.equal(state.focus, '#g001');
  assert.equal(state.canInitializeCurrentDirectory, false, 'legacy current project is already initialized');
  const reopened = make();
  await reopened.open({ ...context, instanceId: 'canonical-current', session: { workingDirectory: projects[1] } });
  assert.equal((await reopened.state('canonical-current')).canInitializeCurrentDirectory, false);
});

test('the actual joined session is required but absent host and unreadable ownership are advisory', async (t) => {
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

  f.runtime.hostCapabilities = async () => ({ appSessionVisibilityVerified: false, canSendToCurrentSession: true, hostIdConfigured: false });
  f.board.lanes[0].manager_claim = null;
  f.board.lanes[0].manager_claim_error = 'corrupt claim';
  await service.dispatch('unverified', 'launch', { ref: '#l001' });
  assert.equal(f.calls.some((call) => call[0] === 'launchRecord'), true);
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
  await a.dispatch('same', 'set_project', { projectId: 'project:/chosen' });
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
  await reopened.dispatch('same', 'set_project', { projectId: 'project:/initial' });
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
  assert.match(html, /id="root"/);
  assert.doesNotMatch(html, /class="sidebar"/);
  const app = new URL('/canvas/app.js', opened); app.search = opened.search;
  const source = await (await fetch(app)).text();
  assert.match(source, /react/);
  assert.doesNotMatch(source, /from ["']|import\(/);
  for (const file of ['app.js', 'style.css']) {
    const asset = new URL(`/canvas/${file}`, opened); asset.search = opened.search;
    const response = await fetch(asset); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), file.endsWith('.js') ? /javascript/ : /css/);
    assert.ok((await response.text()).length > 100);
    asset.search = ''; assert.equal((await fetch(asset)).status, 403);
  }
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
  await service.dispatch('race', 'set_project', { projectId: 'project:/B' });
  releaseBoard(); await pending;
  assert.equal(f.calls.find(([kind]) => kind === 'recordCommand')[2], '/A');
  await assert.rejects(service.dispatch('race', 'set_status', { ref: '#g001', status: 'closed', expectedProjectPath: '/A' }), /selected project changed/);
  assert.equal(f.calls.filter(([kind]) => kind === 'recordCommand').length, 1);
});

test('user scope isolates persisted choice/focus and removed selected source never falls back to cwd', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-users-')); const f = fixture();
  let userScope = 'first'; let available = [...fixtureProjects]; const services = [];
  const projectDiscovery = { async discoverClipsProjects() { return { projects: available, userScope, diagnostics: [] }; }, async resolveClipsProject(id) { const p = available.find((p) => p.id === id); if (!p) throw new Error('Unavailable'); return p; } };
  const make = () => { const s = createCanvasService({ runtime: f.runtime, dataDir, projectDiscovery }); services.push(s); return s; };
  t.after(async () => { await Promise.all(services.map((s) => s.shutdown())); await rm(dataDir, { recursive: true, force: true }); });
  const ctx = { instanceId: 'panel', sessionId: 'host', input: { projectPath: '/A' } };
  const first = make(); await first.open(ctx); await first.dispatch('panel', 'set_project', { projectId: 'project:/B' }); await first.dispatch('panel', 'focus', { ref: '#g001' }); await first.shutdown();
  userScope = 'second'; const second = make(); await second.open(ctx); assert.equal((await second.state('panel')).projectPath, '/A'); assert.equal((await second.state('panel')).focus, null); await second.shutdown();
  userScope = 'first'; available = available.filter((p) => p.projectRoot !== '/B');
  const reopened = make(); await reopened.open(ctx); await assert.rejects(reopened.state('panel'), /selected Lanes project is no longer available/);
  assert.equal((await reopened.dispatch('panel', 'context')).projectPath, null);
  const selected = await reopened.dispatch('panel', 'set_project', { projectId: 'project:/A' }); assert.equal(selected.projectPath, '/A');
  await assert.rejects(reopened.dispatch('panel', 'set_project', { projectPath: '/A' }), /exact discovered/);
});
test('failed board selection is transactional; corrupt or removed registry does not return prior board', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-select-transaction-')); const f = fixture(); let available = [...fixtureProjects];
  const projectDiscovery = { async discoverClipsProjects() { return { projects: available, userScope: 'u', diagnostics: [] }; }, async resolveClipsProject(id) { return fixtureProjects.find((p) => p.id === id); } };
  const listBoard = f.runtime.listBoard; f.runtime.listBoard = (root) => root === '/B' ? Promise.reject(new Error('Corrupt board B')) : listBoard(root);
  const service = createCanvasService({ runtime: f.runtime, dataDir, projectDiscovery }); t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'panel', sessionId: 'host', input: { projectPath: '/A' } });
  await assert.rejects(service.dispatch('panel', 'set_project', { projectId: 'project:/B' }), /Corrupt board B/);
  assert.equal((await service.state('panel')).projectPath, '/A');
  available = []; await assert.rejects(service.state('panel'), /no longer available/);
});
test('Task sends retain lifecycle and pending-click guards without idle or prior-association gates', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-task-run-')); const f = fixture();
  f.runtime.hostCapabilities = async () => ({ currentSessionId: 'joined', canSendToCurrentSession: true });
  f.sessions.push({ id: 'joined', joined: true, steerable: true, status: 'idle' });
  let release; let started; const gate = new Promise((r) => { release = r; }); const entered = new Promise((r) => { started = r; });
  const launch = f.runtime.launchRecord; f.runtime.launchRecord = async (input) => { started(); await gate; return launch(input); };
  const service = createCanvasService({ runtime: f.runtime, dataDir }); t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'panel', sessionId: 'host', input: { projectPath: '/repo' } });
  const task = f.board.goals[0].tasks[0]; task.status = 'closed';
  await assert.rejects(service.dispatch('panel', 'launch', { ref: task.ref }), /not open/); task.status = 'open';
  f.sessions[0].status = 'running';
  const pending = service.dispatch('panel', 'launch', { ref: task.ref, expectedProjectPath: '/repo' }); await entered;
  await assert.rejects(service.dispatch('panel', 'launch', { ref: task.ref }), /already pending/); release(); await pending;
  const sent = f.calls.find(([kind]) => kind === 'launchRecord')[1]; assert.equal(sent.ref, task.ref); assert.match(sent.prompt, /Work on Task #g001#t01/);
  await service.dispatch('panel', 'launch', { ref: task.ref });
  assert.equal(f.calls.filter(([kind]) => kind === 'launchRecord').length, 2);
});
test('inspect revalidates selected registry/user scope and never reads a formerly selected store', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-inspect-scope-')); const f = fixture();
  let catalog = { projects: [...fixtureProjects], userScope: 'one', diagnostics: [] };
  const service = createCanvasService({ runtime: f.runtime, dataDir, projectDiscovery: { ...fixtureDiscovery, async discoverClipsProjects() { return catalog; } } });
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  await service.open({ instanceId: 'panel', sessionId: 'host', input: { projectPath: '/repo' } });
  await service.dispatch('panel', 'inspect', { ref: '#g001' }); const initial = f.calls.filter(([kind]) => kind === 'viewRecord').length;
  catalog = { ...catalog, projects: [] }; await assert.rejects(service.dispatch('panel', 'inspect', { ref: '#g001' }), /no longer available/);
  for (const action of ['create_lane','create_goal']) await assert.rejects(service.dispatch('panel', action, { title: 'Never created' }), /no longer available/);
  assert.equal(f.calls.some(([kind]) => kind === 'recordCommand'), false);
  catalog = { ...catalog, projects: [...fixtureProjects], userScope: 'two' }; await assert.rejects(service.dispatch('panel', 'inspect', { ref: '#g001' }), /user scope changed/);
  assert.equal(f.calls.filter(([kind]) => kind === 'viewRecord').length, initial);
});

test('JSON-valid malformed persisted selections open the chooser without TypeError or cwd substitution', async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-corrupt-selection-')); const f = fixture(); const services = [];
  const make = () => { const s = createCanvasService({ runtime: f.runtime, dataDir }); services.push(s); return s; };
  t.after(async () => { await Promise.all(services.map((s) => s.shutdown())); await rm(dataDir, { recursive: true, force: true }); });
  const ctx = { instanceId: 'panel', sessionId: 'host', input: { projectPath: '/repo' }, session: { workingDirectory: '/repo' } };
  const initial = make(); await initial.open(ctx); await initial.shutdown();
  const [file] = await readdir(path.join(dataDir, 'projects'));
  for (const bad of [null, [], 'bad', {}, { projectId: 3 }, { projectId: null, openInputPath: [] }, { projectId: null, openInputPath: 'relative' }]) {
    await writeFile(path.join(dataDir, 'projects', file), JSON.stringify(bad));
    const service = make(); await service.open(ctx);
    assert.equal((await service.dispatch('panel', 'context')).projectPath, null);
    await assert.rejects(service.state('panel'), /Saved Lanes project selection is invalid/);
    assert.ok((await service.dispatch('panel', 'list_projects')).projects.length);
    await service.shutdown();
  }
});
