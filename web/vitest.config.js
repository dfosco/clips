import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [svelte(), svelteTesting()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.js', 'web/src/**/*.test.js'],
    setupFiles: ['./web/src/test-setup.js'],
  },
});
