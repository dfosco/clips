import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import { execCommand } from "@getpaseo/plugin/server";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  handoffReceipt, resourceFoldInput, resourceHandoffInput,
  type HandoffReceipt, type ResourceFoldInput, type ResourceHandoffInput,
} from "../shared/resource-channel";
import { findClips } from "./clips-cli";
import type { ResourceCandidate, ResourceTarget } from "./resource-targets";

type HandoffData = {
  context: string; agent_id: string; manager_id: string; handoff_id: string;
  reason: ResourceHandoffInput["reason"]; incomplete: boolean;
};
type SavedHandoff = {
  success: true; handoff_id: string; goal_ref: string; source_ref: string; context: string; incomplete: boolean;
  attachment: HandoffReceipt["attachment"];
};
type Dependencies = {
  target: (managerId: string) => Promise<ResourceTarget>;
  critical: () => boolean;
  persist?: (paseo: PaseoApi, candidate: ResourceCandidate, data: HandoffData) => Promise<SavedHandoff>;
  now?: () => number;
};

/** Keep all work-record interpretation and writes inside the canonical CLI. */
export async function persistFoldHandoff(paseo: PaseoApi, candidate: ResourceCandidate, data: HandoffData): Promise<SavedHandoff> {
  const cli = await findClips(paseo);
  const directory = await mkdtemp(path.join(tmpdir(), "lanes-handoff-"));
  try {
    const input = path.join(directory, "input.json");
    await writeFile(input, JSON.stringify(data), { mode: 0o600 });
    const result = await execCommand(cli.bin, [...cli.prefix, "handoff", "record", candidate.ref, "--file", input], {
      cwd: candidate.projectRoot, timeout: 10000, maxBuffer: 1024 * 1024,
    });
    const saved = JSON.parse(result.stdout) as SavedHandoff;
    if (saved.success !== true || saved.goal_ref !== candidate.goalRef || saved.source_ref !== candidate.ref ||
        saved.handoff_id !== data.handoff_id || saved.context !== data.context || saved.incomplete !== data.incomplete) {
      throw new Error("The handoff CLI did not confirm the expected Goal and context.");
    }
    return saved;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

const labelsKey = (labels: Record<string, string> | undefined) => JSON.stringify(
  ["lanes", "clips"].flatMap((prefix) => ["kind", "ref", "projectId"].map((key) => labels?.[`${prefix}.${key}`] ?? null)),
);
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const assignmentKey = (candidate: ResourceCandidate) => JSON.stringify([
  candidate.projectRoot, candidate.projectId, candidate.laneRef, candidate.workspaceId, labelsKey(candidate.labels),
]);
type ReceiptBasis = { assignment: string; generation: number; lastUserMessageAt: string | null;
  updatedAt: string | null; inTurn: boolean };
function liveIdentity(agent: PaseoAgent | undefined, id: string, workspaceId: string, labels: Record<string, string>, allowArchived = false) {
  return !!agent && agent.id === id && agent.workspaceId === workspaceId && (allowArchived || !agent.archivedAt) &&
    agent.status !== "closed" && !agent.providerUnavailable && labelsKey(agent.labels) === labelsKey(labels);
}

/** Two-phase normal folds: a durable inbox receipt, then the manager's explicit acknowledgement.
 * Critical folds invoke native shutdown first and never wait for a new dev response or file write. */
export function createResourceFolding(dependencies: Dependencies) {
  const persist = dependencies.persist ?? persistFoldHandoff;
  const now = dependencies.now ?? Date.now;
  const handoffs = new Map<string, HandoffReceipt>();
  const bases = new Map<string, ReceiptBasis>();
  const generations = new Map<string, number>();
  const writing = new Map<string, number>();
  const folding = new Set<string>();
  let disposed = false;

  async function attribution(paseo: PaseoApi, managerId: string, agentId: string) {
    if (disposed) throw new Error("Resource folding has stopped.");
    if (managerId === agentId) throw new Error("A Lane Manager cannot be folded as its own developer.");
    const target = await dependencies.target(managerId);
    const candidate = target.candidates.find((entry) => entry.agentId === agentId);
    if (!candidate) throw new Error("The developer is not attributed to this manager's current Lane work.");
    const [manager, developer] = await Promise.all([
      paseo.agents.ref(managerId).refresh(), paseo.agents.ref(agentId).refresh(),
    ]);
    if (disposed || !liveIdentity(manager?.agent, managerId, target.managerWorkspaceId, target.managerLabels) ||
        !liveIdentity(developer?.agent, agentId, candidate.workspaceId, candidate.labels, true)) {
      throw new Error("Native manager/developer identity changed; refresh the resource channel before folding.");
    }
    return { candidate, developer: developer!.agent };
  }

  async function record(paseo: PaseoApi, candidate: ResourceCandidate, data: HandoffData) {
    const saved = await persist(paseo, candidate, data);
    const receipt = handoffReceipt.parse({
      handoffId: saved.handoff_id, managerId: data.manager_id, agentId: data.agent_id,
      goalRef: saved.goal_ref, sourceRef: saved.source_ref, context: saved.context, incomplete: saved.incomplete,
      attachment: saved.attachment, recordedAt: now(),
    });
    // The Goal attachment remains durable; the bounded inbox is only a delivery cache.
    if (handoffs.size >= 100 && !handoffs.has(receipt.handoffId)) {
      const oldest = handoffs.keys().next().value!;
      handoffs.delete(oldest); bases.delete(oldest);
      for (const agentId of generations.keys()) {
        if (!writing.has(agentId) && ![...handoffs.values()].some((entry) => entry.agentId === agentId)) generations.delete(agentId);
      }
    }
    // An exact retry of an older checkpoint must not replace the latest one.
    if (!handoffs.has(receipt.handoffId)) handoffs.set(receipt.handoffId, receipt);
    return receipt;
  }

  return {
    turnStarted(agentId: string) {
      // Track only agents with a handoff in progress or in the bounded inbox.
      if (generations.has(agentId)) generations.set(agentId, generations.get(agentId)! + 1);
    },
    pending(managerId: string): HandoffReceipt[] {
      return [...handoffs.values()].filter((entry) => entry.managerId === managerId).map((entry) => ({
        ...entry, attachment: { ...entry.attachment },
      }));
    },
    async handoff(paseo: PaseoApi, raw: ResourceHandoffInput): Promise<HandoffReceipt> {
      const input = resourceHandoffInput.parse(raw);
      if (folding.has(input.agentId)) throw new Error("This developer is already folding; preserve any late context with lanes handoff record.");
      writing.set(input.agentId, (writing.get(input.agentId) ?? 0) + 1);
      if (!generations.has(input.agentId)) generations.set(input.agentId, 0);
      try {
        const { candidate, developer } = await attribution(paseo, input.managerId, input.agentId);
        const basis: ReceiptBasis = { assignment: assignmentKey(candidate), generation: generations.get(input.agentId)!,
          lastUserMessageAt: developer.lastUserMessageAt ?? null, updatedAt: developer.updatedAt ?? null,
          inTurn: Boolean(developer.activeTurn) };
        const receipt = await record(paseo, candidate, {
          context: input.context, agent_id: input.agentId, manager_id: input.managerId,
          handoff_id: input.handoffId ?? randomUUID(), reason: input.reason, incomplete: false,
        });
        if (!bases.has(receipt.handoffId)) bases.set(receipt.handoffId, basis);
        return receipt;
      } finally {
        const pending = writing.get(input.agentId)! - 1;
        if (pending) writing.set(input.agentId, pending); else writing.delete(input.agentId);
      }
    },
    async fold(paseo: PaseoApi, raw: ResourceFoldInput) {
      const input = resourceFoldInput.parse(raw);
      if (folding.has(input.agentId)) throw new Error("This developer already has a fold in progress.");
      folding.add(input.agentId);
      try {
        const { candidate, developer } = await attribution(paseo, input.managerId, input.agentId);
        const critical = dependencies.critical();
        if (!critical && writing.has(input.agentId)) throw new Error("The developer has a newer context write in progress; read its completed handoff before folding.");
        const receipt = input.handoffId ? handoffs.get(input.handoffId) : undefined;
        const basis = input.handoffId ? bases.get(input.handoffId) : undefined;
        const latest = [...handoffs.values()].filter((entry) => entry.agentId === input.agentId &&
          entry.managerId === input.managerId && entry.goalRef === candidate.goalRef).at(-1);
        const matching = receipt?.managerId === input.managerId && receipt.agentId === input.agentId &&
          receipt.sourceRef === candidate.ref && receipt.goalRef === candidate.goalRef && receipt.handoffId === latest?.handoffId;
        if (!critical && (!matching || receipt!.incomplete)) {
          throw new Error("Read the latest Goal-attached handoff from the manager channel, then acknowledge its --handoff-id before folding.");
        }
        if (!critical && (developer.status !== "idle" || developer.activeTurn || developer.pendingPermissions?.length)) {
          throw new Error("The developer must finish its checkpoint and become idle before a normal fold. Critical pressure bypasses this wait.");
        }
        if (!critical && (!basis || basis.assignment !== assignmentKey(candidate) ||
            basis.generation !== generations.get(input.agentId) || basis.lastUserMessageAt !== (developer.lastUserMessageAt ?? null) ||
            !basis.inTurn && basis.updatedAt !== (developer.updatedAt ?? null))) {
          throw new Error("The developer's assignment or native activity advanced since this handoff; request its latest context with a new handoff ID.");
        }
        if (disposed) throw new Error("Resource folding has stopped.");
        const handle = paseo.agents.ref(input.agentId);
        // archive closes the provider runtime and removes its tabs. detach/stop do neither.
        let archiveWarning: string | null = null;
        try { await handle.archive(); }
        catch (failure) { archiveWarning = `Native archive reported: ${errorText(failure)}`; }
        let observed;
        try { observed = await handle.refresh(); }
        catch (failure) { return { agentId: input.agentId, closed: false, critical, handoff: matching ? receipt! : null,
          error: `${archiveWarning ? `${archiveWarning}. ` : ""}Native shutdown readback failed; keep the developer counted: ${errorText(failure)}` }; }
        const closed = Boolean(observed?.agent.archivedAt && observed.agent.status === "closed");
        if (!closed) return { agentId: input.agentId, closed: false, critical,
          handoff: matching ? receipt! : null, error: `${archiveWarning ? `${archiveWarning}. ` : ""}Native shutdown has not been confirmed; keep this developer counted and inspect its runtime.` };
        let handoff = matching ? receipt! : null;
        let error: string | null = archiveWarning;
        if (critical) {
          // Always mark emergency closure incomplete, even if an older checkpoint exists.
          const context = [
            "Emergency fold: critical host resource pressure. Native agent/tab/runtime closure occurred without waiting for a fresh developer handoff.",
            `Observed assignment: ${candidate.ref}; Goal: ${candidate.goalRef}; workspace: ${candidate.workspaceId}.`,
            "Context may be incomplete. Inspect the preserved worktree and transcript before resuming work; unfinished Tasks remain unfinished.",
            latest ? `Last available checkpoint (not confirmed current):\n\n${latest.context}` : "No developer checkpoint was available in the resource channel.",
          ].join("\n\n");
          try { handoff = await record(paseo, candidate, {
            context, agent_id: input.agentId, manager_id: input.managerId, handoff_id: randomUUID(),
            reason: "resource_critical", incomplete: true,
          }); } catch (failure) { error = `${archiveWarning ? `${archiveWarning}. ` : ""}Native fold completed, but the emergency context still needs a Goal attachment: ${errorText(failure)}`; }
        }
        // Keep the latest receipt visible until the manager sees the result; attachments survive reloads.
        return { agentId: input.agentId, closed: true, critical, handoff, error };
      } finally { folding.delete(input.agentId); }
    },
    dispose() { disposed = true; handoffs.clear(); bases.clear(); generations.clear(); },
  };
}
