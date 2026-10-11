import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const cli = path.resolve(process.cwd(), 'src/cli.js');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-lane-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  fs.mkdirSync(path.join(root, '.clips', 'db'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), '{"collaboration":false}\n');
  return root;
}

function run(root, ...args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' },
  }));
}

describe('lanes', () => {
  it('creates strategic lanes without technical acceptance criteria and uses #l refs', () => {
    const root = workspace();
    try {
      expect(run(root, 'lane', 'create', '{"title":"Workspace experience","description":"Make workspace selection coherent","product_goals":["Fast return to work"]}')).toEqual({ success: true, lane_id: 'l001' });
      const lane = run(root, 'lane', 'show', '#l1');
      expect(lane).toMatchObject({ lane_id: 'l001', title: 'Workspace experience', product_goals: ['Fast return to work'], status: 'open' });
      expect(lane.revision).toBeGreaterThanOrEqual(1);
      const bad = spawnSync(process.execPath, [cli, 'lane', 'create', '{"title":"Wrong","acceptance_criteria":["Technical gate"]}'], {
        cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' },
      });
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain('Lanes do not use technical acceptance criteria');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('assigns goals to lanes while preserving legacy track storage', () => {
    const root = workspace();
    try {
      run(root, 'lane', 'create', '{"title":"First"}');
      run(root, 'lane', 'create', '{"title":"Second"}');
      run(root, 'goal', 'create', '{"title":"Goal one","lane_id":"l001"}');
      expect(run(root, 'goal', 'show', 'g1')).toMatchObject({ lane_id: 'l001', track_id: 'r001' });
      expect(run(root, 'lane', 'l2', 'add', 'g1')).toMatchObject({ lane_id: 'l002', moved: [{ goal_id: 'g001', from_lane_id: 'l001' }] });
      expect(run(root, 'lane', 'show', 'l2').goals.map((goal) => goal.goal_id)).toEqual(['g001']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('closes with a strategic retrospective and captures decisions, system components, media and goal states', () => {
    const root = workspace();
    try {
      run(root, 'lane', 'create', '{"title":"Workspace improvements","product_goals":["Restore context after reload"]}');
      run(root, 'component', 'create', '{"title":"Workspace preference","responsibility":"Persist workspace choice"}');
      run(root, 'goal', 'create', '{"title":"Restore workspace","lane_id":"l1","decisions":"Persist a stable workspace ID.","components":["#c1"]}');
      run(root, 'task', 'create', 'g1', '{"title":"Persist workspace","components":["#c1"]}');
      const closed = run(root, 'lane', 'close', 'l1', JSON.stringify({
        summary: 'The workspace now has a coherent return path.',
        decision_log: 'Across the goals we standardized on stable workspace IDs.',
        system_overview: 'Workspace preference is the persistence boundary for selection state.',
        product_goals_achieved: ['Users return to the intended workspace after reload'],
        media: [{ src: 'screenshots/workspace-restored.png', caption: 'Restored workspace' }],
      }));
      expect(closed.status).toBe('closed');
      expect(closed.closure.components).toContain('#c1');
      expect(closed.closure.goal_decisions[0].decisions).toContain('stable workspace ID');
      expect(closed.closure.media[0].src).toContain('workspace-restored.png');
      expect(run(root, 'lane', 'show', '#l1').closure.product_goals_achieved).toHaveLength(1);
      expect(run(root, 'lane', 'history', '#l1').at(-1)).toMatchObject({ event: 'lane_closed' });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('reads legacy #r track state as a lane alias', () => {
    const root = workspace();
    try {
      fs.mkdirSync(path.join(root, '.clips', 'db', 'tracks'), { recursive: true });
      fs.writeFileSync(path.join(root, '.clips', 'db', 'tracks', 'r001.jsonl'), '{"event":"track_created","title":"Legacy migration","description":"Old frame","status":"open"}\n');
      run(root, 'goal', 'create', '{"title":"Old goal","track_id":"r001"}');
      expect(run(root, 'lane', 'show', '#l1')).toMatchObject({ lane_id: 'l001', legacy_track_id: 'r001', title: 'Legacy migration' });
      expect(run(root, 'goal', 'show', 'g1')).toMatchObject({ lane_id: 'l001', track_id: 'r001' });
      const view = execFileSync(process.execPath, [cli, 'view', '#l1'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } });
      expect(view).toContain('Legacy migration');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
