import { useEffect, useRef, useState } from 'react';
import { AlertIcon, CheckIcon, ProjectIcon, SyncIcon } from '@primer/octicons-react';
import { Board, sendCapability } from './board';
import { createActions } from './actions';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { FieldGroup, Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Separator } from '@/components/ui/separator';

export function App({ call, navigate = (url) => window.top.location.assign(url) }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [discovery, setDiscovery] = useState(null);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [discoveryError, setDiscoveryError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const stateRef = useRef(null);
  const dialogTrigger = useRef(null);
  const actions = useRef(null);
  if (!actions.current) actions.current = createActions({ call, onState(next) {
    if (stateRef.current?.projectPath !== next?.projectPath) setDialog((old) => old?.kind === 'project' ? old : null);
    stateRef.current = next; setState(next); setError(''); setLoaded(true);
  }, onError: (message) => { setError(message); setLoaded(true); }, onPending: (n) => setBusy(n > 0), onNotice: setNotice });
  const act = actions.current.act;
  const openDialog = (next, trigger = document.activeElement) => { dialogTrigger.current = trigger; setError(''); setDialog(next); };
  async function discover() {
    setDiscoveryBusy(true); setDiscoveryError('');
    try { const result = await call('list_projects'); setDiscovery(result); setSelectedId((old) => result.projects.some((p) => p.id === old) ? old : stateRef.current?.selectedProject?.id || ''); }
    catch (err) { setDiscovery(null); setDiscoveryError(err.message); }
    finally { setDiscoveryBusy(false); }
  }
  function chooseProject(trigger) { openDialog({ kind: 'project' }, trigger); void discover(); }
  useEffect(() => {
    let active = true;
    void act('refresh').then((result) => { if (!result && active) chooseProject(); });
    const interval = setInterval(() => { if (!document.hidden) void act('refresh'); }, 20000);
    return () => { active = false; clearInterval(interval); };
  }, []);
  const works = [...(state?.lanes || []).map((r) => ({ ...r, kind: 'lane' })), ...(state?.goals || []).map((r) => ({ ...r, kind: 'goal' })), ...(state?.goals || []).flatMap((g) => (g.tasks || []).map((r) => ({ ...r, kind: 'task', goal_ref: g.ref })))];
  const work = works.find((r) => r.ref === dialog?.ref);
  const openMenu = (ref, trigger) => openDialog({ kind: 'menu', ref }, trigger);
  async function openSession(sessionId) { try { navigate((await call('open_session', { sessionId })).url); } catch (err) { setError(err.message); } }
  function command(command, trigger) {
    if (command === 'refresh') return void act('refresh');
    if (command === 'project') return chooseProject(trigger);
    if (command.startsWith('create_')) openDialog({ kind: 'create', createKind: command.slice(7) }, trigger);
  }
  async function submit(event) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    let action; let input;
    if (dialog.kind === 'project') { action = 'set_project'; input = { projectId: selectedId }; }
    else if (dialog.kind === 'status') { action = 'set_status'; input = { ref: work.ref, status: form.status }; }
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
  const taskAction = work?.kind === 'task' ? sendCapability(work, state) : null;
  const statuses = ['open', 'in_progress', 'not_planned', 'duplicate', ...(work?.kind === 'task' || work?.status === 'closed' ? ['closed'] : [])];
  const heading = dialog?.kind === 'project' ? 'Choose a Clips project' : dialog?.kind === 'menu' ? 'Record actions' : dialog?.kind === 'labels' ? 'Labels' : dialog?.kind === 'close' ? 'Close Goal' : dialog?.kind === 'status' ? 'Update status' : dialog?.kind === 'steer' ? 'Message current session' : `Create ${dialog?.createKind || 'record'}`;
  const safeDialog = dialog && (['project', 'create', 'steer'].includes(dialog.kind) || work);
  return <main className="mx-auto flex max-w-[2400px] flex-col gap-6 p-4 sm:p-6">
    {notice ? <Alert role="status"><CheckIcon aria-hidden="true" /><AlertDescription>{notice}</AlertDescription></Alert> : null}
    {error && !safeDialog ? <Alert variant="destructive"><AlertIcon aria-hidden="true" /><AlertTitle>Clips could not complete that action</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {state ? <Board key={state.projectPath} state={state} busy={busy} onFocus={(ref) => { void act(ref ? 'focus' : 'clear_focus', ref ? { ref } : {}); }} onAction={(action, input) => { void act(action, input); }} onCommand={command} onMenu={openMenu} onOpenSession={openSession} /> : <Empty><EmptyHeader><EmptyTitle>{loaded ? 'Choose a Clips project to continue' : 'Loading Clips work…'}</EmptyTitle><EmptyDescription>Boards come from your local Clips project registry.</EmptyDescription></EmptyHeader><Button onClick={(event) => chooseProject(event.currentTarget)}><ProjectIcon data-icon="inline-start" aria-hidden="true" />Choose a Clips project</Button></Empty>}
    {state ? <details className="rounded-xl border p-4"><summary className="min-h-10 cursor-pointer rounded-lg px-2 py-2 focus-visible:outline-2 focus-visible:outline-ring">Project sessions{state.projectSessions?.length ? ` · ${state.projectSessions.length}` : ''}</summary><div className="flex flex-col gap-4 pt-4">{state.warnings?.length ? <Alert><AlertDescription>{state.warnings.join(' ')}</AlertDescription></Alert> : null}{state.projectSessions?.length ? state.projectSessions.map((session) => {
      const id = session.id || session.sessionId;
      return <Card key={id}><CardHeader><CardTitle>{session.summary || 'Copilot session'}</CardTitle><CardDescription className="flex flex-col gap-1"><code className="break-all">{id}</code><span>{session.statusLabel || 'Activity unavailable'}{session.appVisible === 'unverified' ? ' · App visibility unverified' : ''}</span><span className="break-all">{session.workingDirectory || 'Working directory unavailable'}</span><span>{session.model?.modelId ? `Model: ${session.model.modelId}${session.model.reasoningEffort ? ` · ${session.model.reasoningEffort}` : ''}${session.mode ? ` · ${typeof session.mode === 'string' ? session.mode : JSON.stringify(session.mode)}` : ''}` : 'Model unavailable'}</span></CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => openSession(id)}>{session.joined ? 'Open current session' : 'Open in Copilot App'}</Button><Button disabled={busy || !session.steerable} onClick={(event) => openDialog({ kind: 'steer', sessionId: id }, event.currentTarget)}>Steer</Button></CardContent></Card>;
    }) : <p className="text-sm text-muted-foreground">No Copilot sessions are listed for this project.</p>}</div></details> : null}
    <Dialog open={Boolean(safeDialog)} onOpenChange={(open) => { if (!open && !busy) setDialog(null); }}>
      <DialogContent showCloseButton={!busy} className="max-h-[calc(100dvh-2rem)] overflow-y-auto" onCloseAutoFocus={(event) => { event.preventDefault(); if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus(); else document.querySelector('[data-command="project"]')?.focus(); }}>
        <DialogHeader><DialogTitle>{heading}</DialogTitle><DialogDescription>{dialog?.kind === 'project' ? 'Available local projects from your Clips registry. Selection changes this canvas, not the Copilot session directory.' : work ? `${work.ref} · ${work.title}` : dialog?.kind === 'steer' ? 'Send through the exact current joined session. No session is created.' : 'Write a canonical Clips record in the selected project.'}</DialogDescription></DialogHeader>
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        {dialog?.kind === 'menu' && work ? <div className="flex flex-col gap-2">{taskAction ? <>{taskAction.sessions.length ? taskAction.sessions.map((session) => <Button key={session.id || session.sessionId} variant="outline" data-task-open-session={session.id || session.sessionId} disabled={busy} onClick={() => openSession(session.id || session.sessionId)}>{session.status === 'running' ? 'Open running session' : 'Open existing session'}</Button>) : <><Button data-task-run={work.ref} disabled={busy || !taskAction.canSend} aria-describedby="task-run-help" onClick={async () => { if (await act('launch', { ref: work.ref })) setDialog(null); }}>{busy ? 'Sending…' : 'Run Task'}</Button><p id="task-run-help" className="text-sm text-muted-foreground">{taskAction.reason}</p></>}<Separator /></> : null}<Button variant="ghost" className="justify-start" disabled={busy} onClick={() => setDialog({ kind: 'status', ref: work.ref })}>Update status</Button><Button variant="ghost" className="justify-start" disabled={busy} onClick={() => setDialog({ kind: 'labels', ref: work.ref })}>Labels</Button>{work.kind === 'lane' ? <Button variant="ghost" className="justify-start" onClick={async () => { if (await act('focus', { ref: work.ref })) setDialog(null); }}>Focus Lane</Button> : null}{work.kind === 'goal' ? <><Button variant="ghost" className="justify-start" onClick={() => setDialog({ kind: 'create', createKind: 'task', parentRef: work.ref })}>New Task</Button><Separator /><Button variant="destructive" disabled={work.status === 'closed'} onClick={() => setDialog({ kind: 'close', ref: work.ref })}>Close Goal</Button></> : null}</div> : <form id="canvas-dialog-form" onSubmit={submit} className="flex flex-col gap-6" key={`${dialog?.kind}:${dialog?.ref || ''}:${dialog?.createKind || ''}`}>
          <FieldGroup>
            {dialog?.kind === 'project' ? <>
              {discoveryBusy ? <p role="status" className="text-sm text-muted-foreground">Reading Clips projects…</p> : null}
              {discoveryError ? <Alert variant="destructive"><AlertDescription>{discoveryError}</AlertDescription></Alert> : null}
              {discovery?.diagnostics?.map((item, index) => <Alert key={`${item.code}:${index}`}><AlertDescription>{item.message}</AlertDescription></Alert>)}
              {!discoveryBusy && discovery && !discovery.projects.length ? <Empty><EmptyHeader><EmptyTitle>No available Clips projects</EmptyTitle><EmptyDescription>Register or repair a project using the Clips CLI, then reload this list. This chooser does not initialize repositories.</EmptyDescription></EmptyHeader></Empty> : null}
              <Field data-disabled={discoveryBusy || busy}><FieldLabel htmlFor="clips-project-choice">Clips project</FieldLabel><NativeSelect id="clips-project-choice" name="project" value={selectedId} required disabled={discoveryBusy || busy || !discovery?.projects?.length} onChange={(event) => setSelectedId(event.target.value)}><NativeSelectOption value="">Choose an available project</NativeSelectOption>{discovery?.projects.map((project) => <NativeSelectOption value={project.id} key={project.id}>{project.name} · {project.projectRoot}</NativeSelectOption>)}</NativeSelect></Field>
              <Button type="button" variant="outline" disabled={busy || discoveryBusy} onClick={discover}><SyncIcon data-icon="inline-start" aria-hidden="true" />Reload Clips projects</Button>
            </> : null}
            {dialog?.kind === 'status' && work ? <Field><FieldLabel htmlFor="record-status">Status</FieldLabel><NativeSelect id="record-status" name="status" defaultValue={work.status}>{statuses.map((s) => <NativeSelectOption key={s} value={s} disabled={work.kind === 'lane' && s === 'closed'}>{s.replaceAll('_', ' ')}</NativeSelectOption>)}</NativeSelect></Field> : null}
            {dialog?.kind === 'close' ? <p className="text-sm text-muted-foreground">This marks the Goal closed in Clips. It does not record engineering acceptance.</p> : null}
            {dialog?.kind === 'labels' && work ? <><Field><FieldLabel htmlFor="label-choice">Add label</FieldLabel><NativeSelect id="label-choice" name="label"><NativeSelectOption value="">Choose label</NativeSelectOption>{state?.labels?.map((label) => <NativeSelectOption key={label.id} value={label.id}>{label.name}</NativeSelectOption>)}</NativeSelect></Field><Button type="submit" data-operation="add" disabled={busy}>Add label</Button><Separator /><Field><FieldLabel htmlFor="assigned-choice">Remove label</FieldLabel><NativeSelect id="assigned-choice" name="assigned"><NativeSelectOption value="">Choose assigned label</NativeSelectOption>{work.labels?.map((label) => <NativeSelectOption key={label.id} value={label.id}>{label.name}</NativeSelectOption>)}</NativeSelect></Field><Button type="submit" variant="outline" disabled={busy} data-operation="remove">Remove label</Button></> : null}
            {dialog?.kind === 'steer' ? <Field><FieldLabel htmlFor="steer-prompt">Message</FieldLabel><Textarea id="steer-prompt" name="prompt" required maxLength={12000} /></Field> : null}
            {dialog?.kind === 'create' ? <><Field><FieldLabel htmlFor="record-title">Title</FieldLabel><Input id="record-title" name="title" required maxLength={200} autoFocus /></Field><Field><FieldLabel htmlFor="record-description">Description</FieldLabel><Textarea id="record-description" name="description" maxLength={12000} /></Field>{dialog.createKind === 'task' ? <Field><FieldLabel htmlFor="record-criteria">Acceptance criteria, one per line</FieldLabel><Textarea id="record-criteria" name="criteria" required maxLength={6000} /></Field> : null}{dialog.createKind !== 'lane' ? <Field><FieldLabel htmlFor="record-parent">{dialog.createKind === 'task' ? 'Parent Goal' : 'Lane (optional)'}</FieldLabel><NativeSelect id="record-parent" name="parent" required={dialog.createKind === 'task'} defaultValue={dialog.parentRef || (dialog.createKind === 'goal' ? state?.focus : '') || ''}>{dialog.createKind === 'goal' ? <NativeSelectOption value="">No Lane</NativeSelectOption> : null}{(dialog.createKind === 'task' ? state?.goals : state?.lanes)?.map((r) => <NativeSelectOption key={r.ref} value={r.ref}>{r.title} · {r.ref}</NativeSelectOption>)}</NativeSelect></Field> : null}</> : null}
          </FieldGroup>
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Cancel</Button>{dialog?.kind !== 'labels' ? <Button type="submit" disabled={busy || (dialog?.kind === 'project' && (discoveryBusy || !discovery?.projects.some((p) => p.id === selectedId)))}>{busy ? 'Working…' : dialog?.kind === 'project' ? 'Open Clips project' : dialog?.kind === 'close' ? 'Close Goal' : dialog?.kind === 'create' ? 'Create' : dialog?.kind === 'steer' ? 'Send message' : 'Update status'}</Button> : null}</DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </main>;
}
