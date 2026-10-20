import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canvasBuildManifest, readCanvasArtifact, verifyCanvasBuild } from '../src/canvas-build.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-artifact-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = ['canvas/ui/main.jsx', 'canvas/board-view.mjs', 'canvas/model.mjs', 'canvas/index.html', 'jsconfig.json', 'vite.config.js', 'package.json', 'package-lock.json', 'scripts/build-canvas.mjs', 'src/canvas-build.js', 'canvas/dist/app.js', 'canvas/dist/style.css'];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), file);
  }
  fs.writeFileSync(path.join(root, 'canvas/dist/build-manifest.json'), JSON.stringify(canvasBuildManifest(root)));
  return root;
}

test('runtime serves checked emitted bytes during source drift while strict install validation rejects it', (t) => {
  const root = fixture(t);
  assert.equal(readCanvasArtifact(root).sourceStatus.matchesBuild, true);
  fs.writeFileSync(path.join(root, 'canvas/ui/main.jsx'), 'new source, not built yet');
  const artifact = readCanvasArtifact(root);
  assert.equal(artifact.files['app.js'].toString(), 'canvas/dist/app.js');
  assert.deepEqual(artifact.sourceStatus, { observedAt: 'provider-load', matchesBuild: false, changedFiles: ['canvas/ui/main.jsx'] });
  assert.throws(() => verifyCanvasBuild(root), /missing or stale/);
  fs.writeFileSync(path.join(root, 'canvas/dist/app.js'), 'corrupt');
  assert.throws(() => readCanvasArtifact(root), /Asset app.js differs/);
});

test('runtime rejects unknown bridge versions and missing emitted assets', (t) => {
  const root = fixture(t);
  const manifest = path.join(root, 'canvas/dist/build-manifest.json');
  const build = JSON.parse(fs.readFileSync(manifest));
  fs.writeFileSync(manifest, JSON.stringify({ ...build, bridgeVersion: 99 }));
  assert.throws(() => readCanvasArtifact(root), /Unsupported canvas manifest or renderer\/provider bridge version/);
  fs.writeFileSync(manifest, JSON.stringify(build));
  fs.unlinkSync(path.join(root, 'canvas/dist/style.css'));
  assert.throws(() => readCanvasArtifact(root), /Unexpected asset closure/);
});

test('shared association model is a tracked renderer input', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'canvas/model.mjs'), 'changed association semantics');
  assert.throws(() => verifyCanvasBuild(root), /missing or stale/);
  assert.deepEqual(readCanvasArtifact(root).sourceStatus.changedFiles, ['canvas/model.mjs']);
});

test('runtime rejects mismatched index and unknown emitted files instead of serving mixed artifacts', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'canvas/index.html'), 'new index');
  assert.throws(() => readCanvasArtifact(root), /index differs/);
  fs.writeFileSync(path.join(root, 'canvas/index.html'), 'canvas/index.html');
  fs.writeFileSync(path.join(root, 'canvas/dist/unexpected.js'), 'unknown chunk');
  assert.throws(() => readCanvasArtifact(root), /Unexpected asset closure/);
});
