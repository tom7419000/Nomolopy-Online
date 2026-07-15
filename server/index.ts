import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { registerHandlers } from './rooms';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT_DIST = path.join(ROOT, 'client/dist');
const PORT = Number(process.env.PORT || 3001);

/**
 * Optionaler Unterpfad, unter dem die App läuft (z. B. BASE_PATH=/monopoly
 * hinter einem Reverse-Proxy, der den Präfix NICHT entfernt).
 * Leer lassen, wenn die App an der Wurzel läuft oder der Proxy den Präfix
 * entfernt – der Client passt sich dank relativer Pfade automatisch an.
 */
const rawBase = (process.env.BASE_PATH ?? '').trim().replace(/^\/+|\/+$/g, '');
const BASE_PATH = rawBase ? `/${rawBase}` : '';

const app = express();
app.get('/healthz', (_req, res) => res.json({ ok: true }));
if (BASE_PATH) {
  app.get(`${BASE_PATH}/healthz`, (_req, res) => res.json({ ok: true }));
  // Ohne abschließenden Slash würden die relativen Asset-Pfade brechen.
  // (Express-Routen matchen auch mit Trailing-Slash, daher exakter Vergleich.)
  app.use((req, res, next) => {
    if (req.path === BASE_PATH) return res.redirect(301, `${BASE_PATH}/`);
    next();
  });
}

if (fs.existsSync(CLIENT_DIST)) {
  app.use(BASE_PATH || '/', express.static(CLIENT_DIST));
  app.get(BASE_PATH ? `${BASE_PATH}/*` : '*', (_req, res) =>
    res.sendFile(path.join(CLIENT_DIST, 'index.html'))
  );
} else {
  app.get('/', (_req, res) =>
    res
      .status(200)
      .send('PlayHub-Server läuft. Client-Build fehlt – im Dev-Modus bitte http://localhost:5173 öffnen.')
  );
}

const server = http.createServer(app);
const io = new Server(server, {
  path: `${BASE_PATH}/socket.io/`,
  // Editionen können Bilder als Data-URLs enthalten
  maxHttpBufferSize: 8_000_000,
  cors: { origin: true },
});

registerHandlers(io);

server.listen(PORT, () => {
  console.log(`🎮 PlayHub-Server läuft auf http://localhost:${PORT}${BASE_PATH}/`);
});
