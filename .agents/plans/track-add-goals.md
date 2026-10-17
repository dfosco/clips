# Add existing goals to a track

Support `clips track <track> add <goal...>` with shorthand references. Validate the track and every goal before writing, deduplicate repeated refs, skip goals already assigned, and move goals from another track. Append local goal updates and use the existing best-effort GitHub goal sync. Document the command in CLI help, the reference, and the workflow skill. Verify shorthand IDs, atomic validation, idempotency, movement, and board state.
