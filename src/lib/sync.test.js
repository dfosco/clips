import { describe, expect, it } from 'vitest';
import {
  buildIssueBody,
  buildLaneIssueBody,
  buildTaskIssueBody,
  normalizePullRequest,
  parseGoalMetadata,
  parsePlanningRefs,
  parseTaskList,
} from './sync.js';
import { githubPullRequestKey } from './github-identity.js';

describe('GitHub pull request identity', () => {
  it('distinguishes equal repository and number pairs on different hosts', () => {
    expect(githubPullRequestKey({
      repository: 'acme/app',
      remote_host: 'github.com',
      pr_number: 12,
      url: 'https://github.com/acme/app/pull/12',
    })).not.toBe(githubPullRequestKey({
      repository: 'acme/app',
      remote_host: 'git.example.test',
      pr_number: 12,
      url: 'https://git.example.test/acme/app/pull/12',
    }));
  });

  it('derives the host from legacy PR URLs without remote_host metadata', () => {
    expect(githubPullRequestKey({
      repository: 'acme/app',
      pr_number: 12,
      url: 'https://git.example.test/acme/app/pull/12',
    })).toBe('git.example.test#acme/app#12');
  });
});

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
      headRefName: 'feature/board',
      author: { login: 'octocat' },
      createdAt: '2026-08-13T00:00:00Z',
      updatedAt: '2026-08-13T01:00:00Z',
      mergedAt: null,
    })).toMatchObject({
      event: 'github_pr_synced',
      repository: 'acme/app',
      remote_host: 'github.com',
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
  it('renders the work contract, stable criterion refs, and supplied acceptance evidence', () => {
    const task = { task_id: 't01', title: 'Store selection', scope: 'Persistence only',
      components: ['#c001#r1'], record: 'Added a tolerant reader',
      acceptance_criteria: [{ id: 'A2', description: 'Unavailable storage is harmless' }],
      acceptance: { accepted_by: 'fixture-reviewer', summary: 'Checked candidate', artifact: 'fixture:commit',
        criteria: [{ id: 'A2', status: 'satisfied', evidence: 'fixture:failure-path-result' }] },
    };
    const body = buildIssueBody({ goal_id: 'g001', plan: 'Persist then integrate', decisions: 'Store only the ID',
      blocked_by: ['#sam#g002'], acceptance_criteria: [{ id: 'A1', description: 'Reload restores selection' }],
      tasks: { t01: task },
    });
    expect(body).toContain('#g001#A1: Reload restores selection');
    expect(body).toContain('- Unavailable storage is harmless `#g001#t01#A2`');
    expect(body).toContain('fixture:failure-path-result');
    expect(body).toContain('## Plan\n\nPersist then integrate');
    expect(body).toContain('Blocked by: #sam#g002');
    expect(body).not.toContain('[object Object]');
    expect(buildTaskIssueBody(task, { goal_id: 'g001' })).toContain('#g001#t01#A2: satisfied — fixture:failure-path-result');
  });

  it('renders goal and task behavior with effective verification modes', () => {
    const body = buildIssueBody({
      goal_id: 'g001',
      type: 'building',
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
    expect(body).toContain('## Goal Type\n\n`building`');
    expect(body).toContain('## Verification Mode\n\n`behavior_and_tests`');
    expect(body).toContain('Verification: `behavior_and_tests`');
    expect(body).toContain('Scenario: Add a to-do');
  });

  it('retains planning metadata while rendering its work tasks', () => {
    const body = buildIssueBody({
      goal_id: 'g001',
      type: 'planning',
      adr_id: 'ADR-004',
      tasks: { t01: { task_id: 't01', title: 'Plan-compatible task', status: 'open' } },
      _taskOrder: ['t01'],
    });

    expect(parseGoalMetadata(body)).toEqual({
      type: 'planning',
      adr_id: 'ADR-004',
      type_explicit: true,
      adr_explicit: true,
    });
    expect(body).toContain('## Tasks');
    expect(body).toContain('Plan-compatible task');
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

  it('renders managed child issues title-first with trailing local refs and omits attachment file data', () => {
    const origin = { host: 'github.com', repository: 'acme/app' };
    const goal = {
      goal_id: 'g004',
      title: 'Refactor auth',
      attachments: [{ type: 'markdown', path: '/tmp/secret-plan.md', content: 'Never publish this body' }],
      tasks: {
        t01: {
          task_id: 't01',
          title: '#g004 Refactor auth',
          status: 'open',
          issue_number: 42,
          issue_url: 'https://github.com/acme/app/issues/42',
          repository: 'acme/app',
          remote_host: 'github.com',
          attachments: [{ type: 'markdown', path: '/private/session-plan.md', content: 'Secret text' }],
        },
      },
      _taskOrder: ['t01'],
    };
    const body = buildIssueBody(goal, { origin, config: { tasks_as_issues: true } });
    expect(body).toContain('- [ ] [Refactor auth](https://github.com/acme/app/issues/42) `#g004#t01`');
    expect(body).not.toContain('#g004 Refactor auth');
    expect(body).not.toContain('/tmp/secret-plan.md');
    expect(body).not.toContain('/private/session-plan.md');
    expect(body).not.toContain('Never publish this body');
    expect(body).not.toContain('Secret text');
    const standaloneTaskBody = buildTaskIssueBody(goal.tasks.t01, { goal_id: 'g004' }, 7);
    expect(standaloneTaskBody).not.toContain('/private/session-plan.md');
    expect(standaloneTaskBody).not.toContain('Secret text');

    const laneBody = buildLaneIssueBody({
      track_id: 'r004',
      title: 'Auth',
      attachments: [{ type: 'markdown', path: '/tmp/secret-lane-plan.md', content: 'Private lane plan' }],
    }, {
      origin,
      goals: [{
        goal_id: 'g004',
        title: 'Refactor auth',
        status: 'open',
        issue_number: 41,
        issue_url: 'https://github.com/acme/app/issues/41',
        repository: 'acme/app',
        remote_host: 'github.com',
      }],
    });
    expect(laneBody).toContain('- [ ] [Refactor auth](https://github.com/acme/app/issues/41) `#g004`');
    expect(laneBody).not.toContain('/tmp/secret-lane-plan.md');
    expect(laneBody).not.toContain('Private lane plan');
  });

  it('parses linked and legacy task-list forms without retaining remote or local IDs in titles', () => {
    expect(parseTaskList([
      '- [ ] [Refactor auth](https://github.com/acme/app/issues/42) `#g004#t01`',
      '- [x] #43 Update policy',
      '- [ ] **#g004#t03**: Add audit logging',
    ].join('\n'))).toEqual([
      { title: 'Refactor auth', done: false },
      { title: 'Update policy', done: true },
      { title: 'Add audit logging', done: false },
    ]);
  });

  it('round-trips escaped brackets and backslashes in linked issue titles', () => {
    const body = buildIssueBody({
      goal_id: 'g004',
      title: 'Parent',
      tasks: {
        t01: {
          task_id: 't01',
          title: '#g004 Refactor [auth] \\ flow',
          status: 'open',
          issue_number: 42,
          issue_url: 'https://github.com/acme/app/issues/42',
          repository: 'acme/app',
          remote_host: 'github.com',
        },
      },
      _taskOrder: ['t01'],
    }, { origin: { host: 'github.com', repository: 'acme/app' }, config: { tasks_as_issues: true } });

    expect(body).toContain('[Refactor \\[auth\\] \\\\ flow](https://github.com/acme/app/issues/42) `#g004#t01`');
    expect(parseTaskList(body)).toContainEqual({ title: 'Refactor [auth] \\ flow', done: false });

    const unlinkedBody = buildIssueBody({
      goal_id: 'g004',
      title: 'Parent',
      tasks: {
        t01: {
          task_id: 't01',
          title: '#g004 Refactor [auth] \\ flow',
          status: 'open',
        },
      },
      _taskOrder: ['t01'],
    }, { config: { tasks_as_issues: false } });
    expect(parseTaskList(unlinkedBody)).toContainEqual({ title: 'Refactor [auth] \\ flow', done: false });
  });
});
