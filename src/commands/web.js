import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getRepoRoot } from '../lib/core.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function runWebCommand(args = []) {
  const viteBin = path.join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const viteConfig = path.join(packageRoot, 'web', 'vite.config.js');

  if (!fs.existsSync(viteBin) || !fs.existsSync(viteConfig)) {
    console.error('Error: Web board dependencies are not installed. Run `npm install` in the clips package.');
    process.exitCode = 1;
    return;
  }

  const server = spawn(process.execPath, [viteBin, '--config', viteConfig, ...args], {
    cwd: getRepoRoot(),
    stdio: 'inherit',
  });

  server.on('error', (error) => {
    console.error(`Error: Could not start web board: ${error.message}`);
    process.exitCode = 1;
  });

  server.on('close', (code, signal) => {
    if (signal) {
      process.exitCode = 1;
    } else if (code !== null) {
      process.exitCode = code;
    }
  });
}
