import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecord, flattenRecords, focusOutline, isLongDescription, recordPrompt, relatedSessions } from './model.mjs';

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
  assert.match(prompt, /top-level work session/);
});

test('long-description rule keeps small and empty text simple', () => {
  assert.equal(isLongDescription('A short paragraph.'), false);
  assert.equal(isLongDescription('line one\nline two\nline three\nline four'), true);
  assert.equal(isLongDescription('x'.repeat(221)), true);
});
