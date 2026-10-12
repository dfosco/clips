
import { usePaseo } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { AgentInfo, WorkspaceInfo } from "../shared/work";

type Paseo = ReturnType<typeof usePaseo>;
const MAX_PAGES = 100;

export async function runtimeSnapshot(paseo: Paseo): Promise<{ workspaces: WorkspaceInfo[]; agents: AgentInfo[] }> {
  const [workspaces, agents] = await Promise.all([
    (async () => {
      const result: WorkspaceInfo[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < MAX_PAGES; index += 1) {
        const page = await paseo.workspaces.list({ page: { limit: 200, cursor } });
        for (const w of page.entries) result.push({
          id: w.id,
          projectId: w.projectId,
          name: w.title || w.name,
          status: w.status,
          branch: w.gitRuntime?.currentBranch ?? "",
        });
        if (!page.pageInfo.hasMore) return result;
        cursor = page.pageInfo.nextCursor ?? undefined;
        if (!cursor) throw new Error("Paseo workspace pagination lost its cursor.");
      }
      throw new Error("Paseo workspace directory exceeds the supported list size.");
    })(),
    (async () => {
      const result: AgentInfo[] = [];
      let cursor: string | undefined;
      for (let index = 0; index < MAX_PAGES; index += 1) {
        const page = await paseo.agents.list({ page: { limit: 200, cursor } });
        for (const { agent } of page.entries) result.push({
          id: agent.id,
          workspaceId: agent.workspaceId || null,
          status: agent.status,
          requiresAttention: agent.requiresAttention ?? false,
          labels: agent.labels ?? {},
          title: agent.title ?? null,
        });
        if (!page.pageInfo.hasMore) return result;
        cursor = page.pageInfo.nextCursor ?? undefined;
        if (!cursor) throw new Error("Paseo agent pagination lost its cursor.");
      }
      throw new Error("Paseo agent directory exceeds the supported list size.");
    })(),
  ]);
  return { workspaces, agents };
}

/** Owned directory observations provide prompt status refreshes; polling heals missed updates. */
export function useRuntime(hostId: string) {
  const paseo = usePaseo();
  const cache = useQueryClient();
  const key = ["clips-runtime", hostId];
  useEffect(() => {
    let disposed = false;
    const releases: Array<() => Promise<unknown>> = [];
    const changed = () => { if (!disposed) void cache.invalidateQueries({ queryKey: key }); };
    async function observe() {
      // Both views have their own owned observation and cleanup.
      try {
        const workspaces = await paseo.workspaces.list({ subscribe: {}, page: { limit: 200 } });
        if (disposed) await workspaces.subscription.release();
        else {
          releases.push(() => workspaces.subscription.release());
          workspaces.subscription.subscribe({ snapshot: changed, update: changed });
        }
      } catch {
        // The interval backstop also works with older daemons.
      }
      try {
        const agents = await paseo.agents.list({ subscribe: {}, page: { limit: 200 } });
        if (disposed) await agents.subscription.release();
        else {
          releases.push(() => agents.subscription.release());
          agents.subscription.subscribe({ snapshot: changed, update: changed });
        }
      } catch {
        // The interval backstop also works with older daemons.
      }
    }
    void observe();
    return () => {
      disposed = true;
      for (const release of releases) void release();
    };
  }, [paseo, cache, hostId]);

  return useQuery({
    queryKey: key,
    queryFn: () => runtimeSnapshot(paseo),
    refetchInterval: 15_000,
  });
}
