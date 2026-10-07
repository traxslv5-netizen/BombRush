import { BOMB } from '../../../../shared/src/config/bomb.config';
import { Tile } from '../../../../shared/src/config/game.config';
import type { Player } from '../../../../shared/src/types';
import type { Game } from '../state/Game';
import { blocked, tileAt } from './CollisionSystem';
export function placeBomb(game: Game, p: Player): void {
  const x = Math.round(p.x),
    y = Math.round(p.y),
    t = game.state.time;
  if (
    !p.alive ||
    p.activeBombs >= p.maxBombs ||
    (game.bombCooldown.get(p.id) ?? 0) > t ||
    game.state.bombs.some((b) => b.x === x && b.y === y) ||
    game.state.objective.points.some(
      (p) => p.kind === 'core' && !p.done && p.x === x && p.y === y,
    ) ||
    game.state.players.some(
      (a) =>
        a.id !== p.id &&
        a.alive &&
        Math.abs(a.x - x) < 0.82 &&
        Math.abs(a.y - y) < 0.82,
    ) ||
    [Tile.Solid, Tile.Breakable, Tile.Water].includes(tileAt(game, x, y))
  )
    return;
  game.bombCooldown.set(p.id, t + BOMB.placementCooldown);
  game.state.bombs.push({
    id: game.id('bomb'),
    owner: p.id,
    x,
    y,
    range: p.blastRange,
    placedAt: t,
    explodeAt: t + BOMB.fuse,
    remote: p.hasRemote,
    ownerCanPass: true,
    vx: 0,
    vy: 0,
    moveAt: 0,
  });
  p.activeBombs++;
  p.action = 'placeBomb';
  p.actionUntil = t + 0.2;
  game.event('bomb_place', x, y);
}
export function updateBombs(game: Game): void {
  for (const b of [...game.state.bombs]) {
    if ((b.vx || b.vy) && b.moveAt <= game.state.time) {
      const x = b.x + b.vx,
        y = b.y + b.vy;
      if (
        blocked(game, x, y) ||
        game.state.enemies.some(
          (e) => e.alive && Math.hypot(e.x - x, e.y - y) < 0.82,
        ) ||
        (game.state.boss?.alive &&
          Math.hypot(game.state.boss.x - x, game.state.boss.y - y) < 1) ||
        game.state.players.some(
          (p) => p.alive && Math.hypot(p.x - x, p.y - y) < 0.6,
        )
      ) {
        b.vx = 0;
        b.vy = 0;
      } else {
        b.x = x;
        b.y = y;
        b.ownerCanPass = false;
        b.moveAt = game.state.time + BOMB.kickInterval;
      }
    }
    if (!b.remote && b.explodeAt <= game.state.time) game.explode(b.id);
    else if (game.state.blasts.some((f) => f.x === b.x && f.y === b.y))
      game.explode(b.id);
  }
}
