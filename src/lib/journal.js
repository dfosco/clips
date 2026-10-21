// Shared append-only journal primitives. Locks cover one local file operation;
// they are not leases, task ownership, or a distributed scheduling protocol.
import fs from 'node:fs';
import path from 'node:path';

export function readJsonEvents(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split('\n').flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Expected an event object');
      return [event];
    } catch (error) {
      throw new Error(`Invalid journal ${filePath}, line ${index + 1}: ${error.message}`);
    }
  });
}

function assertNoMigration(filePath) {
  let directory = path.dirname(path.resolve(filePath));
  while (true) {
    const migrationLock = path.join(directory, '.lanes-migration.lock');
    if (fs.existsSync(migrationLock)) throw new Error(`Lanes migration is in progress: ${migrationLock}`);
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

export function withRecordLock(filePath, operation) {
  assertNoMigration(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  let descriptor;
  try {
    descriptor = fs.openSync(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Record is being written: ${filePath}. Retry after the writer finishes. If it crashed, confirm no writer is active before removing ${lockPath}.`);
    }
    throw error;
  }
  try {
    assertNoMigration(filePath);
    fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() }) + '\n');
    return operation();
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lockPath);
  }
}

export function appendJsonEvent(filePath, event) {
  // JSON.stringify otherwise silently drops undefined properties. Refuse data
  // loss rather than producing a record different from the caller's request.
  const json = JSON.stringify(event, (key, value) => {
    if (value === undefined) throw new Error(`Cannot append event with undefined values${key ? `: ${key}` : ''}`);
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Cannot append non-finite JSON values');
    return value;
  });
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let prefix = '';
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (content && !content.endsWith('\n')) prefix = '\n';
  }
  fs.appendFileSync(filePath, `${prefix}${json}\n`);
}

export function assertExpectedRevision(expected, actual, ref) {
  if (expected === undefined) return;
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('expected_revision must be a non-negative integer');
  if (expected !== actual) throw new Error(`Revision conflict for ${ref}: expected r${expected}, current r${actual}. Read the record again before retrying.`);
}
