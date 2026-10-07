import { BOSS } from '../../../../shared/src/config/boss.config';
import type { Game } from '../state/Game';
import { blocked } from './CollisionSystem';
import { move } from './MovementSystem';
export function updateBoss(game: Game, dt: number): void {
  const b = game.state.boss,
    t = game.state.time;
  if (!b?.alive) return;
  const previousPhase = b.phase;
  b.phase = b.hp / b.maxHp > 0.65 ? 0 : b.hp / b.maxHp > 0.3 ? 1 : 2;
  if (b.phase === 2 && previousPhase !== 2)
    game.state.hazards = [
      { x: 5, y: 3 },
      { x: 9, y: 3 },
      { x: 5, y: 7 },
      { x: 9, y: 7 },
    ].map((p, i) => ({
      ...p,
      id: game.id('rage-vent'),
      phase: 'idle',
      changeAt: t + 2 + i * 0.65,
    }));
  const p = game.state.players
    .filter((p) => p.alive)
    .sort(
      (p, q) =>
        Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y),
    )[0];
  if (!p) return;
  if (b.actionUntil <= t) {
    const dx = Math.abs(p.x - b.x) > 0.4 ? Math.sign(p.x - b.x) : 0,
      dy = dx ? 0 : Math.sign(p.y - b.y);
    b.action = move(game, b, dx, dy, BOSS.speeds[b.phase], dt)
      ? 'walk'
      : 'idle';
  }
  if (t >= b.nextAttack) {
    b.pattern++;
    b.nextAttack = t + BOSS.cooldowns[b.phase];
    b.action = b.pattern % 2 ? 'attack1' : 'attack2';
    b.actionUntil = t + 1;
    const x = Math.round(b.x),
      y = Math.round(b.y),
      cells: { x: number; y: number }[] = [];
    if (b.pattern % 2 || b.phase === 0) {
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          if (!blocked(game, x + dx, y + dy))
            cells.push({ x: x + dx, y: y + dy });
    } else {
      const targetX = Math.round(p.x),
        targetY = Math.round(p.y);
      for (let xx = 1; xx < 14; xx++)
        if (!blocked(game, xx, targetY)) cells.push({ x: xx, y: targetY });
      if (b.phase === 2)
        for (let yy = 1; yy < 10; yy++)
          if (!blocked(game, targetX, yy)) cells.push({ x: targetX, y: yy });
    }
    game.state.warnings.push({
      id: game.id('warning'),
      cells,
      at: t + BOSS.telegraph,
      kind: b.pattern % 2 ? 'slam' : 'line',
    });
    // Visible fuse bombs give players the same escape timing as their own bombs.
    for (let n = 0; n <= b.phase; n++) {
      const bx = Math.max(1, Math.min(13, Math.round(p.x) + (n - 1) * 2)),
        by = Math.round(p.y);
      if (
        !blocked(game, bx, by) &&
        !game.state.players.some(
          (p) => p.alive && Math.abs(p.x - bx) < 1 && Math.abs(p.y - by) < 1,
        )
      )
        game.state.bombs.push({
          id: game.id('bomb'),
          owner: 'boss',
          x: bx,
          y: by,
          range: 2,
          placedAt: t,
          explodeAt: t + 2.7,
          remote: false,
          ownerCanPass: false,
          vx: 0,
          vy: 0,
          moveAt: 0,
        });
    }
    if (
      b.phase > 0 &&
      b.pattern % 3 === 0 &&
      game.state.enemies.filter((e) => e.alive).length < BOSS.maxAdds
    ) {
      const pos = [
        { x: 5, y: 5 },
        { x: 9, y: 5 },
      ].find(
        (pos) =>
          !blocked(game, pos.x, pos.y) &&
          !game.state.players.some(
            (p) => p.alive && Math.hypot(p.x - pos.x, p.y - pos.y) < 1.2,
          ),
      );
      if (pos)
        game.spawnEnemy(b.phase === 2 ? 'fire_spirit' : 'slime', pos.x, pos.y);
    }
  }
  game.state.warnings = game.state.warnings.filter((w) => {
    if (w.at > t) return true;
    for (const c of w.cells) game.addBlast(c.x, c.y, 'center', 'boss');
    game.event('explosion', b.x, b.y);
    return false;
  });
}
