import fs from 'node:fs';
import { appendTrackEvent, listTracks, readTrack, trackPath } from './tracks.js';
import { readJsonEvents } from './journal.js';

export function normalizeLaneId(ref) {
  const match = String(ref || '').match(/^#?(?:l|r)(\d+)$/i);
  if (!match) throw new Error(`Invalid lane ref: ${ref}`);
  return `l${match[1].padStart(3, '0')}`;
}

export function laneToTrackId(ref) {
  const laneId = normalizeLaneId(ref);
  return `r${laneId.slice(1)}`;
}

export function trackToLaneId(ref) {
  const match = String(ref || '').match(/^#?r(\d+)$/i);
  if (!match) throw new Error(`Invalid legacy track ref: ${ref}`);
  return `l${match[1].padStart(3, '0')}`;
}

function toLane(track) {
  if (!track) return null;
  const { track_id: trackId, acceptance_criteria: legacyCriteria, ...rest } = track;
  return {
    ...rest,
    lane_id: trackToLaneId(trackId),
    legacy_track_id: trackId,
    ...(legacyCriteria?.length ? { legacy_acceptance_criteria: legacyCriteria } : {}),
  };
}

export function readLane(ref, dbDir, options = {}) {
  return toLane(readTrack(laneToTrackId(ref), dbDir, options));
}

export function listLanes(dbDir) {
  return listTracks(dbDir).map(toLane);
}

export function appendLaneEvent(ref, event, dbDir, options) {
  const laneId = normalizeLaneId(ref);
  appendTrackEvent(laneToTrackId(laneId), { ...event, lane_id: laneId }, dbDir, options);
}

export function nextLaneId(dbDir) {
  const numbers = listTracks(dbDir).map((track) => Number(track.track_id.slice(1)));
  return `l${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`;
}

export function validateLane(ref) {
  if (ref == null) return null;
  const laneId = normalizeLaneId(ref);
  if (!readLane(laneId)) throw new Error(`Lane ${laneId} not found`);
  return laneId;
}

export function readLaneHistory(ref, dbDir, { revision } = {}) {
  const laneId = normalizeLaneId(ref);
  const file = trackPath(laneToTrackId(laneId), dbDir);
  if (!fs.existsSync(file)) return null;
  const events = readJsonEvents(file);
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1 || revision > events.length)) {
    throw new Error(`Revision r${revision} not found for #${laneId}`);
  }
  return events.slice(0, revision).map((event, index) => ({
    ...event,
    lane_id: laneId,
    revision: index + 1,
  }));
}
