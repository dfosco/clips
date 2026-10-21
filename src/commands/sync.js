// CLI command: lanes sync
import { pushTrack, previewSync, syncAll, syncGoal } from '../lib/sync.js';
import { readCollaborationCapability } from '../lib/collaboration.js';
import { laneToTrackId, normalizeLaneId, readLane } from '../lib/lanes.js';
import { parseRef, readGoalWithTasks } from '../lib/core.js';

const USAGE = `Usage: lanes sync [ref]
       lanes sync status [--json]
       lanes sync preview [record-ref] [--json]

  lanes sync                 Explicitly pull and push GitHub data when enabled
  lanes sync #g001           Pull GitHub data; push only this Goal
  lanes sync #l001           Push this Lane and reconcile managed child links
  lanes sync status --json   Read project collaboration state without network
  lanes sync preview --json  Preview local actions without network

Collaboration is project-local. Toggling changes only the setting:
  lanes config collaboration true|false

Enabling collaboration never publishes by itself. When enabled, Goal, Task, Lane,
and Track mutations also push their updated records. This preserves the existing
automatic mutation sync behavior; status and preview remain local-only.
Status and preview do not check authentication or remote capabilities.`;

function assertJsonArgs(args, command) {
  const unknown = args.filter((arg) => arg !== '--json');
  if (unknown.length > 1) throw new Error(`Usage: ${command} [record-ref] [--json]`);
  return unknown[0] || null;
}

function printDiagnostics(diagnostics = []) {
  for (const item of diagnostics) {
    console.warn(`⚠️  ${item.source || 'sync'}${item.ref ? ` ${item.ref}` : ''}: ${item.message}`);
  }
}

function printEffects(effects = { requested: [], completed: [], failures: [] }) {
  const failures = effects.failures || [];
  console.log(`Remote calls: ${effects.requested?.length || 0} requested, ${effects.completed?.length || 0} completed, ${failures.length} failed`);
  for (const failure of failures) console.error(`❌ ${failure.action}: ${failure.message}`);
  return failures.length === 0;
}

function printStatus(args) {
  if (args.length > 1 || args.some((arg) => arg !== '--json')) {
    throw new Error('Usage: lanes sync status [--json]');
  }
  const collaboration = readCollaborationCapability();
  if (args.includes('--json')) console.log(JSON.stringify(collaboration, null, 2));
  else {
    if (collaboration.state === 'invalid') throw new Error(collaboration.error);
    console.log(`GitHub collaboration: ${collaboration.state} (project config)`);
    console.log(`Network: ${collaboration.network_access}`);
    console.log(`Authentication: ${collaboration.authentication}`);
    console.log(`Control: ${collaboration.control.command}`);
    console.log(`Preview: ${collaboration.preview.command}`);
    console.log(`Sync: ${collaboration.sync.command}`);
  }
  if (collaboration.state === 'invalid') process.exitCode = 1;
}

function printPreview(args) {
  const ref = assertJsonArgs(args, 'lanes sync preview');
  const preview = previewSync(ref);
  if (args.includes('--json')) console.log(JSON.stringify(preview, null, 2));
  else {
    console.log(`Collaboration: ${preview.collaboration_enabled ? 'enabled' : 'disabled'}`);
    console.log('Preview only. No network calls were made; remote state, authentication, and hierarchy capability are unknown.');
    for (const action of preview.planned_writes) {
      const relation = action.relation ? ` ${action.relation}` : '';
      const parent = action.kind === 'relationship' ? ` -> ${action.parent_ref ?? '(no parent)'}` : '';
      console.log(`  ${action.kind}${relation} ${action.ref}${parent}: ${action.action}`);
    }
    for (const diagnostic of preview.diagnostics) console.log(`⚠️  ${diagnostic}`);
  }
}

function runLaneSync(ref) {
  const laneId = normalizeLaneId(ref);
  if (!readLane(laneId)) throw new Error(`Lane ${laneId} not found`);
  const effects = { requested: [], completed: [], failures: [] };
  const diagnostics = [];
  try {
    const result = pushTrack(laneToTrackId(laneId), { effects, diagnostics });
    if (result.skipped) {
      console.log('GitHub sync disabled. No network calls were made. Enable with: lanes config collaboration true');
      return;
    }
  } catch (error) {
    printDiagnostics(diagnostics);
    printEffects(effects);
    throw error;
  }
  printDiagnostics(diagnostics);
  if (printEffects(effects)) console.log(`✅ Synced Lane #${laneId}`);
  else process.exitCode = 1;
}

function runGoalSync(ref) {
  const parsed = parseRef(ref);
  if (!parsed?.goalId || parsed.revision != null || parsed.criterionId || parsed.componentId) {
    throw new Error(`Sync requires a current Goal or Task reference: ${ref}`);
  }
  const current = readGoalWithTasks(parsed.goalId, parsed.username);
  if (!current) throw new Error(`Goal ${parsed.goalId} not found`);
  if (parsed.taskId && !current.tasks?.[parsed.taskId]) {
    throw new Error(`Task ${parsed.taskId} not found in Goal ${parsed.goalId}`);
  }
  const result = syncGoal(parsed.goalId, { username: parsed.username });
  if (result.skipped) {
    console.log('GitHub sync disabled. No network calls were made. Enable with: lanes config collaboration true');
    return;
  }
  if (result.pulls) {
    console.log(`⬇️  Issues: ${result.pulls.issues.imported} imported, ${result.pulls.issues.updated} updated`);
    const prs = result.pulls.pull_requests;
    console.log(`🔀 PRs: ${prs.imported.length} imported, ${prs.updated.length} updated, ${prs.unchanged.length} unchanged, ${prs.unmatched.length} unmatched`);
  }
  printDiagnostics(result.diagnostics);
  const effectsOkay = printEffects(result.effects);
  if (!result.success || !effectsOkay) {
    process.exitCode = 1;
    console.error(`Sync incomplete for ${parsed.taskId ? `#${parsed.goalId}#${parsed.taskId}` : `#${parsed.goalId}`}.`);
    return;
  }
  const goal = readGoalWithTasks(parsed.goalId, parsed.username);
  if (goal?.issue_number) console.log(`✅ Synced #${parsed.goalId} → Issue #${goal.issue_number}`);
  else console.log(`✅ Synced #${parsed.goalId}`);
}

export function runSyncCommand(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(USAGE);
    return;
  }
  const [action, ...rest] = args;
  if (action === 'status') return printStatus(rest);
  if (action === 'preview') return printPreview(rest);
  if (args.includes('--json')) {
    throw new Error('Use --json with `lanes sync status` or `lanes sync preview`');
  }
  if (args.length > 1) throw new Error('Usage: lanes sync [record-ref]');

  const ref = action;
  if (!ref) {
    const result = syncAll();
    if (result.skipped) {
      console.log('GitHub sync disabled. No network calls were made. Enable with: lanes config collaboration true');
      return;
    }
    console.log(`⬇️  Issues: ${result.pulled.imported} imported, ${result.pulled.updated} updated`);
    console.log(`🔀 PRs: ${result.pulled.prs_imported} imported, ${result.pulled.prs_updated} updated, ${result.pulled.prs_unchanged} unchanged, ${result.pulled.prs_unmatched} unmatched`);
    printDiagnostics(result.diagnostics);
    const effectsOkay = printEffects(result.effects);
    if (!result.success || !effectsOkay) {
      process.exitCode = 1;
      console.error('Sync incomplete. Review the failed remote actions before retrying.');
      return;
    }
    console.log(`⬆️  Pushed ${result.pushed} Goals`);
    console.log('✅ Sync complete!');
    return;
  }

  if (/^#?[lr]\d+$/i.test(ref)) return runLaneSync(ref);
  runGoalSync(ref);
}
