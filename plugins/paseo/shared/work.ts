
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
  return `Clips ${target.ref} · ${target.title}`;
}

export function matchesWorkspace(workspace: WorkspaceInfo, target: WorkTarget, projectIds: readonly string[]): boolean {
  if (!projectIds.includes(workspace.projectId)) return false;
  const prefix = branchPrefix(target);
  return workspace.name === `Clips ${target.ref}` ||
    workspace.name.startsWith(`Clips ${target.ref} · `) ||
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
    ? "This Lane is a strategic product frame. Use the Lane Manager skill. Before strategic management, inspect its manager claim. If unowned, acquire a claim with the inspected revision and your actual observed host/runtime/session identity. If this session already owns the Lane, reuse that claim. If identity is unavailable or claiming conflicts, report the blocker and do not begin management or take over ownership. Inspect its Goals, summarize outstanding choices, then coordinate the next useful Goal. Hand complete engineering outcomes to verified top-level workspace dev agents the user can steer directly. Those dev agents own technical planning, implementation, integration, validation and completion records. Do not create child agents, implement, run validation or babysit workers yourself. Contact existing managers before overlapping decisions or work. Never take over another manager claim without explicit user authorization; idle and disconnected managers retain ownership. Contributing to a Goal or Task does not require taking Lane ownership. Do not equate closing a Lane with engineering acceptance."
    : target.kind === "goal"
      ? "Work toward this Goal's engineering outcome. Read the plan and its Tasks, respect blockers, and favor independently reviewable changes with tests."
      : "Implement this Task's bounded request, meet its stated acceptance criteria, test the actual changes, and document the result and evidence without self-approving human-owned acceptance.";
  return `Work on Clips ${target.kind} ${target.ref}: ${target.title}

Start by reading AGENTS.md and the Clips skill if present. Read the complete Clips record for ${target.ref} using the local Clips CLI (clips view '${target.ref}' --json), then inspect linked records, blockers, and relevant source files.
${instructions}

Follow the Clips skill's shared Paseo integration procedure for work-record updates and actual session/project/workspace binding readback when Paseo is available. Keep owner, status, blockers, results and acceptance evidence current through supported commands. An ordinary Goal/Task dev agent does not need Lane Manager role or a Lane management claim to contribute. Without Paseo, continue authorized local Clips work and report runtime association as unavailable.

The worktree shares the repository's Clips store through the common Git directory. Preserve workflow record history; distinguish completed implementation from accepted work. Summarize changed files, checks, and unresolved issues. Do not create GitHub Issues or assume Clips status means a Paseo agent is running.`;
}
