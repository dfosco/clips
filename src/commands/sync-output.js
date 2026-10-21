export function reportAutoSyncResult(result, ref) {
  for (const diagnostic of result.diagnostics || []) {
    console.warn(`⚠️  ${diagnostic.source || 'sync'}${diagnostic.ref ? ` ${diagnostic.ref}` : ''}: ${diagnostic.message}`);
  }
  if (!result.success) {
    console.error(JSON.stringify({ event: 'github_auto_sync', ref, ...result }));
    process.exitCode = 1;
  }
}
