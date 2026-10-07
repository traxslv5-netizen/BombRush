export const GAME = {
  tick: 30,
  snapshot: 15,
  width: 15,
  height: 11,
  tile: 64,
  stageSeconds: 240,
  lives: 3,
  exitCountdown: 3,
  respawnSeconds: 2,
  collisionRadius: 0.32,
};
export const DIRS = [
  { x: 0, y: -1, name: 'up' },
  { x: 0, y: 1, name: 'down' },
  { x: -1, y: 0, name: 'left' },
  { x: 1, y: 0, name: 'right' },
] as const;
export const COLORS = ['red', 'blue', 'purple', 'yellow'] as const;
export const SPAWNS = [
  { x: 1, y: 1 },
  { x: 13, y: 1 },
  { x: 1, y: 9 },
  { x: 13, y: 9 },
];
export enum Tile {
  Floor,
  Solid,
  Breakable,
  Water,
  Lava,
  Ice,
  Bridge,
}
