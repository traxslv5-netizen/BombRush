import { SPAWNS } from './game.config';
import type { EnemyKind, ObjectiveType, ObjectivePoint } from '../types';
type Point = { x: number; y: number };
type Cell = [number, number];
export interface Stage {
  name: string;
  theme: string;
  subtitle: string;
  seconds: number;
  enemies: { kind: EnemyKind; x: number; y: number }[];
  reinforcements: { kind: EnemyKind; x: number; y: number }[];
  rows: string[];
  spawns: Point[];
  exitCandidates: Point[];
  objective: {
    type: ObjectiveType;
    label: string;
    description: string;
    kind: ObjectivePoint['kind'];
    points: Point[];
    hidden: boolean;
    requireEnemies: boolean;
  };
  vents: Point[];
  decor: {
    x: number;
    y: number;
    kind: 'flowers' | 'tree' | 'pipe' | 'snow' | 'reactor';
  }[];
}
const points = (cells: Cell[]): Point[] => cells.map(([x, y]) => ({ x, y }));
function arena(
  pillars: Cell[],
  blocks: Cell[],
  paint: { cells: Cell[]; type: string }[] = [],
  floor = '.',
): string[] {
  const grid = Array.from({ length: 11 }, (_, y) =>
    Array.from({ length: 15 }, (_, x) =>
      !x || !y || x === 14 || y === 10 ? '#' : floor,
    ),
  );
  for (const { cells, type } of paint)
    for (const [x, y] of cells) grid[y][x] = type;
  for (const [x, y] of pillars) grid[y][x] = '#';
  for (const [x, y] of blocks) grid[y][x] = '+';
  return grid.map((row) => row.join(''));
}
const classic: Cell[] = [];
for (let y = 2; y <= 8; y += 2)
  for (let x = 2; x <= 12; x += 2) classic.push([x, y]);
const corners = points([
  [1, 5],
  [13, 5],
  [7, 1],
  [7, 9],
]);
export const STAGES: Stage[] = [
  {
    name: 'Garden Entry',
    theme: 'garden',
    subtitle: 'As chaves do jardim',
    seconds: 300,
    spawns: SPAWNS,
    exitCandidates: corners,
    enemies: [
      { kind: 'slime', x: 7, y: 3 },
      { kind: 'slime', x: 11, y: 7 },
      { kind: 'slime', x: 3, y: 7 },
    ],
    reinforcements: [
      { kind: 'slime', x: 9, y: 5 },
      { kind: 'slime', x: 5, y: 5 },
    ],
    rows: arena(classic, [
      [3, 3],
      [7, 3],
      [11, 3],
      [3, 5],
      [5, 5],
      [9, 5],
      [11, 5],
      [5, 7],
      [9, 7],
      [5, 9],
      [9, 9],
    ]),
    objective: {
      type: 'collect_keys',
      label: 'Fragmentos de chave',
      description:
        'Encontre 2 fragmentos nos blocos marcados e elimine os slimes.',
      kind: 'key',
      points: points([
        [5, 3],
        [9, 7],
      ]),
      hidden: true,
      requireEnemies: true,
    },
    vents: [],
    decor: [
      { x: 0, y: 0, kind: 'flowers' },
      { x: 14, y: 0, kind: 'flowers' },
      { x: 0, y: 10, kind: 'flowers' },
      { x: 14, y: 10, kind: 'flowers' },
      { x: 6, y: 0, kind: 'tree' },
      { x: 8, y: 10, kind: 'flowers' },
    ],
  },
  {
    name: 'Flooded Garden',
    theme: 'water',
    subtitle: 'Religue as três comportas',
    seconds: 300,
    spawns: SPAWNS,
    exitCandidates: points([
      [1, 5],
      [13, 5],
      [7, 1],
      [7, 9],
    ]),
    enemies: [
      { kind: 'slime', x: 3, y: 7 },
      { kind: 'windup', x: 7, y: 3 },
      { kind: 'slime', x: 11, y: 3 },
      { kind: 'windup', x: 11, y: 7 },
    ],
    reinforcements: [
      { kind: 'slime', x: 7, y: 7 },
      { kind: 'windup', x: 3, y: 3 },
    ],
    rows: arena(
      [
        [2, 2],
        [2, 4],
        [2, 6],
        [2, 8],
        [6, 2],
        [8, 2],
        [12, 2],
        [12, 4],
        [12, 6],
        [12, 8],
        [6, 8],
        [8, 8],
      ],
      [
        [3, 1],
        [5, 3],
        [9, 7],
        [11, 9],
        [7, 4],
        [7, 6],
      ],
      [
        {
          type: '~',
          cells: [
            ...Array.from({ length: 9 }, (_, i) => [4, i + 1] as Cell),
            ...Array.from({ length: 9 }, (_, i) => [10, i + 1] as Cell),
            [5, 5],
            [6, 5],
            [8, 5],
            [9, 5],
          ],
        },
        { type: '=', cells: [] },
        {
          type: 'b',
          cells: [
            [4, 3],
            [10, 3],
            [4, 7],
            [10, 7],
            [7, 5],
          ],
        },
      ],
    ),
    objective: {
      type: 'activate_totems',
      label: 'Comportas',
      description: 'Fique perto de cada mecanismo por 1,5 s para ativá-lo.',
      kind: 'totem',
      points: points([
        [3, 5],
        [7, 3],
        [11, 7],
      ]),
      hidden: false,
      requireEnemies: false,
    },
    vents: [],
    decor: [
      { x: 0, y: 0, kind: 'tree' },
      { x: 14, y: 10, kind: 'tree' },
      { x: 4, y: 0, kind: 'pipe' },
      { x: 10, y: 10, kind: 'pipe' },
    ],
  },
  {
    name: 'Furnace District',
    theme: 'lava',
    subtitle: 'Sabote os núcleos da fornalha',
    seconds: 330,
    spawns: SPAWNS,
    exitCandidates: corners,
    enemies: [
      { kind: 'windup', x: 3, y: 3 },
      { kind: 'fire_spirit', x: 11, y: 3 },
      { kind: 'windup', x: 3, y: 7 },
      { kind: 'fire_spirit', x: 11, y: 7 },
    ],
    reinforcements: [
      { kind: 'fire_spirit', x: 7, y: 6 },
      { kind: 'windup', x: 7, y: 4 },
    ],
    rows: arena(
      [
        [2, 2],
        [2, 8],
        [12, 2],
        [12, 8],
        [5, 2],
        [5, 3],
        [5, 7],
        [5, 8],
        [9, 2],
        [9, 3],
        [9, 7],
        [9, 8],
      ],
      [
        [3, 4],
        [11, 6],
        [4, 5],
        [10, 5],
        [7, 3],
        [7, 7],
      ],
      [
        {
          type: '!',
          cells: [
            [6, 2],
            [7, 2],
            [8, 2],
            [6, 8],
            [7, 8],
            [8, 8],
          ],
        },
      ],
    ),
    objective: {
      type: 'destroy_cores',
      label: 'Bomb Cores',
      description: 'Acerte cada núcleo com duas explosões. Observe o vapor.',
      kind: 'core',
      points: points([
        [3, 5],
        [7, 5],
        [11, 5],
      ]),
      hidden: false,
      requireEnemies: false,
    },
    vents: points([
      [5, 5],
      [9, 5],
      [7, 4],
      [7, 6],
    ]),
    decor: [
      { x: 0, y: 0, kind: 'pipe' },
      { x: 14, y: 0, kind: 'reactor' },
      { x: 0, y: 10, kind: 'reactor' },
      { x: 14, y: 10, kind: 'pipe' },
    ],
  },
  {
    name: 'Frozen Labyrinth',
    theme: 'ice',
    subtitle: 'Recupere a energia perdida',
    seconds: 360,
    spawns: SPAWNS,
    exitCandidates: corners,
    enemies: [
      { kind: 'ghost', x: 5, y: 5 },
      { kind: 'ghost', x: 11, y: 7 },
      { kind: 'ghost', x: 7, y: 3 },
      { kind: 'windup', x: 3, y: 7 },
    ],
    reinforcements: [
      { kind: 'ghost', x: 9, y: 9 },
      { kind: 'fire_spirit', x: 11, y: 3 },
    ],
    rows: arena(
      [
        [2, 2],
        [3, 2],
        [4, 2],
        [5, 2],
        [7, 2],
        [8, 2],
        [9, 2],
        [10, 2],
        [12, 2],
        [2, 4],
        [4, 4],
        [5, 4],
        [6, 4],
        [7, 4],
        [9, 4],
        [10, 4],
        [11, 4],
        [12, 4],
        [2, 6],
        [3, 6],
        [4, 6],
        [5, 6],
        [7, 6],
        [8, 6],
        [9, 6],
        [10, 6],
        [12, 6],
        [2, 8],
        [4, 8],
        [5, 8],
        [6, 8],
        [7, 8],
        [9, 8],
        [10, 8],
        [11, 8],
        [12, 8],
      ],
      [
        [6, 3],
        [8, 5],
        [3, 5],
        [6, 7],
        [11, 7],
        [3, 9],
      ],
      [],
      '=',
    ),
    objective: {
      type: 'collect_crystals',
      label: 'Energy Crystals',
      description: 'Explore o labirinto e liberte 3 cristais presos no gelo.',
      kind: 'crystal',
      points: points([
        [3, 3],
        [11, 5],
        [7, 7],
      ]),
      hidden: true,
      requireEnemies: false,
    },
    vents: [],
    decor: [
      { x: 0, y: 0, kind: 'snow' },
      { x: 14, y: 0, kind: 'snow' },
      { x: 0, y: 10, kind: 'snow' },
      { x: 14, y: 10, kind: 'snow' },
      { x: 7, y: 0, kind: 'snow' },
    ],
  },
  {
    name: 'Bomb Forge',
    theme: 'boss',
    subtitle: 'O coração da fábrica',
    seconds: 360,
    spawns: points([
      [2, 8],
      [12, 8],
      [2, 2],
      [12, 2],
    ]),
    exitCandidates: points([[7, 9]]),
    enemies: [],
    reinforcements: [],
    rows: arena(
      [
        [1, 1],
        [2, 1],
        [12, 1],
        [13, 1],
        [1, 9],
        [2, 9],
        [12, 9],
        [13, 9],
        [3, 3],
        [11, 3],
        [3, 7],
        [11, 7],
      ],
      [],
    ),
    objective: {
      type: 'defeat_boss',
      label: 'Bomb Forge',
      description:
        'Leia as marcações. Acerte o boss e mantenha uma rota de fuga.',
      kind: 'core',
      points: [],
      hidden: false,
      requireEnemies: false,
    },
    vents: [],
    decor: [
      { x: 0, y: 0, kind: 'reactor' },
      { x: 14, y: 0, kind: 'reactor' },
      { x: 0, y: 10, kind: 'reactor' },
      { x: 14, y: 10, kind: 'reactor' },
      { x: 7, y: 0, kind: 'pipe' },
    ],
  },
];
