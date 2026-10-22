import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = fs.readFileSync(path.resolve('.agents/skills/lane-manager/SKILL.md'), 'utf8');
const rule = skill.split('## Hand completed Goals to human validation\n')[1]?.split('\n## ')[0] || '';
const normalizedRule = rule.replace(/\s+/g, ' ');

describe('Lane Manager human review handoff contract', () => {
  it('limits readiness to completed verified implementation presented for human validation', () => {
    expect(normalizedRule).toContain("Goal's implementation is complete");
    expect(normalizedRule).toContain('implementation and verification are complete');
    expect(normalizedRule).toContain('human for validation');
    expect(normalizedRule).toContain('Unfinished or blocked Goals and Goals with current acceptance are not eligible');
    expect(normalizedRule).toContain('not acceptance');
    expect(normalizedRule).toContain('does not change a Goal lifecycle status');
    expect(normalizedRule).toContain('Attaching a CR alone does not request review');
    expect(normalizedRule).toContain('manager separately submits a');
    expect(normalizedRule).toContain('approved exact candidate');
    expect(normalizedRule).toContain('`changes_requested`');
    expect(normalizedRule).toContain('`deferred`');
    expect(normalizedRule).toContain('pending human review does not prevent retiring idle developers');
  });
});
