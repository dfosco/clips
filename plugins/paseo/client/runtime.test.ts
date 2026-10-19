import { describe, expect, it, vi } from "vitest";
import { navigateToAgent } from "./runtime";
import type { AgentInfo } from "../shared/work";

vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: vi.fn(), useQueryClient: vi.fn() }));

describe("existing agent navigation", () => {
  it("reveals another workspace before focusing its exact agent", () => {
    const calls: string[] = [];
    const navigation = {
      openWorkspace: ({ workspaceId }: { workspaceId: string }) => { calls.push(`workspace:${workspaceId}`); },
      openAgent: ({ agentId }: { agentId: string }) => { calls.push(`agent:${agentId}`); },
    };
    navigateToAgent({ id: "chosen-agent", workspaceId: "other-workspace" } as AgentInfo, navigation);
    expect(calls).toEqual(["workspace:other-workspace", "agent:chosen-agent"]);
  });
});
