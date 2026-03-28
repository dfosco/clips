# clips

Local-first issue tracker that mirrors GitHub Issues. Goals and tasks are stored as append-only JSONL event logs in `.clips/db/`, synced bidirectionally with your repo's GitHub Issues. Every mutation pushes immediately — local and remote stay in sync.

## Installation

```bash
npm install -g github:dfosco/clips
```

### Update

```bash
npm install -g github:dfosco/clips
```

### Setup

```bash
# In any git repo with a GitHub remote
clips init
```

`clips init` creates `.clips/` and imports all existing GitHub Issues as goals.

## Commands

```bash
clips view                          # List all goals with tasks
clips view #g001                    # View a specific goal

clips goal create '{"title":"..."}'  # Create goal (+ GitHub Issue)
clips goal status g1 done            # Close goal (+ close issue)

clips task create-batch g001 '[{"title":"Task A"},{"title":"Task B"}]'
clips task status g1 t1 done         # Check off task (+ update issue)

clips sync                           # Bidirectional sync with GitHub
clips config                         # View configuration
```

## Data Model

- **Goals** = GitHub Issues, stored as `.clips/db/g001.jsonl`
- **Tasks** = Markdown checkboxes in the issue body (or sub-issues with `tasks_as_issues: true`)
- **Events** = Append-only JSONL lines (`goal_created`, `task_created`, `status_changed`, etc.)
- **Refs** = `#g001`, `#g001#t1`, `g1 t1` (flexible parsing)

## Releasing

```bash
npm run release              # patch (0.1.0 → 0.1.1)
npm run release:minor        # minor (0.1.0 → 0.2.0)
npm run release:major        # major (0.1.0 → 1.0.0)
```

This single command will:
1. Run tests
2. Update `package.json` and `src/version.js`
3. Create a git commit and tag (e.g. `v0.1.1`)
4. Push to GitHub
5. Create a GitHub Release with auto-generated notes

Requires the [GitHub CLI](https://cli.github.com/) (`gh`) to be installed and authenticated.

## License

MIT
