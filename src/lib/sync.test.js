import { describe, expect, it } from 'vitest';
import { normalizePullRequest, parsePlanningRefs } from './sync.js';

describe('GitHub pull normalization', () => {
  it('extracts explicit goal, task, and CR references from PR text', () => {
    expect(parsePlanningRefs('Fix #g001#t01; covers #g001 and CR-003')).toEqual({
      covers: ['#g001#t01', '#g001'],
      cr_ids: ['CR-003'],
    });
  });

  it('normalizes GitHub PR metadata into a stable event shape', () => {
    expect(normalizePullRequest({
      number: 12,
      title: 'Implement #g001',
      body: 'CR-003',
      state: 'OPEN',
      url: 'https://github.com/acme/app/pull/12',
      repository: { nameWithOwner: 'acme/app' },
      headRefName: 'feature/board',
      author: { login: 'octocat' },
      createdAt: '2026-08-13T00:00:00Z',
      updatedAt: '2026-08-13T01:00:00Z',
      mergedAt: null,
    })).toMatchObject({
      event: 'github_pr_synced',
      repository: 'acme/app',
      pr_number: 12,
      state: 'open',
      merged: false,
      head_ref: 'feature/board',
      author: 'octocat',
      covers: ['#g001'],
      cr_ids: ['CR-003'],
    });
  });
});
