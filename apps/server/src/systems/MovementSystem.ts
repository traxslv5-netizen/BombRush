import type { Player } from '../../../../shared/src/types';
import {
  moveActor,
  overlapsBomb,
} from '../../../../shared/src/gameplay/movement';
import type { Game } from '../state/Game';
export const move = moveActor;
export function movePlayer(
  game: Game,
  p: Player,
  dx: number,
  dy: number,
  dt: number,
): boolean {
  dx = Math.sign(dx);
  dy = dx ? 0 : Math.sign(dy);
  for (const b of game.state.bombs)
    if (b.owner === p.id && b.ownerCanPass && !overlapsBomb(p, b))
      b.ownerCanPass = false;
  if (p.canKick && (dx || dy)) {
    const b = game.state.bombs.find(
      (b) =>
        Math.round(p.x + dx * 0.85) === b.x &&
        Math.round(p.y + dy * 0.85) === b.y &&
        !(b.owner === p.id && b.ownerCanPass),
    );
    if (b && !b.vx && !b.vy) {
      b.vx = dx;
      b.vy = dy;
      b.moveAt = game.state.time;
    }
  }
  const moved = moveActor(game, p, dx, dy, p.speed, dt);
  p.gridX = Math.round(p.x);
  p.gridY = Math.round(p.y);
  return moved;
}
