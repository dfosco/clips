import test from 'node:test';
import assert from 'node:assert/strict';
import { goalsForLane, laneForFocus, goalGroup, executionFor } from './board-view.mjs';
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
