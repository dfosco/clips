import { useEffect, useRef, useState } from 'react';
import { ProjectIcon, SyncIcon } from '@primer/octicons-react';
import { Banner, Button, CounterLabel, Dialog, FormControl, Heading, Select, Spinner, Text, TextInput, Textarea } from '@primer/react';
import { Board, ProjectTabs } from './board';
import { createActions } from './actions';
import { sessionName } from '../model.mjs';
import './app.css';

function Feedback({ children, variant = 'info', title }) {
  return <Banner variant={variant} layout="compact" title={title || children} description={title ? children : undefined} role={variant === 'critical' ? 'alert' : 'status'} />;
}

function EmptyState({ title, children }) {
  return <div className="clips-app-empty"><ProjectIcon size={24} aria-hidden="true" /><Heading as="h2" className="clips-app-empty-title">{title}</Heading><Text as="p" className="clips-app-muted">{children}</Text></div>;
}

export function App({ call, navigate = (url) => window.top.location.assign(url) }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [discovery, setDiscovery] = useState(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [initializing, setInitializing] = useState(false);
  const stateRef = useRef(null);
  const discoveryRequest = useRef(0);
  const refreshRequest = useRef(0);
  const initializationPending = useRef(false);
  const dialogTrigger = useRef(null);
  const dialogInitialFocus = useRef(null);
  const dialogWasOpen = useRef(false);
  const actions = useRef(null);
  if (!actions.current) actions.current = createActions({ call, onState(next) {
    if (stateRef.current?.projectPath !== next?.projectPath) setDialog(null);
    stateRef.current = next; setState(next); setError(''); setLoaded(true);
  }, onError: (message) => { setError(message); setLoaded(true); }, onPending: (n) => setBusy(n > 0), onNotice: setNotice });
  const act = actions.current.act;
  const openDialog = (next, trigger = document.activeElement) => { dialogTrigger.current = trigger; setError(''); setDialog(next); };
  async function discover() {
    const request = ++discoveryRequest.current;
    setDiscoveryBusy(true); setDiscoveryError('');
    try {
      const result = await call('list_projects');
      if (request !== discoveryRequest.current) return null;
      setDiscovery(result);
      return result;
    } catch (err) {
      if (request === discoveryRequest.current) { setDiscovery(null); setDiscoveryError(err.message); }
      return null;
    } finally {
      if (request === discoveryRequest.current) setDiscoveryBusy(false);
    }
  }
  async function refreshBoard() {
    const request = ++refreshRequest.current;
    setRefreshing(true);
    try {
      await Promise.all([act('refresh'), discover()]);
    } finally {
      if (request === refreshRequest.current) setRefreshing(false);
    }
  }
  function focusProjectTab(projectId, trigger) {
    requestAnimationFrame(() => {
      if (projectId && stateRef.current?.selectedProject?.id !== projectId) return;
      const tab = trigger?.isConnected ? trigger : Array.from(document.querySelectorAll('[data-project-tab]')).find((item) => item.dataset.projectTab === projectId);
      tab?.focus();
    });
  }
  async function selectProject(projectId, trigger) {
    const result = await act('set_project', { projectId });
    if (trigger?.hasAttribute('data-project-tab')) focusProjectTab(result ? projectId : null, trigger);
    if (result) {
      setDialog(null);
      await discover();
    }
    return result;
  }
  async function initializeCurrentDirectory() {
    if (initializationPending.current) return;
    initializationPending.current = true;
    setInitializing(true);
    let initializedProjectId;
    try {
      const result = await act('initialize_current_directory');
      if (result) {
        initializedProjectId = result.projectId;
        setDialog(null);
        setNotice('Lanes initialized in the current session directory.');
        await discover();
      }
    } finally {
      initializationPending.current = false;
      setInitializing(false);
      if (initializedProjectId) focusProjectTab(initializedProjectId);
    }
  }
  useEffect(() => {
    void refreshBoard();
    const interval = setInterval(() => { if (!document.hidden) void refreshBoard(); }, 20000);
    return () => { ++discoveryRequest.current; clearInterval(interval); };
  }, []);
  const works = [...(state?.lanes || []).map((r) => ({ ...r, kind: 'lane' })), ...(state?.goals || []).map((r) => ({ ...r, kind: 'goal' })), ...(state?.goals || []).flatMap((g) => (g.tasks || []).map((r) => ({ ...r, kind: 'task', goal_ref: g.ref })))];
  const work = works.find((r) => r.ref === dialog?.ref);
  const taskWithoutGoals = dialog?.kind === 'create' && dialog.createKind === 'task' && !state?.goals?.length;
  function openRecordForm(ref, trigger, action) {
    if (action === 'create_task') openDialog({ kind: 'create', createKind: 'task', parentRef: ref }, trigger);
    else if (['status', 'labels', 'close'].includes(action)) openDialog({ kind: action, ref }, trigger);
    else setError('This record action is not supported.');
  }
  async function openSession(sessionId) { try { navigate((await call('open_session', { sessionId, expectedProjectPath: stateRef.current?.projectPath })).url); } catch (err) { setError(err.message); } }
  async function readAttachment(ref, attachmentId) {
    const projectPath = stateRef.current?.projectPath;
    if (!projectPath) throw new Error('Choose an available Lanes project before reading attachments.');
    return call('read_attachment', { ref, attachmentId, expectedProjectPath: projectPath });
  }
  function command(command, trigger, context = {}) {
    if (command === 'refresh') return void refreshBoard();
    if (command.startsWith('create_')) openDialog({ kind: 'create', createKind: command.slice(7), parentRef: context.lane_id }, trigger);
  }
  async function submit(event) {
    event.preventDefault();
    if (taskWithoutGoals) {
      setError('Create a Goal before creating a Task.');
      return;
    }
    // Primer text controls expose aria-required without native constraint validation.
    const missing = Array.from(event.currentTarget.elements).find((control) => control.getAttribute('aria-required') === 'true' && !control.value.trim());
    if (missing) {
      setError('Complete the required fields before continuing.');
      missing.focus();
      return;
    }
    const form = Object.fromEntries(new FormData(event.currentTarget));
    if (dialog.kind === 'create' && dialog.createKind === 'task' && !stateRef.current?.goals?.some((goal) => goal.ref === form.parent)) {
      setError('Choose an available Goal before creating a Task.');
      event.currentTarget.elements.namedItem('parent')?.focus();
      return;
    }
    let action; let input;
    if (dialog.kind === 'status') { action = 'set_status'; input = { ref: work.ref, status: form.status }; }
    else if (dialog.kind === 'close') { action = 'set_status'; input = { ref: work.ref, status: 'closed' }; }
    else if (dialog.kind === 'labels') { action = event.nativeEvent.submitter?.dataset.operation === 'remove' ? 'remove_label' : 'add_label'; input = { ref: work.ref, labelId: event.nativeEvent.submitter?.dataset.operation === 'remove' ? form.assigned : form.label }; }
    else if (dialog.kind === 'steer') { action = 'steer'; input = { sessionId: dialog.sessionId, prompt: form.prompt }; }
    else if (dialog.kind === 'create') {
      action = `create_${dialog.createKind}`; input = { title: form.title, description: form.description };
      if (dialog.createKind === 'goal' && form.parent) input.lane_id = form.parent;
      if (dialog.createKind === 'task') { input.goal_ref = form.parent; input.acceptance_criteria = form.criteria.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
    }
    const result = await act(action, input);
    if (result) setDialog(null);
  }
  const statuses = ['open', 'in_progress', 'not_planned', 'duplicate', ...(work?.kind === 'task' || work?.status === 'closed' ? ['closed'] : [])];
  const heading = dialog?.kind === 'labels' ? 'Labels' : dialog?.kind === 'close' ? 'Close Goal' : dialog?.kind === 'status' ? 'Update status' : dialog?.kind === 'steer' ? 'Message current session' : `Create ${dialog?.createKind || 'record'}`;
  const safeDialog = dialog && (['create', 'steer'].includes(dialog.kind) || work);
  const canInitializeCurrentDirectory = discovery?.canInitializeCurrentDirectory === true;
  const selectedProjectId = state?.selectedProject?.id || discovery?.selectedProject?.id;
  const loadingWork = !loaded || refreshing || discoveryBusy || busy || initializing;
  const emptyHeading = discoveryError ? 'Lanes projects unavailable' :
    discovery?.projects?.length ? 'Select a project tab to continue' : 'No available Lanes projects';
  useEffect(() => {
    let frame;
    if (dialogWasOpen.current && !safeDialog) {
      frame = requestAnimationFrame(() => {
        const trigger = dialogTrigger.current?.isConnected ? dialogTrigger.current :
          document.querySelector('[data-project-tab][aria-current="page"]') ||
          document.querySelector('[data-command="refresh"]');
        trigger?.focus();
      });
    }
    dialogWasOpen.current = Boolean(safeDialog);
    return () => { if (frame !== undefined) cancelAnimationFrame(frame); };
  }, [safeDialog]);
  const closeDialog = () => { if (!busy) setDialog(null); };
  const feedback = notice || (error && !safeDialog) || discoveryError || discovery?.diagnostics?.length || (state && discoveryBusy && !discovery) ? <div className="clips-app-feedback">
    {notice ? <Feedback variant="success">{notice}</Feedback> : null}
    {error && !safeDialog ? <Feedback variant="critical" title="Lanes could not complete that action">{error}</Feedback> : null}
    {state && discoveryBusy && !discovery ? <Text as="p" role="status" className="clips-app-loading"><Spinner size="small" />Reading Lanes projects…</Text> : null}
    {discoveryError ? <Feedback variant="critical" title="Lanes projects could not be loaded">{discoveryError}</Feedback> : null}
    {discovery?.diagnostics?.map((item, index) => <Feedback variant="warning" key={`${item.code}:${index}`}>{item.message}</Feedback>)}
  </div> : null;
  return <main className="clips-app" onKeyDownCapture={(event) => {
    // Portal events still bubble through App; background tooltips must not consume modal Escape.
    if (safeDialog && event.key === 'Escape' && !busy) {
      event.preventDefault();
      event.stopPropagation();
      closeDialog();
    }
  }}>
    {state ? feedback : null}
    {state ? <Board key={state.projectPath} state={state} busy={busy || initializing} projects={discovery?.projects || []} onSelectProject={selectProject} canInitializeCurrentDirectory={canInitializeCurrentDirectory} onInitializeCurrentDirectory={initializeCurrentDirectory} onFocus={(ref) => { void act(ref ? 'focus' : 'clear_focus', ref ? { ref } : {}); }} onAction={act} onCommand={command} onMenu={openRecordForm} onOpenSession={openSession} onReadAttachment={readAttachment} /> : <div className="clips-app-recovery">
      <header className="clips-app-recovery-header">
        <Heading as="h1" className="clips-app-recovery-title">Lanes</Heading>
        <div className="clips-app-recovery-actions">
          <Button size="medium" leadingVisual={SyncIcon} data-command="refresh" disabled={busy || initializing} onClick={() => { void refreshBoard(); }}>Refresh</Button>
          {canInitializeCurrentDirectory ? <Button size="medium" variant="invisible" data-command="initialize" disabled={busy || initializing} onClick={() => { void initializeCurrentDirectory(); }}>{initializing ? 'Initializing Lanes…' : 'Initialize Lanes'}</Button> : null}
        </div>
      </header>
      {feedback}
      <div className="clips-app-project-tabs">
        <ProjectTabs projects={discovery?.projects || []} selectedProjectId={selectedProjectId} busy={busy || initializing} onSelectProject={selectProject} />
      </div>
      <div className="clips-app-start" aria-busy={loadingWork}>
        {loadingWork ? <div className="clips-app-loading-state" role="status" aria-live="polite">
          <Spinner size="small" style={{ width: 20, height: 20 }} srText="Loading" />
          <Text as="p" className="clips-app-muted" aria-hidden="true">Loading<span className="clips-app-loading-dots"><span>.</span><span>.</span><span>.</span></span></Text>
        </div> :
          <EmptyState title={emptyHeading}>Boards come from your local Lanes project registry.{discovery?.currentDirectory ? <><br />Current session directory: <code>{discovery.currentDirectory}</code></> : null}</EmptyState>}
      </div>
    </div>}
    {state ? <details className="clips-app-sessions"><summary>Project sessions <CounterLabel>{state.projectSessions?.length || 0}</CounterLabel></summary><div className="clips-app-session-list">{state.warnings?.length ? <Feedback variant="warning">{state.warnings.join(' ')}</Feedback> : null}{state.projectSessions?.length ? state.projectSessions.map((session) => {
      const id = session.id || session.sessionId;
      return <section className="clips-app-session" key={id} aria-label={sessionName(session)}>
        <div className="clips-app-session-info"><Heading as="h3" className="clips-app-session-title">{sessionName(session)}</Heading>
          <Text as="p" className="clips-app-muted">{session.statusLabel || 'Activity unavailable'}{session.appVisible === 'unverified' ? ' · App visibility unverified' : ''}</Text>
          <code>{id}</code><Text as="p" className="clips-app-muted">{session.workingDirectory || 'Working directory unavailable'}</Text>
          <Text as="p" className="clips-app-muted">{session.model?.modelId ? `Model: ${session.model.modelId}${session.model.reasoningEffort ? ` · ${session.model.reasoningEffort}` : ''}${session.mode ? ` · ${typeof session.mode === 'string' ? session.mode : JSON.stringify(session.mode)}` : ''}` : 'Model unavailable'}</Text>
        </div><div className="clips-app-session-actions"><Button size="small" aria-label={`Open session ${sessionName(session)} (${id})`} disabled={busy} onClick={() => openSession(id)}>{session.joined ? 'Open current session' : 'Open in Copilot App'}</Button><Button size="small" disabled={busy || !session.steerable} onClick={(event) => openDialog({ kind: 'steer', sessionId: id }, event.currentTarget)}>Steer</Button></div>
      </section>;
    }) : <Text as="p" className="clips-app-muted">No Copilot sessions are listed for this project.</Text>}</div></details> : null}
    {safeDialog ? <Dialog key={`${dialog.kind}:${dialog.ref || ''}:${dialog.createKind || ''}`} title={heading}
      subtitle={work ? `${work.ref} · ${work.title}` : dialog.kind === 'steer' ? 'Send through the exact current joined session. No session is created.' : 'Write a canonical Lanes record in the selected project.'}
      onClose={closeDialog} returnFocusRef={dialogTrigger} initialFocusRef={dialogInitialFocus} width="large" height="auto" className="clips-app-dialog">
        <div className="clips-app-dialog-content">
        {error ? <Feedback variant="critical">{error}</Feedback> : null}
        <form id="canvas-dialog-form" onSubmit={submit} className="clips-app-form">
          <fieldset disabled={busy} className="clips-app-fields">
            {dialog.kind === 'status' && work ? <FormControl id="record-status"><FormControl.Label>Status</FormControl.Label><Select ref={dialogInitialFocus} block name="status" defaultValue={work.status}>{statuses.map((s) => <Select.Option key={s} value={s} disabled={work.kind === 'lane' && s === 'closed'}>{s.replaceAll('_', ' ')}</Select.Option>)}</Select></FormControl> : null}
            {dialog.kind === 'close' ? <Text as="p" className="clips-app-muted">This marks the Goal closed in Lanes. It does not record engineering acceptance.</Text> : null}
            {dialog.kind === 'labels' && work ? <><FormControl id="label-choice"><FormControl.Label>Add label</FormControl.Label><Select ref={dialogInitialFocus} block name="label"><Select.Option value="">Choose label</Select.Option>{state?.labels?.map((label) => <Select.Option key={label.id} value={label.id}>{label.name}</Select.Option>)}</Select></FormControl><div><Button size="medium" type="submit" data-operation="add" disabled={busy}>Add label</Button></div><hr /><FormControl id="assigned-choice"><FormControl.Label>Remove label</FormControl.Label><Select block name="assigned"><Select.Option value="">Choose assigned label</Select.Option>{work.labels?.map((label) => <Select.Option key={label.id} value={label.id}>{label.name}</Select.Option>)}</Select></FormControl><div><Button size="medium" type="submit" disabled={busy} data-operation="remove">Remove label</Button></div></> : null}
            {dialog.kind === 'steer' ? <FormControl id="steer-prompt" required><FormControl.Label>Message</FormControl.Label><Textarea ref={dialogInitialFocus} block resize="vertical" rows={5} name="prompt" maxLength={12000} /></FormControl> : null}
            {dialog.kind === 'create' ? <>
              {taskWithoutGoals ? <Feedback variant="warning" title="A Goal is required">No Goals are available in this project. Cancel and choose New Goal from the New menu before creating a Task.</Feedback> : null}
              <FormControl id="record-title" required><FormControl.Label>Title</FormControl.Label><TextInput ref={dialogInitialFocus} block name="title" maxLength={200} /></FormControl>
              <FormControl id="record-description"><FormControl.Label>Description</FormControl.Label><Textarea block resize="vertical" rows={4} name="description" maxLength={12000} /></FormControl>
              {dialog.createKind === 'task' ? <FormControl id="record-criteria" required><FormControl.Label>Acceptance criteria, one per line</FormControl.Label><Textarea block resize="vertical" rows={4} name="criteria" maxLength={6000} /></FormControl> : null}
              {dialog.createKind !== 'lane' ? <FormControl id="record-parent" required={dialog.createKind === 'task'} disabled={taskWithoutGoals}>
                <FormControl.Label>{dialog.createKind === 'task' ? 'Parent Goal' : 'Lane (optional)'}</FormControl.Label>
                <Select block name="parent" defaultValue={dialog.parentRef ?? (dialog.createKind === 'goal' && state?.lanes.some((lane) => lane.ref === state.focus) ? state.focus : '')}>
                  <Select.Option value="">{dialog.createKind === 'task' ? 'Choose a Goal' : 'No Lane'}</Select.Option>
                  {(dialog.createKind === 'task' ? state?.goals : state?.lanes)?.map((r) => <Select.Option key={r.ref} value={r.ref}>{r.title} · {r.ref}</Select.Option>)}
                </Select>
              </FormControl> : null}
            </> : null}
          </fieldset>
          <div className="clips-app-dialog-actions"><Button size="medium" ref={dialog.kind === 'close' ? dialogInitialFocus : undefined} type="button" disabled={busy} onClick={closeDialog}>Cancel</Button>{dialog.kind !== 'labels' ? <Button size="medium" variant={dialog.kind === 'close' ? 'danger' : 'primary'} type="submit" disabled={busy || taskWithoutGoals}>{busy ? 'Working…' : dialog.kind === 'close' ? 'Close Goal' : dialog.kind === 'create' ? 'Create' : dialog.kind === 'steer' ? 'Send message' : 'Update status'}</Button> : null}</div>
        </form>
        </div>
    </Dialog> : null}
  </main>;
}
