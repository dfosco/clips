import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { MarkdownInline } from "./markdown-inline";
import { attachmentReadRpc, type Attachment, type AttachmentReadData } from "../shared/contracts";

type Theme = PluginSurfaceProps["theme"];

function InlineMarkdown({ source, theme, onOpenUrl }: { source: string; theme: Theme; onOpenUrl: (url: string) => void }) {
  return <View style={{ gap: 8, width: "100%", maxWidth: 920, paddingHorizontal: 20, paddingVertical: 18 }}>
    {source.split(/\r?\n/).map((line, index) => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const list = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
      const quote = line.match(/^\s*>\s?(.*)$/);
      const content = heading?.[2] ?? list?.[2] ?? quote?.[1] ?? line;
      return <Text key={index} selectable style={{ color: theme.colors.foreground,
        fontSize: heading ? Math.max(14, 24 - heading[1].length * 2) : 15,
        fontWeight: heading ? "700" : "400", lineHeight: 24, fontStyle: quote ? "italic" : "normal" }}>
        {list ? "• " : ""}<MarkdownInline source={content} theme={theme} onOpenUrl={onOpenUrl} />
      </Text>;
    })}
  </View>;
}

export function AttachmentDocument({ theme, projectId, ref, attachment, onOpenUrl, onClose, onOpenPinnedReview }: {
  theme: Theme;
  projectId: string;
  ref: string;
  attachment: Attachment;
  onOpenUrl: (url: string) => void;
  onClose: () => void;
  onOpenPinnedReview?: () => void;
}) {
  const readAttachment = useRpc(attachmentReadRpc);
  const [result, setResult] = useState<AttachmentReadData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await readAttachment({ projectId, ref, attachmentId: attachment.id });
      if (result.ref !== ref || result.attachment.id !== attachment.id) {
        throw new Error("Lanes returned a different record or attachment.");
      }
      setResult(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setResult(null);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, [projectId, ref, attachment.id]);
  const current = result?.attachment;
  const status = current?.status ?? attachment.status;
  const hasContent = status === "available" && typeof current?.content === "string";
  return <View accessibilityLabel={`Current attachment · ${ref} · ${attachment.id}`}
    style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to work" onPress={onClose}
        style={{ minHeight: 42, justifyContent: "center", paddingHorizontal: 12, borderRadius: 7, backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "700" }}>‹ Back</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "700" }}>{attachment.title || "Markdown attachment"}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Current attached Markdown · {ref} · {attachment.id}</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Refresh current attachment"
        onPress={() => { void refresh(); }} style={{ padding: 10 }}>
        <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>Refresh</Text>
      </Pressable>
    </View>
    {attachment.purpose === "cr" && onOpenPinnedReview ? <View style={{ flexDirection: "row", alignItems: "center", gap: 8,
      paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Text style={{ flex: 1, color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
        This is the current attachment file. A requested review uses its own pinned snapshot.
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open pinned Review for ${ref}`} onPress={onOpenPinnedReview}>
        <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>Open pinned Review</Text>
      </Pressable>
    </View> : null}
    {loading ? <View accessibilityRole="progressbar" style={{ padding: 24, gap: 8 }}>
      <ActivityIndicator color={theme.colors.foregroundMuted} />
      <Text style={{ color: theme.colors.foregroundMuted, textAlign: "center" }}>Reading current attachment…</Text>
    </View> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, padding: 20 }}>
      Could not read current Markdown: {error}
    </Text> : null}
    {current && !hasContent ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusWarning, padding: 20 }}>
      {current.error || (status === "missing" ? "The attached Markdown file is missing." :
        status === "unreadable" ? "The attached Markdown file cannot be read." : "The Markdown reference is invalid.")}
    </Text> : null}
    {hasContent ? <ScrollView accessibilityLabel="Current attachment Markdown" style={{ flex: 1, minHeight: 0, width: "100%" }}
      contentContainerStyle={{ alignItems: "center", paddingBottom: 30 }}>
      <InlineMarkdown source={current!.content!} theme={theme} onOpenUrl={onOpenUrl} />
    </ScrollView> : null}
  </View>;
}
