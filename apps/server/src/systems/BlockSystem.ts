import { Tile } from '../../../../shared/src/config/game.config';
import { DROPS } from '../../../../shared/src/config/items.config';
import type { Game } from '../state/Game';
export function breakBlock(game: Game, x: number, y: number): void {
  if (game.state.grid[y]?.[x] !== Tile.Breakable) return;
  game.state.grid[y][x] = Tile.Floor;
  game.event('block_break', x, y);
  let roll = game.random();
  for (const drop of DROPS) {
    roll -= drop.weight;
    if (roll < 0) {
      game.state.items.push({ id: game.id('item'), x, y, kind: drop.kind });
      break;
    }
  }
}
