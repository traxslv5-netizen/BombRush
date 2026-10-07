import { it, expect } from 'vitest';
import { Game } from '../apps/server/src/state/Game';
import { movePlayer } from '../apps/server/src/systems/MovementSystem';
import { fits, blocked } from '../apps/server/src/systems/CollisionSystem';
import {
  updateObjectives,
  updateHazards,
} from '../apps/server/src/systems/ObjectiveSystem';
import { breakBlock } from '../apps/server/src/systems/BlockSystem';
import { damageAtBlasts } from '../apps/server/src/systems/ExplosionSystem';
import { updateEnemies } from '../apps/server/src/systems/EnemySystem';
import { updateBoss } from '../apps/server/src/systems/BossSystem';
import {
  reachableCells,
  updateStage,
} from '../apps/server/src/systems/StageSystem';
import { Tile, GAME } from '../shared/src/config/game.config';
import { updateBombs } from '../apps/server/src/systems/BombSystem';
import { STAGES } from '../shared/src/config/stages.config';
function fixture(stage = 0, random = () => 0.4) {
  const g = new Game(random),
    p = g.addPlayer('one', 'One');
  g.loadStage(stage);
  return { g, p };
}
function step(g: Game, t: number) {
  for (let i = 0; i < t * 30; i++) g.tick(1 / 30);
}
it('slime contact is warned before damage, and projectiles stop at solid geometry', () => {
  const { g, p } = fixture();
  g.state.enemies = [];
  p.invulnerability = 0;
  g.spawnEnemy('slime', 1.3, 1);
  const e = g.state.enemies[0];
  e.nextAttack = 0;
  updateEnemies(g, 1 / 30);
  expect(p.lives).toBe(3);
  expect(e.telegraphUntil).toBeGreaterThan(0);
  g.state.time = e.telegraphUntil + 0.01;
  updateEnemies(g, 1 / 30);
  expect(p.lives).toBe(2);
  g.state.projectiles = [
    {
      id: 'test-projectile',
      x: 1,
      y: 2,
      vx: 10,
      vy: 0,
      expires: 20,
      kind: 'fire',
    },
  ];
  updateEnemies(g, 0.2);
  expect(g.state.projectiles).toHaveLength(0);
});
it('kicked bombs stop before enemies and vents warn before becoming dangerous', () => {
  const { g, p } = fixture();
  g.state.enemies = [];
  g.placeBomb(p);
  const b = g.state.bombs[0];
  b.x = 4;
  b.y = 1;
  b.vx = 1;
  b.ownerCanPass = false;
  g.spawnEnemy('slime', 5, 1);
  updateBombs(g);
  expect(b.x).toBe(4);
  expect(b.vx).toBe(0);
  const { g: fire } = fixture(2),
    vent = fire.state.hazards[0];
  fire.state.time = vent.changeAt;
  updateHazards(fire);
  expect(vent.phase).toBe('warning');
  fire.state.time = vent.changeAt;
  updateHazards(fire);
  expect(vent.phase).toBe('active');
});
it('boss phases use reachable add spawns and stay within the add limit', () => {
  const { g } = fixture(4),
    boss = g.state.boss!;
  boss.hp = 60;
  for (let i = 0; i < 12; i++) {
    boss.nextAttack = 0;
    g.state.time += 4;
    updateBoss(g, 1 / 30);
  }
  expect(g.state.enemies.length).toBeGreaterThan(0);
  expect(g.state.enemies.length).toBeLessThanOrEqual(3);
  for (const e of g.state.enemies)
    expect(g.state.grid[Math.round(e.y)][Math.round(e.x)]).not.toBe(Tile.Solid);
});
function objectives(g: Game) {
  const p = g.state.players[0];
  for (const point of g.state.objective.points) {
    if (point.hidden) breakBlock(g, point.x, point.y);
    if (point.kind === 'core') {
      for (let hit = 0; hit < 2; hit++) {
        g.addBlast(point.x, point.y, 'center', p.id);
        updateObjectives(g, 1 / 30);
        g.state.time += 0.7;
        g.state.blasts = [];
      }
    } else {
      p.x = point.x;
      p.y = point.y;
      for (let t = 0; t < 50; t++) updateObjectives(g, 1 / 30);
    }
  }
  g.state.enemies.forEach((e) => g.addBlast(e.x, e.y, 'center', p.id));
  damageAtBlasts(g);
  g.state.blasts = [];
  updateObjectives(g, 1 / 30);
}
it('sweeps prevent clipping or tunnelling into walls and breakables', () => {
  const { g, p } = fixture();
  p.x = 1;
  p.y = 2;
  for (let i = 0; i < 50; i++) movePlayer(g, p, 1, 0, 0.1);
  expect(p.x).toBeLessThanOrEqual(1.5 - GAME.collisionRadius + 0.001);
  expect(fits(g, p.x, p.y, p.id)).toBe(true);
  g.state.grid[2][2] = Tile.Breakable;
  for (let i = 0; i < 20; i++) movePlayer(g, p, 1, 0, 0.1);
  expect(p.x).toBeLessThan(1.2);
});
it('bomb grace expires at the geometric exit, including a immediate reverse and another player', () => {
  const { g, p } = fixture();
  g.placeBomb(p);
  const b = g.state.bombs[0];
  p.x = 1.5 + GAME.collisionRadius + 0.001;
  movePlayer(g, p, -1, 0, 1 / 30);
  expect(b.ownerCanPass).toBe(false);
  expect(p.x).toBeGreaterThanOrEqual(1.5 + GAME.collisionRadius);
  expect(blocked(g, 1, 1, 'other')).toBe(true);
  for (let i = 0; i < 30; i++) movePlayer(g, p, -1, 0, 1 / 30);
  expect(p.x).toBeGreaterThan(1.8);
});
it('grid assist smoothly centers a five-pixel offset without teleporting', () => {
  const { g, p } = fixture();
  p.x = 1 + 5 / 64;
  p.y = 3;
  movePlayer(g, p, 0, -1, 1 / 30);
  expect(p.x).toBeGreaterThan(1);
  expect(p.x).toBeLessThan(1 + 5 / 64);
  for (let i = 0; i < 10; i++) movePlayer(g, p, 0, -1, 1 / 30);
  expect(Math.abs(p.x - 1)).toBeLessThan(0.01);
  expect(p.y).toBeLessThan(2);
});
it('five layouts differ and have reachable, randomized exits and objectives', () => {
  const exits = new Set<string>();
  expect(new Set(STAGES.map((s) => s.rows.join(''))).size).toBe(5);
  for (let stage = 0; stage < 5; stage++) {
    for (const random of [() => 0, () => 0.999]) {
      const { g } = fixture(stage, random);
      const e = g.state.exit;
      expect(
        reachableCells(g, STAGES[stage].spawns[0]).has(`${e.x},${e.y}`),
      ).toBe(true);
      expect(e.open).toBe(false);
      if (stage === 0) exits.add(`${e.x},${e.y}`);
      for (const row of g.state.grid) expect(row.length).toBe(15);
      g.state.grid = g.state.grid.map((row) =>
        row.map((t) => (t === Tile.Breakable ? Tile.Floor : t)),
      );
      const cells = reachableCells(g, STAGES[stage].spawns[0]);
      for (const point of g.state.objective.points)
        expect(
          point.kind === 'core'
            ? [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ].some(([x, y]) => cells.has(`${point.x + x},${point.y + y}`))
            : cells.has(`${point.x},${point.y}`),
        ).toBe(true);
    }
  }
  expect(exits.size).toBeGreaterThan(1);
});
for (const stage of [0, 1, 2, 3])
  it(`stage ${stage + 1} requires its distinct server objective`, () => {
    const { g } = fixture(stage);
    g.state.enemies.forEach((e) => {
      e.alive = false;
    });
    updateObjectives(g, 0.1);
    expect(g.state.objective.complete).toBe(false);
    objectives(g);
    expect(g.state.objective.current).toBe(g.state.objective.target);
    expect(g.state.objective.complete).toBe(true);
    updateStage(g, 0.1);
    expect(g.state.exit.open).toBe(true);
  });
it('a core only takes one hit per blast, and switches require presence', () => {
  const { g, p } = fixture(2);
  const core = g.state.objective.points[0];
  g.addBlast(core.x, core.y, 'center', p.id);
  for (let i = 0; i < 12; i++) updateObjectives(g, 1 / 30);
  expect(core.hp).toBe(1);
  const { g: water } = fixture(1);
  updateObjectives(water, 2);
  expect(water.state.objective.current).toBe(0);
});
it('windup and spirit telegraph before dash or projectile', () => {
  for (const kind of ['windup', 'fire_spirit'] as const) {
    const { g, p } = fixture();
    g.state.enemies = [];
    p.x = 1;
    p.y = 1;
    g.spawnEnemy(kind, 3, 1);
    const e = g.state.enemies[0];
    e.nextAttack = 0;
    updateEnemies(g, 1 / 30);
    expect(e.telegraphUntil).toBeGreaterThan(g.state.time);
    expect(g.state.projectiles).toHaveLength(0);
    expect(e.phaseUntil).toBe(0);
    g.state.time = e.telegraphUntil + 0.01;
    updateEnemies(g, 1 / 30);
    expect(
      kind === 'windup'
        ? e.phaseUntil > g.state.time
        : g.state.projectiles.length === 1,
    ).toBe(true);
  }
});
it('colors are exclusive, released on change, and server-validated', () => {
  const { g } = fixture();
  g.state.phase = 'LOBBY';
  const q = g.addPlayer('two', 'Two');
  expect(g.setColor(q.id, 'red')).toBe(false);
  expect(g.setColor('one', 'yellow')).toBe(true);
  expect(g.setColor(q.id, 'red')).toBe(true);
  expect(new Set(g.state.players.map((p) => p.color)).size).toBe(2);
});
it('boss scales moderately and phase 3 introduces warned hazards', () => {
  const { g } = fixture();
  g.addPlayer('two', 'Two');
  g.addPlayer('three', 'Three');
  g.addPlayer('four', 'Four');
  g.loadStage(4);
  const boss = g.state.boss!;
  expect(boss.maxHp).toBe(160);
  boss.hp = 40;
  boss.nextAttack = 0;
  updateBoss(g, 1 / 30);
  expect(boss.phase).toBe(2);
  expect(g.state.hazards.length).toBeGreaterThan(0);
  expect(g.state.hazards.every((h) => h.phase === 'idle')).toBe(true);
  expect(g.state.warnings[0].at).toBeGreaterThan(g.state.time);
});
it('completes all four objectives, stage transitions and boss into Victory', () => {
  const { g, p } = fixture();
  for (let stage = 0; stage < 4; stage++) {
    expect(g.state.stage).toBe(stage);
    objectives(g);
    p.x = g.state.exit.x;
    p.y = g.state.exit.y;
    g.tick(1 / 30);
    expect(g.state.phase).toBe('STAGE_CLEAR');
    step(g, 2.6);
  }
  const boss = g.state.boss!;
  for (let hit = 0; hit < 10; hit++) {
    g.state.blasts = [];
    g.addBlast(boss.x, boss.y, 'center', p.id);
    damageAtBlasts(g);
    g.state.time += 0.7;
  }
  expect(boss.alive).toBe(false);
  step(g, 4);
  expect(g.state.phase).toBe('VICTORY');
});
