import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Point at the sim package source for instant HMR — no need to
      // rebuild sim between edits during development.
      '@subterfuge/sim': path.resolve(__dirname, '../sim/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.SERVER_URL ?? 'http://localhost:3030',
        changeOrigin: true,
      },
      '/ws': {
        target: (process.env.SERVER_URL ?? 'http://localhost:3030').replace(
          'http',
          'ws',
        ),
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
