import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
export const task = { ref: '#alice#g001#t01', title: 'Exact needle task', description: 'Task description', status: 'open', labels: [{ id: 'urgent', name: 'Urgent' }] };
export const goal = { ref: '#alice#g001', title: 'Goal one', status: 'open', description: 'Goal description', plan: 'Concrete plan', decisions: 'Concrete decision', acceptance_criteria: [{ id: 'A1', description: 'Observable result' }], tasks: [task], labels: [] };
export const lane = { ref: '#l001', title: 'Lane one', status: 'open', goal_refs: [goal.ref, '#alice#g002'], manager_claim: { owners: [] } };
export const state = () => ({ projectPath: '/A', selectedProject: { id: 'A', name: 'Alpha' }, lanes: [structuredClone(lane)], goals: [structuredClone(goal), { ...structuredClone(goal), ref: '#alice#g002', title: 'Closed Goal', status: 'closed', tasks: [] }], labels: [{ id: 'urgent', name: 'Urgent' }], projectSessions: [{ id: 'joined', joined: true, steerable: true, status: 'idle' }], hostCapabilities: { canSendToCurrentSession: true, currentSessionId: 'joined' }, focus: null });
export async function mount(t, initial = state(), intercept, { colorMode, prefersDark = false, loadStyles = false, viewportWidth = 1024, projectLayout, waitForReady = true } = {}) {
  let server = structuredClone(initial); const calls = []; const errors = [];
  const vc = new VirtualConsole(); vc.on('jsdomError', (e) => errors.push(e));
  vc.on('error', (error) => errors.push(error instanceof Error ? error : new Error(String(error))));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1/canvas/index.html?instanceId=ui&token=test', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  if (viewportWidth !== undefined) Object.defineProperty(window, 'innerWidth', { configurable: true, value: viewportWidth });
  if (colorMode) window.document.documentElement.setAttribute('data-color-mode', colorMode);
  const mediaListeners = new Set();
  const mediaQueries = [];
  const matches = (query) => {
    if (viewportWidth !== undefined && query.includes('width')) {
      const min = query.match(/min-width:\s*(\d*\.?\d+)px/);
      const max = query.match(/max-width:\s*(?:calc\((\d*\.?\d+)px\s*-\s*(\d*\.?\d+)px\)|(\d*\.?\d+)px)/);
      assert.ok(min || max, `Unsupported width media query: ${query}`);
      const upper = max ? (max[3] ? Number(max[3]) : Number(max[1]) - Number(max[2])) : Infinity;
      return (!min || viewportWidth >= Number(min[1])) && viewportWidth <= upper;
    }
    return query.includes('prefers-color-scheme: dark') && prefersDark;
  };
  window.matchMedia = (query) => {
    mediaQueries.push(query);
    return {
      matches: matches(query),
      media: query,
      addEventListener: (_event, listener) => mediaListeners.add(listener),
      removeEventListener: (_event, listener) => mediaListeners.delete(listener),
      addListener: (listener) => mediaListeners.add(listener),
      removeListener: (listener) => mediaListeners.delete(listener),
    };
  };
  const resizeObservers = new Set();
  window.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.targets = new Set(); resizeObservers.add(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); resizeObservers.delete(this); }
  };
  const resizeProjects = () => {
    for (const observer of resizeObservers) {
      const entries = [...observer.targets].filter(target => target.isConnected).map(target => ({ target, contentRect: target.getBoundingClientRect() }));
      if (entries.length) observer.callback(entries, observer);
    }
  };
  let layout = projectLayout && structuredClone(projectLayout);
  const projectMeasurements = [];
  if (layout) {
    const originalRect = window.Element.prototype.getBoundingClientRect;
    window.Element.prototype.getBoundingClientRect = function () {
      let width;
      if (this.hasAttribute('data-project-strip')) width = layout.available;
      else if (this.hasAttribute('data-project-measure')) width = layout.widths[this.dataset.projectMeasure];
      else if (this.hasAttribute('data-project-measure-more')) width = this.dataset.projectMeasureMore === 'selected' ? layout.selectedMore : layout.more;
      else if (this.hasAttribute('data-project-measure-plus')) width = layout.plus;
      else return originalRect.call(this);
      assert.ok(Number.isFinite(width) && width >= 0, `Missing measured width fixture for ${this.outerHTML}`);
      projectMeasurements.push({ attributes: { ...this.dataset }, text: this.textContent, width });
      return new window.DOMRect(0, 0, width, 28);
    };
  }
  const fonts = new window.EventTarget();
  let resolveFonts;
  fonts.ready = new Promise(resolve => { resolveFonts = resolve; });
  Object.defineProperty(window.document, 'fonts', { configurable: true, value: fonts });
  window.Element.prototype.scrollIntoView = function () {};
  window.document.adoptedStyleSheets = [];
  Object.defineProperty(window.ShadowRoot.prototype, 'adoptedStyleSheets', { configurable: true, get() { return this._adoptedStyleSheets || []; }, set(value) { this._adoptedStyleSheets = value; } });
  window.CSSStyleSheet.prototype.replaceSync = function (css) { this.cssText = css; };
  if (loadStyles) {
    const style = window.document.createElement('style');
    style.textContent = await readFile(new URL('./dist/style.css', import.meta.url), 'utf8');
    window.document.head.append(style);
  }
  window.fetch = async (_url, request) => {
    const { action, input } = JSON.parse(request.body); calls.push({ action, input });
    const captured = structuredClone(server);
    const custom = await intercept?.({ action, input, captured, setServer: (value) => { server = value; } });
    if (custom) return { ok: !custom.error, json: async () => custom.error ? { error: custom.error } : { result: custom.result } };
    if (action === 'list_projects') return { ok: true, json: async () => ({ result: { projects: [{ id: 'A', name: 'Alpha', projectRoot: '/A' }, { id: 'B', name: 'Beta', projectRoot: '/B' }], userScope: 'local', diagnostics: [] } }) };
    if (action === 'set_project') { server = { ...server, projectPath: input.projectId === 'B' ? '/B' : '/A', selectedProject: { id: input.projectId, name: input.projectId === 'B' ? 'Beta' : 'Alpha' }, lanes: [{ ...lane, title: input.projectId === 'B' ? 'Lane Beta' : 'Lane one' }], focus: null }; }
    if (action === 'focus' || action === 'clear_focus') server.focus = input.ref || null;
    return { ok: true, json: async () => ({ result: structuredClone(server) }) };
  };
  t.after(() => window.close());
  window.eval(await readFile(new URL('./dist/app.js', import.meta.url), 'utf8'));
  const query = (s) => window.document.querySelector(s);
  const wait = async (predicate) => { for (let i = 0; i < 100; i++) { if (predicate()) return; if (errors.length) throw errors[0]; await new Promise((r) => setTimeout(r, 5)); } assert.ok(predicate(), 'DOM condition timed out'); };
  const click = async (selector) => { assert.ok(query(selector), selector); query(selector).click(); await new Promise((r) => setTimeout(r, 15)); if (errors.length) throw errors[0]; };
  const input = async (selector, value) => { const el = query(selector); assert.ok(el, selector); Object.getOwnPropertyDescriptor(window[el.tagName === 'TEXTAREA' ? 'HTMLTextAreaElement' : el.tagName === 'SELECT' ? 'HTMLSelectElement' : 'HTMLInputElement'].prototype, 'value').set.call(el, value); el.dispatchEvent(new window.Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); await new Promise((r) => setTimeout(r, 10)); };
  if (waitForReady) await wait(() => {
    const recoveryTitle = query('.clips-app-recovery .clips-app-empty-title');
    return query('.clips-board') || (recoveryTitle && !recoveryTitle.textContent.startsWith('Loading')) || query('[role="dialog"]');
  });
  return {
    dom, window, query, click, input, wait, calls, errors, mediaQueries, projectMeasurements,
    setProjectLayout: next => { assert.ok(layout, 'mount requires projectLayout'); layout = { ...layout, ...next, widths: { ...layout.widths, ...next.widths } }; },
    resizeProjects, resolveFonts: () => resolveFonts(), fontsLoaded: () => fonts.dispatchEvent(new window.Event('loadingdone')),
    setSystemDark: (next) => { prefersDark = next; for (const listener of mediaListeners) listener(); },
    getServer: () => server, setServer: (next) => { server = structuredClone(next); },
  };
}
