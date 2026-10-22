
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  agentOptionsRpc, attachmentReadRpc, boardRpc, collaborationRpc, labelUsesRpc, labelsRpc,
  roleModelDefaultsRpc, saveRoleModelDefaultsRpc, reviewListRpc, reviewOpenRpc, reviewShowRpc, reviewDecideRpc, reviewImportRpc,
  closeRpc, preferences, projectsRpc, startRpc,
} from "./shared/contracts";
import {
  closeWork, changeProjectLabels, projectList, readAgentOptions, readProjectAttachment,
  readProjectBoard, readProjectLabelUses, setProjectCollaboration, startWork,
  readRoleModelDefaults, saveRoleModelDefaults, readProjectReviews, readProjectReview, openProjectReview, decideProjectReview, importProjectReviewDecision,
} from "./server/backend";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(preferences);
  server.handle(projectsRpc, (_input, { paseo }) => projectList(paseo));
  server.handle(boardRpc, (input, { paseo }) => readProjectBoard(paseo, input.projectId));
  server.handle(attachmentReadRpc, (input, { paseo }) => readProjectAttachment(paseo, input));
  server.handle(collaborationRpc, (input, { paseo }) => setProjectCollaboration(paseo, input));
  server.handle(agentOptionsRpc, (input, { paseo }) => readAgentOptions(paseo, input));
  server.handle(roleModelDefaultsRpc, async (input, { paseo }) => {
    const state = await settings.read();
    const values = state.status === "ready" ? state.values : preferences.schema.parse({});
    return readRoleModelDefaults(paseo, input.role, values, {
      projectId: input.projectId, legacyDisabled: input.legacyDisabled || values.roles[input.role].legacyModelMigrated,
    });
  });
  server.handle(saveRoleModelDefaultsRpc, (input, { paseo }) => saveRoleModelDefaults(paseo, input));
  server.handle(reviewListRpc, (input, { paseo }) => readProjectReviews(paseo, input.projectId));
  server.handle(reviewOpenRpc, (input, { paseo }) => openProjectReview(paseo, input));
  server.handle(reviewShowRpc, (input, { paseo }) => readProjectReview(paseo, input));
  server.handle(reviewDecideRpc, (input, { paseo }) => decideProjectReview(paseo, {
    ...input, expectedRevision: input.expectedRevision,
  }));
  server.handle(reviewImportRpc, (input, { paseo }) => importProjectReviewDecision(paseo, input));
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
