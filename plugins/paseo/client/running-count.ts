import { isActiveAgent, type Execution } from "../shared/work";

/** Count active Paseo agents once even when a session appears in multiple work rows. */
export function uniqueRunningAgentCount(executions: readonly Execution[]): number {
  const ids = new Set<string>();
  for (const execution of executions) {
    for (const agent of execution.agents) {
      if (isActiveAgent(agent) && !agent.requiresAttention && agent.status !== "attention") ids.add(agent.id);
    }
  }
  return ids.size;
}
