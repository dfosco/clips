
import { describe, expect, it } from "vitest";
import { branchName, branchPrefix, defaultProvider, executionFor, executionForManagers, matchesWorkspace, promptFor, type AgentInfo, type WorkspaceInfo } from "./work";

const task = { kind: "task" as const, ref: "#alice#g001#t01", title: "Write tests" };
const projectIds = ["parent", "linked"];

function workspace(branch = branchName(task), id = "workspace-1"): WorkspaceInfo {
  return { id, projectId: "linked", name: "Renamed manually", branch, status: "running" };
}
function agent(status: string, requiresAttention = false, attentionReason: AgentInfo["attentionReason"] = null): AgentInfo {
  return { id: "a1", workspaceId: "workspace-1", status, requiresAttention, attentionReason, labels: {}, title: null };
}

describe("Paseo work mapping", () => {
  it("uses title-independent branches and namespace-safe refs", () => {
    expect(branchName(task).startsWith(branchPrefix(task))).toBe(true);
    expect(branchPrefix({ ...task, title: "new title" })).toBe(branchPrefix(task));
    expect(branchPrefix({ ...task, ref: "#bob#g001#t01" })).not.toBe(branchPrefix(task));
    expect(branchPrefix({ ...task, kind: "goal" })).not.toBe(branchPrefix(task));
  });

  it("matches linked-worktree project IDs and branch-renamed workspace titles", () => {
    expect(matchesWorkspace(workspace(), task, projectIds)).toBe(true);
    expect(matchesWorkspace({ ...workspace(), projectId: "unrelated" }, task, projectIds)).toBe(false);
    expect(matchesWorkspace(workspace("clips/task/elsewhere"), task, projectIds)).toBe(false);
  });

  it("only counts an actively executing agent as running", () => {
    expect(executionFor(task, projectIds, [workspace()], [agent("running")])).toMatchObject({ status: "running", runningAgents: 1 });
    expect(executionFor(task, projectIds, [workspace()], [agent("initializing")])).toMatchObject({ status: "running", runningAgents: 1 });
    expect(executionFor(task, projectIds, [workspace()], [agent("idle")])).toMatchObject({ status: "idle", runningAgents: 0 });
    expect(executionFor(task, projectIds, [workspace()], [agent("idle", true, "permission")])).toMatchObject({ status: "attention" });
    expect(executionFor(task, projectIds, [workspace()], [agent("running", true, "permission")])).toMatchObject({ status: "attention", runningAgents: 0 });
    expect(executionFor(task, projectIds, [workspace()], [agent("idle", true, "finished")])).toMatchObject({ status: "idle" });
    expect(executionFor(task, projectIds, [{ ...workspace(), status: "attention" }], [agent("idle", true, "finished")])).toMatchObject({ status: "idle" });
    expect(executionFor(task, projectIds, [workspace()], [agent("error", true, "error")])).toMatchObject({ status: "error" });
    expect(executionFor(task, projectIds, [workspace()], [agent("error")])).toMatchObject({ status: "error" });
    expect(executionFor(task, projectIds, [], [])).toMatchObject({ status: "none" });
  });

  it("recovers a retitled/rebranched workspace through agent labels", () => {
    const changed = workspace("different-branch");
    const labeled = { ...agent("running"), labels: { "clips.ref": task.ref, "clips.projectId": "parent" } };
    expect(executionFor(task, projectIds, [changed], [labeled])).toMatchObject({
      status: "running", workspaceId: changed.id,
    });
  });

  it("does not adopt siblings in a shared workspace or override explicit labels", () => {
    const labeled = { ...agent("running"), labels: { "clips.ref": task.ref, "clips.projectId": "parent" } };
    const unrelated = { ...agent("running"), id: "other", labels: { "clips.ref": "#other", "clips.projectId": "parent" } };
    const legacy = { ...agent("running"), id: "legacy" };
    expect(executionFor(task, projectIds, [workspace("main")], [labeled, unrelated, legacy]).agents).toEqual([labeled]);
    expect(executionFor(task, projectIds, [workspace()], [unrelated]).agents).toEqual([]);
    expect(executionFor(task, projectIds, [{ ...workspace(), status: "needs_input" }], [unrelated]).status).toBe("idle");
    expect(executionFor(task, projectIds, [workspace()], [{ ...labeled, labels: { ...labeled.labels, "clips.kind": "lane-closure-autofill" } }]).agents).toEqual([]);
    expect(executionFor(task, projectIds, [workspace()], [agent("running"), legacy]).agents).toEqual([]);
    expect(executionFor(task, projectIds, [workspace()], [{ ...labeled, labels: { ...labeled.labels, "clips.projectId": "foreign" } }]).agents).toEqual([]);
  });

  it("keeps multiple active targets and pending-input sessions across project workspaces", () => {
    const first = { ...agent("running"), labels: { "clips.ref": task.ref, "clips.projectId": "parent" } };
    const second = { ...first, id: "a2", workspaceId: "workspace-2", status: "attention" };
    const result = executionFor(task, projectIds, [workspace("main"), workspace("main", "workspace-2")], [first, second]);
    expect(result.agents).toEqual([first, second]);
    expect(result.workspaceCount).toBe(2);
    expect(executionFor(task, projectIds, [workspace("main", "workspace-2")], [second]).status).toBe("attention");
  });

  it("maps claimed managers independently of workers, host aliases and stopped execution", () => {
    const owners = [{ host: "host", runtime: "paseo", session_id: "manager" }];
    const manager = { ...agent("idle"), id: "manager" };
    const worker = { ...agent("running"), id: "worker" };
    const result = executionForManagers(owners, "host", [workspace()], [manager, worker]);
    expect(result).toMatchObject({ status: "idle", runningAgents: 0, agents: [manager] });
    expect(executionForManagers(owners, "host", [{ ...workspace(), status: "needs_input" }], [manager, worker]).status).toBe("idle");
    expect(executionForManagers(owners, "different-host", [workspace()], [manager, worker]).agents).toEqual([]);
    expect(executionForManagers(owners, "host", [workspace()], [worker]).agents).toEqual([]);
    const shared = [...owners, { host: "host", runtime: "paseo", session_id: "second-manager" }];
    expect(executionForManagers(shared, "host", [workspace()], [manager, { ...manager, id: "second-manager" }, worker]).agents).toHaveLength(2);
  });

  it("prevents incorrect source/model or acceptance promises", () => {
    expect(defaultProvider([{ provider: "a", status: "offline" }, { provider: "codex", status: "ready", models: [{ id: "m", isDefault: true }] }])).toBe("codex/m");
    expect(promptFor(task)).toContain("without self-approving");
    expect(promptFor(task)).toContain("clips view '#alice#g001#t01' --json");
    expect(promptFor({ kind: "lane", ref: "#l001", title: "Vision" })).toContain("strategic product frame");
    const managerPrompt = promptFor({ kind: "lane", ref: "#l001", title: "Vision" });
    expect(managerPrompt).toContain("Before strategic management, inspect its manager claim");
    expect(managerPrompt).toContain("acquire a claim with the inspected revision and your actual observed host/runtime/session identity");
    expect(managerPrompt).toContain("If this session already owns the Lane, reuse that claim");
    expect(managerPrompt).toContain("do not begin management or take over ownership");
    expect(managerPrompt).toContain("verified top-level workspace dev agents the user can steer directly");
    expect(managerPrompt).toContain("Do not create child agents");
  });
});
