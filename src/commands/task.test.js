import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cli = path.resolve('src/cli.js');
const workspaces = [];

function workspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-contract-'));
  workspaces.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  fs.mkdirSync(path.join(cwd, '.clips', 'db'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: false }));
  return cwd;
}

function run(cwd, ...args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' }));
}

function fails(cwd, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  expect(result.status).toBe(1);
  return result.stderr;
}

const json = JSON.stringify;
const show = (cwd) => run(cwd, 'goal', 'show', 'g1');
const task = (cwd, id = 't01') => show(cwd).tasks.find((item) => item.task_id === id);
const receipt = (criteria = [], rest = {}) => ({
  artifact: { fixture: 'a-specific-test-delivery-candidate' },
  accepted_by: 'lead', summary: 'Result accepted against the recorded request.',
  criteria: criteria.map((id) => ({ id, status: 'satisfied', evidence: `Observed fixture evidence for ${id}` })),
  ...rest,
});

function create(cwd, taskData = {}, goalData = {}) {
  run(cwd, 'goal', 'create', json({ title: 'Restore selection', ...goalData }));
  return run(cwd, 'task', 'create', 'g1', json({ title: 'Persist selection', ...taskData }));
}

afterEach(() => {
  for (const cwd of workspaces.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('extensible tasks as change requests and records', () => {
  it('round-trips contracts and custom nested data without discarding unrelated keys', () => {
    const cwd = workspace();
    create(cwd, {
      description: 'Persist the stable item identity.', scope: 'Saved selection in component #c1.',
      components: ['#c1#r1', '#team#c2'], owner: 'storage', acceptance_owner: 'lead',
      record: 'Investigation findings.',
      sections: { Context: 'Existing notes', Risks: 'Known tradeoff' },
      extensions: { review: { url: 'local-review', phase: 'draft' }, custom: { retained: true } },
    });
    run(cwd, 'task', 'update', '#g1#t1', json({
      record: 'Implemented the persisted item identity.',
      sections: { Risks: null, Findings: 'Observed store behavior' },
      extensions: { review: { phase: 'accepted' } },
    }));
    expect(task(cwd)).toMatchObject({
      description: 'Persist the stable item identity.', scope: 'Saved selection in component #c1.',
      components: ['#c1#r1', '#team#c2'], owner: 'storage', acceptance_owner: 'lead',
      record: 'Implemented the persisted item identity.',
      sections: { Context: 'Existing notes', Findings: 'Observed store behavior' },
      extensions: { review: { url: 'local-review', phase: 'accepted' }, custom: { retained: true } },
    });
    expect(task(cwd).sections).not.toHaveProperty('Risks');
    expect(fails(cwd, 'task', 'update', 'g1', 't1', json({ event: 'goal_created' }))).toContain('Unsupported task fields: event');
    expect(fails(cwd, 'task', 'update', 'g1', 't1', json({ status: 'closed' }))).toContain('Unsupported task fields: status');
    expect(fails(cwd, 'task', 'create', 'g1', json({ title: 'Unknown', silent_custom_field: true }))).toContain('Use sections');
  });

  it('preserves criterion identities through reordering and never reuses removed IDs', () => {
    const cwd = workspace();
    create(cwd, { acceptance_criteria: ['Saved value survives reopening', { id: 'A8', description: 'Old preferences survive', extra: { owner: 'consumer' } }] });
    run(cwd, 'task', 'update', 'g1', 't1', json({ acceptance_criteria: [
      { id: 'A8', description: 'Old preferences survive' },
      'Saved value survives reopening',
    ] }));
    expect(task(cwd).acceptance_criteria.map((item) => item.id)).toEqual(['A8', 'A1']);
    expect(task(cwd).acceptance_criteria[0].extra).toEqual({ owner: 'consumer' });
    run(cwd, 'task', 'update', 'g1', 't1', json({ acceptance_criteria: [{ id: 'A8', description: 'Old preferences survive' }] }));
    run(cwd, 'task', 'update', 'g1', 't1', json({ acceptance_criteria: [
      { id: 'A8', description: 'Old preferences survive' }, 'Clearing selection persists',
    ] }));
    expect(task(cwd).acceptance_criteria.map((item) => item.id)).toEqual(['A8', 'A9']);
    expect(fails(cwd, 'task', 'update', 'g1', 't1', json({ acceptance_criteria: [{ id: 'A1', description: 'Reused ID' }] }))).toContain('retired or reserved');
    expect(fails(cwd, 'task', 'update', 'g1', 't1', json({ acceptance_criteria: [{ id: 'A8', description: 'First' }, { id: 'A8', description: 'Second' }] }))).toContain('Duplicate');
    expect(task(cwd).acceptance_criteria.map((item) => item.id)).toEqual(['A8', 'A9']);
  });

  it('keeps legacy string criteria addressable when existing records are edited', () => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, '.clips/db/g001.jsonl'), [
      { event: 'goal_created', goal_id: 'g001', title: 'Legacy goal', acceptance_criteria: ['Goal result'], status: 'open' },
      { event: 'task_created', goal_id: 'g001', task_id: 't01', title: 'Legacy task', acceptance_criteria: ['First', 'Second'], custom_legacy_data: { retained: true } },
    ].map(json).join('\n') + '\n');
    run(cwd, 'task', 'update', 'g1', 't1', json({ acceptance_criteria: ['Second', 'First'], record: 'Additional findings' }));
    expect(task(cwd)).toMatchObject({ custom_legacy_data: { retained: true }, acceptance_criteria: [{ id: 'A2', description: 'Second' }, { id: 'A1', description: 'First' }] });
  });

  it('reads exact JSON from files and stdin', () => {
    const cwd = workspace();
    run(cwd, 'goal', 'create', json({ title: 'Input support' }));
    const file = path.join(cwd, 'request.json');
    fs.writeFileSync(file, json({ title: 'Literal `template` and $value', description: 'first line\nsecond line', acceptance_criteria: ['Readable'] }));
    run(cwd, 'task', 'create', 'g1', '--file', file);
    const result = spawnSync(process.execPath, [cli, 'task', 'update', '#g1#t1', '--stdin'], {
      cwd, input: json({ record: 'Observed result\nwith a second line' }), encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(task(cwd)).toMatchObject({ title: 'Literal `template` and $value', description: 'first line\nsecond line', record: 'Observed result\nwith a second line' });
  });
});

describe('explicit acceptance and recoverable agreements', () => {
  it('requires evidence or reasoned waivers for every criterion and respects the recorded acceptance owner', () => {
    const cwd = workspace();
    create(cwd, { acceptance_owner: 'lead', acceptance_criteria: ['Persisted', 'Preserved'] });
    expect(fails(cwd, 'task', 'accept', 'g1', 't1', json(receipt(['A1'])))).toContain('Missing acceptance evidence: A2');
    expect(fails(cwd, 'task', 'accept', 'g1', 't1', json(receipt(['A1', 'A2'], { accepted_by: 'worker' })))).toContain('Acceptance owner');
    expect(fails(cwd, 'task', 'accept', 'g1', 't1', json(receipt(['A1', 'A2'], { criteria: [{ id: 'A1', status: 'satisfied', evidence: '' }, { id: 'A2', status: 'waived', reason: 'Authorized fixture exception' }] })))).toContain('non-empty');
    expect(fails(cwd, 'task', 'accept', 'g1', 't1', json(receipt([], { criteria: [{ id: 'A1', status: 'waived' }, { id: 'A2', status: 'waived', reason: 'Some reason' }] })))).toContain('waiver reason');
    expect(task(cwd).status).toBe('open');
    run(cwd, 'task', 'accept', '#g1#t1', json(receipt([], { criteria: [
      { id: 'A1', status: 'satisfied', evidence: { method: 'read-after-reopen fixture', result: 'same identity' } },
      { id: 'A2', status: 'waived', reason: 'Lead records an authorized exception for this fixture' },
    ] })));
    expect(task(cwd).acceptance.criteria[1]).toMatchObject({ id: 'A2', status: 'waived' });
    expect(task(cwd).status).toBe('closed');
    expect(show(cwd).status).toBe('open');
  });

  it('preserves the request and record, and accepts only the selected task', () => {
    const cwd = workspace();
    create(cwd, { description: 'Store selected identity', scope: '#c1 selection only', acceptance_criteria: ['Persisted'] });
    run(cwd, 'task', 'create', 'g1', json({ title: 'Restore in the UI' }));
    run(cwd, 'task', 'update', 'g1', 't1', json({ record: 'Added storage behavior and observed reopening.' }));
    const before = task(cwd);
    run(cwd, 'task', 'accept', 'g1', 't1', json(receipt(['A1'])));
    expect(task(cwd)).toMatchObject({
      status: 'closed', description: 'Store selected identity', record: 'Added storage behavior and observed reopening.',
      acceptance: { request_revision: before.revision, request_snapshot: { description: 'Store selected identity', scope: '#c1 selection only' } },
    });
    expect(task(cwd, 't02').status).toBe('open');
    expect(show(cwd).status).toBe('open');
    expect(fails(cwd, 'goal', 'accept', 'g1', json(receipt()))).toContain('unresolved tasks: t02');
  });

  it('retains acceptance during notes, ownership and criterion reordering, then archives it on changed expectations', () => {
    const cwd = workspace();
    create(cwd, { acceptance_criteria: ['First outcome', 'Second outcome'] });
    run(cwd, 'task', 'accept', 'g1', 't1', json(receipt(['A1', 'A2'])));
    run(cwd, 'goal', 'accept', 'g1', json(receipt()));
    run(cwd, 'task', 'update', 'g1', 't1', json({ owner: 'replacement', record: 'More precise result wording', sections: { Notes: 'Handoff context' }, extensions: { agent: { context: 'recoverable' } } }));
    run(cwd, 'task', 'update', 'g1', 't1', json({ acceptance_criteria: [{ id: 'A2', description: 'Second outcome' }, { id: 'A1', description: 'First outcome' }] }));
    expect(task(cwd).status).toBe('closed');
    expect(task(cwd).acceptance).toBeTruthy();
    expect(show(cwd).acceptance).toBeTruthy();
    run(cwd, 'task', 'update', 'g1', 't1', json({ scope: 'Expanded storage behavior' }));
    expect(task(cwd)).toMatchObject({ status: 'open', acceptance: null });
    expect(task(cwd).acceptance_history[0]).toMatchObject({ summary: 'Result accepted against the recorded request.', invalidation_reason: 'The work agreement changed' });
    expect(show(cwd)).toMatchObject({ status: 'open', acceptance: null });
    expect(show(cwd).acceptance_history).toHaveLength(1);
  });

  it('requires explicit exceptions for skipped child tasks and never invents child receipts', () => {
    const cwd = workspace();
    create(cwd);
    run(cwd, 'task', 'create', 'g1', json({ title: 'Optional follow-up agreed out of scope' }));
    run(cwd, 'task', 'status', 'g1', 't1', 'closed');
    run(cwd, 'task', 'status', 'g1', 't2', 'not_planned');
    expect(task(cwd).acceptance).toBeUndefined();
    expect(fails(cwd, 'goal', 'accept', 'g1', json(receipt()))).toContain('Explicit exceptions are required for: t02');
    run(cwd, 'goal', 'accept', 'g1', json(receipt([], { exceptions: [{ ref: '#g1#t2', reason: 'User explicitly deferred this follow-up' }] })));
    expect(show(cwd).status).toBe('closed');
    expect(show(cwd).acceptance.task_basis.map((item) => item.acceptance)).toEqual([null, null]);
    expect(task(cwd, 't02').status).toBe('not_planned');
    run(cwd, 'task', 'create', 'g1', json({ title: 'Newly requested work' }));
    expect(show(cwd)).toMatchObject({ status: 'open', acceptance: null });
  });

  it('reconsiders inherited verification changes while preserving explicit task modes', () => {
    const cwd = workspace();
    create(cwd);
    run(cwd, 'task', 'create', 'g1', json({ title: 'Explicit mode task', verification_mode: 'behavior' }));
    run(cwd, 'task', 'accept', 'g1', 't1', json(receipt()));
    run(cwd, 'task', 'accept', 'g1', 't2', json(receipt()));
    const original = task(cwd).revision;
    run(cwd, 'goal', 'update', 'g1', json({ verification_mode: 'behavior_and_tests' }));
    expect(task(cwd)).toMatchObject({ status: 'open', acceptance: null, effective_verification_mode: 'behavior_and_tests' });
    expect(task(cwd).revision).toBe(original + 1);
    expect(task(cwd, 't02')).toMatchObject({ status: 'closed', effective_verification_mode: 'behavior' });
    expect(task(cwd, 't02').acceptance).toBeTruthy();
  });

  it('keeps administrative dispositions separate from accepted completion', () => {
    const cwd = workspace();
    create(cwd);
    run(cwd, 'task', 'accept', 'g1', 't1', json(receipt()));
    run(cwd, 'task', 'status', 'g1', 't1', 'duplicate');
    expect(task(cwd)).toMatchObject({ status: 'duplicate', acceptance: null });
    run(cwd, 'goal', 'status', 'g1', 'closed');
    expect(show(cwd).acceptance).toBeUndefined();
  });

  it('records recoverable component revisions and honors explicit negotiated pins', () => {
    const cwd = workspace();
    run(cwd, 'component', 'create', json({ title: 'UI-state storage', contract: 'Original contract' }));
    create(cwd, { components: ['#c1'] }, { components: ['#c1'] });
    run(cwd, 'task', 'create', 'g1', json({ title: 'Work against the original boundary', components: ['#c1#r1'] }));
    run(cwd, 'component', 'update', '#c1', json({ contract: 'Second contract' }));
    run(cwd, 'task', 'accept', 'g1', 't1', json(receipt()));
    run(cwd, 'component', 'update', '#c1', json({ contract: 'Third contract' }));
    run(cwd, 'task', 'accept', 'g1', 't2', json(receipt()));
    expect(task(cwd).acceptance).toMatchObject({ component_basis: ['#c001#r2'], request_snapshot: { components: ['#c1'] } });
    expect(task(cwd, 't02').acceptance.component_basis).toEqual(['#c001#r1']);
    expect(run(cwd, 'component', 'show', task(cwd).acceptance.component_basis[0]).contract).toBe('Second contract');
    run(cwd, 'goal', 'accept', 'g1', json(receipt()));
    expect(show(cwd).acceptance.component_basis).toEqual(['#c001#r3']);
    run(cwd, 'component', 'update', '#c1', json({ contract: 'Fourth contract' }));
    expect(show(cwd).acceptance.component_basis).toEqual(['#c001#r3']);
    expect(task(cwd).acceptance.component_basis).toEqual(['#c001#r2']);
  });

  it('rejects unresolvable component claims before accepting work', () => {
    const cwd = workspace();
    create(cwd, { components: ['#c9'] });
    expect(fails(cwd, 'task', 'accept', 'g1', 't1', json(receipt()))).toContain('component #c9 was not found');
    run(cwd, 'task', 'update', 'g1', 't1', json({ components: ['#g1'] }));
    expect(fails(cwd, 'task', 'accept', 'g1', 't1', json(receipt()))).toContain('not a component reference');
    run(cwd, 'component', 'create', json({ title: 'Storage' }));
    run(cwd, 'task', 'update', 'g1', 't1', json({ components: ['#c1#r9'] }));
    expect(fails(cwd, 'task', 'accept', 'g1', 't1', json(receipt()))).toContain('has no revision');
    expect(task(cwd).status).toBe('open');
    expect(task(cwd).acceptance).toBeUndefined();
  });

  it('uses the supplied delivery artifact without claiming local HEAD was verified', () => {
    const cwd = workspace();
    fs.writeFileSync(path.join(cwd, 'source.txt'), 'A committed fixture\n');
    execFileSync('git', ['add', 'source.txt'], { cwd });
    execFileSync('git', ['-c', 'user.name=Clips Test', '-c', 'user.email=clips-test@example.invalid', 'commit', '--quiet', '-m', 'Fixture candidate'], { cwd });
    const localHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    create(cwd);
    const deliveredArtifact = { source: 'a-different-explicit-delivery-candidate', environment: 'isolated fixture' };
    run(cwd, 'task', 'accept', 'g1', 't1', json(receipt([], { artifact: deliveredArtifact })));
    expect(task(cwd)).toMatchObject({ closed_commit_sha: null, acceptance: { artifact: deliveredArtifact } });
    run(cwd, 'goal', 'accept', 'g1', json(receipt([], { artifact: deliveredArtifact })));
    expect(show(cwd)).toMatchObject({ closed_commit_sha: null, acceptance: { artifact: deliveredArtifact } });
    run(cwd, 'task', 'create', 'g1', json({ title: 'Administrative status fixture' }));
    run(cwd, 'task', 'status', 'g1', 't2', 'closed');
    expect(task(cwd, 't02').closed_commit_sha).toBe(localHead);
    expect(task(cwd, 't02').acceptance).toBeUndefined();
  });
});

describe('stale writes and dependency coordination', () => {
  it('rejects stale or historical mutations without changing current records', () => {
    const cwd = workspace();
    create(cwd, { acceptance_criteria: ['Observed outcome'] });
    const basis = task(cwd).revision;
    run(cwd, 'task', 'update', 'g1', 't1', json({ record: 'New context', expected_revision: basis }));
    expect(fails(cwd, 'task', 'update', 'g1', 't1', json({ description: 'Stale replacement', expected_revision: basis }))).toMatch(/revision/i);
    expect(fails(cwd, 'task', 'accept', 'g1', 't1', json(receipt(['A1'], { expected_revision: basis })))).toMatch(/revision/i);
    for (const ref of ['#g1#t1#r1', '#g1#t1#A1']) {
      expect(fails(cwd, 'task', 'update', ref, json({ record: 'Wrong target' }))).toContain('current goal/task');
    }
    expect(fails(cwd, 'goal', 'update', '#g1#r1', json({ description: 'Wrong target' }))).toContain('Historical');
    expect(task(cwd)).toMatchObject({ description: '', record: 'New context', status: 'open' });
  });

  it('round-trips qualified dependencies and validates complete batches before writing', () => {
    const cwd = workspace();
    run(cwd, 'goal', 'create', json({ title: 'Coordinated work' }));
    run(cwd, 'task', 'create-batch', 'g1', json([
      { title: 'Consume future task', blocked_by: ['#g1#t2'] },
      { title: 'Provide capability' },
    ]));
    expect(task(cwd).blocked_by).toEqual(['#g001#t02']);
    const count = show(cwd).tasks.length;
    expect(fails(cwd, 'task', 'create-batch', 'g1', json([
      { title: 'First otherwise valid task' }, { title: 'Invalid', acceptance_criteria: false },
    ]))).toContain('acceptance_criteria must be an array');
    expect(show(cwd).tasks).toHaveLength(count);
    expect(fails(cwd, 'task', 'create-batch', 'g1', json([
      { title: 'First otherwise valid task' }, { title: 'Invalid revision', expected_revision: 1 },
    ]))).toContain('new task must have expected_revision 0');
    expect(show(cwd).tasks).toHaveLength(count);
    expect(fails(cwd, 'task', 'update', 'g1', 't2', json({ blocked_by: ['#t1'] }))).toContain('cycle');
    fs.mkdirSync(path.join(cwd, '.clips/db/alice'));
    fs.writeFileSync(path.join(cwd, '.clips/db/alice/g009.jsonl'), [
      { event: 'goal_created', goal_id: 'g009', title: 'Qualified dependency', status: 'open' },
      { event: 'task_created', goal_id: 'g009', task_id: 't01', title: 'Shared capability' },
    ].map(json).join('\n') + '\n');
    run(cwd, 'task', 'update', 'g1', 't2', json({ blocked_by: ['#alice#g9#t1'] }));
    expect(task(cwd, 't02').blocked_by).toEqual(['#alice#g009#t01']);
    run(cwd, 'task', 'update', '#alice#g9#t1', json({ record: 'Other namespace updated explicitly' }));
    expect(run(cwd, 'goal', 'show', '#alice#g9').tasks[0].record).toBe('Other namespace updated explicitly');
  });

  it('reorders work in progress without renaming tasks or changing acceptance', () => {
    const cwd = workspace();
    create(cwd);
    run(cwd, 'task', 'create', 'g1', json({ title: 'Other task' }));
    run(cwd, 'task', 'status', 'g1', 't1', 'in_progress');
    run(cwd, 'task', 'reorder', 'g1', json(['t2', 't1']));
    expect(show(cwd)._taskOrder).toEqual(['t02', 't01']);
    expect(task(cwd).title).toBe('Persist selection');
    expect(fails(cwd, 'task', 'reorder', 'g1', json(['t1', 't1']))).toContain('exactly once');
  });
});
