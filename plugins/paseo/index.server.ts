
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { boardRpc, labelsRpc, preferences, projectsRpc, startRpc } from "./shared/contracts";
import { changeProjectLabels, projectList, readProjectBoard, startWork } from "./server/backend";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  server.handle(projectsRpc, (_input, { paseo }) => projectList(paseo));
  server.handle(boardRpc, (input, { paseo }) => readProjectBoard(paseo, input.projectId));
  server.handle(labelsRpc, (input, { paseo }) => changeProjectLabels(paseo, input));
  server.handle(startRpc, async (input, { paseo }) => {
    const state = await settings.read();
    const agent = state.status === "ready" ? state.values.agent : "";
    return startWork(paseo, { agent }, input);
  });
  return () => {};
}
