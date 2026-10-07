import { GAME } from '../../../../shared/src/config/game.config';
import { STAGES } from '../../../../shared/src/config/stages.config';
import { PLAYER } from '../../../../shared/src/config/player.config';
import type { Game } from '../state/Game';
import type { Player } from '../../../../shared/src/types';
export function damagePlayer(game: Game, p: Player): void {
  const t = game.state.time;
  if (!p.alive || p.invulnerability > t) return;
  if (p.hasShield) {
    p.hasShield = false;
    p.invulnerability = t + PLAYER.invulnerability;
    p.action = 'hurt';
    p.actionUntil = t + 0.4;
    game.event('shield_break', p.x, p.y);
    return;
  }
  p.lives--;
  p.stats.deaths++;
  p.alive = false;
  p.action = 'death';
  p.actionUntil = t + GAME.respawnSeconds;
  p.respawnAt = p.lives > 0 ? t + GAME.respawnSeconds : 0;
  game.event('player_death', p.x, p.y);
  // A remote owner who can no longer act cannot leave permanent obstructions.
  for (const b of game.state.bombs)
    if (b.owner === p.id) {
      b.remote = false;
      b.explodeAt = Math.min(b.explodeAt, t + 2.5);
    }
}
export function updatePlayers(game: Game, dt: number): void {
  for (const p of game.state.players) {
    if (!p.alive) {
      if (p.respawnAt && p.respawnAt <= game.state.time) {
        const spawn =
          STAGES[game.state.stage].spawns[game.state.players.indexOf(p)];
        p.x = spawn.x;
        p.y = spawn.y;
        p.alive = true;
        p.respawnAt = 0;
        p.invulnerability = game.state.time + PLAYER.invulnerability;
        p.action = 'idle';
      }
      continue;
    }
    const input = p.connected ? game.inputs.get(p.id) : undefined;
    const moving = game.movePlayer(p, input?.dx ?? 0, input?.dy ?? 0, dt);
    if (p.actionUntil <= game.state.time) p.action = moving ? 'walk' : 'idle';
    if (input?.bomb) {
      game.placeBomb(p);
      input.bomb = false;
    }
    if (input?.remote) {
      game.detonateRemote(p);
      input.remote = false;
    }
  }
}
