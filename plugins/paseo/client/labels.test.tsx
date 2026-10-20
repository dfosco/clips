// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Work } from "../shared/contracts";
import { LabelChips, LabelManager } from "./labels";

const rpcMocks = vi.hoisted(() => ({ fetchLabelUses: vi.fn() }));
vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => rpcMocks.fetchLabelUses }));

// Exercise real component state/events. Mock only the host/native rendering
// boundary, so no Paseo daemon, browser automation, or native renderer is needed.
vi.mock("react-native", async () => {
  const { createElement: h } = await import("react");
  return {
    View: ({ children, accessibilityLabel, accessibilityRole, ...props }: any) =>
      h("div", { style: props.style, "aria-label": accessibilityLabel, role: accessibilityRole }, children),
  Text: ({ children, accessibilityRole, accessibilityLiveRegion, style }: any) => h("span", { style, role: accessibilityRole, "aria-live": accessibilityLiveRegion }, children),
    Pressable: ({ children, accessibilityLabel, accessibilityRole, accessibilityState, disabled, onPress }: any) =>
      h("button", { "aria-label": accessibilityLabel, role: accessibilityRole, disabled,
        "aria-checked": accessibilityState?.checked, onClick: onPress }, children),
  };
});
vi.mock("@getpaseo/plugin/client/react-native", async () => {
  const { createElement: h } = await import("react");
  const Modal = Object.assign(({ children, open, title }: any) => open ? h("section", { role: "dialog", "aria-label": title }, children) : null,
    { Content: ({ children }: any) => h("div", {}, children) });
  return {
    Modal,
    Icon: ({ name }: any) => h("span", { "data-icon": name }),
    TextInput: ({ accessibilityLabel, value, onChangeText, editable }: any) =>
      h("input", { "aria-label": accessibilityLabel, value, disabled: editable === false,
        onChange: (event: any) => onChangeText(event.target.value) }),
  };
});

const theme = { colors: { foreground: "#eeeeee", foregroundMuted: "#aaaaaa", border: "#333333",
  surface0: "#111111", surface1: "#222222", surface2: "#292929", statusDanger: "#ff0000" } } as any;
const label = { id: "review", name: "Review", color: "#8b5cf6" };
const otherLabel = { id: "ready", name: "Ready", color: "#22c55e" };
const namedNoneLabel = { id: "none", name: "None", color: "#737373" };
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  rpcMocks.fetchLabelUses.mockReset();
  rpcMocks.fetchLabelUses.mockResolvedValue({ id: "review", uses: [], count: 0 });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const target = (kind = "task", labels = [label]) => ({ kind, ref: kind === "lane" ? "#l001" : kind === "goal" ? "#g001" : "#alice#g001#t01", labels }) as Work;
const render = async (element: React.ReactNode) => { await act(async () => root.render(element)); };
const byLabel = (name: string) => {
  const element = Array.from(container.querySelectorAll<HTMLElement>("[aria-label]")).find((el) => el.getAttribute("aria-label") === name);
  expect(element, name).toBeTruthy();
  return element!;
};
const click = async (name: string) => { await act(async () => byLabel(name).click()); };
const input = async (name: string, value: string) => {
  await act(async () => {
    const element = byLabel(name) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("project label picker", () => {
  it("renders readable named chips with the configured color", async () => {
    await render(<LabelChips labels={[label]} theme={theme} />);
    expect(container.textContent).toContain("Review");
    expect(byLabel("Label: Review").style.borderColor).toBe("rgb(139, 92, 246)");
    expect(container.querySelector("span")!.style.color).toBe("rgb(238, 238, 238)");
  });

  it.each(["lane", "goal", "task"])("adds and removes labels on a %s ref", async (kind) => {
    const work = target(kind, []);
    const onChange = vi.fn().mockResolvedValue(undefined);
    const props = { work, catalog: [label], theme, busy: false, onChange, onClose: vi.fn() };
    await render(<LabelManager {...props} />);
    const name = `Assign Review to ${work.ref}`;
    expect(byLabel(name).getAttribute("aria-checked")).toBe("false");
    await click(name);
    expect(onChange).toHaveBeenLastCalledWith({ action: "add", ref: work.ref, id: "review" });
    await render(<LabelManager {...props} work={target(kind)} />);
    expect(byLabel(name).getAttribute("aria-checked")).toBe("true");
    await click(name);
    expect(onChange).toHaveBeenLastCalledWith({ action: "remove", ref: work.ref, id: "review" });
  });

  it("creates a named palette label and edits its name and color", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    await render(<LabelManager work={target()} catalog={[label]} theme={theme} busy={false} onChange={onChange} onClose={vi.fn()} />);
    await click("Create project label");
    expect((byLabel("Create label") as HTMLButtonElement).disabled).toBe(true);
    await input("Label name", "Shipping");
    await click("Blue");
    expect(byLabel("Blue").getAttribute("aria-checked")).toBe("true");
    await click("Create label");
    expect(onChange).toHaveBeenLastCalledWith({ action: "create", name: "Shipping", color: "#3b82f6" });
    await click("Edit Review");
    await input("Label name", "Validate");
    await click("Green");
    await click("Save label");
    expect(onChange).toHaveBeenLastCalledWith({ action: "edit", id: "review", name: "Validate", color: "#22c55e" });
  });

  it("keeps a failed deletion visible, preserves the form, and allows retry", async () => {
    const onChange = vi.fn().mockRejectedValueOnce(new Error("Remove assignments on #g001 first")).mockResolvedValue(undefined);
    await render(<LabelManager work={target()} catalog={[label]} projectId="project-a" theme={theme} busy={false} onChange={onChange} onClose={vi.fn()} />);
    await click("Edit Review");
    await click("Delete project label");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("#g001");
    expect((byLabel("Label name") as HTMLInputElement).value).toBe("Review");
    await click("Delete project label");
    expect(onChange).toHaveBeenLastCalledWith({ action: "delete", id: "review" });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(byLabel("Create project label")).toBeTruthy();
  });

  it("searches labels and disables mutations while a write is pending", async () => {
    const onChange = vi.fn();
    const props = { work: target(), catalog: [label], projectId: "project-a", theme, onChange, onClose: vi.fn() };
    await render(<LabelManager {...props} busy />);
    await click(`Assign Review to ${props.work.ref}`);
    expect(onChange).not.toHaveBeenCalled();
    expect((byLabel("Create project label") as HTMLButtonElement).disabled).toBe(true);
    await render(<LabelManager {...props} busy={false} />);
    await input("Search project labels", "missing");
    expect(container.textContent).toContain("No matching labels");
  });

  it("lists every replacement including a distinct explicit none and makes no write until chosen", async () => {
    rpcMocks.fetchLabelUses.mockResolvedValue({ id: "review", uses: [
      { ref: "#l001", kind: "lane", status: "active" },
      { ref: "#alice#g001#t02", kind: "task", status: "closed" },
    ], count: 2 });
    const onChange = vi.fn().mockResolvedValue(undefined);
    const props = { work: target(), catalog: [label, otherLabel, namedNoneLabel], projectId: "project-a", theme, busy: false, onChange, onClose: vi.fn() };
    await render(<LabelManager {...props} />);
    await click("Edit Review");
    await click("Delete project label");

    expect(rpcMocks.fetchLabelUses).toHaveBeenCalledWith({ projectId: "project-a", id: "review" });
    expect(container.textContent).toContain("assigned to 2 records");
    expect(byLabel("Replace with Ready")).toBeTruthy();
    expect(byLabel("Replace with None")).toBeTruthy();
    expect(byLabel("None (remove assignments)")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect((byLabel("Label name") as HTMLInputElement).disabled).toBe(true);
    expect((byLabel("Blue") as HTMLButtonElement).disabled).toBe(true);

    await click("Cancel delete");
    expect(onChange).not.toHaveBeenCalled();
    expect(byLabel("Label name")).toBeTruthy();
  });

  it("offers explicit none even with no alternatives, and routes none separately from a real label named none", async () => {
    rpcMocks.fetchLabelUses.mockResolvedValue({ id: "review", uses: [{ ref: "#g001", kind: "goal", status: "closed" }], count: 1 });
    const onChange = vi.fn().mockResolvedValue(undefined);
    const props = { work: target(), catalog: [label], projectId: "project-a", theme, busy: false, onChange, onClose: vi.fn() };
    await render(<LabelManager {...props} />);
    await click("Edit Review");
    await click("Delete project label");
    expect(byLabel("None (remove assignments)")).toBeTruthy();
    expect(container.textContent).toContain("assigned to 1 record");
    await click("None (remove assignments)");
    expect(onChange).toHaveBeenLastCalledWith({ action: "delete", id: "review", replacement: { kind: "none" } });

    const onChangeForNamedNone = vi.fn().mockResolvedValue(undefined);
    await render(<LabelManager {...props} catalog={[label, namedNoneLabel]} onChange={onChangeForNamedNone} />);
    await click("Edit Review");
    await click("Delete project label");
    await click("Replace with None");
    expect(onChangeForNamedNone).toHaveBeenLastCalledWith({ action: "delete", id: "review", replacement: { kind: "label", id: "none" } });
  });

  it("keeps a stale or failed replacement chooser open, shows the error, and permits retry", async () => {
    rpcMocks.fetchLabelUses.mockResolvedValue({ id: "review", uses: [{ ref: "#g001", kind: "goal", status: "active" }], count: 1 });
    const onChange = vi.fn().mockRejectedValueOnce(new Error("Replacement label changed; refresh choices")).mockResolvedValue(undefined);
    await render(<LabelManager work={target()} catalog={[label, otherLabel]} projectId="project-a" theme={theme} busy={false} onChange={onChange} onClose={vi.fn()} />);
    await click("Edit Review");
    await click("Delete project label");
    await click("Replace with Ready");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("refresh choices");
    expect(byLabel("Replace with Ready")).toBeTruthy();
    await click("Replace with Ready");
    expect(onChange).toHaveBeenLastCalledWith({ action: "delete", id: "review", replacement: { kind: "label", id: "ready" } });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("surfaces usage read failures, allows retry, and refreshes a now-unused source before deletion", async () => {
    rpcMocks.fetchLabelUses.mockRejectedValueOnce(new Error("Usage journal is unreadable"))
      .mockResolvedValueOnce({ id: "review", uses: [{ ref: "#g001", kind: "goal", status: "active" }], count: 1 })
      .mockResolvedValueOnce({ id: "review", uses: [], count: 0 })
      .mockResolvedValueOnce({ id: "review", uses: [], count: 0 });
    const onChange = vi.fn().mockResolvedValue(undefined);
    await render(<LabelManager work={target()} catalog={[label]} projectId="project-a" theme={theme} busy={false} onChange={onChange} onClose={vi.fn()} />);
    await click("Edit Review");
    await click("Delete project label");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("unreadable");
    expect(onChange).not.toHaveBeenCalled();
    await click("Delete project label");
    await click("Refresh choices");
    expect(container.textContent).toContain("assigned to 0 records");
    await click("Delete label");
    expect(onChange).toHaveBeenLastCalledWith({ action: "delete", id: "review" });
  });

  it("disables delete while the usage check is pending and waits for the result", async () => {
    let resolveUses!: (value: { id: string; uses: { ref: string; kind: "goal"; status: string }[]; count: number }) => void;
    rpcMocks.fetchLabelUses.mockReturnValue(new Promise((resolve) => { resolveUses = resolve; }));
    const onChange = vi.fn().mockResolvedValue(undefined);
    await render(<LabelManager work={target()} catalog={[label, otherLabel]} projectId="project-a" theme={theme} busy={false} onChange={onChange} onClose={vi.fn()} />);
    await click("Edit Review");
    await click("Delete project label");
    expect((byLabel("Delete project label") as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toContain("Checking label assignments");
    expect(onChange).not.toHaveBeenCalled();

    await act(async () => resolveUses({ id: "review", uses: [{ ref: "#g001", kind: "goal", status: "active" }], count: 1 }));
    expect(byLabel("Replace with Ready")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("announces replacement migration and disables choices while it is pending", async () => {
    rpcMocks.fetchLabelUses.mockResolvedValue({ id: "review", uses: [{ ref: "#g001", kind: "goal", status: "active" }], count: 1 });
    let resolveChange!: () => void;
    const onChange = vi.fn().mockReturnValue(new Promise<void>((resolve) => { resolveChange = resolve; }));
    await render(<LabelManager work={target()} catalog={[label, otherLabel]} projectId="project-a" theme={theme} busy={false} onChange={onChange} onClose={vi.fn()} />);
    await click("Edit Review");
    await click("Delete project label");
    await click("Replace with Ready");

    expect(container.querySelector('[aria-live="polite"]')!.textContent).toContain("Replacing label assignments and deleting label");
    expect((byLabel("Replace with Ready") as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel("Label name") as HTMLInputElement).disabled).toBe(true);

    await act(async () => resolveChange());
  });
});
