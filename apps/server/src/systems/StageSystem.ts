import { STAGES } from '../../../../shared/src/config/stages.config';
import { GAME, Tile, DIRS } from '../../../../shared/src/config/game.config';
import { BOSS } from '../../../../shared/src/config/boss.config';
import type { Game } from '../state/Game';
export function reachableCells(
  game: Game,
  from: { x: number; y: number },
): Set<string> {
  const seen = new Set<string>(),
    queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const { x, y } = queue[i],
      key = `${x},${y}`;
    if (seen.has(key)) continue;
    const tile = game.state.grid[y]?.[x];
    if (
      tile === undefined ||
      [Tile.Solid, Tile.Water, Tile.Breakable, Tile.Lava].includes(tile)
    )
      continue;
    if (
      game.state.objective.points.some(
        (p) => p.kind === 'core' && !p.done && p.x === x && p.y === y,
      )
    )
      continue;
    seen.add(key);
    for (const d of DIRS) queue.push({ x: x + d.x, y: y + d.y });
  }
  return seen;
}
export function loadStage(game: Game, index: number): void {
  const s = game.state,
    c = STAGES[index];
  s.stage = index;
  s.stageRevision++;
  s.pendingStagePlayers = [];
  s.events = [];
  game.inputs.clear();
  game.bombCooldown.clear();
  game.remoteCooldown.clear();
  s.stageName = c.name;
  s.theme = c.theme;
  s.grid = c.rows.map((row) =>
    [...row].map(
      (char) =>
        ({
          '#': Tile.Solid,
          '+': Tile.Breakable,
          '~': Tile.Water,
          '!': Tile.Lava,
          '=': Tile.Ice,
          b: Tile.Bridge,
        })[char] ?? Tile.Floor,
    ),
  );
  for (const spawn of c.spawns) {
    const dx = spawn.x < 7 ? 1 : -1,
      dy = spawn.y < 5 ? 1 : -1;
    for (let step = 0; step <= 2; step++) {
      if (s.grid[spawn.y]?.[spawn.x + dx * step] === Tile.Breakable)
        s.grid[spawn.y][spawn.x + dx * step] = Tile.Floor;
      if (s.grid[spawn.y + dy * step]?.[spawn.x] === Tile.Breakable)
        s.grid[spawn.y + dy * step][spawn.x] = Tile.Floor;
    }
  }
  s.bombs = [];
  s.blasts = [];
  s.items = [];
  s.enemies = [];
  s.projectiles = [];
  s.warnings = [];
  s.boss = null;
  s.transitionAt = 0;
  s.remaining = c.seconds;
  s.phase = 'PLAYING';
  s.paused = false;
  s.objective = {
    ...c.objective,
    current: 0,
    target: index === 4 ? 1 : c.objective.points.length,
    complete: false,
    points: c.objective.points.map((pos, i) => ({
      id: `objective-${index}-${i}`,
      ...pos,
      kind: c.objective.kind,
      hidden: c.objective.hidden,
      done: false,
      progress: 0,
      hp: c.objective.kind === 'core' ? 2 : 1,
      maxHp: c.objective.kind === 'core' ? 2 : 1,
      hitUntil: 0,
    })),
  };
  for (const p of s.objective.points)
    if (p.hidden) s.grid[p.y][p.x] = Tile.Breakable;
  s.hazards = c.vents.map((pos, i) => ({
    id: game.id('vent'),
    ...pos,
    phase: 'idle',
    changeAt: s.time + 3 + i * 0.8,
  }));
  s.players.forEach((p, i) => {
    Object.assign(p, c.spawns[i], {
      gridX: c.spawns[i].x,
      gridY: c.spawns[i].y,
      direction: 'down',
      actionUntil: 0,
      alive: true,
      lives: Math.max(1, p.lives),
      activeBombs: 0,
      action: 'idle',
      invulnerability: s.time + 2.5,
      respawnAt: 0,
    });
    game.inputs.delete(p.id);
  });
  const enemies = [
    ...c.enemies,
    ...c.reinforcements.slice(
      0,
      Math.max(0, Math.ceil((s.players.length - 1) / 2)),
    ),
  ];
  for (const e of enemies) {
    if (s.grid[e.y][e.x] === Tile.Breakable) s.grid[e.y][e.x] = Tile.Floor;
    game.spawnEnemy(e.kind, e.x, e.y);
  }
  if (index === 4) {
    const hp = Math.round(BOSS.hp * (1 + 0.2 * (s.players.length - 1)));
    s.boss = {
      id: 'boss',
      x: 7,
      y: 4,
      direction: 'down',
      alive: true,
      action: 'idle',
      actionUntil: 0,
      hp,
      maxHp: hp,
      phase: 0,
      nextAttack: s.time + 3,
      invulnerability: 0,
      pattern: 0,
    };
  }
  const reachable = reachableCells(game, c.spawns[0]);
  const candidates = c.exitCandidates.filter(
    (p) =>
      reachable.has(`${p.x},${p.y}`) &&
      !s.objective.points.some((o) => o.x === p.x && o.y === p.y),
  );
  if (!candidates.length)
    throw new Error(`Stage ${c.name} has no reachable exit candidate`);
  s.exit = {
    ...candidates[
      Math.min(
        candidates.length - 1,
        Math.floor(game.random() * candidates.length),
      )
    ],
    open: false,
  };
  const kinds = [
    ['bomb_up', 'fire_up'],
    ['kick', 'speed_up'],
    ['remote', 'shield'],
    ['shield', 'fire_up'],
    ['shield', 'bomb_up'],
  ] as const;
  kinds[index].forEach((kind, i) => {
    const spawn = c.spawns[i ? 1 : 0];
    const x = spawn.x + (spawn.x < 7 ? 1 : -1);
    s.items.push({ id: game.id('item'), kind, x, y: spawn.y });
  });
  game.event('stage_start', c.spawns[0].x, c.spawns[0].y);
  if (game.synchronizeStages) {
    s.pendingStagePlayers = s.players
      .filter((p) => p.connected)
      .map((p) => p.id);
    if (s.pendingStagePlayers.length) {
      s.phase = 'SYNCING';
      s.transitionAt = s.time + 15;
    }
  }
}
export function updateStage(game: Game, dt: number): void {
  const s = game.state;
  if (s.phase === 'SYNCING') {
    if (s.time >= s.transitionAt) {
      for (const id of [...s.pendingStagePlayers]) {
        const p = s.players.find((p) => p.id === id);
        // The authority may be in a background tab with rendering suspended;
        // its transport is still alive, so do not disable its input permanently.
        if (p && id !== s.host) p.connected = false;
        game.acknowledgeStage(id, s.stageRevision);
      }
    }
    return;
  }
  if (s.phase === 'LOADING' && s.time >= s.transitionAt) {
    loadStage(game, 0);
    return;
  }
  if (s.phase === 'STAGE_CLEAR' && s.time >= s.transitionAt) {
    if (s.stage === 4) s.phase = 'VICTORY';
    else loadStage(game, s.stage + 1);
    return;
  }
  if (s.phase !== 'PLAYING') return;
  s.remaining = Math.max(0, s.remaining - dt);
  if (s.boss && !s.boss.alive) {
    if (s.time >= s.transitionAt) {
      s.phase = 'STAGE_CLEAR';
      s.transitionAt = s.time + 1.5;
      game.event('stage_clear', s.boss.x, s.boss.y);
    }
    return;
  }
  if (!s.remaining || s.players.every((p) => !p.alive && !p.respawnAt)) {
    s.phase = 'GAME_OVER';
    return;
  }
  if (s.stage < 4 && s.objective.complete) {
    if (!s.exit.open) {
      s.exit.open = true;
      game.event('exit_reveal', s.exit.x, s.exit.y);
    }
    const alive = s.players.filter((p) => p.alive && p.connected),
      inside = alive.filter(
        (p) => Math.hypot(p.x - s.exit.x, p.y - s.exit.y) < 0.65,
      );
    if (inside.length && !s.transitionAt)
      s.transitionAt = s.time + GAME.exitCountdown;
    if (
      inside.length &&
      (inside.length === alive.length || s.time >= s.transitionAt)
    ) {
      s.phase = 'STAGE_CLEAR';
      s.transitionAt = s.time + 2.5;
      game.event('stage_clear', s.exit.x, s.exit.y);
    } else if (!inside.length) s.transitionAt = 0;
  }
}
