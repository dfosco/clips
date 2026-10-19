import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { runLabelCommand } from '../commands/label.js';
import { readGoalWithTasks } from './core.js';
import { labelCatalog, readLabelConfig } from './labels.js';

const skill = fs.readFileSync(path.resolve('.agents/skills/lane-manager/SKILL.md'), 'utf8');
const rule = skill.split('## Hand completed Goals to human validation\n')[1]?.split('\n## ')[0] || '';

describe('Lane Manager review handoff contract', () => {
  it('limits readiness to completed verified implementation presented for human validation', () => {
    expect(rule).toContain("Goal's implementation is complete");
    expect(rule).toContain('implementation and verification are complete');
    expect(rule).toContain('human for validation');
    expect(rule).toContain('Unfinished or blocked Goals and Goals with current acceptance are not eligible');
    expect(rule).toContain('not acceptance');
    expect(rule).toContain('not a Goal\nlifecycle status');
    expect(rule).toContain('Use the **returned ID**');
    expect(rule).toContain('reuse the ID returned for that name');
  });

  it('executes the documented fresh-catalog commands without changing Goal status or accepting it', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-review-rule-'));
    const previous = process.cwd();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      execFileSync('git', ['init', '-q', root]);
      fs.mkdirSync(path.join(root, '.clips', 'db'), { recursive: true });
      fs.writeFileSync(path.join(root, '.clips', 'db', 'g001.jsonl'), JSON.stringify({
        event: 'goal_created', goal_id: 'g001', title: 'Review fixture', status: 'in_progress',
      }) + '\n');
      process.chdir(root);
      const create = rule.match(/^clips label create '(.+)'$/m);
      const assign = rule.match(/^clips label add '([^']+)' ([a-z0-9-]+)$/m);
      expect(create).toBeTruthy();
      expect(assign).toBeTruthy();
      runLabelCommand(['create', create[1]]);
      runLabelCommand(['add', assign[1], assign[2]]);
      const goal = readGoalWithTasks('g001');
      expect(goal.label_ids).toEqual(['ready-to-review']);
      expect(labelCatalog(readLabelConfig(root))[0]).toEqual({ id: 'ready-to-review', name: 'ready-to-review', color: '#8b5cf6' });
      expect(goal.status).toBe('in_progress');
      expect(goal.acceptance).toBeUndefined();
    } finally {
      log.mockRestore();
      process.chdir(previous);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
