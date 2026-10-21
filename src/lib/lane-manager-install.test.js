import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { installLaneManager } from '../../scripts/install-lane-manager.js';
import { reconcileSkills } from './installation.js';

const cli = path.resolve('src/cli.js');
const roots = [];
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-live-manager-'));
  roots.push(root);
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  const source = path.join(root, 'source');
  for (const dir of [home, project, source]) fs.mkdirSync(dir);
  execFileSync('git', ['init', '--quiet'], { cwd: project });
  fs.writeFileSync(path.join(source, 'SKILL.md'), 'maintained source\n');
  const env = { ...process.env, LANES_HOME: '', HOME: home, CODEX_HOME: path.join(home, '.codex'), CLIPS_HOME: path.join(home, '.clips') };
  return { root, home, project, source, env };
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('live Lane Manager installation', () => {
  it('backs up replaced copies, is repeatable, and exposes future source changes through both paths', () => {
    const { home, source } = fixture();
    const target = path.join(home, '.agents', 'skills', 'lane-manager');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'previous skill\n');
    const options = { home, source, codexHome: path.join(home, '.codex'), backupRoot: path.join(home, 'backups') };
    const first = installLaneManager(options);
    expect(fs.readFileSync(path.join(first[0].backup, 'SKILL.md'), 'utf8')).toBe('previous skill\n');
    expect(installLaneManager(options).every(result => !result.changed)).toBe(true);
    fs.writeFileSync(path.join(source, 'SKILL.md'), 'revised maintained source\n');
    for (const result of first) {
      expect(fs.lstatSync(result.target).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(result.target)).toBe(fs.realpathSync(source));
      expect(fs.readFileSync(path.join(result.target, 'SKILL.md'), 'utf8')).toBe('revised maintained source\n');
    }
  });

  it('preserves project and global links during init while other skills still refresh', () => {
    const { home, project, source, env } = fixture();
    const manager = path.join(project, '.agents', 'skills', 'lane-manager');
    fs.mkdirSync(path.dirname(manager), { recursive: true });
    fs.symlinkSync(source, manager, 'dir');
    installLaneManager({ home, source, codexHome: env.CODEX_HOME, backupRoot: path.join(home, 'backups') });
    for (const scope of ['project', 'user']) {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        execFileSync(process.execPath, [cli, 'init', '--skills-scope', scope], { cwd: project, env });
        const base = scope === 'user' ? home : project;
        const skills = path.join(base, '.agents', 'skills');
        expect(fs.lstatSync(path.join(skills, 'lane-manager')).isSymbolicLink()).toBe(true);
        expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toBe('maintained source\n');
        expect(fs.readFileSync(path.join(skills, 'lanes', 'SKILL.md'), 'utf8')).toContain(repeat ? 'stale unrelated skill' : 'name: lanes');
        fs.writeFileSync(path.join(skills, 'lanes', 'SKILL.md'), 'stale unrelated skill\n');
      }
    }
  });

  it('protects source checkouts and refuses older prod refresh before npm or state writes', () => {
    const { project, env } = fixture();
    const manager = path.join(project, '.agents', 'skills', 'lane-manager');
    fs.mkdirSync(manager, { recursive: true });
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: '@dfosco/clips' }));
    fs.writeFileSync(path.join(manager, 'SKILL.md'), 'uncommitted source\n');
    execFileSync(process.execPath, [cli, 'init', '--skills-scope', 'project'], { cwd: project, env });
    expect(fs.readFileSync(path.join(manager, 'SKILL.md'), 'utf8')).toBe('uncommitted source\n');
    const result = spawnSync(process.execPath, [cli, 'prod'], { cwd: project, env, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Cannot refresh production skills over a live (Lanes|Lane Manager) source/);
    expect(fs.existsSync(path.join(env.CLIPS_HOME, 'installation.json'))).toBe(false);
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'fixture', '--quiet'], { cwd: project });
    const worktree = path.join(path.dirname(project), 'worktree');
    execFileSync('git', ['worktree', 'add', '--detach', '--quiet', worktree], { cwd: project });
    const nested = path.join(worktree, 'nested');
    fs.mkdirSync(nested);
    const nestedResult = spawnSync(process.execPath, [cli, 'prod'], { cwd: nested, env, encoding: 'utf8' });
    expect(nestedResult.status).not.toBe(0);
    expect(nestedResult.stderr).toMatch(/Cannot refresh production skills over a live (Lanes|Lane Manager) source/);
    expect(fs.existsSync(path.join(env.CLIPS_HOME, 'installation.json'))).toBe(false);
    expect(fs.readFileSync(path.join(manager, 'SKILL.md'), 'utf8')).toBe('uncommitted source\n');
  });

  it('reconciliation never removes canonical files through a live link but removes stale ordinary files', () => {
    const { project, source } = fixture();
    const skills = path.join(project, '.agents', 'skills');
    fs.mkdirSync(path.join(skills, 'clips'), { recursive: true });
    fs.symlinkSync(source, path.join(skills, 'lane-manager'), 'dir');
    fs.writeFileSync(path.join(skills, 'clips', 'obsolete.md'), 'obsolete\n');
    const digest = text => createHash('sha256').update(text).digest('hex');
    reconcileSkills(project, {
      'lane-manager/SKILL.md': digest('maintained source\n'),
      'clips/obsolete.md': digest('obsolete\n'),
    }, {});
    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toBe('maintained source\n');
    expect(fs.lstatSync(path.join(skills, 'lane-manager')).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(skills, 'clips', 'obsolete.md'))).toBe(false);
  });

  it('does not dispatch global init to an older production CLI over a live user source', () => {
    const { home, project, source, env } = fixture();
    installLaneManager({ home, source, codexHome: env.CODEX_HOME, backupRoot: path.join(home, 'backups') });
    fs.mkdirSync(env.CLIPS_HOME, { recursive: true });
    fs.writeFileSync(path.join(env.CLIPS_HOME, 'installation.json'), JSON.stringify({
      mode: 'prod', dev_checkout: process.cwd(), prod_package: '/does-not-exist',
    }));
    const result = spawnSync(process.execPath, [cli, 'init', '--global'], { cwd: project, env, encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Preserved live source');
    expect(fs.lstatSync(path.join(home, '.agents', 'skills', 'lane-manager')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toBe('maintained source\n');
    const manager = path.join(project, '.agents', 'skills', 'lane-manager');
    fs.mkdirSync(path.dirname(manager), { recursive: true });
    fs.symlinkSync(source, manager, 'dir');
    const nested = path.join(project, 'nested');
    fs.mkdirSync(nested);
    const nestedResult = spawnSync(process.execPath, [cli, 'init', '--skills-scope', 'project'], { cwd: nested, env, encoding: 'utf8' });
    expect(nestedResult.status).toBe(0);
    expect(nestedResult.stdout).toContain('Preserved live source');
    expect(fs.readFileSync(path.join(source, 'SKILL.md'), 'utf8')).toBe('maintained source\n');
  });
});
