import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";
import { appSessionUrl, commandFamily, createClipsRuntime } from "./index.mjs";

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
  const name = createHash("sha256").update(sessionId).digest("hex");
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

test("canonical Clips CLI adapter creates real isolated Goal and Task history", async () => {
  const project = await gitProject();
  execFileSync(process.execPath, [clipsCli, "init", "--skills-scope", "project"], { cwd: project, stdio: "ignore" });
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

test("new Goal sessions use actual SDK IDs, selected directory, runtime defaults, and durable local binding", async () => {
  const project = await gitProject();
  const dataRoot = await tempData();
  const client = clientFixture();
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot });
  await recordTestOnlyVerification(runtime);
  const multilinePrompt = "Work on Goal\n\nUse the existing acceptance criteria.\nReturn the result and test evidence.";
  const launched = await runtime.launchRecord({ projectPath: project, ref: "#g001", prompt: multilinePrompt });
  assert.equal(launched.id, "real-session-1");
  assert.equal(launched.status, "unknown");
  assert.equal(launched.appVisible, "verified_by_host_check");
  assert.equal(launched.workspaceId, null);
  const config = client.calls.find(([kind]) => kind === "createSession")[1];
  assert.equal(config.workingDirectory, await fs.realpath(project));
  assert.equal(Object.hasOwn(config, "model"), false);
  assert.equal(Object.hasOwn(config, "reasoningEffort"), false);
  assert.deepEqual(client.calls.find(([kind]) => kind === "send"), ["send", "real-session-1", multilinePrompt]);
  const binding = JSON.parse(await fs.readFile(path.join(dataRoot, "bindings", `${(await import("node:crypto")).createHash("sha256").update("real-session-1").digest("hex")}.json`), "utf8"));
  assert.equal(binding.ref, "#g001");
  assert.equal(binding.repository_id, await fs.realpath(execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()));
});

test("Lane claim is acquired for actual idle SDK session before prompt delivery", async () => {
  const project = await gitProject();
  const events = [];
  const client = clientFixture({ onEvent: (event) => events.push(event) });
  const cliCalls = [];
  const baseRunner = makeCliRunner({ record: { ref: "#l001", kind: "lane", title: "Product" }, calls: cliCalls });
  const runner = async (...args) => { events.push(["cli", ...args[1].slice(-4)]); return baseRunner(...args); };
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: runner, dataRoot: await tempData(), hostId: "observed-host-id" });
  await recordTestOnlyVerification(runtime);
  const result = await runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate this Lane" });
  assert.equal(result.id, "real-session-1");
  const claim = cliCalls.find(({ args }) => args.includes("claim"));
  assert.ok(claim);
  const request = JSON.parse(claim.args[claim.args.indexOf("claim") + 2]);
  assert.equal(request.actor.session_id, "real-session-1");
  assert.equal(request.actor.runtime, "copilot-sdk");
  assert.equal(request.actor.host, "observed-host-id");
  assert.equal(request.expected_revision, 0);
  assert.ok(events.findIndex((event) => event[0] === "create") < events.findIndex((event) => event[0] === "cli" && event.includes("claim")));
  assert.ok(events.findIndex((event) => event[0] === "cli" && event.includes("claim")) < events.findIndex((event) => event[0] === "send"));
  assert.ok(events.find((event) => event[0] === "send" && event[1] === "real-session-1"));
});

test("pre-existing foreign Lane owner is preserved and prevents session creation", async () => {
  const project = await gitProject();
  const client = clientFixture();
  const runner = makeCliRunner({ record: { ref: "#l001", kind: "lane" }, claim: { revision: 4, owners: [{ host: "other-host", runtime: "copilot-sdk", session_id: "other-session" }] } });
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: runner, dataRoot: await tempData(), hostId: "observed-host-id" });
  await recordTestOnlyVerification(runtime);
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "coordinate" }), /already has a manager/);
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
});

test("claimed Lane reuse requires matching session Git project and record-kind binding", async () => {
  const project = await gitProject();
  const differentProject = await gitProject();
  const dataRoot = await tempData();
  const manager = { sessionId: "claimed-manager", startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: differentProject, gitRoot: differentProject } };
  const client = clientFixture({ sessions: [manager] });
  const runner = makeCliRunner({ record: { ref: "#l001", kind: "lane" }, claim: { revision: 3, owners: [{ host: "host-1", runtime: "copilot-sdk", session_id: "claimed-manager" }] } });
  await writeTestBinding(dataRoot, "claimed-manager", {
    repository_id: await fs.realpath(execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()),
    project_id: await fs.realpath(execFileSync("git", ["-C", project, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" }).trim()),
    ref: "#l001", kind: "lane",
  });
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: runner, dataRoot, hostId: "host-1" });
  await recordTestOnlyVerification(runtime);
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate" }), /observed Git project does not match/);
  assert.equal(client.calls.some(([kind, id]) => kind === "send" && id === "claimed-manager"), false);
});

test("Lane claim is suppressed when host identity is absent", async () => {
  const project = await gitProject();
  const client = clientFixture();
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: makeCliRunner({ record: { ref: "#l001", kind: "lane" } }), dataRoot: await tempData() });
  await recordTestOnlyVerification(runtime);
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#l001", prompt: "Coordinate" }), /no verified host ID/);
  assert.equal(client.calls.some(([kind]) => kind === "createSession"), false);
});

test("record launch lock prevents a second process from creating a duplicate session", async () => {
  const project = await gitProject();
  const dataRoot = await tempData();
  let releaseSend;
  let markSendEntered;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const sendEntered = new Promise((resolve) => { markSendEntered = resolve; });
  const clientA = clientFixture({ sendGate, onEvent: (event) => { if (event[0] === "send") markSendEntered(); } });
  const clientB = clientFixture();
  const options = { cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot };
  const runtimeA = await createClipsRuntime({ ...options, client: clientA });
  const runtimeB = await createClipsRuntime({ ...options, client: clientB });
  await recordTestOnlyVerification(runtimeA);
  await recordTestOnlyVerification(runtimeB);
  const first = runtimeA.launchRecord({ projectPath: project, ref: "#g001", prompt: "first" });
  await sendEntered;
  await assert.rejects(runtimeB.launchRecord({ projectPath: project, ref: "#g001", prompt: "second" }), /already in progress or left a crash lock/);
  releaseSend();
  assert.equal((await first).id, "real-session-1");
  assert.equal(clientA.calls.filter(([kind]) => kind === "createSession").length, 1);
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

test("existing session steering resumes by actual ID and calls send", async () => {
  const metadata = { sessionId: "selected-session", startTime: new Date(), modifiedTime: new Date(), context: {} };
  const client = clientFixture({ sessions: [metadata] });
  const runtime = await createClipsRuntime({ client, dataRoot: await tempData() });
  await recordTestOnlyVerification(runtime);
  await runtime.steerSession("selected-session", "Continue the same work.\n\nKeep the existing record context and report the checks.");
  assert.ok(client.calls.some(([kind, id]) => kind === "resumeSession" && id === "selected-session"));
  assert.ok(client.calls.some(([kind, id, prompt]) => kind === "send" && id === "selected-session" && prompt.includes("\n\nKeep the existing record context")));
});

test("session prompts accept ordinary multiline text and reject unsafe controls", async () => {
  const project = await gitProject();
  const client = clientFixture();
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot: await tempData() });
  await recordTestOnlyVerification(runtime);
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#g001", prompt: "unsafe\u0000prompt" }), /valid prompt/);
  await assert.rejects(runtime.steerSession("verification-session", "unsafe\u0007prompt"), /valid prompt/);
});

test("session launch and steering remain disabled until local App verification is explicitly recorded", async () => {
  const project = await gitProject();
  const client = clientFixture({ sessions: [{ sessionId: "verification-session", startTime: new Date(), modifiedTime: new Date(), context: { workingDirectory: project, gitRoot: project } }] });
  const runtime = await createClipsRuntime({ client, cliPath: "src/cli.js", cliRunner: makeCliRunner(), dataRoot: await tempData() });
  await assert.rejects(runtime.launchRecord({ projectPath: project, ref: "#g001", prompt: "Do work" }), /visibility and user steering .* not been verified/);
  await assert.rejects(runtime.steerSession("verification-session", "Continue"), /visibility and user steering .* not been verified/);
  await assert.rejects(runtime.recordHostVerification({ appVersion: "1.0.0", sessionId: "verification-session", verifiedBy: "user", openedInApp: true, steeredInApp: false }), /confirmed open plus steering/);
  await recordTestOnlyVerification(runtime);
  assert.equal((await runtime.listSessions(project)).sessions[0].steerable, true);
});
