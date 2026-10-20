# Canvas UI source and build

The canvas is a React application bundled by Vite. Its maintained screens use
GitHub Primer React components (`@primer/react` 38.40.1), official
`@primer/primitives` 11.10.0 CSS tokens and `@primer/octicons-react` SVG icons.
The stable Primer version is deliberately pinned instead of the registry's
39.x release candidate. React, React DOM and react-is share version 19.3.1,
within Primer's supported React 18/19 peer range.

Official references:

- https://primer.style/product/getting-started/react/
- https://primer.style/product/components/
- https://github.com/primer/primitives
- https://primer.style/octicons/code/

## Theme and customization

`ui/primer-theme.jsx` wraps the app in the supported `ThemeProvider` from
`@primer/react/next` and `BaseStyles` from `@primer/react`. It imports official
light/dark functional themes; `ui/theme.css` imports the complete primitive
size, spacing, typography, motion and radius token set. Custom board and app
layouts use those semantic variables directly, not a recolored shadcn palette.
Primer's portal root keeps dialogs and overlays inside the themed scope.

The host's explicit `data-color-mode` on the document root or body selects
Primer light or dark. Host attribute changes are observed. Without an explicit
mode, the OS color-scheme preference supplies a reactive fallback. Host theme
names are not passed to Primer because they need not name a supported Primer
scheme. Primer owns component colors; no arbitrary host palette is synthesized.

The visual target is GitHub Projects: compact project chrome and filtering,
muted closely spaced Lane columns, count/add/overflow affordances, and compact
bordered record cards. Clips Lanes remain columns; no status grouping, table,
Insights, workflow editor or drag-and-drop feature is implied. Board and app
styles live in their own local stylesheets; the root adds no outer padding.
In-card controls and project tabs use actual Primer small sizing. Other project
chrome and form controls use medium sizing, without legacy large target overrides.
The Lane information area is an edge-to-edge default-background header with a
full-width separator inside its muted column, not an inset record card.
The overview's larger heading is simply "Clips", without a separate brand icon,
small duplicate brand or selected-project title. The project path, actions and
project tabs remain; focused Lane titles and Back navigation are unchanged.
Loading, empty and failed-board recovery share a persistent "Clips" heading
with Refresh and eligible Initialize actions aligned to the right. While initial
work, discovery, refresh or initialization is pending, the content area uses the
official Primer Spinner sized to 20px inside a polite status region with
`aria-busy`. The muted visual label is "Loading" with one, two, then three ASCII
dots. Discrete CSS keyframes animate the dots without changing the stable
accessible Spinner label or repeatedly announcing progress. Reduced-motion
preferences stop both spinner and dots; removing the loading subtree stops the
animation without a JavaScript timer. The full recovery project-tab strip uses
the loaded view bar's muted background, inset and divider, preserving the raised
selected-tab silhouette and measured overflow. Settled empty/error guidance has
no spinner. Retry returns through the same loading
state, and an older refresh completion cannot clear a newer pending indicator.
The recovery header is removed when Board content is available, so the loaded
overview and focused Lane keep a single header. Refresh concurrency and canonical
payloads are unchanged.
Titles are plain semantic headings, not buttons or disclosure controls. Titles
and labels wrap without clipping. A collapsed record has one visible small Show
more button. Expanded description, information and Goal Task hierarchy have Show
less controls above and below the content. Both collapse the same content; the
lower control returns focus to the surviving upper Show more control.
Search and explicit focus automatically reveal matching hierarchy.
Activity appears below the description when observed. Unknown/unavailable
activity and empty association placeholders are omitted, without inventing a
status. The anchored Primer kebab sits top-right in the metadata row beside the
record ref/status. Normal token spacing separates that row from the title; no
negative margin pulls the title upward. Lane counts follow their title directly
with a token gap rather than stretching to the column's far edge. Other than visible
expansion, record actions, creation and navigation live in that menu. Menu
selections open real forms or perform navigation; there is no record-actions modal.
All record kinds use "Run in this session" to send the exact record into the
currently joined Copilot session. Associations and claims never redirect that
action or reserve work; no new session is created. "Go to session" appears only
for an associated session with observed `running` or `attention` status and opens
that exact session, distinct from focusing a Lane. Status badges are actual
Primer Labels: `success` for in progress, `accent` for open and `done` for closed.
The ActionMenu root receives the supported external anchor ref so forms and
asynchronous actions can restore focus to the original kebab.
Kebabs use the supported direct Anchor, Tooltip and IconButton composition.
Their overlays are explicitly anchored at both narrow and regular breakpoints,
not responsive fullscreen dialogs. Initial activation opens only the dropdown;
an explicit status, label or edit action may then open its form. Lane, Goal and
Task metadata-row menus share this behavior with the focused-Lane header menu.
Direct record associations combine saved work bindings, exact session record
references and compatible Copilot manager claims. They share one model with
focused service readback. Listed associations retain explicit session names,
provenance and observed activity as read-only sub-cards. The public SDK catalog
preserves the optional human-friendly `name`; its convenience adapter drops
that field. Prompt-derived `summary` text is never used as a title. Multiline
kickoff text in the catalog's `name` field is not treated as a title either.
Unnamed listed sessions say "Current session" or "Copilot session", not a raw UUID. Session
titles use official small body and semibold tokens; record titles keep their medium type.
Manager-claim provenance is displayed beneath the name as "Lane manager session", without changing stored
provenance. Listed sessions with unknown activity keep their name/provenance
without an unavailable status or dangling separator. Unlisted association entries
stay in the model/history but are not displayed as stale UUID-only cards.
Empty association footers are absent.
Idle, errored, unknown and ended sessions do not get Go actions.
Currently only the joined session has live
activity readback; other catalog entries stay unknown, not inferred ongoing from
their presence, timestamps or saved bindings.
Counts describe direct associations to that record, not all descendant workers
or the Lane's total workforce. Unknown catalog activity is not called Running.
There is no global activity-count summary. Counting records linked to a busy
session is not a trustworthy count of executing work, and unobserved sessions
cannot be counted as inactive. The "Running sessions" filter finds records with
observed running associations; its badge deduplicates session IDs. That filter
does not assert that historical linked records execute now, change canonical
record lifecycle, or manufacture activity for catalog-only sessions.
The focused Lane header exposes the same names and provenance as its overview.
Emitted-stylesheet JSDOM checks verify the computed plain-heading wrapping
cascade; they do not measure native pixel geometry. Native pixel fit still
needs human review.
Button skin, padding, height and variants otherwise come from Primer itself.

Overview navigation uses user-approved custom accessible project tabs built with
official Primer tokens/primitives, populated only from the available local-user
registry. The original Board/GitHub Projects raised treatment is intentional:
selected default background, rounded top corners, top/side borders joining the
strip divider, and no bottom border or orange underline. UnderlineNav is not
used for this presentation.
Tabs are text-only and use the small control minimum (1.75rem), 0.25rem block
padding, 0.75rem inline padding, and small body type (0.75rem), all from
official Primer tokens. Tabs remain a single unwrapped row with complete labels.
Actual strip, project-label and trigger measurements partition the projects into
a visible prefix and an anchored final More menu containing only hidden projects.
The accessible plus-icon trigger replaces More when its label cannot fit.
Selected overflow projects remain identified by the trigger's current-page
marker, accessible name and native menu selection. Container/probe ResizeObservers,
project-name/list updates and font readiness/loading events remeasure the row.
Hidden inert, noninteractive spans measure natural labels; real tabs are never
clipped or duplicated as hidden controls. Height remains automatic.
Initial selection prefers the current repository,
then the first available project. Saved selection wins on reopen; stale saved
projects and refresh failures remain errors, not permission to substitute a board.
Tabs replace only the original Board tab strip below the existing header and
above search. The original title/path/actions header remains; focused-view
changes are minor alignment only. No project-selection dialog or trigger remains.
Unavailable discovery and no-board recovery use inline errors and retry.
Registry help and its current-directory code use the official small body token
(0.75rem, 12px at the standard root size); other muted text keeps its own sizing.

The global +New anchored menu contains New Lane, New Goal and New Task; opening
it does not open a modal until an item is selected. There is no standalone
column-side New Lane. Goal creation has an editable optional Lane selector,
initially using the focused Lane when applicable. Global Task creation requires
an explicit available Goal and acceptance criteria; per-Goal New Task retains
its exact parent default. A project without Goals explains the prerequisite and
blocks Task creation. Dialogs keep pending/error/validation guards and return
focus to the original New or record-menu trigger. Closed-Goal reveal stays in
the Lane menu without the old empty-Lane "Closed goals are hidden." sentence.

The invisible-variant Initialize action beside Refresh is offered only when the actual
joined-session Git root has no `.clips` entry, even when another project is
selected or no board can load. It accepts no caller path/project override.
The service revalidates the directory and invokes the dedicated runtime method
using canonical `clips init --store-only`. This noninteractive mode creates and
registers local-only workflow storage without installing skills/plugins, changing
editor settings or syncing GitHub. Existing stores are not modified. Success
refreshes discovery and selects the newly initialized current project; pending
and failed operations stay explicit. The renderer/provider bridge version is 2.

## Build and checks

From `plugins/copilot`:

    npm ci --include=dev --include=optional
    npm run build
    npm run check:build
    npm test

The maintained installer (`node scripts/install-copilot.js` from repository
root) verifies source/build hashes before exposing links, runs the locked
production dependency closure and verifies again through the installed link.
It does not need build tools at runtime. Ship regenerated `dist` with changed
UI sources. `scripts/build-canvas.mjs` produces a deterministic manifest without
timestamps. Repeating the same lock/source build must yield identical hashes.
The service snapshots verified assets at provider creation so old provider
code cannot serve a newer renderer against an old API. Diagnostics report
exact emitted identities; actual App RPC readback is separate activation evidence.

Build/install validation requires exact source and asset agreement. Runtime
startup instead verifies the complete emitted artifact, its index and supported
renderer/provider bridge version. Source-only development changes do not prevent
another session from opening that checked artifact. Diagnostics expose
`uiAssets`, `uiBuild` and `uiSourceStatus` (explicitly sampled at provider load);
they do not claim that edited source has already been compiled. Missing,
corrupted, partial or unsupported artifacts still fail with a rebuild error.
Changes to the HTTP action contract must deliberately increment the bridge
version in both the builder and runtime validator.

Node production-bundle JSDOM regressions cover interactions, canonical payloads,
project fences, focus restoration, state preservation and theme selection.
The harness supplies browser APIs absent from JSDOM, not a rendering engine.
Responsive-tab cases control DOMRect widths and ResizeObserver/font events,
including fractional fit thresholds, to exercise actual emitted partitioning.
These checks do not establish native visual or pixel acceptance.

## Provenance

Primer React and primitives: https://github.com/primer/react and
https://github.com/primer/primitives (MIT, copyright GitHub).
Octicons: https://github.com/primer/octicons (MIT, copyright GitHub).
React: https://github.com/facebook/react (MIT, copyright Meta Platforms).
Bundled package notices are retained in `UI-LICENSES.md`.
