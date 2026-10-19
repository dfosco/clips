import { describe, expect, it } from "vitest";
import type { Execution } from "../shared/work";
import { uniqueRunningAgentCount } from "./running-count";

const agent = (id: string, status = "running", requiresAttention = false) => ({
  id, workspaceId: `workspace-${id}`, status, requiresAttention,
  attentionReason: requiresAttention ? "permission" as const : null,
  labels: {}, title: id,
});

const execution = (...agents: ReturnType<typeof agent>[]): Execution => ({
  status: agents.some((entry) => entry.status === "running") ? "running" : "none",
  runningAgents: agents.length, workspaceCount: agents.length,
  workspaceId: agents[0]?.workspaceId ?? null, agents,
});

describe("unique running-agent count", () => {
  it("deduplicates the same active agent across Lane and Goal rows", () => {
    expect(uniqueRunningAgentCount([
      execution(agent("shared")),
      execution(agent("shared"), agent("second", "initializing")),
    ])).toBe(2);
  });

  it("excludes idle, pending-input, and terminal agents", () => {
    expect(uniqueRunningAgentCount([
      execution(agent("idle", "idle"), agent("pending", "attention", true),
        agent("failed", "error"), agent("finished", "idle", false)),
    ])).toBe(0);
  });
});
