import { ENEMIES } from '../../../../shared/src/config/enemy.config';
import { DIRS } from '../../../../shared/src/config/game.config';
import type { Game } from '../state/Game';
import { blocked, lineClear, fits } from './CollisionSystem';
import { move } from './MovementSystem';
import { damagePlayer } from './PlayerSystem';
export function updateEnemies(game: Game, dt: number): void {
  const s = game.state,
    t = s.time,
    pressure = [0.82, 0.92, 1, 1.06, 1.03][s.stage];
  for (const e of s.enemies) {
    if (!e.alive) continue;
    const targets = s.players
      .filter((p) => p.alive && p.connected)
      .sort(
        (a, b) =>
          Math.hypot(a.x - e.x, a.y - e.y) - Math.hypot(b.x - e.x, b.y - e.y),
      );
    const target = targets[0];
    if (!target) continue;
    const cfg = ENEMIES[e.kind],
      ghost =
        e.kind === 'ghost' &&
        (Math.floor(t / 3) % 3 === 0 ||
          s.grid[Math.round(e.y)]?.[Math.round(e.x)] === 2);
    let winding = false;
    if (e.telegraphUntil) {
      if (t < e.telegraphUntil) {
        winding = true;
        e.action = 'attack';
      } else {
        e.telegraphUntil = 0;
        e.nextAttack = t + cfg.cooldown / pressure;
        e.action = 'attack';
        e.actionUntil = t + 0.35;
        if (e.kind === 'windup') {
          e.vx = e.attackX;
          e.vy = e.attackY;
          e.phaseUntil = t + 0.65;
          game.event('charge', e.x, e.y);
        } else if (e.kind === 'slime') {
          e.phaseUntil = t + 0.35;
        } else
          s.projectiles.push({
            id: game.id('projectile'),
            x: e.x,
            y: e.y,
            vx: e.attackX * 2.8,
            vy: e.attackY * 2.8,
            expires: t + 2.2,
            kind: e.kind === 'ghost' ? 'magic' : 'fire',
          });
      }
    }
    const charging = e.kind === 'windup' && e.phaseUntil > t;
    const striking = e.kind === 'slime' && e.phaseUntil > t;
    const aligned =
      Math.abs(e.x - Math.round(e.x)) < 0.085 &&
      Math.abs(e.y - Math.round(e.y)) < 0.085;
    if (!winding && !charging && !striking && aligned && t >= e.nextThink) {
      if (fits(game, Math.round(e.x), Math.round(e.y), e.id, ghost)) {
        e.x = Math.round(e.x);
        e.y = Math.round(e.y);
      }
      const choices = DIRS.filter(
        (d) =>
          !blocked(
            game,
            Math.round(e.x) + d.x,
            Math.round(e.y) + d.y,
            e.id,
            ghost,
          ),
      );
      choices.sort(
        (a, b) =>
          Math.hypot(target.x - e.x - a.x, target.y - e.y - a.y) -
          Math.hypot(target.x - e.x - b.x, target.y - e.y - b.y),
      );
      let choice =
        e.kind === 'ghost' || game.random() < 0.5
          ? choices[0]
          : choices[Math.floor(game.random() * choices.length)];
      if (
        e.kind === 'fire_spirit' &&
        Math.hypot(target.x - e.x, target.y - e.y) < 3.5
      )
        choice = choices[choices.length - 1];
      if (choice) {
        e.vx = choice.x;
        e.vy = choice.y;
      }
      e.nextThink = t + 0.24;
    }
    if (
      e.kind === 'slime' &&
      !winding &&
      t >= e.nextAttack &&
      Math.hypot(target.x - e.x, target.y - e.y) < 1.2
    ) {
      e.attackX =
        Math.abs(target.x - e.x) > Math.abs(target.y - e.y)
          ? Math.sign(target.x - e.x)
          : 0;
      e.attackY = e.attackX ? 0 : Math.sign(target.y - e.y);
      e.telegraphUntil = t + 0.45;
      e.action = 'attack';
      e.actionUntil = t + 0.8;
      winding = true;
    }
    if (
      !winding &&
      !charging &&
      e.kind !== 'slime' &&
      t >= e.nextAttack &&
      lineClear(game, e.x, e.y, target.x, target.y)
    ) {
      const dx = Math.round(target.x) - Math.round(e.x),
        dy = Math.round(target.y) - Math.round(e.y);
      if ((dx || dy) && (e.kind !== 'ghost' || Math.hypot(dx, dy) < 4)) {
        e.attackX = Math.sign(dx);
        e.attackY = dx ? 0 : Math.sign(dy);
        e.telegraphUntil = t + (e.kind === 'windup' ? 0.7 : 0.8);
        e.action = 'attack';
        e.actionUntil = e.telegraphUntil + 0.35;
        winding = true;
      }
    }
    const moving =
      !winding &&
      !striking &&
      move(
        game,
        e,
        e.vx,
        e.vy,
        cfg.speed * pressure * (charging ? 2.4 : 1),
        dt,
        ghost,
      );
    if (!moving && !winding && !striking) {
      e.vx = -e.vx;
      e.vy = -e.vy;
      e.nextThink = 0;
      e.phaseUntil = 0;
    }
    if (e.actionUntil <= t && !winding) e.action = moving ? 'walk' : 'idle';
    for (const p of targets)
      if (
        Math.hypot(p.x - e.x, p.y - e.y) < (e.kind === 'slime' ? 0.85 : 0.58) &&
        (charging || (e.kind === 'slime' && e.phaseUntil > t))
      ) {
        damagePlayer(game, p);
      }
  }
  s.projectiles = s.projectiles.filter((p) => {
    const steps = Math.max(1, Math.ceil((Math.hypot(p.vx, p.vy) * dt) / 0.1));
    for (let i = 0; i < steps; i++) {
      p.x += (p.vx * dt) / steps;
      p.y += (p.vy * dt) / steps;
      if (p.expires <= t || blocked(game, p.x, p.y)) return false;
      const target = s.players.find(
        (a) => a.alive && Math.hypot(a.x - p.x, a.y - p.y) < 0.48,
      );
      if (target) {
        damagePlayer(game, target);
        return false;
      }
    }
    return true;
  });
}
