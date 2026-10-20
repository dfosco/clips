import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export const CANVAS_BRIDGE_VERSION = 2;
export function canvasSourceFiles(pluginRoot) {
  function walk(dir) { return fs.readdirSync(path.join(pluginRoot, dir), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]); }
  return [...walk('canvas/ui'), 'canvas/board-view.mjs', 'canvas/model.mjs', 'canvas/index.html', 'jsconfig.json', 'vite.config.js', 'package.json', 'package-lock.json', 'scripts/build-canvas.mjs', 'src/canvas-build.js'].sort();
}
export function canvasBuildManifest(pluginRoot) {
  return { version: 1, bridgeVersion: CANVAS_BRIDGE_VERSION, sources: Object.fromEntries(canvasSourceFiles(pluginRoot).map((file) => [file, sha(path.join(pluginRoot, file))])), assets: Object.fromEntries(['app.js', 'style.css'].map((file) => [file, sha(path.join(pluginRoot, 'canvas/dist', file))])) };
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

export function readCanvasArtifact(pluginRoot) {
  try {
    const build = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'canvas/dist/build-manifest.json'), 'utf8'));
    if (build.version !== 1 || build.bridgeVersion !== CANVAS_BRIDGE_VERSION || !build.sources || !build.assets) throw new Error('Unsupported canvas manifest or renderer/provider bridge version.');
    const names = ['app.js', 'build-manifest.json', 'style.css'];
    if (JSON.stringify(fs.readdirSync(path.join(pluginRoot, 'canvas/dist')).sort()) !== JSON.stringify(names)) throw new Error('Unexpected asset closure.');
    if (JSON.stringify(Object.keys(build.assets).sort()) !== JSON.stringify(['app.js', 'style.css'])) throw new Error('Invalid asset manifest.');
    const files = Object.fromEntries(['app.js', 'style.css'].map((name) => {
      const bytes = fs.readFileSync(path.join(pluginRoot, 'canvas/dist', name));
      if (createHash('sha256').update(bytes).digest('hex') !== build.assets[name]) throw new Error(`Asset ${name} differs from the build manifest.`);
      return [name, bytes];
    }));
    const index = fs.readFileSync(path.join(pluginRoot, 'canvas/index.html'));
    if (createHash('sha256').update(index).digest('hex') !== build.sources['canvas/index.html']) throw new Error('Canvas index differs from the build manifest.');
    files['index.html'] = index;
    const current = new Set(canvasSourceFiles(pluginRoot));
    const changedFiles = [...new Set([...Object.keys(build.sources), ...current])].filter((file) => {
      if (!current.has(file)) return true;
      return sha(path.join(pluginRoot, file)) !== build.sources[file];
    }).sort();
    return { build, files, sourceStatus: { observedAt: 'provider-load', matchesBuild: changedFiles.length === 0, changedFiles } };
  } catch (error) {
    throw new Error(`Copilot canvas artifact is missing or corrupt. Rebuild in plugins/copilot before reopening. ${error.message}`);
  }
}
