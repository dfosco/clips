import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getConfigPath, getConfigValue, getModelPreference, getUserModelPreference, initConfig,
  readConfig, setConfigValue, setModelPreference, unsetModelPreference, writeConfig,
} from './config.js';

const roots = [];
const existing = { username: 'existing-user', collaboration: false, custom: { keep: true } };

function workspace(content = JSON.stringify(existing)) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-config-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, '.clips'));
  const file = path.join(root, '.clips', 'clips.config.json');
  if (content !== null) fs.writeFileSync(file, content);
  return { root, file };
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Lane worker configuration', () => {
  it('reads numeric five without creating missing configuration', () => {
    const { root, file } = workspace(null);
    expect(readConfig(root).lane_max_active_agents).toBe(5);
    expect(getConfigValue('lane_max_active_agents', root)).toBe(5);
    expect(fs.existsSync(file)).toBe(false);
    expect(initConfig({}, root).lane_max_active_agents).toBe(5);
  });

  describe('layered model preferences', () => {
    it('resolves project over user over built-in and removes overrides without materializing defaults', () => {
      const { root } = workspace(null);
      const userStore = path.join(root, 'user-store');
      vi.stubEnv('HOME', root);
      vi.stubEnv('LANES_HOME', userStore);
      vi.stubEnv('CLIPS_HOME', path.join(root, 'legacy-user-store'));

      expect(getModelPreference('lane_manager_model', root)).toBe('gpt-6.1-sol');
      expect(getModelPreference('lane_manager_reasoning_effort', root)).toBe('high');
      expect(getModelPreference('lane_dev_model', root)).toBe('gpt-6-luna');
      expect(getModelPreference('lane_dev_reasoning_effort', root)).toBe('high');
      expect(getUserModelPreference('lane_dev_model')).toBeNull();

      fs.mkdirSync(userStore, { recursive: true });
      fs.writeFileSync(path.join(userStore, 'clips.config.json'), JSON.stringify({
        custom_user_setting: { keep: true },
        lane_dev_model: 'opaque-provider/model@revision',
      }));
      expect(getModelPreference('lane_dev_model', root)).toBe('opaque-provider/model@revision');

      fs.mkdirSync(path.join(root, '.clips'), { recursive: true });
      fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), JSON.stringify({
        custom_project_setting: 'preserve',
        lane_manager_reasoning_effort: 'xhigh',
      }));
      setModelPreference('lane_dev_model', 'project-model', { repoRoot: root });
      expect(getModelPreference('lane_dev_model', root)).toBe('project-model');
      expect(getModelPreference('lane_manager_reasoning_effort', root)).toBe('xhigh');

      unsetModelPreference('lane_dev_model', { repoRoot: root });
      expect(getModelPreference('lane_dev_model', root)).toBe('opaque-provider/model@revision');
      unsetModelPreference('lane_dev_model', { scope: 'user' });
      expect(getModelPreference('lane_dev_model', root)).toBe('gpt-6-luna');
      expect(JSON.parse(fs.readFileSync(path.join(userStore, 'clips.config.json'), 'utf8'))).toEqual({
        custom_user_setting: { keep: true },
      });
      expect(JSON.parse(fs.readFileSync(path.join(root, '.clips', 'clips.config.json'), 'utf8'))).toEqual({
        custom_project_setting: 'preserve',
        lane_manager_reasoning_effort: 'xhigh',
      });
    });

    it('does not pin inherited model defaults during init or unrelated project updates', () => {
      const { root } = workspace(null);
      initConfig({}, root);
      setConfigValue('username', 'project-user', root);
      const file = getConfigPath(root);
      const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(stored.username).toBe('project-user');
      expect(stored).not.toHaveProperty('lane_manager_model');
      expect(stored).not.toHaveProperty('lane_manager_reasoning_effort');
      expect(stored).not.toHaveProperty('lane_dev_model');
      expect(stored).not.toHaveProperty('lane_dev_reasoning_effort');
    });

    it('rejects invalid values and malformed stored data without overwriting it', () => {
      const { root } = workspace(null);
      const userStore = path.join(root, 'user-store');
      vi.stubEnv('HOME', root);
      vi.stubEnv('LANES_HOME', userStore);
      vi.stubEnv('CLIPS_HOME', '');
      expect(() => setModelPreference('lane_dev_model', '')).toThrow(/nonempty string/);
      expect(() => setModelPreference('lane_dev_model', 42)).toThrow(/nonempty string/);

      fs.mkdirSync(userStore, { recursive: true });
      const file = path.join(userStore, 'lanes.config.json');
      fs.writeFileSync(file, '[not an object]');
      const before = fs.readFileSync(file, 'utf8');
      expect(() => getModelPreference('lane_dev_model', root)).toThrow(/Could not read config file/);
      expect(() => setModelPreference('lane_dev_model', 'new-model', { scope: 'user' })).toThrow(/Could not read config file/);
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
    });

    it('writes through canonical config symlinks and reports a held record lock', () => {
      const { root } = workspace(null);
      const projectStore = path.join(root, '.lanes');
      const userStore = path.join(root, 'user-store');
      vi.stubEnv('HOME', root);
      fs.mkdirSync(projectStore, { recursive: true });
      fs.mkdirSync(userStore, { recursive: true });
      const projectTarget = path.join(projectStore, 'clips.config.json');
      const userTarget = path.join(userStore, 'clips.config.json');
      fs.writeFileSync(projectTarget, JSON.stringify({ custom_project: true }));
      fs.writeFileSync(userTarget, JSON.stringify({ custom_user: true }));
      fs.chmodSync(projectTarget, 0o600);
      fs.chmodSync(userTarget, 0o600);
      fs.symlinkSync('clips.config.json', path.join(projectStore, 'lanes.config.json'));
      fs.symlinkSync('clips.config.json', path.join(userStore, 'lanes.config.json'));
      vi.stubEnv('LANES_HOME', userStore);
      vi.stubEnv('CLIPS_HOME', '');

      setModelPreference('lane_manager_model', 'project-model', { repoRoot: root });
      setModelPreference('lane_dev_model', 'user-model', { scope: 'user' });
      expect(fs.lstatSync(path.join(projectStore, 'lanes.config.json')).isSymbolicLink()).toBe(true);
      expect(fs.lstatSync(path.join(userStore, 'lanes.config.json')).isSymbolicLink()).toBe(true);
      expect(JSON.parse(fs.readFileSync(projectTarget, 'utf8'))).toEqual({
        custom_project: true,
        lane_manager_model: 'project-model',
      });
      expect(JSON.parse(fs.readFileSync(userTarget, 'utf8'))).toEqual({
        custom_user: true,
        lane_dev_model: 'user-model',
      });
      expect(fs.statSync(projectTarget).mode & 0o777).toBe(0o600);
      expect(fs.statSync(userTarget).mode & 0o777).toBe(0o600);

      setConfigValue('collaboration', 'true', root);
      expect(fs.statSync(projectTarget).mode & 0o777).toBe(0o600);

      const projectConfig = getConfigPath(root);
      const before = fs.readFileSync(projectConfig, 'utf8');
      fs.writeFileSync(`${projectConfig}.lock`, 'active writer\n');
      expect(() => setModelPreference('lane_manager_model', 'blocked', { repoRoot: root })).toThrow(/being written/);
      expect(fs.readFileSync(projectConfig, 'utf8')).toBe(before);
    });

    it('creates new user configs with restrictive permissions and preserves existing project mode', () => {
      const { root } = workspace(null);
      const userStore = path.join(root, 'user-store');
      vi.stubEnv('HOME', root);
      vi.stubEnv('LANES_HOME', userStore);
      vi.stubEnv('CLIPS_HOME', '');

      setModelPreference('lane_dev_model', 'user-model', { scope: 'user' });
      const userConfig = path.join(userStore, 'lanes.config.json');
      expect(fs.statSync(userConfig).mode & 0o777).toBe(0o600);

      const projectConfig = path.join(root, '.clips', 'clips.config.json');
      fs.writeFileSync(projectConfig, JSON.stringify({ lane_dev_model: 'old-model' }));
      fs.chmodSync(projectConfig, 0o600);
      setModelPreference('lane_dev_model', 'new-model', { repoRoot: root });
      expect(fs.statSync(projectConfig).mode & 0o777).toBe(0o600);
      setConfigValue('collaboration', 'true', root);
      expect(fs.statSync(projectConfig).mode & 0o777).toBe(0o600);
    });
  });

  it.each([1, 8, Number.MAX_SAFE_INTEGER, '3', '05'])('persists a valid override %j and retains other settings', (value) => {
    const { root, file } = workspace();
    setConfigValue('lane_max_active_agents', value, root);
    expect(getConfigValue('lane_max_active_agents', root)).toBe(Number(value));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({
      ...existing, lane_max_active_agents: Number(value),
    });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '', 'abc', '1.5', '1e2', ' 5 ', 'true', null, false, [], {}].map((value) => [value]))(
    'rejects invalid overrides without writing: %j', (value) => {
      const { root, file } = workspace();
      const before = fs.readFileSync(file, 'utf8');
      expect(() => setConfigValue('lane_max_active_agents', value, root)).toThrow(/positive safe integer/);
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
    },
  );

  it.each([0, -1, 1.5, '5', null, false, [], {}].map((value) => [value]))(
    'rejects invalid persisted limits but permits explicit repair: %j', (value) => {
      const { root, file } = workspace(JSON.stringify({ ...existing, lane_max_active_agents: value }));
      const before = fs.readFileSync(file, 'utf8');
      expect(() => getConfigValue('lane_max_active_agents', root)).toThrow(/positive safe integer/);
      expect(fs.readFileSync(file, 'utf8')).toBe(before);
      expect(getConfigValue('username', root)).toBe(existing.username);
      setConfigValue('lane_max_active_agents', '4', root);
      expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ ...existing, lane_max_active_agents: 4 });
    },
  );

  it.each(['{', 'null', '[]', '"not a config"'])('does not overwrite malformed configuration: %s', (content) => {
    const { root, file } = workspace(content);
    expect(() => getConfigValue('lane_max_active_agents', root)).toThrow(/Could not read config/);
    expect(() => setConfigValue('lane_max_active_agents', '4', root)).toThrow(/Could not read config/);
    expect(() => setConfigValue('collaboration', 'true', root)).toThrow(/Could not read config/);
    expect(() => setConfigValue('username', 'changed', root)).toThrow(/Could not read config/);
    expect(() => writeConfig({ collaboration: true }, root)).toThrow(/Could not read config/);
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
  });
});
