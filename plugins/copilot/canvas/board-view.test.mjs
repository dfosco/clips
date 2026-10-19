import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createBoardView, executionFor, goalGroup, goalsForLane, laneForFocus, renderBoard } from './board-view.mjs';
const task = { ref: '#alice#g001#t01', task_id: 't01', title: 'Exact needle task', description: 'Task description', status: 'open', labels: [{ name: 'urgent' }] };
const goal = { ref: '#alice#g001', goal_id: 'g001', title: 'Goal one', description: 'Goal context', status: 'open', tasks: [task], acceptance_criteria: [{ id: 'A1', description: 'Observable result' }] };
const closed = { ...goal, ref: '#alice#g002', title: 'Closed Goal', status: 'closed', tasks: [] };
const lane = { ref: '#l001', lane_id: 'l001', title: 'Lane one', description: 'Lane description', status: 'open', goal_refs: [goal.ref, closed.ref], manager_claim: { owners: [] } };
function state() { return { projectPath: '/repo', focus: null, lanes: [lane], goals: [goal, closed], projectSessions: [], hostCapabilities: { canSendToCurrentSession: true, currentSessionId: 'host', hostIdConfigured: false } }; }
function ui() { return { filter: 'open', search: '', expanded: new Map(), descriptions: new Set(), closed: new Set() }; }
function mounted(callbacks = {}) {
  const dom = new JSDOM('<main id="root"></main>', { pretendToBeVisual: true });
  const root = dom.window.document.getElementById('root');
  const view = createBoardView(root, callbacks); view.update(state());
  return { dom, root, view, click: (selector) => { const node = root.querySelector(selector); assert.ok(node, selector); node.click(); } };
}
test('board has Lane columns and Lane focus has Goal columns without a Goal-focus route', () => {
  const board = renderBoard(state(), ui());
  assert.match(board, /class="board-columns lane-columns"/);
  assert.match(board, /data-lane-column="#l001"/);
  assert.doesNotMatch(board, /Closed Goal/);
  const focused = renderBoard({ ...state(), focus: lane.ref }, ui());
  assert.match(focused, /data-back/);
  assert.match(focused, /board-columns goal-columns/);
  assert.doesNotMatch(focused, /data-lane-column/);
  assert.doesNotMatch(focused, /data-focus|record-detail|sidebar/);
});
test('exact Lane goal_refs control namespaced membership and legacy Goal/Task focus normalizes to Lane', () => {
  const foreign = { ...goal, ref: '#bob#g001', lane_id: 'l001' };
  assert.deepEqual(goalsForLane(lane, [goal, foreign]).map(g => g.ref), [goal.ref]);
  assert.equal(laneForFocus({ ...state(), focus: task.ref }).ref, lane.ref);
  assert.equal(laneForFocus({ ...state(), focus: goal.ref }).ref, lane.ref);
  assert.equal(laneForFocus({ ...state(), focus: null }), undefined);
});
test('Open preserves active closed-only Lane and unassigned reveal controls, excluding terminal states', () => {
  const exec = () => ({ status: 'none' });
  const grouped = goalGroup(lane, [closed], 'open', '', false, exec);
  assert.equal(grouped.showLane, true); assert.equal(grouped.canRevealClosed, true); assert.equal(grouped.entries.length, 0);
  const unassigned = renderBoard({ ...state(), lanes: [], goals: [closed] }, ui());
  assert.match(unassigned, /Goals outside Lanes/); assert.match(unassigned, /Show closed goals/);
  assert.equal(goalGroup(lane, [{ ...goal, status: 'not_planned', tasks: [] }], 'open', '', false, exec).entries.length, 0);
  assert.equal(goalGroup(lane, [{ ...goal, status: 'duplicate', tasks: [] }], 'all', '', true, exec).entries.length, 1);
});
test('search retains matching descendant ancestors and auto-expands tasks; labels and refs are searchable', () => {
  const f = mounted();
  const input = f.root.querySelector('input'); input.value = 'needle'; input.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  assert.match(f.root.textContent, /Lane one/); assert.match(f.root.textContent, /Goal one/); assert.match(f.root.textContent, /Exact needle task/);
  const exec = () => ({ status: 'none' });
  assert.equal(goalGroup(lane, [goal], 'open', 'urgent', false, exec).entries[0].tasks.length, 1);
  assert.equal(goalGroup(lane, [goal], 'open', task.ref, false, exec).entries.length, 1);
});
test('Running counts only observed exact-session activity; in_progress and unknown never imply running or idle', () => {
  const s = state(); s.goals[0] = { ...goal, status: 'in_progress' };
  assert.doesNotMatch(renderBoard(s, ui()), /Running now · 0 Tasks, 1 Goals/);
  s.projectSessions = [{ id: 'unknown', recordRef: goal.ref, status: 'unknown' }];
  assert.equal(executionFor(goal, s).status, 'unknown');
  s.projectSessions[0].status = 'running';
  assert.match(renderBoard(s, ui()), /Running now · 0 Tasks, 1 Goals, 0 Lanes/);
  assert.match(renderBoard(s, ui()), /Running · 1/);
});
test('Goal inline expansion is independent from Show more and menu/Back actions never toggle it', () => {
  const calls = [];
  const f = mounted({ onCommand: (...args) => calls.push(args), onFocus: (ref) => calls.push(['focus', ref]) });
  f.view.update({ ...state(), goals: [{ ...goal, description: 'x'.repeat(300) }], focus: lane.ref });
  f.click('[data-description]');
  assert.equal(f.view.ui.descriptions.has(goal.ref), true);
  assert.equal(f.root.querySelector('[data-record="#alice#g001#t01"]'), null);
  f.click('[data-menu="#alice#g001"]'); assert.equal(calls[0][0], 'menu');
  f.click('[data-expand="#alice#g001"]');
  assert.ok(f.root.querySelector('[data-record="#alice#g001#t01"]'));
  f.click('[data-back]'); assert.deepEqual(calls.at(-1), ['focus', null]);
  f.view.update({ ...state(), focus: null }); assert.ok(f.root.querySelector('.lane-columns'));
});
test('refresh preserves search caret, expansion and horizontal scroll; unchanged markup keeps DOM identity', () => {
  const f = mounted(); f.click('[data-expand="#alice#g001"]');
  let search = f.root.querySelector('input'); search.focus(); search.value = 'Goal'; search.setSelectionRange(2, 2); search.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }));
  search = f.root.querySelector('input');
  const columns = f.root.querySelector('.board-columns'); columns.scrollLeft = 91;
  f.view.update(state()); assert.equal(f.root.querySelector('input'), search);
  f.view.update({ ...state(), lanes: [{ ...lane, title: 'Changed Lane' }] });
  assert.equal(f.root.ownerDocument.activeElement, f.root.querySelector('input'));
  assert.equal(f.root.querySelector('input').selectionStart, 2);
  assert.equal(f.root.querySelector('.board-columns').scrollLeft, 91);
  assert.equal(f.view.ui.expanded.get(goal.ref), true);
});
test('current-session sends preserve host gates and UI never promises workspace or session creation', () => {
  const html = renderBoard(state(), ui());
  assert.match(html, /Send to this session/); assert.doesNotMatch(html, /Create workspace|Start Copilot session|Run in Paseo/);
  const conflict = { ...state(), projectSessions: [{ id: 'host', recordRef: '#another', recordKind: 'lane', status: 'idle' }] };
  const dom = new JSDOM(renderBoard(conflict, ui()));
  assert.equal(dom.window.document.querySelector('[data-send="#alice#g001"]').disabled, true);
});

test('legacy programmatic focus expands once while refresh respects subsequent manual collapse', () => {
  const f = mounted();
  const legacy = { ...state(), focus: task.ref };
  f.view.update(legacy);
  assert.ok(f.root.querySelector('.goal-columns'));
  assert.ok(f.root.querySelector('[data-record="#alice#g001#t01"]'));
  f.click('[data-expand="#alice#g001"]');
  f.view.update(legacy);
  assert.equal(f.root.querySelector('[data-record="#alice#g001#t01"]'), null);
  f.view.update({ ...state(), focus: closed.ref });
  assert.ok(f.root.querySelector('[data-record="#alice#g002"]'));
});

test('legacy closed or terminal Task focus reveals that Task inside its active Goal', () => {
  for (const status of ['closed', 'not_planned', 'duplicate']) {
    const f = mounted();
    f.view.update({ ...state(), focus: task.ref, goals: [{ ...goal, tasks: [{ ...task, status }] }] });
    assert.ok(f.root.querySelector('[data-record="#alice#g001#t01"]'), status);
    assert.ok(f.root.querySelector('.goal-columns'));
  }
});

test('new explicit record focus reveals target despite stale search/Running, without resetting ordinary refresh', () => {
  const f = mounted();
  f.click('[data-filter="running"]');
  f.view.ui.search = 'unrelated search';
  f.view.update({ ...state(), focus: task.ref });
  assert.equal(f.view.ui.search, ''); assert.equal(f.view.ui.filter, 'open');
  assert.ok(f.root.querySelector('[data-record="#alice#g001#t01"]'));
  f.click('[data-filter="all"]');
  f.view.ui.search = 'custom search';
  f.view.update({ ...state(), focus: task.ref });
  assert.equal(f.view.ui.search, 'custom search'); assert.equal(f.view.ui.filter, 'all');
});

test('inline Goal expansion includes Plan and Decisions context', () => {
  const f = mounted(); f.view.update({ ...state(), goals: [{ ...goal, plan: 'Concrete plan', decisions: 'Concrete decision' }] });
  assert.doesNotMatch(f.root.textContent, /Concrete plan/);
  f.click('[data-expand="#alice#g001"]');
  assert.match(f.root.textContent, /PlanConcrete plan/); assert.match(f.root.textContent, /DecisionsConcrete decision/);
});
