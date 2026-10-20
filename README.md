# Clips

Clips gives AI agents a shared structure of goals, tasks, and clear checks for
what "done" means. Its Lane Manager turns a broad idea into that structure,
coordinates the agents doing the work, and keeps their results tied to the
agreed goals.

## Install and get started

You need [Node.js 18 or newer](https://nodejs.org/), Git, and an AI coding
assistant that can read your project files and run commands.

### 1. Install Clips

Open a terminal and run:

```bash
npm install -g @dfosco/clips
```

This installs the published release. Some commands and skills in this repository
may be newer than that release; `clips --help` shows the commands you have.

### 2. Set up your project

Open a terminal in the Git repository where you want to work, then run:

```bash
clips init
```

Setup creates a local place to keep your plans and progress, then asks whether
to install the skills for this project or your user account. It installs
**Clips**, **Lane Manager**, and **Clips Dev**, and keeps work records out of
Git commits. You do not need a GitHub account for local use. For noninteractive
setup, use `clips init --skills-scope project` or `clips init --global`.

New projects start with GitHub sharing off. Running setup again preserves an
existing collaboration setting and refreshes ordinary skill copies. Maintained
source links are preserved.

### 3. Use Lane Manager in your assistant

Open the project in your AI tool and ask it to use **Lane Manager**. The three
skills have distinct roles: Lane Manager plans and coordinates workers,
Clips Dev plans and builds in its own session, and Clips keeps their shared
work records. [Individual skill imports](docs/cli-reference.md#skill-library-exports)
remain available for custom setups.

A skill is a set of instructions your assistant follows. If it does not
recognize an installed skill, ask it to read that skill's `SKILL.md` file in
your project. If setup reports that it could not install a skill, resolve that
error before expecting the assistant to use it.

### Optional app integrations

The package also includes **Clips Work for GitHub Copilot App** and the **Paseo
plugin**. They are separate, explicit installations requiring Node.js 22.18 or
newer; ordinary `clips init` does not install or activate them.
See [app integration setup](docs/cli-reference.md#app-integrations) for supported
installation paths and their limits.

## Meet your Lane Manager

Lane Manager is the coordinating agent for a whole piece of work. You describe
where you want to go; it develops the breakdown and coordinates the agents that
will get you there.

By default, each Lane can have up to **5 active workers at once**, not counting
the manager. Lane Manager tells you the effective budget before starting workers.
You can ask for a different limit for that Lane, such as "use at most two
workers." This is a ceiling, not a requirement to create five agents.

For example:

> Use Lane Manager to improve onboarding. People should be able to recover from
> expired invitations and resume an unfinished signup. Keep the existing login
> options. Plan and deliver this as one Lane, using agents in parallel where
> useful. Keep the work in this working tree and branch.

### More than a Markdown plan

Lane Manager organizes the work into a nested structure: a **Lane** contains
related **Goals**, and each Goal breaks down into **Tasks** with clear completion
criteria.

| Record | Example | What it keeps clear |
|---|---|---|
| **Lane** | Make onboarding easier to finish | The overall direction and related goals. |
| **Goal** | Recover from an expired invitation | The outcome to deliver and how to tell it works. |
| **Task** | Send a replacement invitation | The specific change, its constraints, and its completion checks. |

These are linked work records, not just headings in a one-off plan. A task keeps
its request, dependencies, completion criteria, and eventual result together.
For example, "Send a replacement invitation" is complete when someone with an
expired link can request a new invitation, receive it by email, and use it to
join the team.

Agents check their work against those agreed criteria rather than deciding what
"done" means after writing the code. The result and evidence stay with the task,
so another agent can inspect them or pick up the remaining work.

### Work through the details before implementation

The manager and dev agents establish what each change must do, what it must
leave alone, how it connects to other work, and how it will be checked. That
includes failure cases, dependencies, and agreements about the parts different
agents will build together.

Lane Manager looks for missing work and unclear handoffs before dispatching
implementation. The breakdown can evolve as agents learn, but changed
assumptions need to be reconciled across the affected tasks, not lost in
separate conversations. Depth should match the work; a small change does not
need a padded task list.

### Keep useful work moving in parallel

Lane Manager coordinates as many agents as can usefully work in parallel,
within the Lane's worker budget and your tools and resource limits. It follows
dependencies, shares decisions, and adjusts the work as results or blockers come in.

Finished or idle workers free room for more work. Lowering a limit does not
terminate workers already running; the manager waits before starting more.
To change the project default for its Lanes, run:

```bash
clips config --lane-max-active-agents 3
```

The manager applies this limit when dispatching work. It is not an operating-system
process limit. See [worker-budget details](docs/cli-reference.md#lane-worker-budget)
for readback and overrides.

Validation is part of the handoff. A worker returns what changed and how it was
checked; agents depending on that work check that it provides what they agreed.
The combined result must also satisfy the Goal's criteria. Separate reports
of "my part works" are not enough.

The manager keeps going until the agreed outcome is implemented and checked, or
a real blocker needs your input. You do not need a separate continuation skill
or another "go" between tasks. Your scope, pauses, resource limits, and approval
requirements still apply.

### Build from one place

Agents can share the same working tree and branch, so you can follow the build
in one place. They agree on who changes shared parts, negotiate overlapping
edits, and sequence changes when simultaneous work would collide. Separate
branches are not a prerequisite for coordinating agents.

This relies on communication and coordinated edits, not automatic conflict
prevention. The agents reconcile implementation conflicts with one another and
bring genuine scope or product decisions back to you.

### Use it in your AI tool

| Where you work | How Lane Manager runs the work |
|---|---|
| **Paseo** | Uses native workspaces and top-level dev agents, keeping contact with them. |
| **GitHub Copilot App** | Uses direct, coordinated child sessions of the Lane Manager. You can open those sessions and message the workers while the manager stays in contact. |
| **Other AI tools with worker agents** | Uses the available built-in sub-agents, even when you cannot open or steer them separately. |
| **Tools with no worker-agent support** | The same assistant implements and checks the work one task at a time, in dependency order. |

No worker support does not mean no progress. It also does not bypass a denied
permission, unavailable project files, or your resource limits.

## Choose the right skill

| Skill | When to use it | What it does |
|---|---|---|
| **`lane-manager`** | You want a coordinated effort across goals or agents. | Plans the work, delegates development, connects the results, and keeps delivery moving. |
| **`clips-dev`** | You want one developer to own a change from idea to working result. | Works like an autonomous staff developer: plans, builds, and checks the requested outcome in its own session. It is not the Lane Manager. |
| **`clips`** | You need the shared work records behind either workflow. | Keeps goals, task requests, dependencies, completion criteria, results, and acceptance evidence together. |

Setup installs `clips`. Add the other skills through the
[skill installation instructions](docs/cli-reference.md#skill-library-exports).
Clips Dev can take a request directly or work on an assignment from Lane Manager.

## Use Clips for everyday work

### Think through a change before building it

The default is planning through delivery. Be explicit when you only want a plan:

> Use Lane Manager to compare ways to add team invitations. Record the recommended
> approach, tradeoffs, and what we'd need to build. Plan only; do not implement.

Planning, brainstorming, deferring work, and narrowing scope are valid requests.
The assistant should not treat them as permission to start coding.

### Pick up where you left off

In a later conversation, ask:

> Use Lane Manager to pick up the invitation work. Read its Clips records, check
> them against the current project, and continue the unfinished work.

Clips preserves the plan, decisions, progress, and results. The assistant still
needs to check the current files; an old completion note is not proof that a
later change still works.

### Plan and build in one session

For an outcome you want one developer to handle end to end:

> Use clips-dev to let people request a replacement for an expired invitation.
> Work through the edge cases, break down the change, implement it, and check
> that the replacement invitation lets them join the team.

Clips Dev does the technical planning and development in that same session. It
uses the same structured goals, tasks, and completion criteria without turning
the request into a team-management exercise. Like Lane Manager, it respects
plan-only requests, real blockers, and approval boundaries. Neither skill grants
permission to publish changes or make external updates without authorization.

### Understand what was actually finished

> Show me what changed, how it was checked, and anything that was skipped or
> still needs my review.

The useful result is an explanation backed by the actual work, not just a
"done" label. Clips records that evidence, but it does not run checks or grant
human approval by itself.

## Share on GitHub when you choose

Local planning does not require GitHub issues. If your team wants to follow the
work there, Clips can synchronize goals and tasks with GitHub after you opt in.

Ask your assistant to explain what will be created or updated and get your
approval before enabling or running synchronization. See
[GitHub collaboration setup](docs/cli-reference.md#optional-github-collaboration)
for the commands and how to stop syncing without deleting existing issues.

## Where your work lives

Plans and progress live in a local `.clips/` folder. They are not automatically
shared with GitHub and are excluded from source-code commits. The assistant
instructions installed in your project are separate files and can appear as
normal Git changes.

Because the work records are outside Git history, committing your code is not
a backup of those records. Linked worktrees of the same repository share them.

## Reference and development

- [Commands, configuration, and developer setup](docs/cli-reference.md)
- [Detailed work model and acceptance rules](docs/work-contracts.md)
- [A complete small-feature example](docs/work-contract-example.md)

## License

[MIT](LICENSE)
