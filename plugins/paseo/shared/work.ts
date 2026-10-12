
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

export function executionFor(
  target: WorkTarget,
  projectIds: readonly string[],
  workspaces: readonly WorkspaceInfo[],
  agents: readonly AgentInfo[],
): Execution {
  const relevant = workspaces.filter((w) => matchesWorkspace(w, target, projectIds));
  const attributed = agents.filter((a) =>
    a.labels["clips.ref"] === target.ref &&
    projectIds.includes(a.labels["clips.projectId"] ?? "") &&
    a.workspaceId !== null,
  );
  const matchedIds = new Set([...relevant.map((w) => w.id), ...attributed.map((a) => a.workspaceId!)]);
  const relatedAgents = agents.filter((a) => a.workspaceId && matchedIds.has(a.workspaceId));
  // A permission-blocked agent may still report "running" while it awaits a person.
  // Do not count it as active execution.
  const active = relatedAgents.filter((a) =>
    (a.status === "running" || a.status === "initializing") && !a.requiresAttention,
  );
  const attention = relatedAgents.some((a) => a.requiresAttention) ||
    relevant.some((w) => w.status === "needs_input" || w.status === "attention");
  const failed = relatedAgents.some((a) => a.status === "error");
  const status: RuntimeStatus = active.length ? "running" : attention ? "attention" : failed ? "error" : matchedIds.size ? "idle" : "none";
  const activeWorkspace = active[0]?.workspaceId || relatedAgents.find((a) => a.requiresAttention)?.workspaceId;
  return {
    status,
    runningAgents: active.length,
    workspaceCount: matchedIds.size,
    workspaceId: activeWorkspace || relevant[0]?.id || attributed[0]?.workspaceId || null,
    agents: relatedAgents,
  };
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
    ? "This Lane is a strategic product frame. Inspect its Goals, summarize outstanding choices, then coordinate the next useful Goal. Do not equate closing a Lane with engineering acceptance."
    : target.kind === "goal"
      ? "Work toward this Goal's engineering outcome. Read the plan and its Tasks, respect blockers, and favor independently reviewable changes with tests."
      : "Implement this Task's bounded request, meet its stated acceptance criteria, test the actual changes, and document the result and evidence without self-approving human-owned acceptance.";
  return `Work on Clips ${target.kind} ${target.ref}: ${target.title}

Start by reading AGENTS.md and the Clips skill if present. Read the complete Clips record for ${target.ref} using the local Clips CLI (clips view --json), then inspect linked records, blockers, and relevant source files.
${instructions}

The worktree shares the repository's Clips store through the common Git directory. Preserve workflow record history; distinguish completed implementation from accepted work. Summarize changed files, checks, and unresolved issues. Do not create GitHub Issues or assume Clips status means a Paseo agent is running.`;
}
