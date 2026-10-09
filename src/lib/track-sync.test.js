import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const syncUrl = pathToFileURL(path.resolve(process.cwd(), 'src/lib/sync.js')).href;

describe('track GitHub hierarchy', () => {
  it('creates a native sub-issue link and leaves the local events intact', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-track-sync-'));
    try {
      execFileSync('git', ['init', '--quiet'], { cwd: root });
      execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/app.git'], { cwd: root });
      const db = path.join(root, '.clips', 'db');
      fs.mkdirSync(path.join(db, 'tracks'), { recursive: true });
      fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), '{"collaboration":true}\n');
      fs.writeFileSync(path.join(db, 'tracks', 'r001.jsonl'), [
        { event: 'track_created', title: 'Migration', status: 'open' },
        { event: 'track_github_synced', issue_number: 10, issue_url: 'https://github.com/acme/app/issues/10' },
      ].map(JSON.stringify).join('\n') + '\n');
      fs.writeFileSync(path.join(db, 'g001.jsonl'), [
        { event: 'goal_created', goal_id: 'g001', title: 'First', status: 'open', track_id: 'r001' },
        { event: 'github_synced', issue_number: 11, issue_url: 'https://github.com/acme/app/issues/11' },
      ].map(JSON.stringify).join('\n') + '\n');
      const bin = path.join(root, 'bin');
      fs.mkdirSync(bin);
      const log = path.join(root, 'gh.log');
      fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$GH_LOG"\ncase "$*" in\n  "api repos/acme/app/issues/11/parent") if [ -n "$GH_PARENT" ]; then printf \'{"number":%s}\\n\' "$GH_PARENT"; else echo "Not Found" >&2; exit 1; fi;;\n  "api repos/acme/app/issues/11") echo \'{"id":111,"state":"open"}\';;\n  "api repos/acme/app/issues/10") echo \'{"id":110,"state":"open"}\';;\n  *) echo \'{}\';;\nesac\n');
      fs.chmodSync(path.join(bin, 'gh'), 0o755);
      execFileSync(process.execPath, ['--input-type=module', '--eval', `import { reconcileGoalParent } from ${JSON.stringify(syncUrl)}; reconcileGoalParent('g001');`], {
        cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: log },
      });
      expect(fs.readFileSync(log, 'utf8')).toContain('api -X POST repos/acme/app/issues/10/sub_issues -F sub_issue_id=111 -F replace_parent=false');
      execFileSync(process.execPath, ['--input-type=module', '--eval', `import { reconcileGoalParent } from ${JSON.stringify(syncUrl)}; reconcileGoalParent('g001');`], {
        cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: log, GH_PARENT: '12' },
      });
      expect(fs.readFileSync(log, 'utf8')).toContain('api -X POST repos/acme/app/issues/10/sub_issues -F sub_issue_id=111 -F replace_parent=true');
      fs.appendFileSync(path.join(db, 'g001.jsonl'), `${JSON.stringify({ event: 'updated', track_id: null })}\n`);
      execFileSync(process.execPath, ['--input-type=module', '--eval', `import { reconcileGoalParent } from ${JSON.stringify(syncUrl)}; reconcileGoalParent('g001');`], {
        cwd: root, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_LOG: log, GH_PARENT: '10' },
      });
      expect(fs.readFileSync(log, 'utf8')).toContain('api -X DELETE repos/acme/app/issues/10/sub_issues -F sub_issue_id=111');
      expect(fs.readFileSync(path.join(db, 'g001.jsonl'), 'utf8')).toContain('"track_id":"r001"');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
