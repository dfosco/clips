/** Launch protocol shared by the daemon handler and standalone CLI. No private Paseo APIs. */
export type ManagerIdentity = {
  host: string; runtime: string; session_id: string; workspace_id?: string; contact?: string;
};
export type ManagerClaim = { revision: number; owners: ManagerIdentity[] };

export function assertUnclaimed(claim: ManagerClaim): void {
  if (claim.owners.length) {
    throw new Error(`This Lane already has managers: ${JSON.stringify(claim.owners)}. Go to the manager or coordinate explicit sharing/user-authorized handover; stopping or disconnecting does not release ownership.`);
  }
}

/** Create an idle session, acquire its claim atomically, and only then deliver manager work. */
export async function launchLaneManager<T extends { id: string; workspaceId: string | null; send: (text: string) => Promise<void> }>({
  ref, hostId, claim, createIdle, claimOwner, prompt,
}: {
  ref: string;
  hostId: string;
  claim: ManagerClaim;
  createIdle: () => Promise<T>;
  claimOwner: (request: { expected_revision: number; actor: ManagerIdentity }) => Promise<unknown>;
  prompt: string;
}): Promise<T> {
  if (!hostId.trim()) throw new Error("A Lane manager launch requires the observed Paseo host ID; use the app or pass --host-id <observed-host-id>.");
  assertUnclaimed(claim);
  const created = await createIdle();
  const actor: ManagerIdentity = {
    host: hostId, runtime: "paseo", session_id: created.id,
    ...(created.workspaceId ? { workspace_id: created.workspaceId } : {}),
    contact: `Paseo agent ${created.id} on host ${hostId}`,
  };
  try {
    await claimOwner({ expected_revision: claim.revision, actor });
  } catch (error) {
    throw new Error(`Idle agent ${created.id} was created but did not claim ${ref}; its manager prompt was not sent. ${String(error)}`);
  }
  try {
    await created.send(`${prompt}\n\nYour observed Lane manager identity is ${JSON.stringify(actor)}. The launch acquired your claim for ${ref} before sending this prompt. Inspect the current claim and coordinate with any shared managers before overlapping decisions. Do not implement or run validation yourself; hand the complete engineering outcome to a verified top-level workspace dev agent the user can steer directly. Do not create child agents or babysit execution. Stopping your agent does not release ownership.`);
  } catch (error) {
    throw new Error(`Agent ${created.id} owns ${ref}, but its manager prompt could not be delivered. Resume that agent; do not start a replacement or clear its claim automatically. ${String(error)}`);
  }
  return created;
}
