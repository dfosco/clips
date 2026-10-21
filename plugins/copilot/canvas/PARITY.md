# Paseo and Copilot board parity boundary

Paseo `plugins/paseo/client/work-screen.tsx` and `lane-focus.ts`, plus the supplied
screenshots, remain the behavior reference. Copilot composes actual GitHub Primer
React components in `ui/board.jsx` and `ui/app.jsx`. `board-view.mjs` contains the
host-independent grouping/identity/activity rules. The service and joined
runtime remain the host boundary; no Paseo native runtime is imported.

| Maintained behavior | Copilot implementation/regression |
| --- | --- |
| Horizontal collection of vertical Lane columns containing Goals | Muted Lane columns with edge-to-edge default-background information headers/full-width separators and inset bordered Goal/Task cards, including outside-Lanes; production-bundle DOM cases |
| Lane-only focus and explicit Back; Goals/Tasks expand inline | Board, persisted clear_focus, legacy ref visibility cases |
| Exact canonical Lane membership | goalsForLane uses goal_refs; namespace collision case |
| Hierarchical search/Open/observed Running/All | goalGroup, actual bundle search/refresh cases; unknown activity stays unknown |
| Closed-only active Lane/unassigned reveal | goalGroup and per-Lane toggles |
| Show more/less expands the full card information and Goal Task hierarchy | Plain semantic titles without disclosure buttons; Description + WorkCard, actual bundle context cases |
| Labels/status/Task creation/administrative Goal close | Anchored Primer ActionMenu/ActionList opens actual Dialog/FormControl forms; full qualified refs, original-trigger focus and expected-project fence |
| Source refresh preserves search/caret/expansion/scroll | keyed React state; explicit focus only resets stale filters once |
| Task Run inside kebab only (user refinement) | Task menu, exact joined Task dispatch, lifecycle/pending/error guards; Run coexists with navigation |

When changing shared behavior in Paseo, update its corresponding Copilot
component and model/actual-bundle tests. The two hosts intentionally share a
behavior boundary rather than React Native rendering code. Copilot offers
only exact joined-session sends and supported navigation. It does not promise
workspace/independent-session creation or parentage. Use native App tools for
steerable coordinated child sessions. Host identity, claims, roles and earlier
associations are advisory metadata, not gates. Idle activity is not required.
Missing catalog activity does not disable an otherwise valid joined send;
the runtime still verifies the exact record, Git project and current session.

The Lanes project tabs read the existing canonical local-user projects.json
registry through `src/project-discovery.js`. It accepts only discovered opaque
IDs, revalidates selections, and scopes persistence by userScope/session/canvas;
focus additionally includes the canonical project. It never initializes a repo,
prunes registry entries or substitutes cwd for a missing selected project.
Tabs occupy only the former Board strip. No project-picker modal remains.
Initial default selection prefers the registered current repository, otherwise
the first available project. Saved selection is preserved without fallback.
The separate Initialize control is authorized only for the actual session Git
root with no store, independent of selected tabs; it uses `lanes init --store-only`.

## Build and activation

The source renderer uses real @primer/react components, official
@primer/primitives tokens and @primer/octicons-react. See UI.md for provenance,
theme mapping, customization and commands.
Vite emits a closed app.js/style.css pair in dist. Both URLs carry their own
canvas authentication query. There are no remote fonts, dynamic imports or
unauthenticated chunks. A build manifest checks source and emitted hashes before
local installation and through the installed extension link.

After changing provider/build source, run extensions_reload in the intended
actual Copilot conversation, then reopen Lanes. Refresh rereads state only.
An external SDK sidecar is not the App's live joined connection. Source linking,
DOM tests and previously loaded build logs do not prove this build was loaded.

Validation uses Node tests, production-bundle jsdom interactions, real token-
authenticated HTTP, canonical CLI integration and read-only real registry probes.
No browser/CU automation or native visual acceptance is claimed.

Record titles and labels wrap without truncation. All in-card controls use small
Primer sizing, with official small description typography. Activity is directly
below the description. Record footers align wrapping session/send actions and a
fixed kebab track, including nested Tasks. Structural and emitted CSS checks
establish this layout contract; native pixel fit remains user visual evidence.
