import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function canvasSourceFiles(pluginRoot) {
  function walk(dir) { return fs.readdirSync(path.join(pluginRoot, dir), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]); }
  return [...walk('canvas/ui'), 'canvas/board-view.mjs', 'canvas/index.html', 'components.json', 'jsconfig.json', 'vite.config.js', 'package.json', 'package-lock.json', 'scripts/build-canvas.mjs', 'src/canvas-build.js'].sort();
}
export function canvasBuildManifest(pluginRoot) {
  return { version: 1, sources: Object.fromEntries(canvasSourceFiles(pluginRoot).map((file) => [file, sha(path.join(pluginRoot, file))])), assets: Object.fromEntries(['app.js', 'style.css'].map((file) => [file, sha(path.join(pluginRoot, 'canvas/dist', file))])) };
}
export function verifyCanvasBuild(pluginRoot) {
  try {
    const actual = canvasBuildManifest(pluginRoot);
    const expected = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'canvas/dist/build-manifest.json'), 'utf8'));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Source or assets differ from the build manifest.');
    const assets = fs.readdirSync(path.join(pluginRoot, 'canvas/dist')).sort();
    if (JSON.stringify(assets) !== JSON.stringify(['app.js','build-manifest.json','style.css'])) throw new Error('Unexpected asset closure.');
    return actual;
  } catch (error) { throw new Error(`Copilot canvas build is missing or stale. Run npm ci --include=dev --include=optional and npm run build in plugins/copilot before installation. ${error.message}`); }
}
