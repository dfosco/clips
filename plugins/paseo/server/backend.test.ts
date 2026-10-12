
import { describe, expect, it } from "vitest";
import { normalizeBoard } from "./backend";

describe("Clips JSON board projection", () => {
  it("preserves Lane membership, namespaced Task refs, and acceptance criteria", () => {
    const data = normalizeBoard({
      lanes: [{ ref: "#l001", title: "Release quality", status: "open", description: "Frame", goal_refs: ["#alice#g001"] }],
      goals: [{
        ref: "#alice#g001", title: "Ship integration", status: "in_progress",
        lane_id: "l001", plan: "Implement then test",
        tasks: [{
          ref: "#alice#g001#t01", title: "Add UI", description: "Native surface",
          status: "open", acceptance_criteria: [{ id: "A1", description: "Renders correctly" }],
        }],
      }],
      warnings: [{ message: "Retained legacy record" }],
    });
    expect(data.lanes[0]).toMatchObject({
      kind: "lane", ref: "#l001", goalRefs: ["#alice#g001"],
    });
    expect(data.goals[0]).toMatchObject({
      kind: "goal", ref: "#alice#g001", laneId: "l001", plan: "Implement then test",
    });
    expect(data.goals[0].tasks[0]).toMatchObject({
      kind: "task", ref: "#alice#g001#t01",
      acceptanceCriteria: [{ id: "A1", description: "Renders correctly" }],
    });
    expect(data.warnings).toEqual(["Retained legacy record"]);
  });

  it("accepts sparse and legacy records without losing refs", () => {
    const data = normalizeBoard({
      lanes: [{ ref: "#l002" }],
      goals: [{ ref: "#g1", tasks: [{ ref: "#g1#t1", acceptance_criteria: ["Build succeeds"] }] }],
      warnings: [],
    });
    expect(data.goals[0].tasks[0].acceptanceCriteria[0].id).toBe("A1");
    expect(data.lanes[0].goalRefs).toEqual([]);
  });
});
