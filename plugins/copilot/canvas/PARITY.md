# Paseo and Copilot board parity boundary

Paseo's `plugins/paseo/client/work-screen.tsx` and supplied user screenshots are
the presentation reference. Copilot's `board-view.mjs` is a host-independent
HTML renderer/controller, consumed by `app.js`; the App boundary remains in
`service.mjs` and the joined runtime. Paseo renders through React Native host
components. The maintained boundary below keeps changes explicit across those
renderers without introducing Paseo's native host SDK into the canvas.

| Shared behavior | Paseo reference | Copilot implementation and required regression |
| --- | --- | --- |
| Board anatomy | `WorkScreen`, Project lanes horizontal ScrollView | Lane columns containing Goal cards; no sidebar/detail composition |
| Lane focus | `focusedLane`, Back to Clips, Lane goals ScrollView | `laneForFocus`, persisted `clear_focus`, Goal columns; legacy Goal/Task refs expand inline |
| Goal membership | normalized `Lane.goalRefs` | exact canonical `lane.goal_refs`; namespace collisions must not join unrelated Goals |
| Hierarchical filters | `lane-focus.ts goalGroup` | `goalGroup`: title/ref/description/labels, descendant keeps ancestors, Open/Running/All |
| Closed Goals | `ClosedGoalsToggle`, active closed-only Lane empty state | independent per-Lane/unassigned toggle; closed-only active parents remain discoverable |
| Goal and Task details | `WorkRow`, `renderGoal` | inline disclosure; collapsed Goals hide Tasks; matching Tasks auto-reveal |
| Long description | `RecordContext`, 240-character Show more | independent description expansion, same preview threshold and Show more/less controls |
| Activity | observed runtime `executionFor`, `uniqueRunningAgentCount` | exact bound/claimed sessions; only observed running counts, catalog unknown stays unknown |
| Menus | WorkRow MoreVertical / LabelManager / CloseWorkDialog | accessible dialogs outside scrolling columns; exact refs for label/status/Task creation, explicit administrative Goal close |
| Refresh continuity | React keyed local state | stable UI state, semantic HTML comparison, preserved search selection/column scroll, serialized mutations, stale-refresh guard |

When a shared behavior changes in Paseo, update the matching Copilot row and
its named cases in `board-view.test.mjs` / `app.test.mjs`. Filtering semantics
follow Paseo's pure `goalGroup`, including keeping an active Lane visible when
its only matching Goals are hidden closed Goals. Host-specific differences are
intentional: the Copilot canvas exposes current joined-session sends and exact
session navigation; it does not claim workspace allocation, independent App
session creation, observed identity/parentage or unknown activity.

The project chip identifies only the actual selected project. It does not
invent Paseo's project registry. Project selection remains explicit and scoped
to this session/panel; focus additionally includes the project path. Existing
Goal/Task focus from agents is rendered as Lane context plus inline expansion;
only Lane and explicit Back are user navigation destinations.

The renderer module is a separately authenticated asset. `app.js` imports it
with the current instance/token query and the service allowlists that exact
file. No module import inherits another module's URL query. Provider changes
require `extensions_reload` in the actual Copilot session, then reopening the
canvas. A source-linked static-file change does not prove the App loaded it.

Validation uses Node tests, jsdom DOM interactions, real authenticated HTTP
routes and isolated canonical CLI storage. Browser/CU automation is prohibited
by the user's instruction. These checks establish source/DOM behavior; native
visual acceptance must be identified separately from screenshots supplied by
the user. No generated design supersedes the supplied Paseo references.
