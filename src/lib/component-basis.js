import { parseRef } from './core.js';
import { readComponent } from './components.js';

// Keep the original request references intact while making the acceptance basis
// recoverable. An unpinned reference is resolved now; a negotiated baseline that
// must remain fixed should already be pinned in the task request before work.
export function resolveComponentBasis(record) {
  const refs = record.components || [];
  if (!Array.isArray(refs)) throw new Error('Cannot accept work: components must be an array of references');
  const basis = refs.map((value) => {
    const parsed = parseRef(value);
    if (!parsed?.componentId || parsed.goalId || parsed.taskId || parsed.criterionId) {
      throw new Error(`Cannot accept work: '${value}' is not a component reference. Use '#c1' or '#c1#r1', or correct the work scope first`);
    }
    let component;
    try {
      component = readComponent(parsed.componentId, parsed.username, { revision: parsed.revision });
    } catch (error) {
      throw new Error(`Cannot accept work against ${value}: ${error.message}. Read its component history and correct the declared reference`);
    }
    if (!component) {
      throw new Error(`Cannot accept work: component ${value} was not found. Create its component record or correct the work scope before accepting`);
    }
    return `${component.ref}#r${component.revision}`;
  });
  return [...new Set(basis)];
}
