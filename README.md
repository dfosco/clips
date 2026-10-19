# clips

`clips` keeps local work contracts for agents and people. A goal holds the
outcome and plan. A task starts as an atomic change request and becomes the
record of what changed and was accepted. System components give related tasks
stable boundaries to rely on.

Workflow state stays under `.clips/`, outside repository history. GitHub
collaboration is available after explicit opt-in.

> The component, acceptance, and revision commands below describe the unreleased
> work-contract implementation in this checkout. The published 1.6.0 baseline
> does not include those capabilities. Check `clips --help` for the installed
> command set; use `node /path/to/clips/src/cli.js` to run this checkout.

## Work model

| Record | Purpose | Example |
|---|---|---|
| Lane | Strategic, conceptual frame spanning related goals; closes with a product/system retrospective rather than engineering acceptance | `#l1` Workspace experience |
| Goal | Engineering outcome, scope, plan, architectural decisions, and outcome acceptance | `#g1` Restore the last workspace |
| Task | One independently assignable and acceptable change; request before, record afterward | `#g1#t1` Persist the selected workspace ID |
| System component | Persistent responsibility with a behavioral boundary and implementation references | `#c1` Workspace preference storage |

A Lane is the strategic frame above goals. It explains the product direction and
groups outcomes that make sense together over time. It deliberately does not
carry technical acceptance criteria or verification receipts. Closing a Lane
records what product goals were achieved, the decisions made across its goals,
the resulting system/component overview, and useful product media such as
screenshots.

A goal's plan describes how to reach one engineering outcome; its decisions
explain why the approach was chosen. They can evolve in the same record. An
independent ADR is optional when a decision needs a separate lifecycle.

A component is a unit of responsibility that other system parts or tasks can
depend on. It describes its interface or observable behavior, constraints, and
source or specification references. It can span files or live inside a larger
package. Its identity survives a move or internal refactor while its
responsibility remains coherent.

Task scope selects components and states what will change and what constraints
apply. Contracts, constraints, and decisions use named Markdown sections or
authoritative source links. Ordinary implementation steps are lists. Add a task
when a change can be owned and accepted independently.

Use as much structure as the work needs. Optional `sections` and `extensions`
let agents add named Markdown, project metadata, or relationships. There is no
mandatory parallel CR, execution note, or extra identifier for every interface
or invariant.

Read [the precise work model and JSON fields](docs/work-contracts.md) or
[the complete small-feature example](docs/work-contract-example.md).

## Quick start

Initialize inside a Git repository:

```bash
clips init
clips goal create '{"title":"Restore the selected workspace","description":"Reopen the last available workspace after reload","plan":"Implement persistence, then integrate selection","decisions":"Store the workspace ID and validate it against current workspaces","acceptance_criteria":[{"id":"A1","description":"Reload restores the last available workspace"}]}'
clips component create '{"title":"Workspace preference","responsibility":"Persist the selected workspace ID","contract":"Read returns an ID or no preference; storage failures do not block startup","source_refs":["src/workspace-preference.js"]}'
clips task create g1 '{"title":"Persist workspace preference","description":"Read and write the selected workspace ID","components":["#c1"],"scope":"Persistence boundary and its failure behavior","acceptance_criteria":[{"id":"A1","description":"A stored ID can be read back"},{"id":"A2","description":"Unavailable storage does not throw"}]}'
clips task status g1 t1 in_progress
clips view '#g1#t1' --json
```

The examples assume an empty store; use the refs returned by your commands.
The CLI accepts shorthand refs and may display padded forms such as
`#g001#t01`. Quote hash refs in shell commands.

Create and update commands accept inline JSON, `--file path.json`, or
`--stdin`. A task result file can preserve the original request while adding
the actual change:

```json
{
  "record": "Describe the implemented behavior, compatibility impact, and relevant verification.",
  "sections": {
    "Amendments": "Record material changes to the agreement and why."
  }
}
```

Apply the result, then record acceptance after verifying it:

```bash
clips task update g1 t1 --file task-result.json
clips task accept g1 t1 --file task-acceptance.json
```

An acceptance file contains the artifact actually checked, the accepting actor,
a summary, and evidence for every criterion. See the
[acceptance schema](docs/work-contracts.md#acceptance) for a complete example.

## Stable references and history

| Reference | Meaning |
|---|---|
| `#l1`, `#g1`, `#g1#t1`, `#c1` | Current Lane, goal, task, or component |
| `#g1#A1`, `#g1#t1#A1` | Acceptance criterion belonging to an engineering record |
| `#l1#r1`, `#c1#r1`, `#g1#t1#r1` | Recoverable record snapshot |
| `#g1#t1#r1#A1` | Criterion in a particular task snapshot |

Criteria retain their IDs when reordered. Removed IDs are not reused. Revisions
use one history mechanism across goals, tasks, and components; they are record
snapshots, not versions of the executable code.

```bash
clips view '#c1#r1' --json
clips view '#g1#t1#A1' --json
clips view '#t1#A1' --goal '#g1' --json
clips history '#g1#t1' --json
clips component history c1
```

Include the commit, tree/diff identity, or immutable artifact reference with
verification evidence. A record revision or Git HEAD alone does not identify the
contents of a dirty working tree.

## Acceptance and administrative status

`task accept` and `goal accept` record structured receipts tied to a request
snapshot. An assessment names each criterion and supplies evidence or an
authorized waiver. Contract changes invalidate affected acceptance while
preserving its history. `accepted_by` must match a configured
`acceptance_owner`; both are metadata, not authentication.

Clips checks receipt structure. It does not execute verification commands,
validate the truth of submitted evidence, or grant approval authority. Agents
must inspect the actual result and respect human-owned approvals.

Receipts also capture `component_basis` as pinned component refs. Explicit pins
are honored; current refs resolve at acceptance time. Pin a negotiated baseline
before assignment when it must remain fixed. Later component edits do not
automatically reopen tasks across separate journals. The receipt's `artifact`
identifies the accepted result; explicit acceptance clears the legacy
`closed_commit_sha` field.

`status closed` remains an administrative status update for compatibility. It
records HEAD but does not create acceptance evidence. Goal acceptance also requires all child
tasks to be terminal; `not_planned` or `duplicate` children need explicit
exceptions in the goal receipt. Existing closed tasks do not receive fabricated
acceptance receipts. A selected-task assignment can finish without closing its
whole goal.

Goals and tasks retain the statuses `open`, `in_progress`, `closed`,
`not_planned`, and `duplicate`. Components use `active` and `retired`.

### Behavior and verification modes

Goals and tasks can carry optional behavior descriptions, including Gherkin-style
scenarios. Clips stores this text without parsing or executing it.

- `behavior`: verify relevant observable behavior using methods suitable for
  the repository and change.
- `behavior_and_tests`: include relevant automated test evidence as well as
  checking behavior.

Tasks inherit their goal's mode unless overridden. Setting a task's mode to
`null` restores inheritance. Legacy records without a mode use `behavior`.
The mode does not prescribe a language, framework, or test-writing order.
Types can establish structural contracts; runtime behavior still needs suitable
evidence.

## Dependencies and strategic Lanes

Component `dependencies` describe system relationships. Task `blocked_by`
describes required work ordering. An agreed interface can let a provider and
consumer be implemented in parallel; integrated acceptance still checks their
interaction. Dependencies are coordination data, not an automatic scheduler.

A **Lane** is an optional strategic frame for related goals. A goal belongs to
at most one Lane. Lanes are intentionally less formal than goals: they can carry
a description and product goals, but they do not have technical acceptance
criteria, test evidence, or an acceptance owner.

```bash
clips lane create '{"title":"Workspace experience","description":"Make returning to work feel continuous","product_goals":["Users return to the right workspace quickly"]}'
clips goal assign g1 l1
clips goal update g2 '{"blocked_by":["g1"]}'
clips lane show l1
clips goal assign g1 none
```

When a Lane is closed, Clips records a strategic retrospective rather than an
engineering acceptance receipt. Closure requires a summary, a cross-goal decision
log, a system overview, and the product goals achieved. It also snapshots the
Lane's goals and their statuses, derives referenced components from those goals
and tasks, and can include screenshot or other product-media references.

```json
{
  "summary": "Workspace restoration is now coherent across reload and switching.",
  "decision_log": "We standardized persistence on stable workspace IDs.",
  "system_overview": "Workspace preference owns persisted selection; project selection consumes it.",
  "product_goals_achieved": [
    "Users return to the intended workspace after reload"
  ],
  "media": [
    {"src":"screenshots/workspace-restored.png","caption":"Restored workspace"}
  ]
}
```

```bash
clips lane close l1 --file lane-closure.json
clips view '#l1'
clips view '#l1#r1' --json
```

Lanes can be moved to `in_progress`, `not_planned`, or `duplicate` without
technical ceremony. The `closed` state uses `lane close` so the retrospective
is not lost. Merely sharing a Lane does not make goals dependent on one another.

Historical Tracks remain readable. Existing `#r001`, `track_id`,
`.clips/db/tracks/`, and `clips track` data/commands are compatibility
surfaces; current UI and agent guidance use `#l001`, `lane_id`, and
`clips lane`. GitHub collaboration mirrors Lanes as parent issues containing
their goal issues.


## Project labels

Labels are optional on Lanes, Goals, and Tasks. Each repository's shared Clips
config holds its own catalog. Linked worktrees use the same catalog. Assignments
are append-only journal events and do not change status or engineering acceptance.

```bash
clips label list --json
clips label create '{"name":"ready-to-review","color":"#8b5cf6"}'
clips label add '#g1' ready-to-review
clips label add '#l1' ready-to-review
clips label add '#alice#g1#t1' ready-to-review
clips label edit ready-to-review '{"name":"Ready for validation"}'
clips label recolor ready-to-review '#3b82f6'
clips label remove '#g1' ready-to-review
clips label delete ready-to-review
```

Names must be nonempty text up to 80 characters and unique ignoring case. Colors
use six-digit hex values. Creation derives an ID from the name, or generates one
when the name cannot form a slug. An explicit lowercase `id` is optional.
Renaming keeps that ID. `view
--json` exposes `label_ids` plus resolved `labels` with the current name and color;
`board --json` also includes the project catalog in `labels`. Historical record
views keep historical assignment IDs but resolve against the current catalog.

Deletion refuses assigned labels, including assignments on closed records and in
other namespaces. Remove each assignment first. Deletion preserves journals and
retires the ID permanently. Recreating a name gets a new ID if the old one was
retired; explicitly requesting a retired ID fails. Catalog edits preserve unrelated
configuration. Malformed config or unreadable journals prevent destructive edits.

## Storage and compatibility

Goal/task events live under `.clips/db/`. Component events live under
`.clips/components/`. Components default to repository-wide storage: `#c1` does
not change when the configured user changes. Explicit component namespaces such
as `#alice#c1` remain available; goal/task namespaces keep their existing behavior.
Independent legacy CR and ADR Markdown records live under `.clips/records/{cr,adr}/`.

Workflow instances must not be committed. Clips adds `.clips` to the
repository-local `.git/info/exclude`; no shared `.gitignore` change is needed.
Committed product documentation and source describe shipped behavior.
Committed templates define formats, not record instances.

Worktrees share the workflow store through the common repository root. Use one
coordinator for shared record writes by default. Revision checks and short file
locks reduce specific write hazards; they do not provide distributed task
ownership, leases, or a scheduler.

Existing Track relationships are exposed as legacy Lane aliases without rewriting
their journals. Existing `planning` and `building` labels remain readable.
Neither prohibits
tasks or requires a separate ADR. Existing attached ADRs, CRs, and their links
remain available. New work normally keeps the request and result in the task
and decisions in the goal.

Independent legacy records retain the lifecycle `Draft`, `Proposed`,
`In Review`, `Accepted`, `Deprecated`, and `Archived`. Archiving moves a
record into its type's `archived/` directory. Use them when the project needs a
separate record and link the authoritative work rather than duplicating it.

```bash
clips record status CR-017 in_review
clips record status ADR-003 accepted
clips record status CR-017 archived
```

The optional [CR template](docs/records/cr/CR-TEMPLATE.md) and
[ADR template](docs/records/adr/ADR-TEMPLATE.md) remain available. Copy them into
`.clips/records/` when needed; never put instances beside templates.

## Skill library exports

Clips is also a Skillshop-compatible skill library. It publishes three portable
skills through the standard `@dfosco/clips/skillshop` package manifest:

- `skill:clips` — the Clips planning and work-contract workflow.
- `skill:lane-manager` — cross-surface lane planning and coordination.
- `skill:loopz` — the autonomous continuation/orchestration workflow.

Consumers refer to these names rather than importing package-specific JavaScript
symbols. For example, a Skillshop consumer can resolve or materialize them with:

```bash
skillshop resolve @dfosco/clips skill:clips
skillshop import @dfosco/clips skill:lane-manager --to .agents/skills/lane-manager
skillshop import @dfosco/clips skill:loopz --to .agents/skills/loopz
```

A Skillshop-built personal library can also re-export any component without
copying its source. Applications such as Hypercanvas can resolve the same
components directly when offering Clips/Loopz as an optional Squads workflow.

The source mapping lives in `skillshop.library.json`; the packaged
`skillshop.manifest.mjs` is the generated application-facing contract.

`clips init` uses Skillshop 2.1.0 to install all three exported skills. It asks
on every interactive run whether to install into this project or the user
account. Pass `--global` to select the user account directly; this aliases
`--skills-scope user`. Project imports go to the selected agent directory,
overlay changed skill files, and preserve additional project files. User
installs go to `~/.agents/skills` and replace existing copies, including
local additions. Imports are independent filesystem snapshots; there is no
live subscription to the source library or retroactive revocation.

For Clips and Lane Manager development on this machine, install the maintained
checkout as live skills instead of snapshots:

```bash
node scripts/install-live-skills.js
```

This links only Clips and Lane Manager from `~/.agents/skills` and
`${CODEX_HOME:-~/.codex}/skills` to this checkout. Existing copies are moved to
`~/.clips/skill-backups/` (`CLIPS_HOME` overrides the `.clips` root); repeating
the command leaves current links unchanged. Source edits become visible through
both paths immediately. No npm publication or `npm link` is involved. Codex
supports linked skill folders and detects skill changes; restart it if discovery
does not refresh. Instructions already loaded into a conversation are not
rewritten by a filesystem change. See [OpenAI's skill discovery documentation](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).

The checkout CLI's `init` preserves either skill's live link or canonical
checkout directory. The legacy `scripts/install-lane-manager.js` command still
installs only Lane Manager. Production mode switching refuses to refresh a
project with such a source because a saved older CLI may overwrite it. This protection does
not cover invoking an old package or a third-party skill installer directly.

The CLI requires the published `skillshop@2.1.0` package. The dependency
lockfile records its npm registry integrity checksum.

## Repository integrations

Both host integrations are distributed from
[`dfosco/clips`](https://github.com/dfosco/clips). Keep the full repository when
installing from a checkout: the plugins use its matching `src/cli.js` and
canonical skills. Copying a plugin directory alone loses that closure.

| Host | Repository path | Install guide |
|---|---|---|
| Paseo | `plugins/paseo` | [Paseo plugin requirements, installation, update and rollback](plugins/paseo/README.md#install) |
| GitHub Copilot App | `plugins/copilot` | [Copilot extension/canvas requirements, installation, update and rollback](plugins/copilot/README.md) |

Use Git, npm and **Node.js 22.18 or later** for repository integration setup.
Host versions and platform requirements are specified in each guide. Start a
maintained checkout with:

```bash
git clone https://github.com/dfosco/clips.git
cd clips
npm ci --omit=dev --ignore-scripts
node src/cli.js --help
```

Run `node /absolute/path/to/clips/src/cli.js init --skills-scope project` inside
the repository whose work you want to track. This initializes that project's
local store. It preserves an existing collaboration setting; new stores keep
GitHub collaboration disabled. No global CLI replacement or npm publication is
needed for the repository install paths.

### Paseo

The [Clips Workspaces plugin](plugins/paseo/README.md) browses Lanes → Goals →
Tasks from the selected repository's local Clips store. It creates Paseo
worktree workspaces with an optional running agent and links to existing
sessions. The guide describes direct Git monorepo installation and local
checkout installation, including how the daemon resolves the matching CLI:

```bash
paseo plugin add git:dfosco/clips:plugins/paseo --ref main
```

Clips owns work definitions and acceptance. Paseo owns execution and agent
lifecycle. Ordinary dev agents use the Clips skill's
[shared Paseo procedure](.agents/skills/clips/references/paseo.md) to maintain
records and verify native execution bindings. An `in_progress` Clips status
does not prove an agent is running.

### GitHub Copilot App

The [Copilot integration](plugins/copilot/README.md) installs the **Clips Work**
canvas extension and canonical skills from a full checkout. Use its repository
installer after the setup above:

```bash
node scripts/install-copilot.js
```

The installer provisions locked dependencies, verifies the shipped canvas
assets and writes an installation receipt. Replaced targets are backed up; newly
created links have no prior target to back up. The checkout remains the live
source. Keep it at its installed path and follow the guide to activate or reload
the extension in the actual Copilot session.

Copilot canvas support is experimental. Installation and isolated runtime
checks do not establish native App visibility, top-level session creation or
parentage. Current-session delivery and saved-session navigation have distinct
capability limits; see the [integration contract](plugins/copilot/CONTRACT.md)
and [runtime behavior](plugins/copilot/runtime/README.md).

### Update and rollback

Record the installed source with `git rev-parse HEAD` before updating. In a
clean maintained checkout, `git pull --ff-only` followed by the guide's
provisioning and reload steps updates the integration. The two hosts have
different installation receipts and reload mechanisms; follow their linked
update/rollback instructions rather than treating a Git pull as activation.

For Copilot, `node scripts/install-copilot.js --rollback` removes installer-created
links and restores replaced targets where real backups exist, subject to receipt
and ownership checks. It does not undo a Git update. To run older source, retain
a separate checkout
at the recorded commit and follow that host's installation steps. Keep an
installed checkout until its links have been replaced or rolled back. Local
workflow records and host credentials are separate from plugin source.

## Installation and setup

```bash
npm install -g @dfosco/clips
# Or inspect the published CLI without a global install:
npx @dfosco/clips --help
```

Install commands above select the published npm package. They do not install
unreleased work-contract capabilities from this branch.

`clips init` creates local workflow state and asks where to install the
exported skills. Use `clips init --global` to install in the user account. In
scripts, pass `--global`, `--skills-scope project`, or `--skills-scope user`;
without a terminal or an explicit scope, init exits before
writing project state. It does not contact GitHub or import issues by default.
Existing repositories with `collaboration: true` preserve that setting.

### Switch between development and the installed npm package

`clips dev` links a source checkout as the global command and saves the
currently installed npm package under `~/.clips/installations/prod/`.
`clips prod` runs that saved package without downloading from npm. The global
command stays linked to the development checkout as a dispatcher, so both switch
commands remain available even if the saved package predates them.

Start the first switch from a development checkout:

```bash
cd ~/workspace/example-project
node ~/workspace/clips/src/cli.js dev
clips prod
clips dev
```

Use `--project <repo>` to refresh another repository and
`clips dev --checkout <clips-repo>` to choose a checkout. The remembered
installation lives under `~/.clips/installation.json`; `CLIPS_HOME` overrides
that directory. Switching modes reruns the selected version's initialization to
refresh project skills. Skills absent from the selected package are removed
only if unchanged; locally edited files are retained with a warning.
Project-tracked skill changes remain visible in Git.

### Optional GitHub collaboration

Enable collaboration only when intended:

```bash
clips config collaboration true
clips sync
```

With collaboration disabled, initialization, synchronization, and local
goal/task mutations perform no GitHub issue or pull-request operations.
With it enabled, goals can mirror as issues and tasks as checklists or separate
issues according to `tasks_as_issues`.

```bash
clips goal unlink g1
clips goal unlink --all
```

Unlinking preserves local history and existing remote issues, and removes the
selected goals and tasks from future synchronization. It is safe to repeat.
Structured work-contract state remains in the local workflow store.

## Local board

```bash
clips web
```

Open the printed local URL. In an initialized repository, the read-only board
opens that project. Elsewhere it opens projects registered by `clips init`.
Use the project selector to combine projects and
`clips web --host <host> --port <port>` to change server settings.

The system registry lives at `~/.clips/projects.json` or
`$CLIPS_HOME/projects.json`. Missing project paths are pruned from the registry.
Projects default to their directory name; change an ID with
`clips config project_id <id>`. IDs must be unique across registered projects.
The combined board qualifies refs with project identity, such as
`project#g001#t01`.

The board exposes `GET /api/board` and cannot create, edit, reorder, or
synchronize workflow data. The installed package includes built board assets.

When collaboration is enabled, sync also reads PRs through the configured
`gh` session. It associates PRs whose title or body explicitly references a
goal, task, or legacy CR. Unmatched PRs remain in the reserved
`.clips/db/_github.jsonl` cache and are not discovered as goals. Repeated pulls
are idempotent by repository and PR number. Linked PRs open in GitHub.

## Development and release

```bash
npm ci
npm test
npm run web:dev
npm run web:build
npm run test:all
```

`npm run test:all` includes the package smoke check. Release commands perform
external versioning and publication workflow:

```bash
npm run release          # patch
npm run release:minor
npm run release:major
npm publish
```

Version commands run tests, update the version, create a commit and tag, push to
GitHub, and create a GitHub Release. They require the GitHub CLI. Publishing
reruns the full test and package smoke suite before publishing
`@dfosco/clips`.

## License

MIT
