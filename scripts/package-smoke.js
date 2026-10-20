import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-package-'));
const skillsOnly = process.argv.includes('--skills-only');

async function verifyPackage() {
  const packEnv = { ...process.env };
  delete packEnv.npm_config_dry_run;
  const packOutput = execFileSync('npm', [
    'pack', '--json', '--silent', '--pack-destination', tempRoot,
  ], { cwd: packageRoot, encoding: 'utf8', env: packEnv });
  const [manifest] = JSON.parse(packOutput);
  const paths = manifest.files.map((file) => file.path);

  assert(paths.includes('src/cli.js'), 'tarball is missing the CLI');
  assert(paths.includes('src/lib/goal-discovery.js'), 'tarball is missing shared goal discovery');
  assert(!paths.some((file) => file.startsWith('web/') || file.startsWith('dist/web/')), 'tarball contains retired web assets');
  for (const retired of ['src/commands/web.js', 'src/lib/web-server.js', 'src/lib/board.js']) {
    assert(!paths.includes(retired), `tarball contains retired implementation: ${retired}`);
  }
  assert(paths.includes('.agents/skills/clips/SKILL.md'), 'tarball is missing the Clips skill');
  assert(paths.includes('.agents/skills/lane-manager/SKILL.md'), 'tarball is missing the Lane Manager skill');
  assert(paths.includes('.agents/skills/clips-dev/SKILL.md'), 'tarball is missing the Clips Dev skill');
  assert(paths.includes('.agents/skills/clips-dev/agents/openai.yaml'), 'tarball is missing Clips Dev agent metadata');
  assert(!paths.some((file) => file.startsWith('.agents/skills/loopz/')), 'tarball contains a duplicate legacy skill directory');
  assert(paths.includes('skillshop.manifest.mjs'), 'tarball is missing the Skillshop manifest');
  assert(!paths.includes('src/skills.js'), 'tarball still contains the deprecated named skill export');
  assert(!paths.some((file) => file.startsWith('.agents/skills/clips-') && !file.startsWith('.agents/skills/clips-dev/')), 'tarball contains routed Clips skills');
  assert(paths.includes('CHANGELOG.md'), 'tarball is missing the changelog');
  assert(paths.includes('docs/cli-reference.md'), 'tarball is missing the linked technical reference');
  assert(!paths.some((file) => file.endsWith('.test.js')), 'tarball contains source tests');
  assert(!paths.some((file) => file.startsWith('.agents/plans/')), 'tarball contains local agent plans');

  const tarball = path.join(tempRoot, manifest.filename);
  console.log(`Package SHA-256: ${createHash('sha256').update(fs.readFileSync(tarball)).digest('hex')}`);
  execFileSync('tar', ['-xzf', tarball, '-C', tempRoot]);
  const extractedRoot = path.join(tempRoot, 'package');
  for (const file of paths.filter((file) => file === 'README.md' || (file.startsWith('docs/') && file.endsWith('.md')))) {
    const absolute = path.join(extractedRoot, file);
    for (const [, target] of fs.readFileSync(absolute, 'utf8').matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      assert(fs.existsSync(path.resolve(path.dirname(absolute), target.split('#')[0])), `missing packaged documentation reference in ${file}: ${target}`);
    }
  }
  const packedPackage = JSON.parse(fs.readFileSync(path.join(extractedRoot, 'package.json'), 'utf8'));
  assert.deepEqual(packedPackage.bin, { clips: 'src/cli.js' });
  assert.equal(packedPackage.dependencies.skillshop, '^2.0.0');
  assert(packedPackage.devDependencies.vitest, 'package is missing the retained test runner');
  assert.equal(packedPackage.scripts.test, 'vitest run --config vitest.config.js');
  assert.equal(packedPackage.scripts['test:package'], 'node scripts/package-smoke.js');
  assert(!Object.keys(packedPackage.scripts).some((name) => name.startsWith('web:')));
  assert(!Object.values(packedPackage.scripts).some((command) => /web:build|web\/vite/.test(command)));
  for (const dependency of ['@internationalized/date', '@sveltejs/vite-plugin-svelte', '@testing-library/jest-dom', '@testing-library/svelte', 'bits-ui', 'jsdom', 'svelte', 'vite', 'iconoir']) {
    assert.equal(packedPackage.devDependencies[dependency], undefined, `retained web-only dependency: ${dependency}`);
  }

  // The smoke test extracts the tarball, rather than npm-installing it.
  // Supply the real installed SDK at the path an npm install would create.
  const installedSdk = path.join(packageRoot, 'node_modules', 'skillshop');
  assert(fs.existsSync(installedSdk), 'Install skillshop@^2 before running package smoke');
  fs.mkdirSync(path.join(extractedRoot, 'node_modules'), { recursive: true });
  fs.cpSync(installedSdk, path.join(extractedRoot, 'node_modules', 'skillshop'), {
    recursive: true,
    dereference: true,
  });
  assert.equal(packedPackage.exports['./skillshop'], './skillshop.manifest.mjs');
  assert.equal(packedPackage.exports['./skills'], undefined);
  const skillLibrary = (await import(pathToFileURL(path.join(extractedRoot, 'skillshop.manifest.mjs')).href)).default;
  assert.equal(skillLibrary.packageName, '@dfosco/clips');
  assert.deepEqual(Object.keys(skillLibrary.skills).sort(), ['skill:clips', 'skill:clips-dev', 'skill:lane-manager', 'skill:loopz']);
  assert.equal(skillLibrary.skills['skill:loopz'], skillLibrary.skills['skill:clips-dev'], 'legacy import must resolve to the canonical skill');
  const { importSkill } = await import('skillshop/import');
  for (const specifier of ['skill:clips-dev', 'skill:loopz']) {
    const targetDir = path.join(tempRoot, specifier.replace(':', '-'));
    await importSkill({ library: extractedRoot, specifier, targetDir });
    assert.match(fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8'), /^name: clips-dev$/m);
    assert.match(fs.readFileSync(path.join(targetDir, 'agents', 'openai.yaml'), 'utf8'), /Use \$clips-dev/);
  }
  for (const [specifier, url] of Object.entries(skillLibrary.skills)) {
    const directory = fileURLToPath(url);
    const skill = path.join(directory, 'SKILL.md');
    assert(fs.existsSync(skill), `${specifier} manifest does not exist`);
    const content = fs.readFileSync(skill, 'utf8');
    assert.match(content, /comprehensive plans/i, `${specifier} must describe complete planning`);
    assert.match(content, /plan-only/, `${specifier} must preserve explicit non-executing output`);
    assert.match(content, /direct child of[\s\S]*?Lane Manager session/, `${specifier} must retain direct Copilot parentage`);
    assert.match(content, /coordinating_creator_session_id/, `${specifier} must require native parentage readback`);
    assert.match(content, /send_session_message/, `${specifier} must preserve manager communication`);
    assert.match(content, /Paseo/, `${specifier} must distinguish the other host`);
    for (const [, target] of content.matchAll(/\[[^\]]+\]\((\.[^)\s]+)\)/g)) {
      const file = target.split('#')[0];
      assert(fs.existsSync(path.resolve(directory, file)), `${specifier} has a missing packaged reference: ${target}`);
    }
  }
  const managerPolicy = fs.readFileSync(
    path.join(fileURLToPath(skillLibrary.skills['skill:lane-manager']), 'SKILL.md'), 'utf8',
  ).replace(/\s+/g, ' ');
  for (const [scenario, pattern] of [
    ['Paseo workspace agents', /workspace\.agents\.create[\s\S]*ParentAgentId: null/],
    ['direct coordinated Copilot children', /create_session[\s\S]*coordinate_with_creator: true[\s\S]*coordinating_creator_session_id[\s\S]*send_session_message/],
    ['generic non-steerable sub-agents', /must invoke available native sub-agents[\s\S]*even if they are not user-steerable/],
    ['linear no-primitive execution', /When no delegation primitive exists[\s\S]*implement and verify authorized work itself, linearly[\s\S]*dependency-respecting order/],
    ['plan-only override', /plan-only instructions still stop before implementation/i],
    ['denied authorization is not absent delegation', /Missing delegation does not bypass denied authorization/],
  ]) {
    assert.match(managerPolicy, pattern, `packaged Lane Manager must support: ${scenario}`);
  }
  assert.doesNotMatch(managerPolicy, /Never implement or run substantive validation|Do not implement it yourself|Do not take over implementation or substantive verification when a dev agent is unavailable/i, 'packaged Lane Manager retains a blanket fallback prohibition');
  assert.match(managerPolicy, /Continued delivery is already the Lane Manager's responsibility/);
  const devPolicy = fs.readFileSync(
    path.join(fileURLToPath(skillLibrary.skills['skill:clips-dev']), 'SKILL.md'), 'utf8',
  ).replace(/\s+/g, ' ');
  assert.match(devPolicy, /Act as an autonomous staff developer/);
  assert.match(devPolicy, /Keep development in the current session/);
  assert.match(devPolicy, /does not create and coordinate a team/);
  assert.match(devPolicy, /standalone Clips Dev session does not need a manager/);
  for (const [scenario, pattern] of [
    ['configuration readback', /clips config lane_max_active_agents/],
    ['documented setter', /clips config --lane-max-active-agents 3/],
    ['five concurrent workers excluding manager', /5 concurrent active workers per Lane[\s\S]*excluding the Lane Manager/],
    ['announcement before dispatch', /Announce the effective budget before dispatch/],
    ['active and in-flight accounting', /active and starting workers, including reused or resumed sessions[\s\S]*Reserve capacity before launch or resumption/],
    ['confirmed idle and completion release', /Confirmed idle or completed workers free capacity/],
    ['non-terminating reductions', /Reducing the budget below current activity does not terminate workers/],
    ['nested capacity and unknown activity', /Unknown activity is not free capacity[\s\S]*budget includes nested helpers/],
    ['policy rather than native enforcement', /configuration-backed dispatch policy, not native SDK enforcement/],
    ['no budget-exhaustion fallback bypass', /A full budget is not an absent primitive/],
  ]) {
    assert.match(managerPolicy, pattern, `packaged worker-budget policy must cover: ${scenario}`);
  }
  if (skillsOnly) {
    console.log(`Verified ${manifest.id}: packaged skills, references, and six harness-policy scenarios`);
    return;
  }
  const cli = path.join(extractedRoot, 'src', 'cli.js');
  const cliEnv = { ...process.env, CLIPS_HOME: path.join(tempRoot, 'cli-home') };
  const version = execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8', env: cliEnv }).trim();
  assert.equal(version, `clips v${manifest.version}`);
  assert.match(execFileSync(process.execPath, [cli, 'dev', '--help'], { encoding: 'utf8', env: cliEnv }), /Usage: clips dev/);
  assert.match(execFileSync(process.execPath, [cli, 'prod', '--help'], { encoding: 'utf8', env: cliEnv }), /Usage: clips prod/);
  assert.doesNotMatch(execFileSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: cliEnv }), /^\s+(?:clips )?web\b/m);
  const removedCommand = spawnSync(process.execPath, [cli, 'web'], {
    encoding: 'utf8', env: cliEnv, timeout: 5000,
  });
  assert.equal(removedCommand.error, undefined);
  assert.equal(removedCommand.status, 1);
  assert.equal(removedCommand.stdout, '');
  assert.match(removedCommand.stderr, /Unknown command: web/);

  const initializedProject = path.join(tempRoot, 'initialized-project');
  fs.mkdirSync(initializedProject);
  execFileSync('git', ['init', '--quiet'], { cwd: initializedProject });
  execFileSync(process.execPath, [cli, 'init'], {
    cwd: initializedProject,
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'init-home') },
    stdio: 'pipe',
  });
  assert(
    fs.existsSync(path.join(initializedProject, '.agents', 'skills', 'clips', 'SKILL.md')),
    'packaged init did not install the Clips skill',
  );
  const localNote = path.join(initializedProject, '.agents', 'skills', 'clips', 'project-note.md');
  fs.writeFileSync(localNote, 'local notes survive reinitialization\n');
  execFileSync(process.execPath, [cli, 'init'], {
    cwd: initializedProject,
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'init-home') },
    stdio: 'pipe',
  });
  assert.equal(fs.readFileSync(localNote, 'utf8'), 'local notes survive reinitialization\n');
  const runPackaged = (...args) => execFileSync(process.execPath, [cli, ...args], {
    cwd: initializedProject, encoding: 'utf8',
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'init-home') },
  });
  assert.equal(runPackaged('config', 'lane_max_active_agents').trim(), '5');
  const configPath = path.join(initializedProject, '.clips', 'clips.config.json');
  const originalConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  runPackaged('config', '--lane-max-active-agents', '3');
  assert.equal(runPackaged('config', 'lane_max_active_agents').trim(), '3');
  assert.deepEqual(JSON.parse(fs.readFileSync(configPath, 'utf8')), { ...originalConfig, lane_max_active_agents: 3 });
  const validConfig = fs.readFileSync(configPath, 'utf8');
  const invalidLimit = spawnSync(process.execPath, [cli, 'config', '--lane-max-active-agents', '0'], {
    cwd: initializedProject, encoding: 'utf8',
    env: { ...process.env, CLIPS_HOME: path.join(tempRoot, 'init-home') },
  });
  assert.equal(invalidLimit.status, 1);
  assert.match(invalidLimit.stderr, /positive safe integer/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), validConfig);
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
  const lane = JSON.parse(runPackaged('lane', 'create', '{"title":"Packaged Lane"}'));
  runPackaged('goal', 'assign', 'g1', lane.lane_id);
  assert.deepEqual(JSON.parse(runPackaged('lane', 'show', lane.lane_id)).goals.map((goal) => goal.goal_id), ['g001']);
  assert.equal(JSON.parse(runPackaged('goal', 'create', '{"title":"Next goal"}')).goal_id, 'g002');

  console.log(`Verified ${manifest.id}: CLI-only package, removed web command, skills and alias, worker-budget config and policy, documentation, installation switching, components, goals, Lanes, revisions, and acceptance`);
}

try {
  await verifyPackage();
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
