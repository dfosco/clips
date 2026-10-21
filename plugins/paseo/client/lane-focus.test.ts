import { describe, expect, it, vi } from "vitest";
import type { Goal, Lane, Task } from "../shared/contracts";
import { branchName, type AgentInfo, type Execution, type WorkspaceInfo } from "../shared/work";
import { focusScope, focusedLane, goalGroup, openLanePanel, revealStartedWorkspace, workspaceLane } from "./lane-focus";
import { getFocusIntent, getWorkspaceFocusIntent, projectAfterFocusIntent, requestLaneFocus, subscribeFocusIntent } from "./focus-intent";

const base = { description: "", status: "open", scope: "", plan: "", decisions: "", acceptanceCriteria: [] };
const task = (ref: string, title: string, status = "open"): Task => ({ ...base, kind: "task", ref, title, status });
const goal = (ref: string, title: string, tasks: Task[] = [], status = "open"): Goal =>
  ({ ...base, kind: "goal", ref, title, tasks, status, type: "building", laneId: "l001" });
const lane: Lane = { ...base, kind: "lane", ref: "#l001", title: "Publishing", goalRefs: ["#g001", "#g002"], productGoals: [] };
const workspace: WorkspaceInfo = { id: "w1", projectId: "p1", name: "Changed name", branch: branchName(lane), status: "ready" };
const agent = (ref: string, projectId = "p1"): AgentInfo => ({
  id: ref, workspaceId: "w1", title: null, status: "idle", requiresAttention: false, attentionReason: null,
  labels: { "clips.ref": ref, "clips.projectId": projectId },
});
const execution = (running: string[] = []) => (work: { ref: string }): Execution => ({
  status: running.includes(work.ref) ? "running" : "none", runningAgents: running.includes(work.ref) ? 1 : 0,
  workspaceId: null, workspaceCount: 0, agents: [],
});

describe("lane focus context", () => {
  it("recovers lane identity across title changes and linked project IDs", () => {
    expect(workspaceLane([lane], ["root", "p1"], "w1", [workspace], [])).toBe(lane);
    expect(workspaceLane([lane], ["root"], "w1", [workspace], [])).toBeUndefined();
    expect(workspaceLane([lane], ["p1"], "missing", [workspace], [])).toBeUndefined();
    expect(workspaceLane([], ["p1"], "w1", [workspace], [])).toBeUndefined();
  });

  it("uses only unambiguous lane labels in the selected project and workspace", () => {
    const other: Lane = { ...lane, ref: "#l002" };
    const renamed = { ...workspace, branch: "main" };
    expect(workspaceLane([lane], ["p1"], "w1", [renamed], [agent(lane.ref)])).toBe(lane);
    expect(workspaceLane([lane], ["p1"], "w1", [renamed], [agent(lane.ref, "other-project")])).toBeUndefined();
    expect(workspaceLane([lane], ["p1"], "w1", [renamed], [{ ...agent(lane.ref), workspaceId: "w2" }])).toBeUndefined();
    expect(workspaceLane([lane], ["p1"], "w1", [renamed], [agent("#g001#t01")])).toBeUndefined();
    expect(workspaceLane([lane, other], ["p1"], "w1", [renamed], [agent(lane.ref), agent(other.ref)])).toBeUndefined();
    expect(workspaceLane([lane, other], ["p1"], "w1", [workspace], [agent(other.ref)])).toBe(lane);
  });

  it("keeps Back explicit through refresh and isolates manual selection across contexts", () => {
    const scope = focusScope("host", "p1", "w1");
    const chosen = { scope, laneRef: lane.ref };
    expect(focusedLane([lane], scope, chosen)).toBe(lane);
    expect(focusedLane([lane], scope, { scope, laneRef: null }, { ...lane })).toBeUndefined();
    for (const otherScope of [focusScope("other", "p1", "w1"), focusScope("host", "p2", "w1"), focusScope("host", "p1", "w2")]) {
      expect(focusedLane([lane], otherScope, chosen)).toBeUndefined();
    }
    expect(focusedLane([], scope, chosen, lane)).toBeUndefined();
    expect(focusedLane([lane], scope, null, lane)).toBe(lane);
  });

  it("refocuses an existing panel after Back only on an explicit scoped intent", () => {
    const scope = focusScope("intent-host", "p1", "w1");
    const listener = vi.fn();
    const unsubscribe = subscribeFocusIntent(listener);
    requestLaneFocus(scope, lane.ref);
    const first = getFocusIntent(scope)!;
    const back = { scope, laneRef: null, intentVersion: first.version };
    expect(focusedLane([lane], scope, back, lane, first)).toBeUndefined();
    // The same snapshot represents a runtime refresh, not a navigation request.
    expect(focusedLane([lane], scope, back, { ...lane }, getFocusIntent(scope))).toBeUndefined();
    requestLaneFocus(focusScope("other-host", "p1", "w1"), lane.ref);
    expect(focusedLane([lane], scope, back, lane, getFocusIntent(scope))).toBeUndefined();
    requestLaneFocus(scope, lane.ref);
    expect(focusedLane([lane], scope, back, lane, getFocusIntent(scope))).toBe(lane);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
  });

  it("returns the target panel to the launch project while isolating other hosts/workspaces", () => {
    const scope = focusScope("project-switch-host", "launch-project", "target-panel");
    requestLaneFocus(scope, lane.ref, { hostId: "project-switch-host", projectId: "launch-project", workspaceId: "target-panel" });
    const intent = getWorkspaceFocusIntent("project-switch-host", "target-panel")!;
    expect(projectAfterFocusIntent("browsed-project", 0, intent)).toBe("launch-project");
    expect(focusedLane([lane], scope, null, undefined, getFocusIntent(scope))).toBe(lane);
    // Once consumed, a user can browse other projects without a refresh pulling them back.
    expect(projectAfterFocusIntent("browsed-again", intent.version, intent)).toBe("browsed-again");
    expect(getWorkspaceFocusIntent("other-host", "target-panel")).toBeUndefined();
    expect(getWorkspaceFocusIntent("project-switch-host", "other-panel")).toBeUndefined();
  });
});

describe("focused lane filters", () => {
  const open = goal("#g001", "Ship SDK", [task("#g001#t01", "Publish npm"), task("#g001#t02", "Old task", "closed")]);
  const closed = goal("#g002", "Archive release", [task("#g002#t01", "Archived API", "closed")], "closed");

  it("hides closed Goals and Tasks by default and can reveal them", () => {
    const result = goalGroup(lane, [open, closed], "open", "", false, execution());
    expect(result.entries.map((entry) => entry.goal.ref)).toEqual([open.ref]);
    expect(result.entries[0].tasks.map((entry) => entry.ref)).toEqual(["#g001#t01"]);
    expect(result.canRevealClosed).toBe(true);
    expect(goalGroup(lane, [closed], "open", "", false, execution()).entries).toEqual([]);
    expect(goalGroup(lane, [closed], "open", "", false, execution()).canRevealClosed).toBe(true);
    expect(goalGroup(lane, [open, closed], "open", "", true, execution()).entries).toHaveLength(2);
    expect(goalGroup(lane, [open, closed], "all", "", true, execution()).entries[1].tasks).toHaveLength(1);
    expect(goalGroup(lane, [], "open", "", false, execution()).canRevealClosed).toBe(false);
  });

  it("finds a Task through its Goal and offers hidden closed matches", () => {
    const result = goalGroup(lane, [open, closed], "open", "publish npm", false, execution());
    expect(result.entries.map((entry) => entry.goal)).toEqual([open]);
    expect(result.entries[0].tasks.map((entry) => entry.title)).toEqual(["Publish npm"]);
    expect(goalGroup(lane, [closed], "open", "archived api", false, execution()).canRevealClosed).toBe(true);
    expect(goalGroup(lane, [open, closed], "open", "missing", false, execution()).entries).toEqual([]);
    expect(goalGroup(lane, [open, closed], "open", "publishing", false, execution()).entries).toHaveLength(1);
  });

  it("keeps running Task ancestors while excluding idle Goals", () => {
    const result = goalGroup(lane, [open, closed], "running", "", true, execution(["#g001#t01"]));
    expect(result.entries.map((entry) => entry.goal.ref)).toEqual([open.ref]);
    expect(result.entries[0].tasks.map((entry) => entry.ref)).toEqual(["#g001#t01"]);
  });
});

describe("opening lane workspace panels", () => {
  it("opens only lane panels and handles a panel failure as a separate result", async () => {
    const open = vi.fn();
    expect(await openLanePanel(lane, "w1", open)).toBeNull();
    expect(open).toHaveBeenCalledWith("w1");
    open.mockClear();
    expect(await openLanePanel(undefined, "w1", open)).toBeNull();
    expect(open).not.toHaveBeenCalled();
    const error = await openLanePanel(lane, "w1", () => { throw new Error("offline"); });
    expect(error).toBe("Workspace is ready, but the Lanes panel could not open: offline");
  });

  it("refreshes before navigating, publishing focus, and opening the returned workspace panel", async () => {
    const order: string[] = [];
    let finishRefresh!: () => void;
    const done = revealStartedWorkspace({
      workspaceId: "returned-workspace", agentId: "agent", lane,
      refresh: () => new Promise<void>((resolve) => { finishRefresh = resolve; order.push("refresh"); }),
      openWorkspace: (id) => order.push(`workspace:${id}`),
      openAgent: (id) => order.push(`agent:${id}`),
      requestFocus: (target, id) => order.push(`focus:${target.ref}:${id}`),
      openPanel: (id) => { order.push(`panel:${id}`); },
    });
    expect(order).toEqual(["refresh"]);
    finishRefresh();
    expect(await done).toEqual([]);
    expect(order).toEqual(["refresh", "workspace:returned-workspace", "agent:agent", "focus:#l001:returned-workspace", "panel:returned-workspace"]);
  });

  it("still opens the panel when navigation fails and reports UI errors separately", async () => {
    const focus = vi.fn();
    const openPanel = vi.fn(() => { throw new Error("panel failed"); });
    const errors = await revealStartedWorkspace({
      workspaceId: "w1", lane, refresh: async () => { throw new Error("refresh failed"); },
      openWorkspace: () => { throw new Error("navigation failed"); }, requestFocus: focus, openPanel,
    });
    expect(focus).toHaveBeenCalledWith(lane, "w1");
    expect(openPanel).toHaveBeenCalledWith("w1");
    expect(errors).toHaveLength(3);
    expect(errors.every((error) => error.startsWith("Workspace is ready, but"))).toBe(true);
  });
});
