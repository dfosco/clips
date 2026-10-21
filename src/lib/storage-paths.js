import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const STORE_NAMES = ['.lanes', '.clips'];
export const CONFIG_NAMES = ['lanes.config.json', 'clips.config.json'];

function exists(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function assertNoMigration(directory) {
  const lock = path.join(path.dirname(directory), '.lanes-migration.lock');
  if (exists(lock)) throw new Error(`Lanes migration is in progress: ${lock}. Retry after it finishes.`);
}

function selectDirectory(parent) {
  const candidates = STORE_NAMES.map(name => path.join(parent, name));
  for (const directory of candidates) {
    assertNoMigration(directory);
    if (exists(directory) && !fs.statSync(directory).isDirectory()) {
      throw new Error(`Not a state directory: ${directory}`);
    }
  }
  const populated = candidates.filter(directory => exists(directory) && fs.readdirSync(directory).length)
    .filter((directory, index, directories) => directories.findIndex(other => fs.realpathSync(other) === fs.realpathSync(directory)) === index);
  if (populated.length > 1) {
    throw new Error(`Both Lanes and Clips stores contain state in ${parent}. Run lanes init to merge them safely.`);
  }
  return populated[0] || candidates[0];
}

export function getProjectStoreDir(repoRoot) {
  return selectDirectory(repoRoot);
}

export function getUserStoreDir({ home = os.homedir(), env = process.env } = {}) {
  const override = env.LANES_HOME || env.CLIPS_HOME;
  if (!override) return selectDirectory(home);
  const directory = path.resolve(override);
  assertNoMigration(directory);
  if (exists(directory) && !fs.statSync(directory).isDirectory()) throw new Error(`Not a state directory: ${directory}`);
  return directory;
}

export function configPathIn(directory) {
  const files = CONFIG_NAMES.map(name => path.join(directory, name));
  const present = files.filter(file => exists(file));
  for (const file of present) if (!fs.statSync(file).isFile()) throw new Error(`Not a config file: ${file}`);
  if (present.length === 2) {
    if (fs.realpathSync(present[0]) !== fs.realpathSync(present[1])) {
      throw new Error(`Both config filenames exist in ${directory}. Run lanes init to merge them safely before writing.`);
    }
  }
  const selected = present[0];
  return selected && fs.lstatSync(selected).isSymbolicLink() ? fs.realpathSync(selected) : selected || files[0];
}

export function projectConfigPath(repoRoot) {
  return configPathIn(getProjectStoreDir(repoRoot));
}

export function readJsonObject(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Expected a JSON object: ${file}`);
  }
  return value;
}
