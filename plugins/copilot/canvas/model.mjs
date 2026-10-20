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
    'Use the canonical Clips CLI and record store. Read the record and blockers before acting. This message uses the current joined Copilot session; joining does not prove native App visibility or top-level parentage. Report concrete results and checks without claiming unperformed runtime or visual verification.',
    kind === 'lane' ? 'Coordinate the Lane and delegate complete outcomes to actual user-visible, steerable App sessions. Coordinated child sessions are supported through the native App tools; keep them attached and maintain parent communication. Host identity, claims and earlier work associations are advisory, not permission gates. Do not create a claim merely to begin planning.' : 'Own the requested engineering outcome and its verification. Follow the current user authorization and the canonical Clips task contracts.',
  ].filter(Boolean).join('\n\n');
}

// Sessions and saved bindings must already be scoped to the selected project.
export function sessionAssociations(record, sessions = [], bindings = {}) {
  const observed = new Map(sessions.map((session) => [session.id || session.sessionId, session]));
  const associations = new Map();
  function add(id, source) {
    if (typeof id !== 'string' || !id) return;
    if (!associations.has(id)) associations.set(id, { sessionId: id, sources: [], session: observed.get(id) || null });
    const entry = associations.get(id);
    if (!entry.sources.includes(source)) entry.sources.push(source);
  }
  for (const id of bindings[record.ref] || []) add(id, 'saved_binding');
  for (const session of sessions) {
    if (session.recordRef === record.ref) add(session.id || session.sessionId, 'record_ref');
  }
  if (record.kind === 'lane') {
    for (const owner of record.manager_claim?.owners || []) {
      if (owner.runtime === 'copilot-sdk') add(owner.session_id, 'manager_claim');
    }
  }
  return [...associations.values()];
}

export function relatedSessions(record, sessions = [], bindings = {}) {
  return sessionAssociations(record, sessions, bindings).flatMap(({ session }) => session ? [session] : []);
}

export function isOngoingSession(session) {
  return session?.status === 'running' || session?.status === 'attention';
}

export function sessionName(session) {
  const name = typeof session.name === 'string' ? session.name.trim() : '';
  return name && !/[\r\n\u0085\u2028\u2029]/.test(name) ? name : (session.joined ? 'Current session' : 'Copilot session');
}

export function associationLabel(sources) {
  return sources.map((source) => ({ saved_binding: 'Saved work association', record_ref: 'Session record reference', manager_claim: 'Manager claim' })[source]).join(' + ');
}

export function isLongDescription(text = '') {
  return String(text).trim().length > 220 || String(text).split(/\r?\n/).length > 3;
}
