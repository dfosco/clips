// CLI command: clips sync
import { pushTrack, syncAll, syncGoal } from '../lib/sync.js';
import { laneToTrackId, normalizeLaneId, readLane } from '../lib/lanes.js';
import { parseRef, readGoalWithTasks } from '../lib/core.js';

const USAGE = `Usage: clips sync [ref]

  clips sync          Pull and push GitHub data when collaboration is enabled
  clips sync #g001    Pull all GitHub data; push only this goal
  clips sync #l001    Push this strategic Lane

GitHub sync is disabled by default. Enable explicitly with:
  clips config collaboration true

Examples:
  clips sync
  clips sync g001
  clips sync #g12
  clips sync '#l1'`;

export function runSyncCommand(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const ref = args[0];

  if (!ref) {
    const result = syncAll();
    if (result.skipped) {
      console.log('• GitHub sync disabled. Enable with: clips config collaboration true');
      return;
    }
    console.log('🔄 Syncing all issues...');
    const { imported, updated } = result.pulled;
    console.log(`⬇️  Pulled: ${imported} imported, ${updated} updated`);
    console.log(`🔀 PRs: ${result.pulled.prs_imported} imported, ${result.pulled.prs_updated} updated, ${result.pulled.prs_unchanged} unchanged, ${result.pulled.prs_unmatched} unmatched`);
    for (const warning of result.pulled.warnings || []) console.log(`⚠️  ${warning.source}: ${warning.message}`);
    console.log(`⬆️  Pushed: ${result.pushed} goals`);
    console.log('✅ Sync complete!');
    return;
  }

  if (/^#?[lr]\\d+$/i.test(ref)) {
    const laneId = normalizeLaneId(ref);
    if (!readLane(laneId)) throw new Error(`Lane ${laneId} not found`);
    const result = pushTrack(laneToTrackId(laneId));
    if (result?.skipped) console.log('• GitHub sync disabled. Enable with: clips config collaboration true');
    else console.log(`✅ Synced Lane #${laneId}`);
    return;
  }

  const parsed = parseRef(ref);
  if (!parsed || !parsed.goalId) {
    console.error(`❌ Invalid ref: ${ref}`);
    console.error('   Use a goal ref like #g001 or a Lane ref like #l1');
    process.exit(1);
  }

  const goalId = parsed.goalId;
  const result = syncGoal(goalId);
  if (result.skipped) {
    console.log('• GitHub sync disabled. Enable with: clips config collaboration true');
    return;
  }
  console.log(`🔄 Syncing #${goalId}...`);

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
