import { describe, it, expect } from 'vitest';
import { Game } from '../apps/server/src/state/Game';
import { Tile } from '../shared/src/config/game.config';
import { applyItem, collectItems } from '../apps/server/src/systems/ItemSystem';
import { damageAtBlasts } from '../apps/server/src/systems/ExplosionSystem';
import { damagePlayer } from '../apps/server/src/systems/PlayerSystem';
import { movePlayer } from '../apps/server/src/systems/MovementSystem';
import { updateBombs } from '../apps/server/src/systems/BombSystem';

function fixture() {
  const g = new Game(() => 0.99);
  const p = g.addPlayer('one', 'One');
  g.loadStage(0);
  g.state.enemies = [];
  g.state.items = [];
  g.state.grid = g.state.grid.map((r, y) =>
    r.map((_, x) =>
      !x || !y || x === 14 || y === 10 ? Tile.Solid : Tile.Floor,
    ),
  );
  return { g, p };
}
function advance(g: Game, seconds: number) {
  for (let i = 0; i < seconds * 30; i++) g.tick(1 / 30);
}
describe('bombs, damage and pickups', () => {
  it('fuse detonates after 2.5 seconds and restores capacity', () => {
    const { g, p } = fixture();
    g.placeBomb(p);
    p.x = 5;
    advance(g, 2.4);
    expect(g.state.bombs).toHaveLength(1);
    advance(g, 0.2);
    expect(g.state.bombs).toHaveLength(0);
    expect(g.state.blasts.length).toBeGreaterThan(0);
    expect(p.activeBombs).toBe(0);
  });
  it('cross blast stops at solid walls', () => {
    const { g, p } = fixture();
    p.x = 5;
    p.y = 5;
    p.blastRange = 5;
    g.state.grid[5][7] = Tile.Solid;
    g.placeBomb(p);
    g.explode(g.state.bombs[0].id);
    expect(g.state.blasts.some((b) => b.x === 6 && b.y === 5)).toBe(true);
    expect(g.state.blasts.some((b) => b.x >= 7 && b.y === 5)).toBe(false);
  });
  it('destroys breakable and stops propagation behind it', () => {
    const { g, p } = fixture();
    p.blastRange = 5;
    g.state.grid[1][3] = Tile.Breakable;
    g.placeBomb(p);
    g.explode(g.state.bombs[0].id);
    expect(g.state.grid[1][3]).toBe(Tile.Floor);
    expect(g.state.blasts.some((b) => b.x === 4 && b.y === 1)).toBe(false);
  });
  it('chain reaction detonates another bomb immediately', () => {
    const { g, p } = fixture();
    p.maxBombs = 2;
    g.placeBomb(p);
    g.state.time = 0.3;
    p.x = 3;
    g.placeBomb(p);
    g.explode(g.state.bombs[0].id);
    expect(g.state.bombs).toHaveLength(0);
    expect(p.activeBombs).toBe(0);
    expect(g.state.events.filter((e) => e.kind === 'explosion')).toHaveLength(
      2,
    );
  });
  it('all six items affect the one shared player model and caps apply', () => {
    const { p } = fixture();
    for (const kind of [
      'bomb_up',
      'fire_up',
      'speed_up',
      'kick',
      'remote',
      'shield',
    ] as const)
      applyItem(p, kind);
    expect(p.maxBombs).toBe(2);
    expect(p.blastRange).toBe(3);
    expect(p.speed).toBeGreaterThan(3.25);
    expect(p.canKick && p.hasRemote && p.hasShield).toBe(true);
    for (let i = 0; i < 20; i++) applyItem(p, 'bomb_up');
    expect(p.maxBombs).toBe(5);
  });
  it('shield absorbs one hit, then player dies and respawns with one fewer life', () => {
    const { g, p } = fixture();
    p.invulnerability = 0;
    p.hasShield = true;
    damagePlayer(g, p);
    expect(p.alive).toBe(true);
    expect(p.hasShield).toBe(false);
    g.state.time = 3;
    damagePlayer(g, p);
    expect(p.alive).toBe(false);
    expect(p.lives).toBe(2);
    advance(g, 2.1);
    expect(p.alive).toBe(true);
    expect(p.invulnerability).toBeGreaterThan(g.state.time);
  });
  it('enemy dies from explosion', () => {
    const { g, p } = fixture();
    g.spawnEnemy('slime', 2, 1);
    g.placeBomb(p);
    g.explode(g.state.bombs[0].id);
    damageAtBlasts(g);
    expect(g.state.enemies[0].alive).toBe(false);
  });
  it('boss takes calibrated damage once per invulnerability window', () => {
    const { g } = fixture();
    g.loadStage(4);
    g.addBlast(7, 4, 'center', 'one');
    damageAtBlasts(g);
    damageAtBlasts(g);
    expect(g.state.boss!.hp).toBe(90);
  });
  it('a pickup cannot be collected by two players at once', () => {
    const { g, p } = fixture();
    const q = g.addPlayer('two', 'Two');
    q.x = p.x;
    q.y = p.y;
    g.state.items.push({ id: 'item', x: p.x, y: p.y, kind: 'bomb_up' });
    collectItems(g);
    expect(g.state.items).toHaveLength(0);
    expect(p.maxBombs + q.maxBombs).toBe(3);
  });
  it('remote fuse waits, respects capacity and detonates manually', () => {
    const { g, p } = fixture();
    p.hasRemote = true;
    g.placeBomb(p);
    g.placeBomb(p);
    p.x = 6;
    advance(g, 4);
    expect(g.state.bombs).toHaveLength(1);
    g.detonateRemote(p);
    expect(g.state.bombs).toHaveLength(0);
  });
  it('player can exit own bomb but cannot reenter it', () => {
    const { g, p } = fixture();
    g.placeBomb(p);
    for (let i = 0; i < 15; i++) movePlayer(g, p, 1, 0, 1 / 30);
    expect(p.x).toBeGreaterThan(1.8);
    for (let i = 0; i < 15; i++) movePlayer(g, p, -1, 0, 1 / 30);
    expect(p.x).toBeGreaterThan(1.7);
  });
  it('kick moves the bomb until a wall blocks it', () => {
    const { g, p } = fixture();
    p.x = 3;
    g.placeBomb(p);
    p.x = 1;
    p.canKick = true;
    g.state.bombs[0].ownerCanPass = false;
    for (let i = 0; i < 60; i++) {
      g.state.time += 1 / 30;
      movePlayer(g, p, 1, 0, 1 / 30);
      updateBombs(g);
    }
    expect(g.state.bombs[0].x).toBeGreaterThan(3);
    expect(g.state.bombs[0].x).toBeLessThan(14);
  });
  it('disconnection removes owned bombs and migrates host', () => {
    const { g, p } = fixture();
    g.addPlayer('two', 'Two');
    g.placeBomb(p);
    g.removePlayer(p.id);
    expect(g.state.bombs).toHaveLength(0);
    expect(g.state.host).toBe('two');
  });
});
