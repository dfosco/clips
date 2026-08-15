// CLI command: clips sync
import { syncAll, syncGoal } from '../lib/sync.js';
import { parseRef, readGoalWithTasks } from '../lib/core.js';

const USAGE = `Usage: clips sync [ref]

  clips sync          Pull GitHub Issues/PRs; push only when collaboration is enabled
  clips sync #g001    Pull all GitHub data; push only this goal when enabled

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
    const { imported, updated } = result.pulled;
    console.log(`⬇️  Pulled: ${imported} imported, ${updated} updated`);
    console.log(`🔀 PRs: ${result.pulled.prs_imported} imported, ${result.pulled.prs_updated} updated, ${result.pulled.prs_unchanged} unchanged, ${result.pulled.prs_unmatched} unmatched`);
    for (const warning of result.pulled.warnings || []) console.log(`⚠️  ${warning.source}: ${warning.message}`);
    console.log(`⬆️  Pushed: ${result.pushed} goals${result.pushed === 0 ? ' (pull-only local mode)' : ''}`);
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

  for (const warning of result.pulls?.warnings || []) console.log(`⚠️  ${warning.source}: ${warning.message}`);
  if (result.pulls) {
    console.log(`⬇️  Issues: ${result.pulls.issues.imported} imported, ${result.pulls.issues.updated} updated`);
    const prs = result.pulls.pull_requests;
    console.log(`🔀 PRs: ${prs.imported.length} imported, ${prs.updated.length} updated, ${prs.unchanged.length} unchanged, ${prs.unmatched.length} unmatched`);
  }

  const goal = readGoalWithTasks(goalId);
  const issueNum = goal?.issue_number;
  if (issueNum) {
    console.log(`✅ Synced #${goalId} → Issue #${issueNum}`);
  } else {
    console.log(`✅ Synced #${goalId}`);
  }
}
