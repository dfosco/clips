import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-package-'));

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });
}

function waitForBoard(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for packaged board')), 10000);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/Clips board: (http:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Packaged board exited with code ${code}: ${output}`));
    });
  });
}

let board;
try {
  const packEnv = { ...process.env };
  delete packEnv.npm_config_dry_run;
  const packOutput = execFileSync('npm', [
    'pack', '--ignore-scripts', '--json', '--silent', '--pack-destination', tempRoot,
  ], { cwd: packageRoot, encoding: 'utf8', env: packEnv });
  const [manifest] = JSON.parse(packOutput);
  const paths = manifest.files.map((file) => file.path);

  assert(paths.includes('src/cli.js'), 'tarball is missing the CLI');
  assert(paths.includes('dist/web/index.html'), 'tarball is missing board assets');
  assert(paths.includes('.agents/skills/clips/SKILL.md'), 'tarball is missing the Clips skill');
  for (const skill of [
    'clips-frame-goal',
    'clips-plan-decision',
    'clips-break-down-work',
    'clips-develop-change',
    'clips-verify-outcome',
    'clips-review-change',
    'clips-resume-work',
  ]) {
    assert(paths.includes(`.agents/skills/${skill}/SKILL.md`), `tarball is missing ${skill}`);
  }
  assert(paths.includes('.agents/skills/clips/references/cli.md'), 'tarball is missing the Clips CLI reference');
  assert(paths.includes('.agents/skills/clips/THIRD_PARTY_NOTICES.md'), 'tarball is missing the pstack license notice');
  assert(paths.includes('CHANGELOG.md'), 'tarball is missing the changelog');
  assert(!paths.some((file) => file.endsWith('.test.js')), 'tarball contains source tests');
  assert(!paths.some((file) => file.startsWith('.agents/plans/')), 'tarball contains local agent plans');

  const tarball = path.join(tempRoot, manifest.filename);
  execFileSync('tar', ['-xzf', tarball, '-C', tempRoot]);
  const extractedRoot = path.join(tempRoot, 'package');
  const packedPackage = JSON.parse(fs.readFileSync(path.join(extractedRoot, 'package.json'), 'utf8'));
  assert.deepEqual(packedPackage.bin, { clips: 'src/cli.js' });
  const cli = path.join(extractedRoot, 'src', 'cli.js');
  const version = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(version, `clips v${manifest.version}`);

  const initializedProject = path.join(tempRoot, 'initialized-project');
  fs.mkdirSync(initializedProject);
  execFileSync('git', ['init', '--quiet'], { cwd: initializedProject });
  execFileSync(process.execPath, [cli, 'init'], {
    cwd: initializedProject,
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'init-home') },
    stdio: 'pipe',
  });
  for (const skill of [
    'clips',
    'clips-frame-goal',
    'clips-plan-decision',
    'clips-break-down-work',
    'clips-develop-change',
    'clips-verify-outcome',
    'clips-review-change',
    'clips-resume-work',
  ]) {
    assert(
      fs.existsSync(path.join(initializedProject, '.agents', 'skills', skill, 'SKILL.md')),
      `packaged init did not install ${skill}`,
    );
  }
  assert(
    fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'clips', 'THIRD_PARTY_NOTICES.md')),
    'packaged init did not install the pstack license notice',
  );

  board = spawn(process.execPath, [cli, 'web', '--port', '0'], {
    cwd: tempRoot,
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'home') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const boardUrl = await waitForBoard(board);
  const page = await get(boardUrl);
  assert.equal(page.status, 200);
  assert.match(page.body, /<div id="app">/);
  const api = await get(`${boardUrl}/api/board`);
  assert.equal(api.status, 200);
  assert.deepEqual(JSON.parse(api.body).goals, []);

  console.log(`Verified ${manifest.id}: CLI, skill, and web board`);
} finally {
  if (board && !board.killed) board.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
