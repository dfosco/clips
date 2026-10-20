import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { appSessionUrl, commandFamily, createClipsRuntime, resolveSdkRuntimeExecutable, resolveNodeExecutable } from "./index.mjs";

const clipsCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src/cli.js");
const tempDirs = [];
async function gitProject() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clips-copilot-runtime-"));
  tempDirs.push(dir);
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function clientFixture({ sessions = [], ownerResponse, onEvent = () => {}, sendGate } = {}) {
  const calls = [];
  const initial = [...sessions];
  if (!initial.some((item) => item.sessionId === "verification-session")) {
    initial.push({ sessionId: "verification-session", startTime: new Date(), modifiedTime: new Date(), context: {} });
  }
  const known = new Map(initial.map((item) => [item.sessionId, item]));
  let number = 0;
  return {
    calls,
    async start() { calls.push(["start"]); },
    async stop() { calls.push(["stop"]); return []; },
    async listSessions() { calls.push(["listSessions"]); return [...known.values()]; },
    async getSessionMetadata(id) { calls.push(["getSessionMetadata", id]); return known.get(id); },
    async resumeSession(id) {
      calls.push(["resumeSession", id]);
      const metadata = known.get(id);
      if (!metadata) throw new Error(`missing ${id}`);
      return { sessionId: id, async send(prompt) { calls.push(["send", id, prompt]); onEvent(["send", id, prompt]); if (sendGate) await sendGate; } };
    },
    async createSession(config) {
      calls.push(["createSession", config]);
      const sessionId = `real-session-${++number}`;
      onEvent(["create", sessionId]);
      const metadata = { sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: config.workingDirectory, gitRoot: config.workingDirectory } };
      known.set(sessionId, metadata);
      return { sessionId, async send(prompt) { calls.push(["send", sessionId, prompt]); onEvent(["send", sessionId, prompt]); if (sendGate) await sendGate; } };
    },
    ownerResponse,
  };
}

function joinedSessionFixture(sessionId, calls = [], { onEvent = () => {}, sendGate } = {}) {
  return {
    sessionId,
    async send(prompt) {
      calls.push(["hostSend", sessionId, prompt]);
      onEvent(["hostSend", sessionId, prompt]);
      if (sendGate) await sendGate;
    },
  };
}

async function tempData() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "clips-copilot-data-"));
  tempDirs.push(dir);
  return dir;
}

async function recordTestOnlyVerification(runtime) {
  return runtime.recordHostVerification({
    appVersion: "test-fixture-not-native-evidence",
    sessionId: "verification-session",
    verifiedBy: "automated-test-fixture",
    openedInApp: true,
    steeredInApp: true,
  });
}

async function writeTestBinding(dataRoot, sessionId, binding) {
  const dir = path.join(dataRoot, "bindings");
  await fs.mkdir(dir, { recursive: true });
  const name = createHash("sha256").update([sessionId, binding.repository_id, binding.ref, binding.kind].join("\0")).digest("hex");
  await fs.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ version: 1, session_id: sessionId, ...binding }));
}

function makeCliRunner({ record = { ref: "#g001", kind: "goal", title: "Test Goal" }, claim = { revision: 0, owners: [] }, calls = [] } = {}) {
  return async (_bin, args, cwd) => {
    calls.push({ args: [...args], cwd });
    const commandArgs = args[0]?.endsWith("src/cli.js") ? args.slice(1) : args;
    const family = commandArgs.slice(0, 3).join(" ");
    if (family.startsWith("view ")) return { stdout: `${JSON.stringify(record)}\n`, stderr: "" };
    if (family === "lane manager inspect") return { stdout: `${JSON.stringify(claim)}\n`, stderr: "" };
    if (family === "lane manager claim") return { stdout: `${JSON.stringify({ ...claim, revision: 1 })}\n`, stderr: "" };
    if (commandArgs[0] === "board") return { stdout: `${JSON.stringify({ lanes: [], goals: [] })}\n`, stderr: "" };
    return { stdout: "{\"success\":true}\n", stderr: "" };
  };
}

test("exposes supported app session links and rejects unsafe command families", () => {
  assert.equal(appSessionUrl("session one"), "ghapp://sessions/session%20one");
  assert.throws(() => appSessionUrl(""), /session ID/);
  assert.equal(commandFamily(["task", "create", "g1", "{}"]), "task create");
  assert.throws(() => commandFamily(["exec", "rm", "-rf", "."]), /Unsupported Clips command/);
  assert.throws(() => commandFamily(["task", "create", "--file", "/tmp/request.json"]), /external file/);
  const canvasCommands = [
    ["lane", "create", "{}"], ["lane", "status", "#l001", "in_progress"], ["lane", "#l001", "add", "#g001"],
    ["goal", "create", "{}"], ["goal", "status", "g1", "in_progress"],
    ["task", "create", "g1", "{}"], ["task", "status", "g1", "t01", "in_progress"],
    ["label", "list"], ["label", "create", "{}"], ["label", "edit", "bug", "{}"],
    ["label", "recolor", "bug", "#ff0000"], ["label", "delete", "bug"],
    ["label", "add", "#g001", "bug"], ["label", "remove", "#g001", "bug"],
  ];
  for (const args of canvasCommands) assert.doesNotThrow(() => commandFamily(args), args.join(" "));
});

test("resolves the locked SDK platform runtime package from the extension package", () => {
  const resolved = [];
  const executable = resolveSdkRuntimeExecutable({
    platform: "darwin",
    arch: "arm64",
    resolvePackage: (specifier) => {
      resolved.push(specifier);
      return "/extension/node_modules/@github/copilot-sdk-darwin-arm64/package.json";
    },
    exists: (filename) => filename === "/extension/node_modules/@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/copilot-runtime",
  });
  assert.deepEqual(resolved, ["@github/copilot-sdk-darwin-arm64/package.json"]);
  assert.equal(executable, "/extension/node_modules/@github/copilot-sdk-darwin-arm64/prebuilds/darwin-arm64/copilot-runtime");
  assert.throws(() => resolveSdkRuntimeExecutable({ platform: "aix", arch: "ppc64" }), /no supported runtime package/);
  assert.throws(() => resolveSdkRuntimeExecutable({
    platform: "darwin", arch: "arm64",
    resolvePackage: () => { throw new Error("not installed"); },
  }), /Run node scripts\/install-copilot.js/);
});

test("owned SDK client uses the locked extension runtime through public stdio connection", async () => {
  const project = await gitProject();
  const client = clientFixture();
  let clientOptions;
  const runtime = await createClipsRuntime({
    cliPath: "src/cli.js",
    cliRunner: makeCliRunner(),
    dataRoot: await tempData(),
    runtimeExecutableResolver: () => "/extension/copilot-runtime",
    loadSdk: async () => ({
      RuntimeConnection: { forStdio: ({ path: executable }) => ({ kind: "stdio", path: executable }) },
      CopilotClient: class {
        constructor(options) { clientOptions = options; return client; }
      },
    }),
  });
  await runtime.listSessions(project);
  assert.deepEqual(clientOptions.connection, { kind: "stdio", path: "/extension/copilot-runtime" });
  assert.equal(client.calls.some(([kind]) => kind === "start"), true);
  await runtime.close();
});

test("stalled catalog startup stops the owned runtime and preserves joined-session readback", async (t) => {
  const project = await gitProject();
  const canonicalProject = await fs.realpath(project);
  const client = clientFixture();
  client.start = async () => { client.calls.push(["start"]); await new Promise(() => {}); };
  const hostSession = {
    ...joinedSessionFixture("joined-app-session"),
    rpc: {
      metadata: {
        async snapshot() { return { sessionId: "joined-app-session", context: { workingDirectory: canonicalProject } }; },
        async activity() { return { hasActiveWork: false }; },
      },
    },
  };
  const runtime = await createClipsRuntime({
    hostSession,
    dataRoot: await tempData(),
    loadSdk: async () => ({
      RuntimeConnection: { forStdio: () => ({ kind: "stdio" }) },
      CopilotClient: class { constructor() { return client; } },
    }),
  });
  t.after(() => runtime.close());
  const result = await runtime.listSessions(project);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].id, hostSession.sessionId);
  assert.equal(result.sessions[0].status, "idle");
  assert.match(result.warnings.join(" "), /catalog startup timed out/);
  assert.equal(client.calls.filter(([kind]) => kind === "stop").length, 1);
  await runtime.listSessions(project);
  assert.equal(client.calls.filter(([kind]) => kind === "start").length, 1);
});

test("stalled catalog reads return a warning rather than blocking board state", async () => {
  const project = await gitProject();
  const client = clientFixture();
  client.listSessions = () => new Promise(() => {});
  const runtime = await createClipsRuntime({ client, dataRoot: await tempData() });
  const result = await runtime.listSessions(project);
  assert.deepEqual(result.sessions, []);
  assert.match(result.warnings.join(" "), /catalog read timed out/);
  await runtime.close();
});

test("session filtering resolves a shared directory once per catalog read", async (t) => {
  const project = await gitProject();
  const subdirectory = path.join(project, "source");
  await fs.mkdir(subdirectory);
  const client = clientFixture({ sessions: Array.from({ length: 200 }, (_, index) => ({
    sessionId: `saved-session-${index}`,
    context: { workingDirectory: subdirectory },
  })) });
  const runtime = await createClipsRuntime({ client, dataRoot: await tempData() });
  const realpath = fs.realpath;
  const reads = [];
  t.mock.method(fs, "realpath", (value) => { reads.push(value); return realpath(value); });
  const result = await runtime.listSessions(project);
  assert.equal(result.sessions.length, 200);
  assert.equal(reads.filter((value) => value === subdirectory).length, 1);
  await runtime.close();
});

test("board and record mutations use canonical CLI in the requested Git project", async () => {
  const project = await gitProject();
  const calls = [];
  const runtime = await createClipsRuntime({ cliPath: "src/cli.js", cliRunner: makeCliRunner({ calls }) });
  const board = await runtime.listBoard(project);
  assert.deepEqual(board, { lanes: [], goals: [] });
  const view = await runtime.viewRecord("#g001", project);
  assert.equal(view.ref, "#g001");
  const changed = await runtime.recordCommand(["task", "create", "g1", JSON.stringify({ title: "Small task" })], project);
  assert.deepEqual(changed, { success: true });
  const canonicalProject = await fs.realpath(project);
  assert.ok(calls.every((call) => call.cwd === canonicalProject));
  assert.ok(calls.some((call) => call.args.includes("--json")));
  await assert.rejects(runtime.recordCommand(["task", "create", "g1", "--file", "/tmp/other.json"], project), /external file/);
});

test("minimal initialization uses only the supported fixed CLI mode and requires explicit success", async () => {
  const project = await gitProject();
  const calls = []; let confirmed = true;
  const runtime = await createClipsRuntime({
    cliPath: "src/cli.js",
    cliRunner: async (_bin, args, cwd) => {
      calls.push({ args, cwd });
      return { stdout: JSON.stringify(confirmed ? { initialized: true, projectPath: cwd } : { success: true }) };
    },
  });
  assert.equal((await runtime.initializeProject(project)).initialized, true);
  assert.deepEqual(calls[0].args.slice(-2), ['init', '--store-only']);
  assert.equal(calls[0].cwd, await fs.realpath(project));
  await assert.rejects(runtime.recordCommand(['init', '--store-only'], project), /Unsupported Clips command family/);
  confirmed = false;
  await assert.rejects(runtime.initializeProject(project), /did not confirm minimal store initialization/);
  await runtime.close();
});

test("canonical Clips CLI adapter creates real isolated Goal and Task history", async () => {
  const project = await gitProject();
  execFileSync(process.execPath, [clipsCli, "init", "--skills-scope", "project"], { cwd: project, stdio: "ignore", env: { ...process.env, CLIPS_HOME: await tempData() } });
  const runtime = await createClipsRuntime({ cliPath: clipsCli });
  const goalResult = await runtime.recordCommand(["goal", "create", JSON.stringify({ title: "Adapter Goal", description: "Created through the canvas adapter." })], project);
  assert.equal(goalResult.success, true);
  const goalId = `g${String(goalResult.goal_id).replace(/^g/, "")}`;
  const taskResult = await runtime.recordCommand(["task", "create", goalId, JSON.stringify({ title: "Adapter Task", description: "Preserve a meaningful request." })], project);
  assert.equal(taskResult.success, true);
  const board = await runtime.listBoard(project);
  assert.equal(board.goals.length, 1);
  assert.equal(board.goals[0].tasks.length, 1);
  assert.equal(board.goals[0].tasks[0].title, "Adapter Task");
  const history = await runtime.recordCommand(["history", `#${goalId}#${taskResult.task_id}`], project);
  assert.ok(Array.isArray(history));
  assert.equal(history.some((event) => event.event === "task_created"), true);
});

test("Goal work uses the exact joined App session and durable local binding without creating another session", async () => {
  const project = await gitProject();
  const dataRoot = await tempData();
  const sessionId = "joined-app-session";
  const client = clientFixture({ sessions: [{ sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const hostCalls = [];
  const hostSession = joinedSessionFixture(sessionId, hostCalls);
  const runtime = await createClipsRuntime({ client, hostSession, cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot });
  const multilinePrompt = "Work on Goal\n\nUse the existing acceptance criteria.\nReturn the result and test evidence.";
  const launched = await runtime.launchRecord({ projectPath: project, ref: "#g001", prompt: multilinePrompt });
  assert.equal(launched.id, sessionId);
  assert.equal(launched.status, "unknown");
  assert.equal(launched.appVisible, "unverified");
  assert.equal(launched.joined, true);
  assert.equal(launched.workspaceId, null);
  const capability = await runtime.hostCapabilities();
  assert.equal(capability.currentSessionId, sessionId);
  assert.equal(capability.currentSessionJoined, true);
  assert.equal(capability.appSessionVisibilityVerified, false);
  assert.equal(capability.canSendToCurrentSession, true);
  const listed = await runtime.listSessions(project);
  const current = listed.sessions.find((session) => session.id === sessionId);
  assert.equal(current.steerable, true);
  assert.equal(current.status, "unknown");
  assert.deepEqual(hostCalls, [["hostSend", sessionId, multilinePrompt]]);
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
  assert.equal(client.calls.some(([kind]) => kind === "resumeSession"), false);
  const name = createHash("sha256").update([sessionId, await fs.realpath(execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()), "#g001", "goal"].join("\0")).digest("hex");
  const binding = JSON.parse(await fs.readFile(path.join(dataRoot, "bindings", `${name}.json`), "utf8"));
  assert.equal(binding.ref, "#g001");
  assert.equal(binding.repository_id, await fs.realpath(execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()));
});

test("Lane work goes to the actual joined session without acquiring or changing a claim", async () => {
  const project = await gitProject();
  const events = [];
  const sessionId = "joined-lane-manager";
  const client = clientFixture({ sessions: [{ sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const cliCalls = [];
  const baseRunner = makeCliRunner({ record: { ref: "#l001", kind: "lane", title: "Product" }, calls: cliCalls });
  const runner = async (...args) => { events.push(["cli", ...args[1].slice(-4)]); return baseRunner(...args); };
  const hostSession = joinedSessionFixture(sessionId, [], { onEvent: (event) => events.push(event) });
  const runtime = await createClipsRuntime({ client, hostSession, cliPath: "src/cli.js", cliRunner: runner, dataRoot: await tempData(), hostId: "observed-host-id" });
  const result = await runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate this Lane" });
  assert.equal(result.id, sessionId);
  assert.equal(cliCalls.some(({ args }) => args.includes("manager")), false);
  assert.ok(events.find((event) => event[0] === "hostSend" && event[1] === sessionId));
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
  assert.equal(client.calls.some(([kind]) => kind === "resumeSession"), false);
});

test("one joined App session keeps distinct bindings while managing multiple Lanes", async () => {
  const project = await gitProject();
  const sessionId = "multi-lane-app-session";
  const client = clientFixture({ sessions: [{ sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const hostCalls = [];
  const hostSession = joinedSessionFixture(sessionId, hostCalls);
  const claimRefs = [];
  const cliRunner = async (_bin, args) => {
    const commandArgs = args[0]?.endsWith("src/cli.js") ? args.slice(1) : args;
    if (commandArgs[0] === "view") {
      const ref = commandArgs[1];
      return { stdout: `${JSON.stringify({ ref, kind: "lane", title: `Lane ${ref}` })}\n`, stderr: "" };
    }
    if (commandArgs[0] === "lane" && commandArgs[1] === "manager" && commandArgs[2] === "inspect") return { stdout: `${JSON.stringify({ revision: 0, owners: [] })}\n`, stderr: "" };
    if (commandArgs[0] === "lane" && commandArgs[1] === "manager" && commandArgs[2] === "claim") {
      claimRefs.push(commandArgs[3]);
      return { stdout: `${JSON.stringify({ revision: 1, owners: [] })}\n`, stderr: "" };
    }
    throw new Error(`unexpected Clips invocation ${commandArgs.join(" ")}`);
  };
  const dataRoot = await tempData();
  const runtime = await createClipsRuntime({ client, hostSession, cliPath: "src/cli.js", cliRunner, dataRoot, hostId: "observed-host-id" });
  assert.equal((await runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate Lane 1" })).id, sessionId);
  assert.equal((await runtime.launchRecord({ projectPath: project, ref: "#l002", prompt: "Coordinate Lane 2" })).id, sessionId);
  assert.deepEqual(claimRefs, []);
  assert.equal(hostCalls.length, 2);
  assert.equal((await fs.readdir(path.join(dataRoot, "bindings"))).filter((name) => name.endsWith(".json")).length, 2);
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
});

test("pre-existing foreign Lane ownership does not block a send or get rewritten", async () => {
  const project = await gitProject();
  const sessionId = "joined-attempted-manager";
  const client = clientFixture({ sessions: [{ sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const hostSession = joinedSessionFixture(sessionId);
  const calls = [];
  const runner = makeCliRunner({ record: { ref: "#l001", kind: "lane" }, claim: { revision: 4, owners: [{ host: "other-host", runtime: "copilot-sdk", session_id: "other-session" }] }, calls });
  const runtime = await createClipsRuntime({ client, hostSession, cliPath: "src/cli.js", cliRunner: runner, dataRoot: await tempData(), hostId: "observed-host-id" });
  assert.equal((await runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "coordinate" })).id, sessionId);
  assert.equal(calls.some(({ args }) => args.includes("manager")), false);
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
  assert.equal(client.calls.some(([kind]) => kind === "resumeSession"), false);
});

test("an existing Lane claim never bypasses the actual session Git-project check", async () => {
  const project = await gitProject();
  const differentProject = await gitProject();
  const dataRoot = await tempData();
  const manager = { sessionId: "claimed-manager", startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: differentProject, gitRoot: differentProject } };
  const client = clientFixture({ sessions: [manager] });
  const hostSession = joinedSessionFixture("claimed-manager");
  const runner = makeCliRunner({ record: { ref: "#l001", kind: "lane" }, claim: { revision: 3, owners: [{ host: "host-1", runtime: "copilot-sdk", session_id: "claimed-manager" }] } });
  await writeTestBinding(dataRoot, "claimed-manager", {
    repository_id: await fs.realpath(execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()),
    project_id: await fs.realpath(execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()),
    ref: "#l001", kind: "lane",
  });
  const runtime = await createClipsRuntime({ client, hostSession, cliPath: "src/cli.js", cliRunner: runner, dataRoot, hostId: "host-1" });
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate" }), /does not belong to this Git project/);
  assert.equal(client.calls.some(([kind, id]) => kind === "send" && id === "claimed-manager"), false);
});

test("Lane work needs no host identity and does not fabricate one", async () => {
  const project = await gitProject();
  const sessionId = "joined-without-configured-host";
  const client = clientFixture({ sessions: [{ sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const hostSession = joinedSessionFixture(sessionId);
  const runtime = await createClipsRuntime({ client, hostSession, cliPath: "src/cli.js", cliRunner: makeCliRunner({ record: { ref: "#l001", kind: "lane" } }), dataRoot: await tempData() });
  const sent = await runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate" });
  assert.equal(sent.hostId, null);
  const capability = await runtime.hostCapabilities();
  assert.equal(capability.hostIdConfigured, false);
  assert.equal(capability.hostIdentityRequired, false);
  assert.equal(capability.automaticLaneClaims, false);
  assert.equal(capability.managementPolicy, "advisory");
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
  assert.equal(client.calls.some(([kind]) => kind === "resumeSession"), false);
});

test("configured host metadata is advisory and does not assert authentication", async () => {
  const project = await gitProject();
  const sessionId = "native-joined-manager";
  const metadata = { sessionId, context: { workingDirectory: project } };
  const client = clientFixture({ sessions: [metadata] });
  const hostCalls = [];
  const cliCalls = [];
  const runtime = await createClipsRuntime({
    client,
    hostSession: joinedSessionFixture(sessionId, hostCalls),
    dataRoot: await tempData(),
    cliPath: "src/cli.js",
    cliRunner: makeCliRunner({ record: { ref: "#l001", kind: "lane" }, claim: { revision: 7, owners: [] }, calls: cliCalls }),
    hostId: "observed-host-id",
  });
  const capability = await runtime.hostCapabilities();
  assert.equal(capability.hostIdConfigured, true);
  assert.equal(capability.hostId, "observed-host-id");
  assert.equal(capability.hostIdentitySource, "runtime option");
  assert.equal(capability.hostIdentityAuthenticated, false);
  await runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate" });
  await runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Again" });
  assert.equal(hostCalls.length, 2);
  assert.equal(cliCalls.some(({ args }) => args.includes("manager")), false);
});

test("another session association and an obsolete launch lock do not reserve work", async () => {
  const project = await gitProject();
  const sessionId = "current";
  const client = clientFixture({ sessions: [{ sessionId, context: { workingDirectory: project } }] });
  const dataRoot = await tempData();
  const repositoryId = await fs.realpath(path.join(project, ".git"));
  await writeTestBinding(dataRoot, "earlier", { repository_id: repositoryId, project_id: repositoryId, ref: "#g001", kind: "goal" });
  const key = createHash("sha256").update(`${repositoryId}\0#g001`).digest("hex");
  await fs.mkdir(path.join(dataRoot, "launch-locks"));
  const oldLock = path.join(dataRoot, "launch-locks", `${key}.lock`);
  await fs.writeFile(oldLock, "historical policy lock");
  const runtime = await createClipsRuntime({ client, hostSession: joinedSessionFixture(sessionId), dataRoot, cliRunner: makeCliRunner() });
  assert.equal((await runtime.launchRecord({ projectPath: project, ref: "#g001", prompt: "Continue" })).id, sessionId);
  assert.equal(await fs.readFile(oldLock, "utf8"), "historical policy lock");
  assert.equal((await fs.readdir(path.join(dataRoot, "bindings"))).length, 2);
});

test("Lane Goal and Task Run always sends to the actual joined session despite other bindings and current activity", async () => {
  for (const [kind, ref] of [["lane", "#l001"], ["goal", "#alice#g001"], ["task", "#alice#g001#t01"]]) {
    const project = await gitProject();
    const root = await fs.realpath(project);
    const repositoryId = await fs.realpath(path.join(project, ".git"));
    const dataRoot = await tempData();
    const current = { sessionId: "current", context: { workingDirectory: root, gitRoot: root } };
    const client = clientFixture({ sessions: [current, { sessionId: "earlier", context: current.context, status: "running" }] });
    const foreign = { repository_id: repositoryId, project_id: repositoryId, ref, kind };
    await writeTestBinding(dataRoot, "earlier", foreign);
    const hostCalls = [];
    const host = {
      ...joinedSessionFixture("current", hostCalls),
      rpc: { metadata: { snapshot: async () => current, activity: async () => ({ hasActiveWork: true }) } },
    };
    const runtime = await createClipsRuntime({ client, hostSession: host, dataRoot, cliRunner: makeCliRunner({ record: { ref, kind, title: kind, manager_claim: { owners: [{ runtime: "copilot-sdk", session_id: "earlier" }] } } }) });
    try {
      const prompt = `Run ${kind} ${ref}`;
      assert.equal((await runtime.launchRecord({ projectPath: project, ref, prompt })).id, "current");
      assert.deepEqual(hostCalls, [["hostSend", "current", prompt]]);
      assert.equal(client.calls.some(([action]) => ["createSession", "resumeSession", "send"].includes(action)), false);
      const listed = (await runtime.listSessions(project)).sessions;
      assert.equal(listed.find(session => session.id === "current").status, "running", "actual joined activity remains observed");
      assert.equal(listed.find(session => session.id === "earlier").status, "unknown", "catalog status is not invented live activity");
      const bindings = await Promise.all((await fs.readdir(path.join(dataRoot, "bindings"))).map(name => fs.readFile(path.join(dataRoot, "bindings", name), "utf8").then(JSON.parse)));
      assert.equal(bindings.length, 2);
      assert.ok(bindings.some(binding => binding.session_id === "earlier" && binding.ref === ref));
      assert.ok(bindings.some(binding => binding.session_id === "current" && binding.ref === ref));
    } finally {
      await runtime.close();
    }
  }
});

test("unavailable optional Lane claim commands cannot block current-session delivery", async () => {
  const project = await gitProject();
  const sessionId = "joined-claim-conflict";
  const client = clientFixture({ sessions: [{ sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const hostCalls = [];
  const hostSession = joinedSessionFixture(sessionId, hostCalls);
  const cliRunner = async (_bin, args) => {
    const commandArgs = args[0]?.endsWith("src/cli.js") ? args.slice(1) : args;
    if (commandArgs[0] === "view") return { stdout: `${JSON.stringify({ ref: "#l001", kind: "lane", title: "Product" })}\n`, stderr: "" };
    if (commandArgs[0] === "lane" && commandArgs[1] === "manager" && commandArgs[2] === "inspect") return { stdout: `${JSON.stringify({ revision: 0, owners: [] })}\n`, stderr: "" };
    if (commandArgs[0] === "lane" && commandArgs[1] === "manager" && commandArgs[2] === "claim") throw new Error("revision conflict");
    throw new Error(`unexpected Clips invocation ${commandArgs.join(" ")}`);
  };
  const runtime = await createClipsRuntime({ client, hostSession, cliPath: "src/cli.js", cliRunner, dataRoot: await tempData(), hostId: "observed-host-id" });
  assert.equal((await runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate" })).id, sessionId);
  assert.equal(hostCalls.length, 1);
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
  assert.equal(client.calls.some(([kind]) => kind === "resumeSession"), false);
});

test("record launch is unavailable when the extension is not joined to a foreground App session", async () => {
  const project = await gitProject();
  const client = clientFixture();
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot: await tempData() });
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#g001", prompt: "Do work" }), /not joined to a Copilot session/);
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
});

test("record launch rejects a Clips view response with a mismatched reference or kind", async () => {
  const project = await gitProject();
  const sessionId = "joined-record-binding-check";
  const client = clientFixture({ sessions: [{ sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const hostSession = joinedSessionFixture(sessionId);
  const runtime = await createClipsRuntime({
    client,
    hostSession,
    cliPath: "src/cli.js",
    cliRunner: makeCliRunner({ record: { ref: "#g001", kind: "task", title: "Mismatched" } }),
    dataRoot: await tempData(),
  });
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#g001", prompt: "Do work" }), /expected goal/);
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
  assert.equal(client.calls.some(([kind]) => kind === "resumeSession"), false);
});

test("separate adapters do not enforce a durable exclusive launch lease", async () => {
  const project = await gitProject();
  const dataRoot = await tempData();
  let releaseSend;
  let markSendEntered;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const sendEntered = new Promise((resolve) => { markSendEntered = resolve; });
  const sessionId = "locked-app-session";
  const metadata = { sessionId, startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } };
  const clientA = clientFixture({ sessions: [metadata] });
  const clientB = clientFixture({ sessions: [metadata] });
  const hostSessionA = joinedSessionFixture(sessionId, [], { sendGate, onEvent: (event) => { if (event[0] === "hostSend") markSendEntered(); } });
  const hostSessionB = joinedSessionFixture(sessionId);
  const options = { cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot };
  const runtimeA = await createClipsRuntime({ ...options, client: clientA, hostSession: hostSessionA });
  const runtimeB = await createClipsRuntime({ ...options, client: clientB, hostSession: hostSessionB });
  const first = runtimeA.launchRecord({ projectPath: project, ref: "#g001", prompt: "first" });
  await sendEntered;
  assert.equal((await runtimeB.launchRecord({ projectPath: project, ref: "#g001", prompt: "second" })).id, sessionId);
  releaseSend();
  assert.equal((await first).id, sessionId);
  assert.equal(clientA.calls.filter(([kind]) => kind === "createSession").length, 0);
  assert.equal(clientB.calls.some(([kind]) => kind === "createSession"), false);
});

test("session discovery is scoped by canonical shared Git directory and never invents status", async () => {
  const project = await gitProject();
  const outside = await gitProject();
  const client = clientFixture({ sessions: [
    { sessionId: "in-scope", startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } },
    { sessionId: "out-of-scope", startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: outside, gitRoot: outside } },
  ] });
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot: await tempData() });
  const { sessions } = await runtime.listSessions(project);
  assert.deepEqual(sessions.map((session) => session.id), ["in-scope"]);
  assert.equal(sessions[0].status, "unknown");
  assert.equal(sessions[0].steerable, false);
  assert.equal(sessions[0].sdkSteerable, true);
  assert.equal(sessions[0].appVisible, "unverified");
});

test("public catalog keeps explicit names and merges the joined snapshot without using prompt summaries as names", async () => {
  const project = await gitProject();
  const root = await fs.realpath(project);
  const elsewhere = await gitProject();
  const prompt = "You are the ordinary dev execution owner. Read the full Goal and instructions before acting.";
  const client = clientFixture();
  let catalogReads = 0;
  client.rpc = { sessions: { async list(input) {
    assert.deepEqual(input, {});
    catalogReads++;
    return { sessions: [
      { sessionId: "current", name: "Current engineering", summary: prompt, context: { cwd: root } },
      { sessionId: "named", name: "Security migration plans", summary: prompt, context: { cwd: root } },
      { sessionId: "other-project", name: "Unrelated project", context: { cwd: elsewhere } },
    ] };
  } } };
  const host = {
    ...joinedSessionFixture("current"),
    rpc: { metadata: { snapshot: async () => ({ sessionId: "current", context: { workingDirectory: root } }), activity: async () => ({ hasActiveWork: false }) } },
  };
  const runtime = await createClipsRuntime({ client, hostSession: host, dataRoot: await tempData() });
  try {
    const { sessions } = await runtime.listSessions(project);
    assert.equal(catalogReads, 1);
    assert.equal(client.calls.some(([kind]) => kind === "listSessions"), false);
    assert.equal(sessions.length, 2);
    const current = sessions.find(session => session.id === "current");
    assert.equal(current.name, "Current engineering");
    assert.equal(current.joined, true); assert.equal(current.status, "idle");
    const named = sessions.find(session => session.id === "named");
    assert.equal(named.name, "Security migration plans");
    assert.equal(named.workingDirectory, root);
    assert.equal(named.summary, prompt, "summary stays metadata, not a fabricated name");
    assert.equal(named.status, "unknown");
  } finally {
    await runtime.close();
  }
});

test("steering the joined App session uses its exact host handle", async () => {
  const metadata = { sessionId: "selected-session", startTime: new Date(), modifiedTime: new Date(), context: {} };
  const client = clientFixture({ sessions: [metadata] });
  const hostCalls = [];
  const hostSession = joinedSessionFixture("selected-session", hostCalls);
  const runtime = await createClipsRuntime({ client, hostSession, dataRoot: await tempData() });
  await runtime.steerSession("selected-session", "Continue the same work.\n\nKeep the existing record context and report the checks.");
  assert.deepEqual(client.calls.filter(([kind]) => kind === "resumeSession"), []);
  assert.ok(hostCalls.some(([kind, id, prompt]) => kind === "hostSend" && id === "selected-session" && prompt.includes("\n\nKeep the existing record context")));
});

test("session prompts accept ordinary multiline text and reject unsafe controls", async () => {
  const project = await gitProject();
  const client = clientFixture();
  const hostSession = joinedSessionFixture("verification-session");
  const runtime = await createClipsRuntime({ client, hostSession, cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot: await tempData() });
  await recordTestOnlyVerification(runtime);
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#g001", prompt: "unsafe\u0000prompt" }), /valid prompt/);
  await assert.rejects(runtime.steerSession("verification-session", "unsafe\u0007prompt"), /valid prompt/);
});

test("historical visibility evidence never enables nonjoined sidecar steering", async () => {
  const project = await gitProject();
  const client = clientFixture({ sessions: [{ sessionId: "verification-session", startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot: await tempData() });
  await assert.rejects(runtime.steerSession("verification-session", "Continue"), /Only the currently joined Copilot session/);
  await assert.rejects(runtime.recordHostVerification({ appVersion: "1.0.0", sessionId: "verification-session", verifiedBy: "user", openedInApp: true, steeredInApp: false }), /confirmed open plus steering/);
  await recordTestOnlyVerification(runtime);
  await assert.rejects(runtime.steerSession("verification-session", "Continue"), /prior visibility check is not a live host connection/);
  assert.equal(client.calls.some(([kind]) => kind === "resumeSession"), false);
  assert.equal((await runtime.listSessions(project)).sessions[0].steerable, false);
});

test('embedded Copilot executable is never selected as the Clips JS interpreter', async () => {
  const calls = [];
  const chosen = await resolveNodeExecutable({ executable: '/app/copilot', env: {}, run: async (bin, args) => {
    calls.push(bin);
    if (args[0] === '--version') return { stdout: 'v22.18.0' };
    return { stdout: JSON.stringify({ node: '22.18.0', execPath: '/installed/node' }) };
  } });
  assert.equal(chosen, '/installed/node');
  assert.deepEqual(calls, ['node', 'node']);
  await assert.rejects(resolveNodeExecutable({ configured: '/bad/node', run: async () => ({ stdout: 'not node' }) }), /CLIPS_NODE_PATH/);
  assert.equal(await resolveNodeExecutable({ executable: '/app/copilot', env: {} }), process.execPath);
});

test('musl runtime lookup matches the locked installer platform', () => {
  let requested;
  assert.match(resolveSdkRuntimeExecutable({ platform: 'linux', arch: 'x64', musl: true, resolvePackage: (name) => { requested = name; return '/extension/node_modules/@github/copilot-sdk-linuxmusl-x64/package.json'; }, exists: () => true }), /prebuilds\/linuxmusl-x64\/copilot-runtime$/);
  assert.equal(requested, '@github/copilot-sdk-linuxmusl-x64/package.json');
});

test('joined native getters preserve settings and bind exact namespaced Goals without a catalog client', async () => {
  const project = await gitProject();
  for (const ref of ['#tom#g001', '#lucy#g001']) {
    const sent = [];
    const metadata = { unrelated: 'keep' };
    const hostSession = {
      ...joinedSessionFixture('current-session', sent),
      rpc: {
        metadata: {
          snapshot: async () => ({ sessionId: 'current-session', workingDirectory: project, currentMode: 'interactive' }),
          activity: async () => ({ hasActiveWork: false, abortable: false }),
          getClientMetadata: async () => ({ ...metadata }),
          updateClientMetadata: async ({ set }) => Object.assign(metadata, set),
        },
        workspaces: { getWorkspace: async () => ({ workspace: { id: 'real-workspace', cwd: project } }) },
        model: { getCurrent: async () => ({ modelId: 'host-chosen', reasoningEffort: 'high' }) },
      },
    };
    const runtime = await createClipsRuntime({ hostSession, dataRoot: await tempData(), cliRunner: makeCliRunner({ record: { ref, goal_id: 'g001' } }), loadSdk: async () => { throw new Error('catalog not needed for joined work'); } });
    const current = await runtime.currentSession();
    assert.equal(current.status, 'idle');
    assert.equal(current.workspaceId, 'real-workspace');
    assert.deepEqual(current.model, { modelId: 'host-chosen', reasoningEffort: 'high' });
    const launched = await runtime.launchRecord({ projectPath: project, ref, prompt: 'Read only.' });
    assert.equal(launched.recordKind, 'goal');
    assert.equal(launched.appVisible, 'unverified');
    assert.equal(metadata['clips/ref'], ref);
    assert.equal(metadata.unrelated, 'keep');
    assert.equal(sent.length, 1);
    const listed = await runtime.listSessions(project);
    assert.equal(listed.sessions[0].id, 'current-session');
    assert.match(listed.warnings[0], /catalog not needed/);
  }
});

test('previous manager associations are preserved without blocking an explicit Goal send', async () => {
  const project = await gitProject();
  const sessionId = 'manager';
  const calls = [];
  const dataRoot = await tempData();
  const repositoryId = await fs.realpath(path.join(project, '.git'));
  await writeTestBinding(dataRoot, sessionId, { repository_id: repositoryId, project_id: repositoryId, ref: '#l001', kind: 'lane' });
  const runtime = await createClipsRuntime({ hostSession: joinedSessionFixture(sessionId, calls), dataRoot, cliRunner: makeCliRunner(), client: clientFixture({ sessions: [{ sessionId, context: { workingDirectory: project } }] }) });
  assert.equal((await runtime.launchRecord({ projectPath: project, ref: '#g001', prompt: 'Do work' })).id, sessionId);
  assert.equal(calls.length, 1);
  assert.deepEqual((await runtime.listSessions(project)).sessions.map((session) => session.recordRef).sort(), ['#g001', '#l001']);
});

test('explicit record sends replace only advisory client keys and serialize readback with delivery', async () => {
  const project = await gitProject();
  const metadata = { unrelated: 'keep', 'clips/ref': '#l009', 'clips/kind': 'lane', 'clips/project': 'previous-project' };
  const calls = [];
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const hostSession = {
    ...joinedSessionFixture('joined', calls, { sendGate: gate, onEvent: () => entered() }),
    rpc: { metadata: {
      snapshot: async () => ({ sessionId: 'joined', workingDirectory: project }),
      getClientMetadata: async () => ({ ...metadata }),
      updateClientMetadata: async ({ set }) => Object.assign(metadata, set),
    } },
  };
  const runtime = await createClipsRuntime({ hostSession, dataRoot: await tempData(), cliRunner: async (_bin, args) => ({
    stdout: JSON.stringify({ ref: args[args.indexOf('view') + 1], kind: 'goal' }),
  }) });
  const first = runtime.launchRecord({ projectPath: project, ref: '#g001', prompt: 'First' });
  await started;
  const second = runtime.launchRecord({ projectPath: project, ref: '#g002', prompt: 'Second' });
  assert.equal(metadata['clips/ref'], '#g001');
  assert.equal(calls.length, 1);
  release();
  assert.deepEqual((await Promise.all([first, second])).map((session) => session.recordRef), ['#g001', '#g002']);
  assert.equal(metadata['clips/ref'], '#g002');
  assert.equal(metadata.unrelated, 'keep');
  assert.deepEqual(calls.map((call) => call[2]), ['First', 'Second']);
});

test('missing Clips store reports the intended project without falling back to the source checkout', async () => {
  const project = await gitProject();
  const runtime = await createClipsRuntime({ dataRoot: await tempData() });
  await assert.rejects(runtime.listBoard(project), (error) => error.message.includes(project) && /Choose an initialized Clips project/.test(error.message));
  await assert.rejects(fs.access(path.join(project, '.clips')));
});
