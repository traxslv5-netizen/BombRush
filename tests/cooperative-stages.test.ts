import { it, expect } from 'vitest';
import { Game } from '../apps/server/src/state/Game';
import { Tile } from '../shared/src/config/game.config';
import { KeyboardState } from '../apps/client/src/systems/KeyboardState';

it.each([2, 3, 4])(
  'advances %i players together once, waits for acknowledgements and preserves identity/upgrades',
  (count) => {
    const g = new Game(() => 0.2);
    g.synchronizeStages = true;
    for (let n = 0; n < count; n++) g.addPlayer(`p${n}`, `Jogador ${n}`);
    const identity = g.state.players.map((p) => [p.id, p.nickname, p.color]);
    g.state.players[0].maxBombs = 3;
    g.loadStage(0);
    for (let stage = 0; stage < 5; stage++) {
      const s = g.state,
        rev = s.stageRevision;
      expect(s.phase).toBe('SYNCING');
      expect(s.stage).toBe(stage);
      expect(s.bombs).toHaveLength(0);
      expect(s.projectiles).toHaveLength(0);
      expect(new Set(s.players.map((p) => `${p.x},${p.y}`)).size).toBe(count);
      for (const p of s.players) {
        expect([Tile.Floor, Tile.Ice, Tile.Bridge]).toContain(s.grid[p.y][p.x]);
        expect(s.enemies.some((e) => e.x === p.x && e.y === p.y)).toBe(false);
        expect(s.hazards.some((h) => h.x === p.x && h.y === p.y)).toBe(false);
      }
      g.acknowledgeStage('p0', rev - 1);
      expect(s.pendingStagePlayers).toHaveLength(count);
      g.acknowledgeStage('p0', rev);
      g.acknowledgeStage('p0', rev);
      expect(s.pendingStagePlayers).toHaveLength(count - 1);
      const time = s.remaining;
      g.tick(0.1);
      expect(s.remaining).toBe(time);
      for (let n = 1; n < count; n++) g.acknowledgeStage(`p${n}`, rev);
      expect(s.phase).toBe('PLAYING');
      expect(s.players.map((p) => [p.id, p.nickname, p.color])).toEqual(
        identity,
      );
      expect(s.players[0].maxBombs).toBe(3);
      if (stage === 4) break;
      s.objective.complete = true;
      for (const point of s.objective.points) {
        point.done = true;
        point.hidden = false;
        point.hp = 0;
        point.progress = 1;
      }
      for (const e of s.enemies) e.alive = false;
      for (const p of s.players) {
        p.x = s.exit.x;
        p.y = s.exit.y;
      }
      g.tick(1 / 30);
      expect(s.phase).toBe('STAGE_CLEAR');
      // Duplicate completion ticks cannot advance a second stage.
      g.tick(1 / 30);
      for (let n = 0; n < 77; n++) g.tick(1 / 30);
      expect(s.stage).toBe(stage + 1);
      expect(s.stageRevision).toBe(rev + 1);
    }
  },
);

it('releases missing clients from the loading barrier after a bounded timeout', () => {
  const g = new Game();
  g.synchronizeStages = true;
  g.addPlayer('host', 'Host');
  g.addPlayer('guest', 'Guest');
  g.loadStage(0);
  g.acknowledgeStage('host', g.state.stageRevision);
  for (let i = 0; i < 152; i++) g.tick(0.1);
  expect(g.state.phase).toBe('PLAYING');
  expect(g.state.players[1].connected).toBe(false);
  expect(g.state.pendingStagePlayers).toHaveLength(0);
});

it('restart clears old actions and gives the same map a new revision', () => {
  const g = new Game();
  const p = g.addPlayer('one', 'One');
  g.loadStage(0);
  g.inputs.set(p.id, { dx: 1, dy: 0, bomb: true, remote: false, seq: 1 });
  g.bombCooldown.set(p.id, 999);
  g.remoteCooldown.set(p.id, 999);
  const rev = g.state.stageRevision;
  g.restart();
  expect(g.state.stageRevision).toBe(rev + 1);
  expect(g.inputs.size + g.bombCooldown.size + g.remoteCooldown.size).toBe(0);
  expect(g.state.events.map((e) => e.kind)).toEqual(['stage_start']);
});

it('physical WASD, simultaneous keys, release and blur reset never latch a direction', () => {
  const k = new KeyboardState();
  for (const [key, direction] of Object.entries({
    KeyW: { dx: 0, dy: -1 },
    KeyA: { dx: -1, dy: 0 },
    KeyS: { dx: 0, dy: 1 },
    KeyD: { dx: 1, dy: 0 },
  })) {
    k.down(key);
    expect(k.direction()).toEqual(direction);
    k.up(key);
    expect(k.direction()).toEqual({ dx: 0, dy: 0 });
  }
  for (const [a, b] of [
    ['KeyW', 'KeyA'],
    ['KeyW', 'KeyD'],
    ['KeyS', 'KeyA'],
    ['KeyS', 'KeyD'],
  ]) {
    k.down(a);
    k.down(b);
    expect(k.direction().dy).toBe(0);
    k.up(b);
    expect(k.direction().dx).toBe(0);
    k.clear();
    expect(k.direction()).toEqual({ dx: 0, dy: 0 });
  }
  k.down('Space');
  k.down('KeyE');
  k.clear();
  expect(k.bomb || k.remote).toBe(false);
});
