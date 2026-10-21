
import fs from "node:fs";
import { findClips, type ClipsCommand as Cli } from "./clips-cli";
import { assertUnclaimed, launchLaneManager } from "./lane-managers";
import { acquireLaunchLock } from "./launch-lock";
import type { ManagerClaim } from "./lane-managers";
import os from "node:os";
import path from "node:path";
import { execCommand, type PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  attachment, attachmentReadData, collaborationCapability, label, labelUsesData, laneClosureData,
  type AttachmentReadData, type LabelChange, type AgentConfiguration, type Goal, type Lane,
  type LaneClosureData, type Project, type Task, type Work, type Preferences, type StartMode,
} from "../shared/contracts";
import {
  FULL_ACCESS_MODE, resolvePermissionMode, type ProviderPermissionMode,
} from "../shared/permission-modes";
import {
  branchName, branchPrefix, defaultProvider, executionFor, isActiveAgent, matchesWorkspace,
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

/** All Paseo projects with a Lanes store, grouped by their Git common directory. */
export async function localProjects(paseo: Paseo): Promise<LocalProject[]> {
  const { projects } = await paseo.projects.list();
  if (!projects.some((project) => project.projectKind === "git")) return [];
  const cli = await findClips(paseo);
  const entries = await Promise.all(projects.map(async (p) => {
    if (p.projectKind !== "git") return null;
    try {
      const result = await command(cli.bin, [...cli.prefix, "paths", "--json"], p.projectRootPath);
      const paths: unknown = JSON.parse(result.stdout);
      if (!paths || typeof paths !== "object" ||
          !("repoRoot" in paths) || typeof paths.repoRoot !== "string" || !path.isAbsolute(paths.repoRoot) ||
          !("storeDir" in paths) || typeof paths.storeDir !== "string" || !path.isAbsolute(paths.storeDir) ||
          !("configPath" in paths) || typeof paths.configPath !== "string" || !path.isAbsolute(paths.configPath)) {
        throw new Error("The matching Lanes CLI must return absolute repoRoot, storeDir and configPath from paths --json.");
      }
      if (!fs.existsSync(path.join(paths.storeDir, "db")) && !fs.existsSync(paths.configPath)) return null;
      const root = paths.repoRoot;
      return { id: p.projectId, label: p.projectCustomName || p.projectDisplayName, root: fs.realpathSync(root) };
    } catch (error) {
      console.warn(`Cannot discover Lanes project ${p.projectId}: ${errorText(error)}`);
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
  if (!match) throw new Error("That Lanes project is no longer available on this Paseo host.");
  return match;
}

/** The CLI is the only interpreter of Lanes journals. Never replay JSONL in the plugin. */
async function laneManagerCommand(paseo: Paseo, root: string, action: "inspect" | "claim", ref: string, request?: unknown): Promise<ManagerClaim> {
  const cli = await findClips(paseo);
  const args = [...cli.prefix, "lane", "manager", action, ref];
  if (request) args.push(JSON.stringify(request));
  args.push("--json");
  const { stdout } = await command(cli.bin, args, root);
  return JSON.parse(stdout);
}

async function clipsBoard(paseo: Paseo, root: string): Promise<any> {
  const cli = await findClips(paseo);
  let output: string;
  try {
    ({ stdout: output } = await command(cli.bin, [...cli.prefix, "board", "--json"], root));
  } catch (error) {
    throw new Error(`Cannot read Lanes planning data from ${root}: ${errorText(error)}. This integration requires the matching Lanes CLI with 'board --json'.`);
  }
  try {
    const board = JSON.parse(output);
    if (!Array.isArray(board.lanes) || !Array.isArray(board.goals)) throw new Error("missing lanes/goals");
    return board;
  } catch (error) {
    throw new Error(`Lanes returned an invalid board JSON response: ${errorText(error)}`);
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
    attachments: attachmentList(raw.attachments),
    labels: asItems(raw.labels).map((value) => label.parse(value)),
  };
}

function attachmentList(raw: unknown) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new Error("Lanes returned invalid attachment metadata.");
  return raw.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Lanes returned invalid attachment metadata.");
    }
    const display = { ...value };
    delete display.path;
    return attachment.parse(display);
  });
}

export function normalizeBoard(board: any) {
  const lanes = asItems(board.lanes).map((l): Lane => ({
    ...fields(l), kind: "lane", goalRefs: asItems(l.goal_refs).map(asText),
    productGoals: asItems(l.product_goals).map(asText),
    managerClaim: l.manager_claim ?? null,
    managerClaimError: typeof l.manager_claim_error === "string" ? l.manager_claim_error : null,
  }));
  const goals = asItems(board.goals).map((g): Goal => ({
    ...fields(g),
    kind: "goal",
    type: asText(g.type),
    laneId: asText(g.lane_id) || null,
    tasks: asItems(g.tasks).map((t): Task => ({ ...fields(t), kind: "task" })),
  }));
  const warnings = asItems(board.warnings).map((w) => asText(w?.message || w));
  const collaboration = board.collaboration == null ? null : collaborationCapability.parse(board.collaboration);
  return {
    lanes, goals, warnings, labels: asItems(board.labels).map((value) => label.parse(value)),
    collaboration, generatedAt: typeof board.generated_at === "string" ? board.generated_at : null,
  };
}

export async function readProjectBoard(paseo: Paseo, projectId: string) {
  const project = await findProject(paseo, projectId);
  return normalizeBoard(await clipsBoard(paseo, project.root));
}

function findBoardRecord(board: any, ref: string) {
  if (typeof ref !== "string" || !/^#[\w.-]+(?:#[\w.-]+){0,2}$/.test(ref)) {
    throw new Error("Provide an exact current Lane, Goal, or Task reference.");
  }
  const records = [
    ...asItems(board.lanes),
    ...asItems(board.goals),
    ...asItems(board.goals).flatMap((goal) => asItems(goal.tasks)),
  ];
  const record = records.find((candidate) => candidate?.ref === ref);
  if (!record) throw new Error(`Record ${ref} is not present in this project's current Lanes board.`);
  return record;
}

export async function readProjectAttachment(
  paseo: Paseo,
  input: { projectId: string; ref: string; attachmentId: string },
): Promise<AttachmentReadData> {
  const project = await findProject(paseo, input.projectId);
  const board = await clipsBoard(paseo, project.root);
  const record = findBoardRecord(board, input.ref);
  const attached = asItems(record.attachments).find((item) => item?.id === input.attachmentId);
  if (!attached) throw new Error(`Attachment ${input.attachmentId} is not associated with ${record.ref}.`);
  if (attached.type !== "markdown") throw new Error("Only Markdown attachments have readable file content.");
  const cli = await findClips(paseo);
  try {
    const result = JSON.parse((await command(
      cli.bin, [...cli.prefix, "attachment", "read", record.ref, attached.id], project.root,
    )).stdout);
    if (result?.ref !== record.ref || result?.attachment?.id !== attached.id) {
      throw new Error("Lanes returned a different record or attachment than requested.");
    }
    const display = { ...result.attachment };
    delete display.path;
    return attachmentReadData.parse({
      ref: record.ref,
      revision: result.revision,
      attachment: display,
    });
  } catch (error) {
    throw new Error(`Cannot read current Markdown for ${record.ref}: ${errorText(error)}`);
  }
}

export async function setProjectCollaboration(
  paseo: Paseo,
  input: { projectId: string; enabled: boolean },
) {
  if (typeof input.enabled !== "boolean") throw new Error("Collaboration must be explicitly enabled or disabled.");
  const project = await findProject(paseo, input.projectId);
  const board = await clipsBoard(paseo, project.root);
  const capability = board.collaboration;
  if (!capability || capability.enabled === null || capability.state === "invalid") {
    throw new Error(capability?.error || "The current project's collaboration setting is unavailable.");
  }
  const cli = await findClips(paseo);
  try {
    await command(cli.bin, [...cli.prefix, "config", "collaboration", String(input.enabled)], project.root);
  } catch (error) {
    throw new Error(`Cannot update local collaboration configuration: ${errorText(error)}`);
  }
  return normalizeBoard(await clipsBoard(paseo, project.root));
}

export async function changeProjectLabels(paseo: Paseo, input: { projectId: string; change: LabelChange }) {
  const project = await findProject(paseo, input.projectId);
  const cli = await findClips(paseo);
  const change = input.change;
  const args = change.action === "create" ? ["create", JSON.stringify({ name: change.name, color: change.color })]
    : change.action === "edit" ? ["edit", change.id, JSON.stringify({ name: change.name, color: change.color })]
    : change.action === "delete" ? ["delete", change.id, ...(change.replacement
      ? change.replacement.kind === "none" ? ["--remove-assignments"] : ["--replace-with", change.replacement.id]
      : [])]
    : [change.action, change.ref, change.id];
  try {
    await command(cli.bin, [...cli.prefix, "label", ...args], project.root);
  } catch (error) {
    throw new Error(`Cannot change Lanes labels: ${errorText(error)}`);
  }
  return normalizeBoard(await clipsBoard(paseo, project.root));
}

export async function readProjectLabelUses(paseo: Paseo, input: { projectId: string; id: string }) {
  const project = await findProject(paseo, input.projectId);
  const cli = await findClips(paseo);
  try {
    const result = await command(cli.bin, [...cli.prefix, "label", "uses", input.id, "--json"], project.root);
    return labelUsesData.parse(JSON.parse(result.stdout));
  } catch (error) {
    throw new Error(`Cannot read Lanes label uses: ${errorText(error)}`);
  }
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

function isSpeedFeature(feature: { id: string; label: string }): boolean {
  return /\b(speed|fast)\b/i.test(`${feature.id} ${feature.label}`.replace(/[_-]+/g, " "));
}

function splitAgent(value: string): { provider: string; model: string } {
  const [provider, ...modelParts] = value.split("/");
  return { provider, model: modelParts.join("/") };
}

async function selectedProvider(paseo: Paseo, root: string, preference: string) {
  const entries = (await paseo.providers.snapshot({ cwd: root })).entries;
  const suggested = defaultProvider(entries);
  const selected = preference || suggested;
  if (!selected) throw new Error("No Paseo agent provider is ready. Configure a provider first.");
  const { provider, model: modelId } = splitAgent(selected);
  const entry = entries.find((candidate) => candidate.provider === provider && candidate.status === "ready" && candidate.enabled !== false);
  const model = entry?.models?.find((candidate) => candidate.id === modelId && candidate.isSelectable !== false);
  if (!entry || !model) throw new Error(`Configured Paseo agent ${selected} is unavailable. Choose a ready model in Lanes settings.`);
  return { selected, provider, entry, model };
}

async function providerFeatures(paseo: Paseo, root: string, provider: string, thinkingOptionId?: string) {
  const result = await paseo.providers.listFeatures({
    provider,
    cwd: root,
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
  });
  return { features: result.features ?? [], error: result.error ?? null };
}

async function providerPermissionModes(
  paseo: Paseo,
  root: string,
  provider: string,
  cachedModes: readonly ProviderPermissionMode[] = [],
  defaultModeId?: string | null,
) {
  try {
    const result = await paseo.providers.listModes(provider, { cwd: root });
    return {
      modes: result.modes?.length ? result.modes : [...cachedModes],
      defaultModeId: defaultModeId ?? null,
      error: result.error ?? null,
    };
  } catch (error) {
    return {
      modes: [...cachedModes],
      defaultModeId: defaultModeId ?? null,
      error: errorText(error),
    };
  }
}

export async function readAgentOptions(paseo: Paseo, input: { projectId?: string; provider: string; thinkingOptionId?: string }) {
  const root = input.projectId
    ? (await findProject(paseo, input.projectId)).root
    : (await localProjects(paseo))[0]?.root ?? os.homedir();
  const { selected, provider, entry, model } = await selectedProvider(paseo, root, input.provider);
  if (input.thinkingOptionId && !model.thinkingOptions?.some((option) => option.id === input.thinkingOptionId)) {
    throw new Error(`Thinking option ${input.thinkingOptionId} is unavailable for ${selected}.`);
  }
  let features: Awaited<ReturnType<typeof providerFeatures>> = { features: [], error: null };
  try {
    features = await providerFeatures(paseo, root, selected, input.thinkingOptionId || model.defaultThinkingOptionId);
  } catch (error) {
    features = { features: [], error: errorText(error) };
  }
  const speedFeature = features.features.find(isSpeedFeature) ?? null;
  const modeOptions = await providerPermissionModes(
    paseo, root, provider, entry.modes ?? [], entry.defaultModeId,
  );
  return {
    thinkingOptions: model.thinkingOptions ?? [],
    defaultThinkingOptionId: model.defaultThinkingOptionId ?? null,
    speedFeature,
    featureError: features.error,
    permissionModes: modeOptions.modes,
    defaultModeId: modeOptions.defaultModeId,
    modeError: modeOptions.error,
  };
}

async function agentConfiguration(
  paseo: Paseo,
  root: string,
  preferences: Preferences,
  override?: AgentConfiguration,
) {
  const preference = override ? override.provider : preferences.agent;
  const { selected, provider, entry, model } = await selectedProvider(paseo, root, preference);
  const thinkingOptionId = override ? override.thinkingOptionId || undefined : preferences.thinkingOptionId || undefined;
  const featureValues = override ? override.featureValues : preferences.featureValues;
  const requestedModeId = override?.modeId ?? preferences.modeId ?? FULL_ACCESS_MODE;
  if (thinkingOptionId && !model.thinkingOptions?.some((option) => option.id === thinkingOptionId)) {
    throw new Error(`Thinking option ${thinkingOptionId} is unavailable for ${selected}.`);
  }

  const modeOptions = await providerPermissionModes(
    paseo, root, provider, entry.modes ?? [], entry.defaultModeId,
  );
  const mode = resolvePermissionMode(requestedModeId, modeOptions.modes, modeOptions.defaultModeId);
  if (!mode) {
    const available = modeOptions.modes.map((option) => option.id + " (" + option.label + ")").join(", ");
    const reason = modeOptions.error ? " Paseo mode discovery failed: " + modeOptions.error : "";
    throw new Error(
      "Permission mode " + requestedModeId + " is unavailable for " + selected + "." + reason +
      (available ? " Choose one of: " + available + "." : " This provider exposes no permission modes."),
    );
  }

  let features: Awaited<ReturnType<typeof providerFeatures>>;
  try {
    features = await providerFeatures(paseo, root, selected, thinkingOptionId);
  } catch (error) {
    if (Object.keys(featureValues).length) throw new Error(`Cannot validate provider features for ${selected}: ${errorText(error)}`);
    features = { features: [], error: errorText(error) };
  }
  if (features.error && Object.keys(featureValues).length) {
    throw new Error(`Cannot validate provider features for ${selected}: ${features.error}`);
  }
  for (const [id, value] of Object.entries(featureValues)) {
    const feature = features.features.find((candidate) => candidate.id === id);
    if (!feature) throw new Error(`Provider feature ${id} is unavailable for ${selected}.`);
    const supported = feature.type === "toggle"
      ? typeof value === "boolean"
      : typeof value === "string" && feature.options.some((option) => option.id === value);
    if (!supported) throw new Error(`Value for provider feature ${id} is invalid for ${selected}.`);
  }

  return {
    provider: selected,
    modeId: mode.id,
    ...(thinkingOptionId ? { thinkingOptionId } : {}),
    ...(Object.keys(featureValues).length ? { featureValues } : {}),
  };
}

const inFlight = new Set<string>();

/**
 * Validate project + reference against a fresh board, then reuse or create an
 * isolated Paseo worktree. Starting an agent never accepts or closes Lanes work.
 */
export async function startWork(
  paseo: Paseo,
  prefs: Preferences,
  input: { projectId: string; ref: string; mode: StartMode; workspaceId?: string; agentConfig?: AgentConfiguration; hostId?: string },
) {
  const project = await findProject(paseo, input.projectId);
  const key = `${project.root}:${input.ref}`;
  if (inFlight.has(key)) throw new Error(`A workspace action for ${input.ref} is already in progress.`);
  const releaseLaunch = acquireLaunchLock(project.root, input.ref);
  inFlight.add(key);
  try {
    const board = normalizeBoard(await clipsBoard(paseo, project.root));
    const targets: Work[] = [...board.lanes, ...board.goals, ...board.goals.flatMap((g) => g.tasks)];
    const target = targets.find((t) => t.ref === input.ref);
    if (!target) throw new Error(`Lanes reference ${input.ref} does not exist in this project.`);
    if (target.status === "closed" || target.status === "not_planned" || target.status === "duplicate") {
      throw new Error(`${input.ref} is ${target.status}; reopen it in Lanes before launching a new agent.`);
    }

    // Inspect before workspace or agent creation. An unavailable claim store fails closed.
    const managerClaim = target.kind === "lane" ? await laneManagerCommand(paseo, project.root, "inspect", target.ref) : null;
    if (managerClaim) {
      assertUnclaimed(managerClaim);
      if (input.mode === "agent" && !input.hostId?.trim()) {
        throw new Error("A Lane manager launch requires the observed Paseo host ID.");
      }
    }
    const createAgent = async (workspace: ReturnType<Paseo["workspaces"]["ref"]>, config: Awaited<ReturnType<typeof agentConfiguration>>) => {
      const options = { config, labels: { "clips.ref": target.ref, "clips.projectId": project.projectId, "clips.kind": target.kind } };
      if (!managerClaim) return workspace.agents.create({ ...options, prompt: promptFor(target) });
      return launchLaneManager({
        ref: target.ref, hostId: input.hostId!, claim: managerClaim, prompt: promptFor(target),
        createIdle: () => workspace.agents.create(options),
        claimOwner: (request) => laneManagerCommand(paseo, project.root, "claim", target.ref, request),
      });
    };
    const [workspaces, agents] = await Promise.all([listWorkspaces(paseo), listAgents(paseo)]);
    const running = executionFor(target, project.projectIds, workspaces, agents);
    const existingAgent = running.agents.find(isActiveAgent);
    if (existingAgent?.workspaceId) {
      const workspace = workspaces.find((candidate) => candidate.id === existingAgent.workspaceId);
      return {
        workspaceId: existingAgent.workspaceId, branch: workspace?.branch || branchName(target),
        agentId: existingAgent.id, agent: null, reused: true, alreadyRunning: true,
      };
    }
    if (running.status === "attention") {
      throw new Error(`An agent for ${input.ref} needs input. Resolve it before starting another agent.`);
    }
    if (input.workspaceId) {
      if (input.mode !== "agent") throw new Error("Select agent mode when running Lanes work in an existing workspace.");
      const workspace = workspaces.find((candidate) => candidate.id === input.workspaceId);
      if (!workspace || !project.projectIds.includes(workspace.projectId)) {
        throw new Error("Choose a workspace that belongs to this Lanes project.");
      }
      const config = await agentConfiguration(paseo, project.root, prefs, input.agentConfig);
      const created = await createAgent(paseo.workspaces.ref(workspace.id), config);
      return {
        workspaceId: workspace.id, branch: workspace.branch, agentId: created.id,
        agent: config.provider, reused: true, alreadyRunning: false,
      };
    }
    // A configured provider is checked before any new workspace is created.
    const config = input.mode === "agent" && running.status !== "running"
      ? await agentConfiguration(paseo, project.root, prefs, input.agentConfig) : null;
    const prompt = config ? promptFor(target) : null;

    const existing = running.workspaceId
      ? workspaces.find((w) => w.id === running.workspaceId)
      : workspaces.find((w) => matchesWorkspace(w, target, project.projectIds));
    if (existing || running.workspaceId) {
      const id = existing?.id || running.workspaceId!;
      if (running.status === "running" || !config || !prompt) {
        return {
          workspaceId: id, branch: existing?.branch || branchName(target),
          agentId: null, agent: null, reused: true, alreadyRunning: running.status === "running",
        };
      }
      const workspace = paseo.workspaces.ref(id);
      const created = await createAgent(workspace, config);
      return { workspaceId: id, branch: existing?.branch || branchName(target), agentId: created.id, agent: config.provider, reused: true, alreadyRunning: false };
    }

    // Worktree remnants must not silently create another workspace on the same work.
    const branches = await command("git", ["-C", project.root, "branch", "--format=%(refname:short)"]);
    const prefix = branchPrefix(target);
    const orphan = branches.stdout.split("\n").find((b) => b === prefix || b.startsWith(`${prefix}-`));
    if (orphan) throw new Error(`Branch ${orphan} exists without a Paseo workspace. Reattach or remove it before creating a new workspace.`);

    const branch = branchName(target);
    const base = await command("git", ["-C", project.root, "branch", "--show-current"]);
    const baseBranch = base.stdout.trim();
    if (!baseBranch) {
      throw new Error("The selected Lanes project checkout is detached from a Git branch. Check out a branch before starting work in Paseo.");
    }
    const workspace = await paseo.workspaces.create({
      title: workspaceTitle(target),
      ...(input.mode === "workspace" ? {
        firstAgentContext: {
          attachments: [{
            type: "text" as const,
            mimeType: "text/plain" as const,
            title: `Lanes ${target.kind} ${target.ref}`,
            contextKind: "clips",
            text: promptFor(target),
          }],
        },
      } : {}),
      source: {
        kind: "worktree",
        cwd: project.root,
        action: "branch-off",
        branchName: branch,
        baseBranch,
      },
    });
    if (!config || !prompt) {
      return { workspaceId: workspace.id, branch, agentId: null, agent: null, reused: false, alreadyRunning: false };
    }
    try {
      const created = await createAgent(workspace, config);
      return { workspaceId: workspace.id, branch, agentId: created.id, agent: config.provider, reused: false, alreadyRunning: false };
    } catch (error) {
      throw new Error(`Workspace ${workspace.id} was created on ${branch}, but its agent could not start: ${errorText(error)}`);
    }
  } finally {
    inFlight.delete(key);
    releaseLaunch();
  }
}

export async function closeWork(
  paseo: Paseo,
  prefs: Preferences,
  input: {
    projectId: string;
    ref: string;
    laneClosure?: LaneClosureData;
    autoCompleteClosure: boolean;
  },
) {
  const project = await findProject(paseo, input.projectId);
  const board = normalizeBoard(await clipsBoard(paseo, project.root));
  const lane = board.lanes.find((item) => item.ref === input.ref);
  const goal = board.goals.find((item) => item.ref === input.ref);
  const target = lane ?? goal;
  if (!target) throw new Error(`Lanes lane or goal ${input.ref} does not exist in this project.`);
  if (target.status === "closed") throw new Error(`${input.ref} is already closed.`);

  const cli = await findClips(paseo);
  let autoCompleteStatus: "not_requested" | "not_needed" | "started" | "failed" = "not_requested";
  let autoCompleteError: string | null = null;
  if (lane) {
    const data = input.laneClosure ?? {
      summary: "",
      decision_log: "",
      system_overview: "",
      product_goals_achieved: [],
    };
    await command(cli.bin, [...cli.prefix, "lane", "close", lane.ref, JSON.stringify(data)], project.root);

    const missing = [
      ...(["summary", "decision_log", "system_overview"] as const).filter((field) => !data[field].trim()),
      ...(!data.product_goals_achieved.some((goal) => goal.trim()) ? ["product_goals_achieved"] : []),
    ];
    if (input.autoCompleteClosure && missing.length) {
      try {
        const relatedGoals = board.goals.filter((item) => lane.goalRefs.includes(item.ref));
        const config = await agentConfiguration(paseo, project.root, prefs);
        const agent = await paseo.agents.create({
          config,
          cwd: os.tmpdir(),
          title: `Lanes lane closure ${lane.ref}`,
          prompt: laneClosurePrompt(lane, relatedGoals, data, missing),
          outputSchema: laneClosureOutputSchema,
          autoArchive: true,
          labels: {
            "clips.kind": "lane-closure-autofill",
            "clips.ref": lane.ref,
            "clips.projectId": project.projectId,
          },
        });
        void finishLaneClosureAutofill(paseo, agent, cli, project.root, lane.ref, missing);
        autoCompleteStatus = "started";
      } catch (error) {
        autoCompleteStatus = "failed";
        autoCompleteError = errorText(error);
      }
    } else if (input.autoCompleteClosure) {
      autoCompleteStatus = "not_needed";
    }
  } else {
    await command(cli.bin, [...cli.prefix, "goal", "status", goal!.ref, "closed"], project.root);
  }
  return { ref: input.ref, status: "closed" as const, autoCompleteStatus, autoCompleteError };
}

const laneClosureOutputSchema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    decision_log: { type: "string" },
    system_overview: { type: "string" },
    product_goals_achieved: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "decision_log", "system_overview", "product_goals_achieved"],
  additionalProperties: false,
};

function laneClosurePrompt(
  lane: Lane,
  goals: Goal[],
  submitted: LaneClosureData,
  missing: string[],
): string {
  const context = {
    lane: {
      ref: lane.ref,
      title: lane.title,
      description: lane.description,
      plan: lane.plan,
      decisions: lane.decisions,
      scope: lane.scope,
      productGoals: lane.productGoals,
    },
    goals: goals.map((goal) => ({
      ref: goal.ref,
      title: goal.title,
      status: goal.status,
      description: goal.description,
      plan: goal.plan,
      decisions: goal.decisions,
      scope: goal.scope,
      tasks: goal.tasks.map((task) => ({
        ref: task.ref,
        title: task.title,
        status: task.status,
        description: task.description,
      })),
    })),
  };
  return [
    "Prepare missing retrospective fields for a Lanes Lane that has already been closed.",
    `Fill only these fields: ${missing.join(", ")}. For every other field, return an empty string or empty array.`,
    "Use only facts supported by the supplied lane and goal context. Do not invent outcomes or claim product goals were achieved without evidence from closed goals. If evidence is insufficient, leave that field empty.",
    "Do not inspect or modify files, run commands, or take any action. Return only JSON matching the requested schema.",
    `Submitted fields: ${JSON.stringify(submitted)}`,
    `Lane and goal context: ${JSON.stringify(context)}`,
  ].join("\n\n");
}

async function finishLaneClosureAutofill(
  paseo: Paseo,
  agent: Awaited<ReturnType<Paseo["agents"]["create"]>>,
  cli: Cli,
  root: string,
  laneRef: string,
  missing: string[],
) {
  try {
    const result = await agent.waitForFinish(600_000);
    if (result.status !== "idle" || !result.lastMessage) {
      throw new Error(result.error || `The agent finished with status ${result.status} without retrospective data.`);
    }
    const generated = laneClosureData.parse(JSON.parse(result.lastMessage));
    const patch: LaneClosureData = {
      summary: missing.includes("summary") ? generated.summary : "",
      decision_log: missing.includes("decision_log") ? generated.decision_log : "",
      system_overview: missing.includes("system_overview") ? generated.system_overview : "",
      product_goals_achieved: missing.includes("product_goals_achieved")
        ? generated.product_goals_achieved.map((goal) => goal.trim()).filter(Boolean)
        : [],
    };
    await command(cli.bin, [...cli.prefix, "lane", "closure", "fill", laneRef, JSON.stringify(patch)], root);
  } catch (error) {
    console.error(`[paseo] Background retrospective generation failed for ${laneRef}: ${errorText(error)}`);
  } finally {
    try {
      await agent.archive();
    } catch (error) {
      console.warn(`[paseo] Could not archive temporary retrospective agent for ${laneRef}: ${errorText(error)}`);
    }
  }
}
