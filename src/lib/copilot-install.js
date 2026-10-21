import fs from 'node:fs';
import { verifyCanvasBuild } from '../../plugins/copilot/src/canvas-build.js';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { getSystemClipsDir } from './registry.js';

export const COPILOT_SKILL_NAMES = ['lanes', 'lane-manager', 'lane-dev', 'lane-radar', 'lane-plugin'];
const STATE_VERSION = 1;

export function verifyCopilotPrerequisites(repositoryRoot, {
  nodeVersion = process.versions.node,
  runNode = execFileSync,
  clipsHome = getSystemClipsDir(),
} = {}) {
  const [major, minor] = nodeVersion.split('.').map(Number);
  if (!(major > 22 || (major === 22 && minor >= 18))) {
    throw new Error(`Copilot installation requires Node.js 22.18 or newer; found ${nodeVersion}.`);
  }
  const root = fs.realpathSync(repositoryRoot);
  const cliPath = path.join(root, 'src', 'cli.js');
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const lockName = fs.existsSync(path.join(root, 'npm-shrinkwrap.json')) ? 'npm-shrinkwrap.json' : 'package-lock.json';
    const lock = JSON.parse(fs.readFileSync(path.join(root, lockName), 'utf8'));
    if (!['@dfosco/lanes', '@dfosco/clips'].includes(manifest.name) || !manifest.version || !fs.statSync(cliPath).isFile()) {
      throw new Error('The canonical Lanes CLI is missing.');
    }
    // Require checkout-local, locked production dependencies. Node's normal
    // ancestor lookup must not make an incomplete checkout appear installable.
    for (const name of Object.keys(manifest.dependencies || {})) {
      const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules', name, 'package.json'), 'utf8'));
      const locked = lock.packages?.[`node_modules/${name}`];
      if (!locked?.version || installed.version !== locked.version) {
        throw new Error(`The checkout's ${name} does not match ${lockName}.`);
      }
    }
    // Loading the actual entry checks its transitive imports as well. Avoid a
    // user's saved production-mode dispatch while checking this exact checkout.
    const version = runNode(process.execPath, [cliPath, '--version'], {
      cwd: root, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, LANES_HOME: clipsHome, CLIPS_HOME: clipsHome, LANES_SWITCH_INIT: '1', CLIPS_SWITCH_INIT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (![ `lanes v${manifest.version}`, `clips v${manifest.version}` ].includes(version)) throw new Error(`Unexpected canonical CLI version: ${version}`);
    return { nodeVersion, nodePath: process.execPath, cliPath, lanesVersion: manifest.version, clipsVersion: manifest.version };
  } catch (error) {
    throw new Error(`Copilot installation requires the complete Lanes checkout and its locked root runtime dependencies. Run npm ci --omit=dev --ignore-scripts at the repository root before retrying. ${error.message}`, { cause: error });
  }
}

export function copilotSdkPlatform() {
  const { platform, arch } = process;
  if (arch !== 'arm64' && arch !== 'x64') throw new Error(`Unsupported Copilot SDK architecture: ${arch}`);
  if (platform === 'linux') {
    const musl = process.report?.getReport()?.header?.glibcVersionRuntime === undefined;
    return `${musl ? 'linuxmusl' : 'linux'}-${arch}`;
  }
  if (platform === 'darwin' || platform === 'win32') return `${platform}-${arch}`;
  throw new Error(`Unsupported Copilot SDK platform: ${platform}-${arch}`);
}

function resolveSdkPlatformPackage(pluginRoot, platformName) {
  const sdkRoot = path.join(pluginRoot, 'node_modules', '@github', 'copilot-sdk');
  const sdkRuntime = path.join(sdkRoot, 'dist', 'runtimeArtifacts.js');
  const requireFromSdk = createRequire(sdkRuntime);
  const packageName = `@github/copilot-sdk-${platformName}`;
  const candidate = (requireFromSdk.resolve.paths(packageName) || [])
    .map(base => path.join(base, ...packageName.split('/')))
    .find(base => fs.existsSync(path.join(base, 'package.json')));
  if (!candidate) {
    throw new Error(`Copilot SDK platform package ${packageName} is not resolvable from ${sdkRuntime}`);
  }
  const sdk = JSON.parse(fs.readFileSync(path.join(sdkRoot, 'package.json'), 'utf8'));
  const platformPackage = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'));
  if (platformPackage.version !== sdk.version) {
    throw new Error(`Copilot SDK platform package ${packageName}@${platformPackage.version} does not match SDK ${sdk.version}`);
  }
  const prebuildDir = path.join(candidate, 'prebuilds', platformName);
  const wrapper = path.join(prebuildDir, platformName.startsWith('win32') ? 'copilot-runtime.exe' : 'copilot-runtime');
  const runtimeNode = path.join(prebuildDir, 'runtime.node');
  if (!fs.existsSync(wrapper) || !fs.existsSync(runtimeNode)) {
    throw new Error(`Copilot SDK platform package ${packageName} is missing its runtime files`);
  }
  return { packageName, packageRoot: candidate, wrapper, runtimeNode };
}

export function provisionCopilotDependencies(repositoryRoot, {
  runNpm = execFileSync,
} = {}) {
  const pluginRoot = path.join(fs.realpathSync(repositoryRoot), 'plugins', 'copilot');
  const packagePath = path.join(pluginRoot, 'package.json');
  const lockPath = path.join(pluginRoot, 'package-lock.json');
  const manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const sdkVersion = manifest.dependencies?.['@github/copilot-sdk'];
  const platformName = copilotSdkPlatform();
  const platformPackageName = `@github/copilot-sdk-${platformName}`;
  const lockedSdk = lock.packages?.['node_modules/@github/copilot-sdk'];
  const lockedPlatform = lock.packages?.[`node_modules/${platformPackageName}`];
  if (!manifest.dependencies?.['@github/copilot-sdk']) {
    throw new Error('Copilot extension package.json must declare @github/copilot-sdk');
  }
  if (!Number.isInteger(lock.lockfileVersion) || lock.lockfileVersion < 2 ||
      lock.packages?.['']?.dependencies?.['@github/copilot-sdk'] !== sdkVersion ||
      lockedSdk?.version !== sdkVersion ||
      lockedSdk?.optionalDependencies?.[platformPackageName] !== sdkVersion ||
      !lockedPlatform?.optional || lockedPlatform.version !== sdkVersion) {
    throw new Error(`Copilot package-lock.json must lock ${platformPackageName}@${sdkVersion} as an optional SDK package`);
  }
  const command = ['npm', 'ci', '--omit=dev', '--include=optional', '--prefix', pluginRoot];
  runNpm('npm', command.slice(1), { stdio: 'inherit' });
  const platformPackage = resolveSdkPlatformPackage(pluginRoot, platformName);
  return { pluginRoot, packagePath, lockPath, platformPackage, command };
}

function readState(stateFile) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.version !== STATE_VERSION || !Array.isArray(state.targets)) {
      throw new Error(`Unsupported Copilot install state at ${stateFile}`);
    }
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function targetEntry(target) {
  try { return fs.lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function pointsTo(target, source) {
  try { return fs.realpathSync(target) === source; }
  catch { return false; }
}

function recordedLink(target, source) {
  return targetEntry(target)?.isSymbolicLink() &&
    (path.resolve(path.dirname(target), fs.readlinkSync(target)) === source || pointsTo(target, source));
}

function targetIdentity(target) {
  // Match equivalent home paths (for example /var and /private/var on macOS)
  // without following the installed leaf link into the source checkout.
  try { return path.join(fs.realpathSync(path.dirname(target)), path.basename(target)); }
  catch (error) { if (error.code === 'ENOENT') return path.resolve(target); throw error; }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function replaceWithLink({ target, source, backupRoot, name }) {
  const existing = targetEntry(target);
  if (existing && pointsTo(target, source)) {
    return { target, source, changed: false, created: false, backup: null };
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.clips-${process.pid}-${randomUUID()}`;
  fs.symlinkSync(source, temporary, 'dir');
  let backup = null;
  let movedExisting = false;
  try {
    if (existing) {
      fs.mkdirSync(backupRoot, { recursive: true });
      const backupDir = fs.mkdtempSync(path.join(backupRoot, `${name}-`));
      backup = path.join(backupDir, 'previous');
      fs.renameSync(target, backup);
      movedExisting = true;
    }
    fs.renameSync(temporary, target);
    return { target, source, changed: true, created: true, backup };
  } catch (error) {
    if (movedExisting && !targetEntry(target)) fs.renameSync(backup, target);
    throw error;
  } finally {
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function rollbackApplied(entries) {
  for (const entry of [...entries].reverse()) {
    if (!entry.changed || !entry.created) continue;
    if (!targetEntry(entry.target)) {
      if (entry.backup && targetEntry(entry.backup)) {
        fs.mkdirSync(path.dirname(entry.target), { recursive: true });
        fs.renameSync(entry.backup, entry.target);
      }
      continue;
    }
    if (!fs.lstatSync(entry.target).isSymbolicLink() || !pointsTo(entry.target, entry.source)) {
      throw new Error(`Copilot install rollback stopped: ${entry.target} no longer points to ${entry.source}`);
    }
    fs.unlinkSync(entry.target);
    if (entry.backup) fs.renameSync(entry.backup, entry.target);
  }
}

export function copilotInstallPaths({
  repositoryRoot,
  home = os.homedir(),
  copilotHome = process.env.COPILOT_HOME || path.join(home, '.copilot'),
} = {}) {
  const root = fs.realpathSync(repositoryRoot);
  const extensionSource = fs.realpathSync(path.join(root, 'plugins', 'copilot'));
  const extensionTarget = path.join(copilotHome, 'extensions', 'clips-workspaces');
  const skillsRoot = path.join(copilotHome, 'skills');
  const targets = [{ name: 'clips-workspaces', target: extensionTarget, source: extensionSource }];
  const hostSkill = fs.realpathSync(path.join(extensionSource, 'skills', 'lanes-copilot'));
  if (!fs.statSync(path.join(hostSkill, 'SKILL.md')).isFile()) throw new Error('Copilot host skill is missing SKILL.md');
  targets.push({ name: 'skill-lanes-copilot', target: path.join(skillsRoot, 'lanes-copilot'), source: hostSkill });
  for (const name of COPILOT_SKILL_NAMES) {
    const source = fs.realpathSync(path.join(root, '.agents', 'skills', name));
    if (!fs.statSync(path.join(source, 'SKILL.md')).isFile()) throw new Error(`Canonical ${name} skill is missing SKILL.md`);
    targets.push({ name: `skill-${name}`, target: path.join(skillsRoot, name), source });
  }
  return targets;
}

export function installCopilot({
  repositoryRoot,
  home = os.homedir(),
  copilotHome = process.env.COPILOT_HOME || path.join(home, '.copilot'),
  lanesHome,
  clipsHome = lanesHome || getSystemClipsDir({ home }),
  runNpm = execFileSync,
  installLink = replaceWithLink,
} = {}) {
  const root = fs.realpathSync(repositoryRoot);
  const stateFile = path.join(clipsHome, 'copilot-workspaces-install.json');
  const previous = readState(stateFile);
  const previousByTarget = new Map((previous?.targets || []).map(item => [targetIdentity(item.target), item]));
  const backupRoot = path.join(clipsHome, 'copilot-backups');
  const applied = [];
  const retired = [];
  let committed = false;

  try {
    const prerequisites = verifyCopilotPrerequisites(root, { clipsHome });
    const targets = copilotInstallPaths({ repositoryRoot: root, home, copilotHome });
    const canvasBuild = verifyCanvasBuild(path.join(root, 'plugins', 'copilot'));
    const dependencies = provisionCopilotDependencies(root, { runNpm });
    const results = targets.map(spec => {
      const result = installLink({ ...spec, backupRoot, name: spec.name });
      if (!result.changed) {
        const prior = previousByTarget.get(targetIdentity(result.target));
        if (prior?.source === result.source) {
          result.created = prior.created;
          result.backup = prior.backup || null;
        }
      }
      applied.push(result);
      return result;
    });
    const installedPlatformPackage = resolveSdkPlatformPackage(
      path.join(copilotHome, 'extensions', 'clips-workspaces'),
      copilotSdkPlatform(),
    );
    verifyCanvasBuild(path.join(copilotHome, 'extensions', 'clips-workspaces'));
    const legacyTargets = new Set(['clips', 'clips-dev', 'clips-copilot'].map(name => targetIdentity(path.join(copilotHome, 'skills', name))));
    const retained = [];
    const currentTargets = new Set(results.map(entry => targetIdentity(entry.target)));
    for (const prior of previous?.targets || []) {
      if (currentTargets.has(targetIdentity(prior.target))) continue;
      if (!legacyTargets.has(targetIdentity(prior.target)) || !prior.created || !recordedLink(prior.target, prior.source)) {
        retained.push(prior);
        continue;
      }
      fs.mkdirSync(backupRoot, { recursive: true });
      const staged = path.join(fs.mkdtempSync(path.join(backupRoot, 'retired-')), 'link');
      fs.renameSync(prior.target, staged);
      const retirement = { ...prior, staged, restored: false };
      retired.push(retirement);
      if (prior.backup && targetEntry(prior.backup)) {
        fs.renameSync(prior.backup, prior.target);
        retirement.restored = true;
      }
    }
    const state = {
      ...previous,
      canvasBuild,
      version: STATE_VERSION,
      repository: root,
      installed_at: new Date().toISOString(),
      targets: [...results.map(({ target, source, created, backup }) => ({ target, source, created, backup })), ...retained],
    };
    atomicJson(stateFile, state);
    committed = true;
    for (const entry of retired) {
      fs.unlinkSync(entry.staged);
      fs.rmdirSync(path.dirname(entry.staged));
    }
    return { stateFile, prerequisites, dependencies: { ...dependencies, installedPlatformPackage }, results, retired: retired.map(entry => entry.target) };
  } catch (error) {
    if (committed) throw new Error(`Copilot installation was saved, but retired-link cleanup failed: ${error.message}`, { cause: error });
    try {
      for (const entry of retired.reverse()) {
        if (entry.restored) fs.renameSync(entry.target, entry.backup);
        fs.renameSync(entry.staged, entry.target);
        fs.rmdirSync(path.dirname(entry.staged));
      }
      rollbackApplied(applied);
    }
    catch (rollbackError) { error.message += `; rollback also failed: ${rollbackError.message}`; }
    throw error;
  }
}

export function rollbackCopilotInstall({
  home = os.homedir(),
  lanesHome,
  clipsHome = lanesHome || getSystemClipsDir({ home }),
} = {}) {
  const stateFile = path.join(clipsHome, 'copilot-workspaces-install.json');
  const state = readState(stateFile);
  if (!state) return { rolledBack: false, reason: 'No Copilot installation receipt exists.' };

  for (const entry of [...state.targets].reverse()) {
    if (!entry.created) continue;
    if (!targetEntry(entry.target)) continue;
    if (!fs.lstatSync(entry.target).isSymbolicLink() || !pointsTo(entry.target, entry.source)) {
      throw new Error(`Copilot rollback stopped: ${entry.target} no longer points to the installed source ${entry.source}`);
    }
  }
  rollbackApplied(state.targets.map(entry => ({ ...entry, changed: true })));
  fs.unlinkSync(stateFile);
  return { rolledBack: true, restored: state.targets.filter(entry => entry.created).map(entry => entry.target) };
}
