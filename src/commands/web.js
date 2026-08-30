import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWebServer, parseWebArgs } from '../lib/web-server.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function runWebCommand(args = []) {
  const assetsDir = path.join(packageRoot, 'dist', 'web');

  if (!fs.existsSync(path.join(assetsDir, 'index.html'))) {
    console.error('Error: Packaged web board assets are missing. Reinstall clips or run `npm run web:build` in the clips source package.');
    process.exitCode = 1;
    return;
  }

  let options;
  try {
    options = parseWebArgs(args);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const server = createWebServer({ assetsDir, cwd: process.cwd() });
  server.on('error', (error) => {
    console.error(`Error: Could not start web board: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(options.port, options.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    console.log(`Clips board: http://${options.host}:${port}`);
  });
}
