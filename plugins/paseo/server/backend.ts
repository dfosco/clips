
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import type { Goal, Lane, Project, Task, Work, Preferences, StartMode, LabelChange } from "../shared/contracts";
import { label } from "../shared/contracts";
import {
  branchName, branchPrefix, defaultProvider, executionFor, matchesWorkspace,
  promptFor, workspaceTitle, type AgentInfo, type WorkspaceInfo,
} from "../shared/work";

type Paseo = PluginHandlerContext["paseo"];
type LocalProject = Project & { root: string };
const command = (bin: string, args: string[], cwd?: string) => execCommand(bin, args, { cwd, timeout: 60_000 });
const asText = (value: unknown): string => typeof value === "string" ? value : value == null ? "" : JSON.stringify(value);
const asItems = (value: unknown): any[] => Array.isArray(value) ? value : [];

function errorText(error: unknown): string {
  const stderr = (error as { stderr?: unknown })?.stderr;
  return typeof stderr === "string" && stderr.trim()
    ? stderr.trim().split("\n")[0]
    : error instanceof Error ? error.message : String(error);
}

/** All Paseo projects with a Clips store, grouped by their Git common directory. */
export async function localProjects(paseo: Paseo): Promise<LocalProject[]> {
  const { projects } = await paseo.projects.list();
  const entries = await Promise.all(projects.map(async (p) => {
    if (p.projectKind !== "git") return null;
    try {
      const git = await command("git", [
        "-C", p.projectRootPath, "rev-parse", "--path-format=absolute", "--git-common-dir",
      ]);
      const commonDir = fs.realpathSync(git.stdout.trim());
      const candidates = [path.dirname(commonDir), p.projectRootPath];
      const root = candidates.find((candidate) => fs.existsSync(path.join(candidate, ".clips", "db")) ||
        fs.existsSync(path.join(candidate, ".clips", "clips.config.json")));
      if (!root) return null;
      return { id: p.projectId, label: p.projectCustomName || p.projectDisplayName, root: fs.realpathSync(root) };
    } catch {
      return null;
    }
  }));
  const grouped = new Map<string, LocalProject>();
  for (const item of entries) {
    if (!item) continue;
    const existing = grouped.get(item.root);
    if (existing) {
      existing.projectIds.push(item.id);
      continue;
    }
    grouped.set(item.root, {
      projectId: item.id,
      label: item.label,
      projectIds: [item.id],
      root: item.root,
    });
  }
  return [...grouped.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export async function projectList(paseo: Paseo): Promise<{ projects: Project[] }> {
  const projects = await localProjects(paseo);
  return { projects: projects.map(({ projectId, label, projectIds }) => ({ projectId, label, projectIds })) };
}

async function findProject(paseo: Paseo, id: string): Promise<LocalProject> {
  const match = (await localProjects(paseo)).find((p) => p.projectIds.includes(id));
  if (!match) throw new Error("That Clips project is no longer available on this Paseo host.");
  return match;
}

/** The CLI is the only interpreter of Clips journals. Never replay JSONL in the plugin. */
type Cli = { bin: string; prefix: string[] };
let resolvedCli: Promise<Cli> | undefined;
async function findClips(): Promise<Cli> {
  if (resolvedCli) return resolvedCli;
  resolvedCli = (async () => {
    const override = process.env.CLIPS_CLI_PATH?.trim();
    const binaries = override
      ? [override]
      : [
          "clips",
          "/opt/homebrew/bin/clips",
          "/usr/local/bin/clips",
          "/home/linuxbrew/.linuxbrew/bin/clips",
          path.join(os.homedir(), ".local", "bin", "clips"),
          path.join(os.homedir(), ".npm-global", "bin", "clips"),
        ];
    for (const binary of binaries) {
      const candidate = binary.endsWith(".js")
        ? { bin: process.execPath, prefix: [path.resolve(binary)] }
        : { bin: binary, prefix: [] };
      try {
        await command(candidate.bin, [...candidate.prefix, "--version"]);
        return candidate;
      } catch (error) {
        if (override) throw new Error(`CLIPS_CLI_PATH cannot run: ${errorText(error)}`);
      }
    }
    throw new Error("Clips CLI not found on the Paseo daemon host. Install a Clips version supporting 'clips board --json', or set CLIPS_CLI_PATH to the checkout's src/cli.js.");
  })().catch((error) => {
    resolvedCli = undefined;
    throw error;
  });
  return resolvedCli;
}

async function clipsBoard(root: string): Promise<any> {
  const cli = await findClips();
  let output: string;
  try {
    ({ stdout: output } = await command(cli.bin, [...cli.prefix, "board", "--json"], root));
  } catch (error) {
    throw new Error(`Cannot read Clips planning data from ${root}: ${errorText(error)}. This integration requires the matching Clips CLI with 'board --json'.`);
  }
  try {
    const board = JSON.parse(output);
    if (!Array.isArray(board.lanes) || !Array.isArray(board.goals)) throw new Error("missing lanes/goals");
    return board;
  } catch (error) {
    throw new Error(`Clips returned an invalid board JSON response: ${errorText(error)}`);
  }
}

function criteria(raw: any): { id: string; description: string }[] {
  return asItems(raw?.acceptance_criteria).map((c, index) => {
    return typeof c === "string"
      ? { id: `A${index + 1}`, description: c }
      : { id: asText(c?.id) || `A${index + 1}`, description: asText(c?.description || c?.text) };
  });
}
function fields(raw: any) {
  return {
    ref: asText(raw.ref),
    title: asText(raw.title) || asText(raw.ref),
    description: asText(raw.description),
    status: asText(raw.status) || "open",
    plan: asText(raw.plan),
    decisions: asText(raw.decisions),
    scope: asText(raw.scope),
    acceptanceCriteria: criteria(raw),
    labels: asItems(raw.labels).map((value) => label.parse(value)),
  };
}

export function normalizeBoard(board: any) {
  const lanes = asItems(board.lanes).map((l): Lane => ({
    ...fields(l), kind: "lane", goalRefs: asItems(l.goal_refs).map(asText),
  }));
  const goals = asItems(board.goals).map((g): Goal => ({
    ...fields(g),
    kind: "goal",
    type: asText(g.type),
    laneId: asText(g.lane_id) || null,
    tasks: asItems(g.tasks).map((t): Task => ({ ...fields(t), kind: "task" })),
  }));
  const warnings = asItems(board.warnings).map((w) => asText(w?.message || w));
  return { lanes, goals, warnings, labels: asItems(board.labels).map((value) => label.parse(value)) };
}

export async function readProjectBoard(paseo: Paseo, projectId: string) {
  const project = await findProject(paseo, projectId);
  return normalizeBoard(await clipsBoard(project.root));
}

export async function changeProjectLabels(paseo: Paseo, input: { projectId: string; change: LabelChange }) {
  const project = await findProject(paseo, input.projectId);
  const cli = await findClips();
  const change = input.change;
  const args = change.action === "create" ? ["create", JSON.stringify({ name: change.name, color: change.color })]
    : change.action === "edit" ? ["edit", change.id, JSON.stringify({ name: change.name, color: change.color })]
    : change.action === "delete" ? ["delete", change.id]
    : [change.action, change.ref, change.id];
  try {
    await command(cli.bin, [...cli.prefix, "label", ...args], project.root);
  } catch (error) {
    throw new Error(`Cannot change Clips labels: ${errorText(error)}`);
  }
  return normalizeBoard(await clipsBoard(project.root));
}

type Workspace = WorkspaceInfo & { branch: string };
async function listWorkspaces(paseo: Paseo): Promise<Workspace[]> {
  const out: Workspace[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages += 1) {
    const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
    for (const w of page.entries) out.push({
      id: w.id,
      projectId: w.projectId,
      name: w.title || w.name,
      branch: w.gitRuntime?.currentBranch ?? "",
      status: w.status,
    });
    if (!page.pageInfo.hasMore) return out;
    cursor = page.pageInfo.nextCursor ?? undefined;
    if (!cursor) throw new Error("Paseo workspace listing did not return a continuation cursor.");
  }
  throw new Error("Too many Paseo workspaces to verify safe reuse.");
}

async function listAgents(paseo: Paseo): Promise<AgentInfo[]> {
  const out: AgentInfo[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages += 1) {
    const page = await paseo.agents.list({ page: { limit: 200, cursor } });
    for (const entry of page.entries) {
      const agent = entry.agent;
      out.push({
        id: agent.id,
        workspaceId: agent.workspaceId || null,
        status: agent.status,
        requiresAttention: agent.requiresAttention ?? false,
        attentionReason: agent.attentionReason ?? null,
        labels: agent.labels ?? {},
        title: agent.title ?? null,
      });
    }
    if (!page.pageInfo.hasMore) return out;
    cursor = page.pageInfo.nextCursor ?? undefined;
    if (!cursor) throw new Error("Paseo agent listing did not return a continuation cursor.");
  }
  throw new Error("Too many Paseo agents to verify safe reuse.");
}

async function agentChoice(paseo: Paseo, preference: string): Promise<string> {
  const entries = (await paseo.providers.snapshot()).entries;
  const suggested = defaultProvider(entries);
  if (!preference) {
    if (!suggested) throw new Error("No Paseo agent provider is ready. Configure a provider first.");
    return suggested;
  }
  const [provider, ...modelParts] = preference.split("/");
  const model = modelParts.join("/");
  if (!entries.some((p) =>
    p.provider === provider && p.status === "ready" && p.enabled !== false &&
    (p.models ?? []).some((m) => m.id === model && m.isSelectable !== false)
  )) throw new Error(`Configured Paseo agent ${preference} is unavailable. Choose a ready model in Clips Workspaces settings.`);
  return preference;
}

const inFlight = new Set<string>();

/**
 * Validate project + reference against a fresh board, then reuse or create an
 * isolated Paseo worktree. Starting an agent never accepts or closes Clips work.
 */
export async function startWork(
  paseo: Paseo,
  prefs: Preferences,
  input: { projectId: string; ref: string; mode: StartMode },
) {
  const project = await findProject(paseo, input.projectId);
  const key = `${project.root}:${input.ref}`;
  if (inFlight.has(key)) throw new Error(`A workspace action for ${input.ref} is already in progress.`);
  inFlight.add(key);
  try {
    const board = normalizeBoard(await clipsBoard(project.root));
    const targets: Work[] = [...board.lanes, ...board.goals, ...board.goals.flatMap((g) => g.tasks)];
    const target = targets.find((t) => t.ref === input.ref);
    if (!target) throw new Error(`Clips reference ${input.ref} does not exist in this project.`);
    if (target.status === "closed" || target.status === "not_planned" || target.status === "duplicate") {
      throw new Error(`${input.ref} is ${target.status}; reopen it in Clips before launching a new agent.`);
    }

    const [workspaces, agents] = await Promise.all([listWorkspaces(paseo), listAgents(paseo)]);
    const running = executionFor(target, project.projectIds, workspaces, agents);
    if (input.mode === "agent" && running.status === "attention") {
      throw new Error(`An agent for ${input.ref} needs input. Resolve it before starting another agent.`);
    }
    // A configured provider is checked before any new workspace is created.
    const agent = input.mode === "agent" && running.status !== "running"
      ? await agentChoice(paseo, prefs.agent) : null;
    const prompt = agent ? promptFor(target) : null;

    const existing = running.workspaceId
      ? workspaces.find((w) => w.id === running.workspaceId)
      : workspaces.find((w) => matchesWorkspace(w, target, project.projectIds));
    if (existing || running.workspaceId) {
      const id = existing?.id || running.workspaceId!;
      if (running.status === "running" || !agent || !prompt) {
        return {
          workspaceId: id, branch: existing?.branch || branchName(target),
          agentId: null, agent: null, reused: true, alreadyRunning: running.status === "running",
        };
      }
      const workspace = paseo.workspaces.ref(id);
      const created = await workspace.agents.create({
        config: { provider: agent },
        labels: { "clips.ref": target.ref, "clips.projectId": project.projectId, "clips.kind": target.kind },
        prompt,
      });
      return { workspaceId: id, branch: existing?.branch || branchName(target), agentId: created.id, agent, reused: true, alreadyRunning: false };
    }

    // Worktree remnants must not silently create another workspace on the same work.
    const branches = await command("git", ["-C", project.root, "branch", "--format=%(refname:short)"]);
    const prefix = branchPrefix(target);
    const orphan = branches.stdout.split("\n").find((b) => b === prefix || b.startsWith(`${prefix}-`));
    if (orphan) throw new Error(`Branch ${orphan} exists without a Paseo workspace. Reattach or remove it before creating a new workspace.`);

    const branch = branchName(target);
    const workspace = await paseo.workspaces.create({
      title: workspaceTitle(target),
      ...(prompt ? { firstAgentContext: { prompt, attachments: [] } } : {}),
      source: {
        kind: "worktree",
        cwd: project.root,
        action: "branch-off",
        branchName: branch,
        baseBranch: "HEAD",
      },
    });
    if (!agent || !prompt) {
      return { workspaceId: workspace.id, branch, agentId: null, agent: null, reused: false, alreadyRunning: false };
    }
    try {
      const created = await workspace.agents.create({
        config: { provider: agent },
        labels: { "clips.ref": target.ref, "clips.projectId": project.projectId, "clips.kind": target.kind },
        prompt,
      });
      return { workspaceId: workspace.id, branch, agentId: created.id, agent, reused: false, alreadyRunning: false };
    } catch (error) {
      throw new Error(`Workspace ${workspace.id} was created on ${branch}, but its agent could not start: ${errorText(error)}`);
    }
  } finally {
    inFlight.delete(key);
  }
}
