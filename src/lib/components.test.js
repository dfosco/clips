import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendComponentEvent, changeComponentStatus, createComponent, getComponentFilePath,
  listComponents, readComponent, readComponentHistory, updateComponent,
} from './components.js';

const directories = [];
function store() {
  const componentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clips-components-'));
  directories.push(componentsDir);
  return { componentsDir, username: null };
}

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('system component journals', () => {
  it('preserves identity and recoverable boundary snapshots across renames and retirement', () => {
    const options = store();
    const created = createComponent({
      title: 'Workspace preferences',
      responsibility: 'Remember user choices within one workspace.',
      contract: 'Missing values use the product defaults.',
      source_refs: ['src/preferences.js'],
    }, options);
    expect(created).toMatchObject({ component_id: 'c001', ref: '#c001', revision: 1, status: 'active' });
    const changed = updateComponent('c1', {
      title: 'Workspace settings',
      contract: 'Missing or invalid values use the product defaults.',
      source_refs: ['src/settings/store.js'],
      expected_revision: 1,
    }, options);
    expect(changed).toMatchObject({ component_id: 'c001', revision: 2, title: 'Workspace settings' });
    expect(readComponent('c1', null, { ...options, revision: 1 })).toMatchObject({
      title: 'Workspace preferences', contract: 'Missing values use the product defaults.', source_refs: ['src/preferences.js'], revision: 1,
    });
    expect(changeComponentStatus('c1', 'retired', options)).toMatchObject({ revision: 3, status: 'retired' });
    expect(changeComponentStatus('c1', 'active', options)).toMatchObject({ component_id: 'c001', revision: 4, status: 'active' });
    expect(readComponentHistory('c1', null, options).map((event) => event.revision)).toEqual([1, 2, 3, 4]);
    expect(readComponentHistory('c1', null, { ...options, revision: 2 }).map((event) => event.revision)).toEqual([1, 2]);
    expect(() => readComponentHistory('c1', null, { ...options, revision: 5 })).toThrow('has no revision #r5');
    expect(() => readComponent('c1', null, { ...options, revision: 5 })).toThrow('has no revision #r5');
    expect(() => readComponent('c1', null, { ...options, revision: 0 })).toThrow('positive integer');
    expect(createComponent({ title: 'Another boundary' }, options).component_id).toBe('c002');
  });

  it('keeps custom sections and nested extension data through partial amendments', () => {
    const options = store();
    createComponent({
      title: 'Preferences',
      sections: { Constraints: 'Values remain workspace-local.', Recovery: 'Use defaults.' },
      extensions: { interfaces: { read: 'read(key)', write: 'write(key,value)' }, tags: ['local'], team: 'editor' },
    }, options);
    const changed = updateComponent('c1', {
      sections: { Recovery: null, Compatibility: 'Existing keys remain valid.' },
      extensions: { interfaces: { write: null, subscribe: 'subscribe(listener)' }, tags: ['shared'], owner: 'agent-1' },
    }, options);
    expect(changed.sections).toEqual({ Constraints: 'Values remain workspace-local.', Compatibility: 'Existing keys remain valid.' });
    expect(changed.extensions).toEqual({
      interfaces: { read: 'read(key)', subscribe: 'subscribe(listener)' },
      tags: ['shared'], team: 'editor', owner: 'agent-1',
    });
    expect(readComponent('c1', null, { ...options, revision: 1 }).extensions.interfaces.write).toBe('write(key,value)');
    expect(() => updateComponent('c1', { contract: { hidden: 'wrong shape' } }, options)).toThrow('contract must be a string');
    expect(() => updateComponent('c1', { custom: 'put under extensions' }, options)).toThrow('Use sections for Markdown or extensions');
    expect(readComponent('c1', null, options).revision).toBe(2);
  });

  it('rejects stale writes and held locks without appending or losing prior changes', () => {
    const options = store();
    createComponent({ title: 'Preferences', contract: 'Original behavior' }, options);
    updateComponent('c1', { contract: 'Amended behavior', expected_revision: 1 }, options);
    const file = getComponentFilePath('c1', null, options);
    const before = fs.readFileSync(file, 'utf8');
    expect(() => updateComponent('c1', { title: 'Stale rename', expected_revision: 1 }, options)).toThrow('Revision conflict');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    fs.writeFileSync(`${file}.lock`, 'another writer');
    expect(() => updateComponent('c1', { title: 'Blocked rename' }, options)).toThrow('Record is being written');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    fs.unlinkSync(`${file}.lock`);
    expect(updateComponent('c1', { title: 'Current rename', expected_revision: 2 }, options)).toMatchObject({
      title: 'Current rename', contract: 'Amended behavior', revision: 3,
    });
    expect(fs.existsSync(`${file}.lock`)).toBe(false);
  });

  it('keeps structural dependencies independent of work scheduling and permits cycles', () => {
    const options = store();
    createComponent({ title: 'Editor', dependencies: ['#c2', '#remote#c4#r2'] }, options);
    createComponent({ title: 'Workspace', dependencies: ['c1'] }, options);
    expect(readComponent('c1', null, options).dependencies).toEqual(['#c002', '#remote#c004#r2']);
    expect(readComponent('c2', null, options).dependencies).toEqual(['#c001']);
    expect(readComponent('c1', null, options).status).toBe('active');
    expect(() => updateComponent('c1', { dependencies: ['#g1#t1'] }, options)).toThrow('Invalid component dependency');
    expect(() => updateComponent('c1', { dependencies: ['c2', '#c002'] }, options)).toThrow('Duplicate component dependency');
  });

  it('isolates same-number identities across namespaces and allocates within each namespace', () => {
    const options = store();
    createComponent({ title: 'Root boundary' }, options);
    createComponent({ title: 'Alice boundary' }, { ...options, username: 'Alice' });
    createComponent({ title: 'Bob boundary' }, { ...options, username: 'bob' });
    updateComponent('c1', { contract: 'Alice contract' }, { ...options, username: 'alice' });
    expect(readComponent('c1', 'bob', options)).toMatchObject({ title: 'Bob boundary', revision: 1, ref: '#bob#c001' });
    expect(readComponent('c1', 'alice', options)).toMatchObject({ contract: 'Alice contract', revision: 2, ref: '#alice#c001' });
    expect(listComponents(options).map((component) => component.ref)).toEqual(['#c001']);
    expect(listComponents({ componentsDir: options.componentsDir }).map((component) => component.ref)).toEqual(['#c001', '#alice#c001', '#bob#c001']);
    expect(createComponent({ title: 'Alice next' }, { ...options, username: 'alice' })).toMatchObject({ component_id: 'c002', ref: '#alice#c002' });
    expect(() => createComponent({ title: 'Bad path' }, { ...options, username: '../outside' })).toThrow('Invalid component namespace');
  });

  it('retains unknown persisted data while validating journal writes and lineage', () => {
    const options = store();
    appendComponentEvent('c1', {
      event: 'component_created', title: 'Imported boundary', future_field: { contract_source: 'schema.json' },
    }, { ...options, expectedRevision: 0 });
    updateComponent('c1', { title: 'Renamed import' }, options);
    expect(readComponent('c1', null, options).future_field).toEqual({ contract_source: 'schema.json' });
    const file = getComponentFilePath('c1', null, options);
    const before = fs.readFileSync(file, 'utf8');
    expect(() => appendComponentEvent('c1', { event: 'component_created', title: 'Overwrite' }, options)).toThrow('already exists');
    expect(() => appendComponentEvent('c1', { event: 'component_updated', extensions: { nested: undefined } }, options)).toThrow('undefined values');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(() => appendComponentEvent('c2', { event: 'component_updated', title: 'No creation' }, options)).toThrow('not found');
  });
});
