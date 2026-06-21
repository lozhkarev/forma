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
        // Isolate only the heavy editor stack (TipTap/ProseMirror/lowlight) into
        // its own chunk. Everything else — including React — stays in the entry
        // chunk; splitting React out risked breaking hook init order in prod.
        manualChunks(id) {
          if (
            id.includes('node_modules') &&
            /@tiptap|prosemirror|tiptap-markdown|lowlight|highlight\.js/.test(id)
          ) {
            return 'editor';
          }
          return undefined;
        },
      },
    },
  },
});
