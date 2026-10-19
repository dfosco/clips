import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/react-native";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { Label, LabelChange, Work } from "../shared/contracts";

type Theme = PluginScreenProps["theme"];
export const LABEL_COLORS = [
  ["Gray", "#737373"], ["Red", "#ef4444"], ["Orange", "#f97316"],
  ["Yellow", "#eab308"], ["Green", "#22c55e"], ["Teal", "#14b8a6"],
  ["Blue", "#3b82f6"], ["Violet", "#8b5cf6"], ["Pink", "#ec4899"],
] as const;

export function LabelChips({ labels, theme }: { labels: Label[]; theme: Theme }) {
  if (!labels.length) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
      {labels.map((label) => (
        <View key={label.id} accessibilityLabel={`Label: ${label.name}`} style={{
          flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%",
          borderRadius: 999, borderWidth: 1, borderColor: label.color,
          backgroundColor: theme.colors.surface2, paddingHorizontal: 7, paddingVertical: 3,
        }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: label.color }} />
          <Text style={{ color: theme.colors.foreground, fontSize: 11, flexShrink: 1 }}>{label.name}</Text>
        </View>
      ))}
    </View>
  );
}

function Button({ title, onPress, theme, disabled = false }: {
  title: string; onPress: () => void; theme: Theme; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
      style={{ padding: 9, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, opacity: disabled ? 0.45 : 1 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{title}</Text>
    </Pressable>
  );
}

function LabelForm({ initial, busy, theme, onSave, onCancel, onDelete }: {
  initial: Label | null; busy: boolean; theme: Theme;
  onSave: (name: string, color: string) => Promise<boolean>;
  onCancel: () => void; onDelete?: () => Promise<boolean>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? "#8b5cf6");
  const colors = LABEL_COLORS.some(([, value]) => value === color)
    ? LABEL_COLORS : [...LABEL_COLORS, ["Current", color] as const];
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{initial ? "Edit project label" : "Create project label"}</Text>
      <TextInput accessibilityLabel="Label name" placeholder="Label name" value={name} onChangeText={setName}
        maxLength={80} editable={!busy} placeholderTextColor={theme.colors.foregroundMuted}
        style={{ color: theme.colors.foreground, backgroundColor: theme.colors.surface0,
          borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7, padding: 10 }} />
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Color</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Label color" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {colors.map(([title, value]) => (
          <Pressable key={value} accessibilityRole="radio" accessibilityLabel={title}
            accessibilityState={{ checked: color === value, disabled: busy }} disabled={busy} onPress={() => setColor(value)}
            style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surface1,
              padding: 6, borderWidth: 2, borderColor: color === value ? theme.colors.foreground : theme.colors.border }}>
            <View style={{ flex: 1, borderRadius: 12, backgroundColor: value }} />
          </Pressable>
        ))}
      </View>
      {initial ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Changes apply everywhere in this project. Remove all assignments before deleting this label.
      </Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button title={initial ? "Save label" : "Create label"} theme={theme} disabled={busy || !name.trim()}
          onPress={() => { void onSave(name.trim(), color).then((saved) => { if (saved) onCancel(); }); }} />
        <Button title="Back to labels" theme={theme} disabled={busy} onPress={onCancel} />
        {onDelete ? <Button title="Delete project label" theme={theme} disabled={busy}
          onPress={() => { void onDelete().then((deleted) => { if (deleted) onCancel(); }); }} /> : null}
      </View>
    </View>
  );
}

export function LabelManager({ work, catalog, theme, busy, onChange, onClose }: {
  work: Work; catalog: Label[]; theme: Theme; busy: boolean;
  onChange: (change: LabelChange) => Promise<unknown>; onClose: () => void;
}) {
  const [editing, setEditing] = useState<Label | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const change = async (input: LabelChange) => {
    setError(null);
    try { await onChange(input); return true; }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
  };
  const assigned = new Set((work.labels ?? []).map((label) => label.id));
  const matching = catalog.filter((label) => label.name.toLowerCase().includes(search.trim().toLowerCase()));
  return (
    <Modal title={`Labels · ${work.ref}`} open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Content>
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{error}</Text> : null}
        {editing ? (
          <LabelForm key={editing === "new" ? "new" : editing.id} initial={editing === "new" ? null : editing}
            theme={theme} busy={busy} onCancel={() => { setEditing(null); setError(null); }}
            onSave={(name, color) => change(editing === "new" ? { action: "create", name, color }
              : { action: "edit", id: editing.id, name, color })}
            onDelete={editing === "new" ? undefined : () => change({ action: "delete", id: editing.id })} />
        ) : (
          <>
            <TextInput accessibilityLabel="Search project labels" placeholder="Search labels" value={search}
              onChangeText={setSearch} placeholderTextColor={theme.colors.foregroundMuted}
              style={{ color: theme.colors.foreground, padding: 10, borderWidth: 1,
                borderColor: theme.colors.border, borderRadius: 7, backgroundColor: theme.colors.surface0 }} />
            {matching.map((label) => (
              <View key={label.id} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Pressable accessibilityRole="checkbox" accessibilityLabel={`Assign ${label.name} to ${work.ref}`}
                  accessibilityState={{ checked: assigned.has(label.id), disabled: busy }} disabled={busy}
                  onPress={() => { void change({ action: assigned.has(label.id) ? "remove" : "add", ref: work.ref, id: label.id }); }}
                  style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10 }}>
                  <Icon name={assigned.has(label.id) ? "CheckSquare" : "Square"} size={18} color={theme.colors.foregroundMuted} />
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: label.color }} />
                  <Text style={{ color: theme.colors.foreground, flexShrink: 1 }}>{label.name}</Text>
                </Pressable>
                <Button title={`Edit ${label.name}`} theme={theme} disabled={busy} onPress={() => setEditing(label)} />
              </View>
            ))}
            {!matching.length ? <Text style={{ color: theme.colors.foregroundMuted }}>No matching labels.</Text> : null}
            <Button title="Create project label" theme={theme} disabled={busy} onPress={() => setEditing("new")} />
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              Select labels to assign them to this {work.kind}. New labels are added to the project catalog.
            </Text>
          </>
        )}
      </Modal.Content>
    </Modal>
  );
}
