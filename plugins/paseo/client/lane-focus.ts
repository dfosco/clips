import type { Goal, Lane, Work } from "../shared/contracts";
import { matchesWorkspace, type AgentInfo, type Execution, type WorkspaceInfo } from "../shared/work";
import type { FocusIntent } from "./focus-intent";

export type WorkFilter = "open" | "running" | "all";
export type LaneFocus = { scope: string; laneRef: string | null; intentVersion?: number };

export const isActive = (status: string) => !["closed", "not_planned", "duplicate"].includes(status);

export function focusScope(hostId: string, projectId?: string, workspaceId?: string): string {
  return JSON.stringify([hostId, projectId ?? null, workspaceId ?? null]);
}

/** Name/branch identity survives remounts. Labels also cover running in an existing workspace. */
export function workspaceLane(
  lanes: readonly Lane[], projectIds: readonly string[], workspaceId: string | undefined,
  workspaces: readonly WorkspaceInfo[], agents: readonly AgentInfo[],
): Lane | undefined {
  const workspace = workspaces.find((entry) => entry.id === workspaceId && projectIds.includes(entry.projectId));
  if (!workspace) return undefined;
  const identified = lanes.filter((lane) => matchesWorkspace(workspace, lane, projectIds));
  if (identified.length === 1) return identified[0];
  if (identified.length > 1) return undefined;
  const labeled = lanes.filter((lane) => agents.some((agent) =>
    agent.workspaceId === workspace.id && agent.labels["clips.ref"] === lane.ref &&
    projectIds.includes(agent.labels["clips.projectId"] ?? ""),
  ));
  return labeled.length === 1 ? labeled[0] : undefined;
}

export function focusedLane(
  lanes: readonly Lane[], scope: string, selection: LaneFocus | null, automatic?: Lane, intent?: FocusIntent,
): Lane | undefined {
  // A null laneRef is an explicit Back action, including while runtime data refreshes.
  const selected = selection?.scope === scope ? selection : null;
  const ref = intent && intent.version > (selected?.intentVersion ?? 0) ? intent.laneRef :
    selected ? selected.laneRef : automatic?.ref;
  return lanes.find((lane) => lane.ref === ref);
}

export function goalGroup(
  lane: Lane | null, goals: readonly Goal[], filter: WorkFilter, search: string,
  includeClosedGoals: boolean, execution: (work: Work) => Execution,
) {
  const query = search.toLowerCase().trim();
  const hit = (work: Work) => !query || [work.title, work.ref, work.description, ...(work.labels ?? []).map((label) => label.name)].some((value) => value.toLowerCase().includes(query));
  const visible = (work: Work, ancestorHit: boolean) => {
    const statusMatch = filter === "running" ? execution(work).status === "running" :
      filter === "all" || isActive(work.status) || (includeClosedGoals && work.status === "closed");
    return statusMatch && (ancestorHit || hit(work));
  };
  const parentHit = lane ? hit(lane) : false;
  const entries = goals.filter((goal) => includeClosedGoals || goal.status !== "closed").map((goal) => {
    const tasks = goal.tasks.filter((task) => visible(task, parentHit || hit(goal)));
    return { goal, tasks, shown: visible(goal, parentHit) || tasks.length > 0 };
  }).filter((entry) => entry.shown);
  const showLane = lane
    ? (filter !== "open" || isActive(lane.status)) && (visible(lane, false) || entries.length > 0)
    : entries.length > 0;
  const closedGoals = goals.filter((goal) => goal.status === "closed");
  const canRevealClosed = filter === "open" && !includeClosedGoals && closedGoals.length > 0 &&
    (!query || parentHit || closedGoals.some((goal) => hit(goal) || goal.tasks.some(hit)));
  return { entries, showLane, closedGoals, canRevealClosed };
}

/** Panel errors are separate from successful workspace creation / launch. */
export async function openLanePanel(
  lane: Lane | undefined, workspaceId: string,
  openPanel: ((workspaceId: string) => void | Promise<void>) | undefined,
): Promise<string | null> {
  if (!lane || !openPanel) return null;
  try {
    await openPanel(workspaceId);
    return null;
  } catch (error) {
    return `Workspace is ready, but the Clips panel could not open: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Refresh before mounting a panel so its first board has the new workspace context. */
export async function revealStartedWorkspace({
  workspaceId, agentId, lane, refresh, openWorkspace, openAgent, requestFocus, openPanel,
}: {
  workspaceId: string;
  agentId?: string | null;
  lane?: Lane;
  refresh: () => Promise<unknown>;
  openWorkspace?: (workspaceId: string) => void;
  openAgent?: (agentId: string) => void;
  requestFocus: (lane: Lane, workspaceId: string) => void;
  openPanel?: (workspaceId: string) => void | Promise<void>;
}): Promise<string[]> {
  const errors: string[] = [];
  try { await refresh(); } catch (error) {
    errors.push(`Workspace is ready, but its live context could not refresh: ${String(error)}`);
  }
  try {
    openWorkspace?.(workspaceId);
    if (agentId) openAgent?.(agentId);
  } catch (error) {
    errors.push(`Workspace is ready, but navigation failed: ${String(error)}`);
  }
  if (lane) requestFocus(lane, workspaceId);
  const panelError = await openLanePanel(lane, workspaceId, openPanel);
  if (panelError) errors.push(panelError);
  return errors;
}
