import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    // The editor chunk (TipTap/ProseMirror) is intentionally large but isolated.
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split heavy vendors into cacheable chunks instead of one ~1.4MB file:
        // the editor stack (TipTap/ProseMirror/lowlight) is by far the largest.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/@tiptap|prosemirror|tiptap-markdown|lowlight|highlight\.js/.test(id)) return 'editor';
          if (/[\\/](react|react-dom|scheduler)[\\/]|@tanstack/.test(id)) return 'react';
          return 'vendor';
        },
      },
    },
  },
});
