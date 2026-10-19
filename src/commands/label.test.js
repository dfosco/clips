import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignLabel, deleteLabel, runLabelCommand } from './label.js';
import { resolveViewRecord } from './view.js';
import { parseRef } from '../lib/core.js';
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
