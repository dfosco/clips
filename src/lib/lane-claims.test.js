// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { getRepositoryIdentity, listLaneClaims, mutateLaneClaim, readLaneClaim } from './lane-claims.js';
import { readBoardData } from './board.js';

const roots = [];
const cli = path.resolve('src/cli.js');
const moduleUrl = pathToFileURL(path.resolve('src/lib/lane-claims.js')).href;
const alice = { host: 'paseo-host-A', runtime: 'paseo', session_id: 'alice-session', workspace_id: 'work-A', contact: 'paseo agent alice-session' };
const bob = { host: 'paseo-host-A', runtime: 'paseo', session_id: 'bob-session', contact: 'paseo agent bob-session' };
const carol = { host: 'terminal-host-B', runtime: 'codex', session_id: 'carol-session' };
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-claims-'));
  roots.push(root);
  const projectPath = path.join(root, 'repo');
  fs.mkdirSync(projectPath);
  execFileSync('git', ['init', '--quiet'], { cwd: projectPath });
  const options = { projectPath, claimsDir: path.join(root, 'claims') };
  return { root, projectPath, options };
}
function mutate(options, action, revision, actor = alice, extra = {}, ref = '#l1') {
  return mutateLaneClaim(ref, action, { expected_revision: revision, actor, ...extra }, options);
}
function findJson(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? findJson(path.join(directory, entry.name)) : entry.name.endsWith('.json') ? [path.join(directory, entry.name)] : []);
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('durable Lane manager ownership', () => {
  it('shares across worktrees and symlinks, isolates repositories, and refuses username namespaces', () => {
    const { root, projectPath, options } = fixture();
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture', '--quiet'], { cwd: projectPath });
    const worktree = path.join(root, 'worktree');
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree], { cwd: projectPath });
    const linked = path.join(root, 'linked');
    fs.symlinkSync(projectPath, linked);
    expect(getRepositoryIdentity(worktree)).toBe(getRepositoryIdentity(projectPath));
    expect(getRepositoryIdentity(linked)).toBe(getRepositoryIdentity(projectPath));
    mutate(options, 'claim', 0);
    mutate(options, 'claim', 0, alice, {}, '#l2');
    expect(readLaneClaim('#l1', { ...options, projectPath: worktree }).owners[0]).toMatchObject(alice);
    expect(listLaneClaims(options).map((item) => item.lane_id)).toEqual(['l001', 'l002']);
    expect(() => readLaneClaim('#l1', { ...options, namespace: 'other' })).toThrow('do not have ownership namespaces');
    expect(() => mutate({ ...options, namespace: 'other' }, 'claim', 0, bob)).toThrow('do not have ownership namespaces');
    expect(readLaneClaim('#l1', options).owners[0]).toMatchObject(alice);
    const second = fixture();
    expect(readLaneClaim('#l1', { ...options, projectPath: second.projectPath }).owners).toEqual([]);
  });

  it('never expires or displaces ownership and reports coordination identities on conflict', () => {
    const { options } = fixture();
    const state = mutate(options, 'claim', 0);
    expect(mutate(options, 'claim', 1)).toEqual(state);
    expect(() => mutate(options, 'claim', 1, bob)).toThrow('paseo agent alice-session');
    expect(() => mutate(options, 'claim', 0, bob)).toThrow('Revision conflict');
    expect(() => mutate(options, 'release', 1, bob)).toThrow('managed by');
    expect(() => mutate(options, 'share', 1, bob, { owner: carol })).toThrow('managed by');
    expect(readLaneClaim('#l1', options)).toEqual(state);
  });

  it('supports explicit sharing and self-release while retaining other managers and history', () => {
    const { options } = fixture();
    mutate(options, 'claim', 0);
    const shared = mutate(options, 'share', 1, alice, { owner: bob });
    expect(shared.owners.map((owner) => owner.session_id)).toEqual([alice.session_id, bob.session_id]);
    expect(mutate(options, 'share', 2, alice, { owner: bob })).toEqual(shared);
    const released = mutate(options, 'release', 2);
    expect(released.owners).toEqual([shared.owners[1]]);
    expect(released.history.map((entry) => entry.action)).toEqual(['claim', 'share', 'release']);
    mutate(options, 'release', 3, bob);
    expect(listLaneClaims(options)[0]).toMatchObject({ revision: 4, owners: [] });
    expect(mutate(options, 'claim', 4, carol).history).toHaveLength(5);
  });

  it('requires recorded explicit user authority for handover and replaces only the selected manager', () => {
    const { options } = fixture();
    mutate(options, 'claim', 0);
    mutate(options, 'share', 1, alice, { owner: bob });
    expect(() => mutate(options, 'handover', 2, carol, { owner: carol, from: alice })).toThrow('explicit user authorization');
    expect(() => mutate(options, 'handover', 2, carol, { owner: carol, from: alice, authorization: { by: 'user', reason: '' } })).toThrow('authorization.reason');
    const authorization = { by: 'Daniel', reason: 'Explicitly replace the unavailable Alice session with Carol; preserve Bob.' };
    expect(() => mutate(options, 'handover', 1, carol, { owner: carol, from: alice, authorization })).toThrow('Revision conflict');
    const state = mutate(options, 'handover', 2, carol, { owner: carol, from: alice, authorization });
    expect(state.owners.map((owner) => owner.session_id)).toEqual([bob.session_id, carol.session_id]);
    expect(state.history[2]).toMatchObject({ action: 'handover', actor: carol, authorization });
    expect(readLaneClaim('#l1', options)).toEqual(state);
  });

  it('fails closed for malformed or inconsistent storage and held write locks', () => {
    const { options } = fixture();
    const state = mutate(options, 'claim', 0);
    const [file] = findJson(options.claimsDir);
    for (const content of ['', '{bad json', JSON.stringify({ ...state, owners: [] }), JSON.stringify({ ...state, revision: 0 }), JSON.stringify({ ...state, repository_id: 'wrong' })]) {
      fs.writeFileSync(file, content);
      expect(() => readLaneClaim('#l1', options)).toThrow('Ownership is unknown');
      expect(() => mutate(options, 'claim', 0, bob)).toThrow('Ownership is unknown');
      expect(fs.readFileSync(file, 'utf8')).toBe(content);
      expect(fs.existsSync(`${file}.lock`)).toBe(false);
    }
    fs.writeFileSync(file, JSON.stringify(state));
    fs.writeFileSync(`${file}.lock`, 'held by another writer');
    expect(() => mutate(options, 'release', 1)).toThrow('Record is being written');
    expect(readLaneClaim('#l1', options)).toEqual(state);
    expect(fs.readFileSync(`${file}.lock`, 'utf8')).toBe('held by another writer');
  });

  it('accepts only one concurrent claimant without lost history or accidental shared ownership', async () => {
    const { options } = fixture();
    const script = `import { mutateLaneClaim } from ${JSON.stringify(moduleUrl)}; try { mutateLaneClaim('#l1','claim',JSON.parse(process.argv[1]),JSON.parse(process.argv[2])); } catch(e) { console.error(e.message); process.exitCode=1; }`;
    const run = (actor) => new Promise((resolve) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ expected_revision: 0, actor }), JSON.stringify(options)]);
      let stderr = '';
      child.stderr.on('data', (data) => { stderr += data; });
      child.on('close', (code) => resolve({ code, stderr }));
    });
    const results = await Promise.all([run(alice), run(bob)]);
    expect(results.filter(({ code }) => code === 0)).toHaveLength(1);
    expect(results.find(({ code }) => code !== 0).stderr).toMatch(/Revision conflict|Record is being written/);
    expect(readLaneClaim('#l1', options)).toMatchObject({ revision: 1 });
    expect(readLaneClaim('#l1', options).owners).toHaveLength(1);
    expect(listLaneClaims(options)[0].history).toHaveLength(1);
  });

  it('CLI uses user storage, supports inspection and mutation JSON, and never syncs claims', () => {
    const { root, projectPath } = fixture();
    const env = { ...process.env, CLIPS_HOME: path.join(root, 'user-clips'), CLIPS_SWITCH_INIT: '1' };
    fs.mkdirSync(path.join(projectPath, '.clips', 'db'), { recursive: true });
    fs.writeFileSync(path.join(projectPath, '.clips', 'clips.config.json'), '{"collaboration":false}');
    const run = (...args) => JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: projectPath, env, encoding: 'utf8' }));
    run('lane', 'create', '{"title":"A Lane"}');
    expect(run('lane', 'manager', 'inspect', '#l1', '--json')).toMatchObject({ revision: 0, owners: [] });
    const payload = { expected_revision: 0, actor: alice };
    expect(run('lane', 'manager', 'claim', '#l1', JSON.stringify(payload), '--json')).toMatchObject({ revision: 1 });
    const requestFile = path.join(root, 'share.json');
    fs.writeFileSync(requestFile, JSON.stringify({ expected_revision: 1, actor: alice, owner: bob }));
    expect(run('lane', 'manager', 'share', '#l1', '--file', requestFile).owners).toHaveLength(2);
    const release = spawnSync(process.execPath, [cli, 'lane', 'manager', 'release', '#l1', '--stdin', '--json'], {
      cwd: projectPath, env, encoding: 'utf8', input: JSON.stringify({ expected_revision: 2, actor: alice }),
    });
    expect(release.status).toBe(0);
    expect(JSON.parse(release.stdout).owners[0]).toMatchObject(bob);
    expect(run('lane', 'manager', 'list', '--json')).toHaveLength(1);
    const namespace = spawnSync(process.execPath, [cli, 'lane', 'manager', 'list', '--namespace', 'other', '--json'], { cwd: projectPath, env, encoding: 'utf8' });
    expect(namespace.status).not.toBe(0);
    const bad = spawnSync(process.execPath, [cli, 'lane', 'manager', 'claim', '#l1', JSON.stringify({ expected_revision: 3, actor: carol })], { cwd: projectPath, env, encoding: 'utf8' });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain(bob.contact);
    expect(findJson(env.CLIPS_HOME)).toHaveLength(1);
    expect(fs.readdirSync(path.join(projectPath, '.clips', 'db'))).toEqual(['tracks']);
  });

  it('projects ownership separately from Lane status and exposes corrupt ownership as an error', () => {
    const { projectPath, options } = fixture();
    const dbDir = path.join(projectPath, '.clips', 'db');
    fs.mkdirSync(path.join(dbDir, 'tracks'), { recursive: true });
    fs.writeFileSync(path.join(dbDir, 'tracks', 'r001.jsonl'), JSON.stringify({ event: 'track_created', track_id: 'r001', title: 'Work', status: 'open' }));
    const boardOptions = { dbDir, ...options };
    expect(readBoardData(boardOptions).lanes[0]).toMatchObject({ status: 'open', manager_claim: { revision: 0, owners: [] }, manager_claim_error: null });
    mutate(options, 'claim', 0);
    expect(readBoardData(boardOptions).lanes[0]).toMatchObject({ status: 'open', manager_claim: { revision: 1, owners: [alice] } });
    const [file] = findJson(options.claimsDir);
    fs.writeFileSync(file, 'corrupt');
    const board = readBoardData(boardOptions);
    expect(board.lanes[0]).toMatchObject({ status: 'open', manager_claim: null });
    expect(board.lanes[0].manager_claim_error).toContain('Ownership is unknown');
    expect(board.warnings).toMatchObject([{ kind: 'lane_claim', lane_id: 'l001' }]);
  });
});
