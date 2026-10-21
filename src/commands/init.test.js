import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { PassThrough } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { chooseSkillScope, setupGitExclude } from './init.js';

const tempDirs = [];
const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const bundledSkills = ['lane-dev', 'lane-manager', 'lane-plugin', 'lane-radar', 'lanes'];

function createGitRepo() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-init-'));
  tempDirs.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  return cwd;
}

afterEach(() => {
  for (const cwd of tempDirs.splice(0)) {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

describe('setupGitExclude', () => {
  it('initializes only a local store and registry with the noninteractive store-only mode', () => {
    const cwd = createGitRepo();
    const env = { ...process.env, LANES_HOME: '', CLIPS_HOME: path.join(cwd, 'clips-home') };
    const result = JSON.parse(execFileSync(process.execPath, [cliPath, 'init', '--store-only'], { cwd, env, encoding: 'utf8' }));
    expect(result.initialized).toBe(true);
    expect(fs.realpathSync(result.projectPath)).toBe(fs.realpathSync(cwd));
    expect(JSON.parse(fs.readFileSync(path.join(cwd, '.lanes', 'lanes.config.json'), 'utf8')).collaboration).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(env.CLIPS_HOME, 'projects.json'), 'utf8')).projects).toContainEqual({ path: fs.realpathSync(cwd) });
    for (const name of ['.agents', '.github', '.claude', '.vscode']) expect(fs.existsSync(path.join(cwd, name))).toBe(false);
    expect(fs.readdirSync(path.join(cwd, '.lanes', 'db'))).toEqual([]);
    expect(fs.readFileSync(path.join(cwd, '.git', 'info', 'exclude'), 'utf8')).toContain('.lanes');
    const configPath = path.join(cwd, '.lanes', 'lanes.config.json');
    const before = fs.readFileSync(configPath, 'utf8');
    const repeated = spawnSync(process.execPath, [cliPath, 'init', '--store-only'], { cwd, env, encoding: 'utf8' });
    expect(repeated.status).toBe(0);
    expect(JSON.parse(repeated.stdout).migrated).toBe(false);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('does not replace an invalid registry or create a store when minimal initialization fails', () => {
    const cwd = createGitRepo();
    const home = path.join(cwd, 'clips-home');
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'projects.json'), '{"version":99,"projects":[]}');
    const result = spawnSync(process.execPath, [cliPath, 'init', '--store-only'], { cwd, env: { ...process.env, LANES_HOME: '', CLIPS_HOME: home }, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('registry is invalid');
    expect(fs.existsSync(path.join(cwd, '.lanes'))).toBe(false);
    expect(fs.readFileSync(path.join(home, 'projects.json'), 'utf8')).toContain('"version":99');
  });

  it('rejects store-only combined with skill-install options before any changes', () => {
    const cwd = createGitRepo();
    const home = path.join(cwd, 'home');
    const result = spawnSync(process.execPath, [cliPath, 'init', '--store-only', '--global'], {
      cwd, env: { ...process.env, LANES_HOME: '', HOME: home, CLIPS_HOME: path.join(cwd, 'clips-home') }, encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--store-only must be used alone');
    expect(fs.existsSync(path.join(cwd, '.lanes'))).toBe(false);
    expect(fs.existsSync(home)).toBe(false);
  });

  it('asks for the scope on each interactive call', async () => {
    for (const [answer, expected] of [['project', 'project'], ['user', 'user']]) {
      const input = new PassThrough();
      const output = new PassThrough();
      input.isTTY = true;
      output.isTTY = true;
      let prompt = '';
      output.on('data', (chunk) => { prompt += chunk.toString(); });
      const choice = chooseSkillScope([], { input, output });
      setImmediate(() => input.write(`${answer}\n`));
      expect(await choice).toBe(expected);
      expect(prompt).toContain('Install Lanes skills');
    }
  });

  it('requires an explicit scope without a terminal and makes no changes', () => {
    const cwd = createGitRepo();
    const result = spawnSync(process.execPath, [cliPath, 'init'], {
      cwd, encoding: 'utf8', env: { ...process.env, LANES_HOME: '', CLIPS_HOME: path.join(cwd, 'user-store') },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--skills-scope');
    expect(fs.existsSync(path.join(cwd, '.lanes'))).toBe(false);
  });

  it('adds .clips to the repository-local Git exclude file', () => {
    const cwd = createGitRepo();

    expect(setupGitExclude(cwd)).toBe(true);

    const excludePath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd,
      encoding: 'utf8'
    }).trim();
    expect(fs.readFileSync(path.resolve(cwd, excludePath), 'utf8')).toContain('.clips\n');
  });

  it('does not add a duplicate entry on repeated initialization', () => {
    const cwd = createGitRepo();

    expect(setupGitExclude(cwd)).toBe(true);
    expect(setupGitExclude(cwd)).toBe(false);

    const excludePath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd,
      encoding: 'utf8'
    }).trim();
    const content = fs.readFileSync(path.resolve(cwd, excludePath), 'utf8');
    expect(content.match(/^\.clips$/gm)).toHaveLength(1);
    expect(content).not.toContain('.dots');
  });

  it('initializes local-only and never invokes GitHub during init or sync', () => {
    const cwd = createGitRepo();
    const binDir = path.join(cwd, 'bin');
    const markerPath = path.join(cwd, 'gh-called');
    const ghPath = path.join(binDir, 'gh');
    fs.mkdirSync(binDir);
    fs.writeFileSync(ghPath, `#!/bin/sh\nprintf called >> "${markerPath}"\nprintf '[]\\n'\n`);
    fs.chmodSync(ghPath, 0o755);
    const env = { ...process.env, LANES_HOME: '', PATH: `${binDir}:${process.env.PATH}`, CLIPS_HOME: path.join(cwd, 'system-clips') };

    execFileSync(process.execPath, [cliPath, 'init', '--skills-scope', 'project'], { cwd, env });

    const config = JSON.parse(fs.readFileSync(path.join(cwd, '.lanes', 'lanes.config.json'), 'utf8'));
    expect(config.collaboration).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.lanes', 'records', 'cr'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.lanes', 'records', 'adr'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.lanes', 'records', 'cr', 'archived'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.lanes', 'records', 'adr', 'archived'))).toBe(true);
    expect(fs.existsSync(markerPath)).toBe(false);

    execFileSync(process.execPath, [cliPath, 'goal', 'create', JSON.stringify({ title: 'Local goal' })], { cwd, env });
    execFileSync(process.execPath, [cliPath, 'task', 'create', 'g001', JSON.stringify({ title: 'Local task' })], { cwd, env });
    expect(fs.existsSync(markerPath)).toBe(false);

    const syncOutput = execFileSync(process.execPath, [cliPath, 'sync'], { cwd, env, encoding: 'utf8' });
    expect(syncOutput).toContain('GitHub sync disabled');
    expect(fs.existsSync(markerPath)).toBe(false);

    const configPath = path.join(cwd, '.lanes', 'lanes.config.json');
    const invalidConfig = `${JSON.stringify({ ...config, collaboration: 'false' })}\n`;
    fs.writeFileSync(configPath, invalidConfig);
    const rejected = spawnSync(process.execPath, [cliPath, 'sync'], { cwd, env, encoding: 'utf8' });
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('collaboration configuration must be a boolean');
    expect(fs.readFileSync(configPath, 'utf8')).toBe(invalidConfig);
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it.each(['lanes', 'lane-plugin'])('installs exported project skills while preserving modified %s and local notes', name => {
    const cwd = createGitRepo();
    const env = { ...process.env, LANES_HOME: '', CLIPS_HOME: path.join(cwd, 'system-clips') };
    const skill = path.join(cwd, '.agents', 'skills', name, 'SKILL.md');

    execFileSync(process.execPath, [cliPath, 'init', '--skills-scope', 'project'], { cwd, env });
    expect(fs.existsSync(skill)).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.agents', 'skills', 'lane-manager', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.agents', 'skills', 'lane-dev', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.agents', 'skills', 'loopz'))).toBe(false);
    expect(fs.readFileSync(skill, 'utf8')).toContain(`name: ${name}`);
    fs.writeFileSync(skill, 'stale skill\n');
    const localNote = path.join(cwd, '.agents', 'skills', name, 'project-notes.md');
    fs.writeFileSync(localNote, '# Keep local notes\n');
    execFileSync(process.execPath, [cliPath, 'init', '--skills-scope', 'project'], { cwd, env });
    expect(fs.readFileSync(skill, 'utf8')).toBe('stale skill\n');
    expect(fs.readFileSync(localNote, 'utf8')).toBe('# Keep local notes\n');
    expect(fs.readdirSync(path.join(cwd, '.agents', 'skills'))).toEqual(bundledSkills);
  });

  it.each(['lanes', 'lane-plugin'])('installs exported user skills without project copies and preserves modified %s', name => {
    const cwd = createGitRepo();
    const home = path.join(cwd, 'home');
    fs.mkdirSync(home);
    const env = { ...process.env, LANES_HOME: '', HOME: home, CLIPS_HOME: path.join(cwd, 'system-clips') };
    execFileSync(process.execPath, [cliPath, 'init', '--global'], { cwd, env });
    for (const bundled of bundledSkills) {
      expect(fs.existsSync(path.join(home, '.agents', 'skills', bundled, 'SKILL.md'))).toBe(true);
      expect(fs.existsSync(path.join(cwd, '.agents', 'skills', bundled, 'SKILL.md'))).toBe(false);
    }
    expect(fs.readdirSync(path.join(home, '.agents', 'skills'))).toEqual(bundledSkills);
    const note = path.join(home, '.agents', 'skills', name, 'local-note.md');
    const skill = path.join(home, '.agents', 'skills', name, 'SKILL.md');
    fs.writeFileSync(note, 'old note\n');
    fs.writeFileSync(skill, 'user modification\n');
    execFileSync(process.execPath, [cliPath, 'init', '--global'], { cwd, env });
    expect(fs.readFileSync(note, 'utf8')).toBe('old note\n');
    expect(fs.readFileSync(skill, 'utf8')).toBe('user modification\n');
  });

  it.each(['project', 'user'])('preserves an unmanaged lane-plugin already installed in %s scope', scope => {
    const cwd = createGitRepo();
    const home = path.join(cwd, 'home');
    fs.mkdirSync(home);
    const env = { ...process.env, LANES_HOME: '', HOME: home, CLIPS_HOME: path.join(cwd, 'system-clips') };
    const skillsRoot = path.join(scope === 'project' ? cwd : home, '.agents', 'skills');
    const target = path.join(skillsRoot, 'lane-plugin');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'unmanaged plugin instructions\n');
    fs.writeFileSync(path.join(target, 'notes.md'), 'unmanaged local notes\n');

    execFileSync(process.execPath, [cliPath, 'init', '--skills-scope', scope], { cwd, env });

    expect(fs.readdirSync(skillsRoot)).toEqual(bundledSkills);
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe('unmanaged plugin instructions\n');
    expect(fs.readFileSync(path.join(target, 'notes.md'), 'utf8')).toBe('unmanaged local notes\n');
  });

  it('retires only unchanged legacy files proven by a prior managed installation receipt', () => {
    const cwd = createGitRepo();
    const env = { ...process.env, LANES_HOME: '', CLIPS_HOME: path.join(cwd, 'system-clips') };
    const root = path.join(cwd, '.agents', 'skills');
    fs.mkdirSync(path.join(root, 'clips'), { recursive: true });
    fs.mkdirSync(path.join(root, 'clips-dev'));
    fs.writeFileSync(path.join(root, 'clips', 'SKILL.md'), 'old managed skill');
    fs.writeFileSync(path.join(root, 'clips', 'notes.md'), 'unknown user notes');
    fs.writeFileSync(path.join(root, 'clips-dev', 'SKILL.md'), 'modified legacy skill');
    fs.mkdirSync(env.CLIPS_HOME);
    const digest = text => createHash('sha256').update(text).digest('hex');
    fs.writeFileSync(path.join(env.CLIPS_HOME, 'installation.json'), JSON.stringify({
      projects: { [fs.realpathSync(cwd)]: { files: {
        'clips/SKILL.md': digest('old managed skill'),
        'clips-dev/SKILL.md': digest('old managed dev'),
      } } },
    }));
    execFileSync(process.execPath, [cliPath, 'init', '--skills-scope', 'project'], { cwd, env });
    expect(fs.existsSync(path.join(root, 'clips', 'SKILL.md'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'clips', 'notes.md'), 'utf8')).toBe('unknown user notes');
    expect(fs.readFileSync(path.join(root, 'clips-dev', 'SKILL.md'), 'utf8')).toBe('modified legacy skill');
    expect(fs.existsSync(path.join(root, 'lanes', 'SKILL.md'))).toBe(true);
  });
});
