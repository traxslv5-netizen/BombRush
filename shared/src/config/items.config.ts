import type { ItemKind } from '../types';
export const DROPS: { kind: ItemKind; weight: number }[] = [
  { kind: 'bomb_up', weight: 0.17 },
  { kind: 'fire_up', weight: 0.17 },
  { kind: 'speed_up', weight: 0.12 },
  { kind: 'kick', weight: 0.07 },
  { kind: 'remote', weight: 0.04 },
  { kind: 'shield', weight: 0.08 },
];
