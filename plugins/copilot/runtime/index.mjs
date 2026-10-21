import { execFile as nodeExecFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const execFile = promisify(nodeExecFile);
const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const requireFromRuntime = createRequire(import.meta.url);
const loadedSourceHash = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
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

/**
 * Resolve the SDK's locked platform runtime from this extension package. The
 * Copilot App exposes its own SDK through COPILOT_SDK_PATH; that SDK's bundled
 * resolver searches beside the App bundle and cannot see the extension's npm
 * optional dependency. The public SDK accepts an explicit RuntimeConnection
 * executable, so use the matching executable from this extension's install.
 */
export function resolveSdkRuntimeExecutable({
  platform = process.platform,
  arch = process.arch,
  musl = platform === 'linux' && process.report?.getReport()?.header?.glibcVersionRuntime === undefined,
  resolvePackage = (specifier) => requireFromRuntime.resolve(specifier),
  exists = existsSync,
} = {}) {
  if (!["darwin", "linux", "win32"].includes(platform) || !["arm64", "x64"].includes(arch)) {
    throw new Error(`The Copilot SDK has no supported runtime package for ${platform}-${arch}.`);
  }
  const runtimePlatform = `${platform === 'linux' && musl ? 'linuxmusl' : platform}-${arch}`;
  const packageName = `@github/copilot-sdk-${runtimePlatform}`;
  let packageJson;
  try {
    packageJson = resolvePackage(`${packageName}/package.json`);
  } catch (error) {
    throw new Error(`Could not resolve ${packageName} from the installed Lanes extension. Run node scripts/install-copilot.js to install its locked platform package.`, { cause: error });
  }
  const executable = path.join(path.dirname(packageJson), "prebuilds", runtimePlatform, platform === "win32" ? "copilot-runtime.exe" : "copilot-runtime");
  if (!exists(executable)) {
    throw new Error(`${packageName} is installed without its Copilot runtime executable at ${executable}. Reinstall with node scripts/install-copilot.js.`);
  }
  return executable;
}

function errorMessage(error) {
  const stderr = typeof error?.stderr === "string" ? error.stderr.trim() : "";
  return stderr || (error instanceof Error ? error.message : String(error));
}

async function withTimeout(operation, message, timeout = 5000) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Extension hosts may embed JavaScript in the Copilot executable. execPath is
// therefore not necessarily an interpreter that accepts a JS entry point.
export async function resolveNodeExecutable({
  configured = process.env.LANES_NODE_PATH || process.env.CLIPS_NODE_PATH,
  executable = process.execPath,
  env = process.env,
  run = execFile,
} = {}) {
  const candidates = configured ? [configured] : [
    env.npm_node_execpath,
    /^(node|nodejs)(\.exe)?$/i.test(path.basename(executable)) ? executable : null,
    'node', '/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node',
  ];
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      const version = await run(candidate, ['--version'], { timeout: 5000, maxBuffer: 4096 });
      if (!/^v\d+\.\d+\.\d+\s*$/.test(version.stdout)) continue;
      const { stdout } = await run(candidate, ['-p', 'JSON.stringify({node:process.versions.node,execPath:process.execPath})'], { timeout: 5000, maxBuffer: 4096 });
      const value = JSON.parse(stdout.trim());
      if (Number(value.node?.split('.')[0]) >= 18 && path.isAbsolute(value.execPath)) return value.execPath;
    } catch { /* Try the next installed interpreter, never the embedded host. */ }
  }
  throw new Error(`Node.js 18 or newer is required to run Lanes.${configured ? ` LANES_NODE_PATH/CLIPS_NODE_PATH (${configured}) is not a working Node interpreter.` : ''} Install Node or set LANES_NODE_PATH to its absolute executable path, then reload the extension.`);
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
    throw new Error(`Lanes returned invalid JSON for ${description}.`);
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
    throw new Error(`Unsupported Lanes command family: ${family}`);
  }
  return family;
}

function isReadCommand(args) {
  return args[0] === "board" || args[0] === "view" || args[0] === "history" ||
    args[0] === "attachment" && args[1] === "read" && args.length === 4 ||
    args[0] === "lane" && (args[1] === "list" || args[1] === "show" || args[1] === "manager" && ["list", "inspect"].includes(args[2])) ||
    args[0] === "component" && ["list", "show"].includes(args[1]) ||
    args[0] === "track" && ["list", "show"].includes(args[1]) ||
    args[0] === "label" && args[1] === "list" ||
    args[0] === "task" && args[1] === "show";
}

function normalizeSession(metadata, binding, { appSessionVisibilityVerified = false, joinedForegroundSession = false } = {}) {
  const context = metadata.context ?? {};
  const sessionId = metadata.sessionId;
  return {
    id: sessionId,
    sessionId,
    runtime: "copilot-sdk",
    workingDirectory: context.workingDirectory ?? context.cwd ?? null,
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
    name: metadata.name ?? null,
    status: "unknown",
    workspaceId: null,
    steerable: joinedForegroundSession,
    sdkSteerable: true,
    joined: joinedForegroundSession,
    appVisible: appSessionVisibilityVerified ? "verified_by_host_check" : "unverified",
    parentage: "unknown",
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
 * All planning mutations go through the canonical Lanes CLI; no journal files
 * are read or written here.
 */
export async function createClipsRuntime(options = {}) {
  const diagnostic = (event) => options.onDiagnostic?.({ ...event, pid: process.pid, processExecutable: process.execPath, runtimeSourceSha256: loadedSourceHash });
  const injectedClient = options.client;
  const hostSession = options.hostSession ?? null;
  if (hostSession && (!safeId(hostSession.sessionId) || typeof hostSession.send !== "function")) {
    throw new Error("hostSession must be the actual session returned by Copilot SDK joinSession().");
  }
  const cliRunner = options.cliRunner ?? ((bin, args, cwd) => execFile(bin, args, { cwd, maxBuffer: 8 * 1024 * 1024 }));
  const copilotHome = process.env.COPILOT_HOME || path.join(os.homedir(), ".copilot");
  const dataRoot = options.dataRoot ?? path.join(copilotHome, "clips-runtime");
  let client = injectedClient;
  let ownsClient = false;
  let started = false;
  let clientStart;
  let nodeExecutable;
  const nodePath = () => nodeExecutable ??= resolveNodeExecutable({ configured: options.nodePath ?? process.env.LANES_NODE_PATH ?? process.env.CLIPS_NODE_PATH });
  const configuredHostId = options.hostId ?? process.env.LANES_COPILOT_HOST_ID ?? process.env.CLIPS_COPILOT_HOST_ID;
  const hostId = safeId(configuredHostId) ? configuredHostId.trim() : null;
  const hostIdentitySource = hostId ? (options.hostId ? "runtime option" : process.env.LANES_COPILOT_HOST_ID ? "LANES_COPILOT_HOST_ID" : "CLIPS_COPILOT_HOST_ID") : null;
  let recordSendQueue = Promise.resolve();
  let appSessionVisibilityVerified = false;
  const capabilityFile = path.join(dataRoot, "host-capabilities.json");

  async function getClient() {
    if (!client) {
      const sdk = options.loadSdk ? await options.loadSdk() : await import("@github/copilot-sdk");
      const clientOptions = {
        connection: sdk.RuntimeConnection.forStdio({ path: (options.runtimeExecutableResolver ?? resolveSdkRuntimeExecutable)() }),
      };
      if (process.env.COPILOT_HOME) clientOptions.baseDirectory = copilotHome;
      client = new sdk.CopilotClient(clientOptions);
      ownsClient = true;
    }
    if (!started) {
      if (!clientStart) {
        clientStart = withTimeout(client.start(), "Copilot session catalog startup timed out. The Lanes board is still available.")
          .then(() => { started = true; })
          .catch(async (error) => {
            if (ownsClient) {
              try { await withTimeout(client.stop(), "Stopping the unavailable Copilot session catalog timed out."); }
              catch (stopError) { diagnostic({ event: 'clips.catalog.stop_failed', message: errorMessage(stopError) }); }
            }
            throw error;
          });
      }
      await clientStart;
    }
    return client;
  }

  async function cliPath(projectPath) {
    if (options.cliPath) return options.cliPath.endsWith(".js")
      ? { bin: await nodePath(), prefix: [path.resolve(options.cliPath)] }
      : { bin: options.cliPath, prefix: [] };
    const configured = (process.env.LANES_CLI_PATH || process.env.CLIPS_CLI_PATH)?.trim();
    if (configured) {
      return configured.endsWith(".js")
        ? { bin: await nodePath(), prefix: [path.resolve(configured)] }
        : { bin: configured, prefix: [] };
    }
    const local = path.join(moduleRoot, "src", "cli.js");
    if (existsSync(local)) return { bin: await nodePath(), prefix: [local] };
    const candidates = ["lanes", path.join(os.homedir(), ".local", "bin", "lanes"), "/opt/homebrew/bin/lanes", "/usr/local/bin/lanes",
      "clips", path.join(os.homedir(), ".local", "bin", "clips"), "/opt/homebrew/bin/clips", "/usr/local/bin/clips"];
    for (const candidate of candidates) {
      try {
        await cliRunner(candidate, ["--version"], projectPath);
        return { bin: candidate, prefix: [] };
      } catch { /* continue */ }
    }
    throw new Error("Lanes CLI not found. Install Lanes or set LANES_CLI_PATH (legacy CLIPS_CLI_PATH is supported) to the maintained checkout's src/cli.js.");
  }

  async function runClips(args, projectPath, { parse = true } = {}) {
    const context = await gitContext(projectPath);
    const cli = await cliPath(context.cwd);
    const finalArgs = [...cli.prefix, ...args];
    if (isReadCommand(args) && !args.includes("--json")) finalArgs.push("--json");
    let result;
    try {
      result = await cliRunner(cli.bin, finalArgs, context.cwd);
      diagnostic({ event: 'clips.command.completed', projectPath: context.cwd, executable: cli.bin, command: args[0], ref: args[0] === 'view' ? args[1] : undefined });
    } catch (error) {
      const message = errorMessage(error);
      if (message.includes('No Lanes store')) throw new Error(`No Lanes store in the selected project (${context.cwd}). Choose an initialized Lanes project, or run lanes init there to create one. The canvas has not changed your project.`);
      throw new Error(`Lanes command failed in ${context.cwd}: ${message}`);
    }
    const output = asString(result?.stdout).trim();
    if (!output) return { success: true };
    if (!parse) return output;
    try { return JSON.parse(output); } catch { return output; }
  }

  async function bindingFile(binding) {
    const key = [binding.session_id, binding.repository_id, binding.ref, binding.kind].join("\0");
    return path.join(dataRoot, "bindings", `${sha256(key)}.json`);
  }

  async function writeBinding(binding) {
    const filename = await bindingFile(binding);
    await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
    const temporary = `${filename}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    try { await fs.rename(temporary, filename); }
    catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  }

  async function readHostCapabilities() {
    try {
      const value = JSON.parse(await fs.readFile(capabilityFile, "utf8"));
      return value.version === 1 && value.app_session?.verified === true &&
        safeId(value.app_session?.app_version) && safeId(value.app_session?.session_id) &&
        safeId(value.app_session?.verified_by) && value.app_session?.opened_in_app === true &&
        value.app_session?.steered_in_app === true ? value.app_session : null;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw new Error(`Copilot host capability setting is unreadable: ${errorMessage(error)}`);
    }
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
    appSessionVisibilityVerified = Boolean(await readHostCapabilities());
    return { appSessionVisibilityVerified, capabilityFile };
  }

  appSessionVisibilityVerified = Boolean(await readHostCapabilities());

  async function currentSession() {
    if (!hostSession) return null;
    // Read the joined runtime without changing its model or interaction mode.
    const snapshot = hostSession.rpc?.metadata?.snapshot
      ? await withTimeout(hostSession.rpc.metadata.snapshot(), "Current Copilot session metadata timed out.")
      : await (await getClient()).getSessionMetadata(hostSession.sessionId);
    if (!snapshot || snapshot.sessionId !== hostSession.sessionId) throw new Error('Joined session metadata does not match its actual session ID.');
    const readOptional = async (read) => {
      try { return read ? await withTimeout(read(), "Optional Copilot session metadata timed out.") : null; } catch { return null; }
    };
    const [workspace, model, activity] = await Promise.all([
      readOptional(hostSession.rpc?.workspaces?.getWorkspace),
      readOptional(hostSession.rpc?.model?.getCurrent),
      readOptional(hostSession.rpc?.metadata?.activity),
    ]);
    const result = {
      ...snapshot,
      context: snapshot.context ?? { workingDirectory: snapshot.workingDirectory, gitRoot: workspace?.workspace?.git_root, repository: workspace?.workspace?.repository, branch: workspace?.workspace?.branch },
      workspaceId: workspace?.workspace?.id ?? null,
      model: model ?? (snapshot.selectedModel ? { modelId: snapshot.selectedModel } : null),
      mode: snapshot.currentMode ?? null,
      status: typeof activity?.hasActiveWork === 'boolean' ? (activity.hasActiveWork ? 'running' : 'idle') : 'unknown',
    };
    diagnostic({ event: 'clips.session.observed', sessionId: result.sessionId, workingDirectory: result.context?.workingDirectory, workspaceId: result.workspaceId, model: result.model, mode: result.mode, status: result.status });
    return result;
  }

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
    if (!result || !Array.isArray(result.lanes) || !Array.isArray(result.goals)) throw new Error("Lanes returned an invalid board response.");
    return result;
  }

  async function viewRecord(ref, projectPath) {
    if (!safeId(ref) || !ref.startsWith("#")) throw new Error("viewRecord requires a full Lanes record reference.");
    return runClips(["view", ref], projectPath);
  }

  async function recordCommand(args, projectPath) {
    const family = commandFamily(args);
    return runClips(args, projectPath, { parse: true, family });
  }

  async function readAttachment(ref, attachmentId, projectPath) {
    if (typeof ref !== "string" || !/^#[\w.-]+(?:#[\w.-]+){0,2}$/.test(ref)) {
      throw new Error("readAttachment requires an exact current Lane, Goal, or Task reference.");
    }
    if (typeof attachmentId !== "string" || !/^att-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attachmentId)) {
      throw new Error("readAttachment requires a canonical attachment ID.");
    }
    const result = await runClips(["attachment", "read", ref, attachmentId], projectPath);
    if (result?.ref !== ref || result?.attachment?.id !== attachmentId || result?.attachment?.type !== "markdown") {
      throw new Error("Lanes returned a different record or attachment than requested.");
    }
    const display = { ...result.attachment };
    delete display.path;
    return display;
  }

  async function setCollaboration(enabled, projectPath) {
    if (typeof enabled !== "boolean") throw new Error("Collaboration must be explicitly enabled or disabled.");
    return runClips(["config", "collaboration", String(enabled)], projectPath);
  }

  async function listSessions(projectPath) {
    const context = await gitContext(projectPath);
    const hostVerification = await readHostCapabilities();
    appSessionVisibilityVerified = Boolean(hostVerification);
    const warnings = [];
    // The SDK convenience listSessions adapter drops explicit /rename names.
    const [catalog, bindings, joined] = await Promise.all([
      getClient().then((sdkClient) => withTimeout(
        sdkClient.rpc?.sessions?.list ? sdkClient.rpc.sessions.list({}).then(result => result.sessions) : sdkClient.listSessions(),
        "Copilot session catalog read timed out.", 10000,
      )).catch((error) => { warnings.push(`Other session metadata is unavailable: ${errorMessage(error)}`); return []; }),
      listBindings(),
      currentSession().catch((error) => { warnings.push(`Current session readback failed: ${errorMessage(error)}`); return null; }),
    ]);
    const metadata = joined ? [...catalog.filter((item) => item.sessionId !== joined.sessionId), { ...catalog.find(item => item.sessionId === joined.sessionId), ...joined }] : catalog;
    const contexts = new Map([[context.cwd, context], [context.root, context]]);
    const entries = [];
    for (const session of metadata) {
      const sessionBindings = bindings.filter((binding) => binding.session_id === session.sessionId);
      const sessionRoot = session.context?.gitRoot || session.context?.workingDirectory || session.context?.cwd;
      if (!sessionRoot) continue;
      if (!contexts.has(sessionRoot)) {
        try { contexts.set(sessionRoot, await gitContext(sessionRoot)); }
        catch { contexts.set(sessionRoot, null); }
      }
      const sessionContext = contexts.get(sessionRoot);
      if (!sessionContext) continue;
      if (sessionContext.commonDir !== context.commonDir) continue;
      const projectBindings = sessionBindings.filter((binding) => binding.repository_id === context.commonDir && binding.project_id === context.commonDir);
      const candidates = projectBindings.length > 0 ? projectBindings : [null];
      for (const binding of candidates) {
        const joinedForegroundSession = session.sessionId === hostSession?.sessionId;
        const verified = hostVerification?.session_id === session.sessionId;
        const normalized = normalizeSession(session, binding, { appSessionVisibilityVerified: verified, joinedForegroundSession });
        if (joinedForegroundSession && joined) Object.assign(normalized, { status: joined.status, workspaceId: joined.workspaceId, model: joined.model, mode: joined.mode });
        entries.push(normalized);
      }
    }
    return {
      sessions: entries.sort((a, b) => (b.modifiedAt ?? "").localeCompare(a.modifiedAt ?? "")),
      appSessionVisibilityVerified,
      hostIdConfigured: Boolean(hostId),
      warnings,
    };
  }

  async function steerSession(sessionId, prompt) {
    if (!safePrompt(prompt)) throw new Error("A valid prompt is required to steer a Copilot session (1–100,000 characters; ordinary line breaks are allowed).");
    if (sessionId === hostSession?.sessionId) {
      await hostSession.send(prompt);
      return;
    }
    throw new Error("Only the currently joined Copilot session can be steered from this canvas. Open the target session and its Lanes canvas. A prior visibility check is not a live host connection.");
  }

  async function launchRecord(input) {
    if (!hostSession) {
      throw new Error("This extension is not joined to a Copilot session. Open the Lanes canvas inside the intended session before sending work.");
    }
    validateSessionConfig(input);
    if (input.model !== undefined || input.reasoningEffort !== undefined) throw new Error('Work uses the current session model and settings. Change them in the host before sending work.');
    const context = await gitContext(input.projectPath);
    const record = await viewRecord(input.ref, context.cwd);
    if (!record || record.ref !== input.ref) throw new Error(`Lanes did not return the exact requested record ${input.ref}; refusing to bind a Copilot session to a different record.`);
    const lastPart = input.ref.split('#').at(-1);
    const expectedKind = /^l\d+$/.test(lastPart) ? 'lane' : /^t\d+$/.test(lastPart) ? 'task' : /^g\d+$/.test(lastPart) ? 'goal' : null;
    if (!expectedKind) throw new Error('Work requires a current Lane, Goal, or Task reference.');
    const kind = record.kind || expectedKind;
    if (kind !== expectedKind) throw new Error(`Lanes record ${input.ref} resolved to kind ${kind}, expected ${expectedKind}; refusing to bind a Copilot session.`);
    // Serialize metadata writes and prompt delivery, without a persistent
    // ownership lease or rejecting another explicitly requested record.
    const pending = recordSendQueue.then(() => sendRecord(input, context, kind));
    recordSendQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  async function sendRecord(input, context, kind) {
    const sessionId = hostSession.sessionId;
    const sessionMetadata = await currentSession();
    if (!sessionMetadata) throw new Error(`Joined Copilot App session ${sessionId} is missing from the SDK session catalog; refusing to bind work to an unverified session.`);
    const sessionRoot = sessionMetadata.context?.gitRoot || sessionMetadata.context?.workingDirectory;
    let sessionProject;
    try { sessionProject = sessionRoot ? await gitContext(sessionRoot) : null; } catch { sessionProject = null; }
    if (!sessionProject || sessionProject.commonDir !== context.commonDir) {
      throw new Error(`Joined Copilot App session ${sessionId} does not belong to this Git project; refusing to steer it.`);
    }
    const metadataApi = hostSession.rpc?.metadata;
    const host = hostId;
    const binding = {
      version: 1,
      repository_id: context.commonDir,
      project_id: context.commonDir,
      project_root: context.root,
      ref: input.ref,
      kind,
      session_id: sessionId,
      host,
      runtime: "copilot-sdk",
      host_identity_source: hostIdentitySource,
      host_identity_authenticated: false,
      created_at: new Date().toISOString(),
    };

    // Associations record the actual target, not exclusive work ownership.
    await writeBinding(binding);
    if (metadataApi?.updateClientMetadata && kind !== 'lane') {
      const expected = { 'clips/ref': input.ref, 'clips/project': context.commonDir, 'clips/kind': kind };
      await metadataApi.updateClientMetadata({ set: expected });
      const readback = await metadataApi.getClientMetadata();
      if (Object.entries(expected).some(([key, value]) => readback[key] !== value)) throw new Error('Joined session binding readback did not match. No prompt was sent.');
    }
    try { await hostSession.send(input.prompt); }
    catch (error) {
      throw new Error(`Copilot session ${sessionId} is associated with ${input.ref}, but the prompt was not delivered: ${errorMessage(error)}.`);
    }
    return normalizeSession(sessionMetadata, binding, { joinedForegroundSession: true });
  }

  return {
    currentSession,
    async diagnostics() {
      const current = await currentSession();
      return { pid: process.pid, parentPid: process.ppid, processExecutable: process.execPath, nodeExecutable: await nodePath(), runtimeSourceSha256: loadedSourceHash, currentSession: current, managementPolicy: "advisory", bindings: (await listBindings()).filter((binding) => binding.session_id === hostSession?.sessionId) };
    },
    listBoard,
    viewRecord,
    recordCommand,
    readAttachment,
    setCollaboration,
    async initializeProject(projectPath) {
      const result = await runClips(['init', '--store-only'], projectPath);
      if (result?.initialized !== true) throw new Error('Lanes did not confirm minimal store initialization. Use the maintained CLI with init --store-only support.');
      return result;
    },
    listSessions,
    launchRecord,
    steerSession,
    appSessionUrl,
    async hostCapabilities() {
      const hostVerification = await readHostCapabilities();
      appSessionVisibilityVerified = Boolean(hostVerification);
      return {
        appSessionVisibilityVerified,
        currentSessionId: hostSession?.sessionId ?? null,
        currentSessionJoined: Boolean(hostSession),
        canSendToCurrentSession: Boolean(hostSession),
        canCreateAppSession: false,
        parentage: 'unknown',
        managementPolicy: 'advisory',
        hostIdConfigured: Boolean(hostId),
        hostIdentityRequired: false,
        automaticLaneClaims: false,
        hostId,
        hostIdentitySource,
        hostIdentityAuthenticated: false,
        verificationSource: hostVerification ? "user-local Copilot App open-and-steer check" : null,
      };
    },
    recordHostVerification,
    async close() {
      if (ownsClient && client && started) await client.stop();
      client = injectedClient;
      started = false;
      clientStart = undefined;
    },
  };
}

export { commandFamily };
