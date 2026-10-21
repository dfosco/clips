import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { acquireLaunchLock } from "./launch-lock";

const roots: string[] = [];
const moduleUrl = new URL("./launch-lock.ts", import.meta.url).href;
const cli = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clips-launch-lock-"));
  roots.push(root);
  const repository = path.join(root, "repo");
  fs.mkdirSync(repository);
  execFileSync("git", ["init", "--quiet", repository]);
  return { root, repository };
}

function childAttempt(root: string, ref: string) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", `
    import { acquireLaunchLock } from ${JSON.stringify(moduleUrl)};
    try { const release = acquireLaunchLock(process.argv[1], process.argv[2]); release(); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  `, root, ref], { encoding: "utf8", timeout: 10_000 });
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("shared record launch lock", () => {
  it("excludes separate processes through linked worktrees and symlinks", () => {
    const { root, repository } = fixture();
    execFileSync("git", ["-C", repository, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "--quiet", "-m", "fixture"]);
    const worktree = path.join(root, "worktree");
    execFileSync("git", ["-C", repository, "worktree", "add", "--detach", "--quiet", worktree]);
    const symlink = path.join(root, "symlink");
    fs.symlinkSync(repository, symlink);
    const release = acquireLaunchLock(repository, "#g001");
    try {
      for (const candidate of [repository, worktree, symlink]) {
        const result = childAttempt(candidate, "#g001");
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("already in progress");
      }
      expect(childAttempt(worktree, "#g002").status).toBe(0);
      expect(childAttempt(fixture().repository, "#g001").status).toBe(0);
    } finally { release(); }
    expect(childAttempt(worktree, "#g001").status).toBe(0);
  }, 30_000);

  it("keeps a crashed process lock until explicit repair, without touching ownership", () => {
    const { repository } = fixture();
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { acquireLaunchLock } from ${JSON.stringify(moduleUrl)};
      acquireLaunchLock(process.argv[1], '#l001');
    `, repository], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(0);
    const attempt = childAttempt(repository, "#l001");
    expect(attempt.status).toBe(1);
    expect(attempt.stderr).toContain("explicitly remove the stale launch lock");
    expect(attempt.stderr).toContain("ownership claims are separate");
  });

  it("guards both CLI and server paths before any agent or workspace mutation", async () => {
    const { root, repository } = fixture();
    const previous = Object.fromEntries(["LANES_HOME", "LANES_CLI_PATH"].map(key => [key, process.env[key]]));
    process.env.LANES_HOME = path.join(root, "home");
    process.env.LANES_CLI_PATH = cli;
    try {
      execFileSync(process.execPath, [cli, "init", "--skills-scope", "project"], {
        cwd: repository, env: { ...process.env, LANES_HOME: path.join(root, "home") },
      });
      const { startWork } = await import("./backend");
      const { start } = await import("../cli.js");
      const paseo: any = {
        projects: { list: async () => ({ projects: [{ projectId: "p1", projectKind: "git", projectRootPath: repository, projectDisplayName: "Fixture" }] }) },
      };
      // No mutation APIs exist on this fixture: either path reaching one would fail differently.
      const release = acquireLaunchLock(repository, "#g001");
      try {
        await expect(start(paseo, { project: repository, ref: "#g001" })).rejects.toThrow("already in progress");
        await expect(startWork(paseo, { agent: "" }, { projectId: "p1", ref: "#g001", mode: "agent" })).rejects.toThrow("already in progress");
      } finally { release(); }
      await expect(start(paseo, { project: repository, ref: "#g001" })).rejects.toThrow("--provider");
      // Rejected launches must also release their guard.
      expect(childAttempt(repository, "#g001").status).toBe(0);
      await expect(startWork(paseo, { agent: "" }, { projectId: "p1", ref: "#g001", mode: "agent" })).rejects.toThrow("does not exist");
      expect(childAttempt(repository, "#g001").status).toBe(0);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  }, 30_000);
});
