
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, Modal, ScrollView, useToast } from "@getpaseo/plugin/client/react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import {
  boardRpc, labelsRpc, closeRpc, preferences, projectsRpc, startRpc,
  type AgentConfiguration, type Goal, type Lane, type LaneClosureData, type LabelChange, type Project, type StartMode, type Work,
} from "../shared/contracts";
import { executionFor, executionForManagers, isActiveAgent, type AgentInfo, type Execution } from "../shared/work";
import { AgentLaunchDialog } from "./agent-configuration";
import { navigateToAgent, useRuntime } from "./runtime";
import { focusScope, focusedLane, goalGroup, isActive, revealStartedWorkspace, workspaceLane, type LaneFocus, type WorkFilter } from "./lane-focus";
import { getFocusIntent, getWorkspaceFocusIntent, projectAfterFocusIntent, requestLaneFocus, subscribeFocusIntent } from "./focus-intent";
import { LabelChips, LabelManager } from "./labels";
import { uniqueRunningAgentCount } from "./running-count";

type Theme = PluginSurfaceProps["theme"];
type Start = (ref: string, mode: StartMode, workspaceId?: string) => void;
const UNASSIGNED_CLOSED_GOALS_KEY = "unassigned";

const short = (value: string, limit = 180) => value.length > limit ? `${value.slice(0, limit).trimEnd()}…` : value;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function Action({
  label,
  accessibilityLabel = label,
  onPress,
  theme,
  subtle = false,
  disabled = false,
}: {
  label: string;
  accessibilityLabel?: string;
  onPress: () => void;
  theme: Theme;
  subtle?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
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

function RecordContext({ work, theme }: { work: Lane | Goal; theme: Theme }) {
  const [expanded, setExpanded] = useState(false);
  const description = work.description.trim();
  if (!description) return null;
  const long = description.length > 240;
  const kind = work.kind === "lane" ? "Lane" : "Goal";
  return (
    <View style={{ gap: 4 }}>
      <Text selectable style={{ color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 19 }}>
        {long && !expanded ? short(description, 240) : description}
      </Text>
      {long ? (
        <Pressable accessibilityRole="button"
          accessibilityLabel={`${expanded ? "Collapse" : "Expand"} ${kind} description ${work.ref}`}
          accessibilityState={{ expanded }} onPress={() => setExpanded((value) => !value)}
          style={{ alignSelf: "flex-start", paddingVertical: 6, paddingRight: 8 }}>
          <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>
            {expanded ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function WorkRow({
  work, level, execution, loaded, expanded, onToggle, onStart, onOpen, onOpenAgent, onClose, onFocusLane,
  onToggleClosedGoals, closedGoalsCount = 0, closedGoalsVisible = false,
  busy, theme, compact, onLabels, currentWorkspaceId, workspaceMatchesProject, availableWorkspaces, detailsOnly = false,
}: {
  work: Work;
  level: number;
  execution: Execution;
  loaded: boolean;
  expanded: boolean;
  onToggle: () => void;
  onStart: Start;
  onOpen: (id: string) => void;
  onOpenAgent?: (agent: AgentInfo) => void;
  onClose: (work: Lane | Goal) => void;
  onFocusLane: (lane: Lane) => void;
  onToggleClosedGoals?: () => void;
  closedGoalsCount?: number;
  closedGoalsVisible?: boolean;
  busy: boolean;
  theme: Theme;
  compact: boolean;
  currentWorkspaceId?: string;
  workspaceMatchesProject: boolean;
  availableWorkspaces: { id: string; name: string }[];
  detailsOnly?: boolean;
  onLabels: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceChoicesOpen, setWorkspaceChoicesOpen] = useState(false);
  const [agentChoicesOpen, setAgentChoicesOpen] = useState(false);
  const [menuTop, setMenuTop] = useState(48);
  const canStart = isActive(work.status);
  const hasWorkspace = Boolean(execution.workspaceId &&
    availableWorkspaces.some((workspace) => workspace.id === execution.workspaceId));
  const running = execution.status === "running";
  const needsInput = execution.status === "attention";
  const managerOwners = work.kind === "lane" ? work.managerClaim?.owners ?? [] : [];
  const managerError = work.kind === "lane" ? work.managerClaimError : null;
  const managed = managerOwners.length > 0;
  const occupied = running || needsInput || managed || Boolean(managerError);
  const navigableAgents = execution.agents.filter((agent) => Boolean(agent.workspaceId &&
    availableWorkspaces.some((workspace) => workspace.id === agent.workspaceId)) &&
    agent.attentionReason !== "error" && agent.attentionReason !== "finished" &&
    (agent.status === "idle" || isActiveAgent(agent)));
  const canStartAgent = loaded && canStart && !occupied;

  return (
    <View style={{
      position: menuOpen || workspaceChoicesOpen || agentChoicesOpen ? "relative" : undefined,
      zIndex: menuOpen || workspaceChoicesOpen || agentChoicesOpen ? 10 : undefined,
      elevation: menuOpen || workspaceChoicesOpen || agentChoicesOpen ? 10 : undefined,
      paddingLeft: 12 + Math.max(0, level - 1) * 12,
      paddingRight: 12,
      paddingVertical: level === 2 ? 10 : 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border,
      gap: 8,
    }}>
      <View onLayout={(event) => {
        const { y, height } = event.nativeEvent.layout;
        setMenuTop(y + height - 4);
      }} style={{
        flexDirection: compact ? "column" : "row",
        alignItems: compact ? "stretch" : "center",
        gap: 10,
      }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={detailsOnly ? `${expanded ? "Hide" : "Show"} Goal details ${work.ref}` : `${expanded ? "Collapse" : "Expand"} ${work.kind} ${work.ref}`}
          accessibilityState={{ expanded }}
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
            <LabelChips labels={work.labels ?? []} theme={theme} />
            {work.kind !== "goal" && !expanded && work.description ? (
              <Text numberOfLines={2} style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
                {short(work.description)}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          {managed && loaded && !navigableAgents.length ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>● Manager unavailable</Text>
          ) : managed && execution.status === "idle" ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>● Manager idle</Text>
          ) : managerError ? (
            <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>Ownership unavailable</Text>
          ) : <RuntimeLabel execution={execution} theme={theme} loaded={loaded} />}
          {navigableAgents.length && onOpenAgent ? (
            <Action label="Go to agent" theme={theme} disabled={!onOpenAgent || !navigableAgents.length}
              onPress={() => {
                if (navigableAgents.length === 1) onOpenAgent?.(navigableAgents[0]);
                else {
                  setWorkspaceChoicesOpen(false);
                  setAgentChoicesOpen((open) => !open);
                }
              }} />
          ) : null}
          {occupied && (!onOpenAgent || !navigableAgents.length) ? (
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              {!navigableAgents.length ? "Agent unavailable; contact the manager" : "Agent navigation unavailable in this Paseo client"}
            </Text>
          ) : null}
          {hasWorkspace && !occupied ? (
            <Action
              label="Open workspace"
              theme={theme}
              subtle
              onPress={() => onOpen(execution.workspaceId!)}
            />
          ) : null}
          {work.kind !== "task" && currentWorkspaceId && canStartAgent ? (
            <Action
              label="Run"
              theme={theme}
              disabled={busy || !workspaceMatchesProject}
              onPress={() => onStart(work.ref, "agent", currentWorkspaceId)}
            />
          ) : null}
          {work.kind !== "task" && !currentWorkspaceId && canStartAgent ? (
            <Action
              label="Run in workspace"
              theme={theme}
              disabled={busy}
              onPress={() => {
                setAgentChoicesOpen(false);
                setWorkspaceChoicesOpen((open) => !open);
              }}
            />
          ) : null}
          {work.kind === "task" && canStartAgent ? (
            <Action
              label={hasWorkspace ? "Start agent" : "Run in Paseo"}
              theme={theme}
              disabled={busy}
              onPress={() => onStart(work.ref, "agent")}
            />
          ) : null}
          {work.kind === "task" && !hasWorkspace && canStartAgent ? (
            <Action
              label="Workspace only"
              theme={theme}
              subtle
              disabled={busy}
              onPress={() => onStart(work.ref, "workspace")}
            />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More actions for ${work.kind} ${work.ref}`}
            accessibilityState={{ expanded: menuOpen }}
            onPress={() => {
              setMenuOpen((open) => !open);
              setWorkspaceChoicesOpen(false);
              setAgentChoicesOpen(false);
            }}
            style={{ padding: 8, borderRadius: 7, backgroundColor: menuOpen ? theme.colors.surface2 : "transparent" }}
          >
            <Icon name="MoreVertical" size={17} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      </View>
      {work.kind === "goal" ? <RecordContext key={work.ref} work={work} theme={theme} /> : null}
      {managed ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
        Managers: {managerOwners.map((owner) => owner.contact || `${owner.runtime} ${owner.session_id} on ${owner.host}`).join("; ")}
      </Text> : null}
      {managerError ? <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{managerError}</Text> : null}
      {menuOpen ? (
        <View accessibilityRole="menu" style={{
          position: "absolute", top: menuTop, right: 12, zIndex: 20, elevation: 20,
          width: 220, maxWidth: "100%", maxHeight: 240,
          padding: 5, gap: 2,
          borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
          backgroundColor: theme.colors.surface0,
        }}>
          <ScrollView style={{ maxHeight: 230 }}>
            <MenuItem label="Labels" theme={theme} onPress={() => {
              setMenuOpen(false);
              onLabels();
            }} />
            {work.kind === "lane" ? (
              <MenuItem label="Focus lane" theme={theme} onPress={() => {
                setMenuOpen(false);
                onFocusLane(work);
              }} />
            ) : null}
            {work.kind === "lane" && closedGoalsCount > 0 && onToggleClosedGoals ? (
              <MenuItem label={closedGoalsVisible ? "Hide closed goals" : "Show closed goals"} theme={theme}
                onPress={() => {
                  setMenuOpen(false);
                  onToggleClosedGoals();
                }} />
            ) : null}
            {work.kind !== "task" ? <MenuItem label={work.kind === "lane" ? "Close lane…" : "Close goal"} theme={theme}
              disabled={busy || work.status === "closed"} onPress={() => {
                setMenuOpen(false);
                onClose(work);
              }} /> : null}
            {canStartAgent && work.kind !== "task" ? <MenuItem label="Create workspace" theme={theme} disabled={busy} onPress={() => {
              setMenuOpen(false);
              onStart(work.ref, "workspace");
            }} /> : null}
          </ScrollView>
        </View>
      ) : null}
      {agentChoicesOpen && navigableAgents.length > 1 ? (
        <View accessibilityRole="menu" style={{ position: "absolute", top: menuTop, right: 12,
          zIndex: 20, elevation: 20, width: 240, maxWidth: "100%", padding: 5,
          borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface0 }}>
          <ScrollView style={{ maxHeight: 220 }}>
            {navigableAgents.map((agent) => (
              <MenuItem key={agent.id} label={`${agent.title || agent.id} · ${agent.status} · ${agent.workspaceId}`}
                theme={theme} onPress={() => { setAgentChoicesOpen(false); onOpenAgent?.(agent); }} />
            ))}
          </ScrollView>
        </View>
      ) : null}
      {workspaceChoicesOpen && canStartAgent && work.kind !== "task" ? (
        <View accessibilityRole="menu" style={{
          position: "absolute", top: menuTop, right: 12, zIndex: 20, elevation: 20,
          width: 240, maxWidth: "100%", maxHeight: 240, padding: 5,
          borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
          backgroundColor: theme.colors.surface0,
        }}>
          <ScrollView style={{ maxHeight: 220 }}>
            {availableWorkspaces.length ? availableWorkspaces.map((workspace) => (
              <MenuItem key={workspace.id} label={workspace.name || "Workspace"} theme={theme} disabled={busy} onPress={() => {
                setWorkspaceChoicesOpen(false);
                onStart(work.ref, "agent", workspace.id);
              }} />
            )) : (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, padding: 10 }}>
                No workspaces for this project. Use Create workspace from the menu.
              </Text>
            )}
          </ScrollView>
        </View>
      ) : null}
      {expanded ? (
        <View style={{ paddingLeft: 23, gap: 9 }}>
          {work.kind !== "goal" && work.description ? <Text style={{ fontSize: 13, lineHeight: 19, color: theme.colors.foreground }}>{work.description}</Text> : null}
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

function MenuItem({ label, onPress, theme, disabled = false }: {
  label: string; onPress: () => void; theme: Theme; disabled?: boolean;
}) {
  return (
    <Pressable accessibilityRole="menuitem" disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: 9, paddingHorizontal: 10, borderRadius: 5, opacity: disabled ? 0.45 : pressed ? 0.65 : 1 })}>
      <Text style={{ color: theme.colors.foreground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

function ClosedGoalsToggle({ visible, onPress, theme }: {
  visible: boolean;
  onPress: () => void;
  theme: Theme;
}) {
  const label = visible ? "Hide closed goals" : "Show closed goals";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: 4, opacity: pressed ? 0.65 : 1 })}>
      <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

function CloseWorkDialog({ work, onOpenChange, onConfirm, busy, theme }: {
  work: Lane | Goal | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (request: { laneClosure?: LaneClosureData; autoCompleteClosure: boolean }) => void;
  busy: boolean;
  theme: Theme;
}) {
  const laneWork = work?.kind === "lane" ? work : null;
  const [summary, setSummary] = useState(laneWork?.description ?? "");
  const [decisionLog, setDecisionLog] = useState(laneWork?.decisions || laneWork?.plan || "");
  const [systemOverview, setSystemOverview] = useState(laneWork?.scope ?? "");
  const [productGoals, setProductGoals] = useState(laneWork?.productGoals.join("\n") ?? "");
  const [autoCompleteClosure, setAutoCompleteClosure] = useState(false);
  const lane = work?.kind === "lane";
  const inputStyle = {
    minHeight: 40, padding: 10, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: 6, color: theme.colors.foreground, backgroundColor: theme.colors.surface0,
    fontSize: 13, textAlignVertical: "top" as const,
  };
  return (
    <Modal title={lane ? "Close lane" : "Close goal"} open={Boolean(work)} onOpenChange={onOpenChange}>
      <Modal.Content>
        <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{work?.title}</Text>
        {lane ? (
          <>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
              Lane retrospective fields can be left empty. Achieved product goals go one per line.
            </Text>
            <TextInput accessibilityLabel="Lane closure summary" placeholder="Summary" value={summary} onChangeText={setSummary} multiline style={inputStyle} placeholderTextColor={theme.colors.foregroundMuted} />
            <TextInput accessibilityLabel="Lane closure decision log" placeholder="Decision log" value={decisionLog} onChangeText={setDecisionLog} multiline style={inputStyle} placeholderTextColor={theme.colors.foregroundMuted} />
            <TextInput accessibilityLabel="Lane closure system overview" placeholder="System overview" value={systemOverview} onChangeText={setSystemOverview} multiline style={inputStyle} placeholderTextColor={theme.colors.foregroundMuted} />
            <TextInput accessibilityLabel="Achieved product goals" placeholder="Achieved product goals, one per line" value={productGoals} onChangeText={setProductGoals} multiline style={inputStyle} placeholderTextColor={theme.colors.foregroundMuted} />
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: autoCompleteClosure }}
              onPress={() => setAutoCompleteClosure((value) => !value)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4, opacity: pressed ? 0.7 : 1 })}>
              <View style={{ width: 17, height: 17, borderWidth: 1, borderColor: autoCompleteClosure ? theme.colors.accent : theme.colors.border, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: autoCompleteClosure ? theme.colors.accent : theme.colors.surface0 }}>
                {autoCompleteClosure ? <Text style={{ color: theme.colors.accentForeground, fontSize: 12, lineHeight: 15 }}>✓</Text> : null}
              </View>
              <Text style={{ color: theme.colors.foreground, fontSize: 12, flex: 1 }}>
                Ask Paseo to fill empty fields in the background
              </Text>
            </Pressable>
          </>
        ) : (
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 18 }}>
            This marks the Goal closed in Clips. It does not record engineering acceptance.
          </Text>
        )}
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}>
          <Action label="Cancel" theme={theme} subtle onPress={() => onOpenChange(false)} />
          <Action label={busy ? "Closing…" : lane ? "Close lane" : "Close goal"} theme={theme} disabled={busy}
            onPress={() => onConfirm({
              ...(lane ? { laneClosure: {
                summary, decision_log: decisionLog, system_overview: systemOverview,
                product_goals_achieved: productGoals.split("\n").map((line) => line.trim()).filter(Boolean),
              }} : {}),
              autoCompleteClosure: Boolean(lane && autoCompleteClosure),
            })} />
        </View>
      </Modal.Content>
    </Modal>
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
  theme, layout, host, navigation, onOpenSettings, onOpenLanePanel, preferredProjectId,
  currentWorkspaceId, currentWorkspaceProjectId,
}: PluginSurfaceProps & {
  onOpenSettings?: () => void;
  onOpenLanePanel?: (workspaceId: string) => void | Promise<void>;
  preferredProjectId?: string;
  currentWorkspaceId?: string;
  currentWorkspaceProjectId?: string;
}) {
  const fetchProjects = useRpc(projectsRpc);
  const fetchBoard = useRpc(boardRpc);
  const launch = useRpc(startRpc);
  const close = useRpc(closeRpc);
  const settings = useSettings(preferences);
  const updateLabels = useRpc(labelsRpc);
  const cache = useQueryClient();
  const toast = useToast();

  const projects = useQuery({ queryKey: ["clips.projects", host.id], queryFn: () => fetchProjects({}) });
  const [selected, setSelected] = useState<string | null>(null);
  const workspaceFocusIntent = useSyncExternalStore(subscribeFocusIntent,
    () => getWorkspaceFocusIntent(host.id, currentWorkspaceId), () => getWorkspaceFocusIntent(host.id, currentWorkspaceId));
  const [consumedFocusVersion, setConsumedFocusVersion] = useState(0);
  const selectedProject = projectAfterFocusIntent(selected, consumedFocusVersion, workspaceFocusIntent);
  useEffect(() => {
    if (workspaceFocusIntent && workspaceFocusIntent.version > consumedFocusVersion) {
      setSelected(workspaceFocusIntent.projectId);
      setConsumedFocusVersion(workspaceFocusIntent.version);
    }
  }, [workspaceFocusIntent, consumedFocusVersion]);
  const project = projects.data?.projects.find((p) => p.projectId === selectedProject) ??
    projects.data?.projects.find((p) => p.projectIds.includes(preferredProjectId ?? "")) ??
    projects.data?.projects[0];
  const projectId = project?.projectId;
  const board = useQuery({
    queryKey: ["clips.board", host.id, projectId],
    queryFn: () => fetchBoard({ projectId: projectId! }),
    enabled: Boolean(projectId),
    refetchInterval: 15_000,
  });
  const runtime = useRuntime(host.id);
  const [filter, setFilter] = useState<WorkFilter>("open");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [closedGoalsShown, setClosedGoalsShown] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [closingWork, setClosingWork] = useState<Lane | Goal | null>(null);
  const [launchRequest, setLaunchRequest] = useState<{ ref: string; title: string; workspaceId?: string } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [focus, setFocus] = useState<LaneFocus | null>(null);
  const [focusedLaneMenuOpen, setFocusedLaneMenuOpen] = useState(false);
  const scope = focusScope(host.id, projectId, currentWorkspaceId);
  const focusIntent = useSyncExternalStore(subscribeFocusIntent, () => getFocusIntent(scope), () => getFocusIntent(scope));
  const automaticLane = workspaceLane(board.data?.lanes ?? [], project?.projectIds ?? [], currentWorkspaceId,
    runtime.data?.workspaces ?? [], runtime.data?.agents ?? []);
  const laneInFocus = focusedLane(board.data?.lanes ?? [], scope, focus, automaticLane, focusIntent);
  const selectFocus = (laneRef: string | null) => setFocus({ scope, laneRef, intentVersion: focusIntent?.version ?? 0 });
  const columnWidth = viewportWidth
    ? Math.min(380, viewportWidth - (layout.compact ? 28 : 48))
    : layout.compact ? 280 : 380;
  const [labelTarget, setLabelTarget] = useState<{ hostId: string; projectId: string; ref: string } | null>(null);
  const labelWork = labelTarget && labelTarget.hostId === host.id && labelTarget.projectId === projectId && board.data
    ? [...board.data.lanes, ...board.data.goals, ...board.data.goals.flatMap((goal) => goal.tasks)]
      .find((work) => work.ref === labelTarget.ref) : undefined;
  const loaded = Boolean(runtime.data) && !runtime.isError;
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
      target.kind === "lane" && target.managerClaim?.owners.length
        ? executionForManagers(target.managerClaim.owners, host.id, runtime.data.workspaces, runtime.data.agents)
        : executionFor(target, project.projectIds, runtime.data.workspaces, runtime.data.agents),
    );
    return out;
  }, [project, board.data, runtime.data, host.id]);
  const execution = (work: Work) => live.get(work.ref) ?? emptyExecution;
  const scopedGoals = (board.data?.goals ?? []).filter((goal) => !laneInFocus || laneInFocus.goalRefs.includes(goal.ref));
  const runningTasks = scopedGoals.flatMap((g) => g.tasks).filter((t) => execution(t).status === "running").length;
  const runningGoals = scopedGoals.filter((g) => execution(g).status === "running").length;
  const scopedLanes = (board.data?.lanes ?? []).filter((lane) => !laneInFocus || lane.ref === laneInFocus.ref);
  const runningLanes = scopedLanes.filter((lane) => execution(lane).status === "running").length;
  const runningAgentCount = uniqueRunningAgentCount([
    ...scopedGoals.flatMap((goal) => goal.tasks.map((task) => execution(task))),
    ...scopedGoals.map(execution),
    ...scopedLanes.map(execution),
  ]);

  const create = useMutation({
    mutationFn: ({ ref, mode, workspaceId, agentConfig }: {
      ref: string; mode: StartMode; workspaceId?: string; agentConfig?: AgentConfiguration;
    }) => launch({ projectId: projectId!, ref, mode, workspaceId, agentConfig, hostId: host.id }),
    onMutate: ({ ref }) => {
      setPending(ref);
      return { hostId: host.id, projectId, lane: board.data?.lanes.find((lane) => lane.ref === ref), navigation, onOpenLanePanel };
    },
    onSuccess: async (result, { ref }, request) => {
      setLaunchRequest(null);
      const outcome = result.alreadyRunning ? "Already running" :
        result.agentId ? `Started ${result.agent} on ${ref}` :
        result.reused ? "Reused workspace" : "Created workspace";
      toast.show(outcome, { variant: "success" });
      void cache.invalidateQueries({ queryKey: ["clips.projects", request.hostId] });
      const errors = await revealStartedWorkspace({
        workspaceId: result.workspaceId, agentId: result.agentId,
        lane: request.lane,
        refresh: () => cache.invalidateQueries({ queryKey: ["clips-runtime", request.hostId] }, { throwOnError: true }),
        openWorkspace: (workspaceId) => request.navigation?.openWorkspace({ workspaceId }),
        openAgent: (agentId) => request.navigation?.openAgent({ agentId }),
        requestFocus: (lane, workspaceId) => requestLaneFocus(focusScope(request.hostId, request.projectId, workspaceId), lane.ref,
          { hostId: request.hostId, projectId: request.projectId!, workspaceId }),
        openPanel: request.onOpenLanePanel,
      });
      for (const error of errors) toast.show(error, { variant: "error" });
    },
    onError: (error) => toast.show(message(error), { variant: "error" }),
    onSettled: (_data, _error, _variables, request) => {
      setPending(null);
      if (_error) void cache.invalidateQueries({ queryKey: ["clips-runtime", request?.hostId ?? host.id] });
      void cache.invalidateQueries({ queryKey: ["clips.board", request?.hostId ?? host.id, request?.projectId ?? projectId] });
    },
  });
  const closeRecord = useMutation({
    mutationFn: (request: { laneClosure?: LaneClosureData; autoCompleteClosure: boolean }) =>
      close({ projectId: projectId!, ref: closingWork!.ref, ...request }),
    onSuccess: ({ ref, autoCompleteStatus, autoCompleteError }) => {
      const outcome = autoCompleteStatus === "started"
        ? `Closed ${ref}. Paseo is filling empty fields in the background.`
        : `Closed ${ref}`;
      toast.show(autoCompleteError ? `${outcome}. Background fill could not start: ${autoCompleteError}` : outcome,
        { variant: autoCompleteError ? "error" : "success" });
      setClosingWork(null);
      void cache.invalidateQueries({ queryKey: ["clips.board", host.id, projectId] });
    },
    onError: (error) => toast.show(message(error), { variant: "error" }),
  });

  const labelMutation = useMutation({
    mutationFn: (input: { hostId: string; projectId: string; change: LabelChange }) =>
      updateLabels({ projectId: input.projectId, change: input.change }),
    onSuccess: (data, input) => {
      cache.setQueryData(["clips.board", input.hostId, input.projectId], data);
    },
    onSettled: (_data, _error, input) => {
      void cache.invalidateQueries({ queryKey: ["clips.board", input.hostId, input.projectId] });
    },
  });

  const requestStart = (ref: string, mode: StartMode, workspaceId?: string) => {
    if (mode === "workspace") {
      create.mutate({ ref, mode });
      return;
    }
    const target = board.data && [
      ...board.data.lanes,
      ...board.data.goals,
      ...board.data.goals.flatMap((goal) => goal.tasks),
    ].find((item) => item.ref === ref);
    setLaunchRequest({ ref, title: target?.title ?? ref, ...(workspaceId ? { workspaceId } : {}) });
  };

  const startWithConfig = (agentConfig: AgentConfiguration) => {
    if (!launchRequest) return;
    create.mutate({ ref: launchRequest.ref, mode: "agent", workspaceId: launchRequest.workspaceId, agentConfig });
  };

  const query = search.toLowerCase().trim();
  const hit = (work: Work) => !query || [work.title, work.ref, work.description, ...(work.labels ?? []).map((label) => label.name)].some((v) => v.toLowerCase().includes(query));
  const group = (lane: Lane | null, goals: Goal[], includeClosedGoals = false) =>
    goalGroup(lane, goals, filter, search, includeClosedGoals, execution);
  const expandByDefault = (work: Work) => work.kind === "goal" && (Boolean(query) || filter === "running");
  const isExpanded = (work: Work) => expanded[work.ref] ?? expandByDefault(work);
  const toggle = (work: Work) => setExpanded((prev) => ({
    ...prev, [work.ref]: !(prev[work.ref] ?? expandByDefault(work)),
  }));
  const toggleClosedGoals = (key: string) => setClosedGoalsShown((prev) => ({
    ...prev, [key]: !prev[key],
  }));
  const includesClosedGoals = (key: string) => filter !== "open" || Boolean(closedGoalsShown[key]);
  const hasClosedGoalMatch = (goals: Goal[]) => goals.some((goal) => goal.status === "closed" && hit(goal));
  const canRevealHiddenClosedGoals = (goals: Goal[], visible: boolean) =>
    filter === "open" && !visible && goals.some((goal) => goal.status === "closed") &&
    (!query || hasClosedGoalMatch(goals));
  const renderWork = (work: Work, level: number, closedGoalOptions?: {
    count: number;
    visible: boolean;
    onToggle: () => void;
  }, detailsOnly = false) => (
    <WorkRow
      key={work.ref}
      work={work}
      level={level}
      execution={execution(work)}
      loaded={loaded}
      expanded={isExpanded(work)}
      onToggle={() => toggle(work)}
      onStart={requestStart}
      onOpen={(workspaceId) => navigation?.openWorkspace({ workspaceId })}
      onOpenAgent={navigation ? (agent) => {
        try { navigateToAgent(agent, navigation); }
        catch (error) {
          toast.show(`Agent ${agent.title || agent.id} could not open: ${message(error)}. Refresh live activity or contact its manager.`, { variant: "error" });
          void cache.invalidateQueries({ queryKey: ["clips-runtime", host.id] });
        }
      } : undefined}
      onClose={setClosingWork}
      onFocusLane={(lane) => selectFocus(lane.ref)}
      closedGoalsCount={closedGoalOptions?.count}
      closedGoalsVisible={closedGoalOptions?.visible}
      onToggleClosedGoals={closedGoalOptions?.onToggle}
      busy={create.isPending}
      theme={theme}
      compact
      currentWorkspaceId={currentWorkspaceId}
      workspaceMatchesProject={!currentWorkspaceProjectId || Boolean(project?.projectIds.includes(currentWorkspaceProjectId))}
      availableWorkspaces={(runtime.data?.workspaces ?? [])
        .filter((workspace) => project?.projectIds.includes(workspace.projectId))
        .map(({ id, name }) => ({ id, name }))}
      detailsOnly={detailsOnly}
      onLabels={() => setLabelTarget({ hostId: host.id, projectId: projectId!, ref: work.ref })}
    />
  );
  const renderGoal = (goal: Goal, tasks: typeof goal.tasks) => (
    <View key={goal.ref} style={{
      margin: 12, marginTop: 0,
      borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8,
      backgroundColor: theme.colors.surface0, overflow: "visible",
    }}>
      {renderWork(goal, 1)}
      {isExpanded(goal) ? tasks.map((task) => renderWork(task, 2)) : null}
    </View>
  );
  const goalRefsInLanes = new Set((board.data?.lanes ?? []).flatMap((l) => l.goalRefs));
  const ungrouped = (board.data?.goals ?? []).filter((g) => !goalRefsInLanes.has(g.ref));
  const currentBoard = board.data;
  const focusGoals = currentBoard?.goals.filter((goal) => laneInFocus?.goalRefs.includes(goal.ref)) ?? [];
  const focusGroup = laneInFocus ? group(laneInFocus, focusGoals, includesClosedGoals(laneInFocus.ref)) : null;
  const noResults = currentBoard
    ? !(currentBoard.lanes.some((l) => {
        const attached = currentBoard.goals.filter((g) => l.goalRefs.includes(g.ref));
        return group(l, attached, includesClosedGoals(l.ref)).showLane;
      }) || currentBoard.lanes.some((lane) => {
        const attached = currentBoard.goals.filter((goal) => lane.goalRefs.includes(goal.ref));
        return isActive(lane.status) && canRevealHiddenClosedGoals(attached, Boolean(closedGoalsShown[lane.ref]));
      }) || group(null, ungrouped, includesClosedGoals(UNASSIGNED_CLOSED_GOALS_KEY)).showLane || (
        canRevealHiddenClosedGoals(ungrouped, Boolean(closedGoalsShown[UNASSIGNED_CLOSED_GOALS_KEY]))
      ))
    : false;

  return (
    <ScrollView onLayout={(event) => setViewportWidth(event.nativeEvent.layout.width)}
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{
      padding: layout.compact ? 14 : 24, gap: 16, paddingBottom: 64,
    }}>
      {laneInFocus ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back to Clips"
          onPress={() => selectFocus(null)}
          style={{ flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5, paddingVertical: 4 }}>
          <Icon name="ArrowLeft" size={15} color={theme.colors.foregroundMuted} />
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>Back to Clips</Text>
        </Pressable>
      ) : null}
      {labelWork && projectId ? <LabelManager key={`${host.id}:${projectId}:${labelWork.ref}`} work={labelWork}
        catalog={board.data?.labels ?? []} theme={theme} busy={labelMutation.isPending}
        onChange={(change) => labelMutation.mutateAsync({ hostId: host.id, projectId, change })}
        onClose={() => setLabelTarget(null)} /> : null}
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 21, fontWeight: "700" }}>{laneInFocus?.title ?? "Clips"}</Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            {laneInFocus ? `${laneInFocus.ref} · Goals and Tasks` : "Plan in Clips · Execute in Paseo"}
          </Text>
          {laneInFocus ? <LabelChips labels={laneInFocus.labels ?? []} theme={theme} /> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, position: "relative",
          zIndex: focusedLaneMenuOpen ? 10 : undefined, elevation: focusedLaneMenuOpen ? 10 : undefined }}>
          {laneInFocus && projectId ? <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More actions for lane ${laneInFocus.ref}`}
            accessibilityState={{ expanded: focusedLaneMenuOpen }}
            onPress={() => setFocusedLaneMenuOpen((open) => !open)}
            style={{ padding: 8, borderRadius: 7, backgroundColor: focusedLaneMenuOpen ? theme.colors.surface2 : "transparent" }}
          >
            <Icon name="MoreVertical" size={17} color={theme.colors.foregroundMuted} />
          </Pressable> : null}
          {focusedLaneMenuOpen && laneInFocus && projectId ? <View accessibilityRole="menu" style={{
            position: "absolute", top: 36, right: 0, zIndex: 20, elevation: 20,
            width: 190, maxWidth: "100%", padding: 5, gap: 2,
            borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, backgroundColor: theme.colors.surface0,
          }}>
            <MenuItem label="Labels" theme={theme} onPress={() => {
              setFocusedLaneMenuOpen(false);
              setLabelTarget({ hostId: host.id, projectId, ref: laneInFocus.ref });
            }} />
          </View> : null}
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
        </View>
        {onOpenSettings ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clips settings" onPress={onOpenSettings} style={{ padding: 8 }}>
            <Icon name="Settings" size={18} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
      </View>
      {laneInFocus ? <RecordContext key={laneInFocus.ref} work={laneInFocus} theme={theme} /> : null}
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
          {currentWorkspaceId && project && currentWorkspaceProjectId &&
          !project.projectIds.includes(currentWorkspaceProjectId) ? (
            <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
              Switch to this workspace’s project before running Clips work here.
            </Text>
          ) : null}
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
              placeholder={laneInFocus ? "Search this lane’s Goals and Tasks" : "Search Lanes, Goals and Tasks"}
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
              <FilterChip title="Open" selected={filter === "open"} onPress={() => setFilter("open")} theme={theme} />
              <FilterChip title="Running"
                count={runtime.data && runningAgentCount > 0 ? runningAgentCount : undefined}
                selected={filter === "running"} onPress={() => setFilter("running")} theme={theme} />
              <FilterChip title="All" selected={filter === "all"} onPress={() => setFilter("all")} theme={theme} />
            </View>
          </View>
          {!laneInFocus && runtime.data && runningTasks > 0 && board.data ? (
            <View style={{
              borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
              backgroundColor: theme.colors.surface1, padding: 12, gap: 7,
            }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600" }}>
                Tasks executing now
              </Text>
              {board.data.goals.flatMap((g) => g.tasks).filter((t) => execution(t).status === "running").slice(0, 8).map((t) => (
                <Pressable
                  key={t.ref}
                  accessibilityRole="button"
                  accessibilityLabel={`Open running task ${t.ref} in Paseo`}
                  onPress={() => {
                    const workspaceId = execution(t).workspaceId;
                    if (workspaceId) navigation?.openWorkspace({ workspaceId });
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}
                >
                  <Icon name="PlayCircle" size={15} color={theme.colors.statusSuccess} />
                  <Text numberOfLines={1} style={{ color: theme.colors.foreground, flex: 1, fontSize: 13 }}>
                    {t.ref} · {t.title}
                  </Text>
                  <Icon name="ArrowUpRight" size={14} color={theme.colors.foregroundMuted} />
                </Pressable>
              ))}
              {runningTasks > 8 ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                  +{runningTasks - 8} more. Use the Running filter to see all.
                </Text>
              ) : null}
            </View>
          ) : null}
          {board.isPending ? <ActivityIndicator color={theme.colors.foregroundMuted} /> : null}
          {board.isError ? <Text style={{ color: theme.colors.statusDanger }}>Could not read Clips: {message(board.error)}</Text> : null}
          {board.data?.warnings.length ? (
            <Text style={{ color: theme.colors.statusWarning, fontSize: 12 }}>
              Clips reported {board.data.warnings.length} data warning(s): {short(board.data.warnings.join("; "), 300)}
            </Text>
          ) : null}
          {laneInFocus && focusGroup ? (
            <View style={{ gap: 12 }}>
              {filter === "open" && focusGroup.closedGoals.length > 0 ? (
                <ClosedGoalsToggle visible={Boolean(closedGoalsShown[laneInFocus.ref])}
                  onPress={() => toggleClosedGoals(laneInFocus.ref)} theme={theme} />
              ) : null}
              <ScrollView horizontal accessibilityLabel="Lane goals" style={{ flexGrow: 0 }}
                contentContainerStyle={{ gap: 16, alignItems: "flex-start", paddingBottom: 12 }}>
                {focusGroup.entries.map(({ goal, tasks }) => (
                  <View key={goal.ref} style={{ width: columnWidth, borderWidth: 1, borderColor: theme.colors.border,
                    borderRadius: 10, backgroundColor: theme.colors.surface1, overflow: "visible" }}>
                    {renderWork(goal, 1, undefined, true)}
                    {isExpanded(goal) ? <>
                      {tasks.map((task) => renderWork(task, 2))}
                      {!tasks.length ? (
                        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, padding: 14 }}>
                          {goal.tasks.length ? "No Tasks match the current filter." : "No Tasks in this Goal yet."}
                        </Text>
                      ) : null}
                    </> : null}
                  </View>
                ))}
              </ScrollView>
              {!focusGroup.entries.length ? (
                <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13, paddingVertical: 12 }}>
                  {!focusGoals.length ? "No Goals in this lane yet." : focusGroup.canRevealClosed
                    ? focusGroup.closedGoals.length === focusGoals.length ? "All goals are closed. Show closed goals to see them." : "Closed goals are hidden."
                    : "No Goals match the current filter."}
                </Text>
              ) : null}
            </View>
          ) : (
          <ScrollView horizontal accessibilityLabel="Project lanes" style={{ flexGrow: 0 }}
            contentContainerStyle={{ gap: 16, alignItems: "flex-start", paddingBottom: 12 }}>
          {board.data?.lanes.map((lane) => {
            const related = board.data!.goals.filter((goal) => lane.goalRefs.includes(goal.ref));
            const closedGoals = related.filter((goal) => goal.status === "closed");
            const showClosedGoals = Boolean(closedGoalsShown[lane.ref]);
            const { entries, showLane } = group(lane, related, includesClosedGoals(lane.ref));
            const allGoalsClosed = related.length > 0 && closedGoals.length === related.length;
            const showClosedGoalsEmptyState = entries.length === 0 && canRevealHiddenClosedGoals(related, showClosedGoals);
            const showLaneForHiddenClosedGoals = isActive(lane.status) && showClosedGoalsEmptyState;
            if (!showLane && !showLaneForHiddenClosedGoals) return null;
            return (
              <View key={lane.ref} style={{
                width: columnWidth,
                borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
                backgroundColor: theme.colors.surface1, overflow: "visible",
              }}>
                {renderWork(lane, 0, {
                  count: filter === "open" ? closedGoals.length : 0,
                  visible: showClosedGoals,
                  onToggle: () => toggleClosedGoals(lane.ref),
                })}
                {filter === "open" && closedGoals.length > 0 && entries.length > 0 ? (
                  <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
                    <ClosedGoalsToggle visible={showClosedGoals} onPress={() => toggleClosedGoals(lane.ref)} theme={theme} />
                  </View>
                ) : null}
                <View style={{ paddingTop: 12 }}>
                  {entries.map(({ goal, tasks }) => renderGoal(goal, tasks))}
                </View>
                {entries.length === 0 ? (
                  showClosedGoalsEmptyState ? (
                    <View style={{ paddingHorizontal: 12, paddingVertical: 14, gap: 6 }}>
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                        {allGoalsClosed ? "All goals are closed." : "Closed goals are hidden."}
                      </Text>
                      <ClosedGoalsToggle visible={false} onPress={() => toggleClosedGoals(lane.ref)} theme={theme} />
                    </View>
                  ) : (
                    <Text style={{ color: theme.colors.foregroundMuted, padding: 12, fontSize: 12 }}>
                      No Goals match the current filter.
                    </Text>
                  )
                ) : null}
              </View>
            );
          })}
          {(() => {
            const closedGoals = ungrouped.filter((goal) => goal.status === "closed");
            const showClosedGoals = Boolean(closedGoalsShown[UNASSIGNED_CLOSED_GOALS_KEY]);
            const { entries, showLane } = group(null, ungrouped, includesClosedGoals(UNASSIGNED_CLOSED_GOALS_KEY));
            const allGoalsClosed = ungrouped.length > 0 && closedGoals.length === ungrouped.length;
            const showClosedGoalsEmptyState = entries.length === 0 && canRevealHiddenClosedGoals(ungrouped, showClosedGoals);
            if (!showLane && !showClosedGoalsEmptyState) return null;
            return (
              <View style={{
                width: columnWidth,
                borderWidth: 1, borderColor: theme.colors.border, borderRadius: 10,
                backgroundColor: theme.colors.surface1, overflow: "visible",
              }}>
                <View style={{ paddingHorizontal: 13, paddingTop: 13, paddingBottom: entries.length > 0 ? 4 : 13, gap: 5 }}>
                  <Text style={{ color: theme.colors.foregroundMuted, fontWeight: "600", fontSize: 13 }}>
                    Goals outside Lanes
                  </Text>
                  {filter === "open" && closedGoals.length > 0 && entries.length > 0 ? (
                    <ClosedGoalsToggle visible={showClosedGoals} onPress={() => toggleClosedGoals(UNASSIGNED_CLOSED_GOALS_KEY)} theme={theme} />
                  ) : null}
                </View>
                {entries.map(({ goal, tasks }) => renderGoal(goal, tasks))}
                {entries.length === 0 ? (
                  showClosedGoalsEmptyState ? (
                    <View style={{ paddingHorizontal: 13, paddingBottom: 13, gap: 6 }}>
                      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                        {allGoalsClosed ? "All goals are closed." : "Closed goals are hidden."}
                      </Text>
                      <ClosedGoalsToggle visible={false} onPress={() => toggleClosedGoals(UNASSIGNED_CLOSED_GOALS_KEY)} theme={theme} />
                    </View>
                  ) : (
                    <Text style={{ color: theme.colors.foregroundMuted, padding: 12, fontSize: 12 }}>
                      No Goals match the current filter.
                    </Text>
                  )
                ) : null}
              </View>
            );
          })()}
          </ScrollView>
          )}
          {!laneInFocus && noResults ? (
            <Text style={{ padding: 14, color: theme.colors.foregroundMuted }}>
              No Clips work matches this filter. The Running filter only counts active Paseo agents, not Clips records marked in_progress.
            </Text>
          ) : null}
          <CloseWorkDialog key={closingWork?.ref ?? "none"} work={closingWork} onOpenChange={(open) => {
            if (!open && !closeRecord.isPending) setClosingWork(null);
          }} onConfirm={(request) => closeRecord.mutate(request)} busy={closeRecord.isPending} theme={theme} />
          <AgentLaunchDialog
            key={`${launchRequest?.ref ?? "none"}:${launchRequest?.workspaceId ?? "new"}`}
            open={Boolean(launchRequest)}
            workTitle={launchRequest ? `${launchRequest.ref} · ${launchRequest.title}` : ""}
            defaults={settings.status === "ready" ? settings.values : preferences.schema.parse({})}
            theme={theme}
            hostId={host.id}
            projectId={projectId}
            busy={create.isPending}
            onOpenChange={(open) => {
              if (!open && !create.isPending) setLaunchRequest(null);
            }}
            onSubmit={startWithConfig}
          />
        </>
      ) : null}
    </ScrollView>
  );
}
