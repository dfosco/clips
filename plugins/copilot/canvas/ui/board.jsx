import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ChevronRightIcon, KebabHorizontalIcon, PlusIcon, ProjectIcon, SyncIcon, DotFillIcon, IssueOpenedIcon, CheckCircleIcon } from '@primer/octicons-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Empty, EmptyHeader, EmptyDescription } from '@/components/ui/empty';
import { active, executionFor, goalGroup, goalsForLane, laneForFocus, sessionsFor } from '../board-view.mjs';
import { cn } from '@/lib/utils';

const statusText = (s) => ({ in_progress: 'In progress', not_planned: 'Not planned', duplicate: 'Duplicate', closed: 'Closed', open: 'Open' })[s] || s || 'Open';
const makeUi = () => ({ search: '', filter: 'open', expanded: new Map(), descriptions: new Set(), closed: new Set() });
export function sendCapability(record, state) {
  const { sessions, status } = executionFor(record, state);
  const owners = record.kind === 'lane' ? record.manager_claim?.owners || [] : [];
  const currentId = state.hostCapabilities?.currentSessionId;
  const conflicting = (state.projectSessions || []).some((s) => (s.id || s.sessionId) === currentId && s.recordRef && (s.recordKind !== 'lane' || record.kind !== 'lane') && s.recordRef !== record.ref);
  const joined = (state.projectSessions || []).find((s) => s.joined && s.steerable && (s.id || s.sessionId) === currentId);
  const occupied = record.kind === 'task' && Boolean(state.workBindings?.[record.ref]?.length);
  const taskReady = record.kind !== 'task' || (joined?.status === 'idle' && !occupied);
  const canSend = taskReady && active(record.status) && state.hostCapabilities?.canSendToCurrentSession && !conflicting && !sessions.length && (record.kind !== 'lane' || (state.hostCapabilities?.hostIdConfigured && !owners.length && record.manager_claim && !record.manager_claim_error));
  const reason = occupied ? 'This Task already has a bound session. Open the existing session; do not launch a duplicate.' : !taskReady ? 'Task Run requires this project’s joined session with observed idle activity.' : !active(record.status) ? 'This record is not open.' : conflicting ? 'This session already owns other work. Open a separate session.' : record.kind === 'lane' && !state.hostCapabilities?.hostIdConfigured ? 'An observed host identity is required for Lane management.' : 'Work is sent to this current joined session; no session is created.';
  return { sessions, status, owners, canSend, reason, occupied };
}
function Labels({ record }) {
  return record.labels?.length ? <div className="flex flex-wrap gap-2">{record.labels.map((label) => <Badge variant="outline" key={label.id}><span className="size-2 rounded-full" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(label.color) ? label.color : 'var(--muted-foreground)' }} aria-hidden="true" />{label.name || label.id}</Badge>)}</div> : null;
}
function Description({ record, ui, toggle }) {
  const text = String(record.description || '').trim();
  if (!text) return null;
  const full = ui.descriptions.has(record.ref);
  return <div className="flex flex-col items-start gap-1"><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{text.length > 240 && !full ? text.slice(0, 240).trimEnd() + '…' : text}</p>{text.length > 240 ? <Button variant="ghost" data-description={record.ref} aria-expanded={full} onClick={() => toggle('descriptions', record.ref)}>{full ? 'Show less' : 'Show more'}</Button> : null}</div>;
}
function Actions({ record, state, busy, onAction, onMenu, onOpenSession }) {
  const { sessions, status, owners, canSend, reason } = sendCapability(record, state);
  const count = sessions.filter((s) => s.status === 'running').length;
  const label = { running: `Running · ${count} agent${count === 1 ? '' : 's'}`, attention: 'Needs input', error: 'Session error', idle: 'Session idle', unknown: 'Activity unavailable', none: owners.length ? 'Manager unavailable' : 'No bound session' }[status];
  return <div className="flex w-full flex-wrap items-center gap-2"><span className={cn('runtime-status flex items-center gap-1 text-xs text-muted-foreground', status === 'running' && 'text-foreground')}><DotFillIcon aria-hidden="true" />{label}</span>{sessions.slice(0, 1).map((s) => <Button variant="outline" key={s.id || s.sessionId} data-session={s.id || s.sessionId} disabled={busy} onClick={() => onOpenSession(s.id || s.sessionId)}>{s.joined ? 'Open current session' : 'Open session'}</Button>)}{record.kind !== 'task' && !sessions.length ? <span title={reason}><Button data-send={record.ref} disabled={busy || !canSend} aria-describedby={`send-help-${record.ref}`} onClick={() => onAction('launch', { ref: record.ref })}>{record.kind === 'lane' ? 'Use as manager' : 'Send to this session'}</Button><span className="sr-only" id={`send-help-${record.ref}`}>{reason}</span></span> : null}<Button className="ml-auto" variant="ghost" size="icon" data-menu={record.ref} aria-label={`More actions for ${record.ref}`} disabled={busy} onClick={(event) => onMenu(record.ref, event.currentTarget)}><KebabHorizontalIcon aria-hidden="true" /></Button></div>;
}
function WorkCard({ record, state, ui, toggle, tasks = [], busy, onFocus, onAction, onMenu, onOpenSession }) {
  const isExpanded = ui.expanded.get(record.ref) ?? (record.kind === 'goal' && (Boolean(ui.search.trim()) || ui.filter === 'running'));
  const props = { state, ui, toggle, busy, onFocus, onAction, onMenu, onOpenSession };
  return <Card data-record={record.ref} className="work-card min-w-0" data-kind={record.kind} data-selected={state.focus === record.ref}>
    <CardHeader>
      <CardDescription className="flex items-center gap-2"><code>{record.ref}</code><span>{statusText(record.status)}</span></CardDescription>
      <CardTitle className="flex min-w-0 items-start gap-1">
        <Button variant="ghost" size="icon" className="shrink-0" data-expand={record.ref} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${record.kind} ${record.ref}`} aria-expanded={isExpanded} disabled={busy} onClick={() => toggle('expanded', record.ref, !isExpanded)}><ChevronRightIcon className={cn('transition-transform', isExpanded && 'rotate-90')} aria-hidden="true" /></Button>
        <Button variant="record" data-lane={record.kind === 'lane' ? record.ref : undefined} data-expand={record.kind !== 'lane' ? record.ref : undefined} aria-expanded={record.kind !== 'lane' ? isExpanded : undefined} disabled={busy} onClick={() => record.kind === 'lane' ? onFocus(record.ref) : toggle('expanded', record.ref, !isExpanded)}>{record.title}</Button>
      </CardTitle>
      <Labels record={record} />
    </CardHeader>
    <CardContent className="flex flex-col gap-4">
      <Description record={record} ui={ui} toggle={toggle} />
      {isExpanded ? <>
        {record.acceptance_criteria?.length ? <section className="flex flex-col gap-2"><h3 className="text-sm font-medium">Acceptance criteria</h3>{record.acceptance_criteria.map((criterion, i) => <p className="whitespace-pre-wrap break-words text-sm leading-relaxed" key={typeof criterion === 'string' ? i : criterion.id}>{typeof criterion === 'string' ? criterion : `${criterion.id || `A${i + 1}`} · ${criterion.description}`}</p>)}</section> : null}
        {['scope', 'plan', 'decisions'].filter((field) => record[field]).map((field) => <section className="flex flex-col gap-2" key={field}><h3 className="text-sm font-medium">{field[0].toUpperCase() + field.slice(1)}</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{record[field]}</p></section>)}
        {record.blocked_by?.length ? <p className="text-sm text-muted-foreground">Blocked by {record.blocked_by.join(', ')}</p> : null}
      </> : null}
    </CardContent>
    <CardFooter><Actions record={record} state={state} busy={busy} onAction={onAction} onMenu={onMenu} onOpenSession={onOpenSession} /></CardFooter>
    {record.kind === 'goal' && isExpanded ? <div className="goal-tasks flex flex-col gap-4 px-4 pb-4">{tasks.length ? tasks.map((task) => <WorkCard key={task.ref} record={{ ...task, kind: 'task' }} {...props} />) : <Empty><EmptyHeader><EmptyDescription>{record.tasks?.length ? 'No Tasks match the current filter.' : 'No Tasks in this Goal yet.'}</EmptyDescription></EmptyHeader></Empty>}</div> : null}
  </Card>;
}
export function Board({ state, busy, onFocus, onAction, onCommand, onMenu, onOpenSession }) {
  const [ui, setUi] = useState(makeUi);
  const lastFocus = useRef(undefined);
  const scrolls = useRef(new Map());
  const columnsRef = useRef(null);
  const lane = laneForFocus(state);
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
  const goals = lane ? goalsForLane(lane, state.goals || []) : state.goals || [];
  const records = [...(lane ? [lane] : state.lanes || []).map((r) => ({ ...r, kind: 'lane' })), ...goals.map((r) => ({ ...r, kind: 'goal' })), ...goals.flatMap((g) => (g.tasks || []).map((r) => ({ ...r, kind: 'task' })))];
  const running = (kind) => records.filter((r) => r.kind === kind && executionFor(r, state).status === 'running').length;
  const runningSessions = new Set(records.flatMap((r) => sessionsFor(r, state)).filter((s) => s.status === 'running').map((s) => s.id || s.sessionId));
  const group = (parent, entries, key) => goalGroup(parent ? { ...parent, kind: 'lane' } : null, entries, ui.filter, ui.search, ui.filter !== 'open' || ui.closed.has(key), (r) => executionFor(r, state));
  const assigned = new Set((state.lanes || []).flatMap((l) => goalsForLane(l, goals).map((g) => g.ref)));
  const groups = lane ? [{ lane, goals, key: lane.ref }] : [...(state.lanes || []).map((l) => ({ lane: l, goals: goalsForLane(l, goals), key: l.ref })), { lane: null, goals: goals.filter((g) => !assigned.has(g.ref)), key: 'unassigned' }];
  const props = { state, ui, toggle, busy, onFocus, onAction, onMenu, onOpenSession };
  const closed = (key, grouped) => ui.filter === 'open' && grouped.closedGoals.length ? <Button variant="ghost" data-closed={key} aria-pressed={ui.closed.has(key)} onClick={() => toggle('closed', key)}>{ui.closed.has(key) ? 'Hide closed goals' : 'Show closed goals'}</Button> : null;
  const empty = (grouped, entries) => <Empty><EmptyHeader><EmptyDescription>{!entries.length ? 'No Goals in this Lane yet.' : grouped.canRevealClosed ? 'Closed goals are hidden.' : 'No Goals match the current filter.'}</EmptyDescription></EmptyHeader></Empty>;
  const projectName = state.selectedProject?.name || state.projectPath?.split(/[\\/]/).filter(Boolean).at(-1) || 'Choose a Clips project';
  const focusedGroup = lane ? group(lane, goals, lane.ref) : null;
  return <div className="flex flex-col gap-6" aria-busy={busy}>
    {lane ? <Button className="self-start" variant="ghost" data-back disabled={busy} onClick={() => onFocus(null)}><ArrowLeftIcon data-icon="inline-start" aria-hidden="true" />Back to Clips</Button> : null}
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="flex flex-col gap-2"><h1 className="text-2xl font-semibold tracking-tight">{lane?.title || 'Clips'}</h1><p className="text-sm text-muted-foreground">{lane ? `${lane.ref} · Goals and Tasks` : 'Plan in Clips · Execute in Copilot'}</p>{lane ? <Labels record={lane} /> : null}</div><div className="flex gap-2">{lane ? <Button variant="ghost" size="icon" aria-label="More actions for Lane" disabled={busy} onClick={(event) => onMenu(lane.ref, event.currentTarget)}><KebabHorizontalIcon aria-hidden="true" /></Button> : null}<Button variant="ghost" size="icon" data-command="refresh" aria-label="Refresh Clips" disabled={busy} onClick={() => onCommand('refresh')}><SyncIcon aria-hidden="true" /></Button><Button variant="outline" data-command="create_goal" disabled={busy} onClick={() => onCommand('create_goal')}><PlusIcon data-icon="inline-start" aria-hidden="true" />New Goal</Button></div></header>
    {lane ? <Description record={lane} ui={ui} toggle={toggle} /> : null}
    <div className="flex flex-wrap items-center gap-3"><Button variant="outline" data-command="project" aria-label="Choose a Clips project" disabled={busy} onClick={() => onCommand('project')}><ProjectIcon data-icon="inline-start" aria-hidden="true" />Clips · {projectName}</Button><span className="min-w-0 truncate text-xs text-muted-foreground" title={state.projectPath}>{state.projectPath}</span><Button variant="ghost" data-command="create_lane" disabled={busy} onClick={() => onCommand('create_lane')}><PlusIcon data-icon="inline-start" aria-hidden="true" />New Lane</Button></div>
    <Card><CardHeader><CardTitle>Running now · {running('task')} Tasks, {running('goal')} Goals, {running('lane')} Lanes</CardTitle></CardHeader><CardContent className="flex flex-col gap-4"><Field><FieldLabel htmlFor="work-search" className="sr-only">Search Clips work</FieldLabel><Input id="work-search" type="search" data-control-key="search" placeholder={lane ? 'Search this Lane’s Goals and Tasks' : 'Search Lanes, Goals and Tasks'} value={ui.search} onChange={(event) => setUi((old) => ({ ...old, search: event.target.value }))} /></Field><ToggleGroup type="single" variant="outline" value={ui.filter} aria-label="Work filter" onValueChange={(filter) => { if (filter) setUi((old) => ({ ...old, filter })); }}>{['open', 'running', 'all'].map((filter) => <ToggleGroupItem key={filter} value={filter} data-filter={filter}>{filter === 'open' ? <IssueOpenedIcon data-icon="inline-start" aria-hidden="true" /> : filter === 'all' ? <CheckCircleIcon data-icon="inline-start" aria-hidden="true" /> : <SyncIcon data-icon="inline-start" aria-hidden="true" />}{filter[0].toUpperCase() + filter.slice(1)}{filter === 'running' && runningSessions.size ? ` · ${runningSessions.size}` : ''}</ToggleGroupItem>)}</ToggleGroup></CardContent></Card>
    {lane ? closed(lane.ref, focusedGroup) : null}
    <div ref={columnsRef} key={scrollKey} className={cn('board-columns flex items-start gap-5 overflow-x-auto pb-6', lane ? 'goal-columns' : 'lane-columns')} data-scroll-key={scrollKey} aria-label={lane ? 'Lane goals' : 'Project lanes'}>
      {lane ? focusedGroup.entries.length ? focusedGroup.entries.map(({ goal, tasks }) => <section className="board-column flex w-[380px] max-w-[calc(100vw-3rem)] shrink-0 flex-col gap-4" key={goal.ref}><WorkCard record={{ ...goal, kind: 'goal' }} tasks={tasks} {...props} /></section>) : empty(focusedGroup, goals) : groups.map(({ lane: parent, goals: entries, key }) => {
        const grouped = group(parent, entries, key);
        if (!grouped.showLane) return null;
        return <section className="board-column flex w-[380px] max-w-[calc(100vw-3rem)] shrink-0 flex-col gap-4" data-lane-column={key} key={key}>{parent ? <WorkCard record={{ ...parent, kind: 'lane' }} {...props} /> : <h2 className="px-2 text-base font-semibold">Goals outside Lanes</h2>}{closed(key, grouped)}<div className="lane-goals flex flex-col gap-4">{grouped.entries.length ? grouped.entries.map(({ goal, tasks }) => <WorkCard key={goal.ref} record={{ ...goal, kind: 'goal' }} tasks={tasks} {...props} />) : empty(grouped, entries)}</div></section>;
      })}
    </div>
  </div>;
}
