import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { MarkdownInline } from "./markdown-inline";
import { reviewOpenRpc, type ReviewOpenData } from "../shared/contracts";

type Theme = PluginSurfaceProps["theme"];

function MarkdownBody({ markdown, theme }: { markdown: string; theme: Theme }) {
  return <ScrollView accessibilityLabel="Pinned review Markdown" style={{ flex: 1, minHeight: 0, width: "100%" }}
    contentContainerStyle={{ gap: 9, padding: 20, alignSelf: "stretch", maxWidth: 920, width: "100%" }}>
    {markdown.split(/\r?\n/).map((line, index) => {
      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      const list = line.match(/^\s*([-*+] |\d+\. )(.+)$/);
      const quote = line.match(/^\s*>\s?(.*)$/);
      const content = heading?.[2] ?? list?.[2] ?? quote?.[1] ?? line;
      return <Text key={index} selectable style={{ color: theme.colors.foreground,
        fontSize: heading ? Math.max(12, 19 - heading[1].length) : 13,
        fontWeight: heading ? "700" : "400", lineHeight: 20,
        fontStyle: quote ? "italic" : "normal" }}>
        {list ? "• " : ""}{<MarkdownInline source={content} theme={theme} />}
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

function pinnedBody(markdown: string) {
  const marker = /^## Pinned change request\s*\r?\n/m;
  const match = marker.exec(markdown);
  return match ? markdown.slice(match.index + match[0].length).trimStart() : markdown;
}

export function ReviewDocument({ theme, projectId, ref, onClose }: {
  theme: Theme;
  projectId: string;
  ref: string;
  onClose: () => void;
}) {
  const openReview = useRpc(reviewOpenRpc);
  const query = useQuery({
    queryKey: ["clips.review.open", projectId, ref],
    queryFn: () => openReview({ projectId, ref }),
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const data = query.data;
  return <View accessibilityLabel={`Review · ${ref}`} style={{ flex: 1, minHeight: 0, backgroundColor: theme.colors.surface0 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to work" onPress={onClose}
        style={{ minHeight: 42, justifyContent: "center", paddingHorizontal: 12, borderRadius: 7, backgroundColor: theme.colors.surface2 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 15, fontWeight: "700" }}>‹ Back</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 18, fontWeight: "700" }}>Pinned review · {ref}</Text>
        <Text style={{ color: data?.review.stale ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 12 }}>
          Pinned CR snapshot · {data ? data.review.stale ? `Stale · ${data.review.stale_reasons.join(", ") || "review changed"}` : "Current" : ""}
        </Text>
      </View>
      {data ? <Pressable accessibilityRole="button" accessibilityLabel={`${detailsOpen ? "Hide" : "Show"} review details`}
        accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen((open) => !open)} style={{ padding: 10 }}>
        <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>{detailsOpen ? "Hide details" : "Details"}</Text>
      </Pressable> : null}
    </View>
    {query.isLoading ? <View accessibilityRole="progressbar" style={{ padding: 20 }}>
        <ActivityIndicator color={theme.colors.foregroundMuted} />
        <Text style={{ color: theme.colors.foregroundMuted, textAlign: "center" }}>Opening pinned Markdown…</Text>
      </View> : null}
      {query.isError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger, padding: 20 }}>
        Pinned review unavailable: {query.error instanceof Error ? query.error.message : String(query.error)}
      </Text> : null}
      {data ? <View style={{ flex: 1, minHeight: 0, alignItems: "center" }}>
        {detailsOpen ? <View accessibilityLabel="Review details" style={{ width: "100%", maxWidth: 960,
          paddingHorizontal: 20, paddingVertical: 10, gap: 5, borderBottomWidth: 1, borderBottomColor: theme.colors.border }}>
          {openedLabel(data).map((line) => <Text key={line} selectable style={{ color: line.startsWith("Stale: ") && data.review.stale
            ? theme.colors.statusDanger : theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>{line}</Text>)}
          <Text selectable accessibilityLabel="Pinned Markdown export path" style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>
            File: {data.path}
          </Text>
        </View> : null}
        <View style={{ width: "100%", maxWidth: 960, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 6 }}>
          <Text accessibilityRole="header" style={{ color: theme.colors.foreground, fontSize: 24, lineHeight: 31, fontWeight: "700" }}>
            {data.review.title}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, paddingTop: 3 }}>Pinned change request</Text>
        </View>
        <MarkdownBody markdown={pinnedBody(data.markdown)} theme={theme} />
      </View> : null}
  </View>;
}
