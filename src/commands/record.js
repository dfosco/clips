import { RECORD_STATUSES, updateRecordStatus } from '../lib/records.js';

export function runRecordCommand(args) {
  const [command, ...rest] = args;
  if (command === 'status') {
    const result = updateRecordStatus(rest[0], rest.slice(1).join(' '));
    console.log(JSON.stringify({ success: true, ...result }));
    return;
  }

  console.log(`Usage: clips record <command> [args]

Commands:
  status <record_id> <status>  Update a CR or ADR status

Statuses:
  ${RECORD_STATUSES.join(' | ')}

Examples:
  clips record status CR-017 in_review
  clips record status ADR-003 accepted
  clips record status CR-017 archived
`);
}
