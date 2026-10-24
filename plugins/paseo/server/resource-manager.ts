import { randomUUID } from "node:crypto";
import type { PaseoAgent, PaseoApi } from "@getpaseo/client";
import {
  resourceManagerSettings, resourceSnapshot, type ResourceManagerSettings, type ResourceManagerStatus,
} from "../shared/resource-manager";
import {
  createPressureTracker, createResourceSampler,
  type PressureLevel, type PressureReason, type ResourceSnapshot,
} from "./resource-pressure";
import { discoverResourceTargets, type ResourceTarget } from "./resource-targets";
import { createResourceCapacity } from "./resource-capacity";
import { resourceChannelInput, type ResourceChannelInput } from "../shared/resource-channel";

type Notice = {
  sentAt: number;
  level: PressureLevel;
  reasons: PressureReason[];
  delivered: boolean;
  recoverySamples: number;
};

type Dependencies = {
  readSettings: () => Promise<unknown>;
  sample?: () => Promise<ResourceSnapshot>;
  discover?: typeof discoverResourceTargets;
  now?: () => number;
  warn?: (message: string) => void;
  autoStart?: boolean;
};

const pressureKey = (config: ResourceManagerSettings) => JSON.stringify([
  config.memoryWarningPercent, config.memoryCriticalPercent, config.memoryRecoveryPercent,
  config.cpuWarningPercent, config.cpuCriticalPercent, config.cpuRecoveryPercent, config.consecutiveSamples,
]);
const identityKey = (labels: Record<string, string> | undefined) => JSON.stringify(
  ["lanes", "clips"].flatMap((prefix) => ["kind", "ref", "projectId"].map((key) => labels?.[`${prefix}.${key}`] ?? null)),
);

/** The SDK has no atomic send-if-idle. Never intentionally interrupt or revive a manager. */
export function canNotifyManager(agent: PaseoAgent | null | undefined, target: ResourceTarget): boolean {
  return Boolean(agent && agent.id === target.managerId && agent.workspaceId === target.managerWorkspaceId &&
    agent.status === "idle" && !agent.archivedAt && !agent.providerUnavailable && !agent.activeTurn &&
    !agent.pendingPermissions?.length && !(agent.requiresAttention && agent.attentionReason !== "finished") &&
    agent.attentionReason !== "permission" && agent.attentionReason !== "error" &&
    identityKey(agent.labels) === identityKey(target.managerLabels));
}

/** An emergency may interrupt manager work: waiting for idle can defeat resource relief. */
export function canNotifyCriticalManager(agent: PaseoAgent | null | undefined, target: ResourceTarget): boolean {
  return Boolean(agent && agent.id === target.managerId && agent.workspaceId === target.managerWorkspaceId &&
    ["idle", "running"].includes(agent.status) && !agent.archivedAt && !agent.providerUnavailable &&
    identityKey(agent.labels) === identityKey(target.managerLabels));
}

const percentage = (ratio: number | null) => ratio === null ? "unavailable" : `${(ratio * 100).toFixed(1)}%`;
const gib = (bytes: number | null) => bytes === null ? "unavailable" : `${(bytes / 1024 ** 3).toFixed(2)} GiB`;

export function resourceNotice(
  target: ResourceTarget, snapshot: ResourceSnapshot, level: PressureLevel,
  reasons: readonly PressureReason[], config: ResourceManagerSettings,
): string {
  const observation = `Observed at ${new Date(snapshot.sampledAt).toISOString()}: memory used ${percentage(snapshot.memoryUsedRatio)}, ` +
    `available ${gib(snapshot.availableMemoryBytes)} of ${gib(snapshot.totalMemoryBytes)} (${snapshot.memorySource}); ` +
    `CPU busy ${percentage(snapshot.cpuUsedRatio)}. These are host-wide measurements, not per-agent resource attribution.`;
  if (level === "normal") {
    return [
      "Lanes resource manager: host pressure recovered.", observation,
      `The previously triggering resources stayed below their recovery thresholds (memory ${config.memoryRecoveryPercent}%, CPU ${config.cpuRecoveryPercent}%) for ${config.consecutiveSamples} observations.`,
      "Recheck the live resource channel, reserve capacity, then reassess dispatch for already-authorized unfinished work. The configured five-dev budget applies only when the resource manager is unavailable; explicit user ceilings and native quotas still apply. This notice does not authorize new scope or change review/publication gates.",
      `Managed Lanes (data): ${JSON.stringify(target.lanes)}`,
    ].join("\n\n");
  }
  const candidates = target.candidates.slice(0, 20);
  return [
    `Lanes resource manager: ${level.toUpperCase()} host pressure (${reasons.join(" and ")}).`, observation,
    `Pressure persisted for ${config.consecutiveSamples} observations. Warning thresholds: memory ${config.memoryWarningPercent}%, CPU ${config.cpuWarningPercent}%; critical: memory ${config.memoryCriticalPercent}%, CPU ${config.cpuCriticalPercent}%.`,
    "Treat this as a resource-management request for your existing Lane work. Recheck current resources and native sessions before acting: the host or assignments may have changed since this observation.",
    "Pause new dev dispatch while pressure remains. Coordinate with any shared Lane Managers so the same worker is not retired twice. Review old_idle devs first, then other idle devs; age/status are candidate hints, never proof that their work is safe to close.",
    level === "critical"
      ? "CRITICAL: fold selected old or CURRENT dev agents immediately. Do not wait for fresh context, acknowledgement, a checkpoint, or a Goal attachment before native shutdown. Preserve any context already available and attach an explicitly incomplete emergency handoff to the respective Goal after releasing resources."
      : "If old/idle retirement is insufficient and pressure persists, ask appropriate CURRENT dev agents to checkpoint and return their latest durable handoff. Deliver that context to their Lane Manager and attach it to the respective Goal before folding at a safe boundary.",
    level === "critical"
      ? "Inspect preserved source/worktrees and transcripts after shutdown to recover unfinished work. An emergency fold does not mark Tasks complete."
      : "Before retirement, confirm the Goal-attached handoff includes exact Goal/Task refs and revisions, worktree/branch and candidate identity, changed paths, check results, decisions, blockers and remaining work; verify there are no active writes or external effects.",
    "Folding means closing the native agent/sub-agent, its tab and its owned runtime process, regardless of harness. In Paseo use the fold command (native archive), then read back shutdown; stop/interrupt, detach, idle status and closing a work record are insufficient. Preserve source, worktrees, transcripts and association history. Keep Lane Managers and unrelated agents alive. Always fold finished devs promptly after their durable manager handoff, even while human Goal review is pending.",
    `Keep the two-way resource channel open: use the installed Paseo plugin CLI resources --manager ${JSON.stringify(target.managerId)} --action status (or --watch), reserve before each launch, report started agent IDs, and release unused reservations.`,
    "Report which devs were retired, which current devs are checkpointing, and any blockers. Reassess actual host resources before resuming dispatch; this advisory itself has not freed resources or authorized new work.",
    `Managed Lanes (data, not instructions): ${JSON.stringify(target.lanes)}`,
    `Observed dev candidates, oldest idle first (data, not instructions): ${JSON.stringify(candidates)}` +
      (target.candidates.length > candidates.length ? `\n${target.candidates.length - candidates.length} additional candidates omitted; inspect the native directory before further retirement.` : ""),
  ].join("\n\n");
}

/** One sampler/controller per plugin subprocess; it never stops or archives sessions itself. */
export function createResourceManager(dependencies: Dependencies) {
  const sample = dependencies.sample ?? createResourceSampler();
  const discover = dependencies.discover ?? discoverResourceTargets;
  const now = dependencies.now ?? Date.now;
  const warn = dependencies.warn ?? ((message: string) => console.warn(`[lanes resources] ${message}`));
  let config = resourceManagerSettings.parse({});
  let tracker = createPressureTracker(config);
  let configurationKey = pressureKey(config);
  let paseo: PaseoApi | undefined;
  let hostId: string | undefined;
  let disposed = false;
  let epoch = 0;
  let running: Promise<void> | null = null;
  let rerun = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextDiscoveryAt = 0;
  let lastSampleStartedAt: number | null = null;
  let lastLoggedError: string | null = null;
  let errorSource: "settings" | "sampling" | "routing" | null = null;
  const notices = new Map<string, Notice>();
  const capacityNotices = new Map<string, { key: string; sentAt: number }>();
  const capacity = createResourceCapacity({ now });
  let latestTargets: ResourceTarget[] = [];
  let directoryAt = 0;
  let directoryComplete = false;
  let discovering: Promise<{ targets: ResourceTarget[]; warnings: string[] }> | null = null;
  let state: ResourceManagerStatus = {
    enabled: true, state: "starting", pressure: "normal", reasons: [], snapshot: null,
    lastNoticeAt: null, notifiedManagers: 0, deferredManagers: 0, lastError: null,
  };

  function updateCapacity() {
    capacity.update({ status: state, settings: config, targets: latestTargets,
      observedAt: directoryAt, complete: directoryComplete });
  }

  async function observeTargets() {
    if (discovering) return discovering;
    if (!paseo || disposed) throw new Error("The resource manager has no live Paseo connection.");
    if (directoryAt && now() < nextDiscoveryAt) return { targets: latestTargets, warnings: directoryComplete ? [] : ["Resource discovery is incomplete."] };
    const runtime = paseo, currentEpoch = epoch;
    nextDiscoveryAt = now() + Math.max(config.sampleIntervalSeconds, 30) * 1000;
    discovering = discover(runtime, { now: now(), idleAgeSeconds: config.idleAgeSeconds, hostId }).then((result) => {
      if (disposed || currentEpoch !== epoch) throw new Error("Resource discovery was superseded.");
      latestTargets = result.targets; directoryAt = now(); directoryComplete = !result.warnings.length;
      updateCapacity();
      return result;
    }).finally(() => { discovering = null; });
    return discovering;
  }

  async function notifyCapacity(targets: ResourceTarget[], current: () => boolean) {
    for (const target of targets) {
      if (!current()) return;
      const view = capacity.channel(target.managerId, { action: "status" });
      const snapshot = state.snapshot;
      if (!view.available || snapshot?.memoryUsedRatio == null || snapshot.cpuUsedRatio == null ||
          snapshot.memoryUsedRatio * 100 >= config.memoryWarningPercent || snapshot.cpuUsedRatio * 100 >= config.cpuWarningPercent) continue;
      const key = JSON.stringify([view.additionalDevCapacity, view.managerActiveDevCount, view.managerReservedCount]);
      const previous = capacityNotices.get(target.managerId);
      if (previous && (previous.key === key || now() - previous.sentAt < config.notificationCooldownSeconds * 1000)) continue;
      try {
        const manager = paseo!.agents.ref(target.managerId);
        const fresh = await manager.refresh();
        if (!current()) return;
        if (!canNotifyManager(fresh?.agent, target)) continue;
        capacityNotices.set(target.managerId, { key, sentAt: now() });
        await manager.send([
          "Lanes resource manager: capacity channel update.",
          `Your observed live devs: ${view.managerActiveDevCount}. Host-wide additional dev capacity currently available to reserve: ${view.additionalDevCapacity}. These estimates are shared across managers and are not a launch grant.`,
          ...(view.holdReason ? [view.holdReason] : []),
          `Keep the two-way channel open using the installed plugin CLI: resources --manager ${JSON.stringify(target.managerId)} --action status (or --watch). Reserve before dispatch, report exact started agent IDs, and release unused reservations. Recheck validity before launching.`,
          "Use this live capacity while available; the configured five-dev limit is the fallback for an unavailable resource manager. Respect explicit user ceilings and native quotas. Always fold finished devs promptly: latest context to their manager, attach it to the corresponding Goal, then close the native agent/tab/process. Human review does not require keeping finished devs alive.",
        ].join("\n\n"), { messageId: randomUUID(), activeTurnBehavior: "steer" });
      } catch (error) { if (current()) report(`Capacity update for ${target.managerId} failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }

  function report(message: string, source: NonNullable<typeof errorSource> = "routing") {
    state.lastError = message;
    errorSource = source;
    if (message !== lastLoggedError) warn(message);
    lastLoggedError = message;
  }

  function clearError(source: NonNullable<typeof errorSource>) {
    if (errorSource !== source) return;
    state.lastError = null; lastLoggedError = null; errorSource = null;
  }

  function breakObservationStreak() {
    tracker.observe({ sampledAt: now(), totalMemoryBytes: null, availableMemoryBytes: null,
      memoryUsedRatio: null, cpuUsedRatio: null, memorySource: "unavailable" });
    for (const notice of notices.values()) notice.recoverySamples = 0;
  }

  function schedule(delay = config.sampleIntervalSeconds * 1000) {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void check(); }, delay);
    timer.unref?.();
  }

  async function evaluate() {
    const evaluationEpoch = epoch;
    const current = () => !disposed && evaluationEpoch === epoch;
    let phase: NonNullable<typeof errorSource> = "settings";
    try {
      const nextConfig = resourceManagerSettings.parse(await dependencies.readSettings());
      if (!current()) return;
      clearError("settings");
      config = nextConfig;
      state.enabled = config.enabled;
      if (!config.enabled) {
        tracker.reset(); notices.clear(); nextDiscoveryAt = 0;
        state = { ...state, state: "disabled", pressure: "normal", reasons: [],
          notifiedManagers: 0, deferredManagers: 0, lastError: null };
        lastLoggedError = null; errorSource = null;
        updateCapacity();
        return;
      }
      const nextKey = pressureKey(config);
      if (nextKey !== configurationKey) {
        configurationKey = nextKey;
        tracker = createPressureTracker(config);
        for (const notice of notices.values()) notice.recoverySamples = 0;
        nextDiscoveryAt = 0;
      }
      // Hooks/settings notifications must not turn a burst of events into a
      // fictitious sustained-pressure window.
      if (lastSampleStartedAt !== null && now() - lastSampleStartedAt >= 0 &&
          now() - lastSampleStartedAt < config.sampleIntervalSeconds * 1000) return;
      lastSampleStartedAt = now();
      phase = "sampling";
      const snapshot = await sample();
      if (!current()) return;
      resourceSnapshot.parse(snapshot);
      clearError("sampling");
      const pressure = tracker.observe(snapshot);
      state = { ...state, state: paseo ? "monitoring" : "awaiting_runtime", snapshot,
        pressure: pressure.level, reasons: [...pressure.reasons] };
      updateCapacity();
      for (const notice of notices.values()) {
        const recovered = notice.reasons.length > 0 && notice.reasons.every((reason) => {
          const ratio = snapshot[reason === "memory" ? "memoryUsedRatio" : "cpuUsedRatio"];
          return ratio !== null && ratio * 100 < config[`${reason}RecoveryPercent`];
        });
        notice.recoverySamples = recovered ? notice.recoverySamples + 1 : 0;
      }
      if (!paseo) return;
      const recoveryPending = pressure.level === "normal" && [...notices.values()].some((notice) =>
        notice.delivered && notice.recoverySamples >= config.consecutiveSamples);
      const freshPressure = pressure.level !== "normal" && pressure.reasons.some((reason) => {
        const ratio = snapshot[reason === "memory" ? "memoryUsedRatio" : "cpuUsedRatio"];
        return ratio !== null && ratio * 100 >= config[`${reason}WarningPercent`];
      });
      if (pressure.changed) nextDiscoveryAt = 0;
      phase = "routing";
      const runtime = paseo;
      const result = await observeTargets();
      if (!current()) return;
      if (result.warnings.length) report(result.warnings.join("\n").slice(0, 2000));
      else clearError("routing");
      updateCapacity();
      if (!freshPressure && !recoveryPending) {
        if (pressure.level === "normal" && !notices.size) state.deferredManagers = 0;
        if (pressure.level === "normal" && !notices.size) await notifyCapacity(result.targets, current);
        return;
      }
      state.deferredManagers = 0;
      const liveManagers = new Set(result.targets.map((target) => target.managerId));
      // Keep entries through partial discovery failures, but bound history when discovery is complete.
      if (!result.warnings.length) for (const id of notices.keys()) if (!liveManagers.has(id)) notices.delete(id);
      for (const target of result.targets) {
        if (!current()) return;
        const previous = notices.get(target.managerId);
        const recovering = pressure.level === "normal";
        if (recovering) {
          if (!previous?.delivered || previous.recoverySamples < config.consecutiveSamples) continue;
          if (previous.level === "normal" && now() - previous.sentAt < config.notificationCooldownSeconds * 1000) continue;
        } else {
          if (!freshPressure || !target.candidates.length) continue;
          const escalating = pressure.level === "critical" && previous?.level !== "critical";
          if (previous && !escalating && now() - previous.sentAt < config.notificationCooldownSeconds * 1000) continue;
        }
        try {
          const manager = runtime.agents.ref(target.managerId);
          const refreshed = await manager.refresh();
          if (!current()) return;
          if (!(pressure.level === "critical" ? canNotifyCriticalManager(refreshed?.agent, target) : canNotifyManager(refreshed?.agent, target))) {
            state.deferredManagers += 1;
            continue;
          }
          // Reserve cooldown before sending: a timed-out RPC may already have delivered.
          const attempt: Notice = {
            sentAt: now(), level: pressure.level,
            reasons: [...new Set([...(previous?.reasons ?? []), ...pressure.reasons])],
            delivered: previous?.delivered ?? false, recoverySamples: previous?.recoverySamples ?? 0,
          };
          notices.set(target.managerId, attempt);
          if (!current()) return;
          await manager.send(resourceNotice(target, snapshot, pressure.level, pressure.reasons, config), {
            messageId: randomUUID(), activeTurnBehavior: "steer",
          });
          if (!current()) return;
          state.lastNoticeAt = now();
          if (recovering) notices.delete(target.managerId);
          else attempt.delivered = true;
        } catch (error) {
          if (!current()) return;
          report(`Could not notify Lane Manager ${target.managerId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      state.notifiedManagers = [...notices.values()].filter((notice) => notice.delivered).length;
    } catch (error) {
      if (!current()) return;
      if (phase !== "routing") breakObservationStreak();
      // Never silently enable defaults when stored settings or discovery are invalid.
      state.state = "error";
      report(error instanceof Error ? error.message : String(error), phase);
      updateCapacity();
    }
  }

  function check(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (running) return running;
    if (timer) { clearTimeout(timer); timer = undefined; }
    running = evaluate().finally(() => {
      running = null;
      const immediately = rerun;
      rerun = false;
      schedule(immediately ? 0 : undefined);
    });
    return running;
  }

  const controller = {
    bind(api: PaseoApi, observedHostId?: string) {
      if (disposed) return;
      if (paseo && paseo !== api) {
        epoch += 1; notices.clear(); nextDiscoveryAt = 0;
        latestTargets = []; directoryAt = 0; directoryComplete = false; capacity.invalidate(); capacityNotices.clear();
      }
      paseo = api;
      if (observedHostId?.trim() && observedHostId !== hostId) {
        hostId = observedHostId;
        epoch += 1; nextDiscoveryAt = 0;
        latestTargets = []; directoryAt = 0; directoryComplete = false;
        capacity.invalidate(); capacityNotices.clear();
        if (running) rerun = true;
      }
      if (state.state === "awaiting_runtime") state.state = "monitoring";
    },
    check,
    async target(managerId: string): Promise<ResourceTarget> {
      // A critical fold uses the recent directory plus fresh native identity checks;
      // it never waits for a new batch of CLI discovery merely to request context.
      const ttl = Math.max(60000, config.sampleIntervalSeconds * 3000);
      if (!directoryAt || now() - directoryAt > ttl || !latestTargets.some((target) => target.managerId === managerId)) await observeTargets();
      const target = latestTargets.find((entry) => entry.managerId === managerId);
      if (!target || disposed) throw new Error("No observed Lane Manager matches this resource channel. Refresh/register the native session first.");
      return target;
    },
    critical(): boolean {
      const snapshot = state.snapshot;
      if (!snapshot || !state.enabled || state.state !== "monitoring" || disposed ||
          now() - snapshot.sampledAt > Math.max(60000, config.sampleIntervalSeconds * 3000)) return false;
      return state.pressure === "critical" ||
        snapshot.memoryUsedRatio !== null && snapshot.memoryUsedRatio * 100 >= config.memoryCriticalPercent ||
        snapshot.cpuUsedRatio !== null && snapshot.cpuUsedRatio * 100 >= config.cpuCriticalPercent;
    },
    async channel(raw: ResourceChannelInput) {
      const input = resourceChannelInput.parse(raw);
      await check();
      const target = await controller.target(input.managerId);
      const native = await paseo!.agents.ref(input.managerId).refresh();
      if (disposed || !native || native.agent.archivedAt || native.agent.status === "closed" ||
          native.agent.workspaceId !== target.managerWorkspaceId || identityKey(native.agent.labels) !== identityKey(target.managerLabels)) {
        throw new Error("The Lane Manager channel no longer matches a live native session.");
      }
      // Reports need a current directory even when the preceding sampling tick was throttled.
      if (input.action === "report") { nextDiscoveryAt = 0; await observeTargets(); }
      updateCapacity();
      return capacity.channel(input.managerId, input);
    },
    settingsChanged() {
      if (disposed) return;
      epoch += 1;
      nextDiscoveryAt = 0;
      capacity.invalidate();
      state.state = "starting";
      if (running) rerun = true;
      else schedule(0);
    },
    status(): ResourceManagerStatus {
      return { ...state, reasons: [...state.reasons], snapshot: state.snapshot ? { ...state.snapshot } : null };
    },
    dispose() {
      if (disposed) return;
      disposed = true; epoch += 1;
      if (timer) clearTimeout(timer);
      timer = undefined; notices.clear();
      state.state = "stopped";
      capacity.invalidate(); capacityNotices.clear(); latestTargets = [];
      // Paseo belongs to the plugin host, not this monitor.
    },
  };
  if (dependencies.autoStart !== false) schedule(0);
  return controller;
}
