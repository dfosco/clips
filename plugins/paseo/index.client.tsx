
import type { PluginClientContext, PluginSidebarItemProps, PluginScreenProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { WorkScreen } from "./client/work-screen";
import { SettingsScreen } from "./client/settings";

const TITLE = "Clips Workspaces";

function SidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="ListTodo"
      active={currentScreen?.screenId === "work"}
      onPress={() => openScreen({ screenId: "work" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  const Screen = (props: PluginScreenProps) => (
    <WorkScreen {...props} onOpenSettings={() => client.openSettings("preferences")} />
  );
  client.addScreen({ id: "work", title: TITLE, Component: Screen });
  client.addSidebarHeaderItem({ id: "clips", title: TITLE, Component: SidebarItem });
  client.addSettingsScreen({
    id: "preferences",
    title: "Clips Workspaces settings",
    icon: "Settings",
    Component: SettingsScreen,
  });
  client.addCommandCenterItem({
    id: "open-clips",
    title: "Open Clips Workspaces",
    icon: "ListTodo",
    context: "global",
    onSelect: ({ openScreen }) => openScreen({ screenId: "work" }),
  });
  return () => {};
}
