import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, proxy /api to the Express server on :8080.
// In prod, Express serves the built files from client/dist, so no proxy needed.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
  },
});
