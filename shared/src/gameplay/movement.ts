import { GAME, Tile } from '../config/game.config';
import { PLAYER } from '../config/player.config';
import type { Actor, Bomb, Snapshot } from '../types';
export type CollisionWorld = {
  state: Pick<Snapshot, 'grid' | 'bombs'> &
    Partial<Pick<Snapshot, 'objective'>>;
};
export function tileAt(game: CollisionWorld, x: number, y: number): number {
  return game.state.grid[Math.round(y)]?.[Math.round(x)] ?? Tile.Solid;
}
export function overlapsBomb(a: { x: number; y: number }, b: Bomb): boolean {
  const extent = 0.5 + GAME.collisionRadius;
  return (
    Math.abs(a.x - b.x) < extent - 1e-7 && Math.abs(a.y - b.y) < extent - 1e-7
  );
}
export function blocked(
  game: CollisionWorld,
  x: number,
  y: number,
  actorId = '',
  ghost = false,
): boolean {
  const tile = tileAt(game, x, y),
    gx = Math.round(x),
    gy = Math.round(y);
  if (
    tile === Tile.Solid ||
    tile === Tile.Water ||
    (tile === Tile.Breakable && !ghost)
  )
    return true;
  if (
    game.state.objective?.points.some(
      (p) => p.kind === 'core' && !p.done && p.x === gx && p.y === gy,
    )
  )
    return true;
  return game.state.bombs.some(
    (b) => b.x === gx && b.y === gy && !(b.owner === actorId && b.ownerCanPass),
  );
}
export function fits(
  game: CollisionWorld,
  x: number,
  y: number,
  id = '',
  ghost = false,
): boolean {
  const r = GAME.collisionRadius - 1e-7;
  return [
    [-r, -r],
    [r, -r],
    [-r, r],
    [r, r],
  ].every(([dx, dy]) => !blocked(game, x + dx, y + dy, id, ghost));
}
export function moveActor(
  game: CollisionWorld,
  a: Actor,
  dx: number,
  dy: number,
  speed: number,
  dt: number,
  ghost = false,
): boolean {
  dx = Math.sign(dx);
  dy = dx ? 0 : Math.sign(dy);
  if (!dx && !dy) return false;
  a.direction = dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : 'down';
  const startX = a.x,
    startY = a.y,
    steps = Math.max(1, Math.ceil((speed * dt) / 0.075)),
    stepTime = dt / steps;
  for (let i = 0; i < steps; i++) {
    for (const b of game.state.bombs)
      if (b.owner === a.id && b.ownerCanPass && !overlapsBomb(a, b))
        b.ownerCanPass = false;
    const offset = dx ? Math.round(a.y) - a.y : Math.round(a.x) - a.x;
    if (Math.abs(offset) <= PLAYER.GRID_ASSIST_DISTANCE) {
      const correction =
        offset * (1 - Math.exp(-PLAYER.GRID_ASSIST_STRENGTH * stepTime));
      const x = a.x + (dy ? correction : 0),
        y = a.y + (dx ? correction : 0);
      if (fits(game, x, y, a.id, ghost)) {
        a.x = x;
        a.y = y;
      }
    }
    const distance = speed * stepTime;
    if (fits(game, a.x + dx * distance, a.y + dy * distance, a.id, ghost)) {
      a.x += dx * distance;
      a.y += dy * distance;
    } else {
      let low = 0,
        high = distance;
      for (let n = 0; n < 9; n++) {
        const m = (low + high) / 2;
        if (fits(game, a.x + dx * m, a.y + dy * m, a.id, ghost)) low = m;
        else high = m;
      }
      a.x += dx * low;
      a.y += dy * low;
    }
    for (const b of game.state.bombs)
      if (b.owner === a.id && b.ownerCanPass && !overlapsBomb(a, b))
        b.ownerCanPass = false;
  }
  return Math.hypot(a.x - startX, a.y - startY) > 1e-5;
}
