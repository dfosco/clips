#!/usr/bin/env node

// CLI entry point for clips — JSONL git-based issue tracker

import { runGoalCommand } from './commands/goal.js';
import { runTaskCommand } from './commands/task.js';
import { runViewCommand } from './commands/view.js';
import { runConfigCommand } from './commands/config.js';
import { runInitCommand } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';
import { version } from './version.js';
import { ensureSoloMode } from './lib/config.js';

const [,, command, ...args] = process.argv;

// Ensure solo mode is configured (adds .clips to .gitignore if collaboration is false)
try {
  ensureSoloMode();
} catch (e) {
  // Silently fail - config might not exist yet (e.g., before init)
}

// Handle --version flag
if (command === '--version' || command === '-v') {
  console.log(`clips v${version}`);
  process.exit(0);
}

// Handle --help flag
if (command === '--help' || command === '-h' || !command) {
  console.log(`clips v${version} — JSONL git-based issue tracker

Usage: clips <command> [args]

Commands:
  init                    Initialize clips (imports existing GitHub Issues)
  view [ref]              View goal/task (or list all)
  goal <action> [args]    Manage goals
  task <action> [args]    Manage tasks
  sync [ref]              Sync with GitHub Issues (bidirectional)
  config [key] [value]    View/set configuration

Options:
  --version, -v           Show version
  --help, -h              Show this help

Examples:
  clips init
  clips view
  clips goal create '{"title":"My Goal","description":"..."}'
  clips task create-batch g001 '[{"title":"Task 1"},{"title":"Task 2"}]'
  clips view #g001
  clips task status g1 t1 done
  clips sync
`);
  process.exit(0);
}

// Route to command handlers
const commands = {
  goal: runGoalCommand,
  task: runTaskCommand,
  view: runViewCommand,
  config: runConfigCommand,
  init: runInitCommand,
  sync: runSyncCommand,
};

const handler = commands[command];

if (!handler) {
  console.error(`Unknown command: ${command}`);
  console.error(`Run 'clips --help' for usage.`);
  process.exit(1);
}

handler(args);
