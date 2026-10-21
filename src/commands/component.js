import { parseRef, formatRef } from '../lib/core.js';
import { readJsonInput } from '../lib/json-input.js';
import {
  changeComponentStatus, createComponent, listComponents, readComponent,
  readComponentHistory, updateComponent,
} from '../lib/components.js';

function componentRef(input, { mutable = false } = {}) {
  const ref = parseRef(input);
  if (!ref?.componentId || ref.goalId || ref.taskId || ref.criterionId) {
    throw new Error(`Invalid component reference: ${input}`);
  }
  if (mutable && ref.revision != null) {
    throw new Error('Historical component references are read-only; use expected_revision when updating the current record');
  }
  return ref;
}

function readRequired(ref) {
  const component = readComponent(ref.componentId, ref.username, { revision: ref.revision ?? undefined });
  if (!component) throw new Error(`Component ${formatRef(ref)} not found`);
  return component;
}

function namespaceArgs(args) {
  const index = args.indexOf('--namespace');
  if (index === -1) return { args };
  if (index === args.length - 1 || args[index + 1].startsWith('--')) throw new Error('--namespace requires a name');
  if (args.lastIndexOf('--namespace') !== index) throw new Error('--namespace may only be supplied once');
  const name = args[index + 1];
  return { args: [...args.slice(0, index), ...args.slice(index + 2)], username: name === 'none' ? null : name };
}

export function renderComponent(component, { ref } = {}) {
  const lines = [
    `${ref || component.ref} — ${component.title}`,
    `Status: ${component.status} | Revision: r${component.revision}`,
  ];
  for (const [label, field] of [['Responsibility', 'responsibility'], ['Contract', 'contract'], ['Decisions', 'decisions']]) {
    if (component[field]) lines.push('', label, component[field]);
  }
  for (const [label, field] of [['Dependencies', 'dependencies'], ['Source references', 'source_refs']]) {
    if (component[field]?.length) lines.push('', label, ...component[field].map((value) => `- ${value}`));
  }
  for (const [heading, markdown] of Object.entries(component.sections || {})) lines.push('', heading, markdown);
  if (Object.keys(component.extensions || {}).length) lines.push('', 'Extensions', JSON.stringify(component.extensions, null, 2));
  return lines.join('\n');
}

export function runComponentCommand([action, ...args]) {
  switch (action) {
    case 'create': {
      const options = namespaceArgs(args);
      const component = createComponent(readJsonInput(options.args), Object.hasOwn(options, 'username') ? { username: options.username } : {});
      console.log(JSON.stringify({ success: true, component_id: component.component_id, ref: component.ref, revision: component.revision }));
      return;
    }
    case 'update': {
      const ref = componentRef(args[0], { mutable: true });
      const component = updateComponent(ref.componentId, readJsonInput(args.slice(1)), { username: ref.username });
      console.log(JSON.stringify({ success: true, component_id: component.component_id, ref: component.ref, revision: component.revision }));
      return;
    }
    case 'status': {
      if (args.length !== 2) throw new Error('Usage: lanes component status <ref> <active|retired>');
      const ref = componentRef(args[0], { mutable: true });
      const component = changeComponentStatus(ref.componentId, args[1], { username: ref.username });
      console.log(JSON.stringify({ success: true, component_id: component.component_id, ref: component.ref, revision: component.revision, status: component.status }));
      return;
    }
    case 'show': {
      if (args.length !== 1) throw new Error('Usage: lanes component show <ref>');
      console.log(JSON.stringify(readRequired(componentRef(args[0])), null, 2));
      return;
    }
    case 'history': {
      if (args.length !== 1) throw new Error('Usage: lanes component history <ref>');
      const ref = componentRef(args[0]);
      readRequired(ref);
      console.log(JSON.stringify(readComponentHistory(ref.componentId, ref.username, { revision: ref.revision ?? undefined }), null, 2));
      return;
    }
    case 'list': {
      const options = namespaceArgs(args);
      if (options.args.length) throw new Error('Usage: lanes component list [--namespace name]');
      console.log(JSON.stringify(listComponents(Object.hasOwn(options, 'username') ? { username: options.username } : {}), null, 2));
      return;
    }
    default:
      console.log(`Usage: lanes component <command> [args]

Commands:
  create <json> [--namespace name]  Create a system component
  update <ref> <json>              Amend its current boundary and references
  status <ref> <active|retired>     Retire or reactivate the same identity
  show <ref>                       Show current or #rN historical JSON
  history <ref>                    Show the revision journal
  list [--namespace name]          List components across namespaces

JSON input may also be supplied with --file <path> or --stdin.
Components default to repository-wide storage regardless of the configured username.
Unqualified #cN references always address those shared records.
Use --namespace name and #name#cN for explicitly namespaced components.
Use --namespace none to create or list root-level component records.

Fields:
  title                           Required on creation
  responsibility, contract        Markdown responsibility and behavior
  dependencies                    Component references; may include #rN
  source_refs                     Paths, schema links, or other source refs
  decisions                       Relevant decision rationale or references
  sections                        Named Markdown sections (null deletes)
  extensions                      Custom JSON, merged recursively (null deletes)
  expected_revision               Reject updates based on an outdated revision

Describe responsibility and contract before other work relies on a component.
Dependencies express system structure; tasks carry execution dependencies.
`);
  }
}
