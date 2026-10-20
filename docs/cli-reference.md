# Clips command and workflow reference

For installation, onboarding, and everyday use cases, start with the
[README](../README.md). This reference covers manual commands, record formats,
coordination rules, and maintenance.

`clips` keeps local work contracts for agents and people. A goal holds the
outcome and plan. A task starts as an atomic change request and becomes the
record of what changed and was accepted. System components give related tasks
stable boundaries to rely on.

Workflow state stays under `.clips/`, outside repository history. GitHub
collaboration is available after explicit opt-in.

> This reference describes Clips 2.0.0. Earlier
> releases can have a different command set; the 1.6.0 baseline did not include
> the component, acceptance, and revision capabilities below. Check
> `clips --help` for installed commands, or use
> `node /path/to/clips/src/cli.js` to run this checkout.

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

Read [the precise work model and JSON fields](work-contracts.md) or
[the complete small-feature example](work-contract-example.md).

### Agent execution policy

The shipped skills default to comprehensive plans within one coherent Lane,
detailed Goals with observable acceptance criteria, meaningful Tasks and real
dependencies, followed by implementation and verification. Reuse existing
records and preserve selected-Task or atomic scope. Comprehensive means complete
coverage, not filler work. Explicit brainstorming, plan-only, defer, queue or
narrower-output requests override that default. A plan or launch preview is not
implementation. Lane Manager plans and coordinates continued delivery through
the current harness's execution path. Clips Dev plans, implements and verifies
an outcome in its own session, either directly for the user or as a delegated
dev owner. Clips supplies the durable work contracts and acceptance mechanics.
Lane Manager continues through the agreed outcome without requiring another
skill or a routine "go" between tasks.

Host identity, Lane claims, management roles, and previous session associations
are not prerequisites for authorized work. The canonical CLI does not require a
host ID or a manager claim. Work `owner` fields are advisory responsibility
metadata, not execution locks. Preserve attribution and coordinate actual
overlapping edits rather than clearing owners or history to proceed.

Agents use the CLI for records and their host's supported tools for session
steering and communication. An existing dev owner needs no extra session just
for an identity or role. Per-agent
instructions cannot disable hardcoded checks in a separate host integration;
this package does not include the Copilot canvas runtime.

In GitHub Copilot App, dev sessions delegated by a Lane Manager are its direct,
coordinated children. There is no intermediate coordinator, Squad Leader or dev-lead
App session. The manager creates any useful sibling workers; the dev owner
retains technical integration responsibility without spawning nested workers.
Native readback checks both creator fields, repository and workspace; native
messages preserve manager contact and user steering throughout execution.
Paseo instead keeps its verified top-level manager-to-dev path. A standalone
Clips Dev session does not need a manager or a new parent. These are
host-specific instructions, not a new runtime launcher or scheduler. On other
harnesses, Lane Manager must invoke available native sub-agents even if they
are not user-steerable. If no delegation primitive exists, the manager implements and
verifies authorized Tasks itself, linearly in dependency/dispatch order. That
fallback does not bypass denied authorization or missing tools/files.

Authentication, external-action approval, exact action targets, acceptance
attribution, atomic writes, journal locks, and stale-revision checks remain
separate safeguards. See [coordination policy](work-contracts.md#management-policy).

## Lane worker budget

The project setting `lane_max_active_agents` defaults to **5 concurrently active
workers per Lane**, excluding the Lane Manager. Each Lane gets its own budget;
this is neither a project-wide worker pool nor a lifetime creation quota.
It is a ceiling, not a requirement to launch five workers.

After project setup, use the supported configuration interface:

```bash
clips config lane_max_active_agents          # Read the numeric value; absent means 5
clips config --lane-max-active-agents 3       # Store the project default for its Lanes
clips config lane_max_active_agents 3        # Equivalent existing key/value syntax
clips config --help
```

The flag takes one value, separated by a space. Values must be positive safe
integers written as decimal digits. Invalid values or flag forms fail without
writing configuration. Invalid stored limits fail readback instead of becoming
unlimited; a valid setter can repair that field. Malformed configuration is not
overwritten by a limit update. Existing unrelated settings are preserved.

Before dispatch, Lane Manager reads the setting from the Lane's canonical
project and announces the effective budget and how to override it. An explicit
user instruction such as "use two workers for this Lane" overrides that Lane,
not the project's stored default. The manager preserves this decision in
existing Lane context; there is no separate per-Lane configuration flag.
Stricter user or host resource limits still apply.

Active, starting and reused/resumed workers consume capacity. The manager
reserves a slot before dispatch, counts any permitted nested helpers in the same
budget, and does not treat unknown activity as free capacity. Confirmed idle or
completed workers free slots; reactivating an idle worker needs capacity again.
Lowering the budget never implicitly terminates existing workers. Defer new
launches or resumptions until capacity returns.

The CLI validates and persists the configuration value. **Lane Manager applies
the concurrency policy through the host's native tools; Clips does not enforce
a native process limit or provide a cross-session scheduler.** Copilot still
uses direct children without nested workers. Other hosts retain their own
delegation paths. A harness with no delegation primitive uses the existing
linear fallback and creates no worker slots; a full budget does not make an
available primitive disappear.

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
[acceptance schema](work-contracts.md#acceptance) for a complete example.

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

The optional [CR template](records/cr/CR-TEMPLATE.md) and
[ADR template](records/adr/ADR-TEMPLATE.md) remain available. Copy them into
`.clips/records/` when needed; never put instances beside templates.

## Skill library exports

Clips is also a Skillshop-compatible skill library. It publishes portable
components through the standard `@dfosco/clips/skillshop` package manifest:

| Export | Role |
|---|---|
| `skill:lane-manager` | Comprehensive planning, coordination and continued delivery. Delegates development through the current harness, with linear execution only when delegation is unavailable. |
| `skill:clips-dev` | Autonomous staff-developer workflow. Plans, builds and verifies the requested outcome in its own session, without acting as Lane Manager. |
| `skill:clips` | Structured work records: Lanes, Goals, Tasks, components, criteria, results and acceptance. |

`skill:loopz` remains an import compatibility alias for `skill:clips-dev`, not
a fourth skill or a separate continuation requirement. Both resolve to the same
canonical `clips-dev` directory. Use `skill:clips-dev` for new imports.
These exports describe the current source; an older installed package may not
include them yet. A source update does not update an installed package.

Consumers refer to these names rather than importing package-specific JavaScript
symbols. With Skillshop available and Clips installed in the consuming project's
dependencies, resolve or materialize them with:

```bash
skillshop resolve @dfosco/clips skill:clips
skillshop import @dfosco/clips skill:lane-manager --to .agents/skills/lane-manager
skillshop import @dfosco/clips skill:clips-dev --to .agents/skills/clips-dev
```

For the **global Clips installation** in the README, pass the installed package
directory instead. Run these from the project that should receive the skills:

```bash
npx --package=skillshop@2 skillshop import "$(npm root -g)/@dfosco/clips" \
  skill:lane-manager --to .agents/skills/lane-manager
npx --package=skillshop@2 skillshop import "$(npm root -g)/@dfosco/clips" \
  skill:clips-dev --to .agents/skills/clips-dev
```

These commands can download Skillshop and create project skill files; they do
not change the global Clips installation. Use the agent directory printed by
`clips init` if it differs from `.agents`. If Clips was installed another way,
pass that package directory instead. Imports refuse an existing destination by
default; review local changes before choosing how to update it.

A Skillshop-built personal library can also re-export a component without
copying its source. Applications such as Hypercanvas can resolve the same
components directly when offering Clips-based workflows.

The source mapping lives in `skillshop.library.json`; the packaged
`skillshop.manifest.mjs` is the generated application-facing contract.
Maintainers add exports with `skillshop export skill:<name> <directory>` and
regenerate with `skillshop build`; do not hand-edit the generated manifest.
Source delivery does not refresh already installed skills or publish a release.

Clips uses `skillshop/import` during `clips init` to copy the explicitly
exported `skill:clips` component into the project's selected agent directory.
Lane Manager and Clips Dev remain explicit Skillshop imports; init does not install
them automatically. Cross-skill guidance applies when those optional skills are
available, rather than requiring an import to execute an existing Task.
Re-running init overlays changed skill files and preserves additional
project-local files. Imports are independent filesystem snapshots; there is
no live subscription to the source library or retroactive revocation.

The CLI requires `skillshop@^2.0.0`. Publish Skillshop 2.x **before**
publishing Clips, then regenerate `package-lock.json` with npm to record
the published artifact's registry integrity checksum.

## Installation and setup

```bash
npm install -g @dfosco/clips
# Or inspect the published CLI without a global install:
npx @dfosco/clips --help
```

Install commands above select the published npm package, not the source in this
checkout. Check the installed command set before using newer capabilities.

Use the top-level `clips --help` to inspect commands. In this checkout,
`clips init --help` still runs initialization; it is not a read-only help command.

`clips init` creates local workflow state and installs the Clips skill into the
repository's detected agent directory. It does not contact GitHub or import
issues by default. Existing repositories with `collaboration: true` preserve
that setting.

The system registry lives at `~/.clips/projects.json` or
`$CLIPS_HOME/projects.json`. Missing project paths are pruned from the registry.
Projects default to their directory name; change an ID with
`clips config project_id <id>`. IDs must be unique across registered projects.

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

When collaboration is enabled, sync also reads PRs through the configured
`gh` session. It associates PRs whose title or body explicitly references a
goal, task, or legacy CR. Unmatched PRs remain in the reserved
`.clips/db/_github.jsonl` cache and are not discovered as goals. Repeated pulls
are idempotent by repository and PR number.

## Development and release

```bash
npm ci
npm test
npm run test:all
node scripts/package-smoke.js --skills-only
```

`npm test` runs the core CLI and library tests in Node with one worker by default
to limit memory use. The `--skills-only` check packs and reads the
shipped skills, compatibility alias, relative references and harness-policy
scenarios. `npm run test:all` also runs the full package smoke check against the
real tarball, covering retained CLI commands, installation switching, records
and acceptance. Neither check needs a development server or a frontend build.
Release commands perform external versioning and publication workflow:

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
