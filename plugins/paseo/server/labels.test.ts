import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeProjectLabels, normalizeBoard } from "./backend";
import { boardData, labelChange } from "../shared/contracts";

const state = vi.hoisted(() => ({ root: "", calls: [] as { bin: string; args: string[]; cwd?: string }[] }));
const label = { id: "review", name: "Review", color: "#8b5cf6" };
vi.mock("@getpaseo/plugin/server", () => ({
  execCommand: async (bin: string, args: string[], opts: { cwd?: string }) => {
    state.calls.push({ bin, args, cwd: opts.cwd });
    if (bin === "git") return { stdout: path.join(state.root, ".git") };
    if (args.includes("board")) return { stdout: JSON.stringify({ lanes: [], goals: [], labels: [], warnings: [] }) };
    if (args.includes("delete")) throw { stderr: "Label review is assigned to #g001. Remove those assignments before deleting it.\nextra" };
    return { stdout: "{}" };
  },
}));
let previousCli: string | undefined;
beforeEach(() => {
  previousCli = process.env.CLIPS_CLI_PATH;
  process.env.CLIPS_CLI_PATH = "/fixture/src/cli.js";
  state.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clips-label-rpc-")));
  fs.mkdirSync(path.join(state.root, ".git"));
  fs.mkdirSync(path.join(state.root, ".clips", "db"), { recursive: true });
  state.calls = [];
});
afterEach(() => {
  if (previousCli === undefined) delete process.env.CLIPS_CLI_PATH;
  else process.env.CLIPS_CLI_PATH = previousCli;
  fs.rmSync(state.root, { recursive: true, force: true });
});
const paseo = () => ({ projects: { list: async () => ({ projects: [{
  projectId: "selected-project", projectKind: "git", projectRootPath: state.root,
  projectDisplayName: "Fixture", projectCustomName: null,
}] }) } }) as Parameters<typeof changeProjectLabels>[0];

describe("label RPC boundary", () => {
  it("projects colored labels on every record and supplies empty legacy defaults", () => {
    const result = normalizeBoard({ labels: [label], lanes: [{ ref: "#l001", labels: [label] }],
      goals: [{ ref: "#g001", labels: [label], tasks: [{ ref: "#g001#t01", labels: [label] }] }] });
    expect(boardData.parse(result).labels).toEqual([label]);
    expect(result.lanes[0].labels).toEqual([label]);
    expect(result.goals[0].labels).toEqual([label]);
    expect(result.goals[0].tasks[0].labels).toEqual([label]);
    const legacy = normalizeBoard({ lanes: [{ ref: "#l001" }], goals: [] });
    expect(legacy.labels).toEqual([]);
    expect(legacy.lanes[0].labels).toEqual([]);
    expect(() => labelChange.parse({ action: "create", name: "Bad", color: "red" })).toThrow();
  });

  it.each([
    { action: "create", name: 'Review "quoted" $(literal)', color: "#8b5cf6" },
    { action: "edit", id: "review", name: "Renamed", color: "#123456" },
    { action: "add", ref: "#alice#g001#t01", id: "review" },
    { action: "remove", ref: "#l001", id: "review" },
  ] as const)("routes $action through fixed CLI arguments in the selected project", async (change) => {
    const result = await changeProjectLabels(paseo(), { projectId: "selected-project", change });
    const call = state.calls.find((call) => call.args.includes("label"))!;
    expect(call.cwd).toBe(state.root);
    const args = call.args.slice(call.args.indexOf("label") + 1);
    if (change.action === "create") expect(args).toEqual(["create", JSON.stringify({ name: change.name, color: change.color })]);
    else if (change.action === "edit") expect(args).toEqual(["edit", "review", JSON.stringify({ name: change.name, color: change.color })]);
    else expect(args).toEqual([change.action, change.ref, "review"]);
    expect(result.labels).toEqual([]);
  });

  it("surfaces assigned-deletion failures and refuses unavailable projects before mutation", async () => {
    await expect(changeProjectLabels(paseo(), { projectId: "selected-project", change: { action: "delete", id: "review" } }))
      .rejects.toThrow("Remove those assignments");
    const before = state.calls.filter((call) => call.args.includes("label")).length;
    await expect(changeProjectLabels(paseo(), { projectId: "unavailable", change: { action: "add", ref: "#g001", id: "review" } }))
      .rejects.toThrow("no longer available");
    expect(state.calls.filter((call) => call.args.includes("label"))).toHaveLength(before);
  });
});
