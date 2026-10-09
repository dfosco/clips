<script>
  import { onMount } from 'svelte';
  import { Button } from 'bits-ui';
  import Icon from './lib/Icon.svelte';
  import MarkdownContent from './lib/MarkdownContent.svelte';
  import TaskCard from './lib/TaskCard.svelte';
  import GoalCard from './lib/GoalCard.svelte';

  const columns = [
    { id: 'open', label: 'Open', color: 'green' },
    { id: 'in_progress', label: 'In progress', color: 'orange' },
    { id: 'closed', label: 'Closed', color: 'purple' },
    { id: 'not_planned', label: 'Not planned', color: 'gray' },
  ];

  const navigation = [
    { id: 'board', label: 'Board', icon: 'board' },
    { id: 'tracks', label: 'Tracks', icon: 'target' },
    { id: 'goals', label: 'Goals', icon: 'target' },
    { id: 'tasks', label: 'Tasks', icon: 'tasks' },
    { id: 'changes', label: 'CRs', icon: 'changes' },
    { id: 'github', label: 'GitHub', icon: 'github' },
  ];

  let board = $state(null);
  let loading = $state(true);
  let error = $state('');
  let search = $state('');
  let sourceFilter = $state('all');
  let goalFilter = $state('all');
  let activeView = $state('board');
  let systemDark = $state(false);
  let themeOverride = $state(null);
  let darkMode = $derived(themeOverride ?? systemDark);
  let themeLabel = $derived(themeOverride === null ? `System (${darkMode ? 'Dark' : 'Light'})` : darkMode ? 'Dark' : 'Light');
  let selectedItem = $state(null);
  let activeRecord = $state(null);
  let cardMode = $state('task');
  let selectedProjectIds = $state([]);
  let requestedProjectIds = $state(null);

  function routePath() {
    if (selectedItem?.type === 'goal') return `/goals/${encodeURIComponent(selectedItem.item.ref)}`;
    if (selectedItem?.type === 'task') return `/tasks/${encodeURIComponent(selectedItem.item.ref)}`;
    if (activeView === 'change_record' && activeRecord) return `/changes/${encodeURIComponent(activeRecord.id)}`;
    return activeView === 'board' ? '/board' : `/${activeView}`;
  }

  function updateUrl(replace = false) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (sourceFilter !== 'all') params.set('source', sourceFilter);
    if (goalFilter !== 'all') params.set('goal', goalFilter);
    if (cardMode !== 'task') params.set('cards', cardMode);
    if (selectedProjectIds.length) params.set('projects', selectedProjectIds.join(','));
    if (themeOverride !== null) params.set('theme', themeOverride ? 'dark' : 'light');
    const url = `${routePath()}${params.size ? `?${params}` : ''}`;
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }

  function applyLocation() {
    const url = new URL(window.location.href);
    const [view, identifier] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    activeView = ['board', 'tracks', 'goals', 'tasks', 'changes', 'github', 'settings'].includes(view) ? view : 'board';
    if (view === 'changes' && identifier) activeView = 'change_record';
    search = url.searchParams.get('search') || '';
    sourceFilter = url.searchParams.get('source') || 'all';
    goalFilter = url.searchParams.get('goal') || 'all';
    cardMode = url.searchParams.get('cards') === 'goal' ? 'goal' : 'task';
    requestedProjectIds = url.searchParams.get('projects')?.split(',').filter(Boolean) || null;
    const theme = url.searchParams.get('theme');
    themeOverride = theme === 'dark' ? true : theme === 'light' ? false : null;
    selectedItem = null;
    activeRecord = null;
    if (identifier && view === 'goals') selectedItem = { type: 'goal', ref: identifier };
    if (identifier && view === 'tasks') selectedItem = { type: 'task', ref: identifier };
    if (identifier && view === 'changes') activeRecord = { id: identifier };
  }

  function resolveRouteObjects() {
    if (selectedItem?.ref) {
      const item = selectedItem.type === 'goal'
        ? board?.goals?.find((goal) => goal.ref === selectedItem.ref)
        : board?.goals?.flatMap((goal) => goal.tasks).find((task) => task.ref === selectedItem.ref);
      selectedItem = item ? { type: selectedItem.type, item } : null;
    }
    if (activeRecord?.id && !activeRecord.markdown) activeRecord = board?.change_records?.find((record) => record.id === activeRecord.id) || null;
  }

  async function loadBoard(projectIds = null) {
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams();
      for (const projectId of projectIds || []) params.append('project', projectId);
      const response = await fetch(`/api/board${params.size ? `?${params}` : ''}`);
      if (!response.ok) throw new Error(`Board API returned ${response.status}.`);
      board = await response.json();
      const validRequestedProjects = requestedProjectIds?.filter((id) => board.projects?.some((project) => project.id === id));
      selectedProjectIds = projectIds || validRequestedProjects?.length ? (projectIds || validRequestedProjects) : board.default_project_ids || board.projects?.map((project) => project.id) || [];
      resolveRouteObjects();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Could not load board.';
    } finally {
      loading = false;
    }
  }

  function matches(value, query) {
    return value?.toLowerCase().includes(query);
  }

  function goalMatches(goal, query) {
    return [goal.title, goal.description, goal.behavior, goal.type, goal.adr_id, goal.effective_verification_mode, goal.ref, goal.project_id, goal.project_label].some((value) => matches(value, query));
  }

  function taskMatches(task, query) {
    return [task.title, task.description, task.behavior, task.effective_verification_mode, task.goal_title, task.ref, task.project_id, task.project_label].some((value) => matches(value, query));
  }

  function recordMatches(record, query) {
    return [record.id, record.title, record.status, record.type, record.project_id, record.project_label, ...record.covers, ...(record.linked_prs || []).map((pr) => `${pr.title} ${pr.pr_number}`)].some((value) => matches(value, query));
  }

  function prLabel(pr) {
    return `#${pr.pr_number} ${pr.title}`;
  }

  function prUrl(pr) {
    return pr.url || `https://github.com/${pr.repository}/pull/${pr.pr_number}`;
  }

  function statusLabel(status) {
    return (status || 'open').replaceAll('_', ' ');
  }

  function goalColumn(goal) {
    if (goal.status === 'duplicate' || goal.status === 'not_planned') return 'not_planned';
    return columns.some((column) => column.id === goal.status) ? goal.status : 'open';
  }

  let filteredGoals = $derived(board?.goals?.filter((goal) => {
    const query = search.trim().toLowerCase();
    const sourceMatch = sourceFilter === 'all' || goal.source === sourceFilter;
    const goalMatch = goalFilter === 'all' || goal.ref === goalFilter;
    const projectMatch = selectedProjectIds.includes(goal.project_id);
    const textMatch = !query || goalMatches(goal, query) || goal.tasks.some((task) => taskMatches(task, query));
    return projectMatch && sourceMatch && goalMatch && textMatch;
  }) ?? []);

  let visibleTasks = $derived.by(() => {
    const query = search.trim().toLowerCase();
    const result = {};
    for (const column of columns) {
      result[column.id] = filteredGoals.flatMap((goal) => {
        const matchingGoal = !query || goalMatches(goal, query);
        return goal.tasks
          .filter((task) => task.column === column.id)
          .filter((task) => !query || matchingGoal || taskMatches(task, query));
      });
    }
    return result;
  });

  let totalVisibleTasks = $derived(columns.reduce((total, column) => total + (visibleTasks[column.id]?.length ?? 0), 0));
  let visibleGoals = $derived.by(() => {
    const result = {};
    for (const column of columns) result[column.id] = filteredGoals.filter((goal) => goalColumn(goal) === column.id);
    return result;
  });
  let linkedGoals = $derived(board?.goals?.filter((goal) => selectedProjectIds.includes(goal.project_id) && goal.source === 'github') ?? []);
  let visibleGoalsList = $derived(board?.goals?.filter((goal) => {
    const query = search.trim().toLowerCase();
    return selectedProjectIds.includes(goal.project_id) && (sourceFilter === 'all' || goal.source === sourceFilter) && (goalFilter === 'all' || goal.ref === goalFilter) && (!query || goalMatches(goal, query));
  }) ?? []);
  let visibleTracks = $derived(board?.tracks?.filter((track) => selectedProjectIds.includes(track.project_id) && (!search.trim() || [track.title, track.description, track.ref].some((value) => matches(value, search.trim().toLowerCase())))) ?? []);
  let visibleTasksList = $derived.by(() => {
    const query = search.trim().toLowerCase();
    return (board?.goals ?? []).flatMap((goal) => goal.tasks.filter((task) => selectedProjectIds.includes(task.project_id) && (sourceFilter === 'all' || task.source === sourceFilter) && (goalFilter === 'all' || task.goal_ref === goalFilter) && (!query || taskMatches(task, query))));
  });
  let visibleRecords = $derived(board?.change_records?.filter((record) => selectedProjectIds.includes(record.project_id) && recordMatches(record, search.trim().toLowerCase())) ?? []);
  let scopeLabel = $derived(selectedProjectIds.length === 1 ? board?.projects?.find((project) => project.id === selectedProjectIds[0])?.label || 'Project' : `${selectedProjectIds.length} projects`);

  function toggleProject(projectId, checked) {
    const next = checked ? [...new Set([...selectedProjectIds, projectId])] : selectedProjectIds.filter((id) => id !== projectId);
    if (!next.length) return;
    goalFilter = 'all';
    loadBoard(next);
    updateUrl();
  }

  function openView(view) {
    activeView = view;
    activeRecord = null;
    selectedItem = null;
    updateUrl();
    requestAnimationFrame(() => document.querySelector('.top-search input')?.focus());
  }

  function toggleTheme() {
    themeOverride = !darkMode;
    updateUrl();
  }

  function openTask(task, parentGoal = null) {
    selectedItem = { type: 'task', item: task, parentGoal };
    updateUrl();
  }

  function openGoal(goal) {
    selectedItem = { type: 'goal', item: goal };
    updateUrl();
  }

  function openChangeRecord(record) {
    activeView = 'change_record';
    activeRecord = board?.change_records?.find((candidate) => candidate.key === record.key) || record;
    selectedItem = null;
    updateUrl();
  }

  function linkedObject(ref) {
    const goal = board?.goals?.find((candidate) => candidate.ref === ref);
    if (goal) return { type: 'goal', item: goal };
    const task = board?.goals?.flatMap((candidate) => candidate.tasks).find((candidate) => candidate.ref === ref);
    return task ? { type: 'task', item: task } : null;
  }

  function openCoveredRef(ref) {
    const goal = board?.goals?.find((candidate) => candidate.ref === ref);
    if (goal) {
      openGoal(goal);
      return;
    }
    const task = board?.goals?.flatMap((candidate) => candidate.tasks).find((candidate) => candidate.ref === ref);
    if (task) openTask(task);
  }

  function closePanel() {
    selectedItem = null;
    updateUrl();
  }

  function setSearch(value) {
    search = value;
    updateUrl(true);
  }

  function setGoalFilter(value) {
    goalFilter = value;
    updateUrl();
  }

  function setSourceFilter(value) {
    sourceFilter = value;
    updateUrl();
  }

  function setCardMode(value) {
    cardMode = value;
    updateUrl();
  }

  function handleGlobalKeydown(event) {
    if (event.key === 'Escape' && selectedItem) closePanel();
  }

  onMount(() => {
    applyLocation();
    const colorScheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleColorSchemeChange = (event) => {
      systemDark = event.matches;
    };
    if (colorScheme) {
      systemDark = colorScheme.matches;
      colorScheme.addEventListener('change', handleColorSchemeChange);
    }
    loadBoard(requestedProjectIds);
    window.addEventListener('keydown', handleGlobalKeydown);
    const handlePopState = () => {
      applyLocation();
      loadBoard(requestedProjectIds);
    };
    window.addEventListener('popstate', handlePopState);
    return () => {
      colorScheme?.removeEventListener('change', handleColorSchemeChange);
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('popstate', handlePopState);
    };
  });
</script>

<svelte:head>
  <title>Clips · {activeView === 'board' ? scopeLabel : activeView === 'change_record' ? activeRecord?.id || 'Change record' : navigation.find((item) => item.id === activeView)?.label}</title>
  <meta name="description" content="Read-only local board for Clips goals and tasks." />
</svelte:head>

<div class:dark-mode={darkMode} class:light-mode={themeOverride === false} class="app-shell">
  <aside class="sidebar" aria-label="Primary navigation">
    <div class="brand"><span class="brand-mark"><Icon name="logo" size={25} /></span><span>Clips</span></div>
    <nav class="sidebar-nav">
      {#each navigation as item}
        <button class:sidebar-link--active={activeView === item.id} class="sidebar-link" type="button" onclick={() => openView(item.id)} aria-label={item.label}>
          <Icon name={item.icon} size={20} /><span>{item.label}</span>
        </button>
      {/each}
    </nav>
    <div class="sidebar-bottom">
      <button class:sidebar-link--active={activeView === 'settings'} class="sidebar-link" type="button" onclick={() => openView('settings')} aria-label="Settings"><Icon name="settings" size={20} /><span>Settings</span></button>
      <button class="sidebar-link sidebar-link--button" type="button" onclick={toggleTheme} aria-label="Toggle color theme"><Icon name="moon" size={20} /><span>Theme</span></button>
    </div>
  </aside>

  <main class="main-content" id="board">
    <header class="topbar">
      <div class="breadcrumbs"><span>Workspace</span><span class="breadcrumb-separator">/</span><strong>{activeView === 'board' ? scopeLabel : activeView === 'change_record' ? activeRecord?.id || 'Change record' : navigation.find((item) => item.id === activeView)?.label || 'Settings'}</strong></div>
      <label class="top-search"><Icon name="search" size={17} /><span class="sr-only">Search current page</span><input value={search} oninput={(event) => setSearch(event.currentTarget.value)} type="search" placeholder="Search current page" /></label>
      <div class="topbar-actions"><button class="docs-button" type="button" onclick={() => openView('settings')} aria-label="Open documentation"><Icon name="book" size={18} /></button><div class="readonly-indicator"><Icon name="lock" size={15} /> Read-only</div></div>
    </header>

    {#if activeView === 'board'}
      <section class="board-header">
        <div class="board-heading-main"><h1>{scopeLabel}</h1><div class="view-readonly"><Icon name="lock" size={13} /> Read-only</div><div class="segmented-control" role="group" aria-label="Show cards by"><span>Cards by</span><button class:segmented-control__active={cardMode === 'goal'} type="button" aria-label="Show goal cards" aria-pressed={cardMode === 'goal'} onclick={() => setCardMode('goal')}>Goals</button><button class:segmented-control__active={cardMode === 'task'} type="button" aria-label="Show task cards" aria-pressed={cardMode === 'task'} onclick={() => setCardMode('task')}>Tasks</button></div></div>
        <div class="board-controls" aria-label="Board filters">
          {#if board?.projects?.length}<details class="project-filter"><summary aria-label="Select projects">Projects · {selectedProjectIds.length}<Icon name="chevron" size={15} /></summary><fieldset><legend>Select projects</legend>{#each board.projects as project}<label><input type="checkbox" checked={selectedProjectIds.includes(project.id)} disabled={selectedProjectIds.length === 1 && selectedProjectIds.includes(project.id)} onchange={(event) => toggleProject(project.id, event.currentTarget.checked)} /><span>{project.label}</span><code>{project.id}</code></label>{/each}</fieldset></details>{/if}
          <label class="select-field"><span class="sr-only">Filter by goal</span><select value={goalFilter} onchange={(event) => setGoalFilter(event.currentTarget.value)} aria-label="Filter by goal"><option value="all">All goals</option>{#each board?.goals ?? [] as goal}<option value={goal.ref}>{goal.project_label} · {goal.title}</option>{/each}</select><Icon name="chevron" size={15} /></label>
          <label class="select-field select-field--source"><span class="sr-only">Filter by source</span><select value={sourceFilter} onchange={(event) => setSourceFilter(event.currentTarget.value)} aria-label="Filter by source"><option value="all">All sources</option><option value="github">GitHub linked</option><option value="local">Local only</option></select><Icon name="chevron" size={15} /></label>
          <Button.Root class="refresh-button" type="button" aria-label="Refresh board" on:click={() => loadBoard(selectedProjectIds)}><Icon name="refresh" size={18} /></Button.Root>
        </div>
      </section>

      {#if loading}
        <section class="state-panel" aria-live="polite"><div class="state-icon state-icon--loading"><span></span></div><h2>Loading planning data</h2><p>Reading local goals and tasks…</p></section>
      {:else if error}
        <section class="state-panel state-panel--error" aria-live="assertive"><div class="state-icon"><Icon name="refresh" size={21} /></div><h2>Board unavailable</h2><p>{error}</p><Button.Root class="state-action" type="button" on:click={loadBoard}>Try again</Button.Root></section>
      {:else if board && board.goals.length === 0}
        <section class="state-panel" aria-live="polite"><div class="state-icon"><Icon name="layers" size={21} /></div><h2>No goals yet</h2><p>Create a goal with the Clips CLI, then refresh this board.</p></section>
      {:else}
        {#if board?.warnings?.length}<div class="warning-banner" role="status">{board.warnings.length} record{board.warnings.length === 1 ? '' : 's'} could not be read. Other goals remain visible.</div>{/if}
        <section class:kanban--goals={cardMode === 'goal'} class="kanban" aria-label={`${cardMode === 'goal' ? 'Goal' : 'Task'} card board`}>
          {#each columns as column (column.id)}
            <section class="kanban-column" aria-labelledby="column-{column.id}">
              <div class="column-header"><div class="column-title"><span class="column-dot column-dot--{column.color}"></span><h2 id="column-{column.id}">{column.label}</h2><span class="column-count">{cardMode === 'goal' ? visibleGoals[column.id].length : visibleTasks[column.id].length}</span></div></div>
              <div class="column-content">
                {#if cardMode === 'goal'}
                  {#if visibleGoals[column.id].length === 0}<div class="column-empty"><Icon name="inbox" size={40} /><strong>No goals</strong><span>There are no goals<br />in this status yet.</span></div>
                  {:else}{#each visibleGoals[column.id] as goal (goal.ref)}<GoalCard {goal} onOpen={openGoal} />{/each}{/if}
                {:else if visibleTasks[column.id].length === 0}<div class="column-empty"><Icon name="inbox" size={40} /><strong>No tasks</strong><span>There are no tasks<br />in this status yet.</span></div>
                {:else}
                  {#each filteredGoals as goal (goal.ref)}
                    {@const goalTasks = visibleTasks[column.id].filter((task) => task.goal_ref === goal.ref)}
                    {#if goalTasks.length}<div class="goal-group"><button class="goal-group__header" type="button" onclick={() => openGoal(goal)} aria-label={`Open goal ${goal.title} in ${goal.project_label}`}><strong>{goal.title}</strong><span>{goal.project_label} · {goal.source === 'github' ? 'GitHub linked' : 'Local only'} {#if goal.source === 'github'}<Icon name="github" size={15} />{/if}</span></button>{#each goalTasks as task (task.ref)}<TaskCard {task} onOpen={openTask} />{/each}</div>{/if}
                  {/each}
                {/if}
              </div>
            </section>
          {/each}
        </section>
      {/if}
    {:else if activeView === 'tracks'}
      <section class="secondary-view"><div class="secondary-heading"><div><h1>Tracks</h1><p>Workstreams and their goals.</p></div><span class="view-readonly"><Icon name="lock" size={13} /> Read-only</span></div><div class="compact-list">{#each visibleTracks as track}<div class="compact-row"><span class="compact-row__icon"><Icon name="target" size={18} /></span><span class="compact-row__main"><strong>{track.title}</strong><small>{track.project_label} · {track.ref} · {track.completed_goal_count}/{track.goal_count} goals closed · {statusLabel(track.status)}</small>{#if track.description}<small>{track.description}</small>{/if}{#each visibleGoalsList.filter((goal) => goal.track_ref === track.ref) as goal}<button type="button" onclick={() => openGoal(goal)}>{goal.ref} {goal.title} · {statusLabel(goal.status)}</button>{/each}</span></div>{/each}{#if visibleGoalsList.some((goal) => !goal.track_ref)}<div class="compact-row"><span class="compact-row__main"><strong>Unassigned goals</strong>{#each visibleGoalsList.filter((goal) => !goal.track_ref) as goal}<button type="button" onclick={() => openGoal(goal)}>{goal.ref} {goal.title}</button>{/each}</span></div>{/if}</div></section>
    {:else if activeView === 'goals'}
      <section class="secondary-view"><div class="secondary-heading"><div><h1>Goals</h1><p>Compact list of planning outcomes.</p></div><span class="view-readonly"><Icon name="lock" size={13} /> Read-only</span></div><div class="compact-list">{#each visibleGoalsList as goal}<button class="compact-row" type="button" onclick={() => openGoal(goal)}><span class="compact-row__icon"><Icon name="target" size={18} /></span><span class="compact-row__main"><strong>{goal.title}</strong><small>{goal.project_label} · {goal.ref} · {goal.track_ref || 'Unassigned'} · {goal.type === 'planning' ? `Planning · ${goal.adr_id || 'ADR pending'}` : `Building · ${goal.tasks.length} ${goal.tasks.length === 1 ? 'task' : 'tasks'}`} · {goal.source === 'github' ? 'GitHub linked' : 'Local only'}{#if goal.blocked_by?.length} · Blocked by {goal.blocked_by.join(', ')}{/if}{#if goal.status === 'closed' && goal.closed_commit_sha} · Closed in {goal.closed_commit_sha.slice(0, 7)}{/if}</small></span><span class="compact-row__status"><span class="status-dot status-dot--{goalColumn(goal)}"></span>{statusLabel(goal.status)}</span><Icon name="chevron-right" size={17} /></button>{/each}{#if visibleGoalsList.length === 0}<div class="list-empty">No goals match “{search}”.</div>{/if}</div></section>
    {:else if activeView === 'tasks'}
      <section class="secondary-view"><div class="secondary-heading"><div><h1>Tasks</h1><p>Compact list of tasks across all goals.</p></div><span class="view-readonly"><Icon name="lock" size={13} /> Read-only</span></div><div class="compact-list">{#each visibleTasksList as task}<button class="compact-row" type="button" onclick={() => openTask(task)}><span class="compact-row__icon"><span class="status-dot status-dot--{task.column}"></span></span><span class="compact-row__main"><strong>{task.title}</strong><small>{task.project_label} · {task.ref} · {task.goal_title} · {statusLabel(task.status)}{#if task.status === 'closed' && task.closed_commit_sha} · Closed in {task.closed_commit_sha.slice(0, 7)}{/if}</small></span><span class="compact-row__status">{task.source === 'github' ? 'GitHub linked' : 'Local only'}{#if task.linked_crs?.length} · {task.linked_crs.map((record) => record.id).join(', ')}{/if}</span><Icon name="chevron-right" size={17} /></button>{/each}{#if visibleTasksList.length === 0}<div class="list-empty">No tasks match “{search}”.</div>{/if}</div></section>
    {:else if activeView === 'changes'}
      <section class="secondary-view"><div class="secondary-heading"><div><h1>Change records</h1><p>Committed review packets linked to planning work.</p></div><span class="view-readonly"><Icon name="lock" size={13} /> Read-only</span></div><div class="compact-list">{#each visibleRecords as record}<button class="compact-row" type="button" onclick={() => openChangeRecord(record)}><span class="compact-row__icon"><Icon name="changes" size={18} /></span><span class="compact-row__main"><strong>{record.id}: {record.title}</strong><small>{record.project_label} · {record.type} · {record.status} · {record.covers.length} linked refs{#if record.linked_prs?.length} · {record.linked_prs.length} linked PR{record.linked_prs.length === 1 ? '' : 's'}{/if}</small></span><span class="compact-row__status">{record.status}</span><Icon name="chevron-right" size={17} /></button>{/each}{#if visibleRecords.length === 0}<div class="list-empty">No change records match “{search}”.</div>{/if}</div>{#if (board?.github_prs || []).filter((pr) => selectedProjectIds.includes(pr.project_id) && !pr.cr_ids?.length && !pr.covers?.length).length}<div class="github-unmatched"><h2>Unassociated GitHub changes</h2><p>Pull requests without explicit Clips references.</p>{#each (board?.github_prs || []).filter((pr) => selectedProjectIds.includes(pr.project_id) && !pr.cr_ids?.length && !pr.covers?.length) as pr}<a class="github-pr-row" href={prUrl(pr)} target="_blank" rel="noreferrer"><Icon name="github" size={16} /><span><strong>{prLabel(pr)}</strong><small>{pr.project_label} · {pr.repository} · {pr.state}{#if pr.merged} · merged{/if}</small></span><Icon name="link" size={14} /></a>{/each}</div>{/if}</section>
    {:else if activeView === 'change_record' && activeRecord}
      <section class="record-page">
        <div class="record-page__topbar"><button class="back-button" type="button" onclick={() => openView('changes')}><Icon name="chevron-right" size={16} /> Back to change records</button><span class="view-readonly"><Icon name="lock" size={13} /> Read-only</span></div>
        <div class="record-page__layout">
          <article class="record-document">
            <div class="record-document__eyebrow"><span class="task-ref">{activeRecord.id}</span><span class="source-label">{activeRecord.project_label}</span><span class="source-label">{activeRecord.status}</span></div>
            <MarkdownContent source={activeRecord.markdown} />
          </article>
          <aside class="record-links" aria-label="Linked planning objects">
            <div class="record-links__header"><Icon name="link" size={17} /><div><h2>Linked objects</h2><p>{activeRecord.covers.length} covered planning {activeRecord.covers.length === 1 ? 'object' : 'objects'}</p></div></div>
            {#each activeRecord.covers as ref}
              {@const object = linkedObject(ref)}
              {#if object}<button class="record-link" type="button" onclick={() => object.type === 'goal' ? openGoal(object.item) : openTask(object.item)}><span class="record-link__icon"><Icon name={object.type === 'goal' ? 'target' : 'tasks'} size={16} /></span><span class="record-link__body"><strong>{object.item.title}</strong><small>{object.item.ref} · {object.type}</small></span><Icon name="chevron-right" size={16} /></button>{:else}<div class="record-link record-link--missing"><span class="record-link__icon"><Icon name="link" size={16} /></span><span class="record-link__body"><strong>{ref}</strong><small>Object not found in local board data</small></span></div>{/if}
            {/each}
            {#if activeRecord.linked_prs?.length}<div class="record-prs"><h3>Linked GitHub PRs</h3>{#each activeRecord.linked_prs as pr}<a class="github-pr-row" href={prUrl(pr)} target="_blank" rel="noreferrer"><Icon name="github" size={16} /><span><strong>{prLabel(pr)}</strong><small>{pr.state}{#if pr.merged} · merged{/if}</small></span><Icon name="link" size={14} /></a>{/each}</div>{/if}
          </aside>
        </div>
      </section>
    {:else if activeView === 'github'}
      <section class="secondary-view"><div class="secondary-heading"><div><h1>GitHub</h1><p>Planning data linked to GitHub Issues.</p></div><span class="view-readonly"><Icon name="lock" size={13} /> Read-only</span></div>{#if linkedGoals.length}<div class="goal-list">{#each linkedGoals as goal}<button class="goal-row" type="button" onclick={() => { goalFilter = goal.ref; sourceFilter = 'github'; openView('board'); }}><span class="goal-row__icon"><Icon name="github" size={18} /></span><span><strong>{goal.title}</strong><small>{goal.project_label} · {goal.ref} · Issue #{goal.issue_number ?? '—'} · {goal.type === 'planning' ? `Planning · ${goal.adr_id || 'ADR pending'}` : `Building · ${goal.tasks.length} tasks`}</small></span><Icon name="chevron-right" size={17} /></button>{/each}</div>{:else}<div class="state-panel"><div class="state-icon"><Icon name="github" size={21} /></div><h2>No GitHub-linked goals</h2><p>Local-only goals appear in the board.</p></div>{/if}</section>
    {:else}
      <section class="secondary-view"><div class="secondary-heading"><div><h1>Settings</h1><p>Local board preferences and limits.</p></div><span class="view-readonly"><Icon name="lock" size={13} /> Read-only</span></div><div class="settings-list"><div><strong>Data source</strong><span>Local .clips/db JSONL records</span></div><div><strong>Mutations</strong><span>Disabled in this first iteration</span></div><div><strong>GitHub sync</strong><span>Not triggered by the web app</span></div><div><strong>Color theme</strong><button type="button" onclick={toggleTheme}>{themeLabel}</button></div></div></section>
    {/if}
  </main>

  {#if selectedItem}
    <div class="detail-backdrop" role="presentation" onclick={(event) => event.target === event.currentTarget && closePanel()}>
      <dialog open class="detail-panel" aria-labelledby="detail-title">
        <header class="detail-panel__header">
          <div class="detail-panel__title">
            {#if selectedItem.type === 'task' && selectedItem.parentGoal}<button class="detail-header-back" type="button" onclick={() => openGoal(selectedItem.parentGoal)} aria-label="Back to goal"><Icon name="chevron-right" size={18} /></button>{/if}
            <span>{selectedItem.type === 'task' ? 'Task details' : selectedItem.type === 'goal' ? 'Goal details' : 'Change record'}</span>
          </div>
          <button class="detail-close" type="button" onclick={closePanel} aria-label="Close detail panel"><Icon name="close" size={19} /></button>
        </header>
        <div class="detail-panel__body">
          {#if selectedItem.type === 'task'}
            <div class="detail-eyebrow"><span class="task-ref">{selectedItem.item.ref}</span><span class="status-pill status-pill--{selectedItem.item.column}"><span class="status-dot status-dot--{selectedItem.item.column}"></span>{statusLabel(selectedItem.item.status)}</span></div>
            <h2 id="detail-title">{selectedItem.item.title}</h2>
            <p class="detail-context">Part of <button type="button" onclick={() => { const goal = board?.goals?.find((candidate) => candidate.ref === selectedItem.item.goal_ref); if (goal) openGoal(goal); }}>{selectedItem.item.goal_title}</button></p>
            {#if selectedItem.item.description}<div class="detail-description"><MarkdownContent source={selectedItem.item.description} /></div>{:else}<p class="detail-description detail-description--empty">No description provided.</p>{/if}
            {#if selectedItem.item.behavior}<section class="detail-behavior"><h3>Behavior</h3><pre><code>{selectedItem.item.behavior}</code></pre></section>{/if}
            <div class="detail-meta"><div><span>Project</span><strong>{selectedItem.item.project_label}</strong></div><div><span>Status</span><strong>{statusLabel(selectedItem.item.status)}</strong></div><div><span>Verification</span><strong>{statusLabel(selectedItem.item.effective_verification_mode)}</strong></div><div><span>Source</span><strong>{selectedItem.item.source === 'github' ? 'GitHub linked' : 'Local only'}</strong></div><div><span>Reference</span><strong>{selectedItem.item.ref}</strong></div>{#if selectedItem.item.status === 'closed' && selectedItem.item.closed_commit_sha}<div><span>Closed in commit</span><strong class="commit-sha" title={selectedItem.item.closed_commit_sha}>{selectedItem.item.closed_commit_sha}</strong></div>{/if}</div>
            {#if selectedItem.item.issue_url}<a class="detail-external-link" href={selectedItem.item.issue_url} target="_blank" rel="noreferrer"><Icon name="github" size={17} /> Open linked GitHub issue</a>{/if}
            {#if selectedItem.item.linked_crs?.length}<div class="detail-task-list"><h3>Linked change records</h3>{#each selectedItem.item.linked_crs as record}<button type="button" onclick={() => openChangeRecord(record)}><Icon name="changes" size={15} /><span>{record.id}: {record.title}</span><Icon name="chevron-right" size={15} /></button>{/each}</div>{/if}
            {#if selectedItem.item.linked_prs?.length}<div class="detail-task-list"><h3>Linked GitHub PRs</h3>{#each selectedItem.item.linked_prs as pr}<a class="github-pr-row" href={prUrl(pr)} target="_blank" rel="noreferrer"><Icon name="github" size={16} /><span><strong>{prLabel(pr)}</strong><small>{pr.repository} · {pr.state}{#if pr.merged} · merged{/if}</small></span><Icon name="link" size={14} /></a>{/each}</div>{/if}
          {:else if selectedItem.type === 'goal'}
            <div class="detail-eyebrow"><span class="task-ref">{selectedItem.item.ref}</span><span class="source-label source-label--{selectedItem.item.source}"><Icon name={selectedItem.item.source === 'github' ? 'github' : 'bookmark'} size={15} />{selectedItem.item.source === 'github' ? 'GitHub linked' : 'Local only'}</span></div>
            <h2 id="detail-title">{selectedItem.item.title}</h2>
            {#if selectedItem.item.description}<div class="detail-description"><MarkdownContent source={selectedItem.item.description} /></div>{:else}<p class="detail-description detail-description--empty">No description provided.</p>{/if}
            {#if selectedItem.item.behavior}<section class="detail-behavior"><h3>Behavior</h3><pre><code>{selectedItem.item.behavior}</code></pre></section>{/if}
            <div class="detail-meta"><div><span>Project</span><strong>{selectedItem.item.project_label}</strong></div><div><span>Status</span><strong>{statusLabel(selectedItem.item.status)}</strong></div><div><span>Type</span><strong>{selectedItem.item.type === 'planning' ? 'Planning' : 'Building'}</strong></div><div><span>Verification</span><strong>{statusLabel(selectedItem.item.effective_verification_mode)}</strong></div>{#if selectedItem.item.type === 'planning'}<div><span>Planning result</span><strong>{selectedItem.item.adr_id || 'ADR pending'}</strong></div>{:else}<div><span>Tasks</span><strong>{selectedItem.item.tasks.length}</strong></div>{/if}<div><span>Reference</span><strong>{selectedItem.item.ref}</strong></div>{#if selectedItem.item.status === 'closed' && selectedItem.item.closed_commit_sha}<div><span>Closed in commit</span><strong class="commit-sha" title={selectedItem.item.closed_commit_sha}>{selectedItem.item.closed_commit_sha}</strong></div>{/if}</div>
            {#if selectedItem.item.issue_url}<a class="detail-external-link" href={selectedItem.item.issue_url} target="_blank" rel="noreferrer"><Icon name="github" size={17} /> Open linked GitHub issue</a>{/if}
            {#if selectedItem.item.type !== 'planning'}<div class="detail-task-list"><h3>Tasks in this goal</h3>{#each selectedItem.item.tasks as task}<button type="button" onclick={() => openTask(task, selectedItem.item)}><span class="status-dot status-dot--{task.column}"></span><span>{task.title}</span><Icon name="chevron-right" size={15} /></button>{/each}</div>{/if}
            {#if selectedItem.item.linked_crs?.length}<div class="detail-task-list"><h3>Linked change records</h3>{#each selectedItem.item.linked_crs as record}<button type="button" onclick={() => openChangeRecord(record)}><Icon name="changes" size={15} /><span>{record.id}: {record.title}</span><Icon name="chevron-right" size={15} /></button>{/each}</div>{/if}
            {#if selectedItem.item.linked_prs?.length}<div class="detail-task-list"><h3>Linked GitHub PRs</h3>{#each selectedItem.item.linked_prs as pr}<a class="github-pr-row" href={prUrl(pr)} target="_blank" rel="noreferrer"><Icon name="github" size={16} /><span><strong>{prLabel(pr)}</strong><small>{pr.repository} · {pr.state}{#if pr.merged} · merged{/if}</small></span><Icon name="link" size={14} /></a>{/each}</div>{/if}
          {:else}
            <div class="detail-eyebrow"><span class="task-ref">{selectedItem.item.id}</span><span class="source-label">{selectedItem.item.status}</span></div>
            <h2 id="detail-title">{selectedItem.item.title}</h2>
            <div class="detail-meta"><div><span>Type</span><strong>{selectedItem.item.type}</strong></div><div><span>Status</span><strong>{selectedItem.item.status}</strong></div><div><span>Linked refs</span><strong>{selectedItem.item.covers.length}</strong></div></div>
            <div class="detail-task-list"><h3>Linked planning objects</h3>{#each selectedItem.item.covers as ref}<button class="linked-ref" type="button" onclick={() => openCoveredRef(ref)}><Icon name="link" size={15} /><span>{ref}</span><Icon name="chevron-right" size={15} /></button>{/each}</div>
          {/if}
        </div>
      </dialog>
    </div>
  {/if}
</div>
