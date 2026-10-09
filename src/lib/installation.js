import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getSystemClipsDir } from './registry.js';

const PACKAGE_NAME = '@dfosco/clips';
const CHECKOUT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function statePath() {
  return path.join(getSystemClipsDir(), 'installation.json');
}

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); }
  catch { return {}; }
}

function writeState(state) {
  const file = statePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, env: options.env || process.env, encoding: 'utf8', stdio: options.stdio || ['inherit', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message || result.stderr?.trim() || `${command} ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout?.trim() || '';
}

function packageAt(root) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (manifest.name !== PACKAGE_NAME || !fs.existsSync(path.join(root, 'src', 'cli.js'))) return null;
    return { root: fs.realpathSync(root), version: manifest.version };
  } catch { return null; }
}

function skillFiles(packageRoot) {
  const skillsRoot = path.join(packageRoot, '.agents', 'skills');
  if (!fs.existsSync(skillsRoot)) return {};
  const files = {};
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        const relative = path.relative(skillsRoot, file);
        files[relative] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      }
    }
  };
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === 'clips' || entry.name.startsWith('clips-'))) walk(path.join(skillsRoot, entry.name));
  }
  return files;
}

function reconcileSkills(project, previous = {}, selected = {}, agentDir = '.agents') {
  const root = path.resolve(project, agentDir, 'skills');
  if (!root.startsWith(`${project}${path.sep}`)) throw new Error(`Agent directory is outside project: ${agentDir}`);
  for (const [relative, digest] of Object.entries(previous)) {
    if (Object.hasOwn(selected, relative)) continue;
    const file = path.join(root, relative);
    if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.lstatSync(file).isFile()) continue;
    const actual = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== digest) {
      console.error(`Retained modified skill file: ${file}`);
      continue;
    }
    fs.rmSync(file);
    let directory = path.dirname(file);
    while (directory !== root && fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
      directory = path.dirname(directory);
    }
  }
}

function globalPackagePath() {
  return path.join(run('npm', ['root', '-g']), '@dfosco', 'clips');
}

function saveInstalledPackage(globalPath, state) {
  if (!fs.existsSync(globalPath) || fs.lstatSync(globalPath).isSymbolicLink()) return state;
  const installed = packageAt(globalPath);
  if (!installed) throw new Error(`Global ${PACKAGE_NAME} installation is incomplete: ${globalPath}`);
  const destination = path.join(getSystemClipsDir(), 'installations', 'prod', installed.version);
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.cpSync(installed.root, temporary, { recursive: true, dereference: true });
    fs.renameSync(temporary, destination);
  }
  return { ...state, prod_package: destination, prod_version: installed.version };
}

function devCheckout(args, state) {
  const requested = args.checkout || process.env.CLIPS_DEV_PATH || state.dev_checkout || CHECKOUT_ROOT;
  const root = fs.realpathSync(path.resolve(requested));
  const manifest = packageAt(root);
  if (!manifest || !fs.existsSync(path.join(root, '.git'))) {
    throw new Error(`Clips development checkout not found: ${root}. Pass --checkout <path>.`);
  }
  return root;
}

function parseSwitchArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--checkout' || arg === '--project') {
      if (!argv[i + 1]) throw new Error(`${arg} requires a path`);
      result[arg.slice(2)] = argv[++i];
    } else if (arg === '--help' || arg === '-h') result.help = true;
    else throw new Error(`Unknown installation option: ${arg}`);
  }
  return result;
}

export function switchInstallation(mode, argv = []) {
  const args = parseSwitchArgs(argv);
  if (args.help) {
    console.log(`Usage: clips ${mode} [--project <repo>]${mode === 'dev' ? ' [--checkout <clips-repo>]' : ''}`);
    return;
  }
  const project = fs.realpathSync(path.resolve(args.project || process.cwd()));
  const globalPath = globalPackagePath();
  let state = saveInstalledPackage(globalPath, readState());
  const checkout = devCheckout(args, state);
  const devCli = path.join(checkout, 'src', 'cli.js');
  const prod = state.prod_package && packageAt(state.prod_package);
  if (!prod) throw new Error('No locally installed npm package was found. Install @dfosco/clips once before switching modes.');
  if (!fs.existsSync(globalPath) || fs.realpathSync(globalPath) !== checkout) {
    run('npm', ['link'], { cwd: checkout });
    if (!fs.existsSync(globalPath) || fs.realpathSync(globalPath) !== checkout) {
      throw new Error(`npm link did not point ${globalPath} at ${checkout}`);
    }
  }
  const activeCli = mode === 'dev' ? devCli : path.join(prod.root, 'src', 'cli.js');
  run(process.execPath, [activeCli, 'init'], { cwd: project, stdio: 'inherit', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } });
  const selectedRoot = mode === 'dev' ? checkout : prod.root;
  const selectedFiles = skillFiles(selectedRoot);
  const agentDir = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(project, '.clips', 'clips.config.json'), 'utf8')).agent_dir || '.agents'; }
    catch { return '.agents'; }
  })();
  reconcileSkills(project, state.projects?.[project]?.files, selectedFiles, agentDir);
  state = { ...state, mode, dev_checkout: checkout, projects: { ...state.projects, [project]: { files: selectedFiles } } };
  writeState(state);
  console.log(`Clips ${mode}: ${mode === 'dev' ? checkout : `${prod.root} (${prod.version})`}`);
}

export function dispatchProd(argv) {
  if (process.env.CLIPS_SWITCH_INIT === '1') return null;
  const state = readState();
  if (state.mode !== 'prod') return null;
  try {
    if (!state.dev_checkout || fs.realpathSync(state.dev_checkout) !== fs.realpathSync(CHECKOUT_ROOT)) return null;
  } catch { return null; }
  const prod = state.prod_package && packageAt(state.prod_package);
  if (!prod) throw new Error('Saved npm installation is missing. Run clips dev to repair the installation.');
  const result = spawnSync(process.execPath, [path.join(prod.root, 'src', 'cli.js'), ...argv], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
