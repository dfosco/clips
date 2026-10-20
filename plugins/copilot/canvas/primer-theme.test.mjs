import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mount } from './test-harness.mjs';
import { canvasSourceFiles } from '../src/canvas-build.js';

test('production Primer provider follows explicit host mode and reacts to host changes', async (t) => {
  const f = await mount(t, undefined, undefined, { colorMode: 'light', prefersDark: true });
  const provider = () => f.query('[data-portal-root]').parentElement;
  assert.equal(provider().getAttribute('data-color-mode'), 'light');
  assert.equal(provider().getAttribute('data-light-theme'), 'light');
  assert.equal(provider().getAttribute('data-dark-theme'), 'dark');
  f.window.document.documentElement.setAttribute('data-color-mode', 'dark');
  await f.wait(() => provider().getAttribute('data-color-mode') === 'dark');
  f.window.document.documentElement.removeAttribute('data-color-mode');
  f.window.document.body.setAttribute('data-color-mode', 'light');
  await f.wait(() => provider().getAttribute('data-color-mode') === 'light');
});

test('production Primer provider uses reactive OS fallback without an explicit host mode', async (t) => {
  const f = await mount(t, undefined, undefined, { prefersDark: true });
  const provider = () => f.query('[data-portal-root]').parentElement;
  assert.equal(provider().getAttribute('data-color-mode'), 'dark');
  f.setSystemDark(false);
  await f.wait(() => provider().getAttribute('data-color-mode') === 'light');
});

test('shipped stylesheet includes official Primer light/dark tokens and primitive typography/spacing', async () => {
  const css = await readFile(new URL('./dist/style.css', import.meta.url), 'utf8');
  for (const token of ['--bgColor-default', '--fgColor-default', '--borderColor-default', '--base-size-8', '--fontStack-system']) assert.ok(css.includes(token), token);
  assert.match(css, /data-light-theme[^\n]*light/);
  assert.match(css, /data-dark-theme[^\n]*dark/);
});

test('maintained source, emitted assets and dependency/build configuration contain no Tailwind or shadcn footprint', async () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  for (const name of ['tailwindcss', '@tailwindcss/vite', 'tw-animate-css', 'tailwind-merge', 'radix-ui', 'class-variance-authority']) {
    assert.equal(pkg.dependencies?.[name], undefined, name);
    assert.equal(pkg.devDependencies?.[name], undefined, name);
  }
  const sources = canvasSourceFiles(root.pathname);
  assert.equal(sources.includes('components.json'), false);
  assert.equal(sources.some((file) => file.startsWith('canvas/ui/components/ui/') || file === 'canvas/ui/lib/utils.js'), false);
  for (const file of [...sources, 'canvas/dist/app.js', 'canvas/dist/style.css']) {
    const text = await readFile(new URL(file, root), 'utf8');
    assert.doesNotMatch(text, /tailwindcss|@tailwind|--tw-|tw-animate-css|tailwind-merge|class-variance-authority|shadcn|radix-ui/i, file);
  }
});
