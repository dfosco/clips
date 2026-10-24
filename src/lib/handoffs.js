import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  appendEvent, formatRef, getClipsDbDir, getClipsRecordsDir, getGoalFilePath,
  getRepoRoot, parseRef, readGoalHistory, readGoalWithTasks,
} from './core.js';
import { normalizeAttachmentInput, readRecordAttachment } from './attachments.js';
import { withRecordLock } from './journal.js';
import { isPlainObject } from './work-fields.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONS = new Set(['completed', 'resource_warning', 'resource_critical', 'reassignment']);
const EMERGENCY_CONTEXT = 'No developer context was available before emergency retirement. This handoff is incomplete. Inspect the preserved worktree, session transcript and Goal/Task records before resuming unfinished work.';

function normalizeInput(input) {
  if (!isPlainObject(input)) throw new Error('Handoff input must be a JSON object');
  const fields = new Set(['context', 'agent_id', 'manager_id', 'reason', 'incomplete', 'handoff_id']);
  const unsupported = Object.keys(input).filter((key) => !fields.has(key));
  if (unsupported.length) throw new Error(`Unsupported handoff fields: ${unsupported.join(', ')}`);
  const identity = (name) => {
    if (typeof input[name] !== 'string' || !input[name].trim() || /[\x00-\x1f\x7f]/.test(input[name])) {
      throw new Error(`${name} must be a non-empty identity without control characters`);
    }
    return input[name].trim();
  };
  const agent_id = identity('agent_id'), manager_id = identity('manager_id');
  const reason = input.reason === undefined ? 'completed' : input.reason;
  if (!REASONS.has(reason)) throw new Error(`reason must be one of: ${[...REASONS].join(', ')}`);
  if (input.incomplete !== undefined && typeof input.incomplete !== 'boolean') {
    throw new Error('incomplete must be a boolean');
  }
  const incomplete = input.incomplete ?? false;
  if (typeof input.context !== 'string') throw new Error('context must be a string');
  if (!input.context.trim() && !(reason === 'resource_critical' && incomplete)) {
    throw new Error('context must be non-empty unless reason is resource_critical and incomplete is true');
  }
  const handoff_id = input.handoff_id === undefined ? randomUUID() : input.handoff_id;
  if (typeof handoff_id !== 'string' || !UUID.test(handoff_id)) throw new Error('handoff_id must be a UUID');
  return { handoff_id: handoff_id.toLowerCase(), agent_id, manager_id, reason, incomplete,
    context: input.context.trim() ? input.context : EMERGENCY_CONTEXT };
}

function resolveTarget(ref) {
  const parsed = parseRef(ref);
  if (!parsed?.goalId || parsed.componentId || parsed.criterionId || parsed.revision !== undefined) {
    throw new Error('Handoffs require a current Goal or Task reference: #g1 or #g1#t1');
  }
  const file = getGoalFilePath(parsed.goalId, parsed.username);
  const relative = path.relative(getClipsDbDir(), file).split(path.sep);
  // Qualify implicit current-user references too, so a returned handoff can be
  // read by a manager with a different configured namespace.
  if (relative.length > 2 || relative.some((part) => part === '..') ||
      relative.at(-1) !== `${parsed.goalId}.jsonl` ||
      (relative.length === 2 && !/^[a-z0-9_-]+$/i.test(relative[0]))) {
    throw new Error('The Goal reference resolves outside the canonical Lanes journal directory');
  }
  const username = relative.length === 2 ? relative[0] : null;
  const goal = readGoalWithTasks(parsed.goalId, username);
  if (!goal) throw new Error(`Goal ${formatRef({ username, goalId: parsed.goalId })} not found`);
  if (parsed.taskId && !goal.tasks[parsed.taskId]) throw new Error(`Task ${formatRef({ ...parsed, username })} not found`);
  return {
    goal, username, file,
    goalRef: formatRef({ username, goalId: parsed.goalId }),
    sourceRef: formatRef({ username, goalId: parsed.goalId, taskId: parsed.taskId }),
  };
}

function exists(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function handoffDirectory(repoRoot) {
  const directory = getClipsRecordsDir('handoffs', repoRoot);
  for (const entry of [path.dirname(directory), directory]) {
    const state = exists(entry);
    if (state && (!state.isDirectory() || state.isSymbolicLink())) {
      throw new Error(`Handoff storage must be an ordinary directory: ${entry}`);
    }
    if (!state) fs.mkdirSync(entry);
  }
  return directory;
}

function documentFor(target, input) {
  const metadata = {
    handoff_id: input.handoff_id, goal_ref: target.goalRef, source_ref: target.sourceRef,
    agent_id: input.agent_id, manager_id: input.manager_id,
    reason: input.reason, incomplete: input.incomplete,
  };
  return `# Developer handoff\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n\n` +
    (input.incomplete ? '> Incomplete handoff. Do not treat this note as completed work or acceptance evidence.\n\n' : '') +
    `## Context\n\n${input.context}\n`;
}

function persistDocument(file, document) {
  const state = exists(file);
  if (state) {
    if (!state.isFile() || state.isSymbolicLink()) throw new Error('Handoff artifact must be an ordinary Markdown file');
    if (fs.readFileSync(file, 'utf8') !== document) {
      throw new Error('handoff_id already identifies different content or a changed artifact; use a new handoff_id');
    }
    return;
  }
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, document, 'utf8');
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Failed creation is not a durable handoff. Do not leave a partial artifact
    // that would prevent a retry with the caller's idempotency key.
    fs.closeSync(descriptor);
    fs.unlinkSync(file);
    throw error;
  }
  fs.closeSync(descriptor);
}

/** Persists context and a normal Goal attachment; never changes runtime/status. */
export function recordHandoff(ref, input) {
  const normalized = normalizeInput(input);
  const initial = resolveTarget(ref);
  const repoRoot = getRepoRoot();
  const file = path.join(handoffDirectory(repoRoot), `${normalized.handoff_id}.md`);
  return withRecordLock(file, () => {
    const target = resolveTarget(initial.sourceRef);
    if (target.file !== initial.file) throw new Error('Goal namespace changed while recording the handoff; reread the current reference');
    const document = documentFor(target, normalized);
    const { attachment: metadata } = normalizeAttachmentInput({
      type: 'markdown', path: file,
      title: `Developer handoff ${target.sourceRef} (${normalized.reason})`,
    }, { repoRoot });
    const attachment = { id: `att-${normalized.handoff_id}`, ...metadata };
    const existing = (target.goal.attachments || []).find((item) => item.id === attachment.id);
    if (existing && !isDeepStrictEqual(existing, attachment)) throw new Error('handoff_id conflicts with an existing Goal attachment');
    if (existing && !exists(file)) throw new Error('The attached handoff artifact is missing; restore it explicitly or record a new handoff');
    if (!existing && readGoalHistory(target.goal.goal_id, target.username)?.some((event) =>
      event.event === 'attachment_added' && event.attachment?.id === attachment.id)) {
      throw new Error('This handoff was previously detached; use a new handoff_id to create a new association');
    }
    persistDocument(file, document);
    if (!existing) {
      try {
        appendEvent(target.goal.goal_id, {
          event: 'attachment_added', goal_id: target.goal.goal_id,
          timestamp: new Date().toISOString(), attachment,
        }, { username: target.username, expectedRevision: target.goal.revision });
      } catch (error) {
        throw new Error(`Handoff ${normalized.handoff_id} was saved at ${attachment.path} but could not be attached to ${target.goalRef}: ${error.message}. Retry with the same handoff_id.`);
      }
    }
    const observed = readGoalWithTasks(target.goal.goal_id, target.username);
    const attached = observed?.attachments?.find((item) => item.id === attachment.id);
    if (!isDeepStrictEqual(attached, attachment)) throw new Error('Handoff attachment could not be verified after writing; retry with the same handoff_id');
    const readback = readRecordAttachment(observed, attachment.id, { repoRoot });
    if (readback.status !== 'available' || readback.content !== document) {
      throw new Error('Handoff content could not be verified through its Goal attachment; retry with the same handoff_id');
    }
    return {
      success: true, handoff_id: normalized.handoff_id,
      goal_ref: target.goalRef, source_ref: target.sourceRef, attachment,
      context: normalized.context, incomplete: normalized.incomplete,
    };
  });
}
