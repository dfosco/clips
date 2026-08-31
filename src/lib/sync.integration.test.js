import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const syncModuleUrl = pathToFileURL(path.resolve(process.cwd(), 'src', 'lib', 'sync.js')).href;
const tempDirs = [];

function createWorkspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-sync-type-'));
  tempDirs.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  fs.mkdirSync(path.join(cwd, '.clips', 'db'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.clips', 'records', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.clips', 'clips.config.json'), `${JSON.stringify({ collaboration: false })}\n`);
  return cwd;
}

function importIssue(cwd, issue) {
  execFileSync(process.execPath, [
    '--input-type=module',
    '--eval',
    `import { importIssue } from ${JSON.stringify(syncModuleUrl)}; importIssue(${JSON.stringify(issue)});`,
  ], { cwd });
}

function showGoal(cwd, goalId) {
  return JSON.parse(execFileSync(process.execPath, [cliPath, 'goal', 'show', goalId], { cwd, encoding: 'utf8' }));
}

afterEach(() => {
  for (const cwd of tempDirs.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('typed goal issue import', () => {
  it('preserves planning metadata without importing checkboxes as tasks', () => {
    const cwd = createWorkspace();
    importIssue(cwd, {
      number: 1,
      title: 'Choose storage',
      body: '## Goal Type\n\n`planning`\n\n## ADR\n\n`ADR-004`\n\n- [ ] Compare databases',
      state: 'CLOSED',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T01:00:00.000Z',
    });

    expect(showGoal(cwd, 'g001')).toMatchObject({
      type: 'planning',
      adr_id: 'ADR-004',
      status: 'open',
      tasks: [],
    });

    fs.writeFileSync(path.join(cwd, '.clips', 'records', 'adr', 'ADR-004-storage.md'), '# ADR-004: Storage\n');
    execFileSync(process.execPath, [cliPath, 'goal', 'status', 'g001', 'closed'], { cwd });
    expect(showGoal(cwd, 'g001').status).toBe('closed');
  });

  it('only imports a closed building state when tasks exist', () => {
    const cwd = createWorkspace();
    importIssue(cwd, {
      number: 1,
      title: 'Empty build',
      body: '## Goal Type\n\n`building`',
      state: 'CLOSED',
      createdAt: '2026-08-31T00:00:00.000Z',
    });
    importIssue(cwd, {
      number: 2,
      title: 'Build import',
      body: '## Goal Type\n\n`building`\n\n- [x] Implement importer',
      state: 'CLOSED',
      createdAt: '2026-08-31T00:00:00.000Z',
    });

    expect(showGoal(cwd, 'g001').status).toBe('open');
    expect(showGoal(cwd, 'g002')).toMatchObject({ type: 'building', status: 'closed' });
    expect(showGoal(cwd, 'g002').tasks).toHaveLength(1);
  });

  it('reopens a remotely closed issue when the local goal is open but incomplete', () => {
    const cwd = createWorkspace();
    fs.writeFileSync(path.join(cwd, '.clips', 'clips.config.json'), `${JSON.stringify({ collaboration: true })}\n`);
    fs.writeFileSync(path.join(cwd, '.clips', 'db', 'g001.jsonl'), `${[
      { event: 'goal_created', goal_id: 'g001', title: 'Choose storage', type: 'planning', status: 'open' },
      { event: 'github_synced', goal_id: 'g001', issue_number: 7, issue_url: 'https://github.com/acme/app/issues/7' },
    ].map((event) => JSON.stringify(event)).join('\n')}\n`);
    const binDir = path.join(cwd, 'bin');
    const markerPath = path.join(cwd, 'gh-calls');
    fs.mkdirSync(binDir);
    const ghPath = path.join(binDir, 'gh');
    fs.writeFileSync(ghPath, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$MARKER_PATH"\nif [ "$1" = "issue" ] && [ "$2" = "view" ]; then printf "{\\"state\\":\\"CLOSED\\"}\\n"; fi\n');
    fs.chmodSync(ghPath, 0o755);

    execFileSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `import { pushGoal } from ${JSON.stringify(syncModuleUrl)}; pushGoal('g001');`,
    ], {
      cwd,
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, MARKER_PATH: markerPath },
    });

    expect(fs.readFileSync(markerPath, 'utf8')).toContain('issue reopen 7');
  });
});
