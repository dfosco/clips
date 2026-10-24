import type { PaseoApi } from "@getpaseo/client";
import { describe, expect, it, vi } from "vitest";
import { createResourceFolding } from "./resource-folding";
import type { ResourceCandidate, ResourceTarget } from "./resource-targets";

const handoffId = "6e615151-2a84-4f2d-8101-63a967178c35";
const lane = { projectId: "p1", projectLabel: "Project", laneRef: "#l001", laneTitle: "Delivery" };
const labels = { "lanes.kind": "task", "lanes.ref": "#alex#g001#t01", "lanes.projectId": "p1" };
function fixture() {
  const candidate: ResourceCandidate = { ...lane, projectRoot: "/repo", goalRef: "#alex#g001", labels,
    agentId: "dev", workspaceId: "wd", ref: "#alex#g001#t01", status: "idle", disposition: "idle", updatedAt: null, needsInput: false };
  const target: ResourceTarget = { managerId: "manager", managerWorkspaceId: "wm", managerLabels: {}, lanes: [lane], candidates: [candidate] };
  const order: string[] = [];
  let closed = false;
  const developer = { id: "dev", workspaceId: "wd", status: "idle", labels, activeTurn: null as null | { turnId: string; startedAt: string | null },
    pendingPermissions: [], archivedAt: null, lastUserMessageAt: "2026-10-24T11:00:00Z", updatedAt: "2026-10-24T11:05:00Z" };
  const manager = { id: "manager", workspaceId: "wm", status: "running", labels: {}, archivedAt: null };
  const refresh = vi.fn(async () => ({ agent: closed ? { ...developer, status: "closed", archivedAt: "2026-10-24T12:00:00Z" } : developer }));
  const archive = vi.fn(async () => { order.push("close"); closed = true; });
  const api = { agents: { ref: (id: string) => id === "manager" ? { refresh: async () => ({ agent: manager }) } : { refresh, archive } } } as unknown as PaseoApi;
  const persist = vi.fn(async (_api: PaseoApi, entry: ResourceCandidate, data: any) => {
    order.push("attach");
    return { success: true as const, handoff_id: data.handoff_id, source_ref: entry.ref, goal_ref: entry.goalRef,
      context: data.context, incomplete: data.incomplete,
      attachment: { id: `att-${data.handoff_id}`, type: "markdown" as const, path: ".lanes/records/handoffs/context.md", title: "Developer handoff" } };
  });
  const critical = vi.fn(() => false);
  const service = createResourceFolding({ target: async () => target, critical, persist, now: () => 1000 });
  const handoff = () => service.handoff(api, { managerId: "manager", agentId: "dev", handoffId,
    context: "Latest branch/commit, edits, checks, decisions and remaining work.", reason: "completed" });
  const fold = (id: string | undefined = handoffId) => service.fold(api, { managerId: "manager", agentId: "dev", ...(id ? { handoffId: id } : {}) });
  return { service, api, developer, manager, candidate, target, persist, critical, archive, refresh, order, handoff, fold };
}

describe("developer folding", () => {
  it("attaches exact Goal/Task context and delivers a manager inbox before acknowledged shutdown", async () => {
    const f = fixture();
    const receipt = await f.handoff();
    expect(receipt).toMatchObject({ handoffId, goalRef: "#alex#g001", sourceRef: "#alex#g001#t01", incomplete: false });
    expect(f.service.pending("manager")).toEqual([receipt]);
    expect(f.service.pending("another")).toEqual([]);
    expect(f.archive).not.toHaveBeenCalled();
    expect(await f.fold()).toMatchObject({ closed: true, critical: false, handoff: receipt, error: null });
    expect(f.order).toEqual(["attach", "close"]);
  });

  it("requires a complete acknowledged handoff for ordinary resource or completion folds", async () => {
    const f = fixture();
    await expect(f.fold()).rejects.toThrow("acknowledge");
    await f.handoff();
    await expect(f.fold("f8b9cbe1-c49a-4d08-b613-5d45381c7498")).rejects.toThrow("acknowledge");
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("rejects an older receipt once the developer has delivered newer context", async () => {
    const f = fixture(); await f.handoff();
    const newer = await f.service.handoff(f.api, { managerId: "manager", agentId: "dev", context: "Newer changes and checks.", reason: "completed" });
    await f.handoff(); // retrying the older ID must not promote it to latest
    await expect(f.fold()).rejects.toThrow("latest");
    expect(await f.fold(newer.handoffId)).toMatchObject({ closed: true, handoff: { context: "Newer changes and checks." } });
  });

  it("canonicalizes valid UUID case consistently with the core handoff command", async () => {
    const f = fixture();
    const receipt = await f.service.handoff(f.api, { managerId: "manager", agentId: "dev", handoffId: handoffId.toUpperCase(), context: "Current context", reason: "completed" });
    expect(receipt.handoffId).toBe(handoffId);
    expect(await f.fold(handoffId.toUpperCase())).toMatchObject({ closed: true });
  });

  it("rejects stale context after a new turn or an idle developer's activity changes", async () => {
    const f = fixture(); await f.handoff();
    f.developer.updatedAt = "2026-10-24T11:10:00Z";
    await expect(f.fold()).rejects.toThrow("activity advanced");
    expect(f.archive).not.toHaveBeenCalled();
    f.developer.updatedAt = "2026-10-24T11:05:00Z";
    f.service.turnStarted("dev");
    await expect(f.fold()).rejects.toThrow("activity advanced");
  });

  it("allows the handoff's own turn to finish, but invalidates context if a later turn starts", async () => {
    const f = fixture(); f.developer.status = "running";
    f.developer.activeTurn = { turnId: "handoff-turn", startedAt: null };
    await f.handoff();
    f.developer.activeTurn = null; f.developer.status = "idle";
    f.developer.updatedAt = "2026-10-24T11:10:00Z";
    expect(await f.fold()).toMatchObject({ closed: true });
    const second = fixture(); second.developer.activeTurn = { turnId: "first", startedAt: null };
    await second.handoff(); second.developer.activeTurn = null;
    second.service.turnStarted("dev");
    await expect(second.fold()).rejects.toThrow("activity advanced");
  });

  it("rejects a receipt from a different project/workspace with identical textual Goal refs", async () => {
    const f = fixture(); await f.handoff();
    f.candidate.projectRoot = "/another-repo";
    await expect(f.fold()).rejects.toThrow("assignment");
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("does not close normally while newer context is still being attached, but critical closure bypasses it", async () => {
    const f = fixture(); await f.handoff();
    const save = f.persist.getMockImplementation()!;
    let release!: () => void;
    f.persist.mockImplementationOnce(async (...args) => { await new Promise<void>((done) => { release = done; }); return save(...args); });
    const pending = f.service.handoff(f.api, { managerId: "manager", agentId: "dev", context: "New context", reason: "completed" });
    await vi.waitFor(() => expect(f.persist).toHaveBeenCalledTimes(2));
    await expect(f.fold()).rejects.toThrow("write in progress");
    expect(f.archive).not.toHaveBeenCalled();
    f.critical.mockReturnValue(true);
    expect(await f.fold()).toMatchObject({ closed: true, critical: true });
    release(); await pending;
  });

  it("does not fold normally if Goal persistence fails", async () => {
    const f = fixture(); f.persist.mockRejectedValue(new Error("disk full"));
    await expect(f.handoff()).rejects.toThrow("disk full");
    await expect(f.fold()).rejects.toThrow("acknowledge");
    expect(f.service.pending("manager")).toEqual([]);
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("waits for a current dev's safe checkpoint in normal pressure", async () => {
    const f = fixture(); await f.handoff();
    f.developer.status = "running";
    await expect(f.fold()).rejects.toThrow("checkpoint");
    f.developer.status = "idle";
    (f.developer.pendingPermissions as unknown[]).push({ requestId: "permission" });
    await expect(f.fold()).rejects.toThrow("checkpoint");
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("closes a running dev under critical pressure before any context write or acknowledgement", async () => {
    const f = fixture(); f.critical.mockReturnValue(true); f.developer.status = "running";
    const result = await f.fold(undefined);
    expect(result).toMatchObject({ closed: true, critical: true, handoff: { incomplete: true, goalRef: "#alex#g001" } });
    expect(result.handoff!.context).toContain("without waiting");
    expect(f.order).toEqual(["close", "attach"]);
    expect(f.persist.mock.calls[0][2]).toMatchObject({ reason: "resource_critical", incomplete: true });
  });

  it("does not let a slow emergency attachment delay native shutdown", async () => {
    const f = fixture(); f.critical.mockReturnValue(true);
    const save = f.persist.getMockImplementation()!;
    let resolve!: () => void;
    f.persist.mockImplementation(async (...args) => { await new Promise<void>((done) => { resolve = done; }); return save(...args); });
    const pending = f.fold(undefined);
    await vi.waitFor(() => expect(f.archive).toHaveBeenCalledOnce());
    expect(f.service.pending("manager")).toEqual([]);
    resolve();
    expect(await pending).toMatchObject({ closed: true, handoff: { incomplete: true } });
  });

  it("retains the last known context in an explicitly incomplete critical handoff", async () => {
    const f = fixture(); await f.handoff(); f.critical.mockReturnValue(true);
    const result = await f.fold();
    expect(result.handoff!.context).toContain("Last available checkpoint (not confirmed current)");
    expect(result.handoff!.context).toContain("Latest branch/commit");
    expect(result.handoff!.incomplete).toBe(true);
    expect(f.order).toEqual(["attach", "close", "attach"]);
  });

  it("reports a failed emergency attachment without undoing or hiding native closure", async () => {
    const f = fixture(); f.critical.mockReturnValue(true); f.persist.mockRejectedValue(new Error("disk full"));
    expect(await f.fold(undefined)).toMatchObject({ closed: true, handoff: null, error: expect.stringContaining("still needs a Goal attachment") });
    expect(f.archive).toHaveBeenCalledOnce();
  });

  it("protects managers, unrelated devs and changed native identities", async () => {
    const f = fixture();
    await expect(f.service.fold(f.api, { managerId: "manager", agentId: "manager" })).rejects.toThrow("own developer");
    await expect(f.service.fold(f.api, { managerId: "manager", agentId: "unrelated" })).rejects.toThrow("not attributed");
    await f.handoff(); f.developer.labels = { ...labels, "lanes.ref": "#g999" };
    await expect(f.fold()).rejects.toThrow("identity changed");
    expect(f.archive).not.toHaveBeenCalled();
  });

  it("never confirms a fold on an archive error or a still-live native readback", async () => {
    const f = fixture(); await f.handoff();
    f.archive.mockRejectedValueOnce(new Error("provider exit timeout"));
    expect(await f.fold()).toMatchObject({ closed: false, error: expect.stringContaining("exit timeout") });
    f.archive.mockImplementationOnce(async () => {});
    expect(await f.fold()).toMatchObject({ closed: false, error: expect.stringContaining("not been confirmed") });
  });

  it("retains emergency context if archive reports an error after the runtime actually closed", async () => {
    const f = fixture(); f.critical.mockReturnValue(true);
    const close = f.archive.getMockImplementation()!;
    f.archive.mockImplementationOnce(async () => { await close(); throw new Error("archive synchronization failed"); });
    expect(await f.fold(undefined)).toMatchObject({ closed: true, critical: true,
      handoff: { incomplete: true }, error: expect.stringContaining("synchronization failed") });
    expect(f.order).toEqual(["close", "attach"]);
  });

  it("can retry shutdown for an archived developer whose native runtime is still live", async () => {
    const f = fixture(); f.critical.mockReturnValue(true);
    Object.assign(f.developer, { archivedAt: "2026-10-24T11:55:00Z", status: "running" });
    expect(await f.fold(undefined)).toMatchObject({ closed: true, critical: true });
    expect(f.archive).toHaveBeenCalledOnce();
  });

  it("serializes duplicate folds and stops mutations after disposal", async () => {
    const f = fixture(); await f.handoff();
    let release!: () => void;
    f.archive.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const pending = f.fold();
    await vi.waitFor(() => expect(f.archive).toHaveBeenCalledOnce());
    await expect(f.fold()).rejects.toThrow("in progress");
    release(); await pending;
    f.service.dispose();
    await expect(f.handoff()).rejects.toThrow("stopped");
    expect(f.archive).toHaveBeenCalledOnce();
  });
});
