import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getConfigValue, initConfig, readConfig, setConfigValue } from './config.js';

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
    expect(fs.readFileSync(file, 'utf8')).toBe(content);
  });
});
