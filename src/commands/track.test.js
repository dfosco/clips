import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { readBoardData } from '../lib/board.js';

const cli = path.resolve(process.cwd(), 'src/cli.js');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-track-'));
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  fs.mkdirSync(path.join(root, '.clips', 'db'), { recursive: true });
  fs.writeFileSync(path.join(root, '.clips', 'clips.config.json'), '{"collaboration":false}\n');
  return root;
}

function run(root, ...args) {
  return JSON.parse(execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } }));
}

describe('tracks', () => {
  it('shows track descriptions and structured goal membership in view', () => {
    const root = workspace();
    try {
      run(root, 'track', 'create', '{"title":"Migration","description":"Move modules incrementally","acceptance_criteria":["Modules compile"]}');
      const empty = execFileSync(process.execPath, [cli, 'view', '#r001'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } });
      expect(empty).toContain('Move modules incrementally');
      expect(empty).toContain('Modules compile');
      expect(empty).toContain('Goals (0)');
      expect(empty).toContain('None yet');
      run(root, 'goal', 'create', '{"title":"Convert core","track_id":"r001"}');
      const detail = execFileSync(process.execPath, [cli, 'view', '#r001'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } });
      expect(detail).toContain('Goals (1)');
      expect(detail).toContain('#g001');
      expect(detail).toContain('Convert core');
      const overview = execFileSync(process.execPath, [cli, 'view'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } });
      expect(overview).toContain('Move modules incrementally');
      expect(overview).toContain('Goals (1)');
      const missing = spawnSync(process.execPath, [cli, 'view', '#r999'], { cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } });
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('Track #r999 not found');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('adds shorthand goal refs in bulk, skips repeats, and moves goals between tracks', () => {
    const root = workspace();
    try {
      const first = run(root, 'track', 'create', '{"title":"First"}');
      const second = run(root, 'track', 'create', '{"title":"Second"}');
      for (let index = 1; index <= 10; index++) run(root, 'goal', 'create', JSON.stringify({ title: `Goal ${index}` }));
      expect(run(root, 'track', 'r01', 'add', 'g01', 'g02', 'g010', 'g01')).toMatchObject({
        track_id: first.track_id, added: ['g001', 'g002', 'g010'], unchanged: [], moved: [],
      });
      const eventPath = path.join(root, '.clips', 'db', 'g001.jsonl');
      const before = fs.readFileSync(eventPath, 'utf8');
      expect(run(root, 'track', 'r1', 'add', 'g1')).toMatchObject({ added: [], unchanged: ['g001'] });
      expect(fs.readFileSync(eventPath, 'utf8')).toBe(before);
      expect(run(root, 'track', 'r02', 'add', 'g1')).toMatchObject({
        track_id: second.track_id, added: ['g001'], moved: [{ goal_id: 'g001', from_track_id: first.track_id }],
      });
      expect(run(root, 'track', 'show', first.track_id).goals.map((goal) => goal.goal_id)).toEqual(['g002', 'g010']);
      expect(readBoardData({ dbDir: path.join(root, '.clips', 'db') }).tracks.find((track) => track.track_id === second.track_id).goal_refs).toEqual(['#g001']);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 15000);

  it('validates every goal before changing membership', () => {
    const root = workspace();
    try {
      run(root, 'track', 'create', '{"title":"First"}');
      run(root, 'goal', 'create', '{"title":"Goal"}');
      const eventPath = path.join(root, '.clips', 'db', 'g001.jsonl');
      const before = fs.readFileSync(eventPath, 'utf8');
      for (const invalid of ['g999', 'bad']) {
        const result = spawnSync(process.execPath, [cli, 'track', 'r1', 'add', 'g1', invalid], { cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } });
        expect(result.status).not.toBe(0);
        expect(fs.readFileSync(eventPath, 'utf8')).toBe(before);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('replays tracks, assigns goals, and exposes board progress without migrating old goals', () => {
    const root = workspace();
    try {
      const legacy = run(root, 'goal', 'create', '{"title":"Existing goal"}');
      const track = run(root, 'track', 'create', '{"title":"TypeScript migration","acceptance_criteria":["Core compiles"]}');
      expect(track.track_id).toBe('r001');
      const goal = run(root, 'goal', 'create', JSON.stringify({ title: 'Convert core', track_id: track.track_id, blocked_by: [legacy.goal_id] }));
      expect(run(root, 'track', 'show', track.track_id)).toMatchObject({ goal_count: 1, completed_goal_count: 0 });
      const board = readBoardData({ dbDir: path.join(root, '.clips', 'db') });
      expect(board.tracks[0].goal_refs).toEqual([`#${goal.goal_id}`]);
      expect(board.goals.find((item) => item.goal_id === legacy.goal_id).track_id).toBeNull();
      expect(board.goals.find((item) => item.goal_id === goal.goal_id).blocked_by).toEqual([legacy.goal_id]);
      run(root, 'goal', 'assign', goal.goal_id, 'none');
      expect(run(root, 'track', 'show', track.track_id).goal_count).toBe(0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects missing goals, self-dependencies, and cycles', () => {
    const root = workspace();
    try {
      run(root, 'goal', 'create', '{"title":"First"}');
      run(root, 'goal', 'create', '{"title":"Second"}');
      run(root, 'goal', 'update', 'g002', '{"blocked_by":["g001"]}');
      for (const refs of [['g999'], ['g001'], ['g002']]) {
        const target = refs[0] === 'g001' ? 'g001' : 'g001';
        const result = spawnSync(process.execPath, [cli, 'goal', 'update', target, JSON.stringify({ blocked_by: refs })], { cwd: root, encoding: 'utf8', env: { ...process.env, CLIPS_SWITCH_INIT: '1' } });
        expect(result.status).not.toBe(0);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
