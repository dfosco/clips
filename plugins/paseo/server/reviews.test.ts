import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { decideProjectReview, readProjectReview } from "./backend";

const rootPath = fileURLToPath(new URL("../../../src/cli.js", import.meta.url));
const tempDirs: string[] = [];
const isolatedEnvKeys = ["HOME", "LANES_HOME", "CLIPS_HOME", "LANES_CLI_PATH"];
const originalEnv = Object.fromEntries(isolatedEnvKeys.map((key) => [key, process.env[key]]));
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const cli = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) => execFileSync(process.execPath, [rootPath, ...args], { cwd, env, encoding: "utf8" });

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const directory of tempDirs.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

it("reads the CLI review detail attachment nesting and pinned CR identity", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lanes-paseo-review-detail-"));
  tempDirs.push(root);
  git(root, "init", "--quiet", "-b", "main");
  git(root, "config", "user.email", "fixture@example.test");
  git(root, "config", "user.name", "Review Fixture");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "request.md"), "# Requested change\n\nPinned CR content.\n");
  fs.writeFileSync(path.join(root, "source.txt"), "base\n");
  git(root, "add", ".");
  git(root, "commit", "--quiet", "-m", "base");
  const base = git(root, "rev-parse", "HEAD");
  git(root, "switch", "--quiet", "-c", "feature");
  fs.writeFileSync(path.join(root, "source.txt"), "candidate\n");
  git(root, "commit", "--quiet", "-am", "candidate");
  const head = git(root, "rev-parse", "HEAD");
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, LANES_HOME: path.join(home, ".lanes"), CLIPS_HOME: path.join(home, ".clips"), LANES_CLI_PATH: rootPath };
  process.env.HOME = home;
  process.env.LANES_HOME = env.LANES_HOME;
  process.env.CLIPS_HOME = env.CLIPS_HOME;
  process.env.LANES_CLI_PATH = rootPath;
  cli(root, env, "init", "--skills-scope", "project");
  cli(root, env, "goal", "create", JSON.stringify({ title: "Review target" }));
  const added = JSON.parse(cli(root, env, "attachment", "add", "#g1", JSON.stringify({
    type: "markdown", path: "docs/request.md", title: "Change request", purpose: "cr",
  })));
  const requestFile = path.join(root, "review-request.json");
  fs.writeFileSync(requestFile, JSON.stringify({
    attachment_id: added.attachment.id, reviewer: "reviewer", candidate: { base, head },
    summary: "Review this exact candidate.", validation: { status: "passed" },
  }));
  const requested = JSON.parse(cli(root, env, "review", "request", "#g1", "--file", requestFile));
  const paseo = { projects: { list: async () => ({ projects: [{ projectId: "fixture", projectKind: "git",
    projectRootPath: root, projectDisplayName: "Fixture", projectCustomName: null }] }) } } as any;

  process.env.LANES_CLI_PATH = rootPath;
  const detail = await readProjectReview(paseo, { projectId: "fixture", id: requested.id });
  expect(detail).toMatchObject({
    id: requested.id, revision: 1, status: "awaiting_review", stale: false,
    candidate: { base, head, base_ref: "main", head_ref: "feature" },
    attachment: { purpose: "cr", content: "# Requested change\n\nPinned CR content.\n" },
  });
  expect(detail.attachment.read_identity).toMatchObject({ pinned: { status: "available" } });
  expect(detail.content_identity).toMatchObject({ sha256: expect.any(String) });
  const decided = await decideProjectReview(paseo, {
    projectId: "fixture", id: requested.id, decision: "approved", actor: "reviewer",
    candidate: { base, head }, comment: "Reviewed the pinned request.", expectedRevision: detail.revision,
  });
  expect(decided).toMatchObject({ id: requested.id, revision: 2, status: "approved" });
}, 30_000);
