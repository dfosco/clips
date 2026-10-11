import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { formatRef, parseRef, replayGoalEvents } from './core.js';
import { acceptanceFields } from './work-fields.js';
import { appendJsonEvent, readJsonEvents, withRecordLock } from './journal.js';

const cli = path.resolve('src/cli.js');
const directories = [];
const goalEvent = { event: 'goal_created', goal_id: 'g001', title: 'Restore selection', status: 'open', acceptance_criteria: ['Selection survives reload'] };
const taskEvent = { event: 'task_created', goal_id: 'g001', task_id: 't01', title: 'Store selection', description: 'Persist the selected ID', acceptance_criteria: ['Read back the ID', 'Storage failure is harmless'], components: ['#c1'], extensions: { project: { relationship: '#c2' } }, custom_legacy_field: 'retained' };
const receipt = (record) => acceptanceFields(record, {
  artifact: 'fixture:immutable-candidate', accepted_by: 'fixture-reviewer', summary: 'Fixture checks satisfied',
  criteria: record.acceptance_criteria.map(({ id }) => ({ id, status: 'satisfied', evidence: `fixture:${id}` })),
}, { kind: record.task_id ? 'task' : 'goal', timestamp: '2026-10-11T00:00:00Z' });

function acceptedEvents() {
  const events = [goalEvent, taskEvent];
  const task = replayGoalEvents(events, 'g001').tasks.t01;
  events.push({ event: 'task_updated', task_id: 't01', ...receipt(task) });
  events.push({ event: 'updated', ...receipt(replayGoalEvents(events, 'g001')) });
  return events;
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('references and recoverable work history', () => {
  it('reads legacy criterion maps and text objects through amendments and historical views', () => {
    const events = [{ ...goalEvent, acceptance_criteria: {
      success: { text: 'Restores selection', custom: 'preserved' }, failure: 'Storage errors are contained',
    } }, { ...taskEvent, acceptance_criteria: [{ text: 'Read the ID', id: 'old-criterion' }] },
    { event: 'updated', plan: 'Unrelated coordination note' },
    { event: 'updated', acceptance_criteria: { failure: 'Storage errors are contained', success: { text: 'Restores a valid selection', custom: 'preserved' } } },
    ];
    const current = replayGoalEvents(events, 'g001');
    expect(current.acceptance_criteria).toEqual([
      { id: 'A2', description: 'Storage errors are contained', legacy_key: 'failure' },
      { id: 'A1', description: 'Restores a valid selection', text: 'Restores a valid selection', legacy_key: 'success', custom: 'preserved' },
    ]);
    expect(current.tasks.t01.acceptance_criteria[0]).toMatchObject({ id: 'A1', legacy_id: 'old-criterion', text: 'Read the ID', description: 'Read the ID' });
    expect(replayGoalEvents(events, 'g001', { revision: 1 }).acceptance_criteria[0].description).toBe('Restores selection');
  });

  it('uses nested revisions and criteria while retaining namespaces and contextual tasks', () => {
    expect(parseRef('#sam#g001#t1#r4#A2')).toEqual({ username: 'sam', goalId: 'g001', taskId: 't01', revision: 4, criterionId: 'A2' });
    expect(formatRef(parseRef('#sam#g001#t1#A2#r4'))).toBe('#sam#g001#t01#r4#A2');
    expect(parseRef('#t1#A1')).toMatchObject({ goalId: null, taskId: 't01', criterionId: 'A1' });
    expect(parseRef('#sam#c1#r3')).toMatchObject({ username: 'sam', componentId: 'c001', revision: 3 });
    expect(parseRef('#c1#r0')).toBeNull();
    expect(parseRef('#g001#t1#r1#r2')).toBeNull();
    expect(parseRef('#g001#t1.1')).toBeNull();
  });

  it('reconstructs goal and task snapshots without losing unknown legacy fields', () => {
    const events = [goalEvent, taskEvent,
      { event: 'updated', plan: 'Parallel review' },
      { event: 'task_updated', task_id: 't01', description: 'Persist a validated ID' },
      { event: 'task_created', task_id: 't02', title: 'Integrate selection' },
    ];
    const current = replayGoalEvents(events, 'g001');
    expect(current).toMatchObject({ revision: 5, plan: 'Parallel review' });
    expect(current.tasks.t01).toMatchObject({ revision: 2, custom_legacy_field: 'retained', extensions: taskEvent.extensions });
    const original = replayGoalEvents(events, 'g001', { taskId: 't01', taskRevision: 1 });
    expect(original.revision).toBe(2);
    expect(original.tasks.t01.description).toBe('Persist the selected ID');
    expect(original.tasks.t02).toBeUndefined();
    expect(replayGoalEvents(events, 'g001', { revision: 3 }).tasks.t01.revision).toBe(1);
    expect(() => replayGoalEvents(events, 'g001', { taskId: 't01', taskRevision: 3 })).toThrow('not found');
  });

  it('keeps acceptance through reordering and notes, but invalidates changed child agreements', () => {
    const events = acceptedEvents();
    const before = replayGoalEvents(events, 'g001');
    events.push({ event: 'task_updated', task_id: 't01', acceptance_criteria: [...before.tasks.t01.acceptance_criteria].reverse(), sections: { Handoff: 'Next reader context' } });
    expect(replayGoalEvents(events, 'g001').acceptance).toEqual(before.acceptance);
    events.push({ event: 'task_updated', task_id: 't01', scope: 'Also migrate old IDs', timestamp: '2026-10-11T01:00:00Z' });
    const after = replayGoalEvents(events, 'g001');
    expect(after.status).toBe('open');
    expect(after.acceptance).toBeNull();
    expect(after.acceptance_history).toHaveLength(1);
    expect(after.tasks.t01.status).toBe('open');
    expect(after.tasks.t01.acceptance_history[0].request_snapshot.description).toBe(taskEvent.description);
    expect(replayGoalEvents(events, 'g001', { revision: 4 }).acceptance).toEqual(before.acceptance);
  });

  it('revises inherited requirements and preserves the accepted historical task', () => {
    const events = acceptedEvents();
    const oldRevision = replayGoalEvents(events, 'g001').tasks.t01.revision;
    events.push({ event: 'updated', verification_mode: 'behavior_and_tests' });
    const current = replayGoalEvents(events, 'g001');
    expect(current.tasks.t01).toMatchObject({ revision: oldRevision + 1, acceptance: null, status: 'open', effective_verification_mode: 'behavior_and_tests' });
    const old = replayGoalEvents(events, 'g001', { taskId: 't01', taskRevision: oldRevision }).tasks.t01;
    expect(old.acceptance).toBeTruthy();
    expect(old.effective_verification_mode).toBe('behavior');
  });

  it('preserves administrative dispositions when a legacy event invalidates acceptance', () => {
    const events = acceptedEvents();
    events.push({ event: 'task_status_changed', task_id: 't01', status: 'not_planned' });
    const current = replayGoalEvents(events, 'g001');
    expect(current.tasks.t01).toMatchObject({ status: 'not_planned', acceptance: null });
    expect(current.acceptance).toBeNull();
  });
});

describe('journal integrity and CLI lookup', () => {
  it('allows unrelated edits and repair of a blank legacy criterion while rejecting new blanks', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-legacy-criteria-'));
    directories.push(directory);
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    fs.mkdirSync(path.join(directory, '.clips', 'db'), { recursive: true });
    fs.writeFileSync(path.join(directory, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: false }));
    fs.writeFileSync(path.join(directory, '.clips', 'db', 'g001.jsonl'), JSON.stringify({ ...goalEvent, acceptance_criteria: [''] }) + '\n');
    const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' }));
    run('goal', 'update', 'g1', JSON.stringify({ plan: 'Clarify the old agreement' }));
    expect(run('view', '#g1', '--json').acceptance_criteria).toEqual([{ id: 'A1', description: '' }]);
    run('goal', 'update', 'g1', JSON.stringify({ acceptance_criteria: [{ id: 'A1', description: 'Selection survives reload' }] }));
    expect(run('view', '#g1', '--json').acceptance_criteria[0].id).toBe('A1');
    expect(run('view', '#g1#r1', '--json').acceptance_criteria[0].description).toBe('');
    const failed = spawnSync(process.execPath, [cli, 'goal', 'update', 'g1', JSON.stringify({ acceptance_criteria: [' '] })], { cwd: directory, encoding: 'utf8' });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('non-empty string');
  });

  it('releases failed locks and refuses silent JSON loss or concurrent append', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-journal-'));
    directories.push(directory);
    const file = path.join(directory, 'work.jsonl');
    expect(() => withRecordLock(file, () => appendJsonEvent(file, { bad: { value: undefined } }))).toThrow('undefined');
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
    withRecordLock(file, () => {
      expect(() => withRecordLock(file, () => {})).toThrow('being written');
      appendJsonEvent(file, { event: 'created' });
    });
    expect(readJsonEvents(file)).toEqual([{ event: 'created' }]);
    fs.writeFileSync(file, '{broken}\n');
    expect(() => readJsonEvents(file)).toThrow('line 1');
  });

  it('resolves criterion evidence, snapshots and contextual refs, and rejects stale edits', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-record-cli-'));
    directories.push(directory);
    execFileSync('git', ['init', '--quiet'], { cwd: directory });
    fs.mkdirSync(path.join(directory, '.clips', 'db'), { recursive: true });
    fs.writeFileSync(path.join(directory, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: false }));
    fs.writeFileSync(path.join(directory, '.clips', 'db', 'g001.jsonl'), acceptedEvents().map((event) => JSON.stringify(event)).join('\n') + '\n');
    const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8' }));
    const criterion = run('view', '#t1#A1', '--goal', '#g1', '--json');
    expect(criterion).toMatchObject({ id: 'A1', acceptance: { evidence: 'fixture:A1', status: 'satisfied' } });
    expect(run('view', '#g1#t1#r1', '--json').acceptance).toBeUndefined();
    expect(run('history', '#g1#t1', '--json').map((event) => event.revision)).toEqual([1, 2]);
    const failed = spawnSync(process.execPath, [cli, 'task', 'update', '#g1#t1', JSON.stringify({ scope: 'Stale request', expected_revision: 1 })], { cwd: directory, encoding: 'utf8' });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('Revision conflict');
    expect(run('view', '#g1#t1', '--json').scope).toBeUndefined();
  });
});
