// Init command - initialize clips in a repository
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { getClipsDbDir, appendEvent, goalExists, getRepoRoot } from '../lib/core.js';
import { initConfig, readConfig, writeConfig } from '../lib/config.js';
import { pullAllIssues } from '../lib/sync.js';
import { ensureProjectIdentity, registerProject } from '../lib/registry.js';
import { importSkill, loadSkillLibrary } from 'skillshop/import';
import { installUserSkill } from 'skillshop/user-install';

const CLIPS_LIBRARY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Add .clips to .git/info/exclude so local planning state is ignored locally
 * without changing the repository's shared .gitignore.
 */
export function setupGitExclude(cwd) {
  try {
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
      const lines = content.split('\n');
      if (lines.some(line => line.trim() === '.clips' || line.trim() === '.clips/')) {
        return false;
      }
    }

    const entry = content.endsWith('\n') || content === '' ? '.clips\n' : '\n.clips\n';
    fs.appendFileSync(excludePath, entry);
    return true;
  } catch (e) {
    return false;
  }
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
    const skillPath = path.join(cwd, dir, 'skills', 'clips', 'SKILL.md');
    if (fs.existsSync(skillPath)) {
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
      throw new Error('Usage: clips init [--global | --skills-scope project|user]');
    }
    return args[1];
  }
  if (!input.isTTY || !output.isTTY) {
    throw new Error('No terminal to choose a skill destination. Pass --skills-scope project or --skills-scope user.');
  }
  const prompt = createInterface({ input, output });
  try {
    while (true) {
      const answer = (await prompt.question('Install Clips skills in this project or your user account (replaces existing copies)? [project/user] ')).trim().toLowerCase();
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
  const specifiers = Object.keys(library.skills).filter((name) => name.startsWith('skill:'));
  const agentDir = scope === 'project' ? resolveAgentDir(cwd) : null;
  const results = [];
  for (const specifier of specifiers) {
    const name = specifier.slice('skill:'.length);
    const result = scope === 'user'
      ? await installUserSkill({ library: CLIPS_LIBRARY_ROOT, specifier, cwd })
      : await importSkill({
        library: CLIPS_LIBRARY_ROOT,
        specifier,
        targetDir: path.join(agentDir, 'skills', name),
        cwd,
        merge: true,
      });
    results.push(result);
  }

  if (scope === 'project') {
    const config = readConfig(cwd);
    if (!config.agent_dir) {
      config.agent_dir = path.relative(cwd, agentDir);
      writeConfig(config, cwd);
    }
  }
  return results;
}

export async function runInitCommand(args) {
  const skillScope = await chooseSkillScope(args);
  if (!skillScope) {
    console.log('Usage: clips init [--global | --skills-scope project|user]');
    return;
  }
  const cwd = getRepoRoot(process.cwd());
  const clipsDir = path.join(cwd, '.clips');
  const clipsDbDir = path.join(cwd, '.clips', 'db');
  const clipsRecordDirs = ['cr', 'adr'].flatMap((type) => [
    path.join(cwd, '.clips', 'records', type),
    path.join(cwd, '.clips', 'records', type, 'archived'),
  ]);

  const alreadyInitialized = fs.existsSync(clipsDir);

  if (alreadyInitialized) {
    console.log('🔄 clips already initialized.\n');
  } else {
    console.log('🎯 Initializing clips...\n');
  }

  // Create .clips directory structure
  if (!fs.existsSync(clipsDir)) {
    fs.mkdirSync(clipsDir, { recursive: true });
    console.log('✓ Created .clips/ directory');
  } else {
    console.log('• .clips/ directory already exists');
  }

  // Create .clips/db directory
  if (!fs.existsSync(clipsDbDir)) {
    fs.mkdirSync(clipsDbDir, { recursive: true });
    console.log('✓ Created .clips/db/ directory');
  } else {
    console.log('• .clips/db/ directory already exists');
  }

  // Create local record directories
  for (const recordDir of clipsRecordDirs) {
    if (!fs.existsSync(recordDir)) fs.mkdirSync(recordDir, { recursive: true });
  }
  console.log('✓ Ensured .clips/records/{cr,adr}/archived/ directories');

  // Set up .git/info/exclude with .clips
  if (setupGitExclude(cwd)) {
    console.log('✓ Added .clips to .git/info/exclude');
  } else {
    console.log('• .clips already in .git/info/exclude');
  }

  // Set up .vscode/settings.json to show .git folder
  if (setupVSCodeSettings(cwd)) {
    console.log('✓ Configured .vscode/settings.json (show .git folder)');
  } else {
    console.log('• .vscode/settings.json already configured');
  }

  // Create local-only default config (only if not exists)
  const configPath = path.join(clipsDir, 'clips.config.json');
  let config;

  if (!fs.existsSync(configPath)) {
    config = initConfig({}, cwd);
    console.log('✓ Created .clips/clips.config.json (collaboration: disabled)');
  } else {
    config = readConfig(cwd);
    console.log('• .clips/clips.config.json already exists');
  }

  const projectId = ensureProjectIdentity(cwd);
  const registeredProject = registerProject(cwd);
  console.log(`✓ Registered project ${projectId} in ${registeredProject.path}`);

  for (const result of await installSkills(cwd, skillScope)) {
    const action = result.installed ? 'Installed' : result.updated ? 'Updated' : 'Already current';
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
✅ clips initialized!

Usage:
  clips view              # List all goals
  clips view #g001        # View a goal
  clips goal create '{"title":"My Goal","description":"..."}'
  clips task create-batch g001 '[{"title":"Task 1"}]'
  clips config collaboration true  # Explicitly enable GitHub sync
  clips sync              # Sync only after collaboration is enabled
`);
  }

}
