export type Color = 'red' | 'blue' | 'purple' | 'yellow';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type Phase =
  'LOBBY' | 'LOADING' | 'PLAYING' | 'STAGE_CLEAR' | 'GAME_OVER' | 'VICTORY';
export type EnemyKind = 'slime' | 'windup' | 'fire_spirit' | 'ghost';
export type ItemKind =
  'bomb_up' | 'fire_up' | 'speed_up' | 'kick' | 'remote' | 'shield';
export type Action =
  | 'idle'
  | 'walk'
  | 'placeBomb'
  | 'hurt'
  | 'death'
  | 'attack'
  | 'attack1'
  | 'attack2';
export interface Input {
  dx: number;
  dy: number;
  bomb: boolean;
  remote: boolean;
  seq: number;
}
export interface Actor {
  id: string;
  x: number;
  y: number;
  direction: Direction;
  alive: boolean;
  action: Action;
  actionUntil: number;
}
export interface Player extends Actor {
  connected: boolean;
  stats: PlayerStats;
  nickname: string;
  color: Color;
  gridX: number;
  gridY: number;
  speed: number;
  invulnerability: number;
  maxBombs: number;
  activeBombs: number;
  blastRange: number;
  canKick: boolean;
  hasRemote: boolean;
  hasShield: boolean;
  lives: number;
  ready: boolean;
  respawnAt: number;
}
export interface Enemy extends Actor {
  telegraphUntil: number;
  attackX: number;
  attackY: number;
  kind: EnemyKind;
  nextThink: number;
  nextAttack: number;
  vx: number;
  vy: number;
  phaseUntil: number;
}
export interface Boss extends Actor {
  hp: number;
  maxHp: number;
  phase: number;
  nextAttack: number;
  invulnerability: number;
  pattern: number;
}
export interface Bomb {
  id: string;
  owner: string;
  x: number;
  y: number;
  range: number;
  explodeAt: number;
  placedAt: number;
  remote: boolean;
  ownerCanPass: boolean;
  vx: number;
  vy: number;
  moveAt: number;
}
export interface Blast {
  id: string;
  x: number;
  y: number;
  expires: number;
  part: string;
  source: string;
}
export interface Item {
  id: string;
  x: number;
  y: number;
  kind: ItemKind;
}
export interface Projectile {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  expires: number;
  kind: 'fire' | 'magic';
}
export interface Warning {
  id: string;
  cells: { x: number; y: number }[];
  at: number;
  kind: 'slam' | 'line';
}
export interface GameEvent {
  id: number;
  kind: string;
  x: number;
  y: number;
}
export interface PlayerStats {
  kills: number;
  deaths: number;
  itemsCollected: number;
  mobsKilled: number;
  bossDamage: number;
}
export type ObjectiveType =
  | 'collect_keys'
  | 'activate_totems'
  | 'destroy_cores'
  | 'collect_crystals'
  | 'defeat_boss';
export interface ObjectivePoint {
  id: string;
  x: number;
  y: number;
  kind: 'key' | 'totem' | 'core' | 'crystal';
  hidden: boolean;
  done: boolean;
  progress: number;
  hp: number;
  maxHp: number;
  hitUntil: number;
}
export interface StageObjective {
  type: ObjectiveType;
  label: string;
  description: string;
  current: number;
  target: number;
  complete: boolean;
  requireEnemies: boolean;
  points: ObjectivePoint[];
}
export interface Hazard {
  id: string;
  x: number;
  y: number;
  phase: 'idle' | 'warning' | 'active';
  changeAt: number;
}
export interface Snapshot {
  phase: Phase;
  stage: number;
  stageName: string;
  theme: string;
  time: number;
  remaining: number;
  grid: number[][];
  players: Player[];
  enemies: Enemy[];
  bombs: Bomb[];
  blasts: Blast[];
  items: Item[];
  projectiles: Projectile[];
  warnings: Warning[];
  boss: Boss | null;
  exit: { x: number; y: number; open: boolean };
  transitionAt: number;
  events: GameEvent[];
  host: string;
  code: string;
  paused: boolean;
  objective: StageObjective;
  hazards: Hazard[];
  persistence: 'local' | 'online' | 'error';
}
