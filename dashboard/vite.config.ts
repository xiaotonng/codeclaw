import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('react-markdown') || id.includes('remark-gfm') || id.includes('micromark') || id.includes('mdast') || id.includes('unist')) {
            return 'markdown';
          }
          if (id.includes('react-router') || id.includes('@remix-run/router')) {
            return 'router';
          }
          if (id.includes('react') || id.includes('scheduler')) {
            return 'react-vendor';
          }
        },
      },
    },
  },
});
