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
  const previous = { home: process.env.CLIPS_HOME, cli: process.env.CLIPS_CLI_PATH };
  process.env.CLIPS_HOME = path.join(root, "home");
  process.env.CLIPS_CLI_PATH = cli;
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
      expect(prompt).toContain("Do not implement or run validation yourself");
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
      expect(context).toContain("Before strategic management, inspect its manager claim");
      expect(context).toContain("acquire a claim with the inspected revision and your actual observed host/runtime/session identity");
      expect(context).toContain("do not begin management or take over ownership");
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
    if (previous.home === undefined) delete process.env.CLIPS_HOME;
    else process.env.CLIPS_HOME = previous.home;
    if (previous.cli === undefined) delete process.env.CLIPS_CLI_PATH;
    else process.env.CLIPS_CLI_PATH = previous.cli;
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 15_000);
