
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo, useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { preferences } from "../shared/contracts";

function ProviderForm({
  initial,
  options,
  saving,
  error,
  onSave,
}: {
  initial: string;
  options: { label: string; value: string }[];
  saving: boolean;
  error: string | null;
  onSave: (agent: string) => Promise<boolean>;
}) {
  const [agent, setAgent] = useState(initial);
  const available = agent && !options.some((option) => option.value === agent)
    ? [{ label: `${agent} (currently unavailable)`, value: agent }]
    : [];
  return (
    <SettingsSection title="Agent execution">
      <SettingsCard>
        <SettingsSelect
          label="Paseo agent"
          hint="Used when starting a new agent for a Lane, Goal or Task. Automatic uses the first ready provider."
          value={agent}
          options={[{ value: "", label: "Automatic" }, ...options, ...available]}
          onValueChange={setAgent}
        />
        <SettingsAction
          label={error ? "Save failed" : "Agent choice"}
          hint={error ?? "Workspaces and agent sessions stay in Paseo. Clips status and acceptance are not changed."}
          actionLabel={saving ? "Saving…" : "Save"}
          disabled={saving || agent === initial}
          onPress={() => void onSave(agent)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  const paseo = usePaseo();
  const providers = useQuery({
    queryKey: ["clips-providers"],
    queryFn: async () => {
      const snapshot = await paseo.providers.snapshot();
      return snapshot.entries
        .filter((p) => p.status === "ready" && p.enabled !== false)
        .flatMap((p) => (p.models ?? [])
          .filter((m) => m.isSelectable !== false)
          .map((m) => ({ value: `${p.provider}/${m.id}`, label: `${p.label ?? p.provider} · ${m.label ?? m.id}` })));
    },
  });
  if (settings.status === "loading") return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (settings.status === "error" || settings.status === "invalid") {
    return <Text style={{ color: theme.colors.statusDanger }}>Clips settings unavailable: {settings.error}</Text>;
  }
  return (
    <ProviderForm
      key={settings.revision}
      initial={settings.values.agent}
      options={providers.data ?? []}
      saving={settings.saving}
      error={settings.saveError}
      onSave={(agent) => settings.save({ ...settings.values, agent }, settings.revision)}
    />
  );
}
