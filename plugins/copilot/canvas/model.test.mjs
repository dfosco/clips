import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecord, flattenRecords, focusOutline, isLongDescription, isOngoingSession, recordPrompt, relatedSessions, sessionAssociations, sessionName } from './model.mjs';

const board = {
  lanes: [{ ref: '#l001', lane_id: 'l001', title: 'Product', description: 'Strategic context', manager_claim: { owners: [{ runtime: 'copilot-sdk', session_id: 'manager-1' }] } }],
  goals: [{ ref: '#g001', goal_id: 'g001', lane_id: 'l001', title: 'Improve board', description: 'Goal context', tasks: [
    { ref: '#g001#t01', task_id: 't01', goal_id: 'g001', goal_ref: '#g001', goal_title: 'Improve board', title: 'Build UI', description: 'Task context' },
  ] }],
};

test('record navigation flattens Lane, Goal, and Task references without changing identity', () => {
  assert.deepEqual(flattenRecords(board).map((record) => record.ref), ['#l001', '#g001', '#g001#t01']);
  assert.equal(findRecord(board, '#g001#t01').goal_ref, '#g001');
  assert.equal(focusOutline(board, '#l001').goals[0].ref, '#g001');
  assert.equal(focusOutline(board, '#g001').tasks[0].ref, '#g001#t01');
  assert.equal(focusOutline(board, '#g001#t01').tasks.length, 0, 'sibling Tasks stay collapsed when a Goal is not focused');
});

test('session attribution uses exact launch binding or durable Lane owner IDs only', () => {
  const sessions = [{ id: 'manager-1' }, { id: 'goal-1' }, { id: 'sibling' }];
  assert.deepEqual(relatedSessions({ ...board.lanes[0], kind: 'lane' }, sessions), [sessions[0]]);
  assert.deepEqual(relatedSessions({ ref: '#g001', kind: 'goal' }, sessions, { '#g001': ['goal-1'] }), [sessions[1]]);
  assert.deepEqual(relatedSessions({ ref: '#g001', kind: 'goal' }, sessions), [], 'project siblings are not attributed to a record');
  assert.deepEqual(relatedSessions({ ref: '#g001', kind: 'goal' }, [{ id: 'exact', recordRef: '#g001' }]), [{ id: 'exact', recordRef: '#g001' }]);
});

test('launch prompt keeps record and parent context explicit', () => {
  const prompt = recordPrompt({ ...board.goals[0].tasks[0], kind: 'task' }, { lane: board.lanes[0] });
  assert.match(prompt, /Task #g001#t01/);
  assert.match(prompt, /Parent Goal: #g001/);
  assert.match(prompt, /Strategic Lane: #l001/);
  assert.match(prompt, /does not prove native App visibility or top-level parentage/);
  const lanePrompt = recordPrompt({ ...board.lanes[0], kind: 'lane' });
  assert.match(lanePrompt, /Coordinated child sessions are supported/);
  assert.match(lanePrompt, /advisory, not permission gates/);
  assert.doesNotMatch(lanePrompt, /separately verified top-level/);
});

test('association provenance deduplicates exact IDs and preserves unavailable metadata without inventing sessions', () => {
  const record = { ...board.lanes[0], kind: 'lane', manager_claim: { owners: [
    { runtime: 'copilot-sdk', session_id: 'manager-1' },
    { runtime: 'copilot-sdk', session_id: 'unavailable' },
    { runtime: 'paseo', session_id: 'other-host' },
  ] } };
  const sessions = [
    { id: 'manager-1', recordRef: record.ref, status: 'unknown', name: 'Security migration plans' },
    { sessionId: 'worker', recordRef: '#alice#g001', status: 'idle' },
    { id: 'sibling', summary: 'Lane #l001', status: 'running' },
  ];
  const bindings = { [record.ref]: ['manager-1', 'manager-1', 'worker', 'missing-binding'], '#bob#l001': ['sibling'] };
  const before = JSON.stringify({ record, sessions, bindings });
  const result = sessionAssociations(record, sessions, bindings);
  assert.deepEqual(result.map(({ sessionId }) => sessionId), ['manager-1', 'worker', 'missing-binding', 'unavailable']);
  assert.deepEqual(result[0].sources, ['saved_binding', 'record_ref', 'manager_claim']);
  assert.equal(result[0].session.status, 'unknown');
  assert.deepEqual(result[2], { sessionId: 'missing-binding', sources: ['saved_binding'], session: null });
  assert.deepEqual(result[3], { sessionId: 'unavailable', sources: ['manager_claim'], session: null });
  assert.deepEqual(relatedSessions(record, sessions, bindings), sessions.slice(0, 2));
  assert.equal(JSON.stringify({ record, sessions, bindings }), before);
  assert.equal(sessionName(sessions[0]), 'Security migration plans');
  assert.equal(sessionName(sessions[1]), 'Copilot session');
});

test('session titles use explicit names, never prompt summaries or raw IDs', () => {
  const summary = 'You are the ordinary dev execution owner for canonical Clips Goal #g001. Read the full instructions before acting.';
  assert.equal(sessionName({ id: 'raw-uuid', name: 'Security migration plans', summary }), 'Security migration plans');
  assert.equal(sessionName({ id: 'raw-uuid', name: '  Named session  ', summary }), 'Named session');
  assert.equal(sessionName({ id: 'raw-uuid', summary }), 'Copilot session');
  assert.equal(sessionName({ sessionId: 'raw-uuid', summary: 'Even a short prompt' }), 'Copilot session');
  assert.equal(sessionName({ id: 'raw-uuid', joined: true, summary }), 'Current session');
  assert.equal(sessionName({ id: 'raw-uuid', name: `${summary}\n\nMore kickoff instructions`, summary }), 'Copilot session');
  assert.equal(sessionName({ id: 'raw-uuid', joined: true, name: `${summary}\n\nMore kickoff instructions`, summary }), 'Current session');
});

test('long-description rule keeps small and empty text simple', () => {
  assert.equal(isLongDescription('A short paragraph.'), false);
  assert.equal(isLongDescription('line one\nline two\nline three\nline four'), true);
  assert.equal(isLongDescription('x'.repeat(221)), true);
});

test('ongoing navigation needs observed active work, not an old binding or a listed session alone', () => {
  for (const status of ['running', 'attention', 'idle', 'error', 'unknown', 'closed', 'ended', undefined]) {
    assert.equal(isOngoingSession({ id: 'known', status }), ['running', 'attention'].includes(status), String(status));
  }
  assert.equal(isOngoingSession(null), false);
  assert.equal(isOngoingSession(undefined), false);
  const record = { ref: '#g001', kind: 'goal' };
  const associations = sessionAssociations(record, [{ id: 'old', status: 'idle' }, { id: 'live', status: 'running', recordRef: '#g001' }], { '#g001': ['old', 'missing'] });
  assert.deepEqual(associations.filter(({ session }) => isOngoingSession(session)).map(({ sessionId }) => sessionId), ['live']);
  assert.deepEqual(associations.map(({ sessionId }) => sessionId), ['old', 'missing', 'live'], 'historical attribution stays intact');
});
