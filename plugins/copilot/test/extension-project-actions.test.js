import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createCanvasService } from '../canvas/service.mjs';

// Execute the shipped registration module with only its imported host transports
// substituted. Actions use the actual service, isolated preferences and provider.
async function extensionFixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'clips-extension-actions-'));
  const projects = [
    { id: 'opaque-alpha', name: 'Alpha', projectRoot: '/alpha', storeRoot: '/alpha/.clips', username: null },
    { id: 'opaque-beta', name: 'Beta', projectRoot: '/beta', storeRoot: '/beta/.clips', username: null },
  ];
  let available = [...projects]; const reads = [];
  const discovery = {
    async discoverClipsProjects() { return { projects: available, userScope: 'local-user', diagnostics: [] }; },
    async resolveClipsProject(id) { const p = available.find((p) => p.id === id); if (!p) throw new Error('Project is no longer available'); return p; },
  };
  const runtime = {
    async listBoard(root) { reads.push(root); return { lanes: [], goals: [{ ref: '#g001', title: root, status: 'open', tasks: [] }], labels: [] }; },
    async listSessions() { return { sessions: [] }; },
    async hostCapabilities() { return { canSendToCurrentSession: false }; },
  };
  let canvas; let service;
  const source = await readFile(new URL('../extension.mjs', import.meta.url), 'utf8');
  const body = source.replace(/^import .*;\n/gm, '');
  const run = Object.getPrototypeOf(async function () {}).constructor('createCanvas', 'joinSession', 'createClipsRuntime', 'createCanvasService', 'process', body);
  await run((definition) => (canvas = definition), async () => ({ sessionId: 'actual-fixture-session', log() {} }), async () => runtime,
    (options) => (service = createCanvasService({ ...options, projectDiscovery: discovery, dataDir })),
    { on() {}, stderr: { write() {} }, exit() {} });
  const ctx = { instanceId: 'panel', sessionId: 'actual-fixture-session', session: { workingDirectory: '/alpha' } };
  await canvas.open(ctx);
  t.after(async () => { await service.shutdown(); await rm(dataDir, { recursive: true, force: true }); });
  const action = (name) => { const a = canvas.actions.find((a) => a.name === name); assert.ok(a, `Registered action ${name}`); return a; };
  return { ctx, action, reads, projects, service, setAvailable(value) { available = value; } };
}

test('registered agent discovery and declared selection schema select the exact canonical project through the real service', async (t) => {
  const f = await extensionFixture(t);
  const catalog = await f.action('list_clips_projects').handler({ ...f.ctx, input: {} });
  assert.deepEqual(catalog.projects.map((p) => p.id), ['opaque-alpha', 'opaque-beta']);
  const choose = f.action('select_clips_project');
  assert.deepEqual(choose.inputSchema.required, ['projectId']);
  assert.equal(choose.inputSchema.properties.projectPath, undefined);
  const selected = await choose.handler({ ...f.ctx, input: { projectId: catalog.projects[1].id } });
  assert.equal(selected.projectPath, '/beta'); assert.equal(selected.selectedProject.id, 'opaque-beta');
  assert.equal(selected.goals[0].title, '/beta');
  assert.equal((await f.service.state('panel')).selectedProject.id, 'opaque-beta');
});

test('registered selection rejects stale ids and old path input without reading or substituting a board', async (t) => {
  const f = await extensionFixture(t); const choose = f.action('select_clips_project');
  const catalog = await f.action('list_clips_projects').handler({ ...f.ctx, input: {} });
  f.setAvailable([f.projects[0]]); f.reads.length = 0;
  await assert.rejects(choose.handler({ ...f.ctx, input: { projectId: catalog.projects[1].id } }), /no longer available/);
  await assert.rejects(choose.handler({ ...f.ctx, input: { projectPath: '/beta' } }), /exact discovered/);
  assert.deepEqual(f.reads, []);
  assert.equal((await f.service.state('panel')).projectPath, '/alpha');
});
