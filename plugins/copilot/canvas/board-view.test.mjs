import test from 'node:test';
import assert from 'node:assert/strict';
import { goalsForLane, laneForFocus, goalGroup, executionFor, sessionsFor } from './board-view.mjs';
import { lane, goal, task, state } from './test-harness.mjs';
test('exact Lane refs prevent username collisions and normalize legacy Goal/Task focus', () => {
  assert.deepEqual(goalsForLane(lane, [goal, { ...goal, ref: '#bob#g001' }]).map((g) => g.ref), [goal.ref]);
  assert.equal(laneForFocus({ ...state(), focus: task.ref }).ref, lane.ref);
});
test('Open retains closed-only Lane/unassigned reveal and descendant search ancestors', () => {
  const execution = () => ({ status: 'none' });
  const closed = { ...goal, status: 'closed' };
  assert.equal(goalGroup(lane, [closed], 'open', '', false, execution).showLane, true);
  assert.equal(goalGroup(null, [closed], 'open', '', false, execution).canRevealClosed, true);
  assert.equal(goalGroup(lane, [goal], 'open', 'needle', false, execution).entries[0].tasks[0].ref, task.ref);
  for (const status of ['not_planned','duplicate']) assert.equal(goalGroup(lane, [{ ...goal, tasks: [], status }], 'open', '', false, execution).entries.length, 0);
});
test('record lifecycle and unknown catalog never imply observed Running', () => {
  const s = state(); s.goals[0].status = 'in_progress';
  assert.equal(executionFor(goal, s).status, 'none');
  s.projectSessions.push({ id: 's', recordRef: goal.ref, status: 'unknown' });
  assert.equal(executionFor(goal, s).status, 'unknown');
  s.projectSessions.find((session) => session.id === 's').status = 'running'; assert.equal(executionFor(goal, s).status, 'running');
});

test('Board association projection retains saved work, claims, and exact reference scope', () => {
  const s = state();
  const record = { ...lane, kind: 'lane', manager_claim: { owners: [{ runtime: 'copilot-sdk', session_id: 'manager' }] } };
  s.workBindings = { [lane.ref]: ['joined', 'joined', 'missing'], '#bob#l001': ['sibling'] };
  s.projectSessions.push({ id: 'manager', status: 'unknown' }, { id: 'sibling', status: 'running' });
  assert.deepEqual(sessionsFor(record, s).map((session) => session.id), ['joined', 'manager']);
  assert.equal(executionFor(record, s).status, 'unknown');
  s.projectSessions = [];
  const unavailable = executionFor(record, s);
  assert.equal(unavailable.status, 'unavailable');
  assert.deepEqual(unavailable.sessions, []);
  assert.equal(unavailable.associations.length, 3);
  assert.equal(executionFor({ ...record, manager_claim: null }, { ...s, workBindings: {} }).status, 'none');
});
