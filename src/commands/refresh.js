// Refresh command - atomic sync of clips data to remote
// VIRTUAL REFRESH: Uses temporary worktree, never switches branches in main repo
// This is critical for parallel agent safety - multiple agents can refresh simultaneously
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getRepoRoot, getClipsDir } from '../lib/core.js';
import { isCollaborationEnabled } from '../lib/config.js';

function run(cmd, opts = {}) {
  try {
    return execSync(cmd, { 
      encoding: 'utf8', 
      stdio: opts.silent ? 'pipe' : 'inherit',
      cwd: opts.cwd || getRepoRoot(),
      ...opts 
    });
  } catch (e) {
    if (opts.silent) return null;
    throw e;
  }
}

function runOutput(cmd, opts = {}) {
  try {
    return execSync(cmd, { 
      encoding: 'utf8', 
      stdio: 'pipe',
      cwd: opts.cwd || getRepoRoot(),
      ...opts 
    }).trim();
  } catch (e) {
    return null;
  }
}

/**
 * Copy directory contents recursively, optionally excluding files
 * @param {string} src - Source directory
 * @param {string} dest - Destination directory
 * @param {string[]} excludeFiles - File names to exclude (e.g., ['clips.ledger'])
 */
function copyDirSync(src, dest, excludeFiles = []) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (excludeFiles.includes(entry.name)) continue;
    
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath, excludeFiles);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Ensure ledger branch exists (creates orphan if needed)
 * Uses a temporary worktree to avoid switching branches
 */
let ledgerBranchCreated = false;
const LEDGER_BRANCH = 'ledger';

function ensureLedgerBranch(root, verbose = false) {
  const branchExists = runOutput(`git rev-parse --verify ${LEDGER_BRANCH} 2>/dev/null`, { cwd: root });
  
  if (!branchExists) {
    if (verbose && !ledgerBranchCreated) {
      console.log('🌱 Creating ledger branch...');
    }
    
    // Empty tree hash is always 4b825dc642cb6eb9a060e54bf8d69288fbee4904
    const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
    const commitHash = runOutput(
      `git commit-tree ${emptyTree} -m "Initialize ledger branch"`,
      { cwd: root }
    );
    
    if (commitHash) {
      run(`git branch ${LEDGER_BRANCH} ${commitHash}`, { cwd: root, silent: true });
      ledgerBranchCreated = true;
      return true;
    }
  }
  
  return false;
}

/**
 * CLI entry point for refresh command
 * Supports subcommands: pull, push, or full sync (default)
 */
export function runRefreshCommand(args) {
  if (!isCollaborationEnabled()) {
    return { success: true, skipped: true, reason: 'collaboration disabled' };
  }
  
  const subcommand = args[0];
  
  if (subcommand === 'pull') {
    return doRefresh(args.slice(1), { pullOnly: true });
  } else if (subcommand === 'push') {
    return doRefresh(args.slice(1), { pushOnly: true });
  } else {
    return doRefresh(args, {});
  }
}

/**
 * Virtual refresh - sync .clips/db data to ledger branch without switching branches
 * Uses a temporary worktree for the ledger branch
 * 
 * Flow:
 * 1. Create temp worktree on ledger branch
 * 2. Pull --rebase from origin/ledger
 * 3. Copy .clips/db/ (only db, not full .clips) to worktree
 * 4. Commit changes
 * 5. Push (retry with pull --rebase on failure)
 * 6. Commit .clips/db/ on current branch
 * 7. Cleanup temp worktree
 */
function doRefresh(args, options = {}) {
  const root = getRepoRoot();
  const clipsDir = getClipsDir();
  const clipsDbDir = path.join(clipsDir, 'db');
  const message = args.includes('-m') ? args[args.indexOf('-m') + 1] : 'clips refresh';
  const pullOnly = options.pullOnly || args.includes('--pull');
  const pushOnly = options.pushOnly || args.includes('--push');
  const verbose = args.includes('-v') || args.includes('--verbose');
  const skipMerge = args.includes('--skip-merge');
  
  if (verbose) console.log('🔄 Refreshing clips data (virtual mode)...\n');
  
  ensureLedgerBranch(root, verbose);
  
  // Create temporary worktree for ledger branch
  const tempId = `${process.pid}-${Date.now()}`;
  const tempWorktree = path.join(os.tmpdir(), `clips-refresh-${tempId}`);
  
  try {
    // 1. Fetch remote ledger branch first
    if (verbose) console.log('⬇️  Fetching remote...');
    run(`git fetch origin ${LEDGER_BRANCH} 2>/dev/null || true`, { cwd: root, silent: true });
    
    // 2. Create temporary worktree for ledger branch
    if (verbose) console.log('📂 Creating temporary worktree...');
    run(`git worktree add "${tempWorktree}" ${LEDGER_BRANCH} 2>/dev/null`, { cwd: root, silent: true });
    
    // 3. Pull --rebase to get latest
    const remoteExists = runOutput(`git rev-parse --verify origin/${LEDGER_BRANCH} 2>/dev/null`, { cwd: root });
    if (remoteExists) {
      if (verbose) console.log('🔃 Pulling from remote (rebase)...');
      run(`git pull --rebase origin ${LEDGER_BRANCH} 2>/dev/null || true`, { cwd: tempWorktree, silent: true });
    }
    
    // If pull-only, copy .clips/db from ledger to local (excluding ledger file)
    if (pullOnly) {
      if (verbose) console.log('📋 Pulling .clips/db from ledger...');
      const tempClipsDbDir = path.join(tempWorktree, '.clips', 'db');
      if (fs.existsSync(tempClipsDbDir)) {
        if (!fs.existsSync(clipsDbDir)) {
          fs.mkdirSync(clipsDbDir, { recursive: true });
        }
        copyDirSync(tempClipsDbDir, clipsDbDir, ['clips.ledger']);
      }
      if (verbose) console.log('✅ Pull complete!');
      return;
    }
    
    // 4. Copy ONLY .clips/db from local to temp worktree (not full .clips)
    // Exclude clips.ledger - it stays local for parallel agent coordination only
    if (verbose) console.log('📋 Copying .clips/db data...');
    const tempClipsDbDir = path.join(tempWorktree, '.clips', 'db');
    
    const tempClipsDir = path.join(tempWorktree, '.clips');
    if (!fs.existsSync(tempClipsDir)) {
      fs.mkdirSync(tempClipsDir, { recursive: true });
    }
    
    // Clear existing db in worktree and copy fresh (excluding ledger)
    if (fs.existsSync(tempClipsDbDir)) {
      fs.rmSync(tempClipsDbDir, { recursive: true });
    }
    if (fs.existsSync(clipsDbDir)) {
      copyDirSync(clipsDbDir, tempClipsDbDir, ['clips.ledger']);
    }
    
    // 5. Check if there are changes to commit
    const clipsChanges = runOutput('git status --porcelain', { cwd: tempWorktree });
    
    if (clipsChanges) {
      if (verbose) console.log('💾 Committing changes...');
      run('git add -A', { cwd: tempWorktree, silent: true });
      run(`git commit -m "${message}"`, { cwd: tempWorktree, silent: true });
      
      // 6. Push with retry (pull --rebase on failure)
      if (verbose) console.log('⬆️  Pushing to remote...');
      let pushSuccess = false;
      for (let attempt = 0; attempt < 3 && !pushSuccess; attempt++) {
        try {
          runOutput(
            `git push origin ${LEDGER_BRANCH} 2>&1 || git push --set-upstream origin ${LEDGER_BRANCH} 2>&1`,
            { cwd: tempWorktree }
          );
          pushSuccess = true;
        } catch (e) {
          if (attempt < 2) {
            if (verbose) console.log('⚠️  Push failed, retrying with rebase...');
            run(`git pull --rebase origin ${LEDGER_BRANCH} 2>/dev/null || true`, { cwd: tempWorktree, silent: true });
          }
        }
      }
      if (verbose) console.log('✅ Ledger synced to remote!');
    } else {
      if (verbose) console.log('✅ No changes to sync');
    }
    
  } finally {
    // 7. Clean up temporary worktree
    if (verbose) console.log('🧹 Cleaning up temp worktree...');
    try {
      run(`git worktree remove "${tempWorktree}" --force 2>/dev/null || true`, { cwd: root, silent: true });
    } catch (e) {
      if (fs.existsSync(tempWorktree)) {
        fs.rmSync(tempWorktree, { recursive: true, force: true });
      }
      run('git worktree prune', { cwd: root, silent: true });
    }
  }
  
  // 8. Commit .clips/db changes on current branch
  if (!skipMerge) {
    const dbChanges = runOutput('git status --porcelain .clips/db/', { cwd: root });
    if (dbChanges) {
      if (verbose) console.log('💾 Committing .clips/db to current branch...');
      run('git add .clips/db/', { cwd: root, silent: true });
      run(`git commit -m "${message}" 2>/dev/null || true`, { cwd: root, silent: true });
    }
  }
  
  if (verbose) console.log('\n✅ clips refresh complete!');
}

/**
 * Pull-only refresh - fetch latest .clips data from remote
 */
export function refreshPull() {
  return runRefreshCommand(['pull']);
}

/**
 * Push-only refresh - push local .clips data to remote
 */
export function refreshPush(message = 'clips refresh') {
  return runRefreshCommand(['push', '-m', message]);
}
