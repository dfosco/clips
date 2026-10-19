import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

/** Share a short launch guard across the plugin and standalone CLI, including linked worktrees. */
export function acquireLaunchLock(root: string, ref: string): () => void {
  const common = fs.realpathSync(execFileSync("git", ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim());
  const directory = path.join(common, "clips-paseo-launches");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${createHash("sha256").update(ref).digest("hex")}.lock`);
  let descriptor: number;
  try { descriptor = fs.openSync(file, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    throw new Error(`A launch for ${ref} is already in progress. If its process crashed, inspect and explicitly remove the stale launch lock ${file}; ownership claims are separate and must be preserved.`);
  }
  try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, ref, started_at: new Date().toISOString() })); }
  catch (error) { fs.closeSync(descriptor); fs.unlinkSync(file); throw error; }
  fs.closeSync(descriptor);
  return () => { fs.unlinkSync(file); };
}
