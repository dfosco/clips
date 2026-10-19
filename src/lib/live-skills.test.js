import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { installClipsSkills } from '../../scripts/install-live-skills.js';
import { isLiveSkill } from './lane-manager-install.js';
import { reconcileSkills } from './installation.js';

const cli = path.resolve('src/cli.js');
const names = ['clips', 'lane-manager'];
const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-live-skills-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const sourceRoot = path.join(root, 'canonical', 'skills');
  for (const dir of [home, project, sourceRoot]) fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: project });
  for (const name of names) {
    fs.mkdirSync(path.join(sourceRoot, name));
    fs.writeFileSync(path.join(sourceRoot, name, 'SKILL.md'), `${name} maintained\n`);
  }
  const env = { ...process.env, HOME: home, CODEX_HOME: path.join(home, '.codex'), CLIPS_HOME: path.join(home, '.clips') };
  const options = { sourceRoot, home, codexHome: env.CODEX_HOME, backupRoot: path.join(home, 'backups') };
  return { root, home, project, sourceRoot, env, options };
}
function linkClips(project, sourceRoot, agentDir = '.agents') {
  const target = path.join(project, agentDir, 'skills', 'clips');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(path.join(sourceRoot, 'clips'), target, 'dir');
  return target;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('live Clips and Lane Manager skills', () => {
  it('backs up both copies at both paths, repeats safely, and exposes source/reference edits', () => {
    const { home, sourceRoot, options } = fixture();
    for (const base of [path.join(home, '.agents'), options.codexHome]) {
      for (const name of names) {
        const target = path.join(base, 'skills', name);
        fs.mkdirSync(target, { recursive: true });
        fs.writeFileSync(path.join(target, 'SKILL.md'), `${base}/${name} original\n`);
      }
    }
    const first = installClipsSkills(options);
    expect(first).toHaveLength(4);
    for (const result of first) {
      expect(fs.readFileSync(path.join(result.backup, 'SKILL.md'), 'utf8')).toContain('original');
      expect(fs.lstatSync(result.target).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(result.target)).toBe(result.source);
    }
    const backups = fs.readdirSync(options.backupRoot);
    expect(installClipsSkills(options).every(result => !result.changed)).toBe(true);
    expect(fs.readdirSync(options.backupRoot)).toEqual(backups);
    for (const name of names) fs.writeFileSync(path.join(sourceRoot, name, 'SKILL.md'), `${name} updated\n`);
    fs.mkdirSync(path.join(sourceRoot, 'clips', 'references'));
    fs.writeFileSync(path.join(sourceRoot, 'clips', 'references', 'paseo.md'), 'shared procedure updated\n');
    for (const result of first) {
      expect(fs.readFileSync(path.join(result.target, 'SKILL.md'), 'utf8')).toContain('updated');
      if (path.basename(result.target) === 'clips') {
        expect(fs.readFileSync(path.join(result.target, 'references', 'paseo.md'), 'utf8')).toContain('shared procedure updated');
      }
    }
  });

  it('preflights both sources and never moves canonical directories reached through linked parents', () => {
    const { home, sourceRoot, options } = fixture();
    fs.symlinkSync(path.dirname(sourceRoot), path.join(home, '.agents'), 'dir');
    const results = installClipsSkills(options);
    expect(results.filter(result => result.target.includes('/.agents/')).every(result => !result.changed)).toBe(true);
    for (const name of names) expect(fs.readFileSync(path.join(sourceRoot, name, 'SKILL.md'), 'utf8')).toContain('maintained');
    const second = fixture();
    fs.rmSync(path.join(second.sourceRoot, 'lane-manager'), { recursive: true });
    expect(() => installClipsSkills(second.options)).toThrow();
    expect(fs.existsSync(path.join(second.home, '.agents'))).toBe(false);
  });

  it('preserves both live skills during nested project/user init while other skills refresh', () => {
    const { home, project, sourceRoot, env, options } = fixture();
    installClipsSkills(options);
    for (const name of names) {
      const target = path.join(project, '.agents', 'skills', name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.symlinkSync(path.join(sourceRoot, name), target, 'dir');
    }
    const nested = path.join(project, 'nested'); fs.mkdirSync(nested);
    for (const scope of ['project', 'user']) {
      execFileSync(process.execPath, [cli, 'init', '--skills-scope', scope], { cwd: nested, env });
      const base = scope === 'project' ? project : home;
      for (const name of names) {
        const target = path.join(base, '.agents', 'skills', name);
        expect(fs.lstatSync(target).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe(`${name} maintained\n`);
      }
      expect(fs.readFileSync(path.join(base, '.agents', 'skills', 'loopz', 'SKILL.md'), 'utf8')).toContain('name: loopz');
    }
  });

  it('protects a Clips-only source checkout and rejects prod from nested shared worktrees before state writes', () => {
    const { project, env } = fixture();
    const source = path.join(project, '.agents', 'skills', 'clips'); fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: '@dfosco/clips' }));
    fs.writeFileSync(path.join(source, 'SKILL.md'), 'uncommitted Clips source\n');
    expect(isLiveSkill(source)).toBe(true);
    execFileSync(process.execPath, [cli, 'init', '--skills-scope', 'project'], { cwd: project, env });
    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toBe('uncommitted Clips source\n');
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture', '--quiet'], { cwd: project });
    const worktree = path.join(path.dirname(project), 'worktree');
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree], { cwd: project });
    const nested = path.join(worktree, 'nested'); fs.mkdirSync(nested);
    for (const cwd of [project, nested]) {
      const result = spawnSync(process.execPath, [cli, 'prod'], { cwd, env, encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Cannot refresh production skills over a live Clips source');
    }
    expect(fs.existsSync(path.join(env.CLIPS_HOME, 'installation.json'))).toBe(false);
    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toBe('uncommitted Clips source\n');
  });

  it('blocks stale saved-prod init over Clips-only user and custom project links without invoking it', () => {
    const { root, home, project, sourceRoot, env } = fixture();
    const custom = '.custom';
    const target = linkClips(project, sourceRoot, custom);
    const user = linkClips(home, sourceRoot);
    fs.mkdirSync(path.join(project, '.clips'), { recursive: true });
    fs.writeFileSync(path.join(project, '.clips', 'clips.config.json'), JSON.stringify({ agent_dir: custom }));
    const old = path.join(root, 'old'); fs.mkdirSync(path.join(old, 'src'), { recursive: true });
    fs.writeFileSync(path.join(old, 'package.json'), JSON.stringify({ name: '@dfosco/clips', type: 'module', version: '0.0.0' }));
    const marker = path.join(root, 'OLD-CLI-RAN');
    fs.writeFileSync(path.join(old, 'src', 'cli.js'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'ran');`);
    fs.mkdirSync(env.CLIPS_HOME, { recursive: true });
    const state = JSON.stringify({ mode: 'prod', dev_checkout: process.cwd(), prod_package: old });
    const stateFile = path.join(env.CLIPS_HOME, 'installation.json'); fs.writeFileSync(stateFile, state);
    const nested = path.join(project, 'nested'); fs.mkdirSync(nested);
    for (const args of [['init', '--global'], ['init', '--skills-scope', 'project'], ['prod']]) {
      const result = spawnSync(process.execPath, [cli, ...args], { cwd: nested, env, encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('live Clips source');
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.readFileSync(stateFile, 'utf8')).toBe(state);
    }
    for (const directory of [target, user]) {
      expect(fs.lstatSync(directory).isSymbolicLink()).toBe(true);
      expect(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8')).toBe('clips maintained\n');
    }
  });

  it('reconciles obsolete ordinary files without deleting either canonical live source', () => {
    const { project, sourceRoot } = fixture();
    const skills = path.join(project, '.agents', 'skills'); fs.mkdirSync(skills, { recursive: true });
    const previous = {};
    for (const name of names) {
      fs.symlinkSync(path.join(sourceRoot, name), path.join(skills, name), 'dir');
      previous[`${name}/SKILL.md`] = createHash('sha256').update(`${name} maintained\n`).digest('hex');
    }
    fs.mkdirSync(path.join(skills, 'loopz'));
    fs.writeFileSync(path.join(skills, 'loopz', 'obsolete.md'), 'obsolete');
    previous['loopz/obsolete.md'] = createHash('sha256').update('obsolete').digest('hex');
    reconcileSkills(project, previous, {});
    for (const name of names) expect(fs.readFileSync(path.join(sourceRoot, name, 'SKILL.md'), 'utf8')).toBe(`${name} maintained\n`);
    expect(fs.existsSync(path.join(skills, 'loopz', 'obsolete.md'))).toBe(false);
  });
});
