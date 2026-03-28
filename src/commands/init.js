// Init command - initialize clips in a repository
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { getClipsDbDir, appendEvent, goalExists } from '../lib/core.js';
import { initConfig, readConfig, writeConfig } from '../lib/config.js';
import { pullAllIssues } from '../lib/sync.js';

/**
 * Add .dots to .git/info/exclude so it's ignored locally (not via .gitignore)
 */
function setupGitExclude(cwd) {
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
      if (lines.some(line => line.trim() === '.dots' || line.trim() === '.dots/')) {
        return false;
      }
    }

    const entry = content.endsWith('\n') || content === '' ? '.dots\n' : '\n.dots\n';
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
    const config = readConfig();
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

/**
 * Install or update the clips SKILL.md into the target repo's agent directory.
 * Returns { installed: bool, updated: bool, path: string }
 */
function installSkill(cwd) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const sourceSkill = path.resolve(__dirname, '..', '..', '.agents', 'skills', 'clips', 'SKILL.md');

  if (!fs.existsSync(sourceSkill)) {
    return { installed: false, updated: false, error: 'bundled SKILL.md not found' };
  }

  const agentDir = resolveAgentDir(cwd);
  const targetDir = path.join(agentDir, 'skills', 'clips');
  const targetPath = path.join(targetDir, 'SKILL.md');

  const sourceContent = fs.readFileSync(sourceSkill, 'utf8');

  // Check if already up to date
  if (fs.existsSync(targetPath)) {
    const existingContent = fs.readFileSync(targetPath, 'utf8');
    if (existingContent === sourceContent) {
      return { installed: false, updated: false, path: targetPath };
    }
    // Update existing
    fs.writeFileSync(targetPath, sourceContent);
    return { installed: false, updated: true, path: targetPath };
  }

  // Fresh install
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(targetPath, sourceContent);

  // Persist the detected agent_dir in config so future runs are consistent
  try {
    const config = readConfig();
    if (!config.agent_dir) {
      const relDir = path.relative(cwd, agentDir);
      config.agent_dir = relDir.startsWith('.') ? relDir : '.' + relDir;
      writeConfig(config);
    }
  } catch (e) {
    // Config write is best-effort during init
  }

  return { installed: true, updated: false, path: targetPath };
}

export function runInitCommand(args) {
  const cwd = process.cwd();
  const clipsDir = path.join(cwd, '.clips');
  const clipsDbDir = path.join(cwd, '.clips', 'db');

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

  // Set up .git/info/exclude with .dots
  if (setupGitExclude(cwd)) {
    console.log('✓ Added .dots to .git/info/exclude');
  } else {
    console.log('• .dots already in .git/info/exclude');
  }

  // Set up .vscode/settings.json to show .git folder
  if (setupVSCodeSettings(cwd)) {
    console.log('✓ Configured .vscode/settings.json (show .git folder)');
  } else {
    console.log('• .vscode/settings.json already configured');
  }

  // Create default config (only if not exists)
  const configPath = path.join(clipsDir, 'clips.config.json');
  let username = null;

  if (!fs.existsSync(configPath)) {
    // Try to auto-detect default branch from GitHub
    let defaultBranch = 'main';
    try {
      const ghOutput = execSync('gh repo view --json defaultBranchRef -q .defaultBranchRef.name', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      if (ghOutput) {
        defaultBranch = ghOutput;
      }
    } catch (e) {
      // gh CLI not available or not in a repo, use default
    }

    // Try to get GitHub username
    try {
      const ghUser = execSync('gh api user -q .login', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim();
      if (ghUser) {
        username = ghUser;
      }
    } catch (e) {
      // gh CLI not available, try git config
      try {
        const gitUser = execSync('git config user.name', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        }).trim().toLowerCase().replace(/\s+/g, '');
        if (gitUser) {
          username = gitUser;
        }
      } catch (e2) {
        // No git user either, leave as null
      }
    }

    initConfig({ default_branch: defaultBranch, username });
    console.log(`✓ Created .clips/clips.config.json (default_branch: ${defaultBranch}, username: ${username || 'not set'})`);
  } else {
    console.log('• .clips/clips.config.json already exists');
  }

  // Install or update skill file
  const skillResult = installSkill(cwd);
  if (skillResult.error) {
    console.log(`• Could not install skill (${skillResult.error})`);
  } else if (skillResult.installed) {
    console.log(`✓ Installed clips skill → ${path.relative(cwd, skillResult.path)}`);
  } else if (skillResult.updated) {
    console.log(`✓ Updated clips skill → ${path.relative(cwd, skillResult.path)}`);
  } else {
    console.log(`• Clips skill already up to date`);
  }

  // Import existing GitHub Issues
  if (!alreadyInitialized) {
    try {
      console.log('\n📥 Importing existing GitHub Issues...');
      const result = pullAllIssues();
      if (result && result.imported > 0) {
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

  // Create notepad goal for one-off tasks
  if (!goalExists('notepad')) {
    appendEvent('notepad', {
      event: 'goal_created',
      goal_id: 'notepad',
      timestamp: new Date().toISOString(),
      title: 'Notepad',
      description: 'One-off tasks and quick notes',
      acceptance_criteria: [],
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
  clips sync              # Sync goals with GitHub Issues
  clips github_sync #g001
`);
  }

}
