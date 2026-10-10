import type {
  Color,
  EnemyKind,
  Input,
  Player,
  Snapshot,
} from '../../../../shared/src/types';
import {
  COLORS,
  GAME,
  SPAWNS,
} from '../../../../shared/src/config/game.config';
import { PLAYER } from '../../../../shared/src/config/player.config';
import { BOMB } from '../../../../shared/src/config/bomb.config';
import { movePlayer } from '../systems/MovementSystem';
import { updatePlayers } from '../systems/PlayerSystem';
import { placeBomb, updateBombs } from '../systems/BombSystem';
import { addBlast, damageAtBlasts, explode } from '../systems/ExplosionSystem';
import { collectItems } from '../systems/ItemSystem';
import { updateEnemies } from '../systems/EnemySystem';
import { updateBoss } from '../systems/BossSystem';
import { loadStage, updateStage } from '../systems/StageSystem';
import { updateObjectives, updateHazards } from '../systems/ObjectiveSystem';
export class Game {
  synchronizeStages = false;
  state: Snapshot = {
    stageRevision: 0,
    pendingStagePlayers: [],
    phase: 'LOBBY',
    stage: 0,
    stageName: 'Garden Entry',
    theme: 'garden',
    time: 0,
    remaining: GAME.stageSeconds,
    grid: [],
    players: [],
    enemies: [],
    bombs: [],
    blasts: [],
    items: [],
    projectiles: [],
    warnings: [],
    boss: null,
    exit: { x: 13, y: 9, open: false },
    transitionAt: 0,
    events: [],
    host: '',
    code: '',
    paused: false,
    objective: {
      type: 'collect_keys',
      label: 'Fragmentos de chave',
      description: '',
      current: 0,
      target: 2,
      complete: false,
      requireEnemies: true,
      points: [],
    },
    hazards: [],
    persistence: 'local',
  };
  inputs = new Map<string, Input>();
  bombCooldown = new Map<string, number>();
  remoteCooldown = new Map<string, number>();
  private counter = 0;
  constructor(public random: () => number = Math.random) {}
  id(prefix: string): string {
    return `${prefix}-${++this.counter}`;
  }
  event(kind: string, x: number, y: number): void {
    this.state.events.push({ id: ++this.counter, kind, x, y });
    if (this.state.events.length > 64) this.state.events.shift();
  }
  addPlayer(id: string, nickname: string): Player {
    if (this.state.players.length >= 4) throw new Error('Sala cheia');
    const color: Color = COLORS.find(
      (c) => !this.state.players.some((p) => p.color === c),
    )!;
    const pos = SPAWNS[this.state.players.length];
    const p: Player = {
      id,
      nickname,
      connected: true,
      stats: {
        kills: 0,
        deaths: 0,
        itemsCollected: 0,
        mobsKilled: 0,
        bossDamage: 0,
      },
      color,
      ...pos,
      gridX: pos.x,
      gridY: pos.y,
      direction: 'down',
      speed: PLAYER.speed,
      alive: true,
      invulnerability: 0,
      maxBombs: 1,
      activeBombs: 0,
      blastRange: 2,
      canKick: false,
      hasRemote: false,
      hasShield: false,
      lives: GAME.lives,
      ready: false,
      respawnAt: 0,
      action: 'idle',
      actionUntil: 0,
    };
    this.state.players.push(p);
    if (!this.state.host) this.state.host = id;
    return p;
  }
  removePlayer(id: string): void {
    this.acknowledgeStage(id, this.state.stageRevision);
    this.state.players = this.state.players.filter((p) => p.id !== id);
    this.state.bombs = this.state.bombs.filter((b) => b.owner !== id);
    this.inputs.delete(id);
    this.bombCooldown.delete(id);
    this.remoteCooldown.delete(id);
    if (this.state.host === id)
      this.state.host = this.state.players[0]?.id ?? '';
    if (this.state.players.length !== 1) this.state.paused = false;
  }
  setColor(id: string, color: Color): boolean {
    const p = this.state.players.find((p) => p.id === id);
    if (
      !p ||
      this.state.phase !== 'LOBBY' ||
      !COLORS.includes(color) ||
      this.state.players.some((p) => p.id !== id && p.color === color)
    )
      return false;
    p.color = color;
    p.ready = false;
    return true;
  }
  start(): void {
    if (this.state.phase === 'LOBBY' && this.state.players.length) {
      this.state.phase = 'LOADING';
      this.state.transitionAt = this.state.time + 0.6;
    }
  }
  restart(): void {
    this.state.players.forEach((p) =>
      Object.assign(p, {
        lives: GAME.lives,
        maxBombs: 1,
        blastRange: 2,
        speed: PLAYER.speed,
        canKick: false,
        hasRemote: false,
        hasShield: false,
        stats: {
          kills: 0,
          deaths: 0,
          itemsCollected: 0,
          mobsKilled: 0,
          bossDamage: 0,
        },
      }),
    );
    this.state.paused = false;
    this.loadStage(0);
  }
  loadStage(index: number): void {
    loadStage(this, index);
  }
  acknowledgeStage(id: string, revision: number): void {
    const s = this.state;
    if (s.phase !== 'SYNCING' || revision !== s.stageRevision) return;
    s.pendingStagePlayers = s.pendingStagePlayers.filter(
      (pending) => pending !== id,
    );
    if (!s.pendingStagePlayers.length) {
      s.phase = 'PLAYING';
      s.transitionAt = 0;
      for (const p of s.players) p.invulnerability = s.time + 2.5;
    }
  }
  spawnEnemy(kind: EnemyKind, x: number, y: number): void {
    this.state.enemies.push({
      id: this.id('enemy'),
      kind,
      x,
      y,
      alive: true,
      direction: 'down',
      action: 'idle',
      actionUntil: 0,
      nextThink: 0,
      nextAttack: this.state.time + 2,
      vx: 0,
      vy: 0,
      phaseUntil: 0,
      telegraphUntil: 0,
      attackX: 0,
      attackY: 0,
    });
  }
  movePlayer(p: Player, dx: number, dy: number, dt: number): boolean {
    return movePlayer(this, p, dx, dy, dt);
  }
  placeBomb(p: Player): void {
    placeBomb(this, p);
  }
  explode(id: string): void {
    explode(this, id);
  }
  addBlast(x: number, y: number, part: string, source: string): void {
    addBlast(this, x, y, part, source);
  }
  detonateRemote(p: Player): void {
    if (
      !p.alive ||
      !p.hasRemote ||
      (this.remoteCooldown.get(p.id) ?? 0) > this.state.time
    )
      return;
    this.remoteCooldown.set(p.id, this.state.time + BOMB.remoteCooldown);
    for (const b of [...this.state.bombs])
      if (b.owner === p.id && b.remote) this.explode(b.id);
  }
  tick(dt: number): void {
    if (this.state.paused) return;
    dt = Math.min(0.1, Math.max(0, dt));
    this.state.time += dt;
    if (this.state.phase === 'PLAYING') {
      updatePlayers(this, dt);
      updateBombs(this);
      updateEnemies(this, dt);
      updateBoss(this, dt);
      damageAtBlasts(this);
      collectItems(this);
      updateHazards(this);
      updateObjectives(this, dt);
    }
    updateStage(this, dt);
  }
}
