import type { ItemKind, Player } from '../../../../shared/src/types';
import { PLAYER } from '../../../../shared/src/config/player.config';
import type { Game } from '../state/Game';
export function applyItem(p: Player, kind: ItemKind): void {
  switch (kind) {
    case 'bomb_up':
      p.maxBombs = Math.min(PLAYER.maxBombs, p.maxBombs + 1);
      break;
    case 'fire_up':
      p.blastRange = Math.min(PLAYER.maxRange, p.blastRange + 1);
      break;
    case 'speed_up':
      p.speed = Math.min(PLAYER.maxSpeed, p.speed + PLAYER.speedStep);
      break;
    case 'kick':
      p.canKick = true;
      break;
    case 'remote':
      p.hasRemote = true;
      break;
    case 'shield':
      p.hasShield = true;
      break;
  }
}
export function collectItems(game: Game): void {
  // Consume atomically on the authority; iteration order resolves simultaneous arrivals.
  game.state.items = game.state.items.filter((item) => {
    const p = game.state.players.find(
      (p) => p.alive && Math.hypot(p.x - item.x, p.y - item.y) < 0.48,
    );
    if (!p) return true;
    applyItem(p, item.kind);
    p.stats.itemsCollected++;
    game.event('pickup', item.x, item.y);
    return false;
  });
}
