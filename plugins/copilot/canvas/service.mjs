import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCanvasArtifact } from '../src/canvas-build.js';
import { discoverClipsProjects, resolveClipsProject } from '../src/project-discovery.js';
import { getClipsDir, getRepoRoot } from '../../../src/lib/core.js';
import { withRecordLock } from '../../../src/lib/journal.js';
import { findRecord, focusOutline, recordPrompt, sessionAssociations, RECORD_STATUSES } from './model.mjs';

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const loadedSourceHash = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
const assets = new Map([
  ['/canvas/app.js', ['dist/app.js', 'text/javascript; charset=utf-8']],
  ['/canvas/style.css', ['dist/style.css', 'text/css; charset=utf-8']],
]);
const allowedActions = new Set(['context', 'list_projects', 'initialize_current_directory', 'diagnostics', 'refresh', 'set_project', 'focus', 'clear_focus', 'inspect', 'read_attachment', 'set_collaboration', 'set_status', 'add_label', 'remove_label', 'create_lane', 'create_goal', 'create_task', 'launch', 'steer', 'open_session']);

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
    return ['lane', 'status', record.ref, status];
  }
  if (!RECORD_STATUSES.has(status)) throw new Error(`Unsupported Lanes status: ${status}`);
  if (record.kind === 'goal') return ['goal', 'status', record.ref, status];
  if (record.kind === 'task') return ['task', 'status', record.ref, status];
  throw new Error('Only Lanes, Goals, and Tasks have status controls.');
}

export function createCanvasService({ runtime, dataDir = localDataRoot(), serverFactory = createServer, onDiagnostic, projectDiscovery = { discoverClipsProjects, resolveClipsProject } } = {}) {
  if (!runtime) throw new TypeError('A Lanes runtime adapter is required.');
  const { build: canvasBuild, files: artifactFiles, sourceStatus } = readCanvasArtifact(path.dirname(sourceDir));
  const buildIdentity = { manifestSha256: hash(JSON.stringify(canvasBuild)), bridgeVersion: canvasBuild.bridgeVersion };
  // Provider and renderer activate together. An old process must not serve a
  // newly linked renderer against its old API while claiming the old hashes.
  const loadedAssets = new Map([...assets].map(([url, [file, type]]) => [url, [artifactFiles[path.basename(file)], type]]));
  const loadedIndex = artifactFiles['index.html'].toString('utf8');
  onDiagnostic?.({ event: 'clips.canvas.artifact', uiAssets: canvasBuild.assets, uiSourceStatus: sourceStatus });
  const instances = new Map();
  const taskLaunches = new Set();
  const directoryInitializations = new Set();
  let server;
  let origin;

  const panelKey = (instance) => JSON.stringify([instance.userScope, instance.sessionId, instance.instanceId]);
  const focusPath = (instance) => path.join(dataDir, 'focus', `${hash(JSON.stringify([instance.userScope, instance.sessionId, instance.instanceId, instance.projectPath]))}.json`);
  const projectPathFile = (instance) => path.join(dataDir, 'projects', `${hash(panelKey(instance))}.json`);
  const bindingsPath = (projectPath) => path.join(dataDir, 'sessions', `${hash(path.resolve(projectPath))}.json`);

  async function directoryInfo(instance, catalog) {
    if (!instance.sessionDirectory) return { currentDirectory: null, currentProjectId: null, canInitializeCurrentDirectory: false, ...(instance.sessionDirectoryError ? { currentDirectoryError: instance.sessionDirectoryError } : {}) };
    let currentDirectory;
    try { currentDirectory = await realpath(getRepoRoot(await realpath(instance.sessionDirectory))); }
    catch (error) { return { currentDirectory: null, currentProjectId: null, canInitializeCurrentDirectory: false, currentDirectoryError: `Current session directory is unavailable or not a Git repository: ${error.message}` }; }
    let canInitializeCurrentDirectory = false;
    try { await lstat(getClipsDir(currentDirectory)); }
    catch (error) {
      if (error.code !== 'ENOENT') return { currentDirectory, currentProjectId: null, canInitializeCurrentDirectory: false, currentDirectoryError: `Cannot inspect the current repository's Lanes store: ${error.message}` };
      canInitializeCurrentDirectory = true;
    }
    return { currentDirectory, currentProjectId: catalog.projects.find((project) => project.projectRoot === currentDirectory)?.id || null, canInitializeCurrentDirectory };
  }

  async function projectContext(instance) {
    const catalog = await projectDiscovery.discoverClipsProjects();
    if (catalog.userScope !== instance.userScope) throw new Error('The local Lanes user scope changed. Reopen the canvas.');
    const directory = await directoryInfo(instance, catalog);
    return { ...catalog, ...directory, diagnostics: [...catalog.diagnostics, ...(directory.currentDirectoryError ? [{ code: 'current_directory_unavailable', message: directory.currentDirectoryError }] : [])], projectPath: instance.projectPath, selectedProject: instance.selectedProject || null, selectionSource: instance.selectionSource, selectionError: instance.selectionError || null };
  }

  function associateSession(projectPath, ref, id) {
    const file = bindingsPath(projectPath);
    withRecordLock(file, () => {
      let bindings;
      try { bindings = JSON.parse(readFileSync(file, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; bindings = {}; }
      bindings[ref] = [...new Set([...(bindings[ref] || []), id])];
      const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(bindings, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    });
  }

  async function requireProject(instance) {
    if (!instance.selectedProject) throw new Error(instance.selectionError || 'Choose an available Lanes project from your local registry to continue.');
    const catalog = await projectDiscovery.discoverClipsProjects();
    if (catalog.userScope !== instance.userScope) throw new Error('The local Lanes user scope changed. Reopen the canvas and choose a project.');
    const selected = catalog.projects.find((project) => project.id === instance.selectedProject.id && project.projectRoot === instance.projectPath && project.storeRoot === instance.selectedProject.storeRoot);
    if (!selected) throw new Error('The selected Lanes project is no longer available. Choose an available project; no other board was substituted.');
    return instance.projectPath;
  }

  async function saveFocus(instance, ref) {
    await requireProject(instance);
    const board = await runtime.listBoard(instance.projectPath);
    if (!findRecord(board, ref)) throw new Error(`Record ${ref} is not present in this project's Lanes board.`);
    await writeJson(focusPath(instance), { ref, updatedAt: new Date().toISOString() });
    return ref;
  }

  async function buildState(instance) {
    await requireProject(instance);
    const [board, savedFocus, sessionResult, bindings, hostCapabilities] = await Promise.all([
      runtime.listBoard(instance.projectPath),
      readJson(focusPath(instance), { ref: null }),
      runtime.listSessions(instance.projectPath).catch((error) => ({ sessions: [], warnings: [`Session catalog unavailable: ${error.message}`] })),
      readJson(bindingsPath(instance.projectPath), {}),
      runtime.hostCapabilities ? runtime.hostCapabilities() : Promise.resolve(null),
    ]);
    const focus = savedFocus.ref && findRecord(board, savedFocus.ref) ? savedFocus.ref : null;
    const outline = focusOutline(board, focus);
    const sessions = sessionResult.sessions || [];
    const associations = outline ? sessionAssociations({ ...outline.record, kind: outline.kind }, sessions, bindings) : [];
    const related = associations.flatMap(({ session }) => session ? [session] : []);
    onDiagnostic?.({ event: 'clips.canvas.state', serviceSourceSha256: loadedSourceHash, sessionId: instance.sessionId, instanceId: instance.instanceId, projectPath: instance.projectPath, uiAssets: canvasBuild.assets, uiSourceStatus: sourceStatus, focus, goals: (board.goals || []).length, lanes: (board.lanes || []).length });
    return {
      ...await projectContext(instance),
      projectPath: instance.projectPath,
      selectedProject: instance.selectedProject,
      instanceId: instance.instanceId,
      copilotSessionId: instance.sessionId,
      hostCapabilities: hostCapabilities || {
        appSessionVisibilityVerified: sessionResult.appSessionVisibilityVerified === true,
        hostIdConfigured: sessionResult.hostIdConfigured === true,
      },
      workBindings: bindings,
      uiAssets: canvasBuild.assets,
      uiSourceStatus: sourceStatus,
      uiBuild: buildIdentity,
      focus,
      boardGeneratedAt: board.generated_at || null,
      collaboration: board.collaboration || null,
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
      warnings: [...(board.warnings || []), ...(sessionResult.warnings || [])],
      sessionAssociations: associations,
      relatedSessions: related.map((session) => ({ ...session, statusLabel: session.status === 'unknown' ? 'Status not exposed by Copilot SDK' : session.status, appVisibilityLabel: session.appVisible === 'unverified' ? 'Copilot App visibility unverified' : undefined })),
      projectSessions: sessions.map((session) => ({ ...session, statusLabel: session.status === 'unknown' ? 'Status not exposed by Copilot SDK' : session.status, appVisibilityLabel: session.appVisible === 'unverified' ? 'Copilot App visibility unverified' : undefined })),
    };
  }

  async function selected(instance, ref) {
    await requireProject(instance);
    const normalized = safeRef(ref);
    const board = await runtime.listBoard(instance.projectPath);
    const record = findRecord(board, normalized);
    if (!record) throw new Error(`Record ${normalized} is not present in this project's Lanes board.`);
    return { board, record };
  }

  async function dispatch(instance, action, input = {}) {
    if (input.expectedProjectPath !== undefined && input.expectedProjectPath !== instance.projectPath) {
      throw new Error('The selected project changed before this action ran. Refresh and review the current project.');
    }
    // A concurrent project selection cannot retarget an in-flight record action.
    const snapshot = ['set_project', 'initialize_current_directory'].includes(action) ? instance : { ...instance };
    if (action === 'launch') {
      const { record } = await selected(snapshot, input.ref);
      if (record.kind === 'task') {
        const key = JSON.stringify([snapshot.userScope, snapshot.projectPath, record.ref]);
        if (taskLaunches.has(key)) throw new Error('Task launch is already pending. Wait for the existing request.');
        taskLaunches.add(key);
        try { return await dispatchInProject(snapshot, action, input); }
        finally { taskLaunches.delete(key); }
      }
    }
    return dispatchInProject(snapshot, action, input);
  }

  async function dispatchInProject(instance, action, input = {}) {
    if (!allowedActions.has(action)) throw new Error(`Unsupported canvas action: ${action}`);
    if (action === 'context') return { ...await projectContext(instance), instanceId: instance.instanceId, copilotSessionId: instance.sessionId };
    if (action === 'list_projects') return projectContext(instance);
    if (action === 'initialize_current_directory') {
      if (Object.keys(input).length) throw new Error('Current-directory initialization accepts no caller path, project, or other overrides.');
      const context = await projectContext(instance);
      if (!context.canInitializeCurrentDirectory) throw new Error(context.currentDirectoryError || 'The current session repository already has a Lanes store; it was not modified.');
      const target = context.currentDirectory;
      if (directoryInitializations.has(target)) throw new Error('Current-directory initialization is already pending.');
      directoryInitializations.add(target);
      try {
        if (!runtime.initializeProject) throw new Error('This runtime does not support minimal Lanes initialization. Reload the extension.');
        await runtime.initializeProject(target);
        const catalog = await projectDiscovery.discoverClipsProjects();
        if (catalog.userScope !== instance.userScope) throw new Error('The local Lanes user scope changed during initialization. Reopen the canvas.');
        const project = catalog.projects.find((candidate) => candidate.projectRoot === target);
        if (!project) throw new Error('Lanes initialized, but its project is not available in the registry. Review discovery diagnostics before selecting it.');
        const next = { ...instance, selectedProject: project, projectPath: target, selectionSource: 'saved', selectionError: null };
        const state = await buildState(next);
        await writeJson(projectPathFile(instance), { projectId: project.id, openInputPath: instance.openInputPath, updatedAt: new Date().toISOString() });
        Object.assign(instance, next);
        return { state, projectId: project.id };
      } finally { directoryInitializations.delete(target); }
    }
    if (action === 'diagnostics') return { ...await projectContext(instance), serviceSourceSha256: loadedSourceHash, projectPath: instance.projectPath, instanceId: instance.instanceId, copilotSessionId: instance.sessionId, uiAssets: canvasBuild.assets, uiSourceStatus: sourceStatus, uiBuild: buildIdentity, runtime: await runtime.diagnostics() };
    if (action === 'refresh') return buildState(instance);
    if (action === 'clear_focus') {
      await requireProject(instance);
      await writeJson(focusPath(instance), { ref: null, updatedAt: new Date().toISOString() });
      return { focus: null, state: await buildState(instance) };
    }
    if (action === 'set_project') {
      if (!input.projectId || input.projectPath !== undefined) throw new Error('Choose an exact discovered Lanes project ID; arbitrary paths are not accepted.');
      const catalog = await projectDiscovery.discoverClipsProjects();
      if (catalog.userScope !== instance.userScope) throw new Error('The local Lanes user scope changed. Reopen this canvas.');
      const project = await projectDiscovery.resolveClipsProject(input.projectId);
      const next = { ...instance, selectedProject: project, projectPath: project.projectRoot, selectionSource: 'saved', selectionError: null };
      // Validate the actual board and complete state before committing selection.
      const state = await buildState(next);
      await writeJson(projectPathFile(instance), { projectId: project.id, openInputPath: instance.openInputPath, updatedAt: new Date().toISOString() });
      Object.assign(instance, next);
      return state;
    }
    if (action === 'focus') {
      const ref = await saveFocus(instance, safeRef(input.ref));
      return { focus: ref, state: await buildState(instance) };
    }
    if (action === 'inspect') {
      const ref = safeRef(input.ref);
      await selected(instance, ref);
      return runtime.viewRecord(ref, instance.projectPath);
    }
    if (action === 'read_attachment') {
      if (Object.keys(input).some((key) => !['ref', 'attachmentId', 'expectedProjectPath'].includes(key))) {
        throw new Error('Attachment reads accept only the exact record reference and attachment ID.');
      }
      const ref = safeRef(input.ref);
      if (input.ref !== ref) throw new Error('Attachment reads require the exact current record reference.');
      const { record } = await selected(instance, ref);
      if (typeof input.attachmentId !== 'string') throw new Error('Provide an exact attached Markdown ID.');
      const attachment = (Array.isArray(record.attachments) ? record.attachments : [])
        .find((item) => item.id === input.attachmentId);
      if (!attachment) throw new Error(`Attachment ${input.attachmentId} is not associated with ${record.ref}.`);
      if (attachment.type !== 'markdown') throw new Error('Only Markdown attachments have readable file content.');
      if (!runtime.readAttachment) throw new Error('This runtime does not support live Markdown attachment reads. Reload the extension.');
      return runtime.readAttachment(record.ref, attachment.id, instance.projectPath);
    }
    if (action === 'set_collaboration') {
      if (Object.keys(input).some((key) => !['enabled', 'expectedProjectPath'].includes(key))) {
        throw new Error('Collaboration changes accept only an enabled boolean.');
      }
      if (typeof input.enabled !== 'boolean') throw new Error('Collaboration must be explicitly enabled or disabled.');
      if (!runtime.setCollaboration) throw new Error('This runtime does not support project-local collaboration settings. Reload the extension.');
      const projectPath = await requireProject(instance);
      const board = await runtime.listBoard(projectPath);
      const capability = board.collaboration;
      if (!capability || capability.enabled === null || capability.state === 'invalid') {
        throw new Error(capability?.error || 'The current project collaboration setting is unavailable.');
      }
      const result = await runtime.setCollaboration(input.enabled, projectPath);
      return { result, state: await buildState(instance) };
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
      await requireProject(instance);
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
      const result = await runtime.recordCommand(['task', 'create', parent.ref, JSON.stringify(data)], instance.projectPath);
      return { result, state: await buildState(instance) };
    }
    if (action === 'launch') {
      const capability = runtime.hostCapabilities ? await runtime.hostCapabilities() : null;
      if (capability?.canSendToCurrentSession !== true) throw new Error('Sending work requires a joined current session. This canvas does not create a new App session.');
      const { board, record } = await selected(instance, input.ref);
      if (record.kind === 'task') {
        if (!['open','in_progress'].includes(record.status)) throw new Error('This Task is not open for execution.');
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
      associateSession(instance.projectPath, record.ref, id);
      return { session: launched, state: await buildState(instance) };
    }
    if (action === 'steer' || action === 'open_session') {
      await requireProject(instance);
      const capability = runtime.hostCapabilities ? await runtime.hostCapabilities() : null;
      const id = String(input.sessionId || '').trim();
      const sessions = (await runtime.listSessions(instance.projectPath)).sessions || [];
      const session = sessions.find((candidate) => sessionId(candidate) === id);
      if (!session) throw new Error('That session is not in the current project session list. Refresh before opening or steering it.');
      if (action === 'open_session') return { sessionId: id, url: runtime.appSessionUrl(id), appVisibility: session.appVisible || 'unverified' };
      if (session.steerable !== true) throw new Error('This session is not joined here and its App steering has not been verified. Open its canvas to send a message through that session.');
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
        const html = loadedIndex
          .replaceAll('__TOKEN__', requestedInstance.token)
          .replaceAll('__INSTANCE_ID__', requestedInstance.instanceId);
        res.end(html);
        return;
      }
      const asset = loadedAssets.get(url.pathname);
      if (asset) {
        res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(asset[0]);
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
      const existing = instances.get(ctx.instanceId);
      if (existing && existing.sessionId !== ctx.sessionId) throw new Error('This canvas provider belongs to a different session.');
      if (existing) return { title: 'Lanes', url: `${origin}/canvas/index.html?instanceId=${encodeURIComponent(ctx.instanceId)}&token=${existing.token}` };
      const catalog = await projectDiscovery.discoverClipsProjects();
      const scope = { ...ctx, userScope: catalog.userScope };
      let persisted;
      try { persisted = await readJson(projectPathFile(scope), { projectId: null }); }
      catch { persisted = { invalid: true }; }
      const validSelection = persisted !== null && typeof persisted === 'object' && !Array.isArray(persisted) &&
        Object.hasOwn(persisted, 'projectId') && (persisted.projectId === null || (typeof persisted.projectId === 'string' && persisted.projectId.length > 0 && persisted.projectId.length <= 256)) &&
        (persisted.openInputPath === undefined || persisted.openInputPath === null || (typeof persisted.openInputPath === 'string' && persisted.openInputPath.length <= 4096 && path.isAbsolute(persisted.openInputPath))) &&
        (persisted.invalid === undefined || typeof persisted.invalid === 'boolean');
      if (!validSelection) persisted = { projectId: null, invalid: true };
      const openInputPath = input.projectPath ? path.resolve(input.projectPath) : null;
      let selectedProject;
      let selectionError;
      let selectionSource = 'unavailable';
      let current;
      let sessionDirectoryError;
      if (!ctx.session?.workingDirectory && runtime.currentSession) {
        try { current = await runtime.currentSession(); }
        catch (error) { sessionDirectoryError = `Current session directory readback failed: ${error.message}`; }
      }
      const sessionDirectory = ctx.session?.workingDirectory || current?.context?.workingDirectory || null;
      const explicitNewInput = openInputPath && openInputPath !== persisted.openInputPath;
      if (persisted.invalid) {
        selectionError = 'Saved Lanes project selection is invalid. Choose a project; no other board was substituted.';
      } else if (persisted.projectId && !explicitNewInput) {
        selectionSource = 'saved';
        selectedProject = catalog.projects.find((project) => project.id === persisted.projectId);
        if (!selectedProject) selectionError = 'Your selected Lanes project is no longer available. Choose a project; the session directory was not substituted.';
      } else {
        const sourcePath = openInputPath || sessionDirectory;
        if (sourcePath) {
          try {
            const absolutePath = path.resolve(sourcePath);
            const canonicalRoot = catalog.projects.some((project) => project.projectRoot === absolutePath) ? absolutePath : getRepoRoot(absolutePath);
            selectedProject = catalog.projects.find((project) => project.projectRoot === canonicalRoot);
          } catch { /* Default selection can use the first available project below. */ }
        }
        if (selectedProject) selectionSource = 'current_directory';
        else if (openInputPath) selectionError = 'The requested directory is not an available registered Lanes project. Choose a Lanes project.';
        else if (catalog.projects.length) { selectedProject = catalog.projects[0]; selectionSource = 'first_available'; }
        else selectionError = 'No available registered Lanes projects. Initialize Lanes in the current repository or choose a project after registration.';
      }
      const projectPath = selectedProject?.projectRoot || null;
      instances.set(ctx.instanceId, { instanceId: ctx.instanceId, sessionId: ctx.sessionId, sessionDirectory, sessionDirectoryError, userScope: catalog.userScope, selectedProject, selectionSource, selectionError, projectPath, openInputPath, token: randomBytes(32).toString('hex') });
      // Keep a missing persisted id intact: a later reopen must not silently use cwd.
      await writeJson(projectPathFile(scope), { projectId: selectedProject?.id || persisted.projectId || null, ...(persisted.invalid ? { invalid: true } : {}), openInputPath });
      await startServer();
      const instance = instances.get(ctx.instanceId);
      return { title: 'Lanes', url: `${origin}/canvas/index.html?instanceId=${encodeURIComponent(ctx.instanceId)}&token=${instance.token}` };
    },
    async close(ctx) { instances.delete(ctx.instanceId); },
    async action(ctx) {
      const instance = instances.get(ctx.instanceId);
      if (!instance) throw new Error('Open Lanes in this canvas instance first.');
      if (ctx.sessionId && ctx.sessionId !== instance.sessionId) throw new Error('Canvas action belongs to a different session.');
      return dispatch(instance, ctx.actionName, ctx.input || {});
    },
    async dispatch(instanceId, action, input) {
      const instance = instances.get(instanceId);
      if (!instance) throw new Error('Open Lanes in this canvas instance first.');
      return dispatch(instance, action, input);
    },
    async state(instanceId) {
      const instance = instances.get(instanceId);
      if (!instance) throw new Error('Open Lanes in this canvas instance first.');
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
