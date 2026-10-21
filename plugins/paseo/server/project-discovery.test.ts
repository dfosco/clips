import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localProjects, readProjectBoard } from "./backend";

const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
let root: string;
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lanes-paseo-discovery-")));
  vi.stubEnv("HOME", path.join(root, "user"));
  vi.stubEnv("LANES_HOME", undefined);
  vi.stubEnv("CLIPS_HOME", undefined);
  vi.stubEnv("LANES_CLI_PATH", cli);
  vi.stubEnv("CLIPS_CLI_PATH", "/invalid-legacy-cli");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function project(name: string, store = ".clips", config = "clips.config.json") {
  const repo = path.join(root, name);
  fs.mkdirSync(path.join(repo, store, "db"), { recursive: true });
  execFileSync("git", ["init", "--quiet", repo]);
  fs.writeFileSync(path.join(repo, store, config), "{}");
  fs.writeFileSync(path.join(repo, store, "db", "g001.jsonl"), JSON.stringify({
    event: "goal_created", goal_id: "g001", title: name, timestamp: "2026-01-01T00:00:00.000Z",
  }) + "\n");
  return repo;
}

function sdk(repos: string[]) {
  return { projects: { list: async () => ({ projects: repos.map((repo, index) => ({
    projectId: `project-${index}`, projectKind: "git", projectRootPath: repo,
    projectDisplayName: `Project ${index}`, projectCustomName: null,
  })) }) } } as Parameters<typeof localProjects>[0];
}

it("uses the matching CLI for every project/config/default-home combination and explicit board selection", async () => {
  for (const userStore of [".clips", ".lanes"]) {
    vi.stubEnv("HOME", path.join(root, `user-${userStore}`));
    fs.mkdirSync(path.join(os.homedir(), userStore), { recursive: true });
    fs.writeFileSync(path.join(os.homedir(), userStore, "projects.json"), '{"projects":[]}');
    for (const store of [".clips", ".lanes"]) {
      for (const config of ["clips.config.json", "lanes.config.json"]) {
        const first = project(`${userStore}-${store}-${config}-a`, store, config);
        const second = project(`${userStore}-${store}-${config}-b`, store, config);
        const paseo = sdk([first, second]);
        expect((await localProjects(paseo)).map(value => value.root)).toEqual([first, second]);
        expect((await readProjectBoard(paseo, "project-1")).goals[0].title).toBe(path.basename(second));
        expect(fs.readdirSync(first).sort()).toEqual([".git", store].sort());
      }
    }
  }
}, 30_000);

it("preserves project IDs and board selection through actual init and aliases", async () => {
  const repo = project("migrating");
  const home = os.homedir();
  fs.mkdirSync(path.join(home, ".clips"), { recursive: true });
  fs.writeFileSync(path.join(home, ".clips", "projects.json"), JSON.stringify({ projects: [{ path: repo }] }));
  const alias = path.join(root, "repo-alias");
  fs.symlinkSync(repo, alias);
  const paseo = sdk([repo, alias]);
  const before = await localProjects(paseo);
  expect(before).toHaveLength(1);
  execFileSync(process.execPath, [cli, "init", "--skills-scope", "project"], {
    cwd: repo, env: { ...process.env, LANES_SWITCH_INIT: "1", CLIPS_SWITCH_INIT: "1" }, stdio: "pipe",
  });
  expect(await localProjects(paseo)).toEqual(before);
  expect((await readProjectBoard(paseo, "project-1")).goals[0].title).toBe("migrating");
  expect(fs.existsSync(path.join(repo, ".lanes", "lanes.config.json"))).toBe(true);
  expect(fs.existsSync(path.join(home, ".lanes", "projects.json"))).toBe(true);
}, 30_000);

it("reports conflicting layouts without substituting another project and preserves external stores", async () => {
  const repo = project("conflict");
  const other = project("available", ".lanes", "lanes.config.json");
  const paseo = sdk([repo, other]);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  fs.mkdirSync(path.join(repo, ".lanes"));
  fs.writeFileSync(path.join(repo, ".lanes", "lanes.config.json"), "{}");
  expect((await localProjects(paseo)).map(value => value.root)).toEqual([other]);
  expect(warning).toHaveBeenCalledWith(expect.stringContaining("Cannot discover Lanes project project-0"));
  await expect(readProjectBoard(paseo, "project-0")).rejects.toThrow("no longer available");
  fs.rmSync(path.join(repo, ".lanes"), { recursive: true });
  fs.writeFileSync(path.join(repo, ".clips", "lanes.config.json"), "{}");
  expect((await localProjects(paseo)).map(value => value.root)).toEqual([other]);
  fs.unlinkSync(path.join(repo, ".clips", "lanes.config.json"));
  const external = path.join(root, "external");
  fs.renameSync(path.join(repo, ".clips"), external);
  fs.symlinkSync(external, path.join(repo, ".clips"));
  expect((await readProjectBoard(paseo, "project-0")).goals[0].title).toBe("conflict");
  const result = spawnSync(process.execPath, [cli, "init", "--skills-scope", "project"], {
    cwd: repo, env: { ...process.env, LANES_HOME: path.join(root, "custom-state") }, encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/Cannot migrate linked store safely/);
  expect((await readProjectBoard(paseo, "project-0")).goals[0].title).toBe("conflict");
}, 30_000);
