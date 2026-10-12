
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import {
  boardRpc, projectsRpc, startRpc,
  type Goal, type Lane, type Project, type StartMode, type Work,
} from "../shared/contracts";
import { executionFor, type Execution } from "../shared/work";
import { useRuntime } from "./runtime";

type Filter = "all" | "running" | "active";
type Theme = PluginScreenProps["theme"];
type Navigation = PluginScreenProps["navigation"];
type Start = (ref: string, mode: StartMode) => void;

const isActive = (status: string) => !["closed", "not_planned", "duplicate"].includes(status);
const short = (value: string, limit = 180) => value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function Action({
  label,
  onPress,
  theme,
  subtle = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  theme: Theme;
  subtle?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderWidth: 1,
        borderColor: subtle ? theme.colors.border : theme.colors.accent,
        borderRadius: 7,
        opacity: disabled ? 0.45 : pressed ? 0.7 : 1,
        backgroundColor: subtle ? theme.colors.surface1 : theme.colors.accent,
      })}
    >
      <Text style={{
        color: subtle ? theme.colors.foreground : theme.colors.accentForeground,
        fontSize: 12,
        fontWeight: "600",
      }}>{label}</Text>
    </Pressable>
  );
}

function RuntimeLabel({ execution, theme, loaded }: { execution: Execution; theme: Theme; loaded: boolean }) {
  if (!loaded) return <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>Checking Paseo…</Text>;
  const labels = {
    running: `● Running · ${execution.runningAgents} agent${execution.runningAgents === 1 ? "" : "s"}`,
    attention: "● Needs input",
    error: "● Agent error",
    idle: "● Workspace idle",
    none: "No workspace",
  };
  const color = execution.status === "running" ? theme.colors.statusSuccess :
    execution.status === "attention" ? theme.colors.statusWarning :
    execution.status === "error" ? theme.colors.statusDanger :
    theme.colors.foregroundMuted;
  return <Text style={{ color, fontSize: 12, fontWeight: execution.status === "running" ? "600" : "400" }}>{labels[execution.status]}</Text>;
}

function WorkRow({
  work, level, execution, loaded, expanded, onToggle, onStart, onOpen,
  busy, theme, compact,
}: {
  work: Work;
  level: number;
  execution: Execution;
  loaded: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStart: Start;
  onOpen: (id: string) => void;
  busy: boolean;
  theme: Theme;
  compact: boolean;
}) {
  const canStart = isActive(work.status);
  const hasWorkspace = Boolean(execution.workspaceId);
  const running = execution.status === "running";
  const needsInput = execution.status === "attention";
  const canStartAgent = loaded && canStart && !running && !needsInput;

  return (
    <View style={{
      paddingLeft: 12 + level * (compact ? 13 : 22),
      paddingRight: 12,
      paddingVertical: level === 2 ? 10 : 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      gap: 8,
    }}>
      <View style={{
        flexDirection: compact ? "column" : "row",
        alignItems: compact ? "stretch" : "center",
        gap: 10,
      }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${work.kind} ${work.ref}`}
          onPress={onToggle}
          style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 8 }}
        >
          <View style={{ paddingTop: 3 }}>
            <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={15} color={theme.colors.foregroundMuted} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 7 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{work.ref}</Text>
              <Text style={{
                color: theme.colors.foregroundMuted, fontSize: 11,
                textTransform: "capitalize",
              }}>{work.status.replace(/_/g, " ")}</Text>
            </View>
            <Text style={{ color: theme.colors.foreground, fontSize: level === 2 ? 14 : 16, fontWeight: "600" }}>
              {work.title}
            </Text>
            {!expanded && work.description ? (
              <Text numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
                {short(work.description)}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", flexWrap: "wrap", gap: 8 }}>
          <RuntimeLabel execution={execution} theme={theme} loaded={loaded} />
          {hasWorkspace ? (
            <Action
              label="Open workspace"
              theme={theme}
              subtle
              onPress={() => onOpen(execution.workspaceId!)}
            />
          ) : null}
          {canStartAgent ? (
            <Action
              label={hasWorkspace ? "Start agent" : "Run in Paseo"}
              theme={theme}
              disabled={busy}
              onPress={() => onStart(work.ref, "agent")}
            />
          ) : null}
          {!hasWorkspace && loaded && canStart ? (
            <Action
              label="Workspace only"
              theme={theme}
              subtle
              disabled={busy}
              onPress={() => onStart(work.ref, "workspace")}
            />
          ) : null}
        </View>
      </View>
      {expanded ? (
        <View style={{ paddingLeft: 23, gap: 9 }}>
          {work.description ? <Text style={{ fontSize: 13, lineHeight: 19, color: theme.colors.foreground }}>{work.description}</Text> : null}
          {work.scope ? <Detail title="Scope" value={work.scope} theme={theme} /> : null}
          {work.plan ? <Detail title="Plan" value={work.plan} theme={theme} /> : null}
          {work.decisions ? <Detail title="Decisions" value={work.decisions} theme={theme} /> : null}
          {work.acceptanceCriteria.length ? (
            <View style={{ gap: 5 }}>
              <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted }}>
                Acceptance criteria
              </Text>
              {work.acceptanceCriteria.map((c) => (
                <Text key={c.id} style={{ fontSize: 12, color: theme.colors.foreground, lineHeight: 18 }}>
                  {c.id} · {c.description}
                </Text>
              ))}
            </View>
          ) : null}
          {execution.agents.length > 0 ? (
            <Text style={{ fontSize: 12, color: theme.colors.foregroundMuted }}>
              Agents: {execution.agents.map((a) => `${a.title || a.id} (${a.status})`).join(", ")}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Detail({ title, value, theme }: { title: string; value: string; theme: Theme }) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ fontSize: 12, fontWeight: "600", color: theme.colors.foregroundMuted }}>{title}</Text>
      <Text style={{ fontSize: 12, lineHeight: 18, color: theme.colors.foreground }}>{value}</Text>
    </View>
  );
}

function ProjectPicker({
  projects, selected, onSelect, theme,
}: {
  projects: Project[];
  selected: string;
  onSelect: (id: string) => void;
  theme: Theme;
}) {
  if (projects.length <= 1) return null;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {projects.map((p) => {
        const active = selected === p.projectId;
        return (
          <Pressable
            accessibilityRole="tab"
            aria-selected={active}
            key={p.projectId}
            onPress={() => onSelect(p.projectId)}
            style={{
              paddingVertical: 8, paddingHorizontal: 12,
              borderRadius: 8, borderWidth: 1,
              borderColor: active ? theme.colors.accent : theme.colors.border,
              backgroundColor: active ? theme.colors.surface2 : theme.colors.surface1,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: active ? "600" : "400", color: theme.colors.foreground }}>
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function FilterChip({
  title, selected, count, onPress, theme,
}: {
  title: string;
  selected: boolean;
  count?: number;
  onPress: () => void;
  theme: Theme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      aria-pressed={selected}
      accessibilityLabel={`Show ${title.toLowerCase()} Clips work`}
      onPress={onPress}
      style={{
        paddingVertical: 7, paddingHorizontal: 11,
        borderWidth: 1, borderRadius: 999,
        borderColor: selected ? theme.colors.accent : theme.colors.border,
        backgroundColor: selected ? theme.colors.surface2 : "transparent",
      }}
    >
      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontWeight: selected ? "600" : "400" }}>
        {title}{count === undefined ? "" : ` · ${count}`}
      </Text>
    </Pressable>
  );
}

export function WorkScreen({
  theme, layout, host, navigation, onOpenSettings,
}: PluginScreenProps & { onOpenSettings?: () => void }) {
  const fetchProjects = useRpc(projectsRpc);
  const fetchBoard = useRpc(boardRpc);
  const launch = useRpc(startRpc);
  const cache = useQueryClient();
  const toast = useToast();

  const projects = useQuery({ queryKey: ["clips.projects", host.id], queryFn: () => fetchProjects({}) });
  const [selected, setSelected] = useState<string | null>(null);
  const project = projects.data?.projects.find((p) => p.projectId === selected) ?? projects.data?.projects[0];
  const projectId = project?.projectId;
  const board = useQuery({
    queryKey: ["clips.board", host.id, projectId],
    queryFn: () => fetchBoard({ projectId: projectId! }),
    enabled: Boolean(projectId),
  });
  const runtime = useRuntime(host.id);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const loaded = Boolean(runtime.data);
  const emptyExecution: Execution = {
    status: "none", runningAgents: 0, workspaceCount: 0, workspaceId: null, agents: [],
  };

  const live = useMemo(() => {
    const out = new Map<string, Execution>();
    if (!project || !board.data || !runtime.data) return out;
    const targets: Work[] = [
      ...board.data.lanes,
      ...board.data.goals,
      ...board.data.goals.flatMap((goal) => goal.tasks),
    ];
    for (const target of targets) out.set(
      target.ref,
      executionFor(target, project.projectIds, runtime.data.workspaces, runtime.data.agents),
    );
    return out;
  }, [project, board.data, runtime.data]);
  const execution = (work: Work) => live.get(work.ref) ?? emptyExecution;
  const runningTasks = board.data?.goals.flatMap((g) => g.tasks).filter((t) => execution(t).status === "running").length ?? 0;
  const runningGoals = board.data?.goals.filter((g) => execution(g).status === "running").length ?? 0;
  const runningLanes = board.data?.lanes.filter((l) => execution(l).status === "running").length ?? 0;

  const create = useMutation({
    mutationFn: ({ ref, mode }: { ref: string; mode: StartMode }) => launch({ projectId: projectId!, ref, mode }),
    onMutate: ({ ref }) => setPending(ref),
    onSuccess: (result, { ref }) => {
      const outcome = result.alreadyRunning ? "Already running" :
        result.agentId ? `Started ${result.agent} on ${ref}` :
        result.reused ? "Reused workspace" : "Created workspace";
      toast.show(outcome, { variant: "success" });
      void cache.invalidateQueries({ queryKey: ["clips-runtime", host.id] });
      navigation?.openWorkspace({ workspaceId: result.workspaceId });
    },
    onError: (error) => toast.show(message(error), { variant: "error" }),
    onSettled: () => {
      setPending(null);
      void cache.invalidateQueries({ queryKey: ["clips-runtime", host.id] });
      void cache.invalidateQueries({ queryKey: ["clips.board", host.id, projectId] });
    },
  });

  const query = search.toLowerCase().trim();
  const hit = (work: Work) => !query || [work.title, work.ref, work.description].some((v) => v.toLowerCase().includes(query));
  const visible = (work: Work, ancestorHit: boolean) => {
    const statusMatch = filter === "running" ? execution(work).status === "running" :
      filter === "active" ? isActive(work.status) : true;
    return statusMatch && (ancestorHit || hit(work));
  };
  const group = (lane: Lane | null, goals: Goal[]) => {
    const parentHit = lane ? hit(lane) : false;
    const entries = goals.map((goal) => {
      const directHit = hit(goal);
      const tasks = goal.tasks.filter((t) => visible(t, parentHit || directHit));
      const shown = visible(goal, parentHit) || tasks.length > 0;
      return { goal, tasks, shown };
    }).filter((g) => g.shown);
    const showLane = lane ? visible(lane, false) || entries.length > 0 : entries.length > 0;
    return { entries, showLane };
  };
  const toggle = (ref: string) => setExpanded((prev) => ({ ...prev, [ref]: !(prev[ref] ?? false) }));
  const renderWork = (work: Work, level: number) => (
    <WorkRow
      key={work.ref}
      work={work}
      level={level}
      execution={execution(work)}
      loaded={loaded}
      expanded={Boolean(expanded[work.ref])}
      onToggle={() => toggle(work.ref)}
      onStart={(ref, mode) => create.mutate({ ref, mode })}
      onOpen={(workspaceId) => navigation?.openWorkspace({ workspaceId })}
      busy={create.isPending}
      theme={theme}
      compact={layout.compact}
    />
  );
  const renderGoal = (goal: Goal, tasks: typeof goal.tasks) => (
    <View key={goal.ref}>
      {renderWork(goal, 1)}
      {tasks.map((task) => renderWork(task, 2))}
    </View>
  );
  const goalRefsInLanes = new Set((board.data?.lanes ?? []).flatMap((l) => l.goalRefs));
  const ungrouped = (board.data?.goals ?? []).filter((g) => !goalRefsInLanes.has(g.ref));
  const noResults = Boolean(board.data) && !(board.data.lanes.some((l) => {
    const attached = board.data!.goals.filter((g) => l.goalRefs.includes(g.ref));
    return group(l, attached).showLane;
  }) || group(null, ungrouped).showLane);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{
      padding: layout.compact ? 14 : 24, gap: 16, paddingBottom: 64,
    }}>
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 21, fontWeight: "700" }}>Clips work</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            Plan in Clips · Execute in Paseo
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh Clips and Paseo"
          onPress={() => {
            void cache.invalidateQueries({ queryKey: ["clips.projects", host.id] });
            void cache.invalidateQueries({ queryKey: ["clips.board", host.id] });
            void cache.invalidateQueries({ queryKey: ["clips-runtime", host.id] });
          }}
          style={{ padding: 8 }}
        >
          <Icon name="RefreshCw" size={18} color={theme.colors.foregroundMuted} />
        </Pressable>
        {onOpenSettings ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clips Workspaces settings" onPress={onOpenSettings} style={{ padding: 8 }}>
            <Icon name="Settings" size={18} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
      {projects.isLoading ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
      {projects.isError ? <Text style={{ color: theme.colors.statusDanger }}>Could not find Clips projects: {message(projects.error)}</Text> : null}
      {projects.data && !projects.data.projects.length ? (
        <Text style={{ color: theme.colors.foregroundMuted, lineHeight: 21 }}>
          No Paseo Git project on this host has an initialized .clips/ store. Add a project to Paseo and run clips init inside it.
        </Text>
      ) : null}
      {projects.data && project ? (
        <ProjectPicker projects={projects.data.projects} selected={project.projectId}
          onSelect={setSelected} theme={theme} />
      ) : null}
      {project ? (
        <>
          <View style={{
            padding: 14, borderWidth: 1, borderRadius: 10, borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface1, gap: 12,
          }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
              {runtime.data ? `Running now · ${runningTasks} Tasks, ${runningGoals} Goals, ${runningLanes} Lanes` : "Checking live Paseo activity…"}
            </Text>
            {runtime.isError ? (
              <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
                Cannot verify live execution: {message(runtime.error)}. Launch controls are unavailable until runtime can be checked.
              </Text>
            ) : null}
            <TextInput
              accessibilityLabel="Search Clips work"
              placeholder="Search Lanes, Goals and Tasks"
              value={search}
              onChangeText={setSearch}
              placeholderTextColor={theme.colors.foregroundMuted}
              style={{
                paddingVertical: 9, paddingHorizontal: 12,
                borderWidth: 1, borderColor: theme.colors.border, borderRadius: 7,
                color: theme.colors.foreground, backgroundColor: theme.colors.surface0,
                fontSize: 14,
              }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 7 }}>
              <FilterChip title="All" selected={filter === "all"} onPress={() => setFilter("all")} theme={theme} />
              <FilterChip title="Running" count={runtime.data ? runningTasks + runningGoals + runningLanes : undefined}
                selected={filter === "running"} onPress={() => setFilter("running")} theme={theme} />
              <FilterChip title="Active in Clips" selected={filter === "active"} onPress={() => setFilter("active")} theme={theme} />
            </View>
          </View>
          {board.isPending ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
          {board.isError ? <Text style={{ color: theme.colors.statusDanger }}>Could not read Clips: {message(board.error)}</Text> : null}
          {board.data?.warnings.length ? (
            <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
              Clips reported {board.data.warnings.length} data warning(s): {short(board.data.warnings.join("; "), 300)}
            </Text>
          ) : null}
          {board.data?.lanes.map((lane) => {
            const related = board.data!.goals.filter((goal) => lane.goalRefs.includes(goal.ref));
            const { entries, showLane } = group(lane, related);
            if (!showLane) return null;
            return (
              <View key={lane.ref} style={{
                borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
                backgroundColor: theme.colors.surface1, overflow: "hidden",
              }}>
                {renderWork(lane, 0)}
                {entries.map(({ goal, tasks }) => renderGoal(goal, tasks))}
                {entries.length === 0 ? (
                  <Text style={{ color: theme.colors.foregroundMuted, padding: 12, fontSize: 12 }}>
                    No Goals match the current filter.
                  </Text>
                ) : null}
              </View>
            );
          })}
          {(() => {
            const { entries, showLane } = group(null, ungrouped);
            if (!showLane) return null;
            return (
              <View style={{
                borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
                backgroundColor: theme.colors.surface1, overflow: "hidden",
              }}>
                <Text style={{ padding: 13, color: theme.colors.foregroundMuted, fontWeight: "600", fontSize: 13 }}>
                  Goals outside Lanes
                </Text>
                {entries.map(({ goal, tasks }) => renderGoal(goal, tasks))}
              </View>
            );
          })()}
          {noResults ? (
            <Text style={{ padding: 14, color: theme.colors.foregroundMuted }}>
              No Clips work matches this filter. The Running filter only counts active Paseo agents, not Clips records marked in_progress.
            </Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
