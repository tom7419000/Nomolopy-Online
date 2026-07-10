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

const app = express();
app.get('/healthz', (_req, res) => res.json({ ok: true }));

if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res
      .status(200)
      .send('Nomolopy-Server läuft. Client-Build fehlt – im Dev-Modus bitte http://localhost:5173 öffnen.')
  );
}

const server = http.createServer(app);
const io = new Server(server, {
  // Editionen können Bilder als Data-URLs enthalten
  maxHttpBufferSize: 8_000_000,
  cors: { origin: true },
});

registerHandlers(io);

server.listen(PORT, () => {
  console.log(`🎲 Nomolopy-Server läuft auf http://localhost:${PORT}`);
});
