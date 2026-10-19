export const RECORD_STATUSES = new Set(['open', 'in_progress', 'closed', 'not_planned', 'duplicate']);

export function flattenRecords(board = {}) {
  const records = [];
  for (const lane of board.lanes || []) records.push({ ...lane, kind: 'lane' });
  for (const goal of board.goals || []) {
    records.push({ ...goal, kind: 'goal' });
    for (const task of goal.tasks || []) records.push({ ...task, kind: 'task', goal_ref: goal.ref, goal_title: goal.title });
  }
  return records;
}

export function findRecord(board, ref) {
  return flattenRecords(board).find((record) => record.ref === ref) || null;
}

export function focusOutline(board, focusedRef) {
  const lane = (board.lanes || []).find((item) => item.ref === focusedRef);
  if (lane) return { kind: 'lane', record: lane, goals: (board.goals || []).filter((goal) => goal.lane_id === lane.lane_id), tasks: [] };
  const goal = (board.goals || []).find((item) => item.ref === focusedRef);
  if (goal) return { kind: 'goal', record: goal, goals: [], tasks: goal.tasks || [] };
  const task = (board.goals || []).flatMap((goal) => goal.tasks || []).find((item) => item.ref === focusedRef);
  if (task) return { kind: 'task', record: task, goals: [], tasks: [] };
  return null;
}

export function recordPrompt(record, context = {}) {
  const kind = record.kind || (record.lane_id ? 'goal' : record.task_id ? 'task' : 'lane');
  const displayKind = `${kind[0].toUpperCase()}${kind.slice(1)}`;
  const title = record.title || record.lane_id || record.goal_id || record.task_id || record.ref;
  const description = record.description || '';
  const parent = kind === 'task' ? `Parent Goal: ${record.goal_ref || '(unknown)'} — ${record.goal_title || ''}\n` : '';
  return [
    `Work on ${displayKind} ${record.ref}: ${title}.`,
    parent.trim(),
    description ? `Description:\n${description}` : '',
    context.lane ? `Strategic Lane: ${context.lane.ref} — ${context.lane.title}` : '',
    'Use the canonical Clips CLI and record store. Read the record and blockers before acting. Keep this Copilot App session as the steerable top-level work session. Report concrete implementation, checks, and any blocked behavior; do not claim runtime or visual checks that were not performed.',
  ].filter(Boolean).join('\n\n');
}

export function relatedSessions(record, sessions = [], bindings = {}) {
  const exactIds = new Set(bindings[record.ref] || []);
  for (const session of sessions) {
    if (session.recordRef === record.ref && (session.id || session.sessionId)) exactIds.add(session.id || session.sessionId);
  }
  if (record.kind === 'lane') {
    for (const owner of record.manager_claim?.owners || []) {
      if (owner.runtime === 'copilot-sdk') exactIds.add(owner.session_id);
    }
  }
  return sessions.filter((session) => exactIds.has(session.id || session.sessionId));
}

export function isLongDescription(text = '') {
  return String(text).trim().length > 220 || String(text).split(/\r?\n/).length > 3;
}
