import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeBoard, readProjectAttachment, setProjectCollaboration } from "./backend";
import { attachmentReadRpc, boardData, collaborationRpc } from "../shared/contracts";

const state = vi.hoisted(() => ({
  root: "",
  calls: [] as { bin: string; args: string[]; cwd?: string }[],
  board: {} as any,
  attachmentResult: {} as any,
  failConfig: false,
}));

const markdownId = "att-123e4567-e89b-12d3-a456-426614174000";

vi.mock("@getpaseo/plugin/server", () => ({
  execCommand: async (bin: string, args: string[], opts: { cwd?: string }) => {
    state.calls.push({ bin, args, cwd: opts.cwd });
    if (bin === "git") return { stdout: path.join(state.root, ".git") };
    if (args.includes("paths")) return { stdout: JSON.stringify({
      repoRoot: state.root, storeDir: path.join(state.root, ".clips"),
      configPath: path.join(state.root, ".clips", "clips.config.json"),
    }) };
    if (args.includes("board")) return { stdout: JSON.stringify(state.board) };
    if (args.includes("attachment")) return { stdout: JSON.stringify(state.attachmentResult) };
    if (args.includes("config")) {
      if (state.failConfig) throw { stderr: "local config is read-only" };
      state.board.collaboration.enabled = args.at(-1) === "true";
      state.board.collaboration.state = state.board.collaboration.enabled ? "enabled" : "disabled";
      state.board.collaboration.automatic_mutation_sync = state.board.collaboration.enabled;
      return { stdout: "updated locally" };
    }
    return { stdout: "{}" };
  },
}));

let previousCli: string | undefined;
let previousCanonicalCli: string | undefined;

beforeEach(() => {
  previousCli = process.env.CLIPS_CLI_PATH;
  previousCanonicalCli = process.env.LANES_CLI_PATH;
  delete process.env.LANES_CLI_PATH;
  process.env.CLIPS_CLI_PATH = "/fixture/src/cli.js";
  state.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clips-attachment-rpc-")));
  fs.mkdirSync(path.join(state.root, ".git"));
  fs.mkdirSync(path.join(state.root, ".clips", "db"), { recursive: true });
  state.calls = [];
  state.failConfig = false;
  state.board = {
    generated_at: "2026-10-20T12:00:00.000Z",
    collaboration: {
      enabled: false, state: "disabled", scope: "project",
      automatic_mutation_sync: false,
      control: { command: "untrusted descriptor", network_access: false },
    },
    lanes: [{
      ref: "#l001", title: "Lane", attachments: [
        { id: markdownId, type: "markdown", title: "Runbook", path: "/private/path.md",
          status: "available", content: "board projection must not be trusted", history_revision: 4 },
        { id: "att-url", type: "url", title: "Design", url: "https://example.com/design", status: "remote" },
      ],
    }],
    goals: [{
      ref: "#g001", title: "Goal", tasks: [{
        ref: "#g001#t01", title: "Task", attachments: [
          { id: markdownId, type: "markdown", title: "Task file", status: "missing" },
        ],
      }],
    }],
    labels: [],
    warnings: [],
  };
  state.attachmentResult = {
    ref: "#l001",
    revision: 7,
    attachment: {
      id: markdownId, type: "markdown", title: "Runbook",
      path: "/private/path.md", status: "missing", content: null,
      error: "The attached Markdown file is missing.",
      content_semantics: "current_file",
    },
  };
});

afterEach(() => {
  if (previousCli === undefined) delete process.env.CLIPS_CLI_PATH;
  else process.env.CLIPS_CLI_PATH = previousCli;
  if (previousCanonicalCli === undefined) delete process.env.LANES_CLI_PATH;
  else process.env.LANES_CLI_PATH = previousCanonicalCli;
  fs.rmSync(state.root, { recursive: true, force: true });
});

const paseo = () => ({ projects: { list: async () => ({ projects: [{
  projectId: "selected-project", projectKind: "git", projectRootPath: state.root,
  projectDisplayName: "Fixture", projectCustomName: null,
}] }) } }) as Parameters<typeof readProjectAttachment>[0];

describe("live attachment and project-local collaboration RPCs", () => {
  it("preserves attachment/history metadata while removing filesystem paths", () => {
    const result = normalizeBoard(state.board);
    expect(boardData.parse(result).collaboration).toMatchObject({
      enabled: false, state: "disabled", automatic_mutation_sync: false,
      control: { command: "untrusted descriptor" },
    });
    expect(result.generatedAt).toBe(state.board.generated_at);
    expect(result.lanes[0].attachments[0]).toMatchObject({
      id: markdownId, status: "available", history_revision: 4,
    });
    expect(result.lanes[0].attachments[0]).not.toHaveProperty("path");
    expect(result.goals[0].tasks[0].attachments[0].status).toBe("missing");
    expect(() => normalizeBoard({ lanes: [{ ref: "#l1", attachments: "invalid" }], goals: [] })).toThrow(/invalid attachment metadata/i);
  });

  it("reads only an attachment already associated with the exact current record", async () => {
    const result = await readProjectAttachment(paseo(), {
      projectId: "selected-project", ref: "#l001", attachmentId: markdownId,
    });
    expect(result).toMatchObject({
      ref: "#l001", revision: 7,
      attachment: { id: markdownId, status: "missing", content: null, content_semantics: "current_file" },
    });
    expect(result.attachment).not.toHaveProperty("path");
    const call = state.calls.find(({ args }) => args.includes("attachment"))!;
    expect(call.cwd).toBe(state.root);
    expect(call.args.slice(call.args.indexOf("attachment"))).toEqual(["attachment", "read", "#l001", markdownId]);

    const before = state.calls.filter(({ args }) => args.includes("attachment")).length;
    await expect(readProjectAttachment(paseo(), {
      projectId: "selected-project", ref: "#g404", attachmentId: markdownId,
    })).rejects.toThrow(/not present in this project's current Lanes board/);
    await expect(readProjectAttachment(paseo(), {
      projectId: "selected-project", ref: "#l001", attachmentId: "att-not-attached",
    })).rejects.toThrow(/not associated/);
    await expect(readProjectAttachment(paseo(), {
      projectId: "selected-project", ref: "#l001", attachmentId: "att-url",
    })).rejects.toThrow(/Only Markdown/);
    expect(state.calls.filter(({ args }) => args.includes("attachment"))).toHaveLength(before);
    expect(() => attachmentReadRpc.input.parse({
      projectId: "selected-project", ref: "#l001", attachmentId: markdownId, path: "/etc/passwd",
    })).toThrow();
  });

  it("toggles only the selected project's local setting and returns fresh board state", async () => {
    const result = await setProjectCollaboration(paseo(), { projectId: "selected-project", enabled: true });
    expect(result.collaboration).toMatchObject({
      enabled: true, state: "enabled", automatic_mutation_sync: true,
    });
    const call = state.calls.find(({ args }) => args.includes("config"))!;
    expect(call.cwd).toBe(state.root);
    expect(call.args.slice(call.args.indexOf("config"))).toEqual(["config", "collaboration", "true"]);
    expect(state.calls.some(({ args }) => args.includes("sync"))).toBe(false);
    expect(() => collaborationRpc.input.parse({
      projectId: "selected-project", enabled: true, command: "sync",
    })).toThrow();
  });

  it("surfaces invalid capability and command failures", async () => {
    state.board.collaboration = { enabled: null, state: "invalid", scope: "project", error: "Corrupt config" };
    await expect(setProjectCollaboration(paseo(), { projectId: "selected-project", enabled: true }))
      .rejects.toThrow("Corrupt config");
    const before = state.calls.filter(({ args }) => args.includes("config")).length;
    state.board.collaboration = { enabled: false, state: "disabled", scope: "project" };
    await expect(setProjectCollaboration(paseo(), { projectId: "missing", enabled: true }))
      .rejects.toThrow(/no longer available/);
    expect(state.calls.filter(({ args }) => args.includes("config"))).toHaveLength(before);
    state.failConfig = true;
    await expect(setProjectCollaboration(paseo(), { projectId: "selected-project", enabled: true }))
      .rejects.toThrow(/local config is read-only/);
  });
});
