import type { Game } from '../state/Game';
import { blocked } from '../../../../shared/src/gameplay/movement';
export {
  tileAt,
  blocked,
  fits,
  overlapsBomb,
} from '../../../../shared/src/gameplay/movement';
export function lineClear(
  game: Game,
  x: number,
  y: number,
  tx: number,
  ty: number,
): boolean {
  x = Math.round(x);
  y = Math.round(y);
  tx = Math.round(tx);
  ty = Math.round(ty);
  if (x !== tx && y !== ty) return false;
  const dx = Math.sign(tx - x),
    dy = Math.sign(ty - y);
  for (let i = 0; i < 20; i++) {
    if (x === tx && y === ty) return true;
    x += dx;
    y += dy;
    if (blocked(game, x, y)) return false;
  }
  return false;
}
