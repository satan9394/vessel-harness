import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vessel Web dev server. In dev, /api is proxied to the local server so the
// browser talks to a single origin. Production `vite build` output is served
// statically by the local server (see apps/local-server).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:5678',
    },
  },
});