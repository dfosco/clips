import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClipsDir, getClipsDbDir, getClipsRecordsDir } from './core.js';
import { getConfigPath, setConfigValue } from './config.js';
import { getClipsComponentsDir } from './components.js';
import { getSystemClipsDir, registerProject, readProjectRegistry } from './registry.js';
import { readProjectBoard } from './board.js';
import { migrateStorage } from './storage-migration.js';
import { withRecordLock } from './journal.js';
import { mutateLaneClaim } from './lane-claims.js';
import { mutateManagerRegistration } from './lane-registrations.js';

const cli = path.resolve('src/cli.js');
const roots = [];
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : `${JSON.stringify(content)}\n`);
}
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-storage-')));
  roots.push(root);
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  fs.mkdirSync(project); fs.mkdirSync(home);
  execFileSync('git', ['init', '--quiet'], { cwd: project });
  const env = { ...process.env, HOME: home, LANES_HOME: '', CLIPS_HOME: '', LANES_SWITCH_INIT: '1' };
  for (const key of ['HOME', 'LANES_HOME', 'CLIPS_HOME', 'LANES_SWITCH_INIT']) vi.stubEnv(key, env[key]);
  return { root, project, home, env };
}
function run(f, ...args) {
  return execFileSync(process.execPath, [cli, ...args], { cwd: f.project, env: f.env, encoding: 'utf8' });
}
function attempt(f, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: f.project, env: f.env, encoding: 'utf8' });
}
function tree(root) {
  if (!fs.existsSync(root)) return null;
  return Object.fromEntries(fs.readdirSync(root).sort().map(name => {
    const file = path.join(root, name);
    const info = fs.lstatSync(file);
    return [name, info.isSymbolicLink() ? { link: fs.readlinkSync(file) } : info.isDirectory() ? tree(file) : fs.readFileSync(file).toString('base64')];
  }));
}
const goal = { event: 'goal_created', goal_id: 'g001', title: 'Preserved goal', status: 'open' };
function populate(f, projectName = '.clips', configName = 'clips.config.json', userName = '.clips') {
  const store = path.join(f.project, projectName);
  const user = path.join(f.home, userName);
  write(path.join(store, configName), { collaboration: false, username: null, custom: { keep: true } });
  write(path.join(store, 'db', 'g001.jsonl'), goal);
  write(path.join(store, 'records', 'cr', 'CR-001.md'), '# CR-001: Saved record\n**Status:** Proposed\n**Covers:** #g001\n');
  write(path.join(user, 'projects.json'), { version: 1, projects: [{ path: f.project, extra: 'preserve' }], custom: true });
  return { store, user };
}
function coordination(f, user) {
  run(f, 'lane', 'create', '{"title":"Preserved lane"}');
  const actor = { host: 'fixture-host', runtime: 'copilot', session_id: 'fixture-session' };
  const claim = mutateLaneClaim('l001', 'claim', { expected_revision: 0, actor }, { projectPath: f.project, claimsDir: path.join(user, 'lane-claims') });
  const registration = mutateManagerRegistration('l001', 'register', { expected_revision: 0, actor }, {
    project: f.project, registrationsDir: path.join(user, 'lane-managers'),
  });
  return { claim, registration };
}
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('independent old/new storage resolution', () => {
  const combinations = ['.clips', '.lanes'].flatMap(directory =>
    ['clips.config.json', 'lanes.config.json'].flatMap(config =>
      ['.clips', '.lanes'].map(home => [directory, config, home])));
  it.each(combinations)('uses %s / %s with user %s without creating another store', (directory, config, homeName) => {
    const f = fixture();
    const { store, user } = populate(f, directory, config, homeName);
    expect(getClipsDir(f.project)).toBe(store);
    expect(getClipsDbDir(f.project)).toBe(path.join(store, 'db'));
    expect(getClipsRecordsDir('cr', f.project)).toBe(path.join(store, 'records', 'cr'));
    expect(getClipsComponentsDir(f.project)).toBe(path.join(store, 'components'));
    expect(getConfigPath(f.project)).toBe(path.join(store, config));
    expect(getSystemClipsDir()).toBe(user);
    setConfigValue('lane_max_active_agents', 3, f.project);
    const project = registerProject(f.project);
    expect(readProjectRegistry().projects).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(user, 'projects.json')))).toMatchObject({ custom: true, projects: [{ extra: 'preserve' }] });
    run(f, 'component', 'create', '{"title":"Boundary","responsibility":"Keep state","contract":"No split"}');
    expect(JSON.parse(run(f, 'history', '#g001', '--json'))).toHaveLength(1);
    expect(JSON.parse(run(f, 'view', '#g001', '--json')).title).toBe(goal.title);
    expect(JSON.parse(run(f, 'board', '--json')).components).toHaveLength(1);
    expect(readProjectBoard(project).change_records).toHaveLength(1);
    const paths = JSON.parse(run(f, 'paths', '--json'));
    expect(paths).toEqual({ repoRoot: f.project, storeDir: store, configPath: path.join(store, config), userDir: user });
    expect(fs.existsSync(path.join(f.project, directory === '.clips' ? '.lanes' : '.clips'))).toBe(false);
    expect(fs.existsSync(path.join(f.home, homeName === '.clips' ? '.lanes' : '.clips'))).toBe(false);
  });

  it('uses explicit LANES_HOME before CLIPS_HOME and keeps override destinations exact', () => {
    const f = fixture();
    const old = path.join(f.root, 'custom-old');
    const current = path.join(f.root, 'custom-new');
    vi.stubEnv('CLIPS_HOME', old);
    expect(getSystemClipsDir()).toBe(old);
    vi.stubEnv('LANES_HOME', current);
    expect(getSystemClipsDir()).toBe(current);
    write(path.join(f.home, '.clips', 'untouched'), 'default home');
    write(path.join(old, 'untouched'), 'unselected override');
    const result = migrateStorage(f.project);
    expect(result.userDir).toBe(current);
    expect(fs.readFileSync(path.join(old, 'untouched'), 'utf8')).toBe('unselected override');
    expect(fs.existsSync(path.join(f.home, '.lanes'))).toBe(false);
  });

  it('does not let empty new stores mask old data and deduplicates realpath aliases', () => {
    const f = fixture();
    const { store, user } = populate(f);
    for (const base of [f.project, f.home]) fs.mkdirSync(path.join(base, '.lanes'));
    expect(getClipsDir(f.project)).toBe(store);
    expect(getSystemClipsDir()).toBe(user);
    for (const base of [f.project, f.home]) {
      fs.rmdirSync(path.join(base, '.lanes'));
      fs.symlinkSync('.clips', path.join(base, '.lanes'), 'dir');
    }
    expect(fs.realpathSync(getClipsDir(f.project))).toBe(store);
    expect(fs.realpathSync(getSystemClipsDir())).toBe(user);
    migrateStorage(f.project);
    expect(fs.lstatSync(path.join(f.project, '.lanes')).isDirectory()).toBe(true);
    expect(fs.existsSync(store)).toBe(false);
    expect(fs.existsSync(user)).toBe(false);
  });

  it('refuses competing populated stores and dual config names before ordinary writes', () => {
    const f = fixture();
    populate(f);
    write(path.join(f.project, '.lanes', 'unknown'), 'new');
    expect(() => getClipsDir(f.project)).toThrow(/Run lanes init/);
    fs.unlinkSync(path.join(f.project, '.lanes', 'unknown'));
    write(path.join(f.project, '.clips', 'lanes.config.json'), {});
    expect(() => setConfigValue('username', 'x', f.project)).toThrow(/Run lanes init/);
  });

  it.each(['lanes.config.json', 'clips.config.json'])('writes through a same-realpath %s config alias without splitting state', name => {
    const f = fixture();
    const other = name === 'lanes.config.json' ? 'clips.config.json' : 'lanes.config.json';
    const { store } = populate(f, '.clips', other);
    fs.symlinkSync(other, path.join(store, name));
    setConfigValue('username', 'updated', f.project);
    expect(fs.lstatSync(path.join(store, name)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(store, name))).username).toBe('updated');
    expect(getConfigPath(f.project)).toBe(path.join(store, other));
  });

  it('uses canonical fresh defaults when only empty legacy directories exist', () => {
    const f = fixture();
    fs.mkdirSync(path.join(f.project, '.clips'));
    fs.mkdirSync(path.join(f.home, '.clips'));
    expect(getClipsDir(f.project)).toBe(path.join(f.project, '.lanes'));
    expect(getSystemClipsDir()).toBe(path.join(f.home, '.lanes'));
  });
});

describe('explicit conflict-safe migration', () => {
  it.each(['.clips', '.lanes'])('migrates %s and both config names, merges safe state, and repeats idempotently', (directory) => {
    const f = fixture();
    const { store, user } = populate(f, directory);
    const { registration } = coordination(f, user);
    const registrationBytes = fs.readFileSync(path.join(user, 'lane-managers', `${registration.registration_id}.json`));
    write(path.join(store, 'lanes.config.json'), { custom: { another: 42 } });
    write(path.join(f.project, '.lanes', 'db', 'g001.jsonl'), goal);
    write(path.join(f.project, '.lanes', 'unknown.bin'), Buffer.from([0, 1, 2]).toString('binary'));
    write(path.join(f.home, '.lanes', 'projects.json'), { version: 1, projects: [{ path: path.join(f.root, 'unavailable') }], other: 1 });
    write(path.join(user, 'installation.json'), { mode: 'dev', prod_package: path.join(user, 'installations', 'prod', '1'), unknown: 1 });
    write(path.join(user, 'installations', 'prod', '1', 'saved'), 'offline package');
    write(path.join(user, 'notes', 'unknown.json'), 'not managed JSON');
    const first = JSON.parse(run(f, 'init', '--store-only'));
    expect(first.migrated).toBe(true);
    const canonical = path.join(f.project, '.lanes');
    const canonicalUser = path.join(f.home, '.lanes');
    expect(JSON.parse(fs.readFileSync(path.join(canonical, 'lanes.config.json')))).toMatchObject({ collaboration: false, custom: { keep: true, another: 42 } });
    expect(fs.readFileSync(path.join(canonical, 'db', 'g001.jsonl'), 'utf8')).toBe(`${JSON.stringify(goal)}\n`);
    expect(fs.readFileSync(path.join(canonicalUser, 'notes', 'unknown.json'), 'utf8')).toBe('not managed JSON');
    expect(JSON.parse(fs.readFileSync(path.join(canonicalUser, 'projects.json'))).projects).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(path.join(canonicalUser, 'installation.json'))).prod_package).toBe(path.join(canonicalUser, 'installations', 'prod', '1'));
    expect(fs.readFileSync(path.join(canonicalUser, 'lane-managers', `${registration.registration_id}.json`))).toEqual(registrationBytes);
    expect(fs.existsSync(path.join(f.project, '.clips'))).toBe(false);
    expect(fs.existsSync(path.join(f.home, '.clips'))).toBe(false);
    const before = tree(canonical);
    expect(JSON.parse(run(f, 'init', '--store-only')).migrated).toBe(false);
    expect(tree(canonical)).toEqual(before);
    expect(fs.existsSync(path.join(f.project, '.agents'))).toBe(false);
    execFileSync('git', ['check-ignore', '--quiet', '.lanes'], { cwd: f.project });
  });

  it.each(['history', 'config', 'unknown', 'registry', 'journal', 'lock', 'installation', 'type'])(
    'preflights both complete stores and leaves everything unchanged on %s failure', (kind) => {
      const f = fixture();
      const { store, user } = populate(f);
      write(path.join(f.project, '.lanes', 'disjoint'), 'would merge');
      if (kind === 'history') write(path.join(f.project, '.lanes', 'db', 'g001.jsonl'), { ...goal, title: 'Divergent' });
      if (kind === 'config') write(path.join(f.project, '.lanes', 'lanes.config.json'), { collaboration: true });
      if (kind === 'unknown') { write(path.join(store, 'note'), 'one'); write(path.join(f.project, '.lanes', 'note'), 'two'); }
      if (kind === 'registry') write(path.join(user, 'projects.json'), { version: 99, projects: [] });
      if (kind === 'journal') write(path.join(store, 'db', 'broken.jsonl'), '{');
      if (kind === 'lock') write(path.join(user, 'lane-managers', 'entry.json.lock'), '{}');
      if (kind === 'installation') write(path.join(user, 'installation.json'), { mode: 'invalid' });
      if (kind === 'type') { write(path.join(store, 'node'), 'file'); fs.mkdirSync(path.join(f.project, '.lanes', 'node')); }
      const projectBefore = tree(f.project);
      const homeBefore = tree(f.home);
      const result = attempt(f, 'init', '--store-only');
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/conflict|invalid|Invalid|being written/);
      expect(tree(f.project)).toEqual(projectBefore);
      expect(tree(f.home)).toEqual(homeBefore);
    });

  it('rolls both stores back on a replacement I/O failure', () => {
    const f = fixture();
    populate(f);
    const before = { project: tree(f.project), home: tree(f.home) };
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (source.includes('.migration-') && target === path.join(f.home, '.lanes')) throw new Error('injected EACCES');
      return rename(source, target);
    });
    expect(() => migrateStorage(f.project)).toThrow('injected EACCES');
    expect(tree(f.project)).toEqual(before.project);
    expect(tree(f.home)).toEqual(before.home);
  });

  it.each(['claim-history', 'claim-owners', 'manager-history', 'manager-state', 'skill-receipt', 'copilot-receipt', 'config-type', 'config-id', 'config-directory', 'db-file', 'journal-directory'])(
    'rejects malformed %s before changing either scope', kind => {
      const f = fixture();
      const { store, user } = populate(f);
      if (kind.startsWith('claim') || kind.startsWith('manager')) {
        const { registration } = coordination(f, user);
        const files = [];
        const walk = directory => {
          for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory()) walk(file); else files.push(file);
          }
        };
        walk(path.join(user, 'lane-claims'));
        const file = kind.startsWith('claim') ? files[0] : path.join(user, 'lane-managers', `${registration.registration_id}.json`);
        const value = JSON.parse(fs.readFileSync(file));
        if (kind.endsWith('history')) value.history = [{}];
        if (kind === 'claim-owners') value.owners = [];
        if (kind === 'manager-state') value.status = 'stopped';
        write(file, value);
      }
      if (kind === 'skill-receipt') write(path.join(user, 'installation.json'), { skill_installations: { '/somewhere': { files: { '../escape': 'digest' } } } });
      if (kind === 'copilot-receipt') write(path.join(user, 'copilot-workspaces-install.json'), { version: 1, repository: f.project, targets: [{}] });
      if (kind === 'config-type') write(path.join(store, 'clips.config.json'), { collaboration: 'true' });
      if (kind === 'config-id') write(path.join(store, 'clips.config.json'), { project_id: 'INVALID ID' });
      if (kind === 'config-directory') { fs.unlinkSync(path.join(store, 'clips.config.json')); fs.mkdirSync(path.join(store, 'clips.config.json')); }
      if (kind === 'db-file') { fs.unlinkSync(path.join(store, 'db', 'g001.jsonl')); fs.rmdirSync(path.join(store, 'db')); write(path.join(store, 'db'), 'not a directory'); }
      if (kind === 'journal-directory') fs.mkdirSync(path.join(store, 'db', 'g002.jsonl'));
      const before = tree(f.root);
      expect(() => migrateStorage(f.project)).toThrow(/Invalid|invalid/);
      expect(tree(f.root)).toEqual(before);
    });

  it('preserves opaque unknown trees, links, modes and binary content without traversing links', () => {
    const f = fixture();
    const { store } = populate(f);
    const external = path.join(f.root, 'external');
    write(path.join(external, 'keep'), 'external');
    write(path.join(store, 'notes', 'opaque.jsonl'), 'not a managed journal\0');
    fs.chmodSync(path.join(store, 'notes'), 0o750);
    fs.chmodSync(path.join(store, 'notes', 'opaque.jsonl'), 0o640);
    fs.symlinkSync(external, path.join(store, 'external'));
    fs.symlinkSync(path.join(store, 'notes'), path.join(store, 'absolute'));
    fs.symlinkSync('../.clips/notes', path.join(store, 'relative'));
    const before = tree(external);
    migrateStorage(f.project);
    const target = path.join(f.project, '.lanes');
    expect(fs.readFileSync(path.join(target, 'notes', 'opaque.jsonl'), 'utf8')).toBe('not a managed journal\0');
    expect(fs.statSync(path.join(target, 'notes')).mode & 0o777).toBe(0o750);
    expect(fs.statSync(path.join(target, 'notes', 'opaque.jsonl')).mode & 0o777).toBe(0o640);
    for (const name of ['absolute', 'relative']) expect(fs.realpathSync(path.join(target, name))).toBe(path.join(target, 'notes'));
    expect(fs.lstatSync(path.join(target, 'external')).isSymbolicLink()).toBe(true);
    expect(tree(external)).toEqual(before);
  });

  it.each(['project', 'home'])('never widens restrictive %s permissions when merging permissive canonical directories', scope => {
    const f = fixture();
    populate(f);
    const base = f[scope];
    const legacy = path.join(base, '.clips');
    const canonical = path.join(base, '.lanes');
    fs.mkdirSync(canonical);
    fs.chmodSync(legacy, 0o700);
    fs.chmodSync(canonical, 0o755);
    for (const directory of [legacy, canonical]) {
      write(path.join(directory, 'private', 'identical'), 'same private content');
    }
    fs.chmodSync(path.join(legacy, 'private'), 0o700);
    fs.chmodSync(path.join(canonical, 'private'), 0o755);
    fs.chmodSync(path.join(legacy, 'private', 'identical'), 0o600);
    fs.chmodSync(path.join(canonical, 'private', 'identical'), 0o644);
    write(path.join(legacy, 'private', 'legacy-only'), 'private legacy content');
    migrateStorage(f.project);
    expect(fs.statSync(canonical).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(canonical, 'private')).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(canonical, 'private', 'identical')).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(path.join(canonical, 'private', 'legacy-only'), 'utf8')).toBe('private legacy content');
  });

  it('keeps a private legacy root private when the canonical root is empty', () => {
    const f = fixture();
    const { store } = populate(f);
    fs.chmodSync(store, 0o700);
    fs.mkdirSync(path.join(f.project, '.lanes'), { mode: 0o755 });
    migrateStorage(f.project);
    expect(fs.statSync(path.join(f.project, '.lanes')).mode & 0o777).toBe(0o700);
  });

  it.each(['root', 'nested', 'overlap'])('refuses unsafe %s links before any migration writes', kind => {
    const f = fixture();
    const { store } = populate(f);
    const external = path.join(f.root, 'external');
    fs.mkdirSync(external);
    if (kind === 'root') {
      fs.renameSync(store, path.join(external, 'store'));
      fs.symlinkSync(path.join(external, 'store'), store);
    } else if (kind === 'nested') {
      fs.renameSync(path.join(store, 'db'), path.join(external, 'db'));
      fs.symlinkSync(path.join(external, 'db'), path.join(store, 'db'));
    } else {
      fs.symlinkSync(store, path.join(external, 'alias'));
      vi.stubEnv('LANES_HOME', path.join(external, 'alias', 'user'));
    }
    const before = tree(f.root);
    expect(() => migrateStorage(f.project)).toThrow(/linked|overlap/);
    expect(tree(f.root)).toEqual(before);
  });

  it.each(['lanes.config.json', 'clips.config.json'])('canonicalizes a same-file %s link without losing config values', name => {
    const f = fixture();
    const other = name === 'lanes.config.json' ? 'clips.config.json' : 'lanes.config.json';
    const { store } = populate(f, '.clips', other);
    fs.symlinkSync(other, path.join(store, name));
    migrateStorage(f.project);
    expect(JSON.parse(fs.readFileSync(path.join(f.project, '.lanes', 'lanes.config.json')))).toMatchObject({ custom: { keep: true } });
    expect(fs.existsSync(path.join(f.project, '.lanes', 'clips.config.json'))).toBe(false);
  });

  it('remaps installation and Copilot receipt paths while preserving unknown metadata', () => {
    const f = fixture();
    const { user } = populate(f);
    write(path.join(user, 'installation.json'), {
      prod_package: path.join(user, 'saved'), custom: { keep: true },
      skill_installations: { [path.join(user, 'skills', 'lanes')]: { files: {}, unknown: 1 } },
    });
    write(path.join(user, 'copilot-workspaces-install.json'), {
      version: 1, repository: f.project, custom: true,
      targets: [{ target: path.join(f.home, '.copilot', 'skills', 'lanes'), source: path.join(user, 'saved'), backup: path.join(user, 'backup'), created: true }],
    });
    migrateStorage(f.project);
    const canonical = path.join(f.home, '.lanes');
    expect(JSON.parse(fs.readFileSync(path.join(canonical, 'installation.json')))).toEqual({
      prod_package: path.join(canonical, 'saved'), custom: { keep: true },
      skill_installations: { [path.join(canonical, 'skills', 'lanes')]: { files: {}, unknown: 1 } },
    });
    expect(JSON.parse(fs.readFileSync(path.join(canonical, 'copilot-workspaces-install.json')))).toMatchObject({
      custom: true, targets: [{ source: path.join(canonical, 'saved'), backup: path.join(canonical, 'backup') }],
    });
  });

  it('leaves originals unchanged when staging fails and preserves concurrent writes detected by revalidation', () => {
    const f = fixture();
    const { store } = populate(f);
    const before = tree(f.root);
    const writeFile = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, ...args) => {
      if (typeof file === 'string' && file.includes('.migration-')) throw new Error('stage failure');
      return writeFile(file, ...args);
    });
    expect(() => migrateStorage(f.project)).toThrow('stage failure');
    expect(tree(f.root)).toEqual(before);
    vi.restoreAllMocks();
    const mkdir = fs.mkdirSync;
    vi.spyOn(fs, 'mkdirSync').mockImplementation((directory, ...args) => {
      const result = mkdir(directory, ...args);
      if (String(directory).includes('.migration-')) writeFile(path.join(store, 'concurrent'), 'writer update');
      return result;
    });
    expect(() => migrateStorage(f.project)).toThrow(/State changed during migration/);
    expect(fs.readFileSync(path.join(store, 'concurrent'), 'utf8')).toBe('writer update');
    expect(fs.existsSync(path.join(f.project, '.lanes'))).toBe(false);
  });

  it('retains original backups and migration locks when rollback itself fails', () => {
    const f = fixture();
    populate(f);
    const rename = fs.renameSync;
    vi.spyOn(fs, 'renameSync').mockImplementation((source, target) => {
      if (source.includes('.migration-') || source.includes('.backup-')) throw new Error('persistent rename failure');
      return rename(source, target);
    });
    expect(() => migrateStorage(f.project)).toThrow(/explicit recovery.*backups and migration locks/);
    const backup = fs.readdirSync(f.project).find(name => name.startsWith('.clips.backup-'));
    expect(fs.readFileSync(path.join(f.project, backup, 'db', 'g001.jsonl'), 'utf8')).toBe(`${JSON.stringify(goal)}\n`);
    expect(fs.existsSync(path.join(f.project, '.lanes-migration.lock'))).toBe(true);
  });

  it('rechecks the migration marker after acquiring a record lock', () => {
    const f = fixture();
    const { store } = populate(f);
    const file = path.join(store, 'db', 'g001.jsonl');
    const open = fs.openSync;
    vi.spyOn(fs, 'openSync').mockImplementation((target, ...args) => {
      const result = open(target, ...args);
      if (target === `${file}.lock`) write(path.join(f.project, '.lanes-migration.lock'), '{}');
      return result;
    });
    let called = false;
    expect(() => withRecordLock(file, () => { called = true; })).toThrow(/migration is in progress/);
    expect(called).toBe(false);
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });
  it('honors migration locks in both ordinary writers and explicit migration', () => {
    const f = fixture();
    populate(f);
    write(path.join(f.project, '.lanes-migration.lock'), '{}');
    expect(() => withRecordLock(path.join(f.project, '.clips', 'db', 'g001.jsonl'), () => {})).toThrow(/migration is in progress/);
    expect(() => migrateStorage(f.project)).toThrow();
    expect(fs.existsSync(path.join(f.project, '.clips'))).toBe(true);
    expect(fs.existsSync(path.join(f.project, '.lanes'))).toBe(false);
  });

  it('migrates the common root from a nested linked worktree', () => {
    const f = fixture();
    populate(f);
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-qm', 'fixture'], { cwd: f.project });
    const worktree = path.join(f.root, 'worktree');
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree], { cwd: f.project });
    const nested = path.join(worktree, 'nested');
    fs.mkdirSync(nested);
    const result = JSON.parse(run({ ...f, project: nested }, 'init', '--store-only'));
    expect(result.projectPath).toBe(f.project);
    expect(fs.existsSync(path.join(f.project, '.lanes', 'lanes.config.json'))).toBe(true);
    expect(fs.existsSync(path.join(worktree, '.lanes'))).toBe(false);
  });
});
