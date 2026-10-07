import { Tile } from '../../../../shared/src/config/game.config';
import type { Game } from '../state/Game';
import { damagePlayer } from './PlayerSystem';
export function updateObjectives(game: Game, dt: number): void {
  const s = game.state,
    o = s.objective;
  for (const point of o.points) {
    if (point.done) continue;
    if (point.hidden) {
      if (s.grid[point.y][point.x] !== Tile.Breakable) {
        point.hidden = false;
        game.event('objective_reveal', point.x, point.y);
      } else continue;
    }
    const player = s.players.find(
      (p) =>
        p.alive &&
        p.connected &&
        Math.hypot(p.x - point.x, p.y - point.y) <
          (point.kind === 'totem' ? 0.95 : 0.48),
    );
    if (point.kind === 'core') {
      if (
        point.hitUntil <= s.time &&
        s.blasts.some(
          (b) =>
            b.x === point.x &&
            b.y === point.y &&
            s.players.some((p) => p.id === b.source),
        )
      ) {
        point.hp--;
        point.hitUntil = s.time + 0.65;
        game.event('core_hit', point.x, point.y);
        if (point.hp <= 0) {
          point.done = true;
          game.event('core_break', point.x, point.y);
        }
      }
    } else if (point.kind === 'totem') {
      point.progress = Math.min(
        1,
        Math.max(0, point.progress + (player ? dt / 1.5 : -dt * 0.2)),
      );
      if (point.progress >= 1) {
        point.done = true;
        game.event('objective_pickup', point.x, point.y);
      }
    } else if (player) {
      point.done = true;
      game.event('objective_pickup', point.x, point.y);
    }
  }
  o.current = o.points.filter((p) => p.done).length;
  if (o.type === 'defeat_boss') {
    o.current = s.boss && !s.boss.alive ? 1 : 0;
  }
  o.complete =
    o.current >= o.target &&
    (!o.requireEnemies || !s.enemies.some((e) => e.alive));
}
export function updateHazards(game: Game): void {
  const s = game.state;
  for (const h of s.hazards) {
    if (s.time >= h.changeAt) {
      h.phase =
        h.phase === 'idle'
          ? 'warning'
          : h.phase === 'warning'
            ? 'active'
            : 'idle';
      h.changeAt =
        s.time +
        (h.phase === 'warning' ? 1.25 : h.phase === 'active' ? 1.25 : 3.5);
      if (h.phase === 'active') game.event('vent', h.x, h.y);
    }
    if (h.phase === 'active')
      for (const p of s.players)
        if (p.alive && Math.abs(p.x - h.x) < 0.7 && Math.abs(p.y - h.y) < 0.7)
          damagePlayer(game, p);
  }
}
