import { afterAll, beforeAll, it, expect } from 'vitest';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Client, type Room } from '@colyseus/sdk';
import { BombRushRoom } from '../apps/server/src/rooms/BombRushRoom';
import type { Snapshot } from '../shared/src/types';
import { roomRegistry } from '../apps/server/src/rooms/RoomRegistry';
import { breakBlock } from '../apps/server/src/systems/BlockSystem';
import { updateObjectives } from '../apps/server/src/systems/ObjectiveSystem';
const port = 26579;
let server: Server;
const rooms: Room[] = [];
beforeAll(async () => {
  server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    gracefullyShutdown: false,
  });
  server.define('bombrush', BombRushRoom);
  await server.listen(port, '127.0.0.1');
});
it('resolves simultaneous color claims, limits to four players, and accepts start only from the ready host', async () => {
  const endpoint = `ws://127.0.0.1:${port}`,
    client = new Client(endpoint);
  const a = await client.create('bombrush', { nickname: 'Host' });
  rooms.push(a);
  a.onMessage('snapshot', () => {});
  const b = await client.joinById(a.roomId, { nickname: 'Guest' });
  rooms.push(b);
  b.onMessage('snapshot', () => {});
  const failures: string[] = [];
  a.onMessage('room_error', (m: { code: string }) => failures.push(m.code));
  b.onMessage('room_error', (m: { code: string }) => failures.push(m.code));
  a.send('color', 'yellow');
  b.send('color', 'yellow');
  const chosen = await waitFor(a, (s) =>
    s.players.some((p) => p.color === 'yellow'),
  );
  expect(chosen.players.filter((p) => p.color === 'yellow')).toHaveLength(1);
  await waitFor(a, (s) => s.players.length === 2 && failures.length === 1);
  expect(failures).toEqual(['COLOR_UNAVAILABLE']);
  for (const nickname of ['Three', 'Four']) {
    const room = await client.joinById(a.roomId, { nickname });
    rooms.push(room);
    room.onMessage('snapshot', () => {});
  }
  await expect(
    client.joinById(a.roomId, { nickname: 'Fifth' }),
  ).rejects.toThrow();
  const four = await waitFor(a, (s) => s.players.length === 4);
  expect(new Set(four.players.map((p) => p.color)).size).toBe(4);
  const group = rooms.filter((r) => r.roomId === a.roomId);
  group.forEach((r) => r.send('ready'));
  await waitFor(a, (s) => s.players.every((p) => p.ready));
  b.send('start');
  expect((await waitFor(a, (s) => s.players.every((p) => p.ready))).phase).toBe(
    'LOBBY',
  );
  a.send('start');
  await waitFor(a, (s) => s.phase === 'PLAYING');
  a.send('pause', true);
  expect((await waitFor(a, (s) => s.phase === 'PLAYING')).paused).toBe(false);
  await Promise.all(group.map((r) => r.leave()));
  for (const r of group) rooms.splice(rooms.indexOf(r), 1);
});
afterAll(async () => {
  await Promise.all(
    rooms.filter((r) => r.connection.isOpen).map((r) => r.leave()),
  );
  await server.gracefullyShutdown(false);
});
it('Colyseus authority waits for both map acknowledgements and advances each socket exactly once', async () => {
  const client = new Client(`ws://127.0.0.1:${port}`);
  const a = await client.create('bombrush', {
    nickname: 'Authority',
    synchronizedStages: true,
  });
  rooms.push(a);
  const b = await client.joinById(a.roomId, { nickname: 'Peer' });
  rooms.push(b);
  const stageRevisions = [new Set<number>(), new Set<number>()];
  [a, b].forEach((room, i) =>
    room.onMessage('snapshot', (s: Snapshot) => {
      if (s.phase === 'SYNCING') {
        stageRevisions[i].add(s.stageRevision);
        room.send('stage-ready', s.stageRevision);
      }
    }),
  );
  a.send('ready');
  b.send('ready');
  const lobby = await waitFor(a, (s) => s.players.every((p) => p.ready));
  a.send('start');
  await Promise.all(
    [a, b].map((room) => waitFor(room, (s) => s.phase === 'PLAYING')),
  );
  const game = roomRegistry.get(lobby.code)!.game;
  for (const point of game.state.objective.points) point.done = true;
  for (const enemy of game.state.enemies) enemy.alive = false;
  for (const p of game.state.players) {
    p.x = game.state.exit.x;
    p.y = game.state.exit.y;
    p.invulnerability = game.state.time + 20;
  }
  const [sa, sb] = await Promise.all(
    [a, b].map((room) =>
      waitFor(room, (s) => s.stage === 1 && s.phase === 'PLAYING'),
    ),
  );
  expect(sa.stageRevision).toBe(2);
  expect(sb.stageRevision).toBe(2);
  expect(sa.grid).toEqual(sb.grid);
  expect(stageRevisions.map((revs) => [...revs])).toEqual([
    [1, 2],
    [1, 2],
  ]);
  await a.leave();
  await b.leave();
  rooms.splice(rooms.indexOf(a), 1);
  rooms.splice(rooms.indexOf(b), 1);
});
function waitFor(
  room: Room,
  predicate: (s: Snapshot) => boolean,
): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error('Snapshot condition timed out'));
    }, 8000);
    const off = room.onMessage('snapshot', (s: Snapshot) => {
      if (predicate(s)) {
        clearTimeout(timer);
        off();
        resolve(s);
      }
    });
  });
}
it('two clients join, receive distinct colors, sync movement and a bomb, reject forged input, and survive host departure', async () => {
  const a = await new Client(`ws://127.0.0.1:${port}`).create('bombrush', {
    nickname: 'Alice',
  });
  rooms.push(a);
  const b = await new Client(`ws://127.0.0.1:${port}`).joinById(a.roomId, {
    nickname: 'Bob',
  });
  rooms.push(b);
  const joined = await waitFor(b, (s) => s.players.length === 2);
  expect(new Set(joined.players.map((p) => p.color)).size).toBe(2);
  expect(joined.code).toMatch(/^BR-[A-Z0-9]{6}$/);
  expect(joined.code).not.toBe(a.roomId);
  const conflict = new Promise<string>((resolve) => {
    const off = b.onMessage('room_error', (m: { code: string }) => {
      off();
      resolve(m.code);
    });
  });
  b.send('color', 'red');
  expect(await conflict).toBe('COLOR_UNAVAILABLE');
  b.send('ready');
  await waitFor(a, (s) =>
    s.players.some((p) => p.id === b.sessionId && p.ready),
  );
  a.send('start');
  const denied = await waitFor(
    a,
    (s) => s.players.find((p) => p.id === b.sessionId)!.ready,
  );
  expect(denied.phase).toBe('LOBBY');
  a.send('ready');
  await waitFor(a, (s) => s.players.every((p) => p.ready));
  a.send('start');
  await waitFor(a, (s) => s.phase === 'PLAYING');
  a.send('input', { dx: 0, dy: 0, bomb: true, remote: false, seq: 1 });
  const mirrored = await waitFor(b, (s) =>
    s.bombs.some((bomb) => bomb.owner === a.sessionId),
  );
  expect(mirrored.bombs[0].x).toBe(1);
  expect(mirrored.bombs[0].y).toBe(1);
  a.send('input', { dx: 1, dy: 0, bomb: false, remote: false, seq: 2 });
  const moved = await waitFor(
    b,
    (s) => s.players.find((p) => p.id === a.sessionId)!.x > 1.2,
  );
  expect(moved.players.find((p) => p.id === a.sessionId)!.x).toBeLessThan(2.5);
  a.send('input', { dx: 9999, dy: 0, bomb: true, remote: false, seq: 3 });
  const validated = await waitFor(b, (s) => s.time > moved.time + 0.5);
  expect(validated.players.find((p) => p.id === a.sessionId)!.x).toBeLessThan(
    3,
  );
  expect(validated.bombs.filter((b) => b.owner === a.sessionId)).toHaveLength(
    1,
  );
  const blastA = waitFor(a, (s) => s.blasts.length > 0),
    blastB = waitFor(b, (s) => s.blasts.length > 0);
  const [sa, sb] = await Promise.all([blastA, blastB]);
  expect(sa.blasts.map((f) => [f.x, f.y])).toEqual(
    sb.blasts.map((f) => [f.x, f.y]),
  );
  expect(sa.enemies).toEqual(sb.enemies);
  expect(sa.exit).toEqual(sb.exit);
  a.reconnection.minUptime = 0;
  a.reconnection.minDelay = 300;
  a.reconnection.maxDelay = 300;
  const dropped = waitFor(b, (s) =>
    s.players.some((p) => p.id === a.sessionId && !p.connected),
  );
  const reconnect = new Promise<void>((resolve) => a.onReconnect.once(resolve));
  a.connection.close(4010, 'integration network drop');
  await dropped;
  await reconnect;
  const restored = await waitFor(a, (s) => s.players.every((p) => p.connected));
  expect(restored.players).toHaveLength(2);
  // Exercise server objective mutation and verify both actual sockets receive it.
  const game = roomRegistry.get(joined.code)!.game,
    point = game.state.objective.points[0];
  breakBlock(game, point.x, point.y);
  const p = game.state.players.find((p) => p.id === a.sessionId)!;
  p.x = point.x;
  p.y = point.y;
  p.alive = true;
  p.invulnerability = game.state.time + 20;
  updateObjectives(game, 0.1);
  const [oa, ob] = await Promise.all([
    waitFor(a, (s) => s.objective.current === 1),
    waitFor(b, (s) => s.objective.current === 1),
  ]);
  expect(oa.objective).toEqual(ob.objective);
  await a.leave();
  rooms.splice(rooms.indexOf(a), 1);
  const survived = await waitFor(b, (s) => s.players.length === 1);
  expect(survived.host).toBe(b.sessionId);
  expect(survived.bombs.filter((b) => b.owner === a.sessionId)).toHaveLength(0);
});
