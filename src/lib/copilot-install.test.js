import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { installCopilot, rollbackCopilotInstall } from './copilot-install.js';

const roots = [];
function writePackage(pluginRoot) {
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'package.json'), JSON.stringify({
    name: '@dfosco/clips-copilot',
    dependencies: { '@github/copilot-sdk': '1.0.22' },
  }));
  fs.writeFileSync(path.join(pluginRoot, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: { '': { dependencies: { '@github/copilot-sdk': '1.0.22' } } },
  }));
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-copilot-install-'));
  roots.push(root);
  const repositoryRoot = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const copilotHome = path.join(home, '.copilot');
  const clipsHome = path.join(home, '.clips');
  const pluginRoot = path.join(repositoryRoot, 'plugins', 'copilot');
  writePackage(pluginRoot);
  fs.writeFileSync(path.join(pluginRoot, 'extension.mjs'), 'export {}\n');
  fs.mkdirSync(path.join(repositoryRoot, 'plugins', 'copilot', 'skills', 'clips-copilot'), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, 'plugins', 'copilot', 'skills', 'clips-copilot', 'SKILL.md'), 'host adapter guidance\n');
  for (const skill of ['clips', 'lane-manager']) {
    const dir = path.join(repositoryRoot, '.agents', 'skills', skill);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `canonical ${skill}\n`);
  }
  fs.mkdirSync(path.join(copilotHome, 'extensions'), { recursive: true });
  fs.writeFileSync(path.join(copilotHome, 'settings.json'), '{"keep":true}\n');
  return { root, repositoryRoot, home, copilotHome, clipsHome, pluginRoot };
}
function install(f, extra = {}) {
  return installCopilot({
    repositoryRoot: f.repositoryRoot,
    home: f.home,
    copilotHome: f.copilotHome,
    clipsHome: f.clipsHome,
    runNpm: () => {},
    ...extra,
  });
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('local Copilot extension installation', () => {
  it('links the extension and canonical skills, preserves settings, and repeats without replacing links', () => {
    const f = fixture();
    const options = { repositoryRoot: f.repositoryRoot, home: f.home, copilotHome: f.copilotHome, clipsHome: f.clipsHome, runNpm: () => {} };
    const first = installCopilot(options);
    expect(first.results).toHaveLength(4);
    for (const { target, source, changed } of first.results) {
      expect(changed).toBe(true);
      expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(target)).toBe(source);
    }
    expect(fs.realpathSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces')))
      .toBe(fs.realpathSync(path.join(f.repositoryRoot, 'plugins', 'copilot')));
    expect(fs.readFileSync(path.join(f.copilotHome, 'skills', 'clips', 'SKILL.md'), 'utf8')).toBe('canonical clips\n');
    expect(fs.readFileSync(path.join(f.copilotHome, 'skills', 'lane-manager', 'SKILL.md'), 'utf8')).toBe('canonical lane-manager\n');
    expect(fs.readFileSync(path.join(f.copilotHome, 'skills', 'clips-copilot', 'SKILL.md'), 'utf8')).toBe('host adapter guidance\n');
    expect(fs.readFileSync(path.join(f.copilotHome, 'settings.json'), 'utf8')).toBe('{"keep":true}\n');

    const second = installCopilot(options);
    expect(second.results.every(result => !result.changed)).toBe(true);
    expect(second.results.map(result => result.target)).toEqual(first.results.map(result => result.target));
    fs.writeFileSync(path.join(f.repositoryRoot, '.agents', 'skills', 'clips', 'SKILL.md'), 'updated canonical clips\n');
    expect(fs.readFileSync(path.join(f.copilotHome, 'skills', 'clips', 'SKILL.md'), 'utf8')).toBe('updated canonical clips\n');
  });

  it('backs up existing local content and restores it on rollback', () => {
    const f = fixture();
    const extension = path.join(f.copilotHome, 'extensions', 'clips-workspaces');
    fs.mkdirSync(extension, { recursive: true });
    fs.writeFileSync(path.join(extension, 'local-note.txt'), 'keep me\n');
    const skill = path.join(f.copilotHome, 'skills', 'clips');
    fs.mkdirSync(skill, { recursive: true });
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'previous local guidance\n');

    const result = install(f);
    expect(result.results.find(item => item.target === extension).backup).toBeTruthy();
    expect(result.results.find(item => item.target === skill).backup).toBeTruthy();
    const rollback = rollbackCopilotInstall({ home: f.home, clipsHome: f.clipsHome });
    expect(rollback.rolledBack).toBe(true);
    expect(fs.readFileSync(path.join(extension, 'local-note.txt'), 'utf8')).toBe('keep me\n');
    expect(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8')).toBe('previous local guidance\n');
    expect(fs.existsSync(path.join(f.copilotHome, 'skills', 'lane-manager'))).toBe(false);
    expect(fs.existsSync(path.join(f.clipsHome, 'copilot-workspaces-install.json'))).toBe(false);
    expect(fs.readFileSync(path.join(f.copilotHome, 'settings.json'), 'utf8')).toBe('{"keep":true}\n');
  });

  it('restores a previous checkout link after updating to a different checkout', () => {
    const f = fixture();
    const options = { repositoryRoot: f.repositoryRoot, home: f.home, copilotHome: f.copilotHome, clipsHome: f.clipsHome, runNpm: () => {} };
    installCopilot(options);
    const secondCheckout = path.join(f.root, 'second-checkout');
    const secondPlugin = path.join(secondCheckout, 'plugins', 'copilot');
    writePackage(secondPlugin);
    fs.writeFileSync(path.join(secondPlugin, 'extension.mjs'), 'export const changed = true\n');
    fs.mkdirSync(path.join(secondCheckout, 'plugins', 'copilot', 'skills', 'clips-copilot'), { recursive: true });
    fs.writeFileSync(path.join(secondCheckout, 'plugins', 'copilot', 'skills', 'clips-copilot', 'SKILL.md'), 'second host guidance\n');
    for (const skill of ['clips', 'lane-manager']) {
      fs.mkdirSync(path.join(secondCheckout, '.agents', 'skills', skill), { recursive: true });
      fs.writeFileSync(path.join(secondCheckout, '.agents', 'skills', skill, 'SKILL.md'), `second ${skill}\n`);
    }
    installCopilot({ ...options, repositoryRoot: secondCheckout });
    expect(fs.realpathSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces')))
      .toBe(fs.realpathSync(path.join(secondCheckout, 'plugins', 'copilot')));
    rollbackCopilotInstall({ home: f.home, clipsHome: f.clipsHome });
    expect(fs.realpathSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces')))
      .toBe(fs.realpathSync(path.join(f.repositoryRoot, 'plugins', 'copilot')));
  });

  it('refuses rollback if an installed target has been replaced after installation', () => {
    const f = fixture();
    install(f);
    const extension = path.join(f.copilotHome, 'extensions', 'clips-workspaces');
    fs.unlinkSync(extension);
    fs.mkdirSync(extension);
    fs.writeFileSync(path.join(extension, 'user-file'), 'user edit\n');
    expect(() => rollbackCopilotInstall({ home: f.home, clipsHome: f.clipsHome })).toThrow(/rollback stopped/);
    expect(fs.readFileSync(path.join(extension, 'user-file'), 'utf8')).toBe('user edit\n');
    expect(fs.existsSync(path.join(f.clipsHome, 'copilot-workspaces-install.json'))).toBe(true);
  });

  it('runs locked dependency provisioning before exposing any symlink', () => {
    const f = fixture();
    let invocation;
    const result = install(f, { runNpm: (command, args, options) => {
      invocation = { command, args, options };
      expect(fs.existsSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces'))).toBe(false);
      expect(fs.existsSync(path.join(f.copilotHome, 'skills', 'clips'))).toBe(false);
    } });
    expect(invocation.command).toBe('npm');
    expect(invocation.args).toEqual(['ci', '--omit=dev', '--prefix', fs.realpathSync(f.pluginRoot)]);
    expect(invocation.options.stdio).toBe('inherit');
    expect(result.dependencies.lockPath).toBe(path.join(fs.realpathSync(f.pluginRoot), 'package-lock.json'));
    expect(fs.realpathSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces'))).toBe(fs.realpathSync(f.pluginRoot));
  });

  it('leaves local targets untouched if dependency installation fails', () => {
    const f = fixture();
    const extension = path.join(f.copilotHome, 'extensions', 'clips-workspaces');
    fs.mkdirSync(extension, { recursive: true });
    fs.writeFileSync(path.join(extension, 'old-file'), 'previous install\n');
    expect(() => install(f, { runNpm: () => { throw new Error('offline npm failure'); } })).toThrow('offline npm failure');
    expect(fs.readFileSync(path.join(extension, 'old-file'), 'utf8')).toBe('previous install\n');
    expect(fs.existsSync(path.join(f.copilotHome, 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(f.clipsHome, 'copilot-workspaces-install.json'))).toBe(false);
  });

  it('rolls back earlier links if a later link operation fails', () => {
    const f = fixture();
    let count = 0;
    expect(() => install(f, { installLink: spec => {
      count += 1;
      if (count === 4) throw new Error('simulated link failure');
      // Exercise the same symlink behavior through a one-target local install.
      fs.mkdirSync(path.dirname(spec.target), { recursive: true });
      fs.symlinkSync(spec.source, spec.target, 'dir');
      return { target: spec.target, source: spec.source, changed: true, created: true, backup: null };
    } })).toThrow(/simulated link failure/);
    expect(count).toBe(4);
    expect(fs.existsSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces'))).toBe(false);
    expect(fs.existsSync(path.join(f.copilotHome, 'skills', 'clips-copilot'))).toBe(false);
    expect(fs.existsSync(path.join(f.copilotHome, 'skills', 'clips'))).toBe(false);
    expect(fs.existsSync(path.join(f.clipsHome, 'copilot-workspaces-install.json'))).toBe(false);
  });
});
