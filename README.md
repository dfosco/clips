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

## Installation and setup

```bash
npm install -g @dfosco/clips
# Or inspect the published CLI without a global install:
npx @dfosco/clips --help
```

Install commands above select the published npm package. They do not install
unreleased work-contract capabilities from this branch.

`clips init` creates local workflow state and installs the Clips skill into the
repository's detected agent directory. It does not contact GitHub or import
issues by default. Existing repositories with `collaboration: true` preserve
that setting.

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
