import { build } from 'vite';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canvasBuildManifest } from '../src/canvas-build.js';
const root = fileURLToPath(new URL('../', import.meta.url));
await build({ root, configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)) });
writeFileSync(new URL('../canvas/dist/build-manifest.json', import.meta.url), JSON.stringify(canvasBuildManifest(root), null, 2) + '\n');
