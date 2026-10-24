import type { PaseoApi } from "@getpaseo/client";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { persistFoldHandoff } from "./resource-folding";
import type { ResourceCandidate } from "./resource-targets";

const roots: string[] = [];
const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it("persists the real plugin handoff through the canonical CLI on the exact namespaced Goal", async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lanes-plugin-handoff-"))); roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  fs.mkdirSync(path.join(root, ".lanes", "db", "alex"), { recursive: true });
  fs.writeFileSync(path.join(root, ".lanes", "lanes.config.json"), JSON.stringify({ collaboration: false, username: "alex" }));
  fs.writeFileSync(path.join(root, ".lanes", "db", "alex", "g001.jsonl"), [
    { event: "goal_created", goal_id: "g001", title: "Goal", status: "in_progress" },
    { event: "task_created", goal_id: "g001", task_id: "t01", title: "Task", status: "in_progress" },
  ].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  vi.stubEnv("LANES_HOME", path.join(root, "home")); vi.stubEnv("LANES_CLI_PATH", cli);
  const candidate = { projectRoot: root, goalRef: "#alex#g001", ref: "#alex#g001#t01" } as ResourceCandidate;
  const data = { context: "Exact latest context\n\nTests passed; human review is pending.", agent_id: "native-dev", manager_id: "native-manager",
    handoff_id: "f9b83fb5-052e-44f5-bff8-52df9aa75539", reason: "completed" as const, incomplete: false };
  const saved = await persistFoldHandoff({} as PaseoApi, candidate, data);
  expect(saved).toMatchObject({ success: true, goal_ref: "#alex#g001", source_ref: "#alex#g001#t01", context: data.context });
  const read = JSON.parse(execFileSync(process.execPath, [cli, "attachment", "read", saved.goal_ref, saved.attachment.id], { cwd: root, encoding: "utf8" }));
  expect(read.attachment.content).toContain(data.context);
  expect(read.attachment.content).toContain('"agent_id": "native-dev"');
  expect(await persistFoldHandoff({} as PaseoApi, candidate, data)).toEqual(saved);
  const goal = JSON.parse(execFileSync(process.execPath, [cli, "view", "#alex#g001", "--json"], { cwd: root, encoding: "utf8" }));
  expect(goal.status).toBe("in_progress");
  expect(goal.tasks.t01.status).toBe("in_progress");
  expect(goal.attachments).toHaveLength(1);
});
