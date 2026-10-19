import { createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { createClipsRuntime } from './runtime/index.mjs';
import { createCanvasService } from './canvas/service.mjs';

let joinedSessionPromise;
let canvasServicePromise;
const diagnostics = new Map();
function diagnostic(event) {
  const key = `${event.event}:${event.instanceId || event.sessionId || ''}`;
  const message = JSON.stringify(event);
  if (diagnostics.get(key) === message) return;
  diagnostics.set(key, message);
  process.stderr.write(`[clips] ${message}\n`);
}

async function getCanvasService() {
  if (!canvasServicePromise) {
    canvasServicePromise = joinedSessionPromise.then(async (joinedSession) => {
      const runtime = await createClipsRuntime({ hostSession: joinedSession, onDiagnostic: diagnostic });
      return { runtime, service: createCanvasService({ runtime, onDiagnostic: diagnostic }) };
    });
  }
  return canvasServicePromise;
}

const stringField = (description) => ({ type: 'string', description });
const refInput = {
  type: 'object',
  properties: { ref: stringField('Exact Clips Lane, Goal, or Task reference, such as #l001 or #g001#t01.') },
  required: ['ref'],
};

const canvas = createCanvas({
  id: 'clips-work',
  displayName: 'Clips Work',
  description: 'Browse and operate canonical Clips Lanes, Goals, and Tasks, coordinate Lane managers, and navigate to steerable Copilot sessions.',
  inputSchema: {
    type: 'object',
    properties: { projectPath: stringField('Optional local repository path when the Copilot session has no working directory.') },
  },
  actions: [
    { name: 'clear_clips_focus', description: 'Return this canvas to the Lane board and retain that explicit Back selection on reload.', inputSchema: { type: 'object', properties: {} }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'clear_focus' }) },
    { name: 'inspect_clips_runtime', description: 'Read loaded provider source identity, interpreter, selected project, and current session metadata without changing settings.', inputSchema: { type: 'object', properties: {} }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'diagnostics' }) },
    { name: 'list_clips_projects', description: 'List this local user’s available canonical Clips projects and discovery diagnostics without changing the selected project. Use a returned project ID with select_clips_project.', inputSchema: { type: 'object', properties: {} }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'list_projects' }) },
    { name: 'select_clips_project', description: 'Choose an exact project returned by list_clips_projects for this panel without changing the session working directory. Stale or unavailable selections fail without substituting another project.', inputSchema: { type: 'object', properties: { projectId: stringField('Exact opaque project ID returned by list_clips_projects.') }, required: ['projectId'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'set_project' }) },
    { name: 'refresh_clips_board', description: 'Read the canonical Clips board and current canvas focus.', inputSchema: { type: 'object', properties: {} }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'refresh' }) },
    { name: 'focus_clips_record', description: 'Focus one Lane, Goal, or Task in this open canvas. Focus is private to its Copilot canvas instance.', inputSchema: refInput, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'focus' }) },
    { name: 'inspect_clips_record', description: 'Read the full canonical record for a Lane, Goal, or Task.', inputSchema: refInput, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'inspect' }) },
    { name: 'set_clips_status', description: 'Set the lifecycle status of a Lane, Goal, or Task through the Clips CLI. Closing a Goal or Task is administrative and does not record technical acceptance; Lane closure uses the separate retrospective command.', inputSchema: { type: 'object', properties: { ref: stringField('Exact record reference.'), status: { type: 'string', enum: ['open', 'in_progress', 'closed', 'not_planned', 'duplicate'] } }, required: ['ref', 'status'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'set_status' }) },
    { name: 'add_clips_label', description: 'Assign an existing project label to a Lane, Goal, or Task.', inputSchema: { type: 'object', properties: { ref: stringField('Exact record reference.'), labelId: stringField('Existing project label ID.') }, required: ['ref', 'labelId'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'add_label' }) },
    { name: 'remove_clips_label', description: 'Remove an assigned project label from a Lane, Goal, or Task.', inputSchema: { type: 'object', properties: { ref: stringField('Exact record reference.'), labelId: stringField('Assigned project label ID.') }, required: ['ref', 'labelId'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'remove_label' }) },
    { name: 'create_clips_lane', description: 'Create a Lane in the canonical Clips store.', inputSchema: { type: 'object', properties: { title: stringField('Lane title.'), description: stringField('Why this strategic Lane exists.') }, required: ['title'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'create_lane' }) },
    { name: 'create_clips_goal', description: 'Create a Goal in the canonical Clips store, optionally assigned to a Lane.', inputSchema: { type: 'object', properties: { title: stringField('Goal title.'), description: stringField('Goal description.'), lane_id: stringField('Optional Lane reference.') }, required: ['title'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'create_goal' }) },
    { name: 'create_clips_task', description: 'Create a Task beneath an existing Goal in the canonical Clips store. Include observable acceptance criteria so the work is independently reviewable.', inputSchema: { type: 'object', properties: { title: stringField('Task title.'), description: stringField('Task request.'), goal_ref: stringField('Parent Goal reference.'), acceptance_criteria: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 1000 } } }, required: ['title', 'goal_ref', 'acceptance_criteria'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'create_task' }) },
    { name: 'start_clips_work', description: 'Send work to the current joined Copilot session; this does not create another session or establish top-level parentage. Lane sessions claim management before the prompt is sent; existing owners are never displaced.', inputSchema: refInput, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'launch' }) },
    { name: 'open_copilot_session', description: 'Open a real listed Copilot SDK session using its supported GitHub Copilot App deep link. App visibility may remain unverified.', inputSchema: { type: 'object', properties: { sessionId: stringField('Exact Copilot SDK session ID.') }, required: ['sessionId'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'open_session' }) },
    { name: 'steer_copilot_session', description: 'Send a message through the current joined session handle. Other sessions are navigation-only.', inputSchema: { type: 'object', properties: { sessionId: stringField('Exact Copilot SDK session ID.'), prompt: stringField('Message to send.') }, required: ['sessionId', 'prompt'] }, handler: async (ctx) => (await getCanvasService()).service.action({ ...ctx, actionName: 'steer' }) },
  ],
  open: async (ctx) => (await getCanvasService()).service.open(ctx),
  onClose: async (ctx) => (await getCanvasService()).service.close(ctx),
});

joinedSessionPromise = joinSession({ canvases: [canvas] });
const session = await joinedSessionPromise;
session.log('Clips Work canvas connected. Copilot SDK canvas support is experimental; App visibility and running/idle status are not inferred.', { level: 'info', ephemeral: true });

let stopping;
async function shutdown() {
  if (stopping) return stopping;
  stopping = getCanvasService().then(({ service, runtime }) => Promise.allSettled([service.shutdown(), runtime.close?.()]));
  await stopping;
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
