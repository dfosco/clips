# Paseo and Copilot board parity boundary

Paseo `plugins/paseo/client/work-screen.tsx` and `lane-focus.ts`, plus the supplied
screenshots, remain the behavior reference. Copilot composes actual shadcn/ui
React components in `ui/board.jsx` and `ui/app.jsx`. `board-view.mjs` contains the
host-independent grouping/identity/activity rules. The service and joined
runtime remain the host boundary; no Paseo native runtime is imported.

| Maintained behavior | Copilot implementation/regression |
| --- | --- |
| Horizontal collection of vertical Lane columns containing Goals | Board, actual production-bundle DOM cases |
| Lane-only focus and explicit Back; Goals/Tasks expand inline | Board, persisted clear_focus, legacy ref visibility cases |
| Exact canonical Lane membership | goalsForLane uses goal_refs; namespace collision case |
| Hierarchical search/Open/observed Running/All | goalGroup, actual bundle search/refresh cases; unknown activity stays unknown |
| Closed-only active Lane/unassigned reveal | goalGroup and per-Lane toggles |
| Independent Show more; inline Scope/Plan/Decisions/criteria | Description + WorkCard, actual bundle context cases |
| Labels/status/Task creation/administrative Goal close | shadcn Dialog/Field/native controls; full qualified refs and expected-project fence |
| Source refresh preserves search/caret/expansion/scroll | keyed React state; explicit focus only resets stale filters once |
| Task Run inside kebab only (user refinement) | Task menu, exact joined Task dispatch, pending/error/occupied guards; Goal/Lane actions unchanged |

When changing shared behavior in Paseo, update its corresponding Copilot
component and model/actual-bundle tests. The two hosts intentionally share a
behavior boundary rather than React Native rendering code. Copilot offers
only exact joined-session sends and supported navigation. It does not promise
workspace/independent-session creation, App host identity or top-level parentage.

The Clips project chooser reads the existing canonical local-user projects.json
registry through `src/project-discovery.js`. It accepts only discovered opaque
IDs, revalidates selections, and scopes persistence by userScope/session/canvas;
focus additionally includes the canonical project. It never initializes a repo,
prunes registry entries or substitutes cwd for a missing selected project.

## Build and activation

The source renderer uses real @shadcn radix-nova components, Tailwind v4 and
@primer/octicons-react. See UI.md for provenance, customization and commands.
Vite emits a closed app.js/style.css pair in dist. Both URLs carry their own
canvas authentication query. There are no remote fonts, dynamic imports or
unauthenticated chunks. A build manifest checks source and emitted hashes before
local installation and through the installed extension link.

After changing provider/build source, run extensions_reload in the intended
actual Copilot conversation, then reopen Clips Work. Refresh rereads state only.
An external SDK sidecar is not the App's live joined connection. Source linking,
DOM tests and previously loaded build logs do not prove this build was loaded.

Validation uses Node tests, production-bundle jsdom interactions, real token-
authenticated HTTP, canonical CLI integration and read-only real registry probes.
No browser/CU automation or native visual acceptance is claimed.
