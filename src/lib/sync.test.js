import { describe, expect, it } from 'vitest';
import {
  buildIssueBody,
  buildTaskIssueBody,
  normalizePullRequest,
  parsePlanningRefs,
} from './sync.js';

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

describe('GitHub behavior rendering', () => {
  it('renders goal and task behavior with effective verification modes', () => {
    const body = buildIssueBody({
      goal_id: 'g001',
      description: 'Manage to-dos.',
      behavior: 'Feature: Manage to-dos',
      verification_mode: 'behavior_and_tests',
      acceptance_criteria: [],
      tasks: {
        t01: {
          task_id: 't01',
          title: 'Add a to-do',
          description: '',
          behavior: 'Scenario: Add a to-do',
          status: 'open',
        },
      },
      _taskOrder: ['t01'],
    });

    expect(body).toContain('## Behavior\n\n```gherkin\nFeature: Manage to-dos');
    expect(body).toContain('## Verification Mode\n\n`behavior_and_tests`');
    expect(body).toContain('Verification: `behavior_and_tests`');
    expect(body).toContain('Scenario: Add a to-do');
  });

  it('renders standalone task issue details using a task override', () => {
    const body = buildTaskIssueBody({
      description: 'Render the behavior.',
      behavior: 'Scenario: View attachment',
      verification_mode: 'behavior',
    }, { verification_mode: 'behavior_and_tests' }, 42);

    expect(body).toContain('Sub-issue of #42');
    expect(body).toContain('```gherkin\nScenario: View attachment\n```');
    expect(body).toContain('## Verification Mode\n\n`behavior`');
  });
});
