import { type PluginWorkspacePanelProps, useWorkspace } from "@getpaseo/plugin/client";
import { WorkScreen } from "./work-screen";

export function WorkspaceWorkScreen(props: PluginWorkspacePanelProps & {
  onOpenSettings?: () => void;
  onOpenLanePanel?: (workspaceId: string) => void | Promise<void>;
}) {
  const workspace = useWorkspace(props.workspaceId, ({ projectId, projectDisplayName }) => ({ projectId, projectDisplayName }));
  return <WorkScreen {...props} currentWorkspaceId={props.workspaceId}
    currentWorkspaceProjectId={workspace?.projectId} preferredProjectId={workspace?.projectId} />;
}
