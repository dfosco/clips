import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBoardData } from './board.js';

const tempDirs = [];

function makeDb(files) {
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-board-'));
  tempDirs.push(dbDir);
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(dbDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return dbDir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('readBoardData', () => {
  it('discovers legacy and namespaced goals with normalized task columns', () => {
    const dbDir = makeDb({
      'g001.jsonl': [
        JSON.stringify({ event: 'goal_created', goal_id: 'g001', title: 'Local goal', description: 'Offline work' }),
        JSON.stringify({ event: 'task_created', task_id: 't01', title: 'Open task', description: 'Do work' }),
        JSON.stringify({ event: 'task_created', task_id: 't02', title: 'Done task' }),
        JSON.stringify({ event: 'task_status_changed', task_id: 't02', status: 'closed', commit_sha: '2222222222222222222222222222222222222222' }),
      ].join('\n'),
      'dfosco/g002.jsonl': [
        JSON.stringify({ event: 'goal_created', goal_id: 'g002', title: 'Linked goal', issue_number: 12, issue_url: 'https://github.com/example/issues/12' }),
        JSON.stringify({ event: 'task_created', task_id: 't01', title: 'Linked task' }),
      ].join('\n'),
    });

    const result = readBoardData({ dbDir });
    expect(result.warnings).toEqual([]);
    expect(result.goals).toHaveLength(2);
    expect(result.goals[0].source).toBe('local');
    expect(result.goals[0].tasks[1].column).toBe('closed');
    expect(result.goals[0].tasks[1].closed_commit_sha).toBe('2222222222222222222222222222222222222222');
    expect(result.goals[1].ref).toBe('#dfosco#g002');
    expect(result.goals[1].tasks[0].ref).toBe('#dfosco#g002#t01');
    expect(result.goals[1].tasks[0].source).toBe('github');
  });

  it('returns warnings and keeps valid goals when one file is malformed', () => {
    const dbDir = makeDb({
      'g001.jsonl': '{"event":"goal_created","goal_id":"g001","title":"Valid"}',
      'g002.jsonl': '{not-json}',
    });

    const result = readBoardData({ dbDir });
    expect(result.goals.map((goal) => goal.goal_id)).toEqual(['g001']);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].message).toContain('Invalid JSON');
  });

  it('returns an empty board for missing local storage', () => {
    const result = readBoardData({ dbDir: path.join(os.tmpdir(), 'clips-board-does-not-exist') });
    expect(result.goals).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('exposes behavior and resolves task verification mode inheritance', () => {
    const dbDir = makeDb({
      'g001.jsonl': [
        JSON.stringify({ event: 'goal_created', goal_id: 'g001', title: 'Behavior goal', behavior: 'Feature: Manage to-dos', verification_mode: 'behavior_and_tests' }),
        JSON.stringify({ event: 'task_created', task_id: 't01', title: 'Inherited task', behavior: 'Scenario: Add a to-do' }),
        JSON.stringify({ event: 'task_created', task_id: 't02', title: 'Behavior-only task', verification_mode: 'behavior' }),
      ].join('\n'),
    });

    const result = readBoardData({ dbDir });
    const goal = result.goals[0];
    expect(goal.behavior).toBe('Feature: Manage to-dos');
    expect(goal.effective_verification_mode).toBe('behavior_and_tests');
    expect(goal.tasks[0]).toMatchObject({
      behavior: 'Scenario: Add a to-do',
      verification_mode: null,
      effective_verification_mode: 'behavior_and_tests',
    });
    expect(goal.tasks[1].effective_verification_mode).toBe('behavior');
  });

  it('defaults legacy goals and tasks to behavior mode', () => {
    const dbDir = makeDb({
      'g001.jsonl': [
        JSON.stringify({ event: 'goal_created', goal_id: 'g001', title: 'Legacy goal' }),
        JSON.stringify({ event: 'task_created', task_id: 't01', title: 'Legacy task' }),
      ].join('\n'),
    });

    const goal = readBoardData({ dbDir }).goals[0];
    expect(goal.effective_verification_mode).toBe('behavior');
    expect(goal.tasks[0].effective_verification_mode).toBe('behavior');
  });

  it('links change records to covered goals and tasks', () => {
    const dbDir = makeDb({
      'g001.jsonl': [
        JSON.stringify({ event: 'goal_created', goal_id: 'g001', title: 'Local goal' }),
        JSON.stringify({ event: 'task_created', task_id: 't01', title: 'Open task' }),
      ].join('\n'),
    });
    const recordsDir = makeDb({
      'CR-003-read-only-kanban-board.md': [
        '# CR-003: Add read-only local kanban board',
        '',
        '**Status:** In Review',
        '**Type:** Feature',
        '**Covers:** #g001, #g001#t01',
      ].join('\n'),
    });

    const result = readBoardData({ dbDir, recordsDir });
    expect(result.change_records[0].id).toBe('CR-003');
    expect(result.goals[0].linked_crs.map((record) => record.id)).toEqual(['CR-003']);
    expect(result.goals[0].tasks[0].linked_crs.map((record) => record.id)).toEqual(['CR-003']);
  });

  it('normalizes the closing commit SHA for goals and tasks', () => {
    const dbDir = makeDb({
      'g001.jsonl': [
        JSON.stringify({ event: 'goal_created', goal_id: 'g001', title: 'Closed goal' }),
        JSON.stringify({ event: 'task_created', task_id: 't01', title: 'Closed task' }),
        JSON.stringify({ event: 'task_status_changed', task_id: 't01', status: 'closed', commit_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
        JSON.stringify({ event: 'status_changed', goal_id: 'g001', status: 'closed', commit_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }),
      ].join('\n'),
    });

    const result = readBoardData({ dbDir });
    expect(result.goals[0].closed_commit_sha).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    expect(result.goals[0].tasks[0].closed_commit_sha).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('reads linked and unmatched GitHub PRs without treating the cache as a goal', () => {
    const dbDir = makeDb({
      'g001.jsonl': [
        JSON.stringify({ event: 'goal_created', goal_id: 'g001', title: 'Local goal' }),
        JSON.stringify({ event: 'task_created', task_id: 't01', title: 'PR task' }),
        JSON.stringify({ event: 'github_pr_synced', repository: 'acme/app', pr_number: 12, title: 'Implement #g001#t01', state: 'open', merged: false, covers: ['#g001#t01'], cr_ids: ['CR-003'], url: 'https://github.com/acme/app/pull/12' }),
      ].join('\n'),
      '_github.jsonl': `${JSON.stringify({ event: 'github_pr_synced', repository: 'acme/app', pr_number: 99, title: 'Unassociated cleanup', state: 'open', merged: false, covers: [], cr_ids: [], url: 'https://github.com/acme/app/pull/99' })}\n`,
    });
    const recordsDir = makeDb({
      'CR-003-test.md': '# CR-003: Test\n\n**Status:** In Review\n**Type:** Feature\n**Covers:** #g001',
    });

    const result = readBoardData({ dbDir, recordsDir });
    expect(result.goals).toHaveLength(1);
    expect(result.github_prs.map((pr) => pr.pr_number)).toEqual([99, 12]);
    expect(result.goals[0].tasks[0].linked_prs[0].pr_number).toBe(12);
    expect(result.change_records[0].linked_prs[0].pr_number).toBe(12);
  });
});
