import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const execFile = promisify(nodeExecFile);
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const recordCommandPattern = /^(board|view|history|goal|task|lane|label|component|track)$/;
const allowedCommands = new Set([
  "board", "view", "history",
  "goal create", "goal update", "goal status", "goal accept", "goal assign",
  "task create", "task create-batch", "task update", "task status", "task accept", "task show", "task reorder",
  "lane list", "lane show", "lane create", "lane update", "lane assign", "lane status", "lane close",
  "lane manager list", "lane manager inspect", "lane manager claim", "lane manager share", "lane manager release", "lane manager handover",
  "label list", "label create", "label edit", "label recolor", "label delete", "label add", "label remove",
  "component list", "component show", "component create", "component update", "track list", "track show",
]);

const asString = (value) => typeof value === "string" ? value : "";
const safeId = (value) => typeof value === "string" && value.trim().length > 0 && !/[\0\r\n]/.test(value);
const safePrompt = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 100_000 &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function errorMessage(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  return stderr || (error instanceof Error ? error.message : String(error));
}

async function realpath(input) {
  if (!safeId(input)) throw new Error("A project path is required.");
  try {
    return await fs.realpath(input);
  } catch (error) {
    throw new Error(`Project path is unavailable: ${errorMessage(error)}`);
  }
}

async function gitContext(projectPath) {
  const cwd = await realpath(projectPath);
  let root;
  let commonDir;
  try {
    ({ stdout: root } = await execFile("git", ["-C", cwd, "rev-parse", "--show-toplevel"]));
    ({ stdout: commonDir } = await execFile("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"]));
    root = await fs.realpath(root.trim());
    commonDir = await fs.realpath(commonDir.trim());
  } catch (error) {
    throw new Error(`Copilot runtime requires a local Git project for scoped session identity: ${errorMessage(error)}`);
  }
  return { cwd, root, commonDir };
}

function parseJson(text, description) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Clips returned invalid JSON for ${description}.`);
  }
}

function commandFamily(args) {
  if (!Array.isArray(args) || args.length === 0 || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) {
    throw new Error("recordCommand requires a non-empty array of string arguments.");
  }
  if (args.some((arg) => arg === "--file" || arg === "--stdin" || arg === "--project" || arg === "--username" || arg.startsWith("--project=") || arg.startsWith("--file="))) {
    throw new Error("recordCommand does not accept external file, project, or user-scope overrides.");
  }
  const family = args[0] === "lane" && args[2] === "add"
    ? "lane assign"
    : args[0] === "lane" && args[1] === "manager"
      ? args.slice(0, 3).join(" ")
      : args.slice(0, 2).join(" ");
  const first = args[0];
  if (!recordCommandPattern.test(first) || !allowedCommands.has(family) && !allowedCommands.has(first)) {
    throw new Error(`Unsupported Clips command family: ${family}`);
  }
  return family;
}

function isReadCommand(args) {
  return args[0] === "board" || args[0] === "view" || args[0] === "history" ||
    args[0] === "lane" && (args[1] === "list" || args[1] === "show" || args[1] === "manager" && ["list", "inspect"].includes(args[2])) ||
    args[0] === "component" && ["list", "show"].includes(args[1]) ||
    args[0] === "track" && ["list", "show"].includes(args[1]) ||
    args[0] === "label" && args[1] === "list" ||
    args[0] === "task" && args[1] === "show";
}

function normalizeSession(metadata, binding, appSessionVisibilityVerified = false) {
  const context = metadata.context ?? {};
  const sessionId = metadata.sessionId;
  return {
    id: sessionId,
    sessionId,
    runtime: "copilot-sdk",
    workingDirectory: context.workingDirectory ?? null,
    gitRoot: context.gitRoot ?? null,
    repository: context.repository ?? null,
    branch: context.branch ?? null,
    recordRef: binding?.ref ?? null,
    projectId: binding?.project_id ?? null,
    recordKind: binding?.kind ?? null,
    hostId: binding?.host ?? null,
    hostIdentitySource: binding?.host_identity_source ?? null,
    startedAt: metadata.startTime instanceof Date ? metadata.startTime.toISOString() : metadata.startTime ?? null,
    modifiedAt: metadata.modifiedTime instanceof Date ? metadata.modifiedTime.toISOString() : metadata.modifiedTime ?? null,
    summary: metadata.summary ?? null,
    status: "unknown",
    workspaceId: null,
    steerable: appSessionVisibilityVerified,
    sdkSteerable: true,
    appVisible: appSessionVisibilityVerified ? "verified_by_host_check" : "unverified",
    navigationUrl: `ghapp://sessions/${encodeURIComponent(sessionId)}`,
  };
}

function validateSessionConfig(input) {
  if (!input || typeof input !== "object") throw new Error("launchRecord requires an input object.");
  for (const field of ["projectPath", "ref", "prompt"]) {
    if (field === "prompt" ? !safePrompt(input[field]) : !safeId(input[field])) {
      throw new Error(`launchRecord requires a valid ${field}${field === "prompt" ? " (1–100,000 characters; ordinary line breaks are allowed)" : ""}.`);
    }
  }
  if (input.model !== undefined && !safeId(input.model)) throw new Error("model must be a non-empty string when provided.");
  if (input.reasoningEffort !== undefined && !safeId(input.reasoningEffort)) throw new Error("reasoningEffort must be a non-empty string when provided.");
}

export function appSessionUrl(sessionId) {
  if (!safeId(sessionId)) throw new Error("A Copilot session ID is required for navigation.");
  return `ghapp://sessions/${encodeURIComponent(sessionId)}`;
}

/**
 * Create the Copilot host adapter. It starts an owned SDK client lazily, only
 * when a session operation is requested. Injected clients remain caller-owned.
 * All planning mutations go through the canonical Clips CLI; no journal files
 * are read or written here.
 */
export async function createClipsRuntime(options = {}) {
  const injectedClient = options.client;
  const cliRunner = options.cliRunner ?? ((bin, args, cwd) => execFile(bin, args, { cwd, maxBuffer: 8 * 1024 * 1024 }));
  const copilotHome = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
  const dataRoot = options.dataRoot ?? path.join(copilotHome, "clips-runtime");
  let client = injectedClient;
  let ownsClient = false;
  let started = false;
  const configuredHostId = options.hostId ?? process.env.CLIPS_COPILOT_HOST_ID;
  const hostId = safeId(configuredHostId) ? configuredHostId.trim() : null;
  const hostIdentitySource = options.hostId ? "runtime option" : process.env.CLIPS_COPILOT_HOST_ID ? "CLIPS_COPILOT_HOST_ID" : null;
  let appSessionVisibilityVerified = false;
  const capabilityFile = path.join(dataRoot, "host-capabilities.json");

  async function getClient() {
    if (!client) {
      const sdk = await import("@github/copilot-sdk");
      client = new sdk.CopilotClient(process.env.COPILOT_HOME ? { baseDirectory: copilotHome } : {});
      ownsClient = true;
    }
    if (!started) {
      await client.start();
      started = true;
    }
    return client;
  }

  async function cliPath(projectPath) {
    if (options.cliPath) return options.cliPath.endsWith(".js")
      ? { bin: process.execPath, prefix: [path.resolve(options.cliPath)] }
      : { bin: options.cliPath, prefix: [] };
    const configured = process.env.CLIPS_CLI_PATH?.trim();
    if (configured) {
      return configured.endsWith(".js")
        ? { bin: process.execPath, prefix: [path.resolve(configured)] }
        : { bin: configured, prefix: [] };
    }
    const local = path.join(moduleRoot, "src", "cli.js");
    try {
      await fs.access(local);
      return { bin: process.execPath, prefix: [local] };
    } catch { /* use the installed executable below */ }
    const candidates = ["clips", path.join(os.homedir(), ".local", "bin", "clips"), "/opt/homebrew/bin/clips", "/usr/local/bin/clips"];
    for (const candidate of candidates) {
      try {
        await cliRunner(candidate, ["--version"], projectPath);
        return { bin: candidate, prefix: [] };
      } catch { /* continue */ }
    }
    throw new Error("Clips CLI not found. Install Clips or set CLIPS_CLI_PATH to the maintained checkout's src/cli.js.");
  }

  async function runClips(args, projectPath, { parse = true } = {}) {
    const context = await gitContext(projectPath);
    const cli = await cliPath(context.cwd);
    const finalArgs = [...cli.prefix, ...args];
    if (isReadCommand(args) && !args.includes("--json")) finalArgs.push("--json");
    let result;
    try {
      result = await cliRunner(cli.bin, finalArgs, context.cwd);
    } catch (error) {
      throw new Error(`Clips command failed in ${context.cwd}: ${errorMessage(error)}`);
    }
    const output = asString(result?.stdout).trim();
    if (!output) return { success: true };
    if (!parse) return output;
    try { return JSON.parse(output); } catch { return output; }
  }

  async function bindingFile(sessionId) {
    return path.join(dataRoot, "bindings", `${sha256(sessionId)}.json`);
  }

  async function readBinding(sessionId) {
    try {
      const value = JSON.parse(await fs.readFile(await bindingFile(sessionId), "utf8"));
      if (value.version !== 1 || value.session_id !== sessionId) return null;
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new Error(`Copilot session binding is unreadable for ${sessionId}: ${errorMessage(error)}`);
    }
  }

  async function writeBinding(binding) {
    const filename = await bindingFile(binding.session_id);
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    try { await fs.rename(temporary, filename); }
    catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  async function acquireRecordLaunchLock(repositoryId, ref) {
    const key = sha256(`${repositoryId}\0${ref}`);
    const filename = path.join(dataRoot, "launch-locks", `${key}.lock`);
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await fs.open(filename, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, repository_id: repositoryId, ref, started_at: new Date().toISOString() })}\n`);
      await handle.close();
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code === "EEXIST") {
        throw new Error(`A Copilot launch for ${ref} is already in progress or left a crash lock at ${filename}. Verify no launch is active before removing a stale lock.`);
      }
      throw error;
    }
    return async () => fs.rm(filename, { force: true });
  }

  async function readHostCapabilities() {
    try {
      const value = JSON.parse(await fs.readFile(capabilityFile, "utf8"));
      return value.version === 1 && value.app_session?.verified === true &&
        safeId(value.app_session?.app_version) && safeId(value.app_session?.session_id) &&
        safeId(value.app_session?.verified_by) && value.app_session?.opened_in_app === true &&
        value.app_session?.steered_in_app === true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw new Error(`Copilot host capability setting is unreadable: ${errorMessage(error)}`);
    }
  }

  async function isAppSessionVerified() {
    appSessionVisibilityVerified = await readHostCapabilities();
    return appSessionVisibilityVerified;
  }

  async function recordHostVerification(evidence) {
    if (!evidence || !safeId(evidence.appVersion) || !safeId(evidence.sessionId) || !safeId(evidence.verifiedBy) ||
      evidence.openedInApp !== true || evidence.steeredInApp !== true) {
      throw new Error("Host verification requires the app version, an actual SDK session ID, verifier identity, and confirmed open plus steering in the Copilot App.");
    }
    const sdkClient = await getClient();
    if (!await sdkClient.getSessionMetadata(evidence.sessionId)) {
      throw new Error("The verified session ID is not present in the Copilot SDK session catalog.");
    }
    const value = {
      version: 1,
      app_session: {
        verified: true,
        app_version: evidence.appVersion.trim(),
        session_id: evidence.sessionId.trim(),
        verified_by: evidence.verifiedBy.trim(),
        opened_in_app: true,
        steered_in_app: true,
        evidence_source: "user-confirmed-local-app-check",
        verified_at: new Date().toISOString(),
      },
    };
    await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
    const temporary = `${capabilityFile}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    try { await fs.rename(temporary, capabilityFile); }
    catch (error) { await fs.rm(temporary, { force: true }); throw error; }
    appSessionVisibilityVerified = await readHostCapabilities();
    return { appSessionVisibilityVerified, capabilityFile };
  }

  appSessionVisibilityVerified = await readHostCapabilities();

  async function listBindings() {
    const dir = path.join(dataRoot, "bindings");
    let names;
    try { names = await fs.readdir(dir); }
    catch (error) { if (error?.code === "ENOENT") return []; throw error; }
    const bindings = [];
    for (const name of names.filter((entry) => entry.endsWith(".json"))) {
      const file = path.join(dir, name);
      const value = parseJson(await fs.readFile(file, "utf8"), `session binding ${name}`);
      if (value.version !== 1 || !safeId(value.session_id) || !safeId(value.ref) || !safeId(value.repository_id)) {
        throw new Error(`Invalid Copilot session binding: ${file}`);
      }
      bindings.push(value);
    }
    return bindings;
  }

  async function listBoard(projectPath) {
    const result = await runClips(["board"], projectPath);
    if (!result || !Array.isArray(result.lanes) || !Array.isArray(result.goals)) throw new Error("Clips returned an invalid board response.");
    return result;
  }

  async function viewRecord(ref, projectPath) {
    if (!safeId(ref) || !ref.startsWith("#")) throw new Error("viewRecord requires a full Clips record reference.");
    return runClips(["view", ref], projectPath);
  }

  async function recordCommand(args, projectPath) {
    const family = commandFamily(args);
    return runClips(args, projectPath, { parse: true, family });
  }

  async function listSessions(projectPath) {
    const context = await gitContext(projectPath);
    appSessionVisibilityVerified = await isAppSessionVerified();
    const sdkClient = await getClient();
    const [metadata, bindings] = await Promise.all([sdkClient.listSessions(), listBindings()]);
    const bindingById = new Map(bindings.map((binding) => [binding.session_id, binding]));
    const entries = [];
    for (const session of metadata) {
      const binding = bindingById.get(session.sessionId);
      const sessionRoot = session.context?.gitRoot || session.context?.workingDirectory;
      if (!sessionRoot) continue;
      let sessionContext;
      try { sessionContext = await gitContext(sessionRoot); } catch { continue; }
      if (sessionContext.commonDir !== context.commonDir) continue;
      if (binding && (binding.repository_id !== context.commonDir || binding.project_id !== context.commonDir)) continue;
      entries.push(normalizeSession(session, binding ?? null, appSessionVisibilityVerified));
    }
    return {
      sessions: entries.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "")),
      appSessionVisibilityVerified,
      hostIdConfigured: Boolean(hostId),
    };
  }

  async function resume(sessionId) {
    if (!safeId(sessionId)) throw new Error("A Copilot session ID is required.");
    const sdkClient = await getClient();
    return sdkClient.resumeSession(sessionId, {});
  }

  async function steerSession(sessionId, prompt) {
    if (!await isAppSessionVerified()) {
      throw new Error("Copilot App session visibility and user steering have not been verified on this host; direct session steering is disabled.");
    }
    if (!safePrompt(prompt)) throw new Error("A valid prompt is required to steer a Copilot session (1–100,000 characters; ordinary line breaks are allowed).");
    const session = await resume(sessionId);
    await session.send(prompt);
  }

  async function launchRecord(input) {
    if (!await isAppSessionVerified()) {
      throw new Error("Copilot App visibility and user steering for SDK-created sessions have not been verified on this host; launch is disabled.");
    }
    validateSessionConfig(input);
    const context = await gitContext(input.projectPath);
    const record = await viewRecord(input.ref, context.cwd);
    const kind = record?.kind || (input.ref.startsWith("#l") ? "lane" : input.ref.includes("#t") ? "task" : "goal");
    if (kind === "lane" && !hostId) {
      throw new Error("Cannot manage this Lane: the Copilot host exposes no verified host ID. Configure an observed host ID before claiming ownership.");
    }
    const release = await acquireRecordLaunchLock(context.commonDir, input.ref);
    try { return await launchRecordUnlocked(input, context, record, kind); }
    finally { await release(); }
  }

  async function launchRecordUnlocked(input, context, record, kind) {
    const sdkClient = await getClient();
    const bindings = await listBindings();
    const bound = bindings.filter((binding) => binding.repository_id === context.commonDir && binding.project_id === context.commonDir && binding.ref === input.ref && binding.kind === kind);

    if (kind === "lane") {
      const inspected = await recordCommand(["lane", "manager", "inspect", input.ref], context.cwd);
      const owners = Array.isArray(inspected?.owners) ? inspected.owners : [];
      if (owners.length > 0) {
        const mine = owners.find((owner) => owner.runtime === "copilot-sdk" && owner.host === hostId);
        if (!mine) throw new Error(`Lane ${input.ref} already has a manager. Contact its recorded owner; this launch will not replace or bypass that claim.`);
        const session = await sdkClient.getSessionMetadata(mine.session_id);
        if (!session) throw new Error(`Lane ${input.ref} remains claimed by Copilot session ${mine.session_id}, which is unavailable. Resolve the existing claim with explicit authorization; do not launch a replacement.`);
        const existingBinding = await readBinding(mine.session_id);
        if (!existingBinding || existingBinding.session_id !== mine.session_id || existingBinding.repository_id !== context.commonDir ||
          existingBinding.project_id !== context.commonDir || existingBinding.ref !== input.ref || existingBinding.kind !== "lane") {
          throw new Error(`Lane ${input.ref} is claimed by session ${mine.session_id}, but its local project/record/kind binding cannot be verified. Refusing to steer or relabel it.`);
        }
        const ownerRoot = session.context?.gitRoot || session.context?.workingDirectory;
        let ownerContext;
        try { ownerContext = ownerRoot ? await gitContext(ownerRoot) : null; } catch { ownerContext = null; }
        if (!ownerContext || ownerContext.commonDir !== context.commonDir) {
          throw new Error(`Lane ${input.ref} is claimed by session ${mine.session_id}, but its observed Git project does not match. Refusing to steer it.`);
        }
        const handle = await sdkClient.resumeSession(mine.session_id, {});
        const binding = existingBinding;
        await handle.send(input.prompt);
        return normalizeSession(session, binding, appSessionVisibilityVerified);
      }
    }

    if (bound.length > 1) throw new Error(`Several Copilot sessions are already bound to ${input.ref}; choose one with Go to agent before steering.`);
    if (bound.length === 1) {
      const existing = await sdkClient.getSessionMetadata(bound[0].session_id);
      if (existing) {
        const existingRoot = existing.context?.gitRoot || existing.context?.workingDirectory;
        let existingProject;
        try { existingProject = existingRoot ? await gitContext(existingRoot) : null; } catch { existingProject = null; }
        if (!existingProject || existingProject.commonDir !== context.commonDir || bound[0].repository_id !== context.commonDir ||
          bound[0].project_id !== context.commonDir || bound[0].ref !== input.ref || bound[0].kind !== kind) {
          throw new Error(`Existing Copilot session ${bound[0].session_id} cannot be verified against ${input.ref}, its record kind, and this Git project. Refusing to steer it.`);
        }
        const handle = await sdkClient.resumeSession(bound[0].session_id, {});
        await handle.send(input.prompt);
        return normalizeSession(existing, bound[0]);
      }
    }

    const title = (input.title?.trim() || `${input.ref} ${record?.title || "Clips work"}`)
      .replace(/[\u0000-\u001f\u007f"]/g, " ").trim().slice(0, 100);
    const config = { workingDirectory: context.cwd, name: title || input.ref };
    if (input.model) config.model = input.model;
    if (input.reasoningEffort) config.reasoningEffort = input.reasoningEffort;
    const session = await sdkClient.createSession(config);
    const host = hostId;
    const binding = {
      version: 1,
      repository_id: context.commonDir,
      project_id: context.commonDir,
      project_root: context.root,
      ref: input.ref,
      kind,
      session_id: session.sessionId,
      host,
      runtime: "copilot-sdk",
      host_identity_source: hostIdentitySource,
      host_identity_authenticated: false,
      created_at: new Date().toISOString(),
    };

    if (kind === "lane") {
      const inspected = await recordCommand(["lane", "manager", "inspect", input.ref], context.cwd);
      const claim = {
        expected_revision: inspected.revision ?? 0,
        actor: {
          host,
          runtime: "copilot-sdk",
          session_id: session.sessionId,
          host_identity_source: hostIdentitySource,
          host_identity_authenticated: false,
          contact: `Copilot session ${session.sessionId} (${appSessionUrl(session.sessionId)})`,
        },
      };
      try {
        await recordCommand(["lane", "manager", "claim", input.ref, JSON.stringify(claim)], context.cwd);
      } catch (error) {
        throw new Error(`Lane claim failed after creating idle Copilot session ${session.sessionId}; no manager prompt was sent. ${errorMessage(error)}`);
      }
    }

    // Keep a binding before send. If delivery fails, users can resume the exact
    // actual session and a Lane claim remains visibly attached to its owner.
    await writeBinding(binding);
    try { await session.send(input.prompt); }
    catch (error) {
      throw new Error(`Copilot session ${session.sessionId} was created${kind === "lane" ? " and retains the Lane claim" : ""}, but the prompt was not delivered: ${errorMessage(error)}. Resume this session; do not create a replacement.`);
    }
    return normalizeSession({
      sessionId: session.sessionId,
      startTime: new Date(), modifiedTime: new Date(),
      context: { workingDirectory: context.cwd, gitRoot: context.root },
    }, binding, appSessionVisibilityVerified);
  }

  return {
    listBoard,
    viewRecord,
    recordCommand,
    listSessions,
    launchRecord,
    steerSession,
    appSessionUrl,
    async hostCapabilities() {
      appSessionVisibilityVerified = await isAppSessionVerified();
      return {
        appSessionVisibilityVerified,
        hostIdConfigured: Boolean(hostId),
        hostIdentitySource,
        hostIdentityAuthenticated: false,
        verificationSource: appSessionVisibilityVerified ? "user-local Copilot App open-and-steer check" : null,
      };
    },
    recordHostVerification,
    async close() {
      if (ownsClient && client && started) await client.stop();
      client = injectedClient;
      started = false;
    },
  };
}

export { commandFamily };
