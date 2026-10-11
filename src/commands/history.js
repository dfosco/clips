import { formatRef, parseRef, readGoalHistory } from '../lib/core.js';
import { readComponentHistory } from '../lib/components.js';

export function runHistoryCommand(args) {
  const json = args.includes('--json');
  const refs = args.filter((arg) => arg !== '--json');
  if (refs.length !== 1 || refs[0] === '--help') {
    console.log('Usage: clips history <goal|task|component ref> [--json]\nA #rN suffix limits the journal to that snapshot. Use a full goal/task ref.');
    if (refs[0] !== '--help') process.exitCode = 1;
    return;
  }
  const ref = parseRef(refs[0]);
  if (!ref || ref.criterionId || (!ref.goalId && !ref.componentId)) throw new Error('Use a full goal, task, or component reference');
  let events;
  if (ref.componentId) {
    events = readComponentHistory(ref.componentId, ref.username, { revision: ref.revision });
  } else {
    events = readGoalHistory(ref.goalId, ref.username, { taskId: ref.taskId, revision: ref.revision });
  }
  if (!events?.length) throw new Error(`Record ${formatRef(ref)} not found`);
  if (json) console.log(JSON.stringify(events, null, 2));
  else for (const event of events) {
    console.log(`${formatRef({ ...ref, revision: event.revision })}  ${event.timestamp || ''}  ${event.event}${event.task_id && !ref.taskId ? ` ${event.task_id}` : ''}`);
  }
}
