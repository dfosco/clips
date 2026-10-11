import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { renderComponent } from './component.js';

const cli = path.resolve(process.cwd(), 'src/cli.js');
const directories = [];
function workspace(username) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-component-command-'));
  directories.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  fs.mkdirSync(path.join(root, '.clips', 'db'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: false, ...(username ? { username } : {}) }));
  return root;
}

function run(root, args, input) {
  return execFileSync(process.execPath, [cli, 'component', ...args], {
    cwd: root, encoding: 'utf8', input,
    env: { ...process.env, CLIPS_SWITCH_INIT: '1' },
  });
}

function rejected(root, args) {
  return spawnSync(process.execPath, [cli, 'component', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' },
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('component commands', () => {
  it('accepts inline, file and stdin JSON and exposes exact historical snapshots', () => {
    const root = workspace();
    const created = JSON.parse(run(root, ['create', '{"title":"Saved tabs"}']));
    expect(created).toMatchObject({ success: true, component_id: 'c001', ref: '#c001', revision: 1 });
    const amendment = path.join(root, 'boundary.json');
    fs.writeFileSync(amendment, JSON.stringify({ responsibility: 'Persist the active tab per workspace.', expected_revision: 1 }));
    expect(JSON.parse(run(root, ['update', '#c1', '--file', amendment])).revision).toBe(2);
    run(root, ['update', '#c1', '--stdin'], JSON.stringify({ contract: 'Unknown saved tabs restore the default tab.', sections: { Recovery: 'Missing values use defaults.' } }));
    const current = JSON.parse(run(root, ['show', '#c1']));
    expect(current).toMatchObject({ responsibility: 'Persist the active tab per workspace.', revision: 3 });
    expect(JSON.parse(run(root, ['show', '#c1#r1']))).toMatchObject({ responsibility: '', contract: '', revision: 1 });
    expect(JSON.parse(run(root, ['history', '#c1'])).map((event) => event.revision)).toEqual([1, 2, 3]);
    expect(fs.existsSync(path.join(root, '.clips', 'components', 'c001.jsonl'))).toBe(true);
    expect(fs.readdirSync(path.join(root, '.clips', 'db'))).toEqual([]);
    expect(renderComponent(current)).toContain('Recovery\nMissing values use defaults.');
  });

  it('rejects pinned edits, invalid criteria refs, stale revisions and malformed input without creating revisions', () => {
    const root = workspace();
    run(root, ['create', '{"title":"Saved tabs"}']);
    for (const args of [
      ['update', '#c1#r1', '{"title":"Cannot amend history"}'],
      ['status', '#c1#r1', 'retired'],
      ['update', '#c1#A1', '{"title":"Cannot amend criterion"}'],
      ['update', '#c1', '{"expected_revision":0,"title":"Stale"}'],
      ['update', '#c1', '{"unknown_field":"use extensions"}'],
      ['update', '#c1', '{'],
    ]) {
      const result = rejected(root, args);
      expect(result.status).not.toBe(0);
    }
    expect(JSON.parse(run(root, ['show', '#c1'])).revision).toBe(1);
    const retired = JSON.parse(run(root, ['status', '#c1', 'retired']));
    expect(retired).toMatchObject({ status: 'retired', revision: 2 });
    expect(JSON.parse(run(root, ['list']))).toHaveLength(1);
  });

  it('keeps repository-wide references independent of the configured username', () => {
    const root = workspace('alice');
    expect(JSON.parse(run(root, ['create', '--namespace', 'alice', '{"title":"Alice boundary"}'])).ref).toBe('#alice#c001');
    expect(rejected(root, ['show', '#c1']).status).not.toBe(0);
    expect(JSON.parse(run(root, ['create', '{"title":"Root boundary"}'])).ref).toBe('#c001');
    expect(JSON.parse(run(root, ['create', '{"title":"Bob boundary"}', '--namespace', 'bob'])).ref).toBe('#bob#c001');
    expect(JSON.parse(run(root, ['show', '#c1'])).title).toBe('Root boundary');
    expect(JSON.parse(run(root, ['list', '--namespace', 'none'])).map((record) => record.title)).toEqual(['Root boundary']);
    expect(JSON.parse(run(root, ['list'])).map((record) => record.ref)).toEqual(['#c001', '#alice#c001', '#bob#c001']);
    run(root, ['update', '#c1', '{"contract":"Root contract"}']);
    run(root, ['update', '#bob#c1', '{"contract":"Bob contract"}']);
    fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: false, username: 'bob' }));
    expect(JSON.parse(run(root, ['show', '#c1'])).contract).toBe('Root contract');
    expect(JSON.parse(run(root, ['show', '#c1#r1'])).title).toBe('Root boundary');
    expect(JSON.parse(run(root, ['show', '#bob#c1'])).contract).toBe('Bob contract');
    expect(JSON.parse(run(root, ['show', '#alice#c1'])).title).toBe('Alice boundary');
    expect(JSON.parse(run(root, ['create', '{"title":"Next shared boundary"}'])).ref).toBe('#c002');
  });

  it('accepts the same root component and explicit namespace after the agent username changes', () => {
    const root = workspace('bob');
    const work = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' },
    }));
    run(root, ['create', '{"title":"Shared storage","contract":"Root original"}']);
    run(root, ['create', '--namespace', 'alice', '{"title":"Alice storage","contract":"Alice original"}']);
    run(root, ['update', '#c1', '{"contract":"Root revised"}']);
    run(root, ['update', '#alice#c1', '{"contract":"Alice revised"}']);
    run(root, ['update', '#alice#c1', '{"sections":{"Notes":"Alice notes"}}']);
    work('goal', 'create', JSON.stringify({ title: 'Update shared storage' }));
    work('task', 'create', 'g1', JSON.stringify({ title: 'Use the agreed storage boundaries', components: ['#c1', '#c1#r1', '#alice#c1'] }));
    fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({ collaboration: false, username: 'alice' }));
    expect(JSON.parse(run(root, ['show', '#c1'])).contract).toBe('Root revised');
    expect(JSON.parse(run(root, ['show', '#alice#c1'])).contract).toBe('Alice revised');
    work('task', 'accept', 'g1', 't1', JSON.stringify({
      artifact: { fixture: 'component-namespace-acceptance' }, accepted_by: 'reviewer',
      summary: 'Accepted against shared and explicitly qualified boundaries.', criteria: [],
    }));
    const receipt = work('goal', 'show', 'g1').tasks[0].acceptance;
    expect(receipt.component_basis).toEqual(['#c001#r2', '#c001#r1', '#alice#c001#r3']);
    expect(JSON.parse(run(root, ['show', receipt.component_basis[0]])).contract).toBe('Root revised');
    expect(JSON.parse(run(root, ['show', receipt.component_basis[1]])).contract).toBe('Root original');
    expect(JSON.parse(run(root, ['show', receipt.component_basis[2]])).contract).toBe('Alice revised');
  });
});
