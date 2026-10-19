import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignLabel, deleteLabel, labelUses, runLabelCommand } from './label.js';
import { resolveViewRecord } from './view.js';
import { parseRef } from '../lib/core.js';
import { parseGoalFile } from '../lib/board.js';
import { createLabel, updateLabel, labelCatalog, readLabelConfig } from '../lib/labels.js';
import { readBoardData } from '../lib/board.js';
import { readCurrentBoard } from './board.js';

const cli = path.resolve('src/cli.js');
const roots = [];
const json = JSON.stringify;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-labels-'));
  roots.push(root);
  execFileSync('git', ['init', '-q', root]);
  const db = path.join(root, '.clips', 'db');
  fs.mkdirSync(path.join(db, 'tracks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), json({ collaboration: false, custom: { retain: true } }));
  fs.writeFileSync(path.join(db, 'tracks', 'r001.jsonl'), json({ event: 'lane_created', title: 'Lane', status: 'open' }));
  fs.writeFileSync(path.join(db, 'g001.jsonl'), [
    { event: 'goal_created', goal_id: 'g001', title: 'Goal', status: 'open', extensions: { custom: { retain: true } } },
    { event: 'task_created', task_id: 't01', title: 'Task', status: 'open' },
  ].map(json).join('\n') + '\n');
  return root;
}
function inRepo(root, operation) {
  const previous = process.cwd();
  process.chdir(root);
  try { return operation(); } finally { process.chdir(previous); }
}
const board = (root) => readBoardData({ dbDir: path.join(root, '.clips', 'db') });
const catalog = (root) => labelCatalog(readLabelConfig(root));
const create = (root) => createLabel({ name: 'Review', color: '#AABBCC' }, root);
const record = (root, kind) => {
  const data = board(root);
  return kind === 'lane' ? data.lanes[0] : kind === 'goal' ? data.goals[0] : data.goals[0].tasks[0];
};
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('project label modules and real persistence', () => {
  it('round-trips catalog CRUD and immutable IDs while preserving unrelated config', () => {
    const root = fixture();
    expect(create(root)).toEqual({ id: 'review', name: 'Review', color: '#aabbcc' });
    updateLabel('review', { name: 'Validate', color: '#123456' }, root);
    expect(catalog(root)).toEqual([{ id: 'review', name: 'Validate', color: '#123456' }]);
    expect(readLabelConfig(root).custom).toEqual({ retain: true });
    inRepo(root, () => deleteLabel('review'));
    expect(catalog(root)).toEqual([]);
    expect(() => createLabel({ id: 'review', name: 'New', color: '#ffffff' }, root)).toThrow('retired');
    expect(create(root).id).not.toBe('review');
  });

  it('routes edit/recolor/list/delete and projects current labels in CLI record views', () => {
    const root = fixture();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      inRepo(root, () => {
        runLabelCommand(['create', json({ name: 'Review', color: '#abcdef' })]);
        runLabelCommand(['edit', 'review', json({ name: 'Validate' })]);
        runLabelCommand(['recolor', 'review', '#123456']);
        runLabelCommand(['list', '--json']);
        expect(JSON.parse(log.mock.calls.at(-1)[0])).toEqual([{ id: 'review', name: 'Validate', color: '#123456' }]);
        runLabelCommand(['add', '#g1#t1', 'review']);
        const task = resolveViewRecord(parseRef('#g1#t1'));
        expect(task.labels).toEqual([{ id: 'review', name: 'Validate', color: '#123456' }]);
        runLabelCommand(['remove', '#g1#t1', 'review']);
        runLabelCommand(['delete', 'review']);
        const historical = resolveViewRecord(parseRef(`#g1#t1#r${task.revision}`));
        expect(historical.label_ids).toEqual(['review']);
        expect(historical.labels).toEqual([]);
      });
    } finally { log.mockRestore(); }
  });

  it.each([
    ['lane', '#l1'], ['goal', '#g1'], ['task', '#g1#t1'],
  ])('persists %s assignments, resolves edits, and protects assigned definitions', (kind, ref) => {
    const root = fixture();
    create(root);
    const source = path.join(root, '.clips', 'db', kind === 'lane' ? 'tracks/r001.jsonl' : 'g001.jsonl');
    const before = fs.readFileSync(source, 'utf8');
    inRepo(root, () => assignLabel(ref, 'review', true));
    expect(fs.readFileSync(source, 'utf8').startsWith(before)).toBe(true);
    expect(record(root, kind).label_ids).toEqual(['review']);
    updateLabel('review', { name: 'Renamed', color: '#123456' }, root);
    expect(record(root, kind).labels).toEqual([{ id: 'review', name: 'Renamed', color: '#123456' }]);
    expect(() => inRepo(root, () => deleteLabel('review'))).toThrow('Remove those assignments');
    inRepo(root, () => assignLabel(ref, 'review', false));
    expect(record(root, kind).labels).toEqual([]);
    expect(catalog(root)).toHaveLength(1);
  });

  it('validates catalog fields and prevents data loss under malformed config or a held lock', () => {
    const root = fixture();
    const config = path.join(root, '.clips', 'clips.config.json');
    const before = fs.readFileSync(config, 'utf8');
    for (const data of [
      { name: '', color: '#ffffff' }, { name: 'Bad\nname', color: '#ffffff' },
      { name: 'Bad', color: 'red' }, { id: '../outside', name: 'Bad', color: '#ffffff' },
    ]) expect(() => createLabel(data, root)).toThrow();
    expect(fs.readFileSync(config, 'utf8')).toBe(before);
    create(root);
    expect(() => createLabel({ id: 'other', name: 'review', color: '#000000' }, root)).toThrow('Duplicate label name');
    expect(() => updateLabel('review', { id: 'new' }, root)).toThrow('immutable');
    fs.writeFileSync(`${config}.lock`, 'writer');
    expect(() => updateLabel('review', { name: 'Lost update' }, root)).toThrow('being written');
    fs.unlinkSync(`${config}.lock`);
    fs.writeFileSync(config, '{ broken');
    expect(() => create(root)).toThrow();
    expect(fs.readFileSync(config, 'utf8')).toBe('{ broken');
  });

  it('rejects historical, criterion, component, and missing targets without appending', () => {
    const root = fixture();
    create(root);
    const source = path.join(root, '.clips', 'db', 'g001.jsonl');
    const before = fs.readFileSync(source, 'utf8');
    inRepo(root, () => {
      for (const ref of ['#g1#r1', '#g1#A1', '#t1', '#c1', '#l1#r1', '#g999']) {
        expect(() => assignLabel(ref, 'review', true)).toThrow();
      }
      expect(() => assignLabel('#g1', 'missing', true)).toThrow('not found');
    });
    expect(fs.readFileSync(source, 'utf8')).toBe(before);
  });

  it('protects assignments in other namespaces and fails closed on unreadable journals', () => {
    const root = fixture();
    create(root);
    const dir = path.join(root, '.clips', 'db', 'alice');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'g001.jsonl'), json({ event: 'goal_created', goal_id: 'g001', title: 'Alice', label_ids: ['review'] }) + '\n');
    expect(() => inRepo(root, () => deleteLabel('review'))).toThrow('#alice#g001');
    fs.writeFileSync(path.join(dir, 'g001.jsonl'), 'broken JSON\n');
    expect(() => inRepo(root, () => deleteLabel('review'))).toThrow('Invalid journal');
    expect(catalog(root)).toHaveLength(1);
  });

  it('reports current uses with kind and status across lanes and namespaced closed records', () => {
    const root = fixture();
    create(root);
    const db = path.join(root, '.clips', 'db');
    fs.appendFileSync(path.join(db, 'tracks', 'r001.jsonl'), '\n' + json({ event: 'lane_status_changed', status: 'closed' }) + '\n' + json({ event: 'lane_updated', label_ids: ['review'] }) + '\n');
    fs.appendFileSync(path.join(db, 'g001.jsonl'), [
      { event: 'updated', label_ids: ['review'], status: 'closed' },
      { event: 'task_updated', task_id: 't01', label_ids: ['review'], status: 'closed' },
    ].map(json).join('\n') + '\n');
    const alice = path.join(db, 'alice');
    fs.mkdirSync(alice);
    fs.writeFileSync(path.join(alice, 'g002.jsonl'), [
      { event: 'goal_created', goal_id: 'g002', title: 'Namespaced', status: 'in_progress', label_ids: ['review'] },
      { event: 'task_created', task_id: 't02', title: 'Namespaced task', status: 'closed' },
      { event: 'task_updated', task_id: 't02', status: 'closed', label_ids: ['review'] },
    ].map(json).join('\n') + '\n');
    const result = inRepo(root, () => labelUses('review'));
    expect(result.count).toBe(5);
    expect(result.uses).toEqual(expect.arrayContaining([
      { ref: '#l001', kind: 'lane', status: 'closed' },
      { ref: '#g001', kind: 'goal', status: 'closed' },
      { ref: '#g001#t01', kind: 'task', status: 'closed' },
      { ref: '#alice#g002', kind: 'goal', status: 'in_progress' },
      { ref: '#alice#g002#t02', kind: 'task', status: 'closed' },
    ]));
  });

  it('replaces or removes assignments append-only, deduplicates targets, and preserves acceptance', () => {
    const root = fixture();
    create(root);
    createLabel({ id: 'none', name: 'None', color: '#000000' }, root);
    createLabel({ id: 'keep', name: 'Keep', color: '#123456' }, root);
    const receipt = { artifact: 'fixture', accepted_by: 'test-agent', summary: 'Checked', criteria: [] };
    const db = path.join(root, '.clips', 'db');
    fs.appendFileSync(path.join(db, 'g001.jsonl'), [
      { event: 'task_updated', task_id: 't01', status: 'closed', acceptance: receipt, label_ids: ['review'] },
      { event: 'updated', status: 'closed', acceptance: receipt, label_ids: ['review', 'keep'] },
    ].map(json).join('\n') + '\n');
    fs.appendFileSync(path.join(db, 'tracks', 'r001.jsonl'), '\n' + json({ event: 'lane_status_changed', status: 'closed' }) + '\n' + json({ event: 'lane_updated', label_ids: ['review', 'keep'] }) + '\n');
    const alice = path.join(db, 'alice');
    fs.mkdirSync(alice);
    fs.writeFileSync(path.join(alice, 'g002.jsonl'), [
      { event: 'goal_created', goal_id: 'g002', title: 'Namespaced', status: 'open' },
      { event: 'task_created', task_id: 't02', title: 'Namespaced task', status: 'closed' },
      { event: 'task_updated', task_id: 't02', status: 'closed', acceptance: receipt, label_ids: ['review', 'keep'] },
      { event: 'updated', status: 'closed', acceptance: receipt, label_ids: ['review'] },
    ].map(json).join('\n') + '\n');
    const originalGoalLines = fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8');
    inRepo(root, () => deleteLabel('review', { kind: 'label', id: 'keep' }));
    expect(catalog(root).map((label) => label.id)).toEqual(['none', 'keep']);
    expect(record(root, 'goal')).toMatchObject({ status: 'closed', acceptance: receipt, label_ids: ['keep'] });
    expect(record(root, 'task')).toMatchObject({ status: 'closed', acceptance: receipt, label_ids: ['keep'] });
    expect(record(root, 'lane').label_ids).toEqual(['keep']);
    const namespaced = parseGoalFile(path.join(alice, 'g002.jsonl'), 'g002');
    expect(namespaced).toMatchObject({ status: 'closed', acceptance: receipt, label_ids: ['keep'] });
    expect(namespaced.tasks.t02).toMatchObject({ status: 'closed', acceptance: receipt, label_ids: ['keep'] });
    expect(fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8').startsWith(originalGoalLines)).toBe(true);

    // An active label whose ID/name is "none" does not collide with explicit removal.
    inRepo(root, () => assignLabel('#g1', 'none', true));
    inRepo(root, () => deleteLabel('none', { kind: 'none' }));
    expect(record(root, 'goal').label_ids).toEqual(['keep']);
  });

  it('refuses invalid/self/stale replacement choices and retains the legacy no-choice guard', () => {
    const root = fixture();
    create(root);
    createLabel({ id: 'keep', name: 'Keep', color: '#123456' }, root);
    inRepo(root, () => assignLabel('#g1', 'review', true));
    expect(() => inRepo(root, () => deleteLabel('review'))).toThrow('Remove those assignments');
    for (const replacement of [
      { kind: 'label', id: 'review' }, { kind: 'label', id: 'stale' }, { kind: 'bogus' },
    ]) expect(() => inRepo(root, () => deleteLabel('review', replacement))).toThrow();
    expect(catalog(root).map((label) => label.id)).toEqual(['review', 'keep']);
    expect(record(root, 'goal').label_ids).toEqual(['review']);
  });

  it('keeps the source label when one migration append fails, then retry converges', () => {
    const root = fixture();
    create(root);
    createLabel({ id: 'keep', name: 'Keep', color: '#123456' }, root);
    inRepo(root, () => {
      assignLabel('#g1', 'review', true);
      assignLabel('#g1#t1', 'review', true);
    });
    const db = path.join(root, '.clips', 'db');
    const alice = path.join(db, 'alice');
    fs.mkdirSync(alice);
    fs.writeFileSync(path.join(alice, 'g002.jsonl'), [
      { event: 'goal_created', goal_id: 'g002', title: 'Namespaced', status: 'closed', label_ids: ['review'] },
    ].map(json).join('\n') + '\n');
    const originalAppend = fs.appendFileSync;
    let failed = false;
    const appendSpy = vi.spyOn(fs, 'appendFileSync').mockImplementation((file, ...args) => {
      if (!failed && String(file).endsWith(path.join('alice', 'g002.jsonl'))) {
        failed = true;
        throw new Error('simulated append failure');
      }
      return originalAppend.call(fs, file, ...args);
    });
    try {
      expect(() => inRepo(root, () => deleteLabel('review', { kind: 'label', id: 'keep' }))).toThrow('simulated append failure');
    } finally { appendSpy.mockRestore(); }
    expect(catalog(root).map((label) => label.id)).toEqual(['review', 'keep']);
    expect(record(root, 'goal').label_ids).toEqual(['keep']);
    expect(record(root, 'task').label_ids).toEqual(['keep']);
    expect(parseGoalFile(path.join(alice, 'g002.jsonl'), 'g002').label_ids).toEqual(['review']);
    inRepo(root, () => deleteLabel('review', { kind: 'label', id: 'keep' }));
    expect(catalog(root).map((label) => label.id)).toEqual(['keep']);
    expect(parseGoalFile(path.join(alice, 'g002.jsonl'), 'g002').label_ids).toEqual(['keep']);
  });

  it('fails under the catalog lock before appending and allows a safe retry', () => {
    const root = fixture();
    create(root);
    createLabel({ id: 'keep', name: 'Keep', color: '#123456' }, root);
    inRepo(root, () => assignLabel('#g1', 'review', true));
    const config = path.join(root, '.clips', 'clips.config.json');
    const journal = path.join(root, '.clips', 'db', 'g001.jsonl');
    const journalBefore = fs.readFileSync(journal, 'utf8');
    fs.writeFileSync(`${config}.lock`, 'another label writer');
    expect(() => inRepo(root, () => deleteLabel('review', { kind: 'label', id: 'keep' }))).toThrow('being written');
    expect(catalog(root).map((label) => label.id)).toEqual(['review', 'keep']);
    expect(fs.readFileSync(journal, 'utf8')).toBe(journalBefore);
    fs.unlinkSync(`${config}.lock`);
    inRepo(root, () => deleteLabel('review', { kind: 'label', id: 'keep' }));
    expect(record(root, 'goal').label_ids).toEqual(['keep']);
    expect(catalog(root).map((label) => label.id)).toEqual(['keep']);
  });

  it('routes uses and explicit delete choices through the CLI without a sentinel collision', () => {
    const root = fixture();
    create(root);
    createLabel({ id: 'none', name: 'None', color: '#000000' }, root);
    inRepo(root, () => assignLabel('#g1', 'review', true));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      inRepo(root, () => runLabelCommand(['uses', 'review', '--json']));
      expect(JSON.parse(log.mock.calls.at(-1)[0])).toMatchObject({ id: 'review', count: 1, uses: [{ ref: '#g001', kind: 'goal', status: 'open' }] });
      inRepo(root, () => runLabelCommand(['delete', 'review', '--remove-assignments']));
      expect(record(root, 'goal').label_ids).toEqual([]);
      expect(catalog(root).map((label) => label.id)).toEqual(['none']);
    } finally { log.mockRestore(); }
  });

  it('loads legacy records, keeps catalogs isolated, and preserves extension content', () => {
    const root = fixture();
    const other = fixture();
    expect(board(root).labels).toEqual([]);
    for (const kind of ['lane', 'goal', 'task']) expect(record(root, kind).labels).toEqual([]);
    create(root);
    expect(catalog(other)).toEqual([]);
    expect(board(root).goals[0].extensions).toEqual({ custom: { retain: true } });
  });

  it('keeps engineering acceptance intact when changing Goal and Task labels', () => {
    const root = fixture();
    const receipt = { artifact: 'fixture', accepted_by: 'test-agent', summary: 'Checked', criteria: [] };
    const source = path.join(root, '.clips', 'db', 'g001.jsonl');
    fs.appendFileSync(source, [
      { event: 'task_updated', task_id: 't01', status: 'closed', acceptance: receipt },
      { event: 'updated', status: 'closed', acceptance: receipt },
    ].map(json).join('\n') + '\n');
    create(root);
    inRepo(root, () => {
      assignLabel('#g1', 'review', true);
      assignLabel('#g1#t1', 'review', true);
    });
    for (const kind of ['goal', 'task']) expect(record(root, kind)).toMatchObject({ status: 'closed', acceptance: receipt });
  });
});

it('runs a small CLI path with a catalog shared through a real linked worktree', () => {
  const root = fixture();
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-qm', 'Fixture']);
  const linked = `${root}-linked`;
  roots.push(linked);
  execFileSync('git', ['-C', root, 'worktree', 'add', '-qb', 'linked', linked]);
  const cliRun = (cwd, ...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }));
  const label = cliRun(root, 'label', 'create', json({ name: 'CLI', color: '#abcdef' }));
  cliRun(linked, 'label', 'add', '#g1', label.id);
  const data = cliRun(root, 'board', '--json');
  expect(data.goals[0].labels).toEqual([label]);
  expect(readCurrentBoard(linked).labels).toEqual([label]);
});
