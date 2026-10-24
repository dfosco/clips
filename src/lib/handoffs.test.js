import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { recordHandoff } from './handoffs.js';
import { appendEvent, readGoalWithTasks } from './core.js';

const roots = [];
const id = 'f9b83fb5-052e-44f5-bff8-52df9aa75539';
const input = { context: 'Implemented the bounded change. Checks passed; human review remains pending.',
  agent_id: 'dev-1', manager_id: 'manager-1', handoff_id: id };

function fixture({ store = '.lanes', username = null } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-handoff-')));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const db = path.join(root, store, 'db');
  fs.mkdirSync(db, { recursive: true });
  fs.writeFileSync(path.join(root, store, 'lanes.config.json'), JSON.stringify({ collaboration: false, username }));
  const file = path.join(db, username || '', 'g001.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    { event: 'goal_created', goal_id: 'g001', title: 'Goal', status: 'in_progress' },
    { event: 'task_created', goal_id: 'g001', task_id: 't01', title: 'Task', status: 'in_progress' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n');
  vi.stubEnv('LANES_HOME', path.join(root, 'user-store'));
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  return { root, store, db, file, artifact: path.join(root, store, 'records', 'handoffs', `${id}.md`) };
}

afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('durable developer handoffs', () => {
  it('attaches Task context to its Goal without accepting or closing either record', () => {
    const f = fixture();
    const result = recordHandoff('#g1#t1', input);
    expect(result).toEqual({
      success: true, handoff_id: id, goal_ref: '#g001', source_ref: '#g001#t01',
      attachment: { id: `att-${id}`, type: 'markdown', path: `.lanes/records/handoffs/${id}.md`,
        title: 'Developer handoff #g001#t01 (completed)' },
      context: input.context, incomplete: false,
    });
    const goal = readGoalWithTasks('g001');
    expect(goal.status).toBe('in_progress');
    expect(goal.tasks.t01.status).toBe('in_progress');
    expect(goal.tasks.t01.attachments || []).toEqual([]);
    expect(goal.attachments).toEqual([result.attachment]);
    const document = fs.readFileSync(f.artifact, 'utf8');
    expect(document).toContain(input.context);
    expect(document).toContain('"agent_id": "dev-1"');
    expect(document).toContain('"manager_id": "manager-1"');
    expect(document).toContain('"source_ref": "#g001#t01"');
    expect(goal.acceptance).toBeUndefined();
    expect(goal.tasks.t01.acceptance).toBeUndefined();
  });

  it.each(['.lanes', '.clips'])('uses resolved %s storage and qualifies implicit usernames', (store) => {
    const f = fixture({ store, username: 'alice' });
    const result = recordHandoff('#g1#t1', input);
    expect(result).toMatchObject({ goal_ref: '#alice#g001', source_ref: '#alice#g001#t01' });
    expect(result.attachment.path).toBe(`${store}/records/handoffs/${id}.md`);
    expect(readGoalWithTasks('g001', 'alice').attachments).toHaveLength(1);
    expect(fs.existsSync(path.join(f.db, 'g001.jsonl'))).toBe(false);
  });

  it('preserves an explicit namespace when another current username is configured', () => {
    const f = fixture({ username: 'alice' });
    const other = path.join(f.db, 'bob', 'g001.jsonl');
    fs.mkdirSync(path.dirname(other));
    fs.copyFileSync(f.file, other);
    const before = fs.readFileSync(f.file, 'utf8');
    const result = recordHandoff('#bob#g1#t1', input);
    expect(result.goal_ref).toBe('#bob#g001');
    expect(result.source_ref).toBe('#bob#g001#t01');
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
    expect(readGoalWithTasks('g001', 'bob').attachments).toHaveLength(1);
  });

  it('returns the same immutable artifact on exact retries without another event', () => {
    const f = fixture();
    const first = recordHandoff('#g1', input);
    const before = fs.readFileSync(f.file, 'utf8');
    const artifact = fs.readFileSync(f.artifact, 'utf8');
    expect(recordHandoff('#g001', { ...input, reason: 'completed', incomplete: false })).toEqual(first);
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
    expect(fs.readFileSync(f.artifact, 'utf8')).toBe(artifact);
    for (const changed of [
      { context: `${input.context}\n` }, { agent_id: 'different-dev' }, { manager_id: 'different-manager' },
      { reason: 'reassignment' }, { incomplete: true },
    ]) expect(() => recordHandoff('#g1', { ...input, ...changed })).toThrow(/different content|conflicts/);
    expect(() => recordHandoff('#g1#t1', input)).toThrow(/different content|conflicts/);
    appendEvent('g002', { event: 'goal_created', goal_id: 'g002', title: 'Another Goal', status: 'open' }, { expectedRevision: 0 });
    expect(() => recordHandoff('#g2', input)).toThrow('different content');
    expect(readGoalWithTasks('g002').attachments || []).toEqual([]);
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
  });

  it('records an explicit emergency fallback only for incomplete critical context', () => {
    const f = fixture();
    const result = recordHandoff('#g1', { ...input, context: '', reason: 'resource_critical', incomplete: true });
    expect(result.incomplete).toBe(true);
    expect(result.context).toContain('No developer context was available');
    expect(fs.readFileSync(f.artifact, 'utf8')).toContain('Incomplete handoff.');
    expect(recordHandoff('#g1', { ...input, context: '', reason: 'resource_critical', incomplete: true })).toEqual(result);
  });

  it('rejects invalid references and nonexistent tasks before creating artifacts', () => {
    const f = fixture();
    const before = fs.readFileSync(f.file, 'utf8');
    for (const ref of ['#g99', '#g1#t99', '#l1', '#c1', '#g1#r1', '#g1#t1#A1', '../../outside', '#t1']) {
      expect(() => recordHandoff(ref, input)).toThrow();
    }
    expect(fs.existsSync(path.join(f.root, f.store, 'records'))).toBe(false);
    expect(fs.readFileSync(f.file, 'utf8')).toBe(before);
  });

  it('validates context, identities, emergency markers and path-safe idempotency IDs before writing', () => {
    const f = fixture();
    for (const invalid of [
      null, [], { ...input, context: '' }, { ...input, context: null },
      { ...input, context: '', reason: 'resource_critical' },
      { ...input, context: '', incomplete: true }, { ...input, incomplete: 'true' },
      { ...input, reason: 'force' }, { ...input, agent_id: '' }, { ...input, manager_id: 'x\ny' },
      { ...input, handoff_id: '../outside' }, { ...input, path: '/tmp/outside.md' },
    ]) expect(() => recordHandoff('#g1', invalid)).toThrow();
    expect(fs.existsSync(path.join(f.root, f.store, 'records'))).toBe(false);
  });

  it('preserves the artifact on journal contention, reports failure, then attaches it on a safe retry', () => {
    const f = fixture();
    fs.writeFileSync(`${f.file}.lock`, 'busy');
    expect(() => recordHandoff('#g1', input)).toThrow('could not be attached');
    expect(fs.readFileSync(f.artifact, 'utf8')).toContain(input.context);
    expect(readGoalWithTasks('g001').attachments || []).toEqual([]);
    fs.unlinkSync(`${f.file}.lock`);
    expect(recordHandoff('#g1', input).success).toBe(true);
    expect(readGoalWithTasks('g001').attachments).toHaveLength(1);
  });

  it('keeps canonical revision protection when another Goal writer wins before attachment', () => {
    const f = fixture();
    const sync = fs.fsyncSync;
    let amended = false;
    vi.spyOn(fs, 'fsyncSync').mockImplementation((descriptor) => {
      sync.call(fs, descriptor);
      if (!amended) {
        amended = true;
        appendEvent('g001', { event: 'updated', goal_id: 'g001', title: 'Concurrent update' }, { expectedRevision: 2 });
      }
    });
    expect(() => recordHandoff('#g1', input)).toThrow('Revision conflict');
    expect(readGoalWithTasks('g001')).toMatchObject({ title: 'Concurrent update', revision: 3 });
    expect(readGoalWithTasks('g001').attachments || []).toEqual([]);
    expect(recordHandoff('#g1', input).success).toBe(true);
    expect(readGoalWithTasks('g001')).toMatchObject({ title: 'Concurrent update', revision: 4 });
  });

  it('does not report attachment success after an actual journal append failure', () => {
    const f = fixture();
    const append = fs.appendFileSync;
    vi.spyOn(fs, 'appendFileSync').mockImplementation((file, ...args) => {
      if (file === f.file) throw new Error('disk write failed');
      return append.call(fs, file, ...args);
    });
    expect(() => recordHandoff('#g1', input)).toThrow('disk write failed');
    expect(readGoalWithTasks('g001').attachments || []).toEqual([]);
    expect(fs.existsSync(f.artifact)).toBe(true);
  });

  it('cleans up failed artifact creation without appending an attachment', () => {
    const f = fixture();
    vi.spyOn(fs, 'fsyncSync').mockImplementation(() => { throw new Error('fsync failed'); });
    expect(() => recordHandoff('#g1', input)).toThrow('fsync failed');
    expect(fs.existsSync(f.artifact)).toBe(false);
    expect(readGoalWithTasks('g001').attachments || []).toEqual([]);
  });

  it('refuses changed or missing artifacts and does not undo explicit detachment', () => {
    const f = fixture();
    const result = recordHandoff('#g1', input);
    const original = fs.readFileSync(f.artifact, 'utf8');
    fs.writeFileSync(f.artifact, 'changed');
    expect(() => recordHandoff('#g1', input)).toThrow('different content');
    fs.unlinkSync(f.artifact);
    expect(() => recordHandoff('#g1', input)).toThrow('artifact is missing');
    expect(fs.existsSync(f.artifact)).toBe(false);
    fs.writeFileSync(f.artifact, original);
    appendEvent('g001', { event: 'attachment_removed', goal_id: 'g001', attachment_id: result.attachment.id }, { expectedRevision: 3 });
    expect(() => recordHandoff('#g1', input)).toThrow('previously detached');
    expect(readGoalWithTasks('g001').attachments).toEqual([]);
  });

  it('rejects symlinked storage or artifacts without writing outside the shared store', () => {
    const f = fixture();
    const outside = path.join(f.root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(f.root, f.store, 'records'));
    expect(() => recordHandoff('#g1', input)).toThrow('ordinary directory');
    expect(fs.readdirSync(outside)).toEqual([]);
    fs.unlinkSync(path.join(f.root, f.store, 'records'));
    fs.mkdirSync(path.dirname(f.artifact), { recursive: true });
    const externalFile = path.join(outside, 'context.md');
    fs.writeFileSync(externalFile, 'preserve');
    fs.symlinkSync(externalFile, f.artifact);
    expect(() => recordHandoff('#g1', input)).toThrow('ordinary Markdown file');
    expect(fs.readFileSync(externalFile, 'utf8')).toBe('preserve');
  });
});
