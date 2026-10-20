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
      // `changeOrigin: false` keeps the browser's Host, so the local server's
      // same-origin gate (`trustedOrigin`) sees the dev origin as the request
      // origin. Vite's proxy defaults to `changeOrigin: true`, which rewrites
      // Host to 127.0.0.1:5678 and makes every Origin-bearing request (all
      // POST/PUT/PATCH/DELETE) fail with 403 origin_denied.
      '/api': { target: 'http://127.0.0.1:5678', changeOrigin: false },
    },
  },
});