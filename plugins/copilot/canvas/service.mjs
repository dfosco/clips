import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findRecord, focusOutline, recordPrompt, relatedSessions, RECORD_STATUSES } from './model.mjs';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const assets = new Map([
  ['/canvas/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/canvas/style.css', ['style.css', 'text/css; charset=utf-8']],
]);
const allowedActions = new Set(['refresh', 'set_project', 'focus', 'inspect', 'set_status', 'add_label', 'remove_label', 'create_lane', 'create_goal', 'create_task', 'launch', 'steer', 'open_session']);

const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const sessionId = (session) => session?.id || session?.sessionId || null;

function localDataRoot() {
  return path.join(process.env.COPILOT_HOME || path.join(os.homedir(), '.copilot'), 'data', 'clips-canvas');
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
}

function safeRef(ref) {
  if (typeof ref !== 'string' || ref.length > 256 || !/^#?[\w.-]+(?:#[\w.-]+){0,2}$/.test(ref)) {
    throw new Error('Provide a valid Lane, Goal, or Task reference.');
  }
  return ref.startsWith('#') ? ref : `#${ref}`;
}

function recordCommandForStatus(record, status) {
  if (record.kind === 'lane') {
    if (!new Set(['open', 'in_progress', 'not_planned', 'duplicate']).has(status)) throw new Error(`Unsupported Lane status: ${status}`);
    return ['lane', 'status', record.lane_id, status];
  }
  if (!RECORD_STATUSES.has(status)) throw new Error(`Unsupported Clips status: ${status}`);
  if (record.kind === 'goal') return ['goal', 'status', record.goal_id, status];
  if (record.kind === 'task') return ['task', 'status', record.goal_id, record.task_id, status];
  throw new Error('Only Lanes, Goals, and Tasks have status controls.');
}

export function createCanvasService({ runtime, dataDir = localDataRoot(), serverFactory = createServer } = {}) {
  if (!runtime) throw new TypeError('A Clips runtime adapter is required.');
  const instances = new Map();
  let server;
  let origin;

  const focusPath = (instanceId) => path.join(dataDir, 'focus', `${hash(instanceId)}.json`);
  const projectPathFile = (instanceId) => path.join(dataDir, 'projects', `${hash(instanceId)}.json`);
  const bindingsPath = (projectPath) => path.join(dataDir, 'sessions', `${hash(path.resolve(projectPath))}.json`);

  async function requireProject(instance) {
    if (!instance.projectPath) throw new Error('Copilot did not provide a working directory. Enter an absolute project path with an initialized Clips store to continue.');
    return instance.projectPath;
  }

  async function saveFocus(instance, ref) {
    await requireProject(instance);
    const board = await runtime.listBoard(instance.projectPath);
    if (!findRecord(board, ref)) throw new Error(`Record ${ref} is not present in this project's Clips board.`);
    await writeJson(focusPath(instance.instanceId), { ref, updatedAt: new Date().toISOString() });
    return ref;
  }

  async function buildState(instance) {
    await requireProject(instance);
    const [board, savedFocus, sessionResult, bindings, hostCapabilities] = await Promise.all([
      runtime.listBoard(instance.projectPath),
      readJson(focusPath(instance.instanceId), { ref: null }),
      runtime.listSessions(instance.projectPath),
      readJson(bindingsPath(instance.projectPath), {}),
      runtime.hostCapabilities ? runtime.hostCapabilities() : Promise.resolve(null),
    ]);
    const focus = savedFocus.ref && findRecord(board, savedFocus.ref) ? savedFocus.ref : null;
    const outline = focusOutline(board, focus);
    const sessions = sessionResult.sessions || [];
    const related = outline ? relatedSessions(outline.record, sessions, bindings) : [];
    return {
      projectPath: instance.projectPath,
      instanceId: instance.instanceId,
      copilotSessionId: instance.sessionId,
      hostCapabilities: hostCapabilities || {
        appSessionVisibilityVerified: sessionResult.appSessionVisibilityVerified === true || sessions.some((session) => session.steerable === true),
        hostIdConfigured: sessionResult.hostIdConfigured === true,
      },
      focus,
      outline: outline ? {
        kind: outline.kind,
        record: outline.record,
        goals: outline.goals,
        tasks: outline.tasks,
        tasksExpanded: outline.kind === 'goal',
      } : null,
      lanes: board.lanes || [],
      goals: board.goals || [],
      labels: board.labels || [],
      warnings: board.warnings || [],
      relatedSessions: related.map((session) => ({ ...session, statusLabel: session.status === 'unknown' ? 'Status not exposed by Copilot SDK' : session.status, appVisibilityLabel: session.appVisible === 'unverified' ? 'Copilot App visibility unverified' : undefined })),
      projectSessions: sessions.map((session) => ({ ...session, statusLabel: session.status === 'unknown' ? 'Status not exposed by Copilot SDK' : session.status, appVisibilityLabel: session.appVisible === 'unverified' ? 'Copilot App visibility unverified' : undefined })),
    };
  }

  async function selected(instance, ref) {
    await requireProject(instance);
    const normalized = safeRef(ref);
    const board = await runtime.listBoard(instance.projectPath);
    const record = findRecord(board, normalized);
    if (!record) throw new Error(`Record ${normalized} is not present in this project's Clips board.`);
    return { board, record };
  }

  async function dispatch(instance, action, input = {}) {
    if (!allowedActions.has(action)) throw new Error(`Unsupported canvas action: ${action}`);
    if (action === 'refresh') return buildState(instance);
    if (action === 'set_project') {
      const selectedPath = String(input.projectPath || '').trim();
      if (!path.isAbsolute(selectedPath)) throw new Error('Enter an absolute local repository path.');
      const resolved = path.resolve(selectedPath);
      await runtime.listBoard(resolved);
      instance.projectPath = resolved;
      await writeJson(projectPathFile(instance.instanceId), { projectPath: resolved, updatedAt: new Date().toISOString() });
      return buildState(instance);
    }
    if (action === 'focus') {
      const ref = await saveFocus(instance, safeRef(input.ref));
      return { focus: ref, state: await buildState(instance) };
    }
    if (action === 'inspect') {
      const ref = safeRef(input.ref);
      return runtime.viewRecord(ref, instance.projectPath);
    }
    if (action === 'set_status') {
      const { record } = await selected(instance, input.ref);
      const result = await runtime.recordCommand(recordCommandForStatus(record, input.status), instance.projectPath);
      return { result, state: await buildState(instance) };
    }
    if (action === 'add_label' || action === 'remove_label') {
      const ref = safeRef(input.ref);
      if (typeof input.labelId !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(input.labelId)) throw new Error('Provide a valid label ID.');
      const { record } = await selected(instance, ref);
      if (record.kind === 'task' && !record.ref) throw new Error('A full Task reference is required to edit its labels.');
      const verb = action === 'add_label' ? 'add' : 'remove';
      const result = await runtime.recordCommand(['label', verb, record.ref, input.labelId], instance.projectPath);
      return { result, state: await buildState(instance) };
    }
    if (action === 'create_lane' || action === 'create_goal' || action === 'create_task') {
      const title = String(input.title || '').trim();
      if (!title || title.length > 200) throw new Error('A title of 1–200 characters is required.');
      const data = { title, description: String(input.description || '').slice(0, 12000) };
      if (action === 'create_lane') {
        if (input.product_goals !== undefined) data.product_goals = input.product_goals;
        const result = await runtime.recordCommand(['lane', 'create', JSON.stringify(data)], instance.projectPath);
        return { result, state: await buildState(instance) };
      }
      if (action === 'create_goal') {
        if (input.lane_id) data.lane_id = safeRef(input.lane_id).replace(/^#/, '');
        const result = await runtime.recordCommand(['goal', 'create', JSON.stringify(data)], instance.projectPath);
        return { result, state: await buildState(instance) };
      }
      if (!Array.isArray(input.acceptance_criteria) || input.acceptance_criteria.length === 0 || input.acceptance_criteria.length > 12) {
        throw new Error('A Task needs 1–12 observable acceptance criteria.');
      }
      data.acceptance_criteria = input.acceptance_criteria.map((criterion) => String(criterion || '').trim()).filter(Boolean);
      if (data.acceptance_criteria.length !== input.acceptance_criteria.length || data.acceptance_criteria.some((criterion) => criterion.length > 1000)) {
        throw new Error('Each Task acceptance criterion must be a non-empty sentence of at most 1,000 characters.');
      }
      const goalRef = safeRef(input.goal_ref);
      const { record: parent } = await selected(instance, goalRef);
      if (parent.kind !== 'goal') throw new Error('A Task must be created under a Goal.');
      const result = await runtime.recordCommand(['task', 'create', parent.goal_id, JSON.stringify(data)], instance.projectPath);
      return { result, state: await buildState(instance) };
    }
    if (action === 'launch') {
      const capability = runtime.hostCapabilities ? await runtime.hostCapabilities() : null;
      if (capability?.appSessionVisibilityVerified !== true) throw new Error('Starting or resuming Copilot work is disabled until this host has verified that SDK sessions open and can be steered in the Copilot App.');
      const { board, record } = await selected(instance, input.ref);
      if (record.kind === 'lane' && (record.manager_claim?.owners || []).length) {
        throw new Error(`Lane ${record.ref} already has a claimed manager. Open or contact the listed owner; this canvas will not replace it.`);
      }
      if (record.kind === 'lane' && (!record.manager_claim || record.manager_claim_error)) {
        throw new Error(`Ownership for Lane ${record.ref} is unavailable. Repair or inspect the claim before starting a manager.`);
      }
      if (record.kind === 'lane' && capability.hostIdConfigured !== true) {
        throw new Error('Lane management is disabled because this Copilot host has no observed host identity configured.');
      }
      const lane = record.kind === 'lane' ? record : board.lanes?.find((item) => item.lane_id === record.lane_id);
      const launched = await runtime.launchRecord({
        projectPath: instance.projectPath,
        ref: record.ref,
        title: record.title,
        prompt: recordPrompt(record, { lane }),
      });
      const id = sessionId(launched);
      if (!id) throw new Error('Copilot runtime returned no session ID. The launch result cannot be safely attributed.');
      await saveFocus(instance, record.ref);
      const file = bindingsPath(instance.projectPath);
      const bindings = await readJson(file, {});
      bindings[record.ref] = [...new Set([...(bindings[record.ref] || []), id])];
      await writeJson(file, bindings);
      return { session: launched, state: await buildState(instance) };
    }
    if (action === 'steer' || action === 'open_session') {
      const capability = runtime.hostCapabilities ? await runtime.hostCapabilities() : null;
      if (capability?.appSessionVisibilityVerified !== true) throw new Error('Copilot App session visibility has not been verified on this host; navigation and steering are disabled.');
      const id = String(input.sessionId || '').trim();
      const sessions = (await runtime.listSessions(instance.projectPath)).sessions || [];
      const session = sessions.find((candidate) => sessionId(candidate) === id);
      if (!session) throw new Error('That session is not in the current project session list. Refresh before opening or steering it.');
      if (action === 'open_session') return { sessionId: id, url: runtime.appSessionUrl(id), appVisibility: session.appVisible || 'unverified' };
      const prompt = String(input.prompt || '').trim();
      if (!prompt) throw new Error('Enter a message to steer this session.');
      if (prompt.length > 12000) throw new Error('Steering message is too long.');
      await runtime.steerSession(id, prompt);
      return { sessionId: id, sent: true, status: session.status || 'unknown' };
    }
    throw new Error(`Unsupported canvas action: ${action}`);
  }

  async function startServer() {
    if (server) return;
    server = serverFactory(async (req, res) => {
      const url = new URL(req.url || '/', origin || 'http://127.0.0.1');
      const expectedHost = origin && new URL(origin).host;
      if (expectedHost && req.headers.host !== expectedHost) {
        res.writeHead(403).end('Invalid host');
        return;
      }
      const pathMatch = url.pathname.match(/^\/api\/([A-Za-z0-9._-]+)$/);
      if (pathMatch && req.method === 'POST') {
        const instance = instances.get(pathMatch[1]);
        if (!instance || url.searchParams.get('token') !== instance.token) {
          res.writeHead(403, { 'content-type': 'application/json' }).end('{"error":"Canvas token or instance is invalid."}');
          return;
        }
        try {
          let body = '';
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 64_000) throw new Error('Request body exceeds 64 KB.');
          }
          const parsed = JSON.parse(body || '{}');
          const result = await dispatch(instance, parsed.action, parsed.input || {});
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ result }));
        } catch (error) {
          res.writeHead(400, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      const requestedInstance = instances.get(url.searchParams.get('instanceId'));
      if (!requestedInstance || url.searchParams.get('token') !== requestedInstance.token) {
        res.writeHead(403).end('Invalid canvas token');
        return;
      }
      if (url.pathname === '/canvas/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        const html = (await readFile(path.join(sourceDir, 'index.html'), 'utf8'))
          .replaceAll('__TOKEN__', requestedInstance.token)
          .replaceAll('__INSTANCE_ID__', requestedInstance.instanceId);
        res.end(html);
        return;
      }
      const asset = assets.get(url.pathname);
      if (asset) {
        res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(await readFile(path.join(sourceDir, asset[0])));
        return;
      }
      res.writeHead(404).end('Not found');
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        origin = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  }

  return {
    async open(ctx) {
      if (!ctx?.instanceId || !ctx.sessionId) throw new Error('Copilot did not provide a canvas instance and session ID.');
      const input = ctx.input && typeof ctx.input === 'object' ? ctx.input : {};
      const persisted = await readJson(projectPathFile(ctx.instanceId), { projectPath: null });
      const sourcePath = ctx.session?.workingDirectory || input.projectPath || persisted.projectPath;
      const projectPath = sourcePath ? path.resolve(sourcePath) : null;
      instances.set(ctx.instanceId, { instanceId: ctx.instanceId, sessionId: ctx.sessionId, projectPath, token: randomBytes(32).toString('hex') });
      await startServer();
      const instance = instances.get(ctx.instanceId);
      return { title: 'Clips Work', url: `${origin}/canvas/index.html?instanceId=${encodeURIComponent(ctx.instanceId)}&token=${instance.token}` };
    },
    async close(ctx) { instances.delete(ctx.instanceId); },
    async action(ctx) {
      const instance = instances.get(ctx.instanceId);
      if (!instance) throw new Error('Open Clips Work in this canvas instance first.');
      return dispatch(instance, ctx.actionName, ctx.input || {});
    },
    async dispatch(instanceId, action, input) {
      const instance = instances.get(instanceId);
      if (!instance) throw new Error('Open Clips Work in this canvas instance first.');
      return dispatch(instance, action, input);
    },
    async state(instanceId) {
      const instance = instances.get(instanceId);
      if (!instance) throw new Error('Open Clips Work in this canvas instance first.');
      return buildState(instance);
    },
    async shutdown() {
      instances.clear();
      if (server?.listening) await new Promise((resolve) => server.close(resolve));
      server = undefined;
      origin = undefined;
    },
  };
}
