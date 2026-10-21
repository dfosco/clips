import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { discoverClipsProjects, resolveClipsProject } from '../src/project-discovery.js';
import { readCurrentBoard } from '../../../src/commands/board.js';

const digest = (content) => createHash('sha256').update(content).digest('hex');

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'clips-discovery-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const clipsHome = path.join(root, 'home');
  await fs.mkdir(clipsHome);
  const registry = path.join(clipsHome, 'projects.json');
  async function project(name, config = {}, store = '.clips', configName = 'clips.config.json') {
    const dir = path.join(root, name);
    await fs.mkdir(dir, { recursive: true });
    execFileSync('git', ['init', '-q', dir]);
    await fs.mkdir(path.join(dir, store, 'db'), { recursive: true });
    await fs.writeFile(path.join(dir, store, configName), JSON.stringify(config));
    return dir;
  }
  async function register(entries) {
    await fs.writeFile(registry, JSON.stringify({ version: 1, projects: entries.map((entry) => typeof entry === 'string' ? { path: entry } : entry) }));
  }
  return { root, clipsHome, registry, project, register, options: { clipsHome } };
}

async function snapshot(file) {
  const [content, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
  return { sha256: digest(content), mtimeMs: stat.mtimeMs, mode: stat.mode, size: stat.size };
}

function discoverInProcess(env, projectId) {
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `import {discoverClipsProjects,resolveClipsProject} from ${JSON.stringify(new URL('../src/project-discovery.js', import.meta.url).href)}; console.log(JSON.stringify(await ${projectId ? `resolveClipsProject(${JSON.stringify(projectId)})` : 'discoverClipsProjects()'}));`],
  { env, encoding: 'utf8' }));
}

function isolatedEnv(home) {
  const env = { ...process.env, HOME: home, LANES_SWITCH_INIT: '1', CLIPS_SWITCH_INIT: '1' };
  delete env.LANES_HOME;
  delete env.CLIPS_HOME;
  return env;
}

test('discovers only registered real projects, preserves nullable/configured identity, never prunes', async (t) => {
  const f = await fixture(t);
  const first = await f.project('first');
  const second = await f.project('second', { project_id: 'real-board', username: 'configured-user' });
  await f.project('unregistered');
  await f.register([first, path.join(f.root, 'removed'), second]);
  const before = await snapshot(f.registry);
  const result = await discoverClipsProjects(f.options);
  assert.deepEqual(result.projects.map((p) => [p.name, p.projectRoot, p.storeRoot, p.username]), [
    ['first', first, path.join(first, '.clips'), null],
    ['real-board', second, path.join(second, '.clips'), 'configured-user'],
  ]);
  assert.match(result.projects[0].id, /^clips-project-[a-f0-9]{64}$/);
  assert.match(result.userScope, /^clips-user-[a-f0-9]{64}$/);
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['stale_project']);
  assert.deepEqual(await snapshot(f.registry), before);
  assert.equal(result.diagnostics[0].message.includes(f.root), false);
});

test('normalizes symlink and linked-worktree entries before config validation and store deduplication', async (t) => {
  const f = await fixture(t);
  const main = await f.project('main');
  execFileSync('git', ['-C', main, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture']);
  const worktree = path.join(f.root, 'worktree');
  execFileSync('git', ['-C', main, 'worktree', 'add', '-q', '-b', 'fixture-worktree', worktree]);
  // A misleading worktree-local config must not replace the shared store.
  await fs.mkdir(path.join(worktree, '.clips'));
  await fs.writeFile(path.join(worktree, '.clips', 'clips.config.json'), 'broken');
  const alias = path.join(f.root, 'alias');
  await fs.symlink(main, alias, 'dir');
  await f.register([worktree, alias, main]);
  const result = await discoverClipsProjects(f.options);
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].projectRoot, main);
  assert.equal(result.projects[0].storeRoot, path.join(main, '.clips'));
  assert.deepEqual(result.diagnostics, []);
  await f.register([main]);
  assert.equal((await discoverClipsProjects(f.options)).projects[0].id, result.projects[0].id);
});

test('uses store identity rather than duplicate names/product ids and selects the corresponding real board', async (t) => {
  const f = await fixture(t);
  const a = await f.project('a', { project_id: 'same-name' });
  const b = await f.project('b', { project_id: 'same-name' });
  for (const [dir, title] of [[a, 'Board A'], [b, 'Board B']]) {
    await fs.writeFile(path.join(dir, '.clips', 'db', 'g001.jsonl'), JSON.stringify({
      event: 'goal_created', goal_id: 'g001', title, timestamp: '2026-01-01T00:00:00.000Z',
    }) + '\n');
  }
  await f.register([a, b]);
  const result = await discoverClipsProjects(f.options);
  assert.equal(result.projects.length, 2);
  assert.notEqual(result.projects[0].id, result.projects[1].id);
  const selected = await resolveClipsProject(result.projects[1].id, f.options);
  assert.equal(selected.projectRoot, b);
  assert.equal(readCurrentBoard(selected.projectRoot).goals[0].title, 'Board B');
  assert.equal(readCurrentBoard(result.projects[0].projectRoot).goals[0].title, 'Board A');
  await f.register([b, a]);
  assert.deepEqual(await resolveClipsProject(selected.id, f.options), selected);
});

test('revalidates explicit selections after unregistration, config corruption, and removal with no cwd fallback', async (t) => {
  const f = await fixture(t);
  const a = await f.project('a');
  const b = await f.project('b');
  await f.register([a, b]);
  const { projects } = await discoverClipsProjects(f.options);
  const id = projects[1].id;
  await fs.writeFile(path.join(b, '.clips', 'clips.config.json'), 'null');
  await assert.rejects(resolveClipsProject(id, f.options), /no longer available/);
  await fs.writeFile(path.join(b, '.clips', 'clips.config.json'), '{}');
  assert.equal((await resolveClipsProject(id, f.options)).projectRoot, b);
  await f.register([a]);
  await assert.rejects(resolveClipsProject(id, f.options), /no longer available/);
  await f.register([a, b]);
  await fs.rm(b, { recursive: true });
  await assert.rejects(resolveClipsProject(id, f.options), /no longer available/);
  await assert.rejects(resolveClipsProject(a, f.options), /valid discovered/);
  await assert.rejects(resolveClipsProject('', f.options), /valid discovered/);
});

test('handles missing/malformed registry, unsupported versions and invalid entries with bounded diagnostics', async (t) => {
  const f = await fixture(t);
  assert.equal((await discoverClipsProjects(f.options)).diagnostics[0].code, 'missing_registry');
  await assert.rejects(fs.stat(f.registry), { code: 'ENOENT' });
  for (const text of ['{', 'null', '[]', '{}', '{"version":2,"projects":[]}', '{"projects":{}}']) {
    await fs.writeFile(f.registry, text);
    const before = await snapshot(f.registry);
    const result = await discoverClipsProjects(f.options);
    assert.deepEqual(result.projects, []);
    assert.equal(result.diagnostics[0].code, 'invalid_registry');
    assert.deepEqual(await snapshot(f.registry), before);
  }
  const good = await f.project('good');
  await f.register([good, null, { path: 1 }, { path: 'relative-path' }, ...Array.from({ length: 40 }, () => ({ path: path.join(f.root, 'removed') }))]);
  const result = await discoverClipsProjects(f.options);
  assert.equal(result.projects.length, 1);
  assert.equal(result.diagnostics.length, 21);
  assert.equal(result.diagnostics[0].code, 'invalid_entry');
  assert.equal(result.diagnostics.at(-1).code, 'diagnostics_truncated');
  assert.equal(JSON.stringify(result.diagnostics).includes(f.root), false);
});

test('rejects malformed canonical configs and unavailable stores while retaining valid candidates', async (t) => {
  const f = await fixture(t);
  const good = await f.project('good');
  const badJson = await f.project('bad-json');
  await fs.writeFile(path.join(badJson, '.clips', 'clips.config.json'), '{');
  const badShape = await f.project('bad-shape', []);
  const badUsername = await f.project('bad-user', { username: {} });
  const badId = await f.project('bad-id', { project_id: 'invalid ID' });
  const badIdType = await f.project('bad-id-type', { project_id: 123 });
  const missingConfig = await f.project('missing-config');
  await fs.unlink(path.join(missingConfig, '.clips', 'clips.config.json'));
  const missingStore = await f.project('missing-store');
  await fs.rm(path.join(missingStore, '.clips'), { recursive: true });
  const badDb = await f.project('bad-db');
  await fs.rm(path.join(badDb, '.clips', 'db'), { recursive: true });
  await fs.writeFile(path.join(badDb, '.clips', 'db'), 'not a directory');
  const empty = await f.project('empty', { notepad_username: 'legacy-user' });
  await fs.rm(path.join(empty, '.clips', 'db'), { recursive: true });
  await f.register([good, badJson, badShape, badUsername, badId, badIdType, missingConfig, missingStore, badDb, empty]);
  const result = await discoverClipsProjects(f.options);
  assert.deepEqual(result.projects.map((p) => p.name), ['good', 'empty']);
  assert.equal(result.projects[1].username, 'legacy-user');
  assert.deepEqual(result.diagnostics.map((d) => d.code), ['invalid_config', 'invalid_config', 'invalid_config', 'invalid_config', 'invalid_config', 'unavailable_config', 'unavailable_store', 'invalid_config']);
});

test('uses canonical CLIPS_HOME/default semantics and isolates scope by actual resolved home and OS user', async (t) => {
  const f = await fixture(t);
  const p = await f.project('registered');
  await f.register([p]);
  const explicit = await discoverClipsProjects(f.options);
  const envResult = discoverInProcess({ ...isolatedEnv(f.root), CLIPS_HOME: f.clipsHome });
  assert.deepEqual(envResult, explicit);
  const homeAlias = path.join(f.root, 'home-alias');
  await fs.symlink(f.clipsHome, homeAlias, 'dir');
  assert.equal((await discoverClipsProjects({ clipsHome: homeAlias })).userScope, explicit.userScope);
  const defaultHome = path.join(f.root, 'default-user');
  await fs.mkdir(defaultHome);
  await fs.rename(f.clipsHome, path.join(defaultHome, '.clips'));
  const env = isolatedEnv(defaultHome);
  const defaultResult = discoverInProcess(env);
  assert.equal(defaultResult.projects[0].id, explicit.projects[0].id);
  assert.notEqual(defaultResult.userScope, explicit.userScope);
  const expectedScope = 'clips-user-' + digest(JSON.stringify([await fs.realpath(path.join(defaultHome, '.clips')), os.userInfo().username]));
  assert.equal(defaultResult.userScope, expectedScope);
  const missing = path.join(f.root, 'not-created', 'home');
  await discoverClipsProjects({ clipsHome: missing });
  await assert.rejects(fs.stat(path.dirname(missing)), { code: 'ENOENT' });
});

test('reads supported legacy string entries without creating or rewriting registry state', async (t) => {
  const f = await fixture(t);
  const p = await f.project('legacy');
  await fs.writeFile(f.registry, JSON.stringify({ projects: [p] }));
  const before = await snapshot(f.registry);
  assert.equal((await discoverClipsProjects(f.options)).projects[0].projectRoot, p);
  assert.deepEqual(await snapshot(f.registry), before);
  await assert.rejects(discoverClipsProjects({ clipsHome: '' }), /clipsHome/);
});

test('all project/config/default-user name combinations resolve explicitly without migration', async (t) => {
  const f = await fixture(t);
  for (const userStore of ['.clips', '.lanes']) {
    const home = path.join(f.root, `user-${userStore}`);
    await fs.mkdir(path.join(home, userStore), { recursive: true });
    for (const store of ['.clips', '.lanes']) {
      for (const configName of ['clips.config.json', 'lanes.config.json']) {
        const repo = await f.project(`${userStore}-${store}-${configName}`, { project_id: 'mixed-layout' }, store, configName);
        const registry = path.join(home, userStore, 'projects.json');
        await fs.writeFile(registry, JSON.stringify({ version: 1, projects: [{ path: repo }] }));
        const config = path.join(repo, store, configName);
        const before = await Promise.all([snapshot(registry), snapshot(config)]);
        const env = isolatedEnv(home);
        const found = discoverInProcess(env);
        assert.deepEqual(found.diagnostics, []);
        assert.equal(found.projects[0].storeRoot, path.join(repo, store));
        assert.equal(discoverInProcess(env, found.projects[0].id).projectRoot, repo);
        assert.deepEqual(await Promise.all([snapshot(registry), snapshot(config)]), before);
        assert.deepEqual((await fs.readdir(repo)).sort(), ['.git', store].sort());
      }
    }
  }
});

test('canonical env and option precedence isolate custom homes and deduplicate their aliases', async (t) => {
  const f = await fixture(t);
  const old = await f.project('old');
  const current = await f.project('current', {}, '.lanes', 'lanes.config.json');
  await f.register([old]);
  const canonicalHome = path.join(f.root, 'canonical-home');
  await fs.mkdir(canonicalHome);
  await fs.writeFile(path.join(canonicalHome, 'projects.json'), JSON.stringify({ projects: [{ path: current }] }));
  const selected = discoverInProcess({ ...isolatedEnv(f.root), CLIPS_HOME: f.clipsHome, LANES_HOME: canonicalHome });
  assert.equal(selected.projects[0].projectRoot, current);
  assert.notEqual(selected.userScope, (await discoverClipsProjects(f.options)).userScope);
  assert.deepEqual(await discoverClipsProjects({ lanesHome: canonicalHome, clipsHome: f.clipsHome }), selected);
  const alias = path.join(f.root, 'canonical-alias');
  await fs.symlink(canonicalHome, alias);
  assert.deepEqual(await discoverClipsProjects({ lanesHome: alias }), selected);
});

test('explicit init migration preserves project and user selection identity including paired aliases', async (t) => {
  const f = await fixture(t);
  for (const pairedAlias of [false, true]) {
    const home = path.join(f.root, `migration-home-${pairedAlias}`);
    await fs.mkdir(path.join(home, '.clips'), { recursive: true });
    const repo = await f.project(`migration-${pairedAlias}`);
    await fs.writeFile(path.join(home, '.clips', 'projects.json'), JSON.stringify({ version: 1, projects: [{ path: repo }] }));
    if (pairedAlias) {
      await fs.symlink(path.join(repo, '.clips'), path.join(repo, '.lanes'));
      await fs.symlink(path.join(home, '.clips'), path.join(home, '.lanes'));
    }
    const env = isolatedEnv(home);
    const before = discoverInProcess(env);
    execFileSync(process.execPath, [fileURLToPath(new URL('../../../src/cli.js', import.meta.url)),
      'init', '--skills-scope', 'project'], { cwd: repo, env, stdio: 'pipe' });
    const after = discoverInProcess(env);
    assert.equal(after.userScope, before.userScope);
    assert.equal(after.projects[0].id, before.projects[0].id);
    assert.equal(after.projects[0].storeRoot, path.join(repo, '.lanes'));
    assert.equal(discoverInProcess(env, before.projects[0].id).projectRoot, repo);
    assert.deepEqual(after.diagnostics, []);
  }
});

test('conflicting stores/configs are unavailable and external-root symlink migration is non-destructive', async (t) => {
  const f = await fixture(t);
  const repo = await f.project('conflict');
  await f.register([repo]);
  const selected = (await discoverClipsProjects(f.options)).projects[0];
  await fs.mkdir(path.join(repo, '.lanes'));
  await fs.writeFile(path.join(repo, '.lanes', 'lanes.config.json'), '{}');
  assert.equal((await discoverClipsProjects(f.options)).projects.length, 0);
  await assert.rejects(resolveClipsProject(selected.id, f.options), /no longer available/);
  await fs.rm(path.join(repo, '.lanes'), { recursive: true });
  await fs.writeFile(path.join(repo, '.clips', 'lanes.config.json'), '{}');
  assert.equal((await discoverClipsProjects(f.options)).projects.length, 0);
  await fs.unlink(path.join(repo, '.clips', 'lanes.config.json'));
  const external = path.join(f.root, 'external-store');
  await fs.rename(path.join(repo, '.clips'), external);
  await fs.symlink(external, path.join(repo, '.clips'));
  const before = await discoverClipsProjects(f.options);
  assert.equal(before.projects[0].storeRoot, external);
  const config = path.join(external, 'clips.config.json');
  const unchanged = await snapshot(config);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../../src/cli.js', import.meta.url)),
    'init', '--skills-scope', 'project'], {
    cwd: repo, env: { ...isolatedEnv(f.root), LANES_HOME: f.clipsHome }, encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot migrate linked store safely/);
  assert.deepEqual(await snapshot(config), unchanged);
  assert.deepEqual(await discoverClipsProjects(f.options), before);
});
