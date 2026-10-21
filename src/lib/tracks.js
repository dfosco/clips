import fs from 'node:fs';
import path from 'node:path';
import { getClipsDbDir, readGoalWithTasks } from './core.js';
import { appendJsonEvent, assertExpectedRevision, withRecordLock } from './journal.js';
import { attachmentsForRecord, replayAttachmentEvent } from './attachments.js';

export function normalizeTrackId(ref) {
  const match = String(ref || '').match(/^#?r(\d+)$/i);
  if (!match) throw new Error(`Invalid track ref: ${ref}`);
  return `r${match[1].padStart(3, '0')}`;
}

export function trackPath(id, dbDir = getClipsDbDir()) {
  return path.join(dbDir, 'tracks', `${normalizeTrackId(id)}.jsonl`);
}

export function readTrack(id, dbDir = getClipsDbDir(), { revision } = {}) {
  const file = trackPath(id, dbDir);
  if (!fs.existsSync(file)) return null;
  const events = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1 || revision > events.length)) {
    throw new Error(`Revision r${revision} not found for #${normalizeTrackId(id)}`);
  }
  const track = { track_id: normalizeTrackId(id), revision: 0 };
  for (const [index, event] of events.slice(0, revision ?? events.length).entries()) {
    if (['track_created', 'track_updated', 'lane_created', 'lane_updated'].includes(event.event)) {
      for (const key of ['title', 'description', 'acceptance_criteria', 'product_goals', 'sections', 'extensions', 'label_ids']) {
        if (Object.hasOwn(event, key)) track[key] = event[key];
      }
      if (event.event.startsWith('lane_')) track.record_kind = 'lane';
    }
    if (['track_created', 'track_status_changed', 'lane_created', 'lane_status_changed', 'lane_closed'].includes(event.event)) {
      track.status = event.status;
    }
    if (event.event === 'lane_closed') {
      track.record_kind = 'lane';
      track.closure = event.closure;
    }
    if (event.event === 'lane_closure_updated') {
      track.record_kind = 'lane';
      track.closure = { ...track.closure, ...event.closure };
    }
    if (event.event === 'track_github_synced' || event.event === 'lane_github_synced') {
      track.issue_number = event.issue_number;
      track.issue_id = event.issue_id;
      track.issue_url = event.issue_url;
      delete track.github_create_pending;
      if (Object.hasOwn(event, 'repository')) track.repository = event.repository;
      if (Object.hasOwn(event, 'remote_host')) track.remote_host = event.remote_host;
      if (event.event === 'lane_github_synced') track.record_kind = 'lane';
    }
    if (event.event === 'track_github_create_pending' || event.event === 'lane_github_create_pending') {
      track.github_create_pending = { marker: event.marker, created_at: event.timestamp };
      if (event.event === 'lane_github_create_pending') track.record_kind = 'lane';
    }
    if (event.event === 'track_github_create_cancelled' || event.event === 'lane_github_create_cancelled') {
      delete track.github_create_pending;
    }
    if (event.event === 'attachment_added' || event.event === 'attachment_removed') {
      track.attachments = replayAttachmentEvent(track.attachments, event);
    }
    track.revision = index + 1;
  }
  const attachments = attachmentsForRecord(track);
  if (attachments.length || Object.hasOwn(track, 'attachments')) track.attachments = attachments;
  return track;
}

export function listTracks(dbDir = getClipsDbDir()) {
  const dir = path.join(dbDir, 'tracks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^r\d+\.jsonl$/.test(name))
    .map((name) => readTrack(name.slice(0, -6), dbDir));
}

export function appendTrackEvent(id, event, dbDir = getClipsDbDir(), { expectedRevision } = {}) {
  const file = trackPath(id, dbDir);
  return withRecordLock(file, () => {
    const current = readTrack(id, dbDir);
    assertExpectedRevision(expectedRevision, current?.revision || 0, `#${normalizeTrackId(id)}`);
    return appendJsonEvent(file, { ...event, track_id: normalizeTrackId(id), timestamp: new Date().toISOString() });
  });
}

export function nextTrackId(dbDir = getClipsDbDir()) {
  const numbers = listTracks(dbDir).map((track) => Number(track.track_id.slice(1)));
  return `r${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`;
}

export function validateTrack(id) {
  if (id == null) return null;
  const normalized = normalizeTrackId(id);
  if (!readTrack(normalized)) throw new Error(`Track ${normalized} not found`);
  return normalized;
}

export function normalizeBlockedBy(refs, goalId) {
  if (!Array.isArray(refs)) throw new Error('blocked_by must be an array of goal refs');
  const ids = refs.map((ref) => {
    const match = String(ref).match(/^#?g(\d+)$/i);
    if (!match) throw new Error(`Invalid goal dependency: ${ref}`);
    return `g${match[1].padStart(3, '0')}`;
  });
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate goal dependency');
  for (const id of ids) {
    if (id === goalId) throw new Error('A goal cannot block itself');
    if (!readGoalWithTasks(id)) throw new Error(`Blocking goal ${id} not found`);
    const seen = new Set();
    const visit = (current) => {
      if (current === goalId) throw new Error('Goal dependency cycle');
      if (seen.has(current)) return;
      seen.add(current);
      for (const upstream of readGoalWithTasks(current)?.blocked_by || []) visit(upstream);
    };
    visit(id);
  }
  return ids;
}
