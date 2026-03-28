# clips

Local-first issue tracker that mirrors GitHub Issues. Goals and tasks are stored as append-only JSONL event logs in `.clips/db/`, synced bidirectionally with your repo's GitHub Issues. Every mutation pushes immediately — local and remote stay in sync.

## Getting Started

```bash
# In any git repo with a GitHub remote
node path/to/clips/src/cli.js init

# Or link globally
cd clips && npm link
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

## License

MIT
