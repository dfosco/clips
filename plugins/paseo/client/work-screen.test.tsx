// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { WorkScreen } from "./work-screen";
import { branchName } from "../shared/work";

const state = vi.hoisted(() => ({ projects: [] as any[], board: { lanes: [] as any[], goals: [] as any[], warnings: [] }, runtime: { workspaces: [] as any[], agents: [] as any[] }, runtimeError: null as Error | null, mutation: undefined as any, invalidations: [] as any[] }));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => vi.fn(), useSettings: () => ({ status: "ready", values: {} }),
}));
vi.mock("@getpaseo/plugin/client/react-native", () => ({
  Icon: () => null,
  Modal: Object.assign(({ children, open, title }: any) => open ? createElement("div", { "aria-label": title }, children) : null, {
    Content: ({ children }: any) => createElement("div", null, children),
  }),
  TextInput: ({ accessibilityLabel, placeholder }: any) => createElement("input", { "aria-label": accessibilityLabel, placeholder }),
  useToast: () => ({ show: vi.fn() }),
  ScrollView: ({ children, accessibilityLabel }: any) => createElement("section", { "aria-label": accessibilityLabel }, children),
}));
vi.mock("react-native", () => ({
  View: ({ children, accessibilityRole }: any) => createElement("div", { role: accessibilityRole }, children),
  Text: ({ children }: any) => createElement("span", null, children),
  Pressable: ({ children, accessibilityLabel, accessibilityRole, disabled, onPress }: any) => createElement("button", { "aria-label": accessibilityLabel, role: accessibilityRole, disabled, onClick: onPress }, children),
  TextInput: ({ accessibilityLabel }: any) => createElement("input", { "aria-label": accessibilityLabel }),
  ActivityIndicator: () => null,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: any) => ({ data: queryKey[0] === "clips.projects" ? { projects: state.projects } : state.board }),
  useQueryClient: () => ({ invalidateQueries: async ({ queryKey }: any) => { state.invalidations.push(queryKey); } }),
  useMutation: (options: any) => {
    if (!state.mutation) state.mutation = options;
    return { isPending: false, mutate: vi.fn() };
  },
}));
vi.mock("./runtime", async (importOriginal) => ({
  ...await importOriginal<typeof import("./runtime")>(),
  useRuntime: () => ({ data: state.runtime, isError: Boolean(state.runtimeError), error: state.runtimeError }),
}));
vi.mock("./agent-configuration", () => ({ AgentLaunchDialog: () => null }));

const base = { description: "", status: "open", scope: "", plan: "", decisions: "", acceptanceCriteria: [] };
const lane = { ...base, kind: "lane", ref: "#l001", title: "Publish releases", goalRefs: ["#g001", "#g002"], productGoals: [] };
const task = { ...base, kind: "task", ref: "#g001#t01", title: "Ship package" };
const goal = { ...base, kind: "goal", ref: "#g001", title: "Package publishing", type: "building", laneId: "l001", tasks: [task] };
const outside = { ...goal, ref: "#g003", title: "Unrelated goal", tasks: [] };
const props = { host: { id: "host" }, layout: { compact: false }, theme: { colors: new Proxy({}, { get: () => "#333333" }) } } as unknown as PluginSurfaceProps;
function render(focused = true) {
  return renderToStaticMarkup(createElement(WorkScreen, { ...props, ...(focused ? { currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" } : {}) }));
}

beforeEach(() => {
  state.projects = [{ projectId: "p1", projectIds: ["p1"], label: "Project" }];
  state.board = { lanes: [lane], goals: [goal, outside], warnings: [] };
  state.runtime = { workspaces: [{ id: "w1", projectId: "p1", name: "Lane work", branch: branchName(lane), status: "ready" }], agents: [] };
  state.mutation = undefined;
  state.runtimeError = null;
  state.invalidations = [];
});

describe("focused lane rendering", () => {
  it("chooses the exact agent across workspaces and restores launches after execution ends", async () => {
    state.board = { lanes: [], goals: [{ ...goal, laneId: null, tasks: [] }], warnings: [] };
    state.runtime.agents = [
      { id: "first", workspaceId: "w1", status: "running", requiresAttention: false, attentionReason: null, labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: "First worker" },
      { id: "second", workspaceId: "w2", status: "attention", requiresAttention: true, attentionReason: "permission", labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: "Second worker" },
    ];
    const calls: string[] = [];
    const navigation = {
      openWorkspace: ({ workspaceId }: { workspaceId: string }) => { calls.push(`workspace:${workspaceId}`); },
      openAgent: ({ agentId }: { agentId: string }) => { calls.push(`agent:${agentId}`); },
    };
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const renderScreen = () => root.render(createElement(WorkScreen, { ...props, navigation }));
    try {
      await act(async () => { renderScreen(); });
      const go = container.querySelector<HTMLButtonElement>('button[aria-label="Go to agent"]')!;
      expect(go).not.toBeNull();
      await act(async () => { go.click(); });
      expect(calls).toEqual([]);
      const choice = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Second worker · attention · w2"));
      expect(choice).toBeDefined();
      await act(async () => { choice!.click(); });
      expect(calls).toEqual(["workspace:w2", "agent:second"]);
      expect(container.querySelector('[role="menu"]')).toBeNull();
      expect(container.querySelector('[aria-label="Run in workspace"]')).toBeNull();
      state.runtime = { ...state.runtime, agents: [] };
      await act(async () => { renderScreen(); });
      expect(container.querySelector('[aria-label="Go to agent"]')).toBeNull();
      expect(container.querySelector('[aria-label="Run in workspace"]')).not.toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("places Back above lane title and exposes goal columns with their Tasks without expansion", () => {
    const html = render();
    expect(html.indexOf("Back to Clips")).toBeLessThan(html.indexOf("Publish releases"));
    expect(html).toContain('aria-label="Lane goals"');
    expect(html).toContain("Package publishing");
    expect(html).toContain("Ship package");
    expect(html).not.toContain("Unrelated goal");
    expect(html).not.toContain('aria-label="Project lanes"');
    expect(html).toContain('aria-label="More actions for goal #g001"');
    expect(html).toContain('aria-label="Show Goal details #g001"');
    expect(html).toContain('aria-label="Run in Paseo"');
  });

  it("shows assigned Lane labels and a Labels action in the workspace-focused header", () => {
    state.board.lanes = [{ ...lane, labels: [{ id: "review", name: "Ready to review", color: "#8b5cf6" }] }];
    const html = render();
    expect(html).toContain("Ready to review");
    expect(html).toContain('aria-label="Labels for #l001"');
  });

  it("opens the Lane label manager from the workspace-focused header", async () => {
    const review = { id: "review", name: "Ready to review", color: "#8b5cf6" };
    state.board.lanes = [{ ...lane, labels: [review] }];
    state.board.labels = [review];
    const container = document.createElement("div");
    const root = createRoot(container);
    const previousAct = (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    try {
      await act(async () => { root.render(createElement(WorkScreen, { ...props, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" })); });
      const labels = container.querySelector<HTMLButtonElement>('button[aria-label="Labels for #l001"]');
      expect(labels).not.toBeNull();
      await act(async () => { labels!.click(); });
      expect(container.querySelector('[aria-label="Labels · #l001"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="Assign Ready to review to #l001"]')).not.toBeNull();
    } finally {
      await act(async () => { root.unmount(); });
      (globalThis as any).IS_REACT_ACT_ENVIRONMENT = previousAct;
    }
  });

  it("retains the project home view without inferred workspace context", () => {
    const html = render(false);
    expect(html).toContain('aria-label="Project lanes"');
    expect(html).toContain("Unrelated goal");
    expect(html).not.toContain("Back to Clips");
  });

  it("offers Show closed goals for an all-closed lane and names empty lanes", () => {
    state.board.goals = [{ ...goal, status: "closed" }];
    let html = render();
    expect(html).toContain("Show closed goals");
    expect(html).toContain("All goals are closed.");
    expect(html).not.toContain("Package publishing");
    state.board.goals = [];
    html = render();
    expect(html).toContain("No Goals in this lane yet.");
    expect(html).not.toContain("Show closed goals");
  });

  it("keeps compact focus content and theme tokens available", () => {
    const html = renderToStaticMarkup(createElement(WorkScreen, { ...props, layout: { ...props.layout, compact: true }, currentWorkspaceId: "w1" }));
    expect(html).toContain("Ship package");
    expect(html).toContain("Back to Clips");
  });

  it.each(["running", "initializing", "attention"])("replaces goal launch and workspace actions while %s", (status) => {
    state.board = { lanes: [lane], goals: [{ ...goal, tasks: [] }], warnings: [] };
    state.runtime.agents = [{ id: "a1", workspaceId: "w1", status, requiresAttention: status === "attention",
      attentionReason: status === "attention" ? "permission" : null,
      labels: { "clips.ref": goal.ref, "clips.projectId": "p1" }, title: "Goal agent" }];
    const html = renderToStaticMarkup(createElement(WorkScreen, { ...props,
      navigation: { openWorkspace: vi.fn(), openAgent: vi.fn() }, currentWorkspaceId: "w1", currentWorkspaceProjectId: "p1" }));
    const goalMarkup = html.slice(html.indexOf('aria-label="Hide Goal details #g001"') >= 0
      ? html.indexOf('aria-label="Hide Goal details #g001"') : html.indexOf('aria-label="Show Goal details #g001"'));
    expect(goalMarkup).toContain('aria-label="Go to agent"');
    expect(goalMarkup).not.toContain('aria-label="Run"');
    expect(goalMarkup).not.toContain('aria-label="Open workspace"');
    expect(goalMarkup).not.toContain('aria-label="Run in workspace"');
    expect(goalMarkup).not.toContain('aria-label="Workspace only"');
  });

  it.each(["idle", "unavailable", "foreign"])("preserves manager ownership when %s", (stateName) => {
    const manager = { host: stateName === "foreign" ? "other-host" : "host", runtime: "paseo", session_id: "manager", contact: "Contact manager" };
    state.board = { lanes: [{ ...lane, managerClaim: { revision: 1, owners: [manager] } }], goals: [], warnings: [] };
    state.runtime.agents = stateName === "unavailable" ? [] : [{ id: "manager", workspaceId: "w1", status: "idle", requiresAttention: false, attentionReason: null, labels: {}, title: "Manager" }];
    const html = renderToStaticMarkup(createElement(WorkScreen, { ...props, navigation: { openWorkspace: vi.fn(), openAgent: vi.fn() } }));
    expect(html).toContain("Contact manager");
    if (stateName === "idle") expect(html).toContain('aria-label="Go to agent"');
    else expect(html).toContain("Agent unavailable; contact the manager");
    expect(html).not.toContain('aria-label="Run in workspace"');
    expect(html).not.toContain('aria-label="Open workspace"');
    expect(html).toContain(stateName === "idle" ? "Manager idle" : "Manager unavailable");
  });

  it("fails closed when manager ownership cannot be read", () => {
    state.board = { lanes: [{ ...lane, managerClaim: null, managerClaimError: "Invalid claim state" }], goals: [], warnings: [] };
    const html = render(false);
    expect(html).toContain("Ownership unavailable");
    expect(html).toContain("Invalid claim state");
    expect(html).not.toContain('aria-label="Run in workspace"');
  });

  it("suppresses launches when runtime refresh fails with cached idle data", () => {
    state.runtimeError = new Error("Runtime disconnected");
    for (const focused of [true, false]) {
      const html = render(focused);
      expect(html).toContain("Cannot verify live execution: Runtime disconnected");
      expect(html).not.toContain('aria-label="Run"');
      expect(html).not.toContain('aria-label="Run in workspace"');
      expect(html).not.toContain('aria-label="Run in Paseo"');
      expect(html).not.toContain('aria-label="Workspace only"');
    }
    state.runtimeError = null;
    expect(render()).toContain('aria-label="Run"');
  });

  it("refreshes runtime on a partial creation failure without repeating the successful refresh", async () => {
    render(false);
    const request = state.mutation.onMutate({ ref: lane.ref });
    state.mutation.onSettled(undefined, new Error("agent start failed after creation"), {}, request);
    expect(state.invalidations).toContainEqual(["clips-runtime", "host"]);
    state.invalidations = [];
    state.mutation.onSettled({}, null, {}, request);
    expect(state.invalidations).not.toContainEqual(["clips-runtime", "host"]);
    expect(state.invalidations).toContainEqual(["clips.board", "host", "p1"]);
  });
});
