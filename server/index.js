// HTTP + Socket.IO entry point for 28 Online.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager, CLIENT_EVENTS } from './rooms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/**
 * Build (but don't start) the server. `roomOptions` are passed to RoomManager
 * (botDelay, trickPause, nextHandDelay, takeoverDelay, emptyRoomTtl, ...).
 */
export function createAppServer({ roomOptions = {} } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const rooms = new RoomManager(roomOptions);

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, rooms: rooms.rooms.size, uptime: Math.round(process.uptime()) });
  });
  app.use(express.static(PUBLIC_DIR));

  const server = http.createServer(app);
  const io = new Server(server, { maxHttpBufferSize: 16 * 1024 });

  io.on('connection', (socket) => {
    for (const event of CLIENT_EVENTS) {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') { ack = payload; payload = {}; }
        const res = rooms.handle(socket, event, payload);
        // Most handlers answer synchronously; some (e.g. game:hint) return a promise.
        Promise.resolve(res)
          .catch(() => ({ ok: false, error: 'Internal server error' }))
          .then((r) => { if (typeof ack === 'function') ack(r); });
      });
    }
    socket.on('disconnect', () => rooms.disconnect(socket));
  });

  const close = () =>
    new Promise((resolve) => {
      rooms.close();
      io.close(() => resolve());
    });

  return { app, server, io, rooms, close };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 2828;
  const { server, close, rooms } = createAppServer();
  server.listen(port, () => {
    console.log(`28 Online running at http://localhost:${port}`);
    console.log(rooms.llm ? `Claude bots: ON (model ${process.env.ANTHROPIC_MODEL || "claude-haiku-5-5"})` : "Claude bots: off (set ANTHROPIC_API_KEY to enable)");
  });
  const shutdown = () => close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
