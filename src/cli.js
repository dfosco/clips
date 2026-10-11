#!/usr/bin/env node

// CLI entry point for clips — JSONL git-based issue tracker

import { runGoalCommand } from './commands/goal.js';
import { runTaskCommand } from './commands/task.js';
import { runViewCommand } from './commands/view.js';
import { runConfigCommand } from './commands/config.js';
import { runInitCommand } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';
import { runWebCommand } from './commands/web.js';
import { runRecordCommand } from './commands/record.js';
import { runTrackCommand } from './commands/track.js';
import { runComponentCommand } from './commands/component.js';
import { runHistoryCommand } from './commands/history.js';
import { switchInstallation, dispatchProd } from './lib/installation.js';
import { version } from './version.js';

const [,, command, ...args] = process.argv;

if (command === 'dev' || command === 'prod') {
  try { switchInstallation(command, args); }
  catch (error) { console.error(`clips ${command}: ${error.message}`); process.exit(1); }
  process.exit(0);
}

try {
  const delegatedStatus = dispatchProd(process.argv.slice(2));
  if (delegatedStatus !== null) process.exit(delegatedStatus);
} catch (error) {
  console.error(`clips prod: ${error.message}`);
  process.exit(1);
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
  init                    Initialize local-only clips state
  dev [--project P]       Use the development checkout and refresh its skills
  prod [--project P]      Use the saved local npm installation and refresh its skills
  view [ref] [--json]     View a goal, task, criterion, or component
  history <ref> [--json]  Read the record's revision journal
  goal <action> [args]    Manage goals
  track <action> [args]   Manage tracks
  task <action> [args]    Manage tasks
  component <action>     Manage persistent system components
  record <action> [args]  Manage optional legacy CR and ADR records
  sync [ref]              Sync GitHub only when collaboration is enabled
  config [key] [value]    View/set configuration
  web [--host H] [--port P] Start the read-only local or multi-project board

Options:
  --version, -v           Show version
  --help, -h              Show this help

Examples:
  clips init
  clips dev --project /path/to/repo
  clips prod --project /path/to/repo
  clips track r01 add g01 g02 g010
  clips view
  clips goal create '{"title":"Build import flow","plan":"...","decisions":"..."}'
  clips component create '{"title":"Selection store","responsibility":"Persist the current selection"}'
  clips goal create '{"title":"My Goal","behavior":"Feature: My goal","verification_mode":"behavior_and_tests"}'
  clips goal unlink g001
  clips goal unlink --all
  clips task create-batch g001 '[{"title":"Task 1"},{"title":"Task 2"}]'
  clips task accept '#g001#t01' --file receipt.json
  clips view '#g001#t01#A1' --json
  clips view '#c1#r1' --json
  clips history '#g001#t01'
  clips task status g1 t1 closed
  clips sync
  clips web
  clips config project_id my-project
`);
  process.exit(0);
}

// Route to command handlers
const commands = {
  goal: runGoalCommand,
  track: runTrackCommand,
  component: runComponentCommand,
  history: runHistoryCommand,
  task: runTaskCommand,
  record: runRecordCommand,
  view: runViewCommand,
  config: runConfigCommand,
  init: runInitCommand,
  sync: runSyncCommand,
  web: runWebCommand,
};

const handler = commands[command];

if (!handler) {
  console.error(`Unknown command: ${command}`);
  console.error(`Run 'clips --help' for usage.`);
  process.exit(1);
}

try {
  await handler(args);
} catch (error) {
  console.error(`clips ${command}: ${error.message}`);
  process.exitCode = 1;
}
