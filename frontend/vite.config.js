import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend target for the dev proxy. Honour PORT so it matches a custom backend.
const backendPort = process.env.PORT || '3000';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        // Keep the original Host (localhost:5173) so it matches the browser's
        // Origin - the backend's same-origin loopback check then accepts dev
        // UI mutations without requiring a manually-stored token.
        changeOrigin: false,
        secure: false,
      },
    },
  },
});
