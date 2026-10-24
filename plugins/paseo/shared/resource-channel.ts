import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const identity = z.string().trim().min(1).max(256);
export const handoffReason = z.enum(["completed", "resource_warning", "resource_critical", "reassignment"]);
export const handoffReceipt = z.object({
  handoffId: z.string().uuid(), managerId: identity, agentId: identity,
  goalRef: z.string(), sourceRef: z.string(), context: z.string(), incomplete: z.boolean(),
  attachment: z.object({ id: z.string(), type: z.literal("markdown"), path: z.string(), title: z.string() }),
  recordedAt: z.number(),
});
export type HandoffReceipt = z.infer<typeof handoffReceipt>;

export const resourceChannelInput = z.object({
  managerId: identity,
  action: z.enum(["status", "reserve", "report", "release"]).default("status"),
  requestId: z.string().min(1).max(128).optional(),
  count: z.number().int().positive().max(10000).optional(),
  reservationId: identity.optional(),
  agentIds: z.array(identity).max(10000).optional(),
}).strict();
export type ResourceChannelInput = z.infer<typeof resourceChannelInput>;
export const resourceChannelRpc = defineRpc({
  name: "clips.resources.channel", input: resourceChannelInput,
  output: z.object({
    available: z.boolean(), pressure: z.enum(["normal", "warning", "critical"]),
    observedAt: z.number().nullable(), expiresAt: z.number().nullable(),
    activeDevCount: z.number().int().nonnegative(), managerActiveDevCount: z.number().int().nonnegative(),
    additionalDevCapacity: z.number().int().nonnegative(), managerReservedCount: z.number().int().nonnegative(),
    reservations: z.array(z.object({
      id: z.string(), requestId: z.string(), count: z.number().int().nonnegative(),
      expiresAt: z.number(), agentIds: z.array(z.string()), valid: z.boolean(),
    })),
    holdReason: z.string().nullable(),
    pendingHandoffs: z.array(handoffReceipt),
  }),
});

export const resourceHandoffInput = z.object({
  managerId: identity, agentId: identity, handoffId: z.string().uuid().transform((value) => value.toLowerCase()).optional(),
  context: z.string().trim().min(1).max(64 * 1024), reason: handoffReason.default("completed"),
}).strict();
export type ResourceHandoffInput = z.infer<typeof resourceHandoffInput>;
export const resourceHandoffRpc = defineRpc({
  name: "clips.resources.handoff", input: resourceHandoffInput, output: handoffReceipt,
});

export const resourceFoldInput = z.object({
  managerId: identity, agentId: identity, handoffId: z.string().uuid().transform((value) => value.toLowerCase()).optional(),
}).strict();
export type ResourceFoldInput = z.infer<typeof resourceFoldInput>;
export const resourceFoldRpc = defineRpc({
  name: "clips.resources.fold", input: resourceFoldInput,
  output: z.object({
    agentId: identity, closed: z.boolean(), critical: z.boolean(),
    handoff: handoffReceipt.nullable(), error: z.string().nullable(),
  }),
});
