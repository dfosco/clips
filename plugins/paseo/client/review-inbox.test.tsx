// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewInbox } from "./review-inbox";

const state = vi.hoisted(() => ({
  projects: vi.fn(), list: vi.fn(), detail: vi.fn(), decide: vi.fn(),
  listResult: [] as any[], detailResult: undefined as any,
}));
vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: (rpc: { name: string }) => rpc.name === "clips.projects" ? state.projects
    : rpc.name === "clips.review.list" ? state.list
      : rpc.name === "clips.review.show" ? state.detail : state.decide,
}));
vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { createElement: h } = await import("react");
  return {
    SettingsSection: ({ title, children }: any) => h("section", { "aria-label": title }, children),
    SettingsCard: ({ children }: any) => h("div", {}, children),
    SettingsAction: () => null,
    SettingsSelect: ({ label, value, options, onValueChange }: any) => h("label", {}, label,
      h("select", { "aria-label": label, value, onChange: (event: any) => onValueChange(event.target.value) },
        options.map((option: any) => h("option", { key: option.value, value: option.value }, option.label)))),
  };
});
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: any) => queryKey[0] === "clips.review.projects"
    ? { data: { projects: [{ projectId: "project-1", label: "Project one" }] } }
    : queryKey[0] === "clips.review.list" ? { data: { reviews: state.listResult } }
      : { data: state.detailResult },
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
  useMutation: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
}));
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    ActivityIndicator: () => h("span", {}, "Loading"),
    Image: () => h("img", {}),
    Linking: { openURL: vi.fn() },
    Pressable: ({ children, accessibilityRole, disabled, onPress }: any) => h("button", { role: accessibilityRole, disabled, onClick: onPress }, children),
    ScrollView: ({ children }: any) => h("div", {}, children),
    Text: ({ children, accessibilityLabel, accessibilityRole, onPress }: any) => h("span", {
      "aria-label": accessibilityLabel, role: accessibilityRole, onClick: onPress,
    }, children),
    TextInput: ({ accessibilityLabel, value, onChangeText }: any) => h("input", {
      "aria-label": accessibilityLabel, value, onChange: (event: any) => onChangeText(event.target.value),
    }),
    View: ({ children }: any) => h("div", {}, children),
  };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const { createElement: h } = await import("react");
  return { ScrollView: ({ children }: any) => h("div", {}, children) };
});

const review = (id: string, status: string) => ({
  id, ref: `#g00${id}`, title: `${status} title`, status, reviewer: "reviewer", revision: 1,
  candidate: { base: "base-sha", head: "head-sha" }, summary: "Review summary", covers: [],
  validation: {}, stale: false, stale_reasons: [], attachment: { content: "Pinned content", read_identity: { pinned: {} } },
});
const theme = { colors: { foreground: "#fff", foregroundMuted: "#aaa", border: "#444", accent: "#58f",
  accentForeground: "#fff", statusDanger: "#f44" } } as any;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.listResult = [review("old", "delivered"), review("new", "awaiting_review"), review("obsolete", "superseded")];
  state.detailResult = state.listResult[1];
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

describe("Review inbox lifecycle", () => {
  it("opens the newest outstanding request ahead of delivered and superseded history", async () => {
    await act(async () => root.render(createElement(ReviewInbox, { theme })));
    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="Review request"]')!;
    expect(selector.value).toBe("new");
    expect(Array.from(selector.options).map((option) => option.value)).toEqual(["new"]);
    expect(container.textContent).toContain("Status: Awaiting review");
    expect(container.textContent).not.toContain("old");
    expect(container.textContent).not.toContain("obsolete");
  });

  it("labels deferred and approved requests as awaiting explicit action or delivery", async () => {
    state.listResult = [review("approved", "approved"), review("deferred", "deferred"), review("waiting", "awaiting_review")];
    state.detailResult = state.listResult[2];
    await act(async () => root.render(createElement(ReviewInbox, { theme })));
    const labels = Array.from(container.querySelector<HTMLSelectElement>('select[aria-label="Review request"]')!.options)
      .map((option) => option.textContent);
    expect(labels).toEqual([
      "#g00waiting · awaiting_review title · Awaiting review",
      "#g00deferred · deferred title · Deferred · awaiting explicit decision",
      "#g00approved · approved title · Approved · awaiting delivery",
    ]);
  });
});
