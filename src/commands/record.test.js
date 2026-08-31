import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateRecordStatus } from '../lib/records.js';

const cliPath = path.resolve(process.cwd(), 'src', 'cli.js');
const tempDirs = [];

function createWorkspace() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-record-'));
  tempDirs.push(cwd);
  execFileSync('git', ['init', '--quiet'], { cwd });
  fs.mkdirSync(path.join(cwd, '.clips', 'records', 'cr', 'archived'), { recursive: true });
  fs.mkdirSync(path.join(cwd, '.clips', 'records', 'adr', 'archived'), { recursive: true });
  return cwd;
}

function runClips(cwd, args) {
  return execFileSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
}

afterEach(() => {
  for (const cwd of tempDirs.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

describe('record status', () => {
  it('updates the shared lifecycle for CRs and ADRs', () => {
    const cwd = createWorkspace();
    const crPath = path.join(cwd, '.clips', 'records', 'cr', 'CR-001-change.md');
    const adrPath = path.join(cwd, '.clips', 'records', 'adr', 'ADR-001-decision.md');
    fs.writeFileSync(crPath, '# CR-001: Change\n\n**Status:** Draft\n');
    fs.writeFileSync(adrPath, '# ADR-001: Decision\n\n**Status:** Proposed\n');

    for (const [input, expected] of [
      ['proposed', 'Proposed'],
      ['in_review', 'In Review'],
      ['accepted', 'Accepted'],
      ['deprecated', 'Deprecated'],
      ['draft', 'Draft'],
    ]) {
      const result = JSON.parse(runClips(cwd, ['record', 'status', 'cr-001', input]));
      expect(result).toMatchObject({ success: true, record_id: 'CR-001', record_type: 'cr', status: expected });
      expect(fs.readFileSync(crPath, 'utf8')).toContain(`**Status:** ${expected}`);
    }

    expect(JSON.parse(runClips(cwd, ['record', 'status', 'ADR-001', 'in-review']))).toMatchObject({
      record_id: 'ADR-001',
      record_type: 'adr',
      status: 'In Review',
    });
    expect(fs.readFileSync(adrPath, 'utf8')).toContain('**Status:** In Review');

    const archivedAdrPath = path.join(cwd, '.clips', 'records', 'adr', 'archived', 'ADR-001-decision.md');
    expect(JSON.parse(runClips(cwd, ['record', 'status', 'ADR-001', 'archived']))).toMatchObject({
      record_type: 'adr',
      status: 'Archived',
      path: '.clips/records/adr/archived/ADR-001-decision.md',
    });
    expect(fs.existsSync(adrPath)).toBe(false);
    expect(fs.readFileSync(archivedAdrPath, 'utf8')).toContain('**Status:** Archived');
    runClips(cwd, ['record', 'status', 'ADR-001', 'proposed']);
    expect(fs.existsSync(archivedAdrPath)).toBe(false);
    expect(fs.readFileSync(adrPath, 'utf8')).toContain('**Status:** Proposed');
  });

  it('moves archived records into and out of the per-type archive folder', () => {
    const cwd = createWorkspace();
    const activePath = path.join(cwd, '.clips', 'records', 'cr', 'CR-002-archive.md');
    const archivedPath = path.join(cwd, '.clips', 'records', 'cr', 'archived', 'CR-002-archive.md');
    fs.writeFileSync(activePath, '# CR-002: Archive\n\n**Status:** Accepted\n');

    const archived = JSON.parse(runClips(cwd, ['record', 'status', 'CR-002', 'archived']));
    expect(archived).toMatchObject({ status: 'Archived', path: '.clips/records/cr/archived/CR-002-archive.md' });
    expect(fs.existsSync(activePath)).toBe(false);
    expect(fs.readFileSync(archivedPath, 'utf8')).toContain('**Status:** Archived');

    const restored = JSON.parse(runClips(cwd, ['record', 'status', 'CR-002', 'accepted']));
    expect(restored).toMatchObject({ status: 'Accepted', path: '.clips/records/cr/CR-002-archive.md' });
    expect(fs.existsSync(archivedPath)).toBe(false);
    expect(fs.readFileSync(activePath, 'utf8')).toContain('**Status:** Accepted');
  });

  it('rejects unknown statuses and records without a status field', () => {
    const cwd = createWorkspace();
    const recordPath = path.join(cwd, '.clips', 'records', 'adr', 'ADR-003-invalid.md');
    fs.writeFileSync(recordPath, '# ADR-003: Invalid\n');

    const invalidStatus = spawnSync(process.execPath, [cliPath, 'record', 'status', 'ADR-003', 'merged'], { cwd, encoding: 'utf8' });
    expect(invalidStatus.status).toBe(1);
    expect(invalidStatus.stderr).toContain("Invalid record status 'merged'");

    const missingField = spawnSync(process.execPath, [cliPath, 'record', 'status', 'ADR-003', 'accepted'], { cwd, encoding: 'utf8' });
    expect(missingField.status).toBe(1);
    expect(missingField.stderr).toContain('ADR-003 has no Status field');
  });

  it('validates record headings and leaves the source in place when destination writing fails', () => {
    const cwd = createWorkspace();
    const mismatchedPath = path.join(cwd, '.clips', 'records', 'cr', 'CR-004-mismatch.md');
    fs.writeFileSync(mismatchedPath, '# CR-005: Mismatch\n\n**Status:** Draft\n');
    expect(() => updateRecordStatus('CR-004', 'accepted', cwd)).toThrow('CR-004 heading does not match its filename');

    const activePath = path.join(cwd, '.clips', 'records', 'adr', 'ADR-004-write-failure.md');
    const archivedPath = path.join(cwd, '.clips', 'records', 'adr', 'archived', 'ADR-004-write-failure.md');
    fs.writeFileSync(activePath, '# ADR-004: Write failure\n\n**Status:** Accepted\n');
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    expect(() => updateRecordStatus('ADR-004', 'archived', cwd)).toThrow('disk full');
    write.mockRestore();
    expect(fs.existsSync(activePath)).toBe(true);
    expect(fs.existsSync(archivedPath)).toBe(false);
    expect(fs.readFileSync(activePath, 'utf8')).toContain('**Status:** Accepted');
  });
});
