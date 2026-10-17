
import { describe, expect, it } from "vitest";
import { branchName, branchPrefix, defaultProvider, executionFor, matchesWorkspace, promptFor, type AgentInfo, type WorkspaceInfo } from "./work";

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

  it("prevents incorrect source/model or acceptance promises", () => {
    expect(defaultProvider([{ provider: "a", status: "offline" }, { provider: "codex", status: "ready", models: [{ id: "m", isDefault: true }] }])).toBe("codex/m");
    expect(promptFor(task)).toContain("without self-approving");
    expect(promptFor(task)).toContain("clips view '#alice#g001#t01' --json");
    expect(promptFor({ kind: "lane", ref: "#l001", title: "Vision" })).toContain("strategic product frame");
  });
});
