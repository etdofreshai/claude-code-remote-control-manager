import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite builds the SPA into ../public so Fastify (which serves
// server/public at /static/) can serve the bundled assets, and the
// emitted index.html replaces the hand-written one at the project root.
//
// `base: '/static/'` makes Vite emit asset references like
// /static/assets/main-abc123.js, which map back to server/public/assets/...
// through the existing static mount.
export default defineConfig({
  plugins: [react()],
  base: '/static/',
  build: {
    outDir: '../public',
    emptyOutDir: false,
    assetsDir: 'assets',
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
