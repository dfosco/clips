import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { ActivityIndicator, Text } from "react-native";
import { AgentConfigFields } from "./agent-configuration";
import { preferences, type Preferences } from "../shared/contracts";
import { FULL_ACCESS_MODE } from "../shared/permission-modes";

function SettingsForm({
  hostId, initial, saving, error, onSave, theme,
}: {
  hostId: string;
  initial: Preferences;
  saving: boolean;
  error: string | null;
  onSave: (values: Preferences) => Promise<boolean>;
  theme: PluginSurfaceProps["theme"];
}) {
  const [draft, setDraft] = useState(initial);
  const changed = draft.agent !== initial.agent || draft.thinkingOptionId !== initial.thinkingOptionId ||
    draft.modeId !== initial.modeId ||
    JSON.stringify(draft.featureValues) !== JSON.stringify(initial.featureValues);
  return (
    <SettingsSection title="Agent execution">
      <SettingsCard>
        <AgentConfigFields
          theme={theme}
          hostId={hostId}
          agent={draft.agent}
          thinkingOptionId={draft.thinkingOptionId}
          featureValues={draft.featureValues}
          modeId={draft.modeId}
          onAgentChange={(agent) => setDraft((current) => ({
            ...current, agent, thinkingOptionId: "", featureValues: {}, modeId: FULL_ACCESS_MODE,
          }))}
          onThinkingChange={(thinkingOptionId) => setDraft((current) => ({ ...current, thinkingOptionId }))}
          onFeatureValuesChange={(featureValues) => setDraft((current) => ({ ...current, featureValues }))}
          onModeChange={(modeId) => setDraft((current) => ({ ...current, modeId }))}
          allowAutomatic
          modelHint="Default model for new Lane, Goal and Task agents. Automatic uses the first ready Paseo model."
        />
        <SettingsAction
          label={error ? "Save failed" : "Agent defaults"}
          hint={error ?? "New agents use these defaults. Per-session choices do not change them."}
          actionLabel={saving ? "Saving…" : "Save"}
          disabled={saving || !changed}
          onPress={() => void onSave(draft)}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export function SettingsScreen({ theme, host }: PluginSurfaceProps) {
  const settings = useSettings(preferences);
  if (settings.status === "loading") return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (settings.status === "error" || settings.status === "invalid") {
    return <Text style={{ color: theme.colors.statusDanger }}>Clips settings unavailable: {settings.error}</Text>;
  }
  return (
    <SettingsForm
      key={settings.revision}
      hostId={host.id}
      initial={settings.values}
      saving={settings.saving}
      error={settings.saveError}
      theme={theme}
      onSave={(values) => settings.save(values, settings.revision)}
    />
  );
}
