
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  agentOptionsRpc, attachmentReadRpc, boardRpc, collaborationRpc, labelUsesRpc, labelsRpc,
  closeRpc, preferences, projectsRpc, startRpc,
} from "./shared/contracts";
import {
  closeWork, changeProjectLabels, projectList, readAgentOptions, readProjectAttachment,
  readProjectBoard, readProjectLabelUses, setProjectCollaboration, startWork,
} from "./server/backend";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  server.handle(projectsRpc, (_input, { paseo }) => projectList(paseo));
  server.handle(boardRpc, (input, { paseo }) => readProjectBoard(paseo, input.projectId));
  server.handle(attachmentReadRpc, (input, { paseo }) => readProjectAttachment(paseo, input));
  server.handle(collaborationRpc, (input, { paseo }) => setProjectCollaboration(paseo, input));
  server.handle(agentOptionsRpc, (input, { paseo }) => readAgentOptions(paseo, input));
  server.handle(closeRpc, async (input, { paseo }) => {
    let agentDefaults = preferences.schema.parse({});
    if (input.autoCompleteClosure) {
      try {
        const state = await settings.read();
        if (state.status === "ready") agentDefaults = state.values;
      } catch (error) {
        console.warn(`[paseo] Could not read Lanes agent defaults for lane retrospective: ${String(error)}`);
      }
    }
    return closeWork(paseo, agentDefaults, input);
  });
  server.handle(labelsRpc, (input, { paseo }) => changeProjectLabels(paseo, input));
  server.handle(labelUsesRpc, (input, { paseo }) => readProjectLabelUses(paseo, input));
  server.handle(startRpc, async (input, { paseo }) => {
    const state = await settings.read();
    const agentDefaults = state.status === "ready"
      ? state.values
      : preferences.schema.parse({});
    return startWork(paseo, agentDefaults, input);
  });
  return () => {};
}
