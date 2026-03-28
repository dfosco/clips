// Init command - initialize clips in a repository
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { getClipsDbDir, commitAndPush } from '../lib/core.js';
import { initConfig } from '../lib/config.js';
import { pullAllIssues } from '../lib/sync.js';

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

  // Commit .clips/ to git
  try { commitAndPush('clips: init'); } catch (e) {}
}
