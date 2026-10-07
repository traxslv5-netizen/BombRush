import type { Game } from '../state/Game';
export const roomRegistry = new Map<string, { roomId: string; game: Game }>();
