import { recordHandoff } from '../lib/handoffs.js';
import { readJsonInput } from '../lib/json-input.js';

export function runHandoffCommand(args) {
  const [action, ref, ...input] = args;
  if (action === 'record') {
    if (!ref || !input.length) throw new Error('Usage: lanes handoff record <goal-or-task-ref> <JSON|--file path|--stdin>');
    console.log(JSON.stringify(recordHandoff(ref, readJsonInput(input))));
    return;
  }
  if (args.length && !['--help', '-h'].includes(action)) throw new Error(`Unknown handoff command: ${action}`);
  console.log(`Usage: lanes handoff record <goal-or-task-ref> <JSON|--file path|--stdin>

Preserve developer context as immutable Markdown attached to the corresponding
Goal. A Task reference maps to its parent Goal, preserving its namespace.

JSON fields:
  context       Latest developer context (required string)
  agent_id      Observed developer identity (required)
  manager_id    Observed receiving manager identity (required)
  reason        completed (default), resource_warning, resource_critical, reassignment
  incomplete    Whether context is incomplete (default false)
  handoff_id    Optional UUID; reuse it for an exact retry

Only resource_critical with incomplete=true permits empty context, which becomes
an explicit emergency note. A handoff preserves context; it does not prove
delivery to its manager, close a native session, accept work, or change status.
Changed content needs a new handoff_id. Existing files are never overwritten.
This command is local-only and does not publish or enable collaboration.`);
}
