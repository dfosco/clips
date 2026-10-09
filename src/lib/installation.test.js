import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const devCli = path.resolve(process.cwd(), 'src/cli.js');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-installation-'));
  const project = path.join(root, 'project');
  const globalRoot = path.join(root, 'global', 'lib', 'node_modules');
  const installed = path.join(globalRoot, '@dfosco', 'clips');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(project, { recursive: true });
  fs.mkdirSync(path.join(installed, 'src'), { recursive: true });
  fs.mkdirSync(path.join(installed, '.agents', 'skills', 'clips'), { recursive: true });
  fs.mkdirSync(bin);
  execFileSync('git', ['init', '--quiet'], { cwd: project });
  fs.writeFileSync(path.join(installed, 'package.json'), JSON.stringify({ name: '@dfosco/clips', version: '1.3.2', type: 'module' }));
  fs.writeFileSync(path.join(installed, '.agents', 'skills', 'clips', 'SKILL.md'), 'prod skill 1.3.2\n');
  fs.writeFileSync(path.join(installed, 'src', 'cli.js'), `import fs from 'node:fs';
import path from 'node:path';
const command = process.argv[2];
if (command === 'init') {
  const target = path.join(process.cwd(), '.agents', 'skills', 'clips');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'SKILL.md'), 'prod skill 1.3.2\\n');
} else if (command === '--version') console.log('clips v1.3.2');
else console.log('prod:' + process.argv.slice(2).join(' '));
`);
  fs.writeFileSync(path.join(bin, 'npm'), `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const globalPath = path.join(process.env.FAKE_GLOBAL_ROOT, '@dfosco', 'clips');
fs.appendFileSync(process.env.FAKE_NPM_LOG, process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] === 'root' && process.argv[3] === '-g') console.log(process.env.FAKE_GLOBAL_ROOT);
else if (process.argv[2] === 'link') {
  fs.rmSync(globalPath, { recursive: true, force: true });
  fs.symlinkSync(process.cwd(), globalPath, 'dir');
} else process.exit(2);
`);
  fs.chmodSync(path.join(bin, 'npm'), 0o755);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    CLIPS_HOME: path.join(root, 'home'),
    FAKE_GLOBAL_ROOT: globalRoot,
    FAKE_NPM_LOG: path.join(root, 'npm.log'),
  };
  return { root, project, globalRoot, env };
}

describe('local installation switching', () => {
  it('retains the npm package offline, routes prod commands, and refreshes skills in both modes', () => {
    const { root, project, globalRoot, env } = fixture();
    try {
      execFileSync(process.execPath, [devCli, 'dev', '--project', project], { cwd: root, env });
      const statePath = path.join(env.CLIPS_HOME, 'installation.json');
      let state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      expect(state.mode).toBe('dev');
      expect(fs.realpathSync(path.join(globalRoot, '@dfosco', 'clips'))).toBe(path.resolve(process.cwd()));
      expect(fs.readFileSync(path.join(project, '.agents', 'skills', 'clips', 'SKILL.md'), 'utf8')).toContain('Skill: clips');
      expect(fs.readdirSync(path.join(project, '.agents', 'skills'))).toEqual(['clips']);
      expect(fs.existsSync(path.join(state.prod_package, 'src', 'cli.js'))).toBe(true);

      execFileSync(process.execPath, [devCli, 'prod'], { cwd: project, env });
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      expect(state.mode).toBe('prod');
      expect(fs.readFileSync(path.join(project, '.agents', 'skills', 'clips', 'SKILL.md'), 'utf8')).toBe('prod skill 1.3.2\n');
      expect(fs.existsSync(path.join(project, '.agents', 'skills', 'clips-frame-goal', 'SKILL.md'))).toBe(false);
      expect(execFileSync(process.execPath, [devCli, '--version'], { cwd: project, env, encoding: 'utf8' }).trim()).toBe('clips v1.3.2');

      execFileSync(process.execPath, [devCli, 'dev'], { cwd: project, env });
      expect(JSON.parse(fs.readFileSync(statePath, 'utf8')).mode).toBe('dev');
      expect(fs.readFileSync(path.join(project, '.agents', 'skills', 'clips', 'SKILL.md'), 'utf8')).toContain('Skill: clips');
      expect(fs.readdirSync(path.join(project, '.agents', 'skills'))).toEqual(['clips']);
      expect(fs.readFileSync(env.FAKE_NPM_LOG, 'utf8').trim().split('\n')).toEqual(['root -g', 'link', 'root -g', 'root -g']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 15000);

  it('fails before linking when no local npm installation can be saved', () => {
    const { root, project, globalRoot, env } = fixture();
    try {
      fs.rmSync(path.join(globalRoot, '@dfosco', 'clips'), { recursive: true });
      const result = spawnSync(process.execPath, [devCli, 'dev'], { cwd: project, env, encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('No locally installed npm package');
      expect(fs.existsSync(path.join(env.CLIPS_HOME, 'installation.json'))).toBe(false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
