import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { startWork } from "./backend";
// The standalone CLI uses Node's supported type stripping; Vitest loads the same module.
import { start } from "../cli.js";

const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));

it("both launch paths acquire the actual session before sending, and reject replacement", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clips-manager-launch-"));
  const previous = Object.fromEntries(["LANES_HOME", "LANES_CLI_PATH"].map(key => [key, process.env[key]]));
  process.env.LANES_HOME = path.join(root, "home");
  process.env.LANES_CLI_PATH = cli;
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
    run("init", "--skills-scope", "project");
    run("lane", "create", JSON.stringify({ title: "Server manager" }));
    run("lane", "create", JSON.stringify({ title: "CLI manager" }));
    let currentRef = "#l001";
    const send = vi.fn(async (prompt: string) => {
      const claim = JSON.parse(run("lane", "manager", "inspect", currentRef, "--json"));
      expect(claim.owners).toMatchObject([{ host: "observed-host", runtime: "paseo", session_id: `manager-${currentRef}`, workspace_id: "w1" }]);
      expect(prompt).toContain("Developers own technical implementation");
      expect(prompt).toContain("Review their evidence without taking over implementation");
      expect(prompt).toContain("Own manager analysis, mediation, evidence review, and continued delivery");
      expect(prompt).toContain("Assign bounded technical implementation, validation, and authorized commits");
    });
    const create = vi.fn(async (options: any) => {
      expect(options.prompt).toBeUndefined();
      return { id: `manager-${currentRef}`, workspaceId: "w1", send };
    });
    const paseo: any = {
      projects: { list: async () => ({ projects: [{ projectId: "p1", projectKind: "git", projectRootPath: root, projectDisplayName: "Fixture" }] }) },
      workspaces: {
        list: async () => ({ entries: [{ id: "w1", projectId: "p1", name: "Existing", title: "Existing", status: "ready", gitRuntime: { currentBranch: "main" } }], pageInfo: { hasMore: false } }),
        ref: () => ({ id: "w1", agents: { create } }),
      },
      agents: { list: async () => ({ entries: [], pageInfo: { hasMore: false } }) },
      providers: {
        snapshot: async () => ({ entries: [{ provider: "codex", status: "ready", models: [{ id: "model", isDefault: true }], modes: [{ id: "full-access", label: "Full access" }] }] }),
        listModes: async () => ({ modes: [{ id: "full-access", label: "Full access" }] }),
        listFeatures: async () => ({ features: [] }),
      },
    };
    await expect(startWork(paseo, { agent: "codex/model", featureValues: {} } as any, { projectId: "p1", ref: currentRef, mode: "agent", workspaceId: "w1" })).rejects.toThrow("observed Paseo host ID");
    expect(create).not.toHaveBeenCalled();
    await expect(startWork(paseo, { agent: "codex/model", featureValues: {} } as any, { projectId: "p1", ref: currentRef, mode: "agent", workspaceId: "w1", hostId: "observed-host" })).resolves.toMatchObject({ agentId: "manager-#l001" });
    await expect(startWork(paseo, { agent: "codex/model", featureValues: {} } as any, { projectId: "p1", ref: currentRef, mode: "workspace", hostId: "observed-host" })).rejects.toThrow("already has managers");
    currentRef = "#l002";
    const options = { project: root, ref: currentRef, provider: "codex/model", workspace: "w1", features: [] };
    await expect(start(paseo, options)).rejects.toThrow("--host-id");
    expect(create).toHaveBeenCalledOnce();
    await expect(start(paseo, { ...options, "host-id": "observed-host" })).resolves.toMatchObject({ agentId: "manager-#l002" });
    await expect(start(paseo, { ...options, "host-id": "observed-host" })).rejects.toThrow("already has managers");
    expect(create).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);

    // Workspace-only launches must hand a manual first agent the same ownership obligation.
    run("lane", "create", JSON.stringify({ title: "Manual manager" }));
    paseo.workspaces.list = async () => ({ entries: [], pageInfo: { hasMore: false } });
    const createWorkspace = vi.fn(async (options: any) => {
      const context = options.firstAgentContext.attachments[0].text;
      expect(context).toContain("Developers own technical implementation, resolve routine conflicts, run checks and make authorized local commits");
      expect(context).toContain("Mediate competing approaches with the developers");
      expect(context).toContain("Review their evidence without taking over implementation");
      expect(context).toContain("plan concurrency in identified Task contracts before assignment");
      return { id: "manual-workspace" };
    });
    paseo.workspaces.create = createWorkspace;
    await expect(startWork(paseo, { agent: "", featureValues: {} } as any, {
      projectId: "p1", ref: "#l003", mode: "workspace",
    })).resolves.toMatchObject({ workspaceId: "manual-workspace", agentId: null });
    expect(createWorkspace).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledTimes(2);
    expect(JSON.parse(run("lane", "manager", "inspect", "#l003", "--json"))).toMatchObject({ revision: 0, owners: [] });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
