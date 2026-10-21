import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRepositoryIdentity, mutateLaneClaim, readLaneClaim } from './lane-claims.js';
import { migrateStorage } from './storage-migration.js';
import {
  inspectManagerRegistrations, listManagerRegistrations, mutateManagerRegistration, resolveManagerProject, validateManagerRegistration,
} from './lane-registrations.js';

const roots = [];
const cli = path.resolve('src/cli.js');
const moduleUrl = pathToFileURL(path.resolve('src/lib/lane-registrations.js')).href;
const alice = { runtime: 'copilot', session_id: 'fixture-session-a', contact: 'fixture-native-contact' };
const bob = { runtime: 'paseo', host: 'fixture-host', session_id: 'fixture-session-b' };

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-registrations-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const userStore = path.join(home, '.clips');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(home);
  fs.mkdirSync(outside);
  vi.stubEnv('HOME', home);
  vi.stubEnv('LANES_HOME', userStore);
  vi.stubEnv('CLIPS_HOME', userStore);
  const env = { ...process.env, HOME: home, LANES_HOME: userStore, CLIPS_HOME: userStore, CLIPS_SWITCH_INIT: '1', LANES_SWITCH_INIT: '1' };
  const options = {
    registrationsDir: path.join(userStore, 'lane-managers'),
    registryPath: path.join(userStore, 'projects.json'),
    claimsDir: path.join(userStore, 'lane-claims'),
  };
  function project(name, id = name, store = '.clips', configName = store === '.clips' ? 'clips.config.json' : 'lanes.config.json') {
    const projectPath = path.join(root, name);
    fs.mkdirSync(projectPath);
    execFileSync('git', ['init', '--quiet'], { cwd: projectPath, env });
    const db = path.join(projectPath, store, 'db', 'tracks');
    fs.mkdirSync(db, { recursive: true });
    fs.writeFileSync(path.join(projectPath, store, configName), JSON.stringify({ project_id: id, collaboration: false }));
    fs.writeFileSync(path.join(db, 'r001.jsonl'), JSON.stringify({ event: 'lane_created', lane_id: 'l001', title: `${name} Lane`, status: 'open' }) + '\n');
    return projectPath;
  }
  function registry(projects) {
    fs.mkdirSync(userStore, { recursive: true });
    fs.writeFileSync(options.registryPath, JSON.stringify({ version: 1, projects: projects.map((entry) => ({ path: entry })) }));
  }
  function run(args, extra = {}) {
    return spawnSync(process.execPath, [cli, 'lane', 'manager', ...args], { cwd: outside, env, encoding: 'utf8', ...extra });
  }
  function json(args, extra) {
    const result = run(args, extra);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    return JSON.parse(result.stdout);
  }
  return { root, home, userStore, outside, env, options, project, registry, run, json };
}

function mutate(options, project, revision = 0, actor = alice, action = 'register', extra = {}, lane = '#l1') {
  return mutateManagerRegistration(lane, action, { expected_revision: revision, actor, ...extra }, { ...options, project });
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('central advisory Lane registrations', () => {
  it('validates persisted registrations offline without reading or changing project or user stores', () => {
    const { root, options, project } = fixture();
    const repo = project('one');
    const first = mutate(options, repo);
    mutate(options, repo, 1, alice, 'unregister');
    const file = path.join(options.registrationsDir, `${first.registration_id}.json`);
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    state.future = { untouched: true };
    const before = JSON.stringify(state);
    fs.renameSync(repo, path.join(root, 'unavailable-project'));
    fs.renameSync(options.registrationsDir, path.join(root, 'unavailable-registrations'));
    expect(validateManagerRegistration(state)).toBe(state);
    expect(validateManagerRegistration(state, file)).toBe(state);
    expect(JSON.stringify(state)).toBe(before);
    expect(() => validateManagerRegistration(state, path.join(root, 'wrong.json'))).toThrow('identity mismatch');
    for (const invalid of [
      null, [], { ...state, version: 2 }, { ...state, revision: 0 }, { ...state, status: 'working' },
      { ...state, stopped_at: 'invalid' }, { ...state, registration_id: 'wrong' },
      { ...state, history: [{ ...state.history[0], action: 'unregister' }, state.history[1]] },
      { ...state, history: [state.history[0], { ...state.history[1], actor: bob }] },
      { ...state, history: [state.history[0], { ...state.history[1], runtime_observation: { status: 'busy' } }] },
    ]) expect(() => validateManagerRegistration(invalid)).toThrow('Invalid Lane registration');
  });

  it('registers, refreshes, stops and reactivates self without changing ownership or project registry', () => {
    const { options, project, registry } = fixture();
    const repo = project('one');
    registry([repo]);
    const registryBefore = fs.readFileSync(options.registryPath, 'utf8');
    const claimOptions = { projectPath: repo, claimsDir: options.claimsDir };
    const owner = { ...bob, contact: 'fixture-owner-contact' };
    const claim = mutateLaneClaim('#l1', 'claim', { expected_revision: 0, actor: owner }, claimOptions);
    const created = mutate(options, repo);
    expect(created).toMatchObject({ revision: 1, status: 'working', actor: alice, live_status: 'unknown' });
    expect(created.actor).not.toHaveProperty('host');
    expect(created.freshness).toMatchObject({ runtime_observed_at: null });
    const runtime_observation = { status: 'idle', observed_at: '2020-01-01T00:00:00.000Z', source: 'native get_session fixture' };
    const refreshed = mutate(options, repo, 1, { ...alice, workspace_id: 'fixture-workspace' }, 'register', { runtime_observation });
    expect(refreshed).toMatchObject({ revision: 2, runtime_observation, live_status: 'unknown', registered_at: created.registered_at });
    expect(refreshed.history[1].runtime_observation).toEqual(runtime_observation);
    expect(mutate(options, repo, 0, bob)).toMatchObject({ revision: 1 });
    expect(() => mutate(options, repo, 2, alice, 'unregister', { owner: bob })).toThrow('Unsupported unregister field');
    const stopped = mutate(options, repo, 2, alice, 'unregister');
    expect(stopped).toMatchObject({ status: 'stopped', revision: 3, actor: { workspace_id: 'fixture-workspace' }, runtime_observation });
    expect(mutate(options, repo, 3, alice, 'unregister')).toMatchObject({ revision: 3 });
    expect(mutate(options, repo, 3)).toMatchObject({ revision: 4, status: 'working', stopped_at: null });
    const inspected = inspectManagerRegistrations('#l1', { ...options, project: repo });
    expect(inspected.registrations).toHaveLength(2);
    expect(inspected.claim).toEqual(claim);
    expect(readLaneClaim('#l1', claimOptions)).toEqual(claim);
    expect(fs.readFileSync(options.registryPath, 'utf8')).toBe(registryBefore);
  });

  it('uses canonical worktree/repository identity and isolates identical Lane IDs across projects', () => {
    const { root, env, options, project, registry } = fixture();
    const first = project('first'), second = project('second');
    registry([first, second]);
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: first, env });
    const worktree = path.join(root, 'worktree');
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree], { cwd: first, env });
    const linked = path.join(root, 'linked');
    fs.symlinkSync(first, linked);
    const state = mutate(options, worktree);
    expect(state.project).toMatchObject({ path: fs.realpathSync(first), repository_id: getRepositoryIdentity(first) });
    expect(mutate(options, linked, 1).registration_id).toBe(state.registration_id);
    const other = mutate(options, second);
    expect(other.registration_id).not.toBe(state.registration_id);
    expect(listManagerRegistrations(options).registrations).toHaveLength(2);
    expect(inspectManagerRegistrations('#l1', { ...options, project: 'first' }).registrations).toHaveLength(1);
    expect(listManagerRegistrations({ ...options, project: 'second' }).registrations[0].registration_id).toBe(other.registration_id);
  });

  it('retains inaccessible, old and missing-Lane associations and permits only self cleanup', () => {
    const { root, options, project, registry } = fixture();
    const repo = project('old');
    registry([repo]);
    const state = mutate(options, repo);
    const file = path.join(options.registrationsDir, `${state.registration_id}.json`);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    const old = '2000-01-01T00:00:00.000Z';
    stored.registered_at = stored.updated_at = stored.history[0].timestamp = old;
    fs.writeFileSync(file, JSON.stringify(stored));
    const registryBefore = fs.readFileSync(options.registryPath, 'utf8');
    fs.renameSync(repo, path.join(root, 'moved'));
    const listed = listManagerRegistrations(options);
    expect(listed.registrations).toMatchObject([{ revision: 1, status: 'working', live_status: 'unknown', availability: { status: 'unavailable' } }]);
    expect(listed.registrations[0].freshness.age_seconds).toBeGreaterThan(3600);
    expect(listed.warnings.length).toBeGreaterThan(0);
    expect(fs.readFileSync(options.registryPath, 'utf8')).toBe(registryBefore);
    const inspected = inspectManagerRegistrations('#l1', { ...options, project: 'old' });
    expect(inspected).toMatchObject({ claim: null, lane: null, warnings: [{ kind: 'unavailable_lane' }] });
    expect(inspected.registrations).toHaveLength(1);
    expect(() => mutate(options, repo, 1)).toThrow('Cannot access project');
    expect(() => mutate(options, repo, 0, bob, 'unregister')).toThrow('No registration for this actor');
    expect(mutate(options, repo, 1, alice, 'unregister')).toMatchObject({ revision: 2, status: 'stopped' });
    fs.renameSync(path.join(root, 'moved'), repo);
    fs.unlinkSync(path.join(repo, '.clips', 'db', 'tracks', 'r001.jsonl'));
    expect(inspectManagerRegistrations('#l1', { ...options, project: repo })).toMatchObject({ lane: null, warnings: [{ kind: 'unavailable_lane' }] });
    expect(() => mutate(options, repo, 2)).toThrow('Lane #l001 is missing');
  });

  it('rejects ambiguous IDs without dropping same-name projects or using the current directory', () => {
    const { options, project, registry } = fixture();
    const first = project('first', 'shared'), second = project('second', 'shared');
    registry([first, second]);
    mutate(options, first);
    mutate(options, second);
    expect(listManagerRegistrations(options).registrations).toHaveLength(2);
    expect(() => resolveManagerProject('shared', options)).toThrow(/ambiguous|Ambiguous/);
    expect(() => mutate(options, 'shared')).toThrow(/ambiguous|Ambiguous/);
    expect(inspectManagerRegistrations('#l1', { ...options, project: first }).registrations).toHaveLength(1);
    expect(() => resolveManagerProject('unknown', options)).toThrow('Unknown project');
  });

  it('can inspect and stop a stored project by ID when its database is unavailable', () => {
    const { root, options, project, registry } = fixture();
    const repo = project('one');
    registry([repo]);
    mutate(options, repo);
    fs.renameSync(path.join(repo, '.clips', 'db'), path.join(root, 'unavailable-db'));
    const listed = listManagerRegistrations(options);
    expect(listed.projects).toHaveLength(1);
    expect(listed.projects[0].availability.status).toBe('unavailable');
    expect(inspectManagerRegistrations('#l1', { ...options, project: 'one' }).registrations).toHaveLength(1);
    expect(mutate(options, 'one', 1, alice, 'unregister')).toMatchObject({ revision: 2, status: 'stopped' });
    expect(listManagerRegistrations(options).registrations[0].project).not.toHaveProperty('availability');
  });

  it('reports corruption without overwrites, preserves unrelated entries, and rejects held locks and stale revisions', () => {
    const { options, project } = fixture();
    const repo = project('one');
    const state = mutate(options, repo);
    mutate(options, repo, 0, bob);
    const file = path.join(options.registrationsDir, `${state.registration_id}.json`);
    const content = fs.readFileSync(file, 'utf8');
    for (const corrupt of ['broken JSON', JSON.stringify({ ...state, revision: 20 }), JSON.stringify({ ...state, actor: bob }), JSON.stringify({ ...state, status: 'stopped' })]) {
      fs.writeFileSync(file, corrupt);
      const listed = listManagerRegistrations(options);
      expect(listed.registrations).toHaveLength(1);
      expect(listed.warnings).toMatchObject([{ kind: 'invalid_registration', file }]);
      expect(inspectManagerRegistrations('#l1', { ...options, project: repo }).warnings).toMatchObject([{ kind: 'invalid_registration' }]);
      expect(() => mutate(options, repo, 0)).toThrow('Invalid Lane registration');
      expect(fs.readFileSync(file, 'utf8')).toBe(corrupt);
    }
    fs.writeFileSync(file, content);
    expect(() => mutate(options, repo, 0)).toThrow('Revision conflict');
    fs.writeFileSync(`${file}.lock`, 'other writer');
    expect(() => mutate(options, repo, 1)).toThrow('Record is being written');
    expect(fs.readFileSync(`${file}.lock`, 'utf8')).toBe('other writer');
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
    fs.unlinkSync(`${file}.lock`);
    const migrationLock = path.join(path.dirname(options.registrationsDir), '.lanes-migration.lock');
    fs.writeFileSync(migrationLock, 'migration writer');
    expect(() => mutate(options, repo, 1)).toThrow('migration is in progress');
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
    fs.unlinkSync(migrationLock);
    expect(mutate(options, repo, 1)).toMatchObject({ revision: 2 });
    expect(fs.readdirSync(options.registrationsDir).every((name) => name.endsWith('.json'))).toBe(true);
  });

  it('preserves unknown stored metadata and requires actual identity, revisions and attributed observations', () => {
    const { options, project } = fixture();
    const repo = project('one');
    for (const actor of [{}, { runtime: 'copilot' }, { ...alice, host: '' }]) {
      expect(() => mutate(options, repo, 0, actor)).toThrow(/actor/);
    }
    expect(() => mutateManagerRegistration('#l1', 'register', { actor: alice }, { ...options, project: repo })).toThrow('expected_revision');
    expect(() => mutate(options, repo, 0, alice, 'register', { runtime_observation: { status: 'busy' } })).toThrow('runtime_observation.observed_at');
    expect(() => mutate(options, repo, 0, alice, 'register', { runtime_observation: { status: 'busy', observed_at: 'invalid', source: 'fixture' } })).toThrow('timestamp');
    expect(() => mutate(options, repo, 0, alice, 'register', {}, '#l99')).toThrow('missing');
    const state = mutate(options, repo);
    const file = path.join(options.registrationsDir, `${state.registration_id}.json`);
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    stored.extensions = { future: { keep: true } };
    stored.project.future = { keep: 'project' };
    stored.actor.future = { keep: 'actor' };
    stored.history[0].future = ['history'];
    fs.writeFileSync(file, JSON.stringify(stored));
    const updated = mutate(options, repo, 1);
    expect(updated).toMatchObject({ extensions: stored.extensions, project: { future: { keep: 'project' } }, actor: { future: { keep: 'actor' } }, history: [{ future: ['history'] }, {}] });
  });

  it('writes concurrent unrelated associations independently and never loses a successful same-actor revision', async () => {
    const { options, project, env, outside } = fixture();
    const repo = project('one');
    const script = `import { mutateManagerRegistration } from ${JSON.stringify(moduleUrl)}; try { mutateManagerRegistration('#l1','register',JSON.parse(process.argv[1]),JSON.parse(process.argv[2])); } catch(e) { console.error(e.message); process.exitCode=1; }`;
    const run = (actor, expected_revision) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script, JSON.stringify({ actor, expected_revision }), JSON.stringify({ ...options, project: repo })], { cwd: outside, env });
      let stderr = '';
      child.stderr.on('data', (data) => { stderr += data; });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stderr }));
    });
    const unrelated = await Promise.all([run(alice, 0), run(bob, 0)]);
    expect(unrelated).toEqual([{ code: 0, stderr: '' }, { code: 0, stderr: '' }]);
    expect(listManagerRegistrations(options).registrations).toHaveLength(2);
    const same = await Promise.all([run(alice, 1), run(alice, 1)]);
    expect(same.filter((result) => result.code === 0)).toHaveLength(1);
    expect(same.find((result) => result.code !== 0).stderr).toMatch(/Revision conflict|Record is being written/);
    expect(listManagerRegistrations(options).registrations.find((entry) => entry.actor.session_id === alice.session_id)).toMatchObject({ revision: 2, history: [{ revision: 1 }, { revision: 2 }] });
  });
});

describe('outside-repository manager CLI', () => {
  it('uses canonical lanes command names in Lane help and corrective usage messages', () => {
    const { env, outside, project } = fixture();
    const repo = project('one');
    const lane = (...args) => spawnSync(process.execPath, [cli, 'lane', ...args], { cwd: repo, env, encoding: 'utf8' });
    const help = spawnSync(process.execPath, [cli, 'lane', '--help'], { cwd: outside, env, encoding: 'utf8' });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: lanes lane <command>');
    expect(help.stdout).toContain('Historical Track refs such as #r1 are accepted as aliases.');
    const add = lane('#l1', 'add');
    expect(add.status).toBe(1);
    expect(add.stderr).toContain('Add at least one goal: lanes lane <lane> add <goal...>');
    const close = lane('status', '#l1', 'closed');
    expect(close.status).toBe(1);
    expect(close.stderr).toContain('Use lanes lane close <lane> <json>');
    for (const output of [help.stdout, add.stderr, close.stderr]) expect(output).not.toMatch(/\bclips\b/i);
  });

  it('discovers without initializing cwd and accepts explicit IDs/paths, files and stdin', () => {
    const { root, outside, options, project, registry, json, run } = fixture();
    expect(json(['list', '--all', '--json'])).toEqual({ projects: [], registrations: [], warnings: [] });
    const first = project('first'), second = project('second');
    registry([first, second]);
    const payload = JSON.stringify({ expected_revision: 0, actor: alice });
    expect(json(['register', '#l1', '--project', first, payload])).toMatchObject({ revision: 1, live_status: 'unknown' });
    expect(json(['register', '#l1', '--project', 'second', payload])).toMatchObject({ project: { path: fs.realpathSync(second) } });
    expect(json(['list', '--all', '--json']).registrations).toHaveLength(2);
    expect(json(['list', '--project', 'first']).registrations).toHaveLength(1);
    const inspected = json(['inspect', '#l1', '--project', first, '--json']);
    expect(inspected).toMatchObject({ claim: { revision: 0, owners: [] }, lane: { title: 'first Lane' } });
    expect(json(['inspect', '#l1', '--project', '../first']).project.repository_id).toBe(inspected.project.repository_id);
    const input = path.join(root, 'refresh.json');
    fs.writeFileSync(input, JSON.stringify({ expected_revision: 1, actor: alice }));
    expect(json(['register', '#l1', '--project', first, '--file', input])).toMatchObject({ revision: 2 });
    expect(json(['unregister', '#l1', '--project', first, '--stdin'], { input: JSON.stringify({ expected_revision: 2, actor: alice }) })).toMatchObject({ status: 'stopped', revision: 3 });
    for (const args of [
      ['register', '#l1', payload],
      ['register', '--project', first, payload],
      ['inspect', '#l1', '--project'],
      ['list', '--all', '--project', first],
      ['list', '--all', '--all'],
      ['claim', '#l1', '--project', first, payload],
    ]) expect(run(args).status).not.toBe(0);
    expect(fs.readdirSync(outside)).toEqual([]);
    expect(fs.existsSync(options.claimsDir)).toBe(false);
    const legacy = run(['inspect', '#l1', '--json'], { cwd: first });
    expect(legacy.status).toBe(0);
    expect(JSON.parse(legacy.stdout)).toMatchObject({ revision: 0, owners: [] });
    expect(JSON.parse(run(['list', '--json'], { cwd: first }).stdout)).toEqual([]);
  });

  it('exposes corrupt registry/claim diagnostics rather than claiming discovery or ownership is empty', () => {
    const { options, project, registry, json, run } = fixture();
    const repo = project('one');
    registry([repo]);
    const state = json(['register', '#l1', '--project', repo, JSON.stringify({ expected_revision: 0, actor: alice })]);
    fs.writeFileSync(options.registryPath, 'bad registry');
    expect(json(['list', '--all']).warnings).toMatchObject([{ kind: 'invalid_registry' }]);
    expect(run(['inspect', '#l1', '--project', 'one']).stderr).toContain('invalid or ambiguous registry');
    const owner = { ...bob };
    mutateLaneClaim('#l1', 'claim', { expected_revision: 0, actor: owner }, { projectPath: repo, claimsDir: options.claimsDir });
    const find = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? find(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
    fs.writeFileSync(find(options.claimsDir)[0], 'bad claim');
    expect(json(['inspect', '#l1', '--project', repo])).toMatchObject({ claim: null, registrations: [{ registration_id: state.registration_id }], warnings: [{ kind: 'lane_claim' }] });
    expect(json(['register', '#l1', '--project', repo, JSON.stringify({ expected_revision: 1, actor: alice })])).toMatchObject({ revision: 2 });
  });

  const layouts = ['.clips', '.lanes'].flatMap(homeStore => ['.clips', '.lanes'].flatMap(projectStore =>
    ['clips.config.json', 'lanes.config.json'].map(configName => ({ homeStore, projectStore, configName }))));
  it.each(layouts)('discovers $projectStore/$configName using user $homeStore without migrating on reads', ({ homeStore, projectStore, configName }) => {
    const { home, env, outside, project, json } = fixture();
    const repo = project('mixed', 'mixed-project', projectStore, configName);
    const store = path.join(home, homeStore);
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, 'projects.json'), JSON.stringify({ version: 1, projects: [{ path: repo }] }));
    const isolated = { ...env };
    delete isolated.LANES_HOME;
    delete isolated.CLIPS_HOME;
    const runOptions = { env: isolated };
    const initial = json(['list', '--all'], runOptions);
    expect(initial.projects).toMatchObject([{ id: 'mixed-project', availability: { status: 'available' } }]);
    const state = json(['register', '#l1', '--project', 'mixed-project', JSON.stringify({ expected_revision: 0, actor: alice })], runOptions);
    expect(state).toMatchObject({ revision: 1, project: { id: 'mixed-project' } });
    expect(fs.existsSync(path.join(store, 'lane-managers', `${state.registration_id}.json`))).toBe(true);
    expect(json(['inspect', '#l1', '--project', repo], runOptions)).toMatchObject({ claim: { revision: 0 }, registrations: [{ revision: 1 }] });
    expect(fs.existsSync(path.join(home, homeStore === '.clips' ? '.lanes' : '.clips'))).toBe(false);
    expect(fs.existsSync(path.join(repo, projectStore, configName))).toBe(true);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it('honors isolated legacy and canonical home overrides with canonical precedence', () => {
    const { root, env, project, json } = fixture();
    const repo = project('one');
    const legacy = path.join(root, 'legacy-override'), canonical = path.join(root, 'canonical-override');
    const legacyEnv = { ...env, CLIPS_HOME: legacy };
    delete legacyEnv.LANES_HOME;
    const payload = JSON.stringify({ expected_revision: 0, actor: alice });
    const old = json(['register', '#l1', '--project', repo, payload], { env: legacyEnv });
    const newEnv = { ...env, CLIPS_HOME: legacy, LANES_HOME: canonical };
    expect(json(['list', '--all'], { env: newEnv }).registrations).toEqual([]);
    const current = json(['register', '#l1', '--project', repo, payload], { env: newEnv });
    expect(old.registration_id).toBe(current.registration_id);
    expect(fs.existsSync(path.join(legacy, 'lane-managers', `${old.registration_id}.json`))).toBe(true);
    expect(fs.existsSync(path.join(canonical, 'lane-managers', `${old.registration_id}.json`))).toBe(true);
  });

  it('carries registration and ownership history through user/project migration and refuses conflicting or locked migration', () => {
    const { home, env, options, project, registry, json } = fixture();
    const repo = project('one');
    registry([repo]);
    const created = mutate(options, repo);
    const claim = mutateLaneClaim('#l1', 'claim', { expected_revision: 0, actor: bob }, { projectPath: repo, claimsDir: options.claimsDir });
    const registrationFile = path.join(options.registrationsDir, `${created.registration_id}.json`);
    const before = fs.readFileSync(registrationFile, 'utf8');
    const targetDir = path.join(home, '.lanes', 'lane-managers');
    fs.mkdirSync(targetDir, { recursive: true });
    const conflictFile = path.join(targetDir, `${created.registration_id}.json`);
    fs.writeFileSync(conflictFile, before.replace(alice.contact, 'conflicting-contact'));
    expect(() => migrateStorage(repo, { home, env: {} })).toThrow('Migration conflict');
    expect(fs.readFileSync(registrationFile, 'utf8')).toBe(before);
    expect(fs.existsSync(path.join(repo, '.clips', 'clips.config.json'))).toBe(true);
    fs.writeFileSync(conflictFile, before);
    fs.writeFileSync(`${registrationFile}.lock`, 'held writer');
    expect(() => migrateStorage(repo, { home, env: {} })).toThrow('State is being written');
    fs.unlinkSync(`${registrationFile}.lock`);
    const migrated = migrateStorage(repo, { home, env: {} });
    expect(migrated.migrated).toBe(true);
    expect(fs.existsSync(path.join(home, '.clips'))).toBe(false);
    expect(fs.readFileSync(conflictFile, 'utf8')).toBe(before);
    const isolated = { ...env };
    delete isolated.LANES_HOME;
    delete isolated.CLIPS_HOME;
    const inspected = json(['inspect', '#l1', '--project', repo], { env: isolated });
    expect(inspected.registrations[0]).toMatchObject({ registration_id: created.registration_id, revision: 1, history: created.history });
    expect(inspected.claim).toEqual(claim);
    expect(json(['unregister', '#l1', '--project', repo, JSON.stringify({ expected_revision: 1, actor: alice })], { env: isolated })).toMatchObject({ revision: 2, status: 'stopped' });
    expect(json(['inspect', '#l1', '--project', repo], { env: isolated }).claim).toEqual(claim);
  });
});
