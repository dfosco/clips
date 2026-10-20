import { defineConfig } from 'vite';
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'canvas/dist', emptyOutDir: true, target: 'es2022', minify: true,
    lib: { entry: 'canvas/ui/main.jsx', name: 'ClipsCanvas', formats: ['iife'], fileName: () => 'app.js', cssFileName: 'style' },
    rollupOptions: { output: { codeSplitting: false } },
  },
});
