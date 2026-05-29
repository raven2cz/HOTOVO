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
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
