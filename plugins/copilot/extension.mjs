import { createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { createClipsRuntime } from './runtime/index.mjs';
import { createCanvasService } from './canvas/service.mjs';

const runtime = await createClipsRuntime();
const canvasService = createCanvasService({ runtime });

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
    { name: 'refresh_clips_board', description: 'Read the canonical Clips board and current canvas focus.', inputSchema: { type: 'object', properties: {} }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'refresh' }) },
    { name: 'focus_clips_record', description: 'Focus one Lane, Goal, or Task in this open canvas. Focus is private to its Copilot canvas instance.', inputSchema: refInput, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'focus' }) },
    { name: 'inspect_clips_record', description: 'Read the full canonical record for a Lane, Goal, or Task.', inputSchema: refInput, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'inspect' }) },
    { name: 'set_clips_status', description: 'Set the lifecycle status of a Lane, Goal, or Task through the Clips CLI. Closing a Goal or Task is administrative and does not record technical acceptance; Lane closure uses the separate retrospective command.', inputSchema: { type: 'object', properties: { ref: stringField('Exact record reference.'), status: { type: 'string', enum: ['open', 'in_progress', 'closed', 'not_planned', 'duplicate'] } }, required: ['ref', 'status'] }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'set_status' }) },
    { name: 'add_clips_label', description: 'Assign an existing project label to a Lane, Goal, or Task.', inputSchema: { type: 'object', properties: { ref: stringField('Exact record reference.'), labelId: stringField('Existing project label ID.') }, required: ['ref', 'labelId'] }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'add_label' }) },
    { name: 'remove_clips_label', description: 'Remove an assigned project label from a Lane, Goal, or Task.', inputSchema: { type: 'object', properties: { ref: stringField('Exact record reference.'), labelId: stringField('Assigned project label ID.') }, required: ['ref', 'labelId'] }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'remove_label' }) },
    { name: 'create_clips_lane', description: 'Create a Lane in the canonical Clips store.', inputSchema: { type: 'object', properties: { title: stringField('Lane title.'), description: stringField('Why this strategic Lane exists.') }, required: ['title'] }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'create_lane' }) },
    { name: 'create_clips_goal', description: 'Create a Goal in the canonical Clips store, optionally assigned to a Lane.', inputSchema: { type: 'object', properties: { title: stringField('Goal title.'), description: stringField('Goal description.'), lane_id: stringField('Optional Lane reference.') }, required: ['title'] }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'create_goal' }) },
    { name: 'create_clips_task', description: 'Create a Task beneath an existing Goal in the canonical Clips store. Include observable acceptance criteria so the work is independently reviewable.', inputSchema: { type: 'object', properties: { title: stringField('Task title.'), description: stringField('Task request.'), goal_ref: stringField('Parent Goal reference.'), acceptance_criteria: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1, maxLength: 1000 } } }, required: ['title', 'goal_ref', 'acceptance_criteria'] }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'create_task' }) },
    { name: 'start_clips_work', description: 'Start a steerable Copilot SDK session for a Lane, Goal, or Task. Lane sessions claim management before the prompt is sent; existing owners are never displaced.', inputSchema: refInput, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'launch' }) },
    { name: 'open_copilot_session', description: 'Open a real listed Copilot SDK session using its supported GitHub Copilot App deep link. App visibility may remain unverified.', inputSchema: { type: 'object', properties: { sessionId: stringField('Exact Copilot SDK session ID.') }, required: ['sessionId'] }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'open_session' }) },
    { name: 'steer_copilot_session', description: 'Send a message to an exact real Copilot SDK session listed for this project.', inputSchema: { type: 'object', properties: { sessionId: stringField('Exact Copilot SDK session ID.'), prompt: stringField('Message to send.') }, required: ['sessionId', 'prompt'] }, handler: (ctx) => canvasService.action({ ...ctx, actionName: 'steer' }) },
  ],
  open: (ctx) => canvasService.open(ctx),
  onClose: (ctx) => canvasService.close(ctx),
});

const session = await joinSession({ canvases: [canvas] });
session.log('Clips Work canvas connected. Copilot SDK canvas support is experimental; App visibility and running/idle status are not inferred.', { level: 'info', ephemeral: true });

let stopping;
async function shutdown() {
  if (stopping) return stopping;
  stopping = Promise.allSettled([canvasService.shutdown(), runtime.close?.()]);
  await stopping;
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
