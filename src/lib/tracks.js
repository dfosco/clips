import fs from 'node:fs';
import path from 'node:path';
import { getClipsDbDir, readGoalWithTasks } from './core.js';

export function normalizeTrackId(ref) {
  const match = String(ref || '').match(/^#?r(\d+)$/i);
  if (!match) throw new Error(`Invalid track ref: ${ref}`);
  return `r${match[1].padStart(3, '0')}`;
}

export function trackPath(id, dbDir = getClipsDbDir()) {
  return path.join(dbDir, 'tracks', `${normalizeTrackId(id)}.jsonl`);
}

export function readTrack(id, dbDir = getClipsDbDir()) {
  const file = trackPath(id, dbDir);
  if (!fs.existsSync(file)) return null;
  const track = { track_id: normalizeTrackId(id) };
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.event === 'track_created' || event.event === 'track_updated') {
      for (const key of ['title', 'description', 'acceptance_criteria']) {
        if (Object.hasOwn(event, key)) track[key] = event[key];
      }
    }
    if (event.event === 'track_created' || event.event === 'track_status_changed') track.status = event.status;
    if (event.event === 'track_github_synced') {
      track.issue_number = event.issue_number;
      track.issue_id = event.issue_id;
      track.issue_url = event.issue_url;
    }
  }
  return track;
}

export function listTracks(dbDir = getClipsDbDir()) {
  const dir = path.join(dbDir, 'tracks');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => /^r\d+\.jsonl$/.test(name))
    .map((name) => readTrack(name.slice(0, -6), dbDir));
}

export function appendTrackEvent(id, event, dbDir = getClipsDbDir()) {
  const file = trackPath(id, dbDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ ...event, track_id: normalizeTrackId(id), timestamp: new Date().toISOString() })}\n`);
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
