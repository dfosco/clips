import { randomUUID } from "node:crypto";
import type { ResourceManagerSettings, ResourceManagerStatus } from "../shared/resource-manager";
import type { ResourceTarget } from "./resource-targets";

export type ResourceCapacityRequest = {
  action: "status" | "reserve" | "report" | "release";
  requestId?: string;
  count?: number;
  reservationId?: string;
  agentIds?: string[];
};

export type ResourceCapacityReservation = {
  id: string;
  requestId: string;
  count: number;
  expiresAt: number;
  agentIds: string[];
  /** Permission to launch the still-unused part of this lease, not proof of a launch. */
  valid: boolean;
};

export type ResourceCapacityResponse = {
  available: boolean;
  pressure: ResourceManagerStatus["pressure"];
  observedAt: number | null;
  expiresAt: number | null;
  activeDevCount: number;
  managerActiveDevCount: number;
  additionalDevCapacity: number;
  managerReservedCount: number;
  reservations: ResourceCapacityReservation[];
  holdReason: string | null;
};

export type ResourceCapacityObservation = {
  status: ResourceManagerStatus;
  settings: ResourceManagerSettings;
  targets: ResourceTarget[];
  observedAt: number;
  complete: boolean;
};

type Report = { reportedAt: number; accounted: boolean };
type Reservation = {
  id: string;
  managerId: string;
  requestId: string;
  requestedCount: number;
  count: number;
  expiresAt: number;
  releasedUnused: number;
  released: boolean;
  reports: Map<string, Report>;
};
type Observation = Omit<ResourceCapacityObservation, "targets"> & {
  managers: Map<string, Set<string>>;
  activeAgents: Set<string>;
};

const MAX_RETAINED_REQUESTS = 2048;
const REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;
const heldCount = (reservation: Reservation) => reservation.count - reservation.releasedUnused -
  [...reservation.reports.values()].filter((report) => report.accounted).length;
const unusedCount = (reservation: Reservation) => reservation.count - reservation.releasedUnused - reservation.reports.size;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Host-wide estimated headroom with one synchronous reservation ledger. No await
 * occurs between checking capacity and recording a grant, so concurrent manager
 * RPCs cannot spend the same headroom. Native observations, never a report alone,
 * account for running devs. There is no fixed worker cap or process control here.
 */
export function createResourceCapacity(options: { now?: () => number; id?: () => string } = {}) {
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const reservations = new Map<string, Reservation>();
  const requests = new Map<string, Map<string, Reservation>>();
  let observation: Observation | null = null;
  let invalidated = false;

  function availability(at: number) {
    const current = observation;
    const ttl = current ? Math.max(60_000, current.settings.sampleIntervalSeconds * 3_000) : 0;
    const sampledAt = current?.status.snapshot?.sampledAt;
    const expiresAt = current && finite(sampledAt) && finite(current.observedAt)
      ? Math.min(sampledAt, current.observedAt) + ttl : null;
    let reason: string | null = null;
    if (!current) reason = "No resource observation is available.";
    else if (invalidated) reason = "Resource observations have been invalidated; wait for a fresh sample and directory.";
    else if (!current.settings.enabled || !current.status.enabled || current.status.state !== "monitoring") {
      reason = `Resource manager is ${current.status.state}.`;
    } else if (!current.complete) reason = "The native manager/dev directory is incomplete.";
    else if (expiresAt === null || !finite(at) || !finite(sampledAt) || sampledAt > at || current.observedAt > at || at >= expiresAt) {
      reason = "The resource sample or native directory is stale or unavailable.";
    }
    return { available: reason === null, expiresAt, reason };
  }

  function headroom(at: number) {
    const health = availability(at);
    if (!health.available || !observation) return { ...health, capacity: 0 };
    const { status, settings } = observation;
    const snapshot = status.snapshot!;
    let reason: string | null = null;
    if (status.pressure !== "normal") reason = `Host resource pressure is ${status.pressure}; fold devs before dispatch.`;
    else if (finite(snapshot.memoryUsedRatio) && snapshot.memoryUsedRatio * 100 >= settings.memoryWarningPercent ||
      finite(snapshot.cpuUsedRatio) && snapshot.cpuUsedRatio * 100 >= settings.cpuWarningPercent) {
      reason = "A measured resource already meets its warning threshold; hold dispatch while pressure is evaluated.";
    }
    const { totalMemoryBytes: total, availableMemoryBytes: available, memoryUsedRatio: memory, cpuUsedRatio: cpu } = snapshot;
    if (!reason && (!finite(total) || total <= 0 || !finite(available) || available < 0 || available > total ||
      !finite(memory) || memory < 0 || memory > 1 || !finite(cpu) || cpu < 0 || cpu > 1)) {
      reason = "Memory or CPU measurements are unavailable; no estimated launch capacity can be granted.";
    }
    if (reason) return { ...health, capacity: 0, reason };
    // These configured costs are admission estimates, not per-process measurements.
    const memorySlots = Math.floor((available! - total! * (1 - settings.memoryWarningPercent / 100)) /
      (settings.devMemoryMb * 1024 ** 2));
    const cpuSlots = Math.floor((settings.cpuWarningPercent - cpu! * 100) / settings.devCpuPercent);
    return { ...health, capacity: Math.max(0, Math.min(memorySlots, cpuSlots)), reason: null };
  }

  function remove(reservation: Reservation) {
    reservations.delete(reservation.id);
    const managerRequests = requests.get(reservation.managerId);
    managerRequests?.delete(reservation.requestId);
    if (!managerRequests?.size) requests.delete(reservation.managerId);
  }

  function reconcile(at: number) {
    const current = observation;
    const fresh = availability(at).available && current !== null;
    const sampledAt = current?.status.snapshot?.sampledAt ?? -Infinity;
    for (const reservation of reservations.values()) {
      if (fresh) {
        for (const report of reservation.reports.values()) {
          // report() first verifies the native ID. A newer complete directory and
          // resource sample then account for it, including an agent folded since
          // that report. Repeating a report does not postpone this boundary.
          if (sampledAt > report.reportedAt && current.observedAt > report.reportedAt) report.accounted = true;
        }
        // A launch just before lease expiry may still be missing from the last
        // sample. Expiry revokes permission immediately, but retain its hold until
        // a complete observation crosses that boundary before reusing capacity.
        if (at >= reservation.expiresAt && sampledAt >= reservation.expiresAt && current.observedAt >= reservation.expiresAt) {
          reservation.releasedUnused += unusedCount(reservation);
        }
      }
      const disconnected = current?.complete && !current.managers.has(reservation.managerId);
      if (heldCount(reservation) === 0 && at >= reservation.expiresAt &&
        (disconnected || at >= reservation.expiresAt + REQUEST_RETENTION_MS)) remove(reservation);
    }
  }

  function response(managerId: string, at: number, include?: Reservation): ResourceCapacityResponse {
    const capacity = headroom(at);
    const totalReserved = [...reservations.values()].reduce((sum, entry) => sum + heldCount(entry), 0);
    const owned = [...reservations.values()].filter((entry) => entry.managerId === managerId);
    const additional = Math.max(0, capacity.capacity - totalReserved);
    return {
      available: capacity.available,
      pressure: observation?.status.pressure ?? "normal",
      observedAt: observation?.observedAt ?? null,
      expiresAt: capacity.expiresAt,
      activeDevCount: observation?.activeAgents.size ?? 0,
      managerActiveDevCount: observation?.managers.get(managerId)?.size ?? 0,
      additionalDevCapacity: additional,
      managerReservedCount: owned.reduce((sum, entry) => sum + heldCount(entry), 0),
      reservations: owned.filter((entry) => entry === include || at < entry.expiresAt || heldCount(entry) > 0).map((entry) => ({
        id: entry.id, requestId: entry.requestId, count: entry.count, expiresAt: entry.expiresAt,
        agentIds: [...entry.reports.keys()],
        valid: capacity.available && capacity.reason === null && totalReserved <= capacity.capacity &&
          at < entry.expiresAt && !entry.released && unusedCount(entry) > 0,
      })),
      holdReason: capacity.reason ?? (additional > 0 ? null : totalReserved > 0
        ? "The remaining estimated headroom is reserved by managers."
        : "Measured headroom is below the configured estimate for another dev."),
    };
  }

  function channel(managerId: string, request: ResourceCapacityRequest): ResourceCapacityResponse {
    if (!observation?.managers.has(managerId)) throw new Error("Manager is not in the observed native resource directory.");
    const at = now();
    reconcile(at);
    if (request.action === "status") return response(managerId, at);
    if (request.action === "reserve") {
      if (typeof request.requestId !== "string" || !request.requestId.trim() || request.requestId.length > 128) {
        throw new Error("A nonempty requestId of at most 128 characters is required.");
      }
      if (!Number.isSafeInteger(request.count) || request.count! < 1) throw new Error("Reservation count must be a positive safe integer.");
      const existing = requests.get(managerId)?.get(request.requestId);
      if (existing) {
        if (existing.requestedCount !== request.count) throw new Error("A reservation requestId cannot be retried with a different count.");
        return response(managerId, at, existing);
      }
      if (reservations.size >= MAX_RETAINED_REQUESTS) throw new Error("The resource reservation ledger is full; wait for retained requests to expire.");
      const before = response(managerId, at);
      const reservationId = id();
      if (!reservationId || reservations.has(reservationId)) throw new Error("Reservation ID must be nonempty and unique.");
      const reservation: Reservation = {
        id: reservationId, managerId, requestId: request.requestId, requestedCount: request.count!,
        count: Math.min(request.count!, before.additionalDevCapacity),
        expiresAt: at + observation.settings.reservationSeconds * 1000,
        releasedUnused: 0, released: false, reports: new Map(),
      };
      reservations.set(reservation.id, reservation);
      let managerRequests = requests.get(managerId);
      if (!managerRequests) requests.set(managerId, managerRequests = new Map());
      managerRequests.set(reservation.requestId, reservation);
      return response(managerId, at, reservation);
    }
    if (request.action !== "report" && request.action !== "release") throw new Error("Unknown resource capacity action.");
    const reservation = request.reservationId ? reservations.get(request.reservationId) : undefined;
    if (!reservation || reservation.managerId !== managerId) throw new Error("Reservation does not belong to this manager.");
    if (request.action === "release") {
      // Only unused slots are released. A report cannot turn a still-running dev
      // into spare headroom before the host has measured it.
      reservation.releasedUnused += unusedCount(reservation);
      reservation.released = true;
    } else {
      if (!availability(at).available) throw new Error("Fresh native resource observations are required before reporting started devs.");
      if (!Array.isArray(request.agentIds) || request.agentIds.length === 0 ||
        request.agentIds.some((agentId) => typeof agentId !== "string" || !agentId) ||
        new Set(request.agentIds).size !== request.agentIds.length) {
        throw new Error("Report agentIds must be a nonempty list of unique native dev IDs.");
      }
      const additions = request.agentIds.filter((agentId) => !reservation.reports.has(agentId));
      if (additions.length > unusedCount(reservation) || (reservation.released && additions.length > 0)) {
        throw new Error("Reported devs exceed the unused reservation grant.");
      }
      const managerAgents = observation.managers.get(managerId)!;
      if (additions.some((agentId) => !managerAgents.has(agentId))) throw new Error("Reported dev IDs must belong to this manager in the native directory.");
      for (const agentId of additions) reservation.reports.set(agentId, { reportedAt: at, accounted: false });
    }
    return response(managerId, at, reservation);
  }

  return {
    update(input: ResourceCapacityObservation): void {
      const managers = new Map<string, Set<string>>();
      const activeAgents = new Set<string>();
      for (const target of input.targets) {
        const agents = managers.get(target.managerId) ?? new Set<string>();
        for (const candidate of target.candidates) {
          agents.add(candidate.agentId);
          activeAgents.add(candidate.agentId);
        }
        managers.set(target.managerId, agents);
      }
      observation = {
        status: { ...input.status, reasons: [...input.status.reasons], snapshot: input.status.snapshot ? { ...input.status.snapshot } : null },
        settings: { ...input.settings }, observedAt: input.observedAt, complete: input.complete, managers, activeAgents,
      };
      invalidated = false;
      reconcile(now());
    },
    invalidate(): void { invalidated = true; },
    channel,
  };
}
