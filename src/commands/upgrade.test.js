import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const cli = path.resolve('src/cli.js');
const roots = [];

function fixture({ npmMode = 'success', linked = false, savedProd = false, initialVersion, invalidManifest = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-upgrade-'));
  roots.push(root);
  const cwd = path.join(root, 'outside-git');
  const home = path.join(root, 'home');
  const globalRoot = path.join(root, 'global', 'node_modules');
  const bin = path.join(root, 'bin');
  const log = path.join(root, 'npm-calls.jsonl');
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(bin);
  if (initialVersion || invalidManifest) {
    const installed = path.join(globalRoot, '@dfosco', 'lanes');
    fs.mkdirSync(installed, { recursive: true });
    fs.writeFileSync(path.join(installed, 'package.json'), invalidManifest
      ? '{not json'
      : JSON.stringify({ name: '@dfosco/lanes', version: initialVersion }));
  }
  const fakeNpm = path.join(bin, 'npm');
  fs.writeFileSync(fakeNpm, `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'root' && args[1] === '--global') {
  process.stdout.write(process.env.FAKE_GLOBAL_ROOT + '\\n');
} else if (args[0] === 'install') {
  if (process.env.FAKE_NPM_MODE === 'install-failure') {
    process.stderr.write('simulated registry failure\\n');
    process.exit(17);
  }
  if (process.env.FAKE_NPM_MODE !== 'missing-package') {
    const target = path.join(process.env.FAKE_GLOBAL_ROOT, '@dfosco', 'lanes');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: '@dfosco/lanes', version: '9.8.7' }));
  }
} else process.exit(88);
`);
  fs.chmodSync(fakeNpm, 0o755);
  if (linked) {
    const source = path.join(root, 'dev-checkout');
    fs.mkdirSync(path.join(source, 'src'), { recursive: true });
    fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({ name: '@dfosco/lanes', version: '0.0.0-dev' }));
    fs.mkdirSync(path.dirname(path.join(globalRoot, '@dfosco', 'lanes')), { recursive: true });
    fs.symlinkSync(source, path.join(globalRoot, '@dfosco', 'lanes'), 'dir');
  }
  if (savedProd) {
    const prod = path.join(root, 'saved-prod');
    fs.mkdirSync(path.join(prod, 'src'), { recursive: true });
    fs.writeFileSync(path.join(prod, 'package.json'), JSON.stringify({ name: '@dfosco/lanes', version: '1.0.0' }));
    fs.writeFileSync(path.join(prod, 'src', 'cli.js'), `require('node:fs').writeFileSync(process.env.DELEGATED_MARKER, 'yes');\n`);
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'installation.json'), JSON.stringify({
      mode: 'prod', dev_checkout: path.resolve(path.dirname(cli), '..'), prod_package: prod,
    }));
  }
  return {
    root, cwd, home, globalRoot, log,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}`,
      LANES_HOME: home,
      CLIPS_HOME: path.join(root, 'legacy-home'),
      FAKE_GLOBAL_ROOT: globalRoot,
      FAKE_NPM_LOG: log,
      FAKE_NPM_MODE: npmMode,
      DELEGATED_MARKER: path.join(root, 'delegated'),
    },
  };
}

function run(f, ...args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: f.cwd, env: f.env, encoding: 'utf8' });
}

function calls(f) {
  return fs.existsSync(f.log) ? fs.readFileSync(f.log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)) : [];
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('lanes upgrade', () => {
  it('updates latest stable globally and verifies the package manifest outside Git', () => {
    const f = fixture({ savedProd: true });
    const result = run(f, 'upgrade');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Updated @dfosco/lanes to v9.8.7');
    expect(result.stderr).toBe('');
    expect(calls(f)).toEqual([
      ['root', '--global'],
      ['install', '--global', '@dfosco/lanes@latest'],
      ['root', '--global'],
    ]);
    expect(fs.existsSync(f.env.DELEGATED_MARKER)).toBe(false);
    expect(fs.existsSync(path.join(f.cwd, '.lanes'))).toBe(false);
    expect(fs.existsSync(path.join(f.cwd, '.clips'))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(f.globalRoot, '@dfosco', 'lanes', 'package.json'))).version).toBe('9.8.7');
  });

  it('reports when the verified package was already current', () => {
    const f = fixture({ initialVersion: '9.8.7' });
    const result = run(f, 'upgrade');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('@dfosco/lanes is already at v9.8.7');
    expect(calls(f)).toEqual([
      ['root', '--global'],
      ['install', '--global', '@dfosco/lanes@latest'],
      ['root', '--global'],
    ]);
  });

  it('keeps help read-only and rejects unknown arguments without invoking npm', () => {
    const f = fixture();
    expect(run(f, 'upgrade', '--help')).toMatchObject({ status: 0, stderr: '' });
    expect(run(f, 'upgrade', '--help').stdout).toContain('latest stable npm release');
    const invalid = run(f, 'upgrade', '--force');
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('Unknown upgrade argument');
    expect(calls(f)).toEqual([]);
    expect(fs.existsSync(path.join(f.cwd, '.lanes'))).toBe(false);
  });

  it('refuses a global development symlink before replacing it', () => {
    const f = fixture({ linked: true });
    const result = run(f, 'upgrade');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('development link');
    expect(result.stderr).toContain('npm install --global @dfosco/lanes@latest');
    expect(calls(f)).toEqual([['root', '--global']]);
    expect(fs.lstatSync(path.join(f.globalRoot, '@dfosco', 'lanes')).isSymbolicLink()).toBe(true);
  });

  it('reports npm unavailable, install failure, and missing installed package', () => {
    const unavailable = fixture();
    unavailable.env.PATH = path.join(unavailable.root, 'empty-path');
    fs.mkdirSync(unavailable.env.PATH);
    const missingNpm = run(unavailable, 'upgrade');
    expect(missingNpm.status).toBe(1);
    expect(missingNpm.stderr).toContain('npm was not found on PATH');

    const failedInstall = fixture({ npmMode: 'install-failure' });
    const failed = run(failedInstall, 'upgrade');
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain('simulated registry failure');
    expect(calls(failedInstall)).toEqual([['root', '--global'], ['install', '--global', '@dfosco/lanes@latest']]);

    const missingPackage = fixture({ npmMode: 'missing-package' });
    const unverified = run(missingPackage, 'upgrade');
    expect(unverified.status).toBe(1);
    expect(unverified.stderr).toContain('was not found under the global npm root');

    const corruptPackage = fixture({ invalidManifest: true });
    const corrupt = run(corruptPackage, 'upgrade');
    expect(corrupt.status).toBe(1);
    expect(corrupt.stderr).toContain('Could not verify the global @dfosco/lanes manifest');
    expect(calls(corruptPackage)).toEqual([['root', '--global']]);
  });
});
