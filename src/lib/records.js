import fs from 'node:fs';
import path from 'node:path';
import { getClipsRecordsDir, getRepoRoot } from './core.js';

export const RECORD_STATUSES = [
  'Draft',
  'Proposed',
  'In Review',
  'Accepted',
  'Deprecated',
  'Archived',
];

export function normalizeRecordStatus(status) {
  const normalized = String(status || '').trim().toLowerCase().replaceAll(/[-_]+/g, ' ');
  const canonical = RECORD_STATUSES.find((candidate) => candidate.toLowerCase() === normalized);
  if (!canonical) throw new Error(`Invalid record status '${status}'. Valid: ${RECORD_STATUSES.join(', ')}`);
  return canonical;
}

export function normalizeRecordId(recordId) {
  const normalized = String(recordId || '').trim().toUpperCase();
  if (!/^(CR|ADR)-\d+$/.test(normalized)) throw new Error('Record ID must use the format CR-NNN or ADR-NNN');
  return normalized;
}

function recordType(recordId) {
  return recordId.startsWith('CR-') ? 'cr' : 'adr';
}

function matchingRecordFiles(directory, recordId) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && entry.name.endsWith('.md')
      && (entry.name === `${recordId}.md` || entry.name.startsWith(`${recordId}-`)))
    .map((entry) => path.join(directory, entry.name));
}

export function findRecordFile(recordId, repoRoot = getRepoRoot()) {
  const normalizedId = normalizeRecordId(recordId);
  const type = recordType(normalizedId);
  const activeDir = getClipsRecordsDir(type, repoRoot);
  const archivedDir = path.join(activeDir, 'archived');
  const matches = [
    ...matchingRecordFiles(activeDir, normalizedId),
    ...matchingRecordFiles(archivedDir, normalizedId),
  ];
  if (matches.length === 0) throw new Error(`${normalizedId} not found`);
  if (matches.length > 1) throw new Error(`Multiple files found for ${normalizedId}`);
  return { recordId: normalizedId, type, activeDir, archivedDir, filePath: matches[0] };
}

export function updateRecordStatus(recordId, status, repoRoot = getRepoRoot()) {
  const canonicalStatus = normalizeRecordStatus(status);
  const record = findRecordFile(recordId, repoRoot);
  const content = fs.readFileSync(record.filePath, 'utf8');
  const headingMatch = content.match(/^# ((?:CR|ADR)-\d+):/m);
  if (!headingMatch || headingMatch[1] !== record.recordId) {
    throw new Error(`${record.recordId} heading does not match its filename`);
  }
  if (!/^\*\*Status:\*\*.*$/m.test(content)) throw new Error(`${record.recordId} has no Status field`);
  const updated = content.replace(/^\*\*Status:\*\*.*$/m, `**Status:** ${canonicalStatus}`);
  const destinationDir = canonicalStatus === 'Archived' ? record.archivedDir : record.activeDir;
  const destination = path.join(destinationDir, path.basename(record.filePath));

  fs.mkdirSync(destinationDir, { recursive: true });
  if (destination !== record.filePath && fs.existsSync(destination)) {
    throw new Error(`Cannot move ${record.recordId}: ${destination} already exists`);
  }
  if (destination === record.filePath) {
    fs.writeFileSync(destination, updated);
  } else {
    const temporary = path.join(destinationDir, `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`);
    try {
      fs.writeFileSync(temporary, updated);
      fs.renameSync(temporary, destination);
      try {
        fs.unlinkSync(record.filePath);
      } catch (error) {
        fs.unlinkSync(destination);
        throw error;
      }
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  return {
    record_id: record.recordId,
    record_type: record.type,
    status: canonicalStatus,
    path: path.relative(repoRoot, destination),
  };
}
