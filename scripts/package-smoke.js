import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  assert(paths.includes('plugins/paseo/paseo-plugin.json'), 'tarball is missing the Paseo plugin manifest');
  assert(paths.includes('plugins/paseo/index.client.tsx'), 'tarball is missing the Paseo client entry');
  assert(paths.includes('plugins/paseo/index.server.ts'), 'tarball is missing the Paseo server entry');
  assert(!paths.some((file) => file.startsWith('plugins/paseo/node_modules/')), 'tarball contains Paseo development dependencies');
  assert(!paths.some((file) => /^plugins\/paseo\/.*\.test\.tsx?$/.test(file)), 'tarball contains Paseo tests');
  assert(paths.includes('dist/web/index.html'), 'tarball is missing board assets');
  assert(paths.includes('.agents/skills/clips/SKILL.md'), 'tarball is missing the Clips skill');
  assert(paths.includes('.agents/skills/loopz/SKILL.md'), 'tarball is missing the Loopz skill');
  assert(paths.includes('.agents/skills/loopz/agents/openai.yaml'), 'tarball is missing Loopz agent metadata');
  assert(paths.includes('skillshop.manifest.mjs'), 'tarball is missing the Skillshop manifest');
  assert(!paths.includes('src/skills.js'), 'tarball still contains the deprecated named skill export');
  assert(!paths.some((file) => file.startsWith('.agents/skills/clips-')), 'tarball contains routed Clips skills');
  assert(paths.includes('CHANGELOG.md'), 'tarball is missing the changelog');
  assert(!paths.some((file) => file.endsWith('.test.js')), 'tarball contains source tests');
  assert(!paths.some((file) => file.startsWith('.agents/plans/')), 'tarball contains local agent plans');

  const tarball = path.join(tempRoot, manifest.filename);
  execFileSync('tar', ['-xzf', tarball, '-C', tempRoot]);
  const extractedRoot = path.join(tempRoot, 'package');
  const packedPackage = JSON.parse(fs.readFileSync(path.join(extractedRoot, 'package.json'), 'utf8'));
  assert.deepEqual(packedPackage.bin, { clips: 'src/cli.js' });
  assert.equal(packedPackage.dependencies.skillshop, '2.1.0');

  // The smoke test extracts the tarball, rather than npm-installing it.
  // Supply the real installed SDK at the path an npm install would create.
  const installedSdk = path.join(packageRoot, 'node_modules', 'skillshop');
  assert(fs.existsSync(installedSdk), 'Install skillshop@2.1.0 before running package smoke');
  fs.mkdirSync(path.join(extractedRoot, 'node_modules'), { recursive: true });
  fs.cpSync(installedSdk, path.join(extractedRoot, 'node_modules', 'skillshop'), {
    recursive: true,
    dereference: true,
  });
  assert.equal(packedPackage.exports['./skillshop'], './skillshop.manifest.mjs');
  assert.equal(packedPackage.exports['./skills'], undefined);
  const skillLibrary = (await import(pathToFileURL(path.join(extractedRoot, 'skillshop.manifest.mjs')).href)).default;
  assert.equal(skillLibrary.packageName, '@dfosco/clips');
  assert.deepEqual(Object.keys(skillLibrary.skills).sort(), ['skill:clips', 'skill:loopz']);
  assert(fs.existsSync(path.join(fileURLToPath(skillLibrary.skills['skill:clips']), 'SKILL.md')), 'skill:clips manifest does not exist');
  assert(fs.existsSync(path.join(fileURLToPath(skillLibrary.skills['skill:loopz']), 'SKILL.md')), 'skill:loopz manifest does not exist');
  const cli = path.join(extractedRoot, 'src', 'cli.js');
  const version = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim();
  assert.equal(version, `clips v${manifest.version}`);
  assert.match(execFileSync(process.execPath, [cli, 'dev', '--help'], { encoding: 'utf8' }), /Usage: clips dev/);
  assert.match(execFileSync(process.execPath, [cli, 'prod', '--help'], { encoding: 'utf8' }), /Usage: clips prod/);

  const initializedProject = path.join(tempRoot, 'initialized-project');
  fs.mkdirSync(initializedProject);
  execFileSync('git', ['init', '--quiet'], { cwd: initializedProject });
  execFileSync(process.execPath, [cli, 'init', '--skills-scope', 'project'], {
    cwd: initializedProject,
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'init-home') },
    stdio: 'pipe',
  });
  assert(
    fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'clips', 'SKILL.md')),
    'packaged init did not install the Clips skill',
  );
  assert(fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'loopz', 'SKILL.md')), 'packaged init did not install Loopz');
  const localNote = path.join(initializedProject, '.agents', 'skills', 'clips', 'project-note.md');
  fs.writeFileSync(localNote, 'local notes survive reinitialization\n');
  execFileSync(process.execPath, [cli, 'init', '--skills-scope', 'project'], {
    cwd: initializedProject,
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'init-home') },
    stdio: 'pipe',
  });
  assert.equal(fs.readFileSync(localNote, 'utf8'), 'local notes survive reinitialization\n');
  const runPackaged = (...args) => execFileSync(process.execPath, [cli, ...args], {
    cwd: initializedProject, encoding: 'utf8',
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'init-home') },
  });
  const packagedBoard = JSON.parse(runPackaged('board', '--json'));
  assert(Array.isArray(packagedBoard.lanes) && Array.isArray(packagedBoard.goals), 'packaged JSON board is invalid');
  runPackaged('component', 'create', JSON.stringify({ title: 'Packaged persistence', contract: 'Return a stored ID' }));
  runPackaged('component', 'update', 'c1', JSON.stringify({ contract: 'Return a stored ID or no preference' }));
  assert.equal(JSON.parse(runPackaged('view', '#c1#r1', '--json')).contract, 'Return a stored ID');
  runPackaged('goal', 'create', JSON.stringify({ title: 'Packaged feature', plan: 'Implement persistence' }));
  runPackaged('task', 'create', 'g1', JSON.stringify({ title: 'Persist selection', components: ['#c1#r1'], acceptance_criteria: ['Read the stored ID'] }));
  runPackaged('task', 'accept', 'g1', 't1', JSON.stringify({
    artifact: 'fixture:packaged-candidate', accepted_by: 'package-smoke-fixture', summary: 'Validate record transport',
    criteria: [{ id: 'A1', status: 'satisfied', evidence: 'Fixture evidence for packaged command validation' }],
  }));
  assert.equal(JSON.parse(runPackaged('view', '#g1#t1#A1', '--json')).acceptance.status, 'satisfied');
  assert.equal(JSON.parse(runPackaged('history', '#g1#t1', '--json')).length, 2);

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

  console.log(`Verified ${manifest.id}: CLI, skill, components, revisions, acceptance, and web board`);
} finally {
  if (board && !board.killed) board.kill();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
