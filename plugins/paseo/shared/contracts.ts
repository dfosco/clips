
import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const preferences = defineSettings({
  id: "preferences",
  scope: "host",
  version: 1,
  schema: z.object({
    agent: z.string().default(""),
  }),
});
export type Preferences = z.infer<typeof preferences.schema>;

const criterion = z.object({ id: z.string(), description: z.string() });
export const workItem = z.object({
  ref: z.string(),
  title: z.string(),
  description: z.string(),
  status: z.string(),
  plan: z.string(),
  decisions: z.string(),
  scope: z.string(),
  acceptanceCriteria: z.array(criterion),
});
export const task = workItem.extend({ kind: z.literal("task") });
export const goal = workItem.extend({
  kind: z.literal("goal"),
  type: z.string(),
  laneId: z.string().nullable(),
  tasks: z.array(task),
});
export const lane = workItem.extend({
  kind: z.literal("lane"),
  goalRefs: z.array(z.string()),
});
export type Task = z.infer<typeof task>;
export type Goal = z.infer<typeof goal>;
export type Lane = z.infer<typeof lane>;
export type Work = Task | Goal | Lane;
export const project = z.object({
  projectId: z.string(),
  label: z.string(),
  projectIds: z.array(z.string()),
});
export type Project = z.infer<typeof project>;

export const projectsRpc = defineRpc({
  name: "clips.projects",
  input: z.object({}),
  output: z.object({ projects: z.array(project) }),
});
export const boardRpc = defineRpc({
  name: "clips.board",
  input: z.object({ projectId: z.string() }),
  output: z.object({
    lanes: z.array(lane),
    goals: z.array(goal),
    warnings: z.array(z.string()),
  }),
});
export const START_MODES = ["workspace", "agent"] as const;
export type StartMode = (typeof START_MODES)[number];

export const startRpc = defineRpc({
  name: "clips.start",
  input: z.object({ projectId: z.string(), ref: z.string(), mode: z.enum(START_MODES) }),
  output: z.object({
    workspaceId: z.string(),
    branch: z.string(),
    agentId: z.string().nullable(),
    agent: z.string().nullable(),
    reused: z.boolean(),
    alreadyRunning: z.boolean(),
  }),
});
