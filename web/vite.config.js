import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readBoardData } from '../src/lib/board.js';

function boardApi() {
  return {
    name: 'clips-board-api',
    configureServer(server) {
      server.middlewares.use('/api/board', (request, response) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json; charset=utf-8');

        if (request.method !== 'GET') {
          response.statusCode = 405;
          response.setHeader('Allow', 'GET');
          response.end(JSON.stringify({ error: 'Read-only API supports GET only.' }));
          return;
        }

        try {
          response.statusCode = 200;
          response.end(JSON.stringify(readBoardData()));
        } catch (error) {
          response.statusCode = 500;
          response.end(JSON.stringify({ error: 'Could not read clips planning data.', detail: error.message }));
        }
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [svelte(), boardApi()],
  server: { host: '127.0.0.1', port: 4173 },
  build: { outDir: '../dist/web', emptyOutDir: true },
});
