import fs from 'node:fs';
import { canvasBuildManifest } from '../../plugins/copilot/src/canvas-build.js';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { copilotSdkPlatform, installCopilot, rollbackCopilotInstall, verifyCopilotPrerequisites } from './copilot-install.js';

const roots = [];
function writeRootRuntime(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@dfosco/clips', version: '1.8.0', type: 'module', dependencies: { 'fixture-runtime': '1.0.0' } }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/fixture-runtime': { version: '1.0.0' } } }));
  fs.mkdirSync(path.join(root, 'node_modules/fixture-runtime'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/fixture-runtime/package.json'), JSON.stringify({ name: 'fixture-runtime', version: '1.0.0', type: 'module', exports: './index.js' }));
  fs.writeFileSync(path.join(root, 'node_modules/fixture-runtime/index.js'), 'export {};');
  fs.writeFileSync(path.join(root, 'src/cli.js'), "import 'fixture-runtime'; console.log('clips v1.8.0');\n");
}
function writePackage(pluginRoot) {
  const platformName = copilotSdkPlatform();
  const platformPackage = `@github/copilot-sdk-${platformName}`;
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, 'package.json'), JSON.stringify({
    name: '@dfosco/clips-copilot',
    dependencies: { '@github/copilot-sdk': '1.0.22' },
  }));
  fs.writeFileSync(path.join(pluginRoot, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@github/copilot-sdk': '1.0.22' } },
      'node_modules/@github/copilot-sdk': { version: '1.0.22', optionalDependencies: { [platformPackage]: '1.0.22' } },
      [`node_modules/${platformPackage}`]: { version: '1.0.22', optional: true },
    },
  }));
  for (const [file, content] of Object.entries({
    'canvas/ui/main.jsx': 'export {}', 'canvas/board-view.mjs': 'export {}', 'canvas/model.mjs': 'export {}',
    'canvas/index.html': '<div id="root"></div>',
    'jsconfig.json': '{}', 'vite.config.js': 'export {}', 'scripts/build-canvas.mjs': 'export {}', 'src/canvas-build.js': 'export {}',
    'canvas/dist/app.js': 'export {}', 'canvas/dist/style.css': 'body{}',
  })) { fs.mkdirSync(path.dirname(path.join(pluginRoot, file)), { recursive: true }); fs.writeFileSync(path.join(pluginRoot, file), content); }
  fs.writeFileSync(path.join(pluginRoot, 'canvas/dist/build-manifest.json'), JSON.stringify(canvasBuildManifest(pluginRoot)));

}
function installFakePlatformPackage(pluginRoot) {
  const platformName = copilotSdkPlatform();
  const sdkRoot = path.join(pluginRoot, 'node_modules', '@github', 'copilot-sdk');
  const platformRoot = path.join(pluginRoot, 'node_modules', '@github', `copilot-sdk-${platformName}`);
  fs.mkdirSync(path.join(sdkRoot, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(sdkRoot, 'dist', 'runtimeArtifacts.js'), 'export {}\n');
  fs.writeFileSync(path.join(sdkRoot, 'package.json'), JSON.stringify({ name: '@github/copilot-sdk', version: '1.0.22' }));
  fs.mkdirSync(path.join(platformRoot, 'prebuilds', platformName), { recursive: true });
  fs.writeFileSync(path.join(platformRoot, 'package.json'), JSON.stringify({ name: `@github/copilot-sdk-${platformName}`, version: '1.0.22' }));
  fs.writeFileSync(path.join(platformRoot, 'prebuilds', platformName, platformName.startsWith('win32') ? 'copilot-runtime.exe' : 'copilot-runtime'), 'runtime');
  fs.writeFileSync(path.join(platformRoot, 'prebuilds', platformName, 'runtime.node'), 'runtime');
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-copilot-install-'));
  roots.push(root);
  const repositoryRoot = path.join(root, 'repo');
  const home = path.join(root, 'home');
  const copilotHome = path.join(home, '.copilot');
  const clipsHome = path.join(home, '.clips');
  const pluginRoot = path.join(repositoryRoot, 'plugins', 'copilot');
  writeRootRuntime(repositoryRoot);
  writePackage(pluginRoot);
  fs.writeFileSync(path.join(pluginRoot, 'extension.mjs'), 'export {}\n');
  fs.mkdirSync(path.join(repositoryRoot, 'plugins', 'copilot', 'skills', 'clips-copilot'), { recursive: true });
  fs.writeFileSync(path.join(repositoryRoot, 'plugins', 'copilot', 'skills', 'clips-copilot', 'SKILL.md'), 'host adapter guidance\n');
  for (const skill of ['clips', 'lane-manager', 'clips-dev']) {
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
    runNpm: (_command, args) => installFakePlatformPackage(args.at(-1)),
    ...extra,
  });
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('local Copilot extension installation', () => {
  it('links the extension and canonical skills, preserves settings, and repeats without replacing links', () => {
    const f = fixture();
    const options = { repositoryRoot: f.repositoryRoot, home: f.home, copilotHome: f.copilotHome, clipsHome: f.clipsHome, runNpm: (_command, args) => installFakePlatformPackage(args.at(-1)) };
    const first = installCopilot(options);
    expect(first.results).toHaveLength(5);
    expect(first.dependencies.installedPlatformPackage.packageName).toBe(`@github/copilot-sdk-${copilotSdkPlatform()}`);
    expect(fs.existsSync(first.dependencies.installedPlatformPackage.runtimeNode)).toBe(true);
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
    const repeated = install(f);
    expect(repeated.results.every(item => !item.changed)).toBe(true);
    expect(repeated.results.find(item => item.target === extension).backup)
      .toBe(result.results.find(item => item.target === extension).backup);
    const rollback = rollbackCopilotInstall({ home: f.home, clipsHome: f.clipsHome });
    expect(rollback.rolledBack).toBe(true);
    expect(fs.readFileSync(path.join(extension, 'local-note.txt'), 'utf8')).toBe('keep me\n');
    expect(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8')).toBe('previous local guidance\n');
    expect(fs.existsSync(path.join(f.copilotHome, 'skills', 'lane-manager'))).toBe(false);
    expect(fs.existsSync(path.join(f.clipsHome, 'copilot-workspaces-install.json'))).toBe(false);
    expect(fs.readFileSync(path.join(f.copilotHome, 'settings.json'), 'utf8')).toBe('{"keep":true}\n');
  });

  it('restores a backup when an installed link was already removed before rollback', () => {
    const f = fixture();
    const extension = path.join(f.copilotHome, 'extensions', 'clips-workspaces');
    fs.mkdirSync(extension, { recursive: true });
    fs.writeFileSync(path.join(extension, 'local-note.txt'), 'keep me\n');

    const result = install(f);
    const entry = result.results.find(item => item.target === extension);
    fs.unlinkSync(extension);

    const rollback = rollbackCopilotInstall({ home: f.home, clipsHome: f.clipsHome });
    expect(rollback.rolledBack).toBe(true);
    expect(fs.readFileSync(path.join(extension, 'local-note.txt'), 'utf8')).toBe('keep me\n');
    expect(fs.existsSync(entry.backup)).toBe(false);
    expect(fs.existsSync(path.join(f.clipsHome, 'copilot-workspaces-install.json'))).toBe(false);
  });

  it('preserves rollback backups when repeated through an equivalent home-directory alias', () => {
    const f = fixture();
    const extension = path.join(f.copilotHome, 'extensions', 'clips-workspaces');
    fs.mkdirSync(extension);
    fs.writeFileSync(path.join(extension, 'previous.txt'), 'original contents');
    const first = install(f);
    const alias = path.join(f.root, 'home-alias');
    fs.symlinkSync(f.home, alias, 'dir');
    const repeated = install(f, { copilotHome: path.join(alias, '.copilot') });
    expect(repeated.results.every(item => !item.changed)).toBe(true);
    expect(repeated.results[0].created).toBe(true);
    expect(repeated.results[0].backup).toBe(first.results[0].backup);
    rollbackCopilotInstall({ home: f.home, clipsHome: f.clipsHome });
    expect(fs.readFileSync(path.join(extension, 'previous.txt'), 'utf8')).toBe('original contents');
    expect(fs.existsSync(path.join(f.copilotHome, 'skills', 'lane-manager'))).toBe(false);
  });

  it('restores a previous checkout link after updating to a different checkout', () => {
    const f = fixture();
    const options = { repositoryRoot: f.repositoryRoot, home: f.home, copilotHome: f.copilotHome, clipsHome: f.clipsHome, runNpm: (_command, args) => installFakePlatformPackage(args.at(-1)) };
    installCopilot(options);
    const secondCheckout = path.join(f.root, 'second-checkout');
    const secondPlugin = path.join(secondCheckout, 'plugins', 'copilot');
    writeRootRuntime(secondCheckout);
    writePackage(secondPlugin);
    fs.writeFileSync(path.join(secondPlugin, 'extension.mjs'), 'export const changed = true\n');
    fs.mkdirSync(path.join(secondCheckout, 'plugins', 'copilot', 'skills', 'clips-copilot'), { recursive: true });
    fs.writeFileSync(path.join(secondCheckout, 'plugins', 'copilot', 'skills', 'clips-copilot', 'SKILL.md'), 'second host guidance\n');
    for (const skill of ['clips', 'lane-manager', 'clips-dev']) {
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
      installFakePlatformPackage(f.pluginRoot);
    } });
    expect(invocation.command).toBe('npm');
    expect(invocation.args).toEqual(['ci', '--omit=dev', '--include=optional', '--prefix', fs.realpathSync(f.pluginRoot)]);
    expect(invocation.options.stdio).toBe('inherit');
    expect(result.dependencies.lockPath).toBe(path.join(fs.realpathSync(f.pluginRoot), 'package-lock.json'));
    expect(result.dependencies.platformPackage.packageName).toBe(`@github/copilot-sdk-${copilotSdkPlatform()}`);
    expect(fs.realpathSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces'))).toBe(fs.realpathSync(f.pluginRoot));
  });

  it('checks the canonical CLI with locked checkout-local runtime dependencies before npm or links', () => {
    const f = fixture();
    const result = install(f);
    expect(result.prerequisites.cliPath).toBe(path.join(fs.realpathSync(f.repositoryRoot), 'src/cli.js'));
    expect(result.prerequisites.clipsVersion).toBe('1.8.0');
    rollbackCopilotInstall({ home: f.home, clipsHome: f.clipsHome });
    fs.rmSync(path.join(f.repositoryRoot, 'node_modules'), { recursive: true });
    let npmCalled = false;
    expect(() => install(f, { runNpm: () => { npmCalled = true; } })).toThrow(/locked root runtime dependencies/);
    expect(npmCalled).toBe(false);
    expect(fs.existsSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces'))).toBe(false);
    expect(fs.readFileSync(path.join(f.copilotHome, 'settings.json'), 'utf8')).toBe('{"keep":true}\n');
  });

  it('rejects incomplete CLI imports and mismatched locked runtime versions before provisioning', () => {
    const f = fixture();
    let npmCalled = false;
    const runNpm = () => { npmCalled = true; };
    fs.appendFileSync(path.join(f.repositoryRoot, 'src/cli.js'), "import './missing-module.js';\n");
    expect(() => install(f, { runNpm })).toThrow(/complete Clips checkout/);
    writeRootRuntime(f.repositoryRoot);
    fs.writeFileSync(path.join(f.repositoryRoot, 'node_modules/fixture-runtime/package.json'), '{"version":"0.9.0"}');
    expect(() => install(f, { runNpm })).toThrow(/does not match package-lock.json/);
    expect(npmCalled).toBe(false);
    expect(fs.existsSync(path.join(f.clipsHome, 'copilot-workspaces-install.json'))).toBe(false);
  });

  it('accepts the published shrinkwrap while enforcing its locked runtime versions', () => {
    const f = fixture();
    fs.renameSync(path.join(f.repositoryRoot, 'package-lock.json'), path.join(f.repositoryRoot, 'npm-shrinkwrap.json'));
    expect(verifyCopilotPrerequisites(f.repositoryRoot).clipsVersion).toBe('1.8.0');
    fs.writeFileSync(path.join(f.repositoryRoot, 'node_modules/fixture-runtime/package.json'), '{"version":"0.9.0"}');
    expect(() => verifyCopilotPrerequisites(f.repositoryRoot)).toThrow(/does not match npm-shrinkwrap.json/);
  });

  it('rejects Node versions below the extension minimum before any runtime or installation work', () => {
    const f = fixture();
    for (const nodeVersion of ['18.20.0', '20.19.0', '22.17.0']) {
      expect(() => verifyCopilotPrerequisites(f.repositoryRoot, { nodeVersion, runNode: () => { throw new Error('must not run'); } }))
        .toThrow(/Node.js 22.18 or newer/);
    }
  });

  it('refuses stale canvas source before any npm or link mutation', () => {
    const f = fixture();
    fs.appendFileSync(path.join(f.pluginRoot, 'canvas/ui/main.jsx'), '// stale');
    let npmCalled = false;
    expect(() => install(f, { runNpm: () => { npmCalled = true; } })).toThrow(/canvas build is missing or stale/);
    expect(npmCalled).toBe(false);
    expect(fs.existsSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces'))).toBe(false);
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

  it('fails before exposing paths if npm omits the locked host platform package', () => {
    const f = fixture();
    expect(() => install(f, { runNpm: () => {} })).toThrow(/platform package .* is not resolvable/);
    expect(fs.existsSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces'))).toBe(false);
    expect(fs.existsSync(path.join(f.copilotHome, 'skills'))).toBe(false);
    expect(fs.existsSync(path.join(f.clipsHome, 'copilot-workspaces-install.json'))).toBe(false);
  });

  it('rejects a missing platform runtime.node before exposing an extension', () => {
    const f = fixture();
    expect(() => install(f, { runNpm: () => {
      installFakePlatformPackage(f.pluginRoot);
      fs.unlinkSync(path.join(f.pluginRoot, 'node_modules/@github', `copilot-sdk-${copilotSdkPlatform()}`, 'prebuilds', copilotSdkPlatform(), 'runtime.node'));
    } })).toThrow(/missing its runtime files/);
    expect(fs.existsSync(path.join(f.copilotHome, 'extensions', 'clips-workspaces'))).toBe(false);
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
