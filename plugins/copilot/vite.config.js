import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./canvas/ui', import.meta.url)) } },
  plugins: [tailwindcss()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'canvas/dist', emptyOutDir: true, target: 'es2022', minify: true,
    lib: { entry: 'canvas/ui/main.jsx', name: 'ClipsCanvas', formats: ['iife'], fileName: () => 'app.js', cssFileName: 'style' },
    rollupOptions: { output: { codeSplitting: false } },
  },
});
