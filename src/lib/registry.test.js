import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { effectiveProjectId, ensureProjectIdentity, readProjectRegistry, registerProject, validateProjectId } from './registry.js';
import { setConfigValue } from './config.js';

const tempDirs = [];
const originalClipsHome = process.env.CLIPS_HOME;

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeProject(parent, name) {
  const repoRoot = path.join(parent, name);
  fs.mkdirSync(path.join(repoRoot, '.clips'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, '.clips', 'clips.config.json'), '{}\n');
  return repoRoot;
}

afterEach(() => {
  if (originalClipsHome === undefined) delete process.env.CLIPS_HOME;
  else process.env.CLIPS_HOME = originalClipsHome;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('project registry', () => {
  it('registers canonical projects idempotently and prunes stale paths', () => {
    process.env.CLIPS_HOME = tempDir('clips-home-');
    const parent = tempDir('clips-projects-');
    const project = makeProject(parent, 'My App');
    registerProject(project);
    registerProject(project);

    expect(readProjectRegistry().projects).toEqual([{ id: 'my-app', label: 'My App', path: fs.realpathSync(project) }]);
    fs.rmSync(project, { recursive: true, force: true });
    const result = readProjectRegistry();
    expect(result.projects).toEqual([]);
    expect(result.warnings[0].kind).toBe('stale_project');
  });

  it('assigns a stable suffix when repository names collide', () => {
    process.env.CLIPS_HOME = tempDir('clips-home-');
    const firstParent = tempDir('clips-first-');
    const secondParent = tempDir('clips-second-');
    const first = makeProject(firstParent, 'app');
    const second = makeProject(secondParent, 'app');

    expect(ensureProjectIdentity(first)).toBe('app');
    registerProject(first);
    expect(ensureProjectIdentity(second)).toBe('app-2');
    registerProject(second);
    expect(effectiveProjectId(second)).toBe('app-2');
  });

  it('validates explicit project identifiers', () => {
    expect(validateProjectId('api_docs-2')).toBe('api_docs-2');
    expect(() => validateProjectId('API docs')).toThrow('Invalid project_id');
  });

  it('rejects an explicit project identifier already used by another project', () => {
    process.env.CLIPS_HOME = tempDir('clips-home-');
    const parent = tempDir('clips-projects-');
    const first = makeProject(parent, 'first');
    const second = makeProject(parent, 'second');
    registerProject(first);
    registerProject(second);

    setConfigValue('project_id', 'shared', first);
    expect(() => setConfigValue('project_id', 'shared', second)).toThrow("project_id 'shared' is already used");
  });
});
