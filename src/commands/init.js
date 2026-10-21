// Init command - initialize clips in a repository
import fs from 'fs';
import path from 'path';
import os from 'node:os';
import { execFileSync, execSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getClipsDir, appendEvent, goalExists, getRepoRoot } from '../lib/core.js';
import { getConfigPath, initConfig, readConfig, writeConfig } from '../lib/config.js';
import { pullAllIssues } from '../lib/sync.js';
import { ensureProjectIdentity, getRegistryPath, registerProject } from '../lib/registry.js';
import { loadSkillLibrary } from 'skillshop/import';
import { isLiveSkill } from '../lib/lane-manager-install.js';
import { migrateStorage } from '../lib/storage-migration.js';
import { retireLegacySkillCopies, refreshManagedSkill, recordSkillInstallations } from '../lib/installation.js';

const CLIPS_LIBRARY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Add .clips to .git/info/exclude so local planning state is ignored locally
 * without changing the repository's shared .gitignore.
 */
export function setupGitExclude(cwd) {
    const gitDir = execSync('git rev-parse --git-common-dir', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd
    }).trim();
    const absGitDir = path.resolve(cwd, gitDir);
    const infoDir = path.join(absGitDir, 'info');
    const excludePath = path.join(infoDir, 'exclude');

    if (!fs.existsSync(infoDir)) {
      fs.mkdirSync(infoDir, { recursive: true });
    }

    let content = '';
    if (fs.existsSync(excludePath)) {
      content = fs.readFileSync(excludePath, 'utf8');
    }
    const lines = content.split('\n').map(line => line.trim().replace(/\/$/, ''));
    const missing = ['.lanes', '.clips'].filter(name => !lines.includes(name));
    if (!missing.length) return false;
    const entry = `${content.endsWith('\n') || content === '' ? '' : '\n'}${missing.join('\n')}\n`;
    fs.appendFileSync(excludePath, entry);
    return true;
}

/**
 * Create/update .vscode/settings.json to make .git folder visible in VS Code
 */
function setupVSCodeSettings(cwd) {
  try {
    const vscodeDir = path.join(cwd, '.vscode');
    const settingsPath = path.join(vscodeDir, 'settings.json');

    if (!fs.existsSync(vscodeDir)) {
      fs.mkdirSync(vscodeDir, { recursive: true });
    }

    let settings = {};
    if (fs.existsSync(settingsPath)) {
      const content = fs.readFileSync(settingsPath, 'utf8');
      try {
        settings = JSON.parse(content);
      } catch (e) {
        return false; // Don't overwrite unparseable settings
      }
    }

    if (settings['files.exclude'] && settings['files.exclude']['**/.git'] === false) {
      return false;
    }

    settings['files.exclude'] = settings['files.exclude'] || {};
    settings['files.exclude']['**/.git'] = false;

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Resolve the agent directory in the target repo.
 * Priority: config agent_dir → existing skill file location → .agents → .claude → .github
 */
function resolveAgentDir(cwd) {
  // 1. Check config
  try {
    const config = readConfig(cwd);
    if (config.agent_dir) {
      return path.join(cwd, config.agent_dir);
    }
  } catch (e) {
    // Config may not exist yet during init
  }

  // 2. Check if skill file already exists somewhere
  const candidates = ['.agents', '.claude', '.github'];
  for (const dir of candidates) {
    if (['lanes', 'clips'].some(name => fs.existsSync(path.join(cwd, dir, 'skills', name, 'SKILL.md')))) {
      return path.join(cwd, dir);
    }
  }

  // 3. Check if any of these directories already exist (prefer existing)
  for (const dir of candidates) {
    if (fs.existsSync(path.join(cwd, dir))) {
      return path.join(cwd, dir);
    }
  }

  // 4. Default to .agents
  return path.join(cwd, '.agents');
}

export async function chooseSkillScope(args, { input = process.stdin, output = process.stdout } = {}) {
  if (args.includes('--help') || args.includes('-h')) return null;
  if (args.length) {
    if (args.length === 1 && args[0] === '--global') return 'user';
    if (args.length !== 2 || args[0] !== '--skills-scope' || !['project', 'user'].includes(args[1])) {
      throw new Error('Usage: lanes init [--global | --skills-scope project|user]');
    }
    return args[1];
  }
  if (!input.isTTY || !output.isTTY) {
    throw new Error('No terminal to choose a skill destination. Pass --skills-scope project or --skills-scope user.');
  }
  const prompt = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await prompt.question('Install Lanes skills in this project or your user account (preserves local edits)? [project/user] ')).trim().toLowerCase();
      if (answer === 'project' || answer === 'p') return 'project';
      if (answer === 'user' || answer === 'u') return 'user';
      output.write('Enter project or user.\n');
    }
  } finally {
    prompt.close();
  }
}

async function installSkills(cwd, scope) {
  const library = await loadSkillLibrary(CLIPS_LIBRARY_ROOT, { cwd });
  const canonical = ['skill:lanes', 'skill:lane-manager', 'skill:lane-dev', 'skill:lane-radar', 'skill:lane-plugin'];
  const specifiers = [...new Set([...canonical.filter(name => library.skills[name]), ...Object.keys(library.skills).filter(name => name.startsWith('skill:'))])];
  const agentDir = scope === 'project' ? resolveAgentDir(cwd) : null;
  const results = [];
  const sources = new Set();
  const receipts = {};
  for (const specifier of specifiers) {
    const source = fs.realpathSync(fileURLToPath(library.skills[specifier]));
    if (sources.has(source)) continue;
    sources.add(source);
    const name = specifier.slice('skill:'.length);
    const targetDir = scope === 'user'
      ? path.join(os.homedir(), '.agents', 'skills', name)
      : path.join(agentDir, 'skills', name);
    if (isLiveSkill(targetDir)) {
      results.push({ specifier, targetDir, live: true });
      continue;
    }
    const result = refreshManagedSkill(source, targetDir, { project: cwd, agentDir: scope === 'project' ? path.relative(cwd, agentDir) : null });
    receipts[targetDir] = { files: result.files };
    results.push({ ...result, specifier });
  }
  recordSkillInstallations(receipts);

  if (scope === 'project') {
    retireLegacySkillCopies(cwd, path.relative(cwd, agentDir));
    const config = readConfig(cwd);
    if (!config.agent_dir) {
      config.agent_dir = path.relative(cwd, agentDir);
      writeConfig(config, cwd);
    }
  }
  return results;
}

export function initializeStore(directory) {
  const cwd = getRepoRoot(directory);
  const { projectDir: clipsDir, migrated } = migrateStorage(cwd);
  fs.mkdirSync(clipsDir, { recursive: true });
  fs.mkdirSync(path.join(clipsDir, 'db'), { recursive: true });
  for (const type of ['cr', 'adr']) fs.mkdirSync(path.join(clipsDir, 'records', type, 'archived'), { recursive: true });
  initConfig({}, cwd);
  setupGitExclude(cwd);
  execFileSync('git', ['check-ignore', '--quiet', '.lanes'], { cwd, stdio: 'pipe' });
  ensureProjectIdentity(cwd);
  const project = registerProject(cwd);
  return { initialized: true, migrated, projectPath: cwd, projectId: project.id, warnings: project.warnings };
}

export async function runInitCommand(args) {
  if (args.includes('--store-only')) {
    if (args.length !== 1) throw new Error('--store-only must be used alone; it never installs skills.');
    console.log(JSON.stringify(initializeStore(process.cwd())));
    return;
  }
  const skillScope = await chooseSkillScope(args);
  if (!skillScope) {
    console.log('Usage: lanes init [--global | --skills-scope project|user | --store-only]');
    return;
  }
  const cwd = getRepoRoot(process.cwd());
  const { projectDir: clipsDir } = migrateStorage(cwd);
  const clipsDbDir = path.join(clipsDir, 'db');
  const clipsRecordDirs = ['cr', 'adr'].flatMap((type) => [
    path.join(clipsDir, 'records', type),
    path.join(clipsDir, 'records', type, 'archived'),
  ]);

  const alreadyInitialized = fs.existsSync(clipsDir);

  if (alreadyInitialized) {
    console.log('🔄 Lanes already initialized.\n');
  } else {
    console.log('🎯 Initializing Lanes...\n');
  }

  // Create .clips directory structure
  if (!fs.existsSync(clipsDir)) {
    fs.mkdirSync(clipsDir, { recursive: true });
    console.log('✓ Created .lanes/ directory');
  } else {
    console.log('• .lanes/ directory already exists');
  }

  // Create .lanes/db directory
  if (!fs.existsSync(clipsDbDir)) {
    fs.mkdirSync(clipsDbDir, { recursive: true });
    console.log('✓ Created .lanes/db/ directory');
  } else {
    console.log('• .lanes/db/ directory already exists');
  }

  // Create local record directories
  for (const recordDir of clipsRecordDirs) {
    if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true });
  }
  console.log('✓ Ensured .lanes/records/{cr,adr}/archived/ directories');

  // Set up .git/info/exclude with .clips
  if (setupGitExclude(cwd)) {
    console.log('✓ Added .lanes and .clips to .git/info/exclude');
  } else {
    console.log('• .lanes and .clips already in .git/info/exclude');
  }

  // Set up .vscode/settings.json to show .git folder
  if (setupVSCodeSettings(cwd)) {
    console.log('✓ Configured .vscode/settings.json (show .git folder)');
  } else {
    console.log('• .vscode/settings.json already configured');
  }

  // Create local-only default config (only if not exists)
  const configPath = getConfigPath(cwd);
  let config;

  if (!fs.existsSync(configPath)) {
    config = initConfig({}, cwd);
    console.log('✓ Created .lanes/lanes.config.json (collaboration: disabled)');
  } else {
    config = readConfig(cwd);
    console.log('• .lanes/lanes.config.json already exists');
  }

  const projectId = ensureProjectIdentity(cwd);
  const registeredProject = registerProject(cwd);
  console.log(`✓ Registered project ${projectId} in ${registeredProject.path}`);

  for (const result of await installSkills(cwd, skillScope)) {
    const action = result.live ? 'Preserved live source for' : result.installed ? 'Installed' : result.updated ? 'Updated' : 'Already current';
    console.log(`✓ ${action} ${result.specifier} → ${result.targetDir}`);
  }

  // Import existing GitHub Issues
  if (!alreadyInitialized) {
    if (config.collaboration !== true) {
      console.log('\n• GitHub sync disabled; skipped issue import');
    } else {
      try {
        console.log('\n📥 Importing existing GitHub Issues...');
        const result = pullAllIssues();
        if (result?.skipped) {
          console.log('• GitHub sync disabled; skipped issue import');
        } else if (result && result.imported > 0) {
          console.log(`✓ Imported ${result.imported} issues as goals`);
        } else if (result && result.total > 0) {
          console.log(`• ${result.total} issues found, all already imported`);
        } else {
          console.log('• No existing issues found');
        }
      } catch (e) {
        console.log(`• Could not import issues (${e.message || 'gh CLI may not be available'})`);
      }
    }
  }

  // Create notepad goal for one-off tasks
  if (!goalExists('notepad')) {
    appendEvent('notepad', {
      event: 'goal_created',
      goal_id: 'notepad',
      timestamp: new Date().toISOString(),
      title: 'Notepad',
      description: 'One-off tasks and quick notes',
      acceptance_criteria: [],
      type: 'building',
      status: 'open'
    });
    console.log('✓ Created notepad goal for one-off tasks');
  } else {
    console.log('• notepad goal already exists');
  }

  if (!alreadyInitialized) {
    console.log(`
✅ lanes initialized!

Usage:
  lanes view              # List all goals
  lanes view #g001        # View a goal
  lanes goal create '{"title":"My Goal","description":"..."}'
  lanes task create-batch g001 '[{"title":"Task 1"}]'
  lanes config collaboration true  # Explicitly enable GitHub sync
  lanes sync              # Sync only after collaboration is enabled
`);
  }

}
