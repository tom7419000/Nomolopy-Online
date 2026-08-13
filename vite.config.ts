import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Kennung dieses Builds. Sie landet in der Service-Worker-URL (?v=…), damit
 * der Browser nach jedem Deployment einen neuen Worker erkennt und alte
 * Caches verwirft – ohne von Hand hochgezählte Versionsnummer.
 */
const buildId = Date.now().toString(36);

export default defineConfig({
  root: path.join(root, 'client'),
  // Relative Asset-Pfade: Der Build funktioniert unter jedem Unterpfad
  // (z. B. hinter einem Reverse-Proxy auf https://example.de/playhub/).
  base: './',
  plugins: [react()],
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  resolve: {
    alias: {
      '@shared': path.join(root, 'shared'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
  build: {
    outDir: path.join(root, 'client/dist'),
    emptyOutDir: true,
  },
});
