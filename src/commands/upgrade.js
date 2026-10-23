import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const PACKAGE_NAME = '@dfosco/lanes';
const PACKAGE_SPEC = `${PACKAGE_NAME}@latest`;

function runNpm(args, { spawn = spawnSync, env = process.env, stdio = ['ignore', 'pipe', 'pipe'] } = {}) {
  const result = spawn('npm', args, { encoding: 'utf8', env, stdio });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      throw new Error('npm was not found on PATH. Install Node.js/npm, then retry.');
    }
    throw new Error(`Could not run npm ${args[0]}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim();
    const reason = result.signal ? `terminated by ${result.signal}` : `exited with status ${result.status ?? 'unknown'}`;
    throw new Error(`npm ${args[0]} ${reason}${detail ? `: ${detail}` : ''}`);
  }
  return result.stdout?.trim() || '';
}

function globalNodeModules(options) {
  const root = runNpm(['root', '--global'], options);
  if (!root || root.includes('\n')) throw new Error('npm root --global did not return one global node_modules path.');
  return path.resolve(root);
}

function installedPackage(root) {
  const packagePath = path.join(root, '@dfosco', 'lanes');
  try {
    const stat = fs.lstatSync(packagePath);
    if (stat.isSymbolicLink()) {
      throw new Error(`The global ${PACKAGE_NAME} installation is a development link at ${packagePath}. To replace it intentionally, run: npm install --global ${PACKAGE_SPEC}`);
    }
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error(`Could not verify the global ${PACKAGE_NAME} manifest at ${packagePath}: ${error.message}`);
    }
    if (manifest.name !== PACKAGE_NAME || typeof manifest.version !== 'string' || !manifest.version) {
      throw new Error(`The global package at ${packagePath} is not a valid ${PACKAGE_NAME} installation.`);
    }
    return { packagePath, version: manifest.version };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function parseArgs(args) {
  if (args.length === 0) return { help: false };
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  throw new Error(`Usage: lanes upgrade [--help]\nUnknown upgrade argument: ${args.join(' ')}`);
}

export function runUpgradeCommand(args = [], dependencies = {}) {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(`Usage: lanes upgrade [--help]\n\nUpdate the global ${PACKAGE_NAME} installation to the latest stable npm release.\nA development-linked global checkout is left untouched.`);
    return;
  }

  const options = { spawn: dependencies.spawn || spawnSync, env: dependencies.env || process.env };
  const beforeRoot = globalNodeModules(options);
  const before = installedPackage(beforeRoot);

  console.log(`Updating global ${PACKAGE_NAME} to the latest stable npm release...`);
  runNpm(['install', '--global', PACKAGE_SPEC], {
    ...options,
    stdio: dependencies.installStdio || 'inherit',
  });

  const afterRoot = globalNodeModules(options);
  const after = installedPackage(afterRoot);
  if (!after) {
    throw new Error(`npm install completed, but ${PACKAGE_NAME} was not found under the global npm root ${afterRoot}.`);
  }
  if (before && beforeRoot === afterRoot && before.version === after.version) {
    console.log(`${PACKAGE_NAME} is already at v${after.version}.`);
    return;
  }
  console.log(`Updated ${PACKAGE_NAME} to v${after.version} (${after.packagePath}).`);
}
