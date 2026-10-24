import { describe, expect, it } from "vitest";
import { resourceManagerSettings, type ResourceManagerStatus } from "../shared/resource-manager";
import { createResourceCapacity, type ResourceCapacityObservation } from "./resource-capacity";
import type { ResourceCandidate, ResourceTarget } from "./resource-targets";

const start = Date.parse("2026-10-24T12:00:00Z");
const gib = 1024 ** 3;
const lane = { projectId: "project", projectLabel: "Project", laneRef: "#l001", laneTitle: "Delivery" };
const dev = (agentId: string, status = "running"): ResourceCandidate => ({
  ...lane, agentId, workspaceId: `${agentId}-workspace`, projectRoot: "/repos/project", goalRef: "#g001",
  labels: { "lanes.kind": "task", "lanes.ref": "#g001#t01", "lanes.projectId": "project" },
  ref: "#g001#t01", status, disposition: status === "idle" ? "old_idle" : "current", updatedAt: null, needsInput: false,
});
const manager = (managerId: string, candidates: ResourceCandidate[] = []): ResourceTarget => ({
  managerId, managerWorkspaceId: `${managerId}-workspace`, managerLabels: {}, lanes: [lane], candidates,
});
const status = (at: number): ResourceManagerStatus => ({
  enabled: true, state: "monitoring", pressure: "normal", reasons: [], lastNoticeAt: null,
  notifiedManagers: 0, deferredManagers: 0, lastError: null,
  snapshot: { sampledAt: at, totalMemoryBytes: 16 * gib, availableMemoryBytes: 12 * gib,
    memoryUsedRatio: 0.25, cpuUsedRatio: 0.2, memorySource: "linux-memavailable" },
});

function fixture() {
  let at = start;
  let serial = 0;
  const capacity = createResourceCapacity({ now: () => at, id: () => `lease-${++serial}` });
  let observed: ResourceCapacityObservation = {
    status: status(at), settings: resourceManagerSettings.parse({}), observedAt: at, complete: true,
    targets: [manager("a"), manager("b")],
  };
  const update = (overrides: Partial<ResourceCapacityObservation> = {}) => {
    observed = { ...observed, ...overrides };
    capacity.update(observed);
  };
  const fresh = (overrides: Partial<ResourceCapacityObservation> = {}) => update({
    observedAt: at, status: { ...observed.status, snapshot: { ...observed.status.snapshot!, sampledAt: at } }, ...overrides,
  });
  const view = (managerId = "a") => capacity.channel(managerId, { action: "status" });
  const reserve = (count: number, requestId = `request-${serial + 1}`, managerId = "a") =>
    capacity.channel(managerId, { action: "reserve", requestId, count });
  update();
  return { capacity, update, fresh, view, reserve, clock: (value: number) => { at = value; },
    get observation() { return observed; } };
}

describe("shared resource capacity", () => {
  it("uses measured headroom above five and counts every native dev once, including idle and nested devs", () => {
    const f = fixture();
    f.update({ targets: [manager("a", [dev("old-idle", "idle"), dev("nested"), dev("shared")]),
      manager("b", [dev("shared"), dev("other", "initializing")])] });
    expect(f.view()).toMatchObject({ available: true, activeDevCount: 4, managerActiveDevCount: 3,
      additionalDevCapacity: 7, managerReservedCount: 0, holdReason: null });
    expect(f.reserve(7).reservations).toEqual([{
      id: "lease-1", requestId: "request-1", count: 7, expiresAt: start + 120_000, agentIds: [], valid: true,
    }]);
    expect(f.view("b").additionalDevCapacity).toBe(0);
    f.update({ targets: [manager("a", [dev("nested"), dev("shared")]), manager("b", [dev("shared"), dev("other")])] });
    expect(f.view()).toMatchObject({ activeDevCount: 3, managerActiveDevCount: 2 });
  });

  it("uses the tighter memory estimate and configurable per-dev estimates", () => {
    const f = fixture();
    f.update({ status: { ...status(start), snapshot: { ...status(start).snapshot!,
      availableMemoryBytes: 6 * gib, memoryUsedRatio: 0.625, cpuUsedRatio: 0.1 } } });
    expect(f.view().additionalDevCapacity).toBe(3);
    f.update({ settings: resourceManagerSettings.parse({ devMemoryMb: 512, devCpuPercent: 5 }) });
    expect(f.view().additionalDevCapacity).toBe(7);
  });

  it("atomically shares one pool across simultaneous manager requests", async () => {
    const f = fixture();
    const responses = await Promise.all([
      Promise.resolve().then(() => f.reserve(4, "same-id", "a")),
      Promise.resolve().then(() => f.reserve(4, "same-id", "b")),
    ]);
    expect(responses.map((response) => response.reservations[0].count)).toEqual([4, 3]);
    expect(f.view()).toMatchObject({ managerReservedCount: 4, additionalDevCapacity: 0 });
    expect(f.view("b")).toMatchObject({ managerReservedCount: 3, additionalDevCapacity: 0 });
  });

  it("keeps retries idempotent, including zero grants, and rejects count changes", () => {
    const f = fixture();
    const granted = f.reserve(4, "original");
    expect(f.reserve(4, "original")).toEqual(granted);
    expect(() => f.reserve(3, "original")).toThrow(/different count/);
    f.reserve(3, "remaining", "b");
    expect(f.reserve(2, "denied").reservations.find((entry) => entry.requestId === "denied"))
      .toMatchObject({ count: 0, valid: false });
    f.capacity.channel("b", { action: "release", reservationId: "lease-2" });
    expect(f.reserve(2, "denied")).toMatchObject({ additionalDevCapacity: 3, managerReservedCount: 4 });
    expect(f.reserve(2, "denied").reservations.find((entry) => entry.requestId === "denied")?.count).toBe(0);
    f.capacity.channel("a", { action: "release", reservationId: "lease-1" });
    expect(f.reserve(4, "original").reservations.find((entry) => entry.id === "lease-1"))
      .toMatchObject({ count: 4, valid: false });
    expect(f.view().managerReservedCount).toBe(0);
  });

  it("holds reported launches until both a newer resource sample and complete directory account for them", () => {
    const f = fixture();
    const lease = f.reserve(2).reservations[0];
    f.clock(start + 1_000);
    f.fresh({ targets: [manager("a", [dev("new-1"), dev("new-2")]), manager("b")] });
    const report = () => f.capacity.channel("a", { action: "report", reservationId: lease.id, agentIds: ["new-1", "new-2"] });
    expect(report()).toMatchObject({ activeDevCount: 2, managerReservedCount: 2, additionalDevCapacity: 5 });
    f.clock(start + 2_000);
    f.update({ observedAt: start + 2_000 });
    expect(f.view().managerReservedCount).toBe(2);
    f.update({ observedAt: start + 1_000, status: { ...status(start + 2_000) } });
    expect(f.view().managerReservedCount).toBe(2);
    // A retry is an acknowledgement, not a new launch/report timestamp.
    expect(report().managerReservedCount).toBe(2);
    f.fresh({ status: { ...status(start + 2_000), snapshot: { ...status(start + 2_000).snapshot!, cpuUsedRatio: 0.4 } } });
    expect(f.view()).toMatchObject({ activeDevCount: 2, managerReservedCount: 0, additionalDevCapacity: 5 });
    expect(f.view().reservations[0]).toMatchObject({ count: 2, agentIds: ["new-1", "new-2"], valid: false });
  });

  it("releases only unused slots; reporting or releasing cannot immediately free a live launch hold", () => {
    const f = fixture();
    f.reserve(3);
    f.clock(start + 1_000);
    f.fresh({ targets: [manager("a", [dev("new")]), manager("b")] });
    f.capacity.channel("a", { action: "report", reservationId: "lease-1", agentIds: ["new"] });
    expect(f.capacity.channel("a", { action: "release", reservationId: "lease-1" }))
      .toMatchObject({ managerReservedCount: 1, additionalDevCapacity: 6 });
    expect(f.capacity.channel("a", { action: "release", reservationId: "lease-1" }).managerReservedCount).toBe(1);
    expect(f.capacity.channel("a", { action: "report", reservationId: "lease-1", agentIds: ["new"] }).managerReservedCount).toBe(1);
    f.clock(start + 2_000);
    // The complete observation also accounts for a worker already folded since its report.
    f.fresh({ targets: [manager("a"), manager("b")] });
    expect(f.view()).toMatchObject({ activeDevCount: 0, managerReservedCount: 0, additionalDevCapacity: 7 });
  });

  it("validates reservation ownership and exact native dev IDs without trusting self-reported counts", () => {
    const f = fixture();
    f.reserve(2);
    f.update({ targets: [manager("a", [dev("mine"), dev("second"), dev("third")]), manager("b", [dev("foreign")])] });
    expect(() => f.capacity.channel("b", { action: "release", reservationId: "lease-1" })).toThrow(/belong/);
    const report = (agentIds: string[]) => f.capacity.channel("a", { action: "report", reservationId: "lease-1", agentIds });
    expect(() => report(["foreign"])).toThrow(/native directory/);
    expect(() => report(["made-up"])).toThrow(/native directory/);
    expect(() => report(["mine", "mine"])).toThrow(/unique/);
    expect(() => report(["mine", "second", "third"])).toThrow(/exceed/);
    expect(() => report([])).toThrow(/nonempty/);
    expect(f.view().managerReservedCount).toBe(2);
    expect(f.view().reservations[0].agentIds).toEqual([]);
    expect(report(["mine"]).reservations[0].agentIds).toEqual(["mine"]);
    expect(report(["second"]).reservations[0].agentIds).toEqual(["mine", "second"]);
  });

  it("revokes expired launch permission before recycling its accounting hold and never renews a retry", () => {
    const f = fixture();
    f.update({ settings: resourceManagerSettings.parse({ reservationSeconds: 30 }) });
    f.reserve(2, "lease-request");
    f.clock(start + 30_000);
    expect(f.view()).toMatchObject({ available: true, managerReservedCount: 2, additionalDevCapacity: 5 });
    expect(f.view().reservations[0].valid).toBe(false);
    f.fresh();
    expect(f.view()).toMatchObject({ managerReservedCount: 0, additionalDevCapacity: 7, reservations: [] });
    expect(f.reserve(2, "lease-request")).toMatchObject({ managerReservedCount: 0,
      reservations: [{ id: "lease-1", count: 2, expiresAt: start + 30_000, valid: false }] });
  });

  it("expires disconnected-manager holds using a complete fresh host observation", () => {
    const f = fixture();
    f.update({ settings: resourceManagerSettings.parse({ reservationSeconds: 30 }) });
    f.reserve(7);
    f.clock(start + 1_000);
    f.fresh({ targets: [manager("b")] });
    expect(() => f.view("a")).toThrow(/not in/);
    expect(f.view("b").additionalDevCapacity).toBe(0);
    f.clock(start + 30_000);
    f.fresh();
    expect(f.view("b")).toMatchObject({ managerReservedCount: 0, additionalDevCapacity: 7 });
  });

  it.each(["starting", "awaiting_runtime", "disabled", "error", "stopped"] as const)("does not grant capacity while monitor state is %s", (state) => {
    const f = fixture();
    f.update({ status: { ...status(start), state } });
    expect(f.view()).toMatchObject({ available: false, additionalDevCapacity: 0 });
    expect(f.reserve(10).reservations[0]).toMatchObject({ count: 0, valid: false });
  });

  it("treats disabled, invalidated, incomplete and missing observations as unavailable", () => {
    const f = fixture();
    f.reserve(2);
    f.capacity.invalidate();
    expect(f.view()).toMatchObject({ available: false, additionalDevCapacity: 0, managerReservedCount: 2 });
    expect(f.view().reservations[0].valid).toBe(false);
    f.fresh();
    expect(f.view().reservations[0].valid).toBe(true);
    f.update({ complete: false });
    expect(f.view().available).toBe(false);
    f.update({ complete: true, status: { ...status(start), snapshot: null } });
    expect(f.view().available).toBe(false);
    f.update({ status: { ...status(start), enabled: false } });
    expect(f.view().available).toBe(false);
    f.update({ status: status(start), settings: resourceManagerSettings.parse({ enabled: false }) });
    expect(f.view().available).toBe(false);
    expect(() => f.view("unowned")).toThrow(/not in/);
  });

  it("requires fresh timestamps for both sampling and directory, scaled to sample cadence", () => {
    const f = fixture();
    f.clock(start + 60_000);
    expect(f.view()).toMatchObject({ available: false, expiresAt: start + 60_000, additionalDevCapacity: 0 });
    f.update({ observedAt: start + 60_000 });
    expect(f.view().available).toBe(false);
    f.update({ observedAt: start, status: status(start + 60_000) });
    expect(f.view().available).toBe(false);
    f.fresh();
    expect(f.view().available).toBe(true);
    f.update({ settings: resourceManagerSettings.parse({ sampleIntervalSeconds: 300 }) });
    f.clock(start + 899_999);
    expect(f.view().available).toBe(true);
    f.clock(start + 960_000);
    expect(f.view().available).toBe(false);
    f.update({ observedAt: start + 960_001, status: status(start + 960_000) });
    expect(f.view().available).toBe(false);
  });

  it.each(["totalMemoryBytes", "availableMemoryBytes", "memoryUsedRatio", "cpuUsedRatio"] as const)("holds dispatch for unknown %s while keeping the manager channel available", (metric) => {
    const f = fixture();
    f.update({ status: { ...status(start), snapshot: { ...status(start).snapshot!, [metric]: null } } });
    expect(f.view()).toMatchObject({ available: true, additionalDevCapacity: 0 });
    expect(f.view().holdReason).toMatch(/unavailable/);
    expect(f.reserve(5).reservations[0]).toMatchObject({ count: 0, valid: false });
  });

  it.each(["warning", "critical"] as const)("retains reservations but revokes permission under %s pressure", (pressure) => {
    const f = fixture();
    f.reserve(2);
    f.update({ status: { ...status(start), pressure } });
    expect(f.view()).toMatchObject({ available: true, pressure, additionalDevCapacity: 0, managerReservedCount: 2 });
    expect(f.view().reservations[0].valid).toBe(false);
    f.update({ status: status(start) });
    expect(f.view().reservations[0].valid).toBe(true);
  });

  it.each([{ memoryUsedRatio: 0.85 }, { cpuUsedRatio: 0.9 }])("holds immediately on measured threshold crossing before debounce: %j", (measurement) => {
    const f = fixture();
    f.reserve(2);
    f.update({ status: { ...status(start), snapshot: { ...status(start).snapshot!, ...measurement } } });
    expect(f.view()).toMatchObject({ available: true, pressure: "normal", additionalDevCapacity: 0 });
    expect(f.view().holdReason).toMatch(/warning threshold/);
    expect(f.view().reservations[0].valid).toBe(false);
  });

  it("revokes retained grant validity when measured remaining headroom falls below all outstanding holds", () => {
    const f = fixture();
    f.reserve(4);
    f.reserve(3, "other-manager", "b");
    f.update({ status: { ...status(start), snapshot: { ...status(start).snapshot!, cpuUsedRatio: 0.5 } } });
    expect(f.view()).toMatchObject({ available: true, managerReservedCount: 4, additionalDevCapacity: 0 });
    expect(f.view().reservations[0].valid).toBe(false);
    expect(f.view("b").reservations[0].valid).toBe(false);
  });

  it("rejects malformed requests and unavailable native reports without mutating grants", () => {
    const f = fixture();
    expect(() => f.reserve(0)).toThrow(/positive safe integer/);
    expect(() => f.reserve(1.5)).toThrow(/positive safe integer/);
    expect(() => f.reserve(1, " ")).toThrow(/nonempty/);
    expect(() => f.reserve(1, "a".repeat(129))).toThrow(/128/);
    f.reserve(1);
    f.capacity.invalidate();
    expect(() => f.capacity.channel("a", { action: "report", reservationId: "lease-1", agentIds: ["new"] })).toThrow(/Fresh native/);
    expect(f.view().managerReservedCount).toBe(1);
  });
});
