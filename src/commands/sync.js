// CLI command: clips sync
import { syncAll, syncGoal } from '../lib/sync.js';
import { parseRef, readGoalWithTasks } from '../lib/core.js';

const USAGE = `Usage: clips sync [ref]

  clips sync          Sync all goals ↔ GitHub Issues
  clips sync #g001    Sync a single goal

Examples:
  clips sync
  clips sync g001
  clips sync #g12`;

export function runSyncCommand(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const ref = args[0];

  if (!ref) {
    console.log('🔄 Syncing all issues...');
    const result = syncAll();
    if (result.skipped) {
      console.log('⏸️  GitHub sync disabled; local data unchanged remotely');
      return;
    }
    const { imported, updated } = result.pulled;
    console.log(`⬇️  Pulled: ${imported} imported, ${updated} updated`);
    console.log(`⬆️  Pushed: ${result.pushed} goals`);
    console.log('✅ Sync complete!');
    return;
  }

  const parsed = parseRef(ref);
  if (!parsed || !parsed.goalId) {
    console.error(`❌ Invalid ref: ${ref}`);
    console.error('   Use a goal ref like #g001 or g12');
    process.exit(1);
  }

  const goalId = parsed.goalId;
  console.log(`🔄 Syncing #${goalId}...`);
  const result = syncGoal(goalId);
  if (result?.skipped) {
    console.log('⏸️  GitHub sync disabled; local data unchanged remotely');
    return;
  }

  const goal = readGoalWithTasks(goalId);
  const issueNum = goal?.issue_number;
  if (issueNum) {
    console.log(`✅ Synced #${goalId} → Issue #${issueNum}`);
  } else {
    console.log(`✅ Synced #${goalId}`);
  }
}
