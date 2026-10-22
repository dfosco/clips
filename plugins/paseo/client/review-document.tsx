import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Modal, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import { reviewOpenRpc, type ReviewOpenData } from "../shared/contracts";

type Theme = PluginSurfaceProps["theme"];

function markdownInline(source: string, theme: Theme) {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let cursor = 0;
  let index = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(source.slice(cursor, start));
    if (match[2] !== undefined) {
      const url = safeReviewContentUrl(match[3]);
      nodes.push(url ? <Text key={index++} accessibilityRole="link" onPress={() => void Linking.openURL(url)}
        style={{ color: theme.colors.accent, textDecorationLine: "underline" }}>{match[2]}</Text> : match[2]);
    } else if (match[4] !== undefined) {
      nodes.push(<Text key={index++} selectable style={{ fontFamily: "monospace" }}>{match[4]}</Text>);
    } else if (match[5] !== undefined) {
      nodes.push(<Text key={index++} style={{ fontWeight: "700" }}>{match[5]}</Text>);
    } else {
      nodes.push(<Text key={index++} style={{ fontStyle: "italic" }}>{match[6]}</Text>);
    }
    cursor = start + match[0].length;
  }
  if (cursor < source.length) nodes.push(source.slice(cursor));
  return nodes;
}

function safeReviewContentUrl(value: string) {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const normalized = new URL(value).toString();
    const authority = normalized.match(/^https?:\/\/([^/?#]*)/i)?.[1];
    return authority && !authority.includes("@") ? normalized : null;
  } catch { return null; }
}

function MarkdownBody({ markdown, theme, compact }: { markdown: string; theme: Theme; compact: boolean }) {
  return <ScrollView accessibilityLabel="Pinned review Markdown" style={{ maxHeight: compact ? 320 : 500, minHeight: 120 }}
    contentContainerStyle={{ gap: 5, padding: 12, borderWidth: 1, borderColor: theme.colors.border,
      borderRadius: 8, backgroundColor: theme.colors.surface1 }}>
    {markdown.split(/\r?\n/).map((line, index) => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const list = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
      const quote = line.match(/^\s*>\s?(.*)$/);
      const content = heading?.[2] ?? list?.[2] ?? quote?.[1] ?? line;
      return <Text key={index} selectable style={{ color: theme.colors.foreground,
        fontSize: heading ? Math.max(12, 19 - heading[1].length) : 13,
        fontWeight: heading ? "700" : "400", lineHeight: 20,
        fontStyle: quote ? "italic" : "normal" }}>
        {list ? "• " : ""}{markdownInline(content, theme)}
      </Text>;
    })}
  </ScrollView>;
}

function openedLabel(data: ReviewOpenData) {
  const { review } = data;
  const lines = [
    `Work record: ${review.ref}`,
    `Review: ${review.id} · ${review.status}`,
    `Assigned reviewer: ${review.reviewer}`,
    `Candidate base: ${review.candidate.base}${review.candidate.base_ref ? ` (${review.candidate.base_ref})` : ""}`,
    `Candidate head: ${review.candidate.head}${review.candidate.head_ref ? ` (${review.candidate.head_ref})` : ""}`,
  ];
  if (review.stale || review.stale_reasons.length) lines.push(`Stale: ${review.stale_reasons.join(", ") || "yes"}`);
  else lines.push("Stale: no");
  return lines;
}

export function ReviewDocument({ theme, projectId, ref, compact, onClose }: {
  theme: Theme;
  projectId: string;
  ref: string;
  compact: boolean;
  onClose: () => void;
}) {
  const openReview = useRpc(reviewOpenRpc);
  const query = useQuery({
    queryKey: ["clips.review.open", projectId, ref],
    queryFn: () => openReview({ projectId, ref }),
  });
  const data = query.data;
  return <Modal title={`Review · ${ref}`} open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Modal.Content scrollable={false}>
      {query.isLoading ? <View accessibilityRole="progressbar" style={{ padding: 20 }}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
        <Text style={{ color: theme.colors.foregroundMuted, textAlign: "center" }}>Opening pinned Markdown…</Text>
      </View> : null}
      {query.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>
        Pinned review unavailable: {query.error instanceof Error ? query.error.message : String(query.error)}
      </Text> : null}
      {data ? <View style={{ gap: 8 }}>
        {openedLabel(data).map((line) => <Text key={line} selectable style={{ color: line.startsWith("Stale: ") && data.review.stale
          ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{line}</Text>)}
        <Text selectable accessibilityLabel="Pinned Markdown export path" style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
          File: {data.path}
        </Text>
        <MarkdownBody markdown={data.markdown} theme={theme} compact={compact} />
      </View> : null}
      <View style={{ flexDirection: "row", justifyContent: "flex-end", paddingTop: 10 }}>
        <Pressable accessibilityRole="button" onPress={onClose}
          style={{ paddingVertical: 8, paddingHorizontal: 12, borderRadius: 7, backgroundColor: theme.colors.surface2 }}>
          <Text style={{ color: theme.colors.foreground }}>Close</Text>
        </Pressable>
      </View>
    </Modal.Content>
  </Modal>;
}
