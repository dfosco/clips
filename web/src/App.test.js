import { render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.svelte';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState(null, '', '/');
});

function mockColorScheme(matches) {
  const listeners = new Set();
  const colorScheme = {
    matches,
    addEventListener: vi.fn((event, listener) => event === 'change' && listeners.add(listener)),
    removeEventListener: vi.fn((event, listener) => event === 'change' && listeners.delete(listener)),
  };
  vi.stubGlobal('matchMedia', vi.fn(() => colorScheme));
  return {
    set(matchesNext) {
      colorScheme.matches = matchesNext;
      for (const listener of listeners) listener({ matches: matchesNext });
    },
  };
}

const board = {
  version: 2,
  scope: 'local',
  projects: [{ id: 'clips', label: 'clips' }],
  default_project_ids: ['clips'],
  goals: [{
    project_id: 'clips',
    project_label: 'clips',
    goal_id: 'g001',
    ref: 'clips#g001',
    title: 'Local roadmap',
    source: 'local',
    status: 'open',
    type: 'building',
    adr_id: null,
    behavior: 'Feature: Local roadmap',
    effective_verification_mode: 'behavior_and_tests',
  tasks: [{
      project_id: 'clips',
      project_label: 'clips',
      goal_id: 'g001',
      goal_ref: 'clips#g001',
      task_id: 't01',
      ref: 'clips#g001#t01',
      title: 'Define board data contract',
      description: 'Document response shape.',
      goal_title: 'Local roadmap',
      source: 'local',
      column: 'open',
      status: 'open',
      behavior: 'Scenario: Define the board contract',
      effective_verification_mode: 'behavior_and_tests',
    }],
  }],
  warnings: [],
};

const boardWithRecord = {
  ...board,
  goals: [{
    ...board.goals[0],
    linked_crs: [{ id: 'CR-003', title: 'Add read-only local kanban board' }],
    tasks: [{ ...board.goals[0].tasks[0], linked_crs: [{ id: 'CR-003', title: 'Add read-only local kanban board' }] }],
  }],
  change_records: [{
    key: 'clips#CR-003',
    project_id: 'clips',
    project_label: 'clips',
    id: 'CR-003',
    title: 'Add read-only local kanban board',
    status: 'In Review',
    type: 'Feature',
    covers: ['clips#g001', 'clips#g001#t01'],
    markdown: '# CR-003: Add read-only local kanban board\n\n## Why\n\nThe complete review packet is visible here.\n\n| Field | Value |\n| --- | --- |\n| Mode | Read-only |\n\n## Behavior\n\nThe board is read-only.',
    linked_prs: [{ project_id: 'clips', project_label: 'clips', repository: 'acme/app', pr_number: 12, title: 'Implement board', url: 'https://github.com/acme/app/pull/12', state: 'open', merged: false }],
  }],
  github_prs: [{ project_id: 'clips', project_label: 'clips', repository: 'acme/app', pr_number: 99, title: 'Unassociated cleanup', url: 'https://github.com/acme/app/pull/99', state: 'open', merged: false, covers: [], cr_ids: [] }],
};

const closedBoard = {
  ...board,
  goals: [{
    ...board.goals[0],
    status: 'closed',
    closed_commit_sha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    tasks: [{
      ...board.goals[0].tasks[0],
      status: 'closed',
      column: 'closed',
      closed_commit_sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    }],
  }],
  change_records: [],
};

const planningBoard = {
  ...board,
  goals: [{
    ...board.goals[0],
    title: 'Choose storage model',
    type: 'planning',
    adr_id: 'ADR-004',
    tasks: [],
  }],
};

describe('board app', () => {
  it('shows tracks, their goals, and unassigned goals', async () => {
    mockColorScheme(false);
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ...board,
      tracks: [{ track_id: 'r001', ref: 'clips#r001', title: 'TypeScript migration', project_id: 'clips', project_label: 'clips', status: 'open', goal_count: 1, completed_goal_count: 0 }],
      goals: [
        { ...board.goals[0], title: 'Convert Core', track_ref: 'clips#r001', blocked_by: [] },
        { ...board.goals[0], goal_id: 'g002', ref: 'clips#g002', title: 'Unassigned maintenance', track_ref: null, blocked_by: [], tasks: [] },
      ],
    }), { status: 200 }));
    render(App);
    await screen.getByRole('button', { name: 'Tracks' }).click();
    expect(await screen.findByText('TypeScript migration')).toBeInTheDocument();
    expect(screen.getByText('Unassigned goals')).toBeInTheDocument();
    expect(screen.getByText(/0\/1 goals closed/)).toBeInTheDocument();
  });

  it('follows the system theme until the user chooses an override', async () => {
    const colorScheme = mockColorScheme(true);
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(board), { status: 200 }));
    render(App);

    await screen.findByText('Define board data contract');
    const shell = document.querySelector('.app-shell');
    expect(shell).toHaveClass('dark-mode');

    colorScheme.set(false);
    await waitFor(() => expect(shell).not.toHaveClass('dark-mode'));

    await screen.getByRole('button', { name: 'Toggle color theme' }).click();
    expect(shell).toHaveClass('dark-mode');
    colorScheme.set(true);
    colorScheme.set(false);
    expect(shell).toHaveClass('dark-mode');
  });

  it('renders and filters project-qualified data from multiple projects', async () => {
    const betaGoal = {
      ...board.goals[0],
      project_id: 'beta',
      project_label: 'beta',
      ref: 'beta#g001',
      title: 'Beta roadmap',
      tasks: [{
        ...board.goals[0].tasks[0],
        project_id: 'beta',
        project_label: 'beta',
        goal_ref: 'beta#g001',
        ref: 'beta#g001#t01',
        title: 'Beta task',
        goal_title: 'Beta roadmap',
      }],
    };
    const multiProjectBoard = {
      ...board,
      scope: 'all',
      projects: [{ id: 'clips', label: 'clips' }, { id: 'beta', label: 'beta' }],
      default_project_ids: ['clips', 'beta'],
      goals: [...board.goals, betaGoal],
    };
    vi.spyOn(window, 'fetch').mockImplementation(() => Promise.resolve(new Response(JSON.stringify(multiProjectBoard), { status: 200 })));
    render(App);

    expect(await screen.findByText('Beta task')).toBeInTheDocument();
    expect(screen.getByText('clips#g001#t01')).toBeInTheDocument();
    expect(screen.getByText('beta#g001#t01')).toBeInTheDocument();
    const betaCheckbox = screen.getByRole('checkbox', { name: /beta/ });
    await betaCheckbox.click();
    expect(await screen.findByText('Define board data contract')).toBeInTheDocument();
    expect(screen.queryByText('Beta task')).not.toBeInTheDocument();
    expect(window.fetch).toHaveBeenLastCalledWith('/api/board?project=clips');
  });

  it('renders tasks after loading board data', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(board), { status: 200 }));
    render(App);

    expect(screen.getByText('Loading planning data')).toBeInTheDocument();
    expect(await screen.findByText('Define board data contract')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Select projects' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /clips/ })).toBeChecked();
    expect(screen.getAllByText('Local only').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Read-only').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.iconoir')).toBeInTheDocument();
    expect(document.querySelector('.iconoir[style*="--icon-url"]')).toBeInTheDocument();
    expect(document.querySelector('svg')).not.toBeInTheDocument();
  });

  it('shows API errors with retry action', async () => {
    vi.spyOn(window, 'fetch').mockRejectedValue(new Error('Network unavailable.'));
    render(App);

    await waitFor(() => expect(screen.getByText('Board unavailable')).toBeInTheDocument());
    expect(screen.getByText('Network unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('makes sidebar views actionable', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(board), { status: 200 }));
    render(App);

    await screen.findByText('Define board data contract');
    await screen.getByRole('button', { name: 'Goals', exact: true }).click();
    expect(screen.getByRole('heading', { name: 'Goals', exact: true })).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Tasks', exact: true }).click();
    expect(screen.getByRole('heading', { name: 'Tasks', exact: true })).toBeInTheDocument();

    await screen.getByPlaceholderText('Search current page').click();
    await waitFor(() => expect(screen.getByPlaceholderText('Search current page')).toHaveFocus());

    await screen.getByRole('button', { name: 'CRs', exact: true }).click();
    expect(screen.getByRole('heading', { name: 'Change records', exact: true })).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Settings', exact: true }).click();
    expect(screen.getByRole('heading', { name: 'Settings', exact: true })).toBeInTheDocument();
  });

  it('opens task details from a task card and closes with Escape', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(board), { status: 200 }));
    render(App);

    await screen.findByText('Define board data contract');
    expect(screen.queryByText('Document response shape.')).not.toBeInTheDocument();
    await screen.getByText('Define board data contract').click();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const panel = screen.getByRole('dialog');
    expect(within(panel).getByRole('heading', { name: 'Define board data contract' })).toBeInTheDocument();
    expect(within(panel).getByText('Document response shape.')).toBeInTheDocument();
    expect(within(panel).getByText('Scenario: Define the board contract')).toBeInTheDocument();
    expect(within(panel).getByText('behavior and tests')).toBeInTheDocument();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('switches the board between task cards and goal cards', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(board), { status: 200 }));
    render(App);

    await screen.findByText('Define board data contract');
    expect(screen.getByRole('region', { name: 'Task card board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open task Define board data contract in clips' })).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Show goal cards' }).click();
    expect(screen.getByRole('region', { name: 'Goal card board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open goal Local roadmap in clips' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open task Define board data contract in clips' })).not.toBeInTheDocument();

    await screen.getByRole('button', { name: 'Show task cards' }).click();
    expect(screen.getByRole('region', { name: 'Task card board' })).toBeInTheDocument();
  });

  it('opens goal details and navigates to a task from the panel', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(board), { status: 200 }));
    render(App);

    await screen.findByText('Define board data contract');
    await screen.getByRole('button', { name: 'Open goal Local roadmap in clips' }).click();

    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Local roadmap' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Feature: Local roadmap')).toBeInTheDocument();
    await screen.getByRole('button', { name: 'Define board data contract' }).click();
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Define board data contract' })).toBeInTheDocument();
    await within(screen.getByRole('dialog')).getByRole('button', { name: 'Back to goal' }).click();
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'Local roadmap' })).toBeInTheDocument();
  });

  it('shows the ADR result instead of tasks for a planning goal', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(planningBoard), { status: 200 }));
    render(App);

    await screen.getByRole('button', { name: 'Show goal cards' }).click();
    await (await screen.findByRole('button', { name: 'Open goal Choose storage model in clips' })).click();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Planning')).toBeInTheDocument();
    expect(dialog.getByText('ADR-004')).toBeInTheDocument();
    expect(dialog.queryByRole('heading', { name: 'Tasks in this goal' })).not.toBeInTheDocument();
  });

  it('opens CRs as a full page with rendered markdown and linked objects', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(boardWithRecord), { status: 200 }));
    render(App);

    await screen.findByText('Define board data contract');
    await screen.getByRole('button', { name: 'CRs', exact: true }).click();
    await screen.getByRole('button', { name: /CR-003: Add read-only local kanban board/ }).click();

    expect(screen.getByRole('heading', { name: 'CR-003: Add read-only local kanban board' })).toBeInTheDocument();
    expect(screen.getByText('The complete review packet is visible here.')).toBeInTheDocument();
    expect(screen.getByText('The board is read-only.')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Linked objects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Local roadmap/ })).toBeInTheDocument();
    const prLink = screen.getByRole('link', { name: /#12 Implement board/ });
    expect(prLink).toHaveAttribute('href', 'https://github.com/acme/app/pull/12');
    expect(prLink).toHaveAttribute('target', '_blank');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows unmatched GitHub PRs on the CR page', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(boardWithRecord), { status: 200 }));
    render(App);

    await screen.findByText('Define board data contract');
    await screen.getByRole('button', { name: 'CRs', exact: true }).click();
    expect(screen.getByRole('heading', { name: 'Unassociated GitHub changes' })).toBeInTheDocument();
    const prLink = screen.getByRole('link', { name: /#99 Unassociated cleanup/ });
    expect(prLink).toHaveAttribute('target', '_blank');
  });

  it('shows closing commit SHAs for closed goals and tasks', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(JSON.stringify(closedBoard), { status: 200 }));
    render(App);

    await screen.findByText('Define board data contract');
    expect(screen.getByTitle('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Open task Define board data contract in clips' }).click();
    expect(screen.getByText('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeInTheDocument();

    await screen.getByRole('button', { name: 'Close detail panel' }).click();
    await screen.getByRole('button', { name: 'Show goal cards' }).click();
    await screen.getByRole('button', { name: 'Open goal Local roadmap in clips' }).click();
    expect(screen.getByText('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeInTheDocument();
  });
});
