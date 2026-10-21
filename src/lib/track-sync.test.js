import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const syncUrl = pathToFileURL(path.resolve(process.cwd(), 'src/lib/sync.js')).href;
const tracksUrl = pathToFileURL(path.resolve(process.cwd(), 'src/lib/tracks.js')).href;
const roots = [];

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lanes-track-sync-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/app.git'], { cwd: root });
  const db = path.join(root, '.clips', 'db');
  fs.mkdirSync(path.join(db, 'tracks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), '{"collaboration":true}\n');
  fs.writeFileSync(path.join(db, 'tracks', 'r001.jsonl'), [
    { event: 'track_created', track_id: 'r001', title: 'Migration', status: 'open' },
    { event: 'lane_github_synced', track_id: 'r001', lane_id: 'l001', issue_number: 10,
      issue_url: 'https://github.com/acme/app/issues/10', repository: 'acme/app', remote_host: 'github.com' },
  ].map(JSON.stringify).join('\n') + '\n');
  fs.writeFileSync(path.join(db, 'g001.jsonl'), [
    { event: 'goal_created', goal_id: 'g001', title: 'First', status: 'open', track_id: 'r001' },
    { event: 'github_synced', goal_id: 'g001', issue_number: 11,
      issue_url: 'https://github.com/acme/app/issues/11', repository: 'acme/app', remote_host: 'github.com' },
  ].map(JSON.stringify).join('\n') + '\n');

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'gh.log');
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
printf "%s\\n" "$*" >> "$GH_LOG"
case "$*" in
  "api repos/acme/app/issues/11") echo '{"id":111,"number":11,"state":"open"}';;
  "api repos/acme/app/issues/10") echo '{"id":110,"number":10,"state":"open"}';;
  "api repos/acme/app/issues/11/parent")
    if [ -n "$GH_PARENT" ]; then
      id=\${GH_PARENT_ID:-$((GH_PARENT + 100))}
      echo "{\\"number\\":$GH_PARENT,\\"id\\":$id,\\"html_url\\":\\"https://github.com/acme/app/issues/$GH_PARENT\\"}"
    else echo "HTTP 404: Not Found" >&2; exit 1; fi;;
  "api -X POST repos/acme/app/issues/10/sub_issues"*)
    if [ -n "$GH_UNSUPPORTED" ]; then echo "HTTP 404: Sub-issues are not supported for this repository" >&2; exit 1; fi
    if [ -n "$GH_MUTATION_404" ]; then echo "HTTP 404: Not Found" >&2; exit 1; fi
    echo '{}';;
  "api -X DELETE repos/acme/app/issues/10/sub_issues"*) echo '{}';;
  *) echo '{}';;
esac
`);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  const env = {
    ...process.env,
    HOME: path.join(root, 'home'),
    LANES_HOME: path.join(root, 'home', '.lanes'),
    CLIPS_HOME: path.join(root, 'home', '.clips'),
    PATH: `${bin}:${process.env.PATH}`,
    GH_LOG: log,
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  return { root, bin, log, env };
}

function reconcile(root, env, extras = '') {
  const source = `import { reconcileGoalParent } from ${JSON.stringify(syncUrl)}; console.log(JSON.stringify(reconcileGoalParent('g001')));`;
  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root,
    env: { ...env, ...Object.fromEntries(extras.split(/\s+/).filter(Boolean).map((pair) => pair.split('='))) },
    encoding: 'utf8',
  }));
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('Lane, Goal, and Task GitHub hierarchy', () => {
  it('creates a native sub-issue link and preserves remote identity in Track replay', () => {
    const { root, log, env } = workspace();
    const result = reconcile(root, env);
    expect(result).toMatchObject({ changed: true });
    expect(fs.readFileSync(log, 'utf8')).toContain(
      'api -X POST repos/acme/app/issues/10/sub_issues -F sub_issue_id=111 -F replace_parent=false',
    );
    const source = `import { readTrack } from ${JSON.stringify(tracksUrl)}; console.log(JSON.stringify(readTrack('r001')));`;
    const track = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root, env, encoding: 'utf8',
    }));
    expect(track).toMatchObject({ repository: 'acme/app', remote_host: 'github.com', issue_number: 10 });
  });

  it('does not replace an unrelated external parent', () => {
    const { root, log, env } = workspace();
    const result = reconcile(root, env, 'GH_PARENT=12');
    expect(result).toMatchObject({ preserved: true, reason: 'external_parent' });
    expect(fs.readFileSync(log, 'utf8')).not.toContain('api -X POST');
    expect(fs.readFileSync(log, 'utf8')).not.toContain('replace_parent=true');
  });

  it('reports unsupported sub-issues and leaves linked-checkbox fallback available', () => {
    const { root, log, env } = workspace();
    const result = reconcile(root, env, 'GH_UNSUPPORTED=1');
    expect(result).toMatchObject({ unsupported: true, fallback: 'linked_checklist' });
    expect(fs.readFileSync(log, 'utf8')).toContain('api -X POST');
  });

  it('does not treat an ambiguous 404 from a sub-issue mutation as unsupported', () => {
    const { root, env } = workspace();
    const source = `import { reconcileGoalParent } from ${JSON.stringify(syncUrl)}; try { reconcileGoalParent('g001'); } catch (error) { console.log(JSON.stringify({ message: error.message, status: error.httpStatus })); }`;
    const result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '--eval', source], {
      cwd: root,
      env: { ...env, GH_MUTATION_404: '1' },
      encoding: 'utf8',
    }));
    expect(result).toMatchObject({ message: 'HTTP 404: Not Found', status: 404 });
  });

  it('does not treat a colliding parent number with a different global issue ID as the managed parent', () => {
    const { root, log, env } = workspace();
    const result = reconcile(root, env, 'GH_PARENT=10 GH_PARENT_ID=999');
    expect(result).toMatchObject({ preserved: true, reason: 'external_parent' });
    expect(fs.readFileSync(log, 'utf8')).not.toContain('replace_parent=true');
    expect(fs.readFileSync(log, 'utf8')).not.toContain('api -X POST');
  });

  it('only removes a prior parent when it is another managed Lane', () => {
    const { root, log, env } = workspace();
    const file = path.join(root, '.clips', 'db', 'g001.jsonl');
    fs.appendFileSync(file, `${JSON.stringify({ event: 'updated', goal_id: 'g001', track_id: null })}\n`);
    const result = reconcile(root, env, 'GH_PARENT=10');
    expect(result).toMatchObject({ changed: true });
    expect(fs.readFileSync(log, 'utf8')).toContain(
      'api -X DELETE repos/acme/app/issues/10/sub_issues -F sub_issue_id=111',
    );
  });
});
