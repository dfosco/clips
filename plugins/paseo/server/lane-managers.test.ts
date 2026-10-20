import { describe, expect, it, vi } from "vitest";
import { launchLaneManager } from "./lane-managers";

function fixture() {
  const send = vi.fn(async () => {});
  const createIdle = vi.fn(async () => ({ id: "actual-agent-id", workspaceId: "actual-workspace", send }));
  const claimOwner = vi.fn(async () => {});
  return { send, createIdle, claimOwner, input: {
    ref: "#l001", hostId: "observed-host", claim: { revision: 0, owners: [] },
    prompt: "Coordinate this lane", createIdle, claimOwner,
  } };
}

describe("Lane manager launch ordering", () => {
  it("claims the actual idle session before sending manager work", async () => {
    const { input, send, createIdle, claimOwner } = fixture();
    claimOwner.mockImplementationOnce(async () => {
      expect(createIdle).toHaveBeenCalledOnce();
      expect(send).not.toHaveBeenCalled();
    });
    await launchLaneManager(input);
    expect(createIdle).toHaveBeenCalledWith();
    expect(claimOwner).toHaveBeenCalledWith({ expected_revision: 0, actor: {
      host: "observed-host", runtime: "paseo", session_id: "actual-agent-id", workspace_id: "actual-workspace",
      contact: "Paseo agent actual-agent-id on host observed-host",
    } });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toContain("Stopping your agent does not release ownership");
    expect(send.mock.calls[0][0]).toContain("verified top-level workspace dev agent the user can steer directly");
    expect(send.mock.calls[0][0]).toContain("Do not create child agents");
  });

  it("rejects an existing owner or missing identity before creating an agent", async () => {
    const { input, createIdle } = fixture();
    await expect(launchLaneManager({ ...input, hostId: "" })).rejects.toThrow("observed Paseo host ID");
    await expect(launchLaneManager({ ...input, claim: { revision: 2, owners: [{ host: "other", runtime: "paseo", session_id: "manager" }] } })).rejects.toThrow("already has managers");
    expect(createIdle).not.toHaveBeenCalled();
  });

  it("never sends a prompt when a concurrent claimant wins", async () => {
    const { input, send, claimOwner } = fixture();
    claimOwner.mockRejectedValueOnce(new Error("revision conflict"));
    await expect(launchLaneManager(input)).rejects.toThrow("manager prompt was not sent");
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves ownership and reports the exact agent if prompt delivery fails", async () => {
    const { input, send, claimOwner } = fixture();
    send.mockRejectedValueOnce(new Error("disconnected"));
    await expect(launchLaneManager(input)).rejects.toThrow("Agent actual-agent-id owns #l001");
    expect(claimOwner).toHaveBeenCalledOnce();
  });
});
