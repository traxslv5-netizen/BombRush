import 'dotenv/config';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { BombRushRoom } from './rooms/BombRushRoom';
import { roomRegistry } from './rooms/RoomRegistry';
import { database } from './persistence/SupabaseStore';
database();
const server = new Server({
  transport: new WebSocketTransport({ maxPayload: 16384 }),
  greet: false,
  express: (app) => {
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Cache-Control', 'no-store');
      next();
    });
    app.get('/health', (_req, res) => res.json({ ok: true, service: 'bombrush' }));
    app.get('/rooms/:code', (req, res) => {
      const code = String(req.params.code).toUpperCase();
      if (!/^BR-[A-Z0-9]{6}$/.test(code)) {
        res.status(400).json({ code: 'INVALID_CODE' });
        return;
      }
      const entry = roomRegistry.get(code);
      if (!entry) {
        res.status(404).json({ code: 'ROOM_NOT_FOUND' });
        return;
      }
      if (entry.game.state.phase !== 'LOBBY') {
        res.status(409).json({ code: 'MATCH_STARTED' });
        return;
      }
      if (entry.game.state.players.length >= 4) {
        res.status(409).json({ code: 'ROOM_FULL' });
        return;
      }
      res.json({ roomId: entry.roomId });
    });
  },
});
server.define('bombrush', BombRushRoom);
const port = Number(process.env.COLYSEUS_PORT ?? process.env.PORT ?? 2567);
await server.listen(port, '0.0.0.0');
console.log(`BombRush authority listening on :${port}`);
