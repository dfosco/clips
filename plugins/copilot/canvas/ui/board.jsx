import { useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, KebabHorizontalIcon, PlusIcon, SyncIcon, DotFillIcon, IssueOpenedIcon, CheckCircleIcon, SearchIcon } from '@primer/octicons-react';
import { ActionList, ActionMenu, Button, CounterLabel, IconButton, Label, TextInput, Tooltip } from '@primer/react';
import { active, executionFor, goalGroup, goalsForLane, laneForFocus, sessionsFor } from '../board-view.mjs';
import { associationLabel, isOngoingSession, sessionName } from '../model.mjs';
import './board.css';

const statusText = (s) => ({ in_progress: 'In progress', not_planned: 'Not planned', duplicate: 'Duplicate', closed: 'Closed', open: 'Open' })[s] || s || 'Open';
const makeUi = () => ({ search: '', filter: 'open', expanded: new Map(), closed: new Set() });
const activityLabel = (status) => ({ running: 'Running', attention: 'Needs input', error: 'Session error', idle: 'Idle' })[status] || '';
const openSessionLabel = (session, ref) => `Go to session ${sessionName(session)} (${session.id || session.sessionId}) for ${ref}`;
function StatusLabel({ record }) {
  return <Label size="small" variant={{ in_progress: 'success', open: 'accent', closed: 'done' }[record.status] || 'secondary'} data-record-status={record.ref} data-status={record.status}>{statusText(record.status)}</Label>;
}
export function sendCapability(record, state) {
  const { sessions, associations, status } = executionFor(record, state);
  const owners = record.kind === 'lane' ? record.manager_claim?.owners || [] : [];
  const canSend = active(record.status) && state.hostCapabilities?.canSendToCurrentSession;
  const reason = !active(record.status) ? 'This record is not open.' : !state.hostCapabilities?.canSendToCurrentSession ? 'Running work requires the current joined session.' : 'Run in the currently opened session. Existing associations and Lane claims are advisory; no claim or new session is created.';
  return { sessions, associations, status, owners, canSend, reason };
}
function Labels({ record }) {
  return record.labels?.length ? <div className="clips-board-labels">{record.labels.map((label) => <Label className="clips-board-label" key={label.id}><span className="clips-board-label-dot" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(label.color) ? label.color : 'var(--fgColor-muted)' }} aria-hidden="true" />{label.name || label.id}</Label>)}</div> : null;
}
function Description({ record, expanded }) {
  const text = String(record.description || '').trim();
  if (!text) return null;
  return <div className="clips-board-description"><p>{text.length > 240 && !expanded ? text.slice(0, 240).trimEnd() + '…' : text}</p></div>;
}
function BoardIconButton({ 'aria-label': label, ...props }) {
  return <Tooltip text={label} type="description"><IconButton aria-label={label} {...props} /></Tooltip>;
}
function NewMenu({ busy, lane, onCommand }) {
  const trigger = useRef(null);
  return <ActionMenu anchorRef={trigger}>
    <ActionMenu.Anchor><Button size="medium" leadingVisual={PlusIcon} data-command="new" disabled={busy}>New</Button></ActionMenu.Anchor>
    <ActionMenu.Overlay align="end" variant={{ regular: 'anchored', narrow: 'anchored' }}><ActionList>
      {['lane', 'goal', 'task'].map((kind) => <ActionList.Item key={kind} data-command={`create_${kind}`} disabled={busy} onSelect={() => onCommand(`create_${kind}`, trigger.current, kind === 'goal' && lane ? { lane_id: lane.ref } : undefined)}>New {kind[0].toUpperCase() + kind.slice(1)}</ActionList.Item>)}
    </ActionList></ActionMenu.Overlay>
  </ActionMenu>;
}
function RecordMenu({ record, state, busy, onMenu, onFocus, onAction, onOpenSession, onAddGoal, closedVisible, onToggleClosed }) {
  const trigger = useRef(null);
  const actionPending = useRef(false);
  const { sessions, canSend, reason } = sendCapability(record, state);
  const form = (action) => onMenu(record.ref, trigger.current, action);
  const runAndReturnFocus = async (action) => {
    if (actionPending.current) return;
    actionPending.current = true;
    try { await action(); }
    finally { actionPending.current = false; requestAnimationFrame(() => { if (trigger.current?.isConnected && !trigger.current.disabled) trigger.current.focus(); }); }
  };
  return <ActionMenu anchorRef={trigger}>
    <ActionMenu.Anchor><Tooltip text={`More actions for ${record.ref}`} type="description"><IconButton variant="invisible" size="small" icon={KebabHorizontalIcon} data-menu={record.ref} aria-label={`More actions for ${record.ref}`} disabled={busy} /></Tooltip></ActionMenu.Anchor>
    <ActionMenu.Overlay align="end" variant={{ regular: 'anchored', narrow: 'anchored' }}><ActionList>
      <ActionList.Item data-run={record.ref} data-task-run={record.kind === 'task' ? record.ref : undefined} title={reason} disabled={busy || !canSend} onSelect={() => runAndReturnFocus(() => onAction('launch', { ref: record.ref }))}>Run in this session</ActionList.Item>
      {sessions.filter(isOngoingSession).map((session) => <ActionList.Item key={session.id || session.sessionId} data-session={session.id || session.sessionId} data-task-open-session={record.kind === 'task' ? session.id || session.sessionId : undefined} aria-label={openSessionLabel(session, record.ref)} disabled={busy} onSelect={() => runAndReturnFocus(() => onOpenSession(session.id || session.sessionId))}>Go to session<ActionList.Description>{sessionName(session)}</ActionList.Description></ActionList.Item>)}
      <ActionList.Divider />
      {onToggleClosed ? <ActionList.Item disabled={busy} data-closed={record.ref} onSelect={onToggleClosed}>{closedVisible ? 'Hide closed goals' : 'Show closed goals'}</ActionList.Item> : null}
      {onAddGoal ? <ActionList.Item disabled={busy} onSelect={() => onAddGoal(trigger.current)}>New Goal</ActionList.Item> : null}
      <ActionList.Item disabled={busy} onSelect={() => form('status')}>Update status</ActionList.Item>
      <ActionList.Item disabled={busy} onSelect={() => form('labels')}>Labels</ActionList.Item>
      {record.kind === 'lane' ? <ActionList.Item disabled={busy} data-lane={record.ref} onSelect={() => onFocus(record.ref)}>Focus Lane</ActionList.Item> : null}
      {record.kind === 'goal' ? <><ActionList.Item disabled={busy} onSelect={() => form('create_task')}>New Task</ActionList.Item><ActionList.Divider /><ActionList.Item variant="danger" disabled={busy || record.status === 'closed'} onSelect={() => form('close')}>Close Goal</ActionList.Item></> : null}
    </ActionList></ActionMenu.Overlay>
  </ActionMenu>;
}
function Activity({ record, state }) {
  const { sessions, associations, status } = executionFor(record, state);
  if (!associations.length || !activityLabel(status)) return null;
  const count = sessions.filter((s) => s.status === 'running').length;
  const label = `${sessions.length} listed · ${status === 'running' ? `Running: ${count}` : activityLabel(status)}`;
  return <p className="clips-board-runtime runtime-status" data-activity={status}><DotFillIcon aria-hidden="true" /><span>Direct {record.kind} associations: {label}</span></p>;
}
function SessionAssociations({ associations }) {
  return associations.filter(({ session }) => session).map(({ sessionId, sources, session }) => {
    const provenance = sources.map((source) => source === 'manager_claim' ? 'Lane manager session' : associationLabel([source])).join(' + ');
    const details = [provenance, session ? activityLabel(session.status) : '', session?.joined ? 'Current session' : ''].filter(Boolean).join(' · ');
    return <div key={sessionId} className="clips-board-session-association" data-association={sessionId}>
      <span className="clips-board-session-title">{sessionName(session)}</span>
      {details ? <span className="clips-board-session-provenance">{details}</span> : null}
    </div>;
  });
}
function WorkCard({ record, state, ui, toggle, tasks = [], busy, onFocus, onAction, onMenu, onOpenSession, count, onAddGoal, onToggleClosed }) {
  const detailsToggle = useRef(null);
  const isExpanded = ui.expanded.get(record.ref) ?? (record.kind === 'goal' && (Boolean(ui.search.trim()) || ui.filter === 'running'));
  const props = { state, ui, toggle, busy, onFocus, onAction, onMenu, onOpenSession };
  const isLane = record.kind === 'lane';
  const Container = isLane ? 'header' : 'article';
  const Heading = isLane ? 'div' : 'header';
  const { associations } = executionFor(record, state);
  const hasDetails = Boolean(String(record.description || '').trim().length > 240 || record.acceptance_criteria?.length || record.scope || record.plan || record.decisions || record.blocked_by?.length || record.kind === 'goal');
  const collapseDetails = () => {
    toggle('expanded', record.ref, false);
    requestAnimationFrame(() => { if (detailsToggle.current?.isConnected && !detailsToggle.current.disabled) detailsToggle.current.focus(); });
  };
  return <Container data-record={record.ref} className={isLane ? 'clips-board-lane-header' : 'clips-work-card work-card'} data-kind={record.kind} data-selected={state.focus === record.ref}>
    <Heading className="clips-work-card-header">
      <div className="clips-work-card-meta-row">
        <div className="clips-work-card-meta"><code>{record.ref}</code><StatusLabel record={record} /></div>
        <RecordMenu record={record} state={state} busy={busy} onAction={onAction} onMenu={onMenu} onFocus={onFocus} onOpenSession={onOpenSession} onAddGoal={onAddGoal} closedVisible={ui.closed.has(record.ref)} onToggleClosed={onToggleClosed} />
      </div>
      <div className="clips-work-card-title-row">
        <h2 className="clips-work-card-title">{record.title}</h2>
        {isLane ? <CounterLabel className="clips-board-lane-count" aria-label={`${count} visible Goals`}>{count}</CounterLabel> : null}
      </div>
      <Labels record={record} />
    </Heading>
    {hasDetails && isExpanded ? <div className="clips-board-details-toggle"><Button ref={detailsToggle} variant="invisible" size="small" disabled={busy} data-description={record.ref} data-expand={record.ref} data-expand-position="top" aria-expanded onClick={collapseDetails}>Show less</Button></div> : null}
    <div className="clips-work-card-content">
      <Description record={record} expanded={isExpanded} />
      <Activity record={record} state={state} />
      {isExpanded ? <>
        {record.acceptance_criteria?.length ? <section><h3>Acceptance criteria</h3>{record.acceptance_criteria.map((criterion, i) => <p key={typeof criterion === 'string' ? i : criterion.id}>{typeof criterion === 'string' ? criterion : `${criterion.id || `A${i + 1}`} · ${criterion.description}`}</p>)}</section> : null}
        {['scope', 'plan', 'decisions'].filter((field) => record[field]).map((field) => <section key={field}><h3>{field[0].toUpperCase() + field.slice(1)}</h3><p>{record[field]}</p></section>)}
        {record.blocked_by?.length ? <p>Blocked by {record.blocked_by.join(', ')}</p> : null}
      </> : null}
    </div>
    {hasDetails && !isExpanded ? <div className="clips-board-details-toggle"><Button ref={detailsToggle} variant="invisible" size="small" disabled={busy} data-description={record.ref} data-expand={record.ref} data-expand-position="collapsed" aria-expanded={false} onClick={() => toggle('expanded', record.ref, true)}>Show more</Button></div> : null}
    {record.kind === 'goal' && isExpanded ? <div className="clips-board-goal-tasks goal-tasks">{tasks.length ? tasks.map((task) => <WorkCard key={task.ref} record={{ ...task, kind: 'task' }} {...props} />) : <p className="clips-board-empty">{record.tasks?.length ? 'No Tasks match the current filter.' : 'No Tasks in this Goal yet.'}</p>}</div> : null}
    {hasDetails && isExpanded ? <div className="clips-board-details-toggle"><Button variant="invisible" size="small" disabled={busy} data-description={record.ref} data-expand={record.ref} data-expand-position="bottom" aria-expanded onClick={collapseDetails}>Show less</Button></div> : null}
    {associations.some(({ session }) => session) ? <footer className="clips-board-actions record-actions"><SessionAssociations associations={associations} /></footer> : null}
  </Container>;
}
export function fitProjectTabs(widths, available, moreWidth, selectedMoreWidth, iconWidth, selectedIndex) {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= available) return { count: widths.length, icon: false };
  const fit = (reserved) => {
    let count = 0, used = reserved;
    while (count < widths.length && used + widths[count] <= available) used += widths[count++];
    return count;
  };
  const icon = moreWidth > available;
  let count = fit(icon ? iconWidth : moreWidth);
  if (!icon && selectedIndex >= count) {
    if (selectedMoreWidth > available) return { count: fit(iconWidth), icon: true };
    count = fit(selectedMoreWidth);
  }
  return { count, icon };
}
export function ProjectTabs({ projects = [], selectedProjectId, busy, onSelectProject }) {
  const navigationId = useId();
  const nav = useRef(null);
  const probes = useRef(null);
  const overflowTrigger = useRef(null);
  const pendingFocus = useRef(null);
  const selectionPending = useRef(false);
  const [layout, setLayout] = useState({ count: 0, icon: true });
  const layoutRef = useRef(layout);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const selectedIndex = projects.findIndex((project) => project.id === selectedProjectId);
  const selectedHidden = selectedIndex >= layout.count && selectedIndex !== -1;
  const visible = projects.slice(0, layout.count);
  const hidden = projects.slice(layout.count);
  useLayoutEffect(() => {
    if (!nav.current || !probes.current) return;
    let disposed = false;
    const measure = () => {
      if (disposed) return;
      const width = (selector) => probes.current.querySelector(selector).getBoundingClientRect().width;
      const widths = [...probes.current.querySelectorAll('[data-project-measure]')].map((probe) => probe.getBoundingClientRect().width);
      const next = fitProjectTabs(widths, nav.current.getBoundingClientRect().width, width('[data-project-measure-more="normal"]'), width('[data-project-measure-more="selected"]'), width('[data-project-measure-plus]'), selectedIndex);
      if (next.count === layoutRef.current.count && next.icon === layoutRef.current.icon) return;
      const focused = document.activeElement;
      if (focused?.getAttribute('data-project-navigation') === navigationId) pendingFocus.current = { projectId: focused.getAttribute('data-project-id') || selectedProjectId, overflow: focused === overflowTrigger.current };
      layoutRef.current = next;
      setOverflowOpen(false);
      setLayout(next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(nav.current);
    for (const probe of probes.current.children) observer.observe(probe);
    document.fonts?.addEventListener('loadingdone', measure);
    document.fonts?.ready.then(measure);
    measure();
    return () => { disposed = true; observer.disconnect(); document.fonts?.removeEventListener('loadingdone', measure); };
  }, [projects, selectedProjectId, selectedIndex, navigationId]);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const { projectId, overflow } = pendingFocus.current;
    pendingFocus.current = null;
    const tab = [...nav.current.querySelectorAll('[data-project-id]')].find((element) => element.getAttribute('data-project-id') === projectId);
    ((overflow ? overflowTrigger.current : null) || tab || overflowTrigger.current || nav.current.querySelector('[data-project-id]'))?.focus();
  }, [layout]);
  const selectProject = async (projectId, trigger) => {
    if (selectionPending.current) return;
    selectionPending.current = true;
    try { await onSelectProject(projectId, trigger); }
    finally { selectionPending.current = false; }
  };
  const overflowLabel = selectedHidden ? `More projects, selected project ${projects[selectedIndex].name}` : 'More projects';
  const overflowProps = {
    className: `clips-board-project-tab${layout.icon ? ' clips-board-project-overflow-icon' : ''}`,
    variant: 'invisible', size: 'small', disabled: busy,
    'data-project-overflow': layout.icon ? 'plus' : 'more',
    'data-project-navigation': navigationId,
    'data-project-tab': selectedHidden ? selectedProjectId : 'overflow',
    'aria-current': selectedHidden ? 'page' : undefined,
    'aria-label': overflowLabel,
  };
  return projects.length ? <nav ref={nav} className="clips-board-project-tabs" aria-label="Clips projects" data-project-strip>
    <div ref={probes} className="clips-board-project-tab-measurements" aria-hidden="true" inert>
      {projects.map((project) => <span className="clips-board-project-tab" data-project-measure={project.id} data-selected={project.id === selectedProjectId} key={project.id}>{project.name}</span>)}
      <span className="clips-board-project-tab" data-project-measure-more="normal">More</span>
      <span className="clips-board-project-tab" data-project-measure-more="selected" data-selected="true">More</span>
      <span className="clips-board-project-tab clips-board-project-overflow-icon" data-project-measure-plus><PlusIcon /></span>
    </div>
    <ul className="clips-board-project-tabs-list">
      {visible.map((project) => <li className="clips-board-project-tab-item" data-selected={project.id === selectedProjectId} key={project.id}><Button className="clips-board-project-tab" variant="invisible" size="small" type="button" disabled={busy} data-project-navigation={navigationId} data-project-id={project.id} data-project-tab={project.id} aria-current={project.id === selectedProjectId ? 'page' : undefined} onClick={(event) => selectProject(project.id, event.currentTarget)}>{project.name}</Button></li>)}
      {hidden.length ? <li className="clips-board-project-tab-item" data-selected={selectedHidden}>
        <ActionMenu anchorRef={overflowTrigger} open={overflowOpen} onOpenChange={setOverflowOpen}>
          <ActionMenu.Anchor>{layout.icon ? <Tooltip text={overflowLabel} type="description"><IconButton {...overflowProps} icon={PlusIcon} /></Tooltip> : <Button {...overflowProps} type="button">More</Button>}</ActionMenu.Anchor>
          <ActionMenu.Overlay align="end" variant={{ regular: 'anchored', narrow: 'anchored' }}><ActionList selectionVariant="single" aria-label="More Clips projects" data-project-overflow-menu>
            {hidden.map((project) => <ActionList.Item key={project.id} selected={project.id === selectedProjectId} disabled={busy} data-project-id={project.id} data-project-navigation={navigationId} data-project-overflow-item={project.id} onSelect={() => selectProject(project.id, overflowTrigger.current)}>{project.name}</ActionList.Item>)}
          </ActionList></ActionMenu.Overlay>
        </ActionMenu>
      </li> : null}
    </ul>
  </nav> : null;
}
export function Board({ state, busy, projects = [], onSelectProject, canInitializeCurrentDirectory = false, onInitializeCurrentDirectory, onFocus, onAction, onCommand, onMenu, onOpenSession }) {
  const [ui, setUi] = useState(makeUi);
  const lastFocus = useRef(undefined);
  const scrolls = useRef(new Map());
  const columnsRef = useRef(null);
  const laneDetailsToggle = useRef(null);
  const lane = laneForFocus(state);
  const laneAssociations = lane ? executionFor({ ...lane, kind: 'lane' }, state).associations : [];
  const scrollKey = lane ? `goals:${lane.ref}` : 'lanes';
  useLayoutEffect(() => {
    const node = columnsRef.current;
    node.scrollLeft = scrolls.current.get(scrollKey) || 0;
    return () => { scrolls.current.set(scrollKey, node.scrollLeft); };
  }, [scrollKey]);
  useLayoutEffect(() => {
    const goal = (state.goals || []).find((g) => g.ref === state.focus || (g.tasks || []).some((t) => t.ref === state.focus));
    if (goal && state.focus !== lastFocus.current) setUi((old) => {
      const selected = (goal.tasks || []).find((t) => t.ref === state.focus);
      const next = { ...old, search: '', filter: 'open', expanded: new Map(old.expanded), closed: new Set(old.closed) };
      next.expanded.set(goal.ref, true); if (selected) next.expanded.set(selected.ref, true);
      if ([goal, selected].some((r) => r && !active(r.status) && r.status !== 'closed')) next.filter = 'all';
      else if (goal.status === 'closed' || selected?.status === 'closed') next.closed.add(lane?.ref || 'unassigned');
      return next;
    });
    lastFocus.current = state.focus;
  }, [state.focus, state.goals, lane?.ref]);
  const toggle = (field, ref, value) => setUi((old) => {
    const collection = field === 'expanded' ? new Map(old[field]) : new Set(old[field]);
    if (field === 'expanded') collection.set(ref, value); else collection.has(ref) ? collection.delete(ref) : collection.add(ref);
    return { ...old, [field]: collection };
  });
  const collapseLaneDetails = () => {
    toggle('expanded', lane.ref, false);
    requestAnimationFrame(() => { if (laneDetailsToggle.current?.isConnected && !laneDetailsToggle.current.disabled) laneDetailsToggle.current.focus(); });
  };
  const goals = lane ? goalsForLane(lane, state.goals || []) : state.goals || [];
  const records = [...(lane ? [lane] : state.lanes || []).map((r) => ({ ...r, kind: 'lane' })), ...goals.map((r) => ({ ...r, kind: 'goal' })), ...goals.flatMap((g) => (g.tasks || []).map((r) => ({ ...r, kind: 'task' })))];
  const runningSessions = new Set(records.flatMap((r) => sessionsFor(r, state)).filter((s) => s.status === 'running').map((s) => s.id || s.sessionId));
  const group = (parent, entries, key) => goalGroup(parent ? { ...parent, kind: 'lane' } : null, entries, ui.filter, ui.search, ui.filter !== 'open' || ui.closed.has(key), (r) => executionFor(r, state));
  const assigned = new Set((state.lanes || []).flatMap((l) => goalsForLane(l, goals).map((g) => g.ref)));
  const groups = lane ? [{ lane, goals, key: lane.ref }] : [...(state.lanes || []).map((l) => ({ lane: l, goals: goalsForLane(l, goals), key: l.ref })), { lane: null, goals: goals.filter((g) => !assigned.has(g.ref)), key: 'unassigned' }];
  const props = { state, ui, toggle, busy, onFocus, onAction, onMenu, onOpenSession };
  const closed = (key, grouped) => ui.filter === 'open' && grouped.closedGoals.length ? <Button variant="invisible" size="small" data-closed={key} aria-pressed={ui.closed.has(key)} onClick={() => toggle('closed', key)}>{ui.closed.has(key) ? 'Hide closed goals' : 'Show closed goals'}</Button> : null;
  const empty = (grouped, entries) => grouped.canRevealClosed ? null : <p className="clips-board-empty">{!entries.length ? 'No Goals in this Lane yet.' : 'No Goals match the current filter.'}</p>;
  const focusedGroup = lane ? group(lane, goals, lane.ref) : null;
  return <div className="clips-board" aria-busy={busy}>
    <header className="clips-board-project-header">
      <div className="clips-board-project-heading">
        {lane ? <Button variant="invisible" size="medium" leadingVisual={ArrowLeftIcon} data-back disabled={busy} onClick={() => onFocus(null)}>Back to Clips</Button> : null}
        <h1>{lane ? lane.title : 'Clips'}</h1>
        <p className="clips-board-project-context" title={state.projectPath}>{lane ? `${lane.ref} · Goals and Tasks` : state.projectPath}</p>
      </div>
      <div className="clips-board-project-actions">
        {lane ? <RecordMenu record={{ ...lane, kind: 'lane' }} state={state} busy={busy} onMenu={onMenu} onFocus={onFocus} onAction={onAction} onOpenSession={onOpenSession} onAddGoal={(trigger) => onCommand('create_goal', trigger, { lane_id: lane.ref })} closedVisible={ui.closed.has(lane.ref)} onToggleClosed={ui.filter === 'open' && focusedGroup.closedGoals.length ? () => toggle('closed', lane.ref) : undefined} /> : null}
        <BoardIconButton variant="invisible" size="medium" icon={SyncIcon} data-command="refresh" aria-label="Refresh Clips" disabled={busy} onClick={(event) => onCommand('refresh', event.currentTarget)} />
        {canInitializeCurrentDirectory && onInitializeCurrentDirectory ? <Button variant="invisible" size="medium" leadingVisual={PlusIcon} data-command="initialize" disabled={busy} onClick={(event) => onInitializeCurrentDirectory(event.currentTarget)}>Initialize Clips</Button> : null}
        <NewMenu busy={busy} lane={lane} onCommand={onCommand} />
      </div>
      {lane ? <div className="clips-board-lane-context">
        <StatusLabel record={lane} /><Labels record={lane} />
        {lane.description && ui.expanded.get(lane.ref) ? <div className="clips-board-details-toggle"><Button ref={laneDetailsToggle} variant="invisible" size="small" disabled={busy} data-description={lane.ref} data-expand={lane.ref} data-expand-position="top" aria-expanded onClick={collapseLaneDetails}>Show less</Button></div> : null}
        <Description record={lane} expanded={ui.expanded.get(lane.ref)} />
        {lane.description && !ui.expanded.get(lane.ref) ? <div className="clips-board-details-toggle"><Button ref={laneDetailsToggle} variant="invisible" size="small" disabled={busy} data-description={lane.ref} data-expand={lane.ref} data-expand-position="collapsed" aria-expanded={false} onClick={() => toggle('expanded', lane.ref, true)}>Show more</Button></div> : null}
        {lane.description && ui.expanded.get(lane.ref) ? <div className="clips-board-details-toggle"><Button variant="invisible" size="small" disabled={busy} data-description={lane.ref} data-expand={lane.ref} data-expand-position="bottom" aria-expanded onClick={collapseLaneDetails}>Show less</Button></div> : null}
        {laneAssociations.some(({ session }) => session) ? <div data-lane-session-context={lane.ref}><Activity record={{ ...lane, kind: 'lane' }} state={state} /><div className="clips-board-action-buttons"><SessionAssociations associations={laneAssociations} /></div></div> : null}
      </div> : null}
    </header>
    {!lane ? <div className="clips-board-view-bar"><ProjectTabs projects={projects} selectedProjectId={state.selectedProject?.id} busy={busy} onSelectProject={onSelectProject} /></div> : null}
    <div className="clips-board-toolbar">
      <TextInput block className="clips-board-search" id="work-search" type="search" data-control-key="search" aria-label="Search Clips work" leadingVisual={SearchIcon} placeholder={lane ? 'Search this Lane’s Goals and Tasks' : 'Search Lanes, Goals and Tasks'} value={ui.search} onChange={(event) => setUi((old) => ({ ...old, search: event.target.value }))} />
      <div className="clips-board-filters" role="radiogroup" aria-label="Work filter">{['open', 'running', 'all'].map((filter, index, filters) => <Button key={filter} size="medium" variant={ui.filter === filter ? 'default' : 'invisible'} role="radio" aria-checked={ui.filter === filter} tabIndex={ui.filter === filter ? 0 : -1} data-filter={filter} title={filter === 'running' ? 'Records associated with sessions observed running; associations do not prove record execution.' : undefined} leadingVisual={filter === 'open' ? IssueOpenedIcon : filter === 'all' ? CheckCircleIcon : SyncIcon} onClick={() => setUi((old) => ({ ...old, filter }))} onKeyDown={(event) => {
        const next = { ArrowRight: (index + 1) % filters.length, ArrowDown: (index + 1) % filters.length, ArrowLeft: (index + filters.length - 1) % filters.length, ArrowUp: (index + filters.length - 1) % filters.length, Home: 0, End: filters.length - 1 }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        setUi((old) => ({ ...old, filter: filters[next] }));
        event.currentTarget.parentElement.querySelector(`[data-filter="${filters[next]}"]`).focus();
      }}>{filter === 'running' ? 'Running sessions' : filter[0].toUpperCase() + filter.slice(1)}{filter === 'running' && runningSessions.size ? ` · ${runningSessions.size}` : ''}</Button>)}</div>
    </div>
    <div ref={columnsRef} key={scrollKey} className={`clips-board-columns board-columns ${lane ? 'goal-columns' : 'lane-columns'}`} data-scroll-key={scrollKey} aria-label={lane ? 'Lane goals' : 'Project lanes'}>
      {lane ? focusedGroup.entries.length ? focusedGroup.entries.map(({ goal, tasks }) => <section className="clips-board-column board-column" aria-label={goal.title} key={goal.ref}><WorkCard record={{ ...goal, kind: 'goal' }} tasks={tasks} {...props} /></section>) : empty(focusedGroup, goals) : groups.map(({ lane: parent, goals: entries, key }) => {
        const grouped = group(parent, entries, key);
        if (!grouped.showLane) return null;
        const addGoal = (trigger) => onCommand('create_goal', trigger, { lane_id: parent?.ref || '' });
        return <section className="clips-board-column clips-board-lane-column board-column" data-lane-column={key} key={key} aria-label={parent ? `Lane ${parent.title}` : 'Goals outside Lanes'}>
          {parent ? <WorkCard record={{ ...parent, kind: 'lane' }} count={grouped.entries.length} onAddGoal={addGoal} onToggleClosed={ui.filter === 'open' && grouped.closedGoals.length ? () => toggle('closed', key) : undefined} {...props} /> : <header className="clips-board-lane-header clips-board-unassigned-header"><h2>Goals outside Lanes</h2><CounterLabel aria-label={`${grouped.entries.length} visible Goals`}>{grouped.entries.length}</CounterLabel><BoardIconButton variant="invisible" size="small" icon={PlusIcon} aria-label="New Goal outside Lanes" disabled={busy} onClick={(event) => addGoal(event.currentTarget)} /></header>}
          {!parent ? closed(key, grouped) : null}
          <div className="clips-board-lane-goals lane-goals">{grouped.entries.length ? grouped.entries.map(({ goal, tasks }) => <WorkCard key={goal.ref} record={{ ...goal, kind: 'goal' }} tasks={tasks} {...props} />) : empty(grouped, entries)}</div>
        </section>;
      })}
    </div>
  </div>;
}
