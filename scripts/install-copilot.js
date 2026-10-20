// Run from the maintained checkout: node scripts/install-copilot.js
// Restore the previous local links/contents: node scripts/install-copilot.js --rollback
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installCopilot, rollbackCopilotInstall } from '../src/lib/copilot-install.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export { installCopilot, rollbackCopilotInstall };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(arg => !['--rollback'].includes(arg)) || process.argv.slice(2).length > 1) {
    console.error('Usage: node scripts/install-copilot.js [--rollback]');
    process.exitCode = 2;
  } else {
    const result = process.argv.includes('--rollback')
      ? rollbackCopilotInstall()
      : installCopilot({ repositoryRoot });
    console.log(JSON.stringify(result, null, 2));
  }
}
