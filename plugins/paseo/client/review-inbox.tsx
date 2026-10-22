import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, Text, TextInput, View, Image } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { projectsRpc, reviewDecideRpc, reviewListRpc, reviewShowRpc, type ReviewDecision } from "../shared/contracts";

type Theme = PluginSurfaceProps["theme"];
const explain = (error: unknown) => error instanceof Error ? error.message : String(error);

const terminalReviewStatuses = new Set(["delivered", "superseded"]);
const reviewStatusLabels: Record<string, string> = {
  awaiting_review: "Awaiting review",
  changes_requested: "Changes requested",
  deferred: "Deferred · awaiting explicit decision",
  approved: "Approved · awaiting delivery",
};
const reviewStatusOrder: Record<string, number> = {
  awaiting_review: 0,
  changes_requested: 1,
  deferred: 2,
  approved: 3,
};

function outstandingReviews<T extends { status: string }>(reviews: T[]) {
  return reviews.filter((entry) => !terminalReviewStatuses.has(entry.status)).sort((a, b) =>
    (reviewStatusOrder[a.status] ?? 4) - (reviewStatusOrder[b.status] ?? 4));
}

function safeHttps(value: string) {
  try {
    const parsed = new URL(value);
    const normalized = parsed.toString();
    return /^https:\/\//i.test(normalized) && !/^https:\/\/[^/]*@/i.test(normalized) ? normalized : null;
  } catch { return null; }
}

function safeReviewContentUrl(value: string) {
  if (!value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    const normalized = new URL(value).toString();
    const authority = normalized.match(/^https?:\/\/([^/?#]*)/i)?.[1];
    return authority && !authority.includes("@") ? normalized : null;
  } catch { return null; }
}

function markdownInline(source: string, theme: Theme) {
  const children: ReactNode[] = [];
  const pattern = /(\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
  let cursor = 0;
  let key = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) children.push(source.slice(cursor, start));
    if (match[2] !== undefined) {
      const url = safeReviewContentUrl(match[3]);
      children.push(url ? <Text key={key++} accessibilityRole="link" onPress={() => void Linking.openURL(url)}
        style={{ color: theme.colors.accent, textDecorationLine: "underline" }}>{match[2]}</Text> : match[2]);
    } else if (match[4] !== undefined) {
      children.push(<Text key={key++} style={{ fontFamily: "monospace" }}>{match[4]}</Text>);
    } else if (match[5] !== undefined) {
      children.push(<Text key={key++} style={{ fontWeight: "700" }}>{match[5]}</Text>);
    } else {
      children.push(<Text key={key++} style={{ fontStyle: "italic" }}>{match[6]}</Text>);
    }
    cursor = start + match[0].length;
  }
  if (cursor < source.length) children.push(source.slice(cursor));
  return children;
}

function CrMarkdown({ source, theme }: { source: string; theme: Theme }) {
  return <ScrollView nestedScrollEnabled style={{ maxHeight: 300, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7 }}
    contentContainerStyle={{ gap: 3, padding: 10 }} accessibilityLabel="Pinned change request content">
    {source.split(/\r?\n/).map((line, index) => {
      const image = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      const imageUrl = image ? safeReviewContentUrl(image[2]) : null;
      if (image && imageUrl) return <Image key={index} source={{ uri: imageUrl }} accessibilityLabel={image[1] || "Change request image"}
        resizeMode="contain" style={{ width: "100%", height: 220 }} />;
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
      const content = heading?.[1] ?? bullet?.[1] ?? line.replace(/^\s*>\s?/, "");
      const children = markdownInline(content, theme);
      return <Text key={index} selectable style={{ color: theme.colors.foreground, fontWeight: heading ? "700" : "400",
        fontSize: heading ? 14 : 12, lineHeight: 18 }}>{bullet ? "• " : ""}{children}</Text>;
    })}
  </ScrollView>;
}

export function ReviewInbox({ theme, initialProjectId }: { theme: Theme; initialProjectId?: string }) {
  const getProjects = useRpc(projectsRpc);
  const getList = useRpc(reviewListRpc);
  const getDetail = useRpc(reviewShowRpc);
  const decide = useRpc(reviewDecideRpc);
  const cache = useQueryClient();
  const projects = useQuery({ queryKey: ["clips.review.projects"], queryFn: () => getProjects({}) });
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const project = projects.data?.projects.find((entry) => entry.projectId === projectId) ?? projects.data?.projects[0];
  const list = useQuery({ queryKey: ["clips.review.list", project?.projectId], queryFn: () => getList({ projectId: project!.projectId }), enabled: Boolean(project) });
  const [reviewId, setReviewId] = useState("");
  useEffect(() => { setReviewId(""); }, [project?.projectId]);
  const visibleReviews = outstandingReviews(list.data?.reviews ?? []);
  const review = visibleReviews.find((entry) => entry.id === reviewId) ?? visibleReviews[0];
  const detail = useQuery({ queryKey: ["clips.review.detail", project?.projectId, review?.id],
    queryFn: () => getDetail({ projectId: project!.projectId, id: review!.id }), enabled: Boolean(project && review) });
  const [actor, setActor] = useState("");
  const [comment, setComment] = useState("");
  const [decision, setDecision] = useState<ReviewDecision>("approved");
  useEffect(() => { setActor(""); setComment(""); }, [project?.projectId, review?.id]);
  const mutation = useMutation({
    mutationFn: (input: { projectId: string; reviewId: string }) => {
      const item = detail.data!;
      if (input.projectId !== project?.projectId || input.reviewId !== item.id) throw new Error("The selected project or review changed. Reopen the current request before deciding.");
      return decide({ projectId: input.projectId, id: item.id, decision, actor, comment,
        candidate: { base: item.candidate.base, head: item.candidate.head }, expectedRevision: item.revision });
    },
    onSuccess: async (updated, input) => {
      cache.setQueryData(["clips.review.detail", input.projectId, updated.id], updated);
      await cache.invalidateQueries({ queryKey: ["clips.review.list", input.projectId] });
    },
  });
  const current = detail.data;
  const actionable = current && ["awaiting_review", "changes_requested", "deferred"].includes(current.status);
  const pinnedContent = current && typeof current.attachment.content === "string" ? current.attachment.content : null;
  const readable = pinnedContent !== null && current?.attachment.read_identity != null;
  const blocked = !actionable || !readable || current?.stale || Boolean(current?.stale_reasons.length) || !actor.trim();
  const savingThisReview = mutation.isPending && mutation.variables?.projectId === project?.projectId && mutation.variables?.reviewId === current?.id;
  const errorThisReview = mutation.isError && mutation.variables?.projectId === project?.projectId && mutation.variables?.reviewId === current?.id;
  const pullRequest = current && typeof current.pull_request === "object" && current.pull_request !== null
    ? current.pull_request as { url?: unknown } : null;
  const externalDecision = current && typeof current.external_decision === "object" && current.external_decision !== null
    ? current.external_decision as { event_id?: unknown; login?: unknown; state?: unknown; submitted_at?: unknown } : null;

  return <SettingsSection title="Review inbox">
    <SettingsCard>
      {projects.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {projects.isError ? <Text style={{ color: theme.colors.statusDanger }}>Projects unavailable: {explain(projects.error)}</Text> : null}
      {project ? <SettingsSelect label="Project" hint="Reviews are read from this project's local Lanes store."
        value={project.projectId} options={(projects.data?.projects ?? []).map((entry) => ({ value: entry.projectId, label: entry.label }))}
        onValueChange={setProjectId} /> : null}
      {list.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {list.isError ? <Text style={{ color: theme.colors.statusDanger }}>Review inbox unavailable: {explain(list.error)}</Text> : null}
      {list.data && !visibleReviews.length ? <Text style={{ color: theme.colors.foregroundMuted }}>No outstanding review requests. Delivered and superseded reviews are hidden.</Text> : null}
      {review ? <>
        <SettingsSelect label="Review request" hint="Selecting another request refreshes its pinned detail."
          value={review.id} options={visibleReviews.map((entry) => ({ value: entry.id,
            label: `${entry.ref} · ${entry.title} · ${reviewStatusLabels[entry.status] ?? entry.status}` }))}
          onValueChange={setReviewId} />
        {detail.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
        {detail.isError ? <Text style={{ color: theme.colors.statusDanger }}>Review detail unavailable: {explain(detail.error)}</Text> : null}
      </> : null}
      {current ? <View style={{ gap: 9, marginTop: 8 }}>
        <Text style={{ color: theme.colors.foreground, fontWeight: "700" }}>{current.ref} · {current.title}</Text>
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Status: {reviewStatusLabels[current.status] ?? current.status} · Review revision r{current.revision}</Text>
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Assigned reviewer: {current.reviewer}</Text>
        {typeof pullRequest?.url === "string" ? <Text selectable accessibilityRole="link"
          onPress={() => { const url = safeHttps(pullRequest.url as string); if (url) void Linking.openURL(url); }}
          style={{ color: theme.colors.accent, fontSize: 12 }}>Linked pull request: {pullRequest.url}</Text> : null}
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Candidate base: {current.candidate.base}{current.candidate.base_ref ? ` (${current.candidate.base_ref})` : ""}</Text>
        <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Candidate head: {current.candidate.head}{current.candidate.head_ref ? ` (${current.candidate.head_ref})` : ""}</Text>
        <Text selectable style={{ color: theme.colors.foreground, fontSize: 13 }}>{current.summary}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Covers: {current.covers.join(", ")}</Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Validation: {JSON.stringify(current.validation, null, 2)}</Text>
        {current.stale || current.stale_reasons.length ? <Text style={{ color: theme.colors.statusDanger }}>Stale candidate: {current.stale_reasons.join(", ") || "Refresh the review before deciding."}</Text> : null}
        {!readable ? <Text style={{ color: theme.colors.statusDanger }}>Pinned change request content is unavailable. This review cannot be decided.</Text> : null}
        {readable ? <CrMarkdown source={pinnedContent!} theme={theme} /> : null}
        {current.decision ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Decision: {String(current.decision)} by {String(current.actor ?? "unknown actor")}. This review decision is separate from engineering acceptance.</Text> : null}
        {externalDecision ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
          Imported GitHub review {String(externalDecision.event_id)} · {String(externalDecision.login)} · {String(externalDecision.state)} · {String(externalDecision.submitted_at)}
        </Text> : null}
        {actionable ? <>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 }}>Enter the name assigned to this review. It must match the assigned reviewer shown above.</Text>
          <TextInput accessibilityLabel="Reviewer name" placeholder="Assigned reviewer name" value={actor} onChangeText={setActor}
            style={{ color: theme.colors.foreground, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, padding: 9 }} />
          <SettingsSelect label="Decision" value={decision} options={[
            { value: "approved", label: "Approve review" }, { value: "changes_requested", label: "Request changes" }, { value: "deferred", label: "Defer review" },
          ]} onValueChange={(value) => setDecision(value as ReviewDecision)} />
          <TextInput accessibilityLabel="Review comment" placeholder="Comment" value={comment} onChangeText={setComment} multiline
            style={{ color: theme.colors.foreground, borderWidth: 1, borderColor: theme.colors.border, borderRadius: 6, padding: 9, minHeight: 72, textAlignVertical: "top" }} />
          {errorThisReview ? <Text style={{ color: theme.colors.statusDanger }}>Decision not recorded: {explain(mutation.error)}</Text> : null}
          <Pressable accessibilityRole="button" disabled={Boolean(blocked) || savingThisReview} onPress={() => mutation.mutate({ projectId: project!.projectId, reviewId: current.id })}
            style={{ alignSelf: "flex-start", borderRadius: 7, backgroundColor: theme.colors.accent, opacity: blocked || savingThisReview ? 0.45 : 1, paddingVertical: 9, paddingHorizontal: 13 }}>
            <Text style={{ color: theme.colors.accentForeground }}>{savingThisReview ? "Recording…" : "Record review decision"}</Text>
          </Pressable>
        </> : null}
      </View> : null}
    </SettingsCard>
  </SettingsSection>;
}
