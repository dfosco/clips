import { type ReactNode } from "react";
import { Linking, Text } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";

type Theme = PluginSurfaceProps["theme"];

export function safeMarkdownUrl(value: string) {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const normalized = new URL(value).toString();
    const authority = normalized.match(/^https?:\/\/([^/?#]*)/i)?.[1];
    return authority && !authority.includes("@") ? normalized : null;
  } catch { return null; }
}

export function MarkdownInline({ source, theme, onOpenUrl }: {
  source: string;
  theme: Theme;
  onOpenUrl?: (url: string) => void;
}) {
  const nodes: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let cursor = 0;
  let index = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(source.slice(cursor, start));
    if (match[2] !== undefined) {
      const url = safeMarkdownUrl(match[3]);
      nodes.push(url ? <Text key={index++} accessibilityRole="link" onPress={() => {
        if (onOpenUrl) onOpenUrl(url);
        else void Linking.openURL(url);
      }} style={{ color: theme.colors.accent, textDecorationLine: "underline" }}>{match[2]}</Text> : match[2]);
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
