
/** Shared, pure workspace identity and runtime-state helpers. No Node or UI imports. */
export type WorkKind = "lane" | "goal" | "task";
export type WorkTarget = { kind: WorkKind; ref: string; title: string };
export type WorkspaceInfo = {
  id: string;
  projectId: string;
  name: string;
  branch: string;
  status: string;
};
export type AgentInfo = {
  id: string;
  workspaceId: string | null;
  status: string;
  requiresAttention: boolean;
  attentionReason: "finished" | "error" | "permission" | null;
  labels: Record<string, string>;
  title: string | null;
};

function hashRef(ref: string): string {
  // A short deterministic suffix makes refs with punctuation or usernames distinct.
  let hash = 2166136261;
  for (let i = 0; i < ref.length; i += 1) {
    hash ^= ref.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function slug(input: string, max: number): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/** Stable identity is independent of title changes; the human-readable slug can change. */
export function branchPrefix(target: Pick<WorkTarget, "kind" | "ref">): string {
  const key = slug(target.ref.replace(/#/g, "-"), 28) || "work";
  return `clips/${target.kind}/${key}-${hashRef(target.ref)}`;
}

export function branchName(target: WorkTarget): string {
  const title = slug(target.title, 34);
  return `${branchPrefix(target)}${title ? `-${title}` : ""}`;
}

export function workspaceTitle(target: WorkTarget): string {
  return `Lanes ${target.ref} · ${target.title}`;
}

export function matchesWorkspace(workspace: WorkspaceInfo, target: WorkTarget, projectIds: readonly string[]): boolean {
  if (!projectIds.includes(workspace.projectId)) return false;
  const prefix = branchPrefix(target);
  return workspace.name === `Lanes ${target.ref}` ||
    workspace.name.startsWith(`Lanes ${target.ref} · `) ||
    workspace.branch === prefix ||
    workspace.branch.startsWith(`${prefix}-`);
}

export type RuntimeStatus = "running" | "attention" | "error" | "idle" | "none";
export type Execution = {
  status: RuntimeStatus;
  runningAgents: number;
  workspaceCount: number;
  workspaceId: string | null;
  agents: AgentInfo[];
};

/** Pending input is still an owned execution; it must not permit a duplicate launch. */
export function isActiveAgent(agent: AgentInfo): boolean {
  if (agent.status === "error" || agent.attentionReason === "error" || agent.attentionReason === "finished") return false;
  return agent.status === "running" || agent.status === "initializing" || agent.status === "attention" ||
    (agent.requiresAttention && (agent.attentionReason === "permission" || agent.attentionReason === null));
}

export function executionFor(
  target: WorkTarget,
  projectIds: readonly string[],
  workspaces: readonly WorkspaceInfo[],
  agents: readonly AgentInfo[],
): Execution {
  const relevant = workspaces.filter((w) => matchesWorkspace(w, target, projectIds));
  const projectWorkspaces = new Set(workspaces.filter((w) => projectIds.includes(w.projectId)).map((w) => w.id));
  const relevantIds = new Set(relevant.map((w) => w.id));
  const workspaceAgents = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    if (!agent.workspaceId) continue;
    const entries = workspaceAgents.get(agent.workspaceId) ?? [];
    entries.push(agent);
    workspaceAgents.set(agent.workspaceId, entries);
  }
  const relatedAgents = agents.filter((agent) => {
    if (!agent.workspaceId) return false;
    const ref = agent.labels["clips.ref"];
    const project = agent.labels["clips.projectId"];
    const kind = agent.labels["clips.kind"];
    if (kind && kind !== target.kind) return false;
    // Explicit attribution wins, including when a workspace belongs to another record.
    if (ref || project) return ref === target.ref &&
      (project ? projectIds.includes(project) : projectWorkspaces.has(agent.workspaceId));
    // Support a lone legacy agent in a dedicated record worktree, never adopt its siblings.
    return relevantIds.has(agent.workspaceId) && workspaceAgents.get(agent.workspaceId)?.length === 1;
  });
  const workspaceNeedsInput = relevant.some((workspace) => workspace.status === "needs_input" &&
    !workspaceAgents.get(workspace.id)?.length);
  return summarizeExecution(relevant, relatedAgents, workspaceNeedsInput);
}

function summarizeExecution(relevant: readonly WorkspaceInfo[], relatedAgents: AgentInfo[], workspaceNeedsInput = false): Execution {
  const matchedIds = new Set([...relevant.map((workspace) => workspace.id), ...relatedAgents.map((a) => a.workspaceId!)]);
  const active = relatedAgents.filter((a) => isActiveAgent(a) && !a.requiresAttention && a.status !== "attention");
  const pending = relatedAgents.find((a) => isActiveAgent(a) && (a.requiresAttention || a.status === "attention"));
  const failed = relatedAgents.some((a) => a.status === "error" || a.attentionReason === "error") ||
    relevant.some((w) => w.status === "failed");
  const status: RuntimeStatus = active.length ? "running" : pending || workspaceNeedsInput ? "attention" : failed ? "error" : matchedIds.size ? "idle" : "none";
  return {
    status, runningAgents: active.length, workspaceCount: matchedIds.size,
    workspaceId: active[0]?.workspaceId || pending?.workspaceId || relevant[0]?.id || relatedAgents[0]?.workspaceId || null,
    agents: relatedAgents,
  };
}

/** Ownership is durable; only an observed session on the selected host can be navigated. */
export function executionForManagers(
  owners: readonly { host: string; runtime: string; session_id: string }[], hostId: string,
  workspaces: readonly WorkspaceInfo[], agents: readonly AgentInfo[],
): Execution {
  const sessions = new Set(owners.filter((owner) => owner.host === hostId && owner.runtime === "paseo").map((owner) => owner.session_id));
  const related = agents.filter((agent) => sessions.has(agent.id));
  const workspaceIds = new Set(related.map((agent) => agent.workspaceId));
  return summarizeExecution(workspaces.filter((workspace) => workspaceIds.has(workspace.id)), related);
}

export function defaultProvider(entries: readonly {
  provider: string;
  status: string;
  enabled?: boolean;
  models?: readonly { id: string; isDefault?: boolean; isSelectable?: boolean }[];
}[]): string | null {
  for (const entry of entries) {
    if (entry.enabled === false || entry.status !== "ready") continue;
    const models = (entry.models ?? []).filter((m) => m.isSelectable !== false);
    const model = models.find((m) => m.isDefault) ?? models[0];
    if (model) return `${entry.provider}/${model.id}`;
  }
  return null;
}

export function promptFor(target: WorkTarget): string {
  const instructions = target.kind === "lane"
    ? "This Lane is a strategic product frame. Use the Lane Manager skill. Read the Lane and its Goals; claims and registrations are advisory metadata, not prerequisites for authorized work. Do not take over another manager's claim. Coordinate the next useful Goal and assign bounded engineering work to verified top-level workspace dev agents the user can steer directly. Developers own technical implementation, resolve routine conflicts, run checks and make authorized local commits before manager analysis and user validation. Mediate competing approaches with the developers, connect them midflight or after implementation to resolve overrides, record decisions and amend contracts, then direct the agreed technical changes to the developers. Review their evidence without taking over implementation. The default human review is a Goal-attached CR for the exact candidate; a user may coalesce selected Goals into one Lane CR without duplicate approval for covered scope. Contact existing managers before overlapping decisions or work. Contributing to a Goal or Task does not require taking Lane ownership. Do not equate closing a Lane with engineering acceptance."
    : target.kind === "goal"
      ? "Work toward this Goal's engineering outcome. Read the plan and its Tasks, respect blockers, and favor independently reviewable changes with tests."
      : "Implement this Task's bounded request, meet its stated acceptance criteria, test the actual changes, and document the result and evidence without self-approving human-owned acceptance. Return the finite batch after durable handoff; a pending human Goal review does not keep an idle worker assigned. A Task assignment does not authorize sibling scope.";
  const executionGuidance = target.kind === "lane"
    ? "In every handoff, instruct the top-level dev owner to follow the Lanes skill's 'Plan and execute parallel Tasks' guidance: plan concurrency in identified Task contracts before assignment, pass dependencies and source/write boundaries, and use sub-agents for as much useful feasible Task work as possible. Require dependency-ready, non-conflicting Tasks to run concurrently, prerequisites and conflicting writes to be sequenced, and one dev coordinator for integration, verification and workflow-record writes, with Task-ID-scoped results and actual candidate evidence. No filler Tasks or worker quota. Do not create or direct the owner's sub-agents yourself."
    : "Follow the Lanes skill's 'Plan and execute parallel Tasks' guidance within the assigned role and user resource limits. Before execution or separate assignment, reuse or amend agreed contracts or create independently reviewable identified Lanes Tasks within authorized scope. Plan useful concurrency up front: blocked_by prerequisites, source/write boundaries, and integration/verification obligations. Use other workers only when the task contracts authorize it and the host supports it; otherwise do the bounded work in this session. Run dependency-ready, non-conflicting Tasks concurrently; sequence prerequisites and conflicting writes. Keep one dev coordinator for integration, verification and workflow-record writes. Return results and checks mapped to Task IDs and the actual source/artifact checked; verify the integrated candidate and recheck affected evidence after changes. Record concrete constraints when serial execution is needed; no filler Tasks or worker quota.";
  return `Work on Lanes ${target.kind} ${target.ref}: ${target.title}

Start by reading AGENTS.md and the Lanes skill if present. Read the complete Lanes record for ${target.ref} using the local Lanes CLI (clips view '${target.ref}' --json), then inspect linked records, blockers, and relevant source files.
${instructions}

${executionGuidance}

Follow the Lanes skill's shared Paseo integration procedure for work-record updates and actual session/project/workspace binding readback when Paseo is available. Keep owner, status, blockers, results and acceptance evidence current through supported commands. An ordinary Goal/Task dev agent does not need Lane Manager role or a Lane management claim to contribute. Without Paseo, continue authorized local Lanes work and report runtime association as unavailable.

The worktree shares the repository's Lanes store through the common Git directory. Preserve workflow record history; distinguish completed implementation from accepted work. Summarize changed files, checks, and unresolved issues. Do not create GitHub Issues or assume Lanes status means a Paseo agent is running.`;
}
