#!/usr/bin/env node

// CLI entry point for clips — JSONL git-based issue tracker

import { runGoalCommand } from './commands/goal.js';
import { runTaskCommand } from './commands/task.js';
import { runViewCommand } from './commands/view.js';
import { runConfigCommand } from './commands/config.js';
import { runInitCommand } from './commands/init.js';
import { runSyncCommand } from './commands/sync.js';
import { runBoardCommand } from './commands/board.js';
import { runRecordCommand } from './commands/record.js';
import { runTrackCommand } from './commands/track.js';
import { runLaneCommand } from './commands/lane.js';
import { runComponentCommand } from './commands/component.js';
import { runHistoryCommand } from './commands/history.js';
import { runLabelCommand } from './commands/label.js';
import { runAttachmentCommand } from './commands/attachment.js';
import { switchInstallation, dispatchProd } from './lib/installation.js';
import { version } from './version.js';
import { getRepoRoot, getClipsDir } from './lib/core.js';
import { getConfigPath } from './lib/config.js';
import { getSystemClipsDir } from './lib/registry.js';

const [,, command, ...args] = process.argv;

if (command === 'dev' || command === 'prod') {
  try { switchInstallation(command, args); }
  catch (error) { console.error(`lanes ${command}: ${error.message}`); process.exit(1); }
  process.exit(0);
}

try {
  const delegatedStatus = dispatchProd(process.argv.slice(2));
  if (delegatedStatus !== null) process.exit(delegatedStatus);
} catch (error) {
  console.error(`lanes prod: ${error.message}`);
  process.exit(1);
}

// Handle --version flag
if (command === '--version' || command === '-v') {
  console.log(`lanes v${version}`);
  process.exit(0);
}

// Handle --help flag
if (command === '--help' || command === '-h' || !command) {
  console.log(`lanes v${version} — JSONL git-based issue tracker

Usage: lanes <command> [args]

Commands:
  init [--global | --skills-scope S | --store-only] Initialize state; optional skills
  dev [--project P]       Use the development checkout and refresh its skills
  prod [--project P]      Use the saved local npm installation and refresh its skills
  view [ref] [--json]     View a goal, task, criterion, or component
  history <ref> [--json]  Read the record's revision journal
  goal <action> [args]    Manage goals
  lane <action> [args]    Manage strategic multi-goal lanes
  track <action> [args]   Legacy Track command alias
  task <action> [args]    Manage tasks
  component <action>     Manage persistent system components
  label <action>         Manage project labels and record assignments
  attachment <action>    Attach and read live Markdown, URL, issue, and PR references
  record <action> [args]  Manage optional legacy CR and ADR records
  sync [ref]              Explicitly sync GitHub when collaboration is enabled
  config [key] [value]    View/set configuration; --help lists flags
  board --json             Output the current repository's Lanes, Goals and Tasks as JSON
  paths --json             Resolve project and user state paths without modifying them

Options:
  --version, -v           Show version
  --help, -h              Show this help

Examples:
  lanes init
  lanes init --global             # Install skills in the user account
  lanes init --skills-scope project  # Use in scripts without a terminal
  lanes dev --project /path/to/repo
  lanes prod --project /path/to/repo
  lanes lane create '{"title":"Workspace improvements","description":"Strategic product workstream"}'
  lanes lane l01 add g01 g02 g010
  lanes view
  lanes goal create '{"title":"Build import flow","plan":"...","decisions":"..."}'
  lanes component create '{"title":"Selection store","responsibility":"Persist the current selection"}'
  lanes goal create '{"title":"My Goal","behavior":"Feature: My goal","verification_mode":"behavior_and_tests"}'
  lanes goal unlink g001
  lanes goal unlink --all
  lanes task create-batch g001 '[{"title":"Task 1"},{"title":"Task 2"}]'
  lanes task accept '#g001#t01' --file receipt.json
  lanes view '#g001#t01#A1' --json
  lanes view '#c1#r1' --json
  lanes history '#g001#t01'
  lanes task status g1 t1 closed
  lanes sync
  lanes config project_id my-project
  lanes config --lane-max-active-agents 5

When GitHub collaboration is enabled, Goal, Task, Lane, and Track mutations also
push their updated records. Configuration toggles, attachment operations,
status, and preview remain local-only.
`);
  process.exit(0);
}

// Route to command handlers
const commands = {
  paths: (options) => {
    if (options.length !== 1 || options[0] !== '--json') throw new Error('Usage: lanes paths --json');
    const repoRoot = getRepoRoot();
    console.log(JSON.stringify({ repoRoot, storeDir: getClipsDir(repoRoot), configPath: getConfigPath(repoRoot), userDir: getSystemClipsDir() }));
  },
  goal: runGoalCommand,
  lane: runLaneCommand,
  track: runTrackCommand,
  component: runComponentCommand,
  history: runHistoryCommand,
  label: runLabelCommand,
  attachment: runAttachmentCommand,
  task: runTaskCommand,
  record: runRecordCommand,
  view: runViewCommand,
  config: runConfigCommand,
  init: runInitCommand,
  sync: runSyncCommand,
  board: runBoardCommand,
};

const handler = commands[command];

if (!handler) {
  console.error(`Unknown command: ${command}`);
  console.error(`Run 'lanes --help' for usage.`);
  process.exit(1);
}

try {
  await handler(args);
} catch (error) {
  console.error(`lanes ${command}: ${error.message}`);
  process.exitCode = 1;
}
