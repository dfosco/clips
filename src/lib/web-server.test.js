import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebServer, parseWebArgs } from './web-server.js';
import { registerProject } from './registry.js';

const tempDirs = [];
const servers = [];
const originalClipsHome = process.env.CLIPS_HOME;

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeProject(name) {
  const root = path.join(tempDir('clips-web-project-'), name);
  fs.mkdirSync(path.join(root, '.clips', 'db'), { recursive: true });
  fs.mkdirSync(path.join(root, '.clips', 'records', 'cr'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), '{}\n');
  fs.writeFileSync(path.join(root, '.clips', 'db', 'g001.jsonl'), `${JSON.stringify({ event: 'goal_created', goal_id: 'g001', title: `${name} goal` })}\n`);
  return root;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
  if (originalClipsHome === undefined) delete process.env.CLIPS_HOME;
  else process.env.CLIPS_HOME = originalClipsHome;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('web server', () => {
  it('parses supported host and port options', () => {
    expect(parseWebArgs(['--host', '0.0.0.0', '--port=0'])).toEqual({ host: '0.0.0.0', port: 0 });
    expect(() => parseWebArgs(['--open'])).toThrow('Unknown web option');
  });

  it('serves packaged assets and all registered projects outside a repository', async () => {
    process.env.CLIPS_HOME = tempDir('clips-web-home-');
    const first = makeProject('alpha');
    const second = makeProject('beta');
    registerProject(first);
    registerProject(second);
    const assetsDir = tempDir('clips-assets-');
    fs.writeFileSync(path.join(assetsDir, 'index.html'), '<main>Clips board</main>');

    const server = createWebServer({ assetsDir, cwd: os.tmpdir() });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    const page = await fetch(`http://127.0.0.1:${port}/`);
    expect(await page.text()).toContain('Clips board');
    const response = await fetch(`http://127.0.0.1:${port}/api/board`);
    const board = await response.json();
    expect(board.scope).toBe('all');
    expect(board.projects.map((project) => project.id)).toEqual(['alpha', 'beta']);
    expect(board.goals.map((goal) => goal.ref)).toEqual(['alpha#g001', 'beta#g001']);

    const selected = await fetch(`http://127.0.0.1:${port}/api/board?project=beta`).then((result) => result.json());
    expect(selected.goals.map((goal) => goal.ref)).toEqual(['beta#g001']);
  });

  it('defaults to the current initialized repository when launched inside it', async () => {
    process.env.CLIPS_HOME = tempDir('clips-web-home-');
    const first = makeProject('alpha');
    const second = makeProject('beta');
    execFileSync('git', ['init', '--quiet'], { cwd: first });
    registerProject(first);
    registerProject(second);
    const assetsDir = tempDir('clips-assets-');
    fs.writeFileSync(path.join(assetsDir, 'index.html'), '<main>Clips board</main>');

    const server = createWebServer({ assetsDir, cwd: first });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    const board = await fetch(`http://127.0.0.1:${port}/api/board`).then((response) => response.json());

    expect(board.scope).toBe('local');
    expect(board.default_project_ids).toEqual(['alpha']);
    expect(board.goals.map((goal) => goal.ref)).toEqual(['alpha#g001']);
    expect(board.projects.map((project) => project.id)).toEqual(['alpha', 'beta']);
  });
});
