/** Transient navigation requests only. Workspace ownership stays in Paseo/Lanes identity. */
export type FocusIntent = { laneRef: string; version: number };
export type WorkspaceFocusIntent = FocusIntent & { projectId: string };
const intents = new Map<string, FocusIntent>();
const workspaceIntents = new Map<string, WorkspaceFocusIntent>();
const listeners = new Set<() => void>();
let version = 0;

export function requestLaneFocus(scope: string, laneRef: string, workspace?: { hostId: string; projectId: string; workspaceId: string }): void {
  const intent = { laneRef, version: ++version };
  intents.set(scope, intent);
  if (workspace) workspaceIntents.set(JSON.stringify([workspace.hostId, workspace.workspaceId]), { ...intent, projectId: workspace.projectId });
  for (const notify of listeners) notify();
}

export const getFocusIntent = (scope: string): FocusIntent | undefined => intents.get(scope);
export const getWorkspaceFocusIntent = (hostId: string, workspaceId?: string): WorkspaceFocusIntent | undefined =>
  workspaceId ? workspaceIntents.get(JSON.stringify([hostId, workspaceId])) : undefined;

/** A new explicit launch supersedes the panel's project choice once; browsing can then continue. */
export function projectAfterFocusIntent(selected: string | null, consumedVersion: number, intent?: WorkspaceFocusIntent): string | null {
  return intent && intent.version > consumedVersion ? intent.projectId : selected;
}
export function subscribeFocusIntent(notify: () => void): () => void {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}
