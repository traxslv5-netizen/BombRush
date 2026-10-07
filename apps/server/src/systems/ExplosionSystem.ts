import { BOMB } from '../../../../shared/src/config/bomb.config';
import { BOSS } from '../../../../shared/src/config/boss.config';
import { DIRS, Tile } from '../../../../shared/src/config/game.config';
import type { Game } from '../state/Game';
import { tileAt } from './CollisionSystem';
import { breakBlock } from './BlockSystem';
import { damagePlayer } from './PlayerSystem';
export function explode(game: Game, id: string): void {
  const b = game.state.bombs.find((b) => b.id === id);
  if (!b) return;
  game.state.bombs = game.state.bombs.filter((b) => b.id !== id);
  const owner = game.state.players.find((p) => p.id === b.owner);
  if (owner) owner.activeBombs = Math.max(0, owner.activeBombs - 1);
  game.event('explosion', b.x, b.y);
  game.addBlast(b.x, b.y, 'center', b.owner);
  for (const d of DIRS)
    for (let i = 1; i <= b.range; i++) {
      const x = b.x + d.x * i,
        y = b.y + d.y * i,
        tile = tileAt(game, x, y);
      if (tile === Tile.Solid || tile === Tile.Water) break;
      const obstacle = tile === Tile.Breakable;
      const core = game.state.objective.points.some(
        (p) => p.kind === 'core' && !p.done && p.x === x && p.y === y,
      );
      game.addBlast(
        x,
        y,
        i === b.range || obstacle
          ? `end_${d.name}`
          : d.x
            ? 'horizontal'
            : 'vertical',
        b.owner,
      );
      if (obstacle) {
        breakBlock(game, x, y);
        break;
      }
      if (core) break;
      const chain = game.state.bombs.find(
        (other) => other.x === x && other.y === y,
      );
      if (chain) {
        explode(game, chain.id);
        break;
      }
    }
}
export function damageAtBlasts(game: Game): void {
  const t = game.state.time;
  for (const p of game.state.players)
    if (
      game.state.blasts.some(
        (b) => Math.abs(p.x - b.x) < 0.64 && Math.abs(p.y - b.y) < 0.64,
      ) ||
      tileAt(game, p.x, p.y) === Tile.Lava
    ) {
      const before = p.alive;
      damagePlayer(game, p);
      if (before && !p.alive) {
        const killer = game.state.players.find(
          (a) =>
            a.id !== p.id &&
            game.state.blasts.some(
              (b) =>
                b.source === a.id &&
                Math.abs(p.x - b.x) < 0.64 &&
                Math.abs(p.y - b.y) < 0.64,
            ),
        );
        if (killer) killer.stats.kills++;
      }
    }
  for (const e of game.state.enemies)
    if (
      e.alive &&
      game.state.blasts.some(
        (b) => Math.abs(e.x - b.x) < 0.65 && Math.abs(e.y - b.y) < 0.65,
      )
    ) {
      e.alive = false;
      e.action = 'death';
      e.actionUntil = t + 0.7;
      game.event('enemy_death', e.x, e.y);
      const killer = game.state.players.find((p) =>
        game.state.blasts.some(
          (b) =>
            b.source === p.id &&
            Math.abs(e.x - b.x) < 0.65 &&
            Math.abs(e.y - b.y) < 0.65,
        ),
      );
      if (killer) killer.stats.mobsKilled++;
    }
  const boss = game.state.boss;
  if (
    boss?.alive &&
    boss.invulnerability <= t &&
    game.state.blasts.some(
      (b) =>
        b.source !== 'boss' &&
        Math.abs(boss.x - b.x) < 0.95 &&
        Math.abs(boss.y - b.y) < 0.95,
    )
  ) {
    const dealer = game.state.players.find((p) =>
      game.state.blasts.some(
        (b) =>
          b.source === p.id &&
          Math.abs(boss.x - b.x) < 0.95 &&
          Math.abs(boss.y - b.y) < 0.95,
      ),
    );
    if (dealer) dealer.stats.bossDamage += Math.min(boss.hp, BOSS.damage);
    boss.hp = Math.max(0, boss.hp - BOSS.damage);
    boss.invulnerability = t + BOSS.hitCooldown;
    boss.action = boss.hp ? 'hurt' : 'death';
    boss.actionUntil = t + (boss.hp ? 0.4 : 1.5);
    game.event(boss.hp ? 'boss_hit' : 'boss_death', boss.x, boss.y);
    if (!boss.hp) {
      boss.alive = false;
      game.state.warnings = [];
      game.state.hazards = [];
      game.state.projectiles = [];
      game.state.enemies.forEach((e) => {
        e.alive = false;
        e.action = 'death';
      });
      game.state.transitionAt = t + 2;
    }
  }
  for (const b of game.state.blasts)
    if (b.expires <= t) game.event('smoke', b.x, b.y);
  game.state.blasts = game.state.blasts.filter((b) => b.expires > t);
}
export function addBlast(
  game: Game,
  x: number,
  y: number,
  part: string,
  source: string,
): void {
  game.state.blasts.push({
    id: game.id('blast'),
    x,
    y,
    part,
    source,
    expires: game.state.time + BOMB.blastDuration,
  });
}
