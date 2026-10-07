import sharp from 'sharp';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Regions are measured on the supplied sheets, as fractions of their full size.
// The original RGBA pixels are preserved; only transparent margins are trimmed.
const root = 'assets';
const sources = (await readdir(`${root}/source`)).sort(
  (a, b) =>
    Number(a.match(/-(\d+)\.png$/)[1]) - Number(b.match(/-(\d+)\.png$/)[1]),
);
const manifest = {};
const audit = [];
const cache = new Map();
async function components(source) {
  if (cache.has(source)) return cache.get(source);
  const { data, info } = await sharp(source)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const labels = new Int32Array(info.width * info.height),
    parts = [];
  let id = 0;
  for (let p = 0; p < labels.length; p++) {
    if (labels[p] || data[p * 4 + 3] < 20) continue;
    id++;
    const queue = [p];
    labels[p] = id;
    let l = info.width,
      r = 0,
      t = info.height,
      b = 0,
      sx = 0,
      sy = 0;
    for (let i = 0; i < queue.length; i++) {
      const v = queue[i],
        x = v % info.width,
        y = Math.floor(v / info.width);
      l = Math.min(l, x);
      r = Math.max(r, x);
      t = Math.min(t, y);
      b = Math.max(b, y);
      sx += x;
      sy += y;
      for (const n of [
        x > 0 ? v - 1 : -1,
        x < info.width - 1 ? v + 1 : -1,
        y > 0 ? v - info.width : -1,
        y < info.height - 1 ? v + info.width : -1,
      ])
        if (n >= 0 && !labels[n] && data[n * 4 + 3] >= 20) {
          labels[n] = id;
          queue.push(n);
        }
    }
    if (queue.length >= 12)
      parts.push({
        id,
        l,
        r,
        t,
        b,
        cx: sx / queue.length,
        cy: sy / queue.length,
      });
  }
  const result = { data, info, labels, parts };
  cache.set(source, result);
  return result;
}
async function group(sheet, prefix, boxes, names, canvas = [256, 384]) {
  const source = `${root}/source/${sources[sheet - 1]}`;
  const meta = await sharp(source).metadata();
  const parts = [];
  for (let i = 0; i < boxes.length; i++) {
    const [x, y, bw, bh] = boxes[i];
    const region = {
      left: Math.round(x * meta.width),
      top: Math.round(y * meta.height),
      width: Math.round(bw * meta.width),
      height: Math.round(bh * meta.height),
    };
    region.width = Math.min(region.width, meta.width - region.left);
    region.height = Math.min(region.height, meta.height - region.top);
    if (prefix === 'tiles' || prefix === 'maps' || prefix === 'hud') {
      const regionPng = await sharp(source).extract(region).png().toBuffer();
      const trimmed = await sharp(regionPng).trim().png().toBuffer();
      const m = await sharp(trimmed).metadata();
      parts.push({ trimmed, w: m.width, h: m.height });
      continue;
    }
    const {
      data,
      info,
      labels,
      parts: componentsList,
    } = await components(source);
    // Select complete shapes by centroid; detached stars and shadows stay intact.
    const selected = componentsList.filter(
      (c) =>
        c.cx >= region.left &&
        c.cx < region.left + region.width &&
        c.cy >= region.top &&
        c.cy < region.top + region.height,
    );
    if (!selected.length)
      throw new Error(`No sprite components: ${prefix}/${names[i]}`);
    const ids = new Set(selected.map((c) => c.id));
    const l = Math.max(0, Math.min(...selected.map((c) => c.l)) - 2),
      r = Math.min(info.width - 1, Math.max(...selected.map((c) => c.r)) + 2),
      t = Math.max(0, Math.min(...selected.map((c) => c.t)) - 2),
      b = Math.min(info.height - 1, Math.max(...selected.map((c) => c.b)) + 2);
    const w = r - l + 1,
      h = b - t + 1,
      output = Buffer.alloc(w * h * 4);
    for (let yy = t; yy <= b; yy++)
      for (let xx = l; xx <= r; xx++) {
        const idx = yy * info.width + xx;
        let keep = ids.has(labels[idx]);
        if (!keep && data[idx * 4 + 3] > 0)
          for (const d of [
            -info.width - 1,
            -info.width,
            -info.width + 1,
            -1,
            1,
            info.width - 1,
            info.width,
            info.width + 1,
          ])
            if (ids.has(labels[idx + d])) {
              keep = true;
              break;
            }
        if (keep)
          data.copy(output, ((yy - t) * w + xx - l) * 4, idx * 4, idx * 4 + 4);
      }
    const trimmed = await sharp(output, {
      raw: { width: w, height: h, channels: 4 },
    })
      .png()
      .toBuffer();
    parts.push({ trimmed, w, h });
  }
  const scale = Math.min(
    (canvas[0] - 12) / Math.max(...parts.map((p) => p.w)),
    (canvas[1] - 12) / Math.max(...parts.map((p) => p.h)),
  );
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i],
      w = Math.round(p.w * scale),
      h = Math.round(p.h * scale);
    const file = `game/${prefix}/${names[i]}.png`;
    await mkdir(path.dirname(`${root}/${file}`), { recursive: true });
    const actor = /^(players|enemies|boss|bombs)\//.test(prefix + '/');
    await sharp({
      create: {
        width: canvas[0],
        height: canvas[1],
        channels: 4,
        background: '#00000000',
      },
    })
      .composite([
        {
          input: await sharp(p.trimmed).resize(w, h).toBuffer(),
          left: Math.round((canvas[0] - w) / 2),
          top: actor ? canvas[1] - 6 - h : Math.round((canvas[1] - h) / 2),
        },
      ])
      .png()
      .toFile(`${root}/${file}`);
    manifest[`${prefix}/${names[i]}`] = `/${file}`;
  }
  audit.push({
    sheet: sources[sheet - 1],
    prefix,
    frames: parts.length,
    alpha: meta.hasAlpha,
    canvas,
  });
}
const players = [
  [0, 0, 0.26, 0.345],
  [0.27, 0, 0.24, 0.345],
  ...[0, 0.25, 0.5, 0.75].map((x) => [x, 0.345, 0.25, 0.34]),
  ...[0, 0.2, 0.4, 0.6, 0.8].map((x) => [x, 0.685, 0.2, 0.315]),
];
for (const [i, c] of ['red', 'blue', 'purple', 'yellow'].entries())
  await group(i + 1, `players/${c}`, players, [
    'idle_01',
    'idle_02',
    'walk_01',
    'walk_02',
    'walk_03',
    'walk_04',
    'placeBomb_01',
    'placeBomb_02',
    'hurt_01',
    'death_01',
    'death_02',
  ]);
for (const [sheet, kinds] of [
  [5, ['slime', 'windup']],
  [6, ['fire_spirit', 'ghost']],
])
  for (let row = 0; row < 2; row++)
    await group(
      sheet,
      `enemies/${kinds[row]}`,
      [
        [0, 0.19, 0.17, 0.31],
        [0.17, 0.19, 0.16, 0.31],
        [0.33, 0.19, 0.16, 0.31],
        [0.49, 0.19, 0.15, 0.31],
        [0.64, 0.19, 0.2, 0.31],
        [0.84, 0.19, 0.16, 0.31],
      ].map(([x, y, w, h]) => [x, y + row * 0.41, w, h]),
      ['idle_01', 'idle_02', 'walk_01', 'walk_02', 'attack_01', 'death_01'],
      [320, 300],
    );
await group(
  7,
  'boss/bomb_forge',
  [
    ...[0, 0.26, 0.5, 0.75].map((x, i) => [
      x,
      0.04,
      i === 0 ? 0.26 : i === 1 ? 0.24 : 0.25,
      0.44,
    ]),
    ...[0, 0.26, 0.51, 0.76].map((x, i) => [
      x,
      0.49,
      i === 0 ? 0.26 : i === 3 ? 0.24 : 0.25,
      0.45,
    ]),
  ],
  [
    'idle_01',
    'idle_02',
    'walk_01',
    'walk_02',
    'attack1_01',
    'attack2_01',
    'hurt_01',
    'death_01',
  ],
  [384, 440],
);
for (let i = 0; i < 6; i++)
  await group(
    8,
    'items',
    [[(i % 3) / 3, Math.floor(i / 3) * 0.5, 1 / 3, 0.5]],
    ['bomb_up', 'fire_up', 'speed_up', 'kick', 'remote', 'shield'].slice(
      i,
      i + 1,
    ),
    [160, 160],
  );
await group(
  9,
  'bombs',
  [0, 0.25, 0.5, 0.75].map((x) => [x, 0, 0.25, 0.3]),
  ['idle_01', 'idle_02', 'fuse_01', 'fuse_02'],
  [192, 224],
);
for (const [name, box] of Object.entries({
  center: [0.04, 0.3, 0.24, 0.29],
  horizontal: [0.31, 0.3, 0.39, 0.29],
  vertical: [0.74, 0.3, 0.2, 0.3],
  end_up: [0.04, 0.59, 0.2, 0.2],
  end_down: [0.29, 0.59, 0.19, 0.2],
  end_left: [0.51, 0.59, 0.19, 0.2],
  end_right: [0.76, 0.59, 0.19, 0.2],
}))
  await group(9, 'effects/explosion', [box], [name], [256, 256]);
for (const [i, name] of [
  'block_break',
  'smoke',
  'smoke_end',
  'stun',
  'pickup',
].entries())
  await group(
    9,
    `effects/${name}`,
    [[i * 0.2, 0.79, 0.2, 0.21]],
    ['01'],
    [192, 192],
  );
for (const [i, name] of [
  'sand',
  'grass',
  'solid',
  'breakable',
  'spawn',
  'floor',
  'flowers',
  'gate',
].entries())
  await group(
    10,
    'tiles',
    [
      [
        [0.028, 0.085, 0.143, 0.197, 0.252, 0.311, 0.369, 0.436][i],
        0.025,
        [0.058, 0.058, 0.052, 0.056, 0.057, 0.057, 0.065, 0.112][i],
        0.14,
      ],
    ],
    [name],
    [128, 128],
  );
await group(10, 'hud', [[0.557, 0, 0.427, 0.177]], ['reference'], [800, 180]);
for (const [name, box] of Object.entries({
  garden: [0.014, 0.18, 0.321, 0.36],
  water: [0.347, 0.18, 0.309, 0.36],
  lava: [0.663, 0.18, 0.322, 0.36],
  ice: [0.031, 0.54, 0.435, 0.44],
  boss: [0.494, 0.54, 0.48, 0.44],
}))
  await group(10, 'maps', [box], [name], [800, 480]);
// Small flat floor samples from the supplied reference arenas; layouts are authored in code.
for (const [name, rect] of Object.entries({
  grass: [128, 230, 28, 20],
  water: [820, 238, 34, 23],
  lava: [1251, 241, 23, 38],
  ice: [450, 583, 23, 35],
  boss: [1200, 607, 33, 30],
  stone: [1216, 298, 23, 20],
})) {
  const [left, top, width, height] = rect,
    file = `game/tiles/${name}/floor.png`;
  await mkdir(path.dirname(`${root}/${file}`), { recursive: true });
  await sharp(`${root}/source/${sources[9]}`)
    .extract({ left, top, width, height })
    .resize(64, 64, { fit: 'fill' })
    .png()
    .toFile(`${root}/${file}`);
  manifest[`tiles/${name}/floor`] = `/${file}`;
}
await writeFile(`${root}/manifest.json`, JSON.stringify(manifest, null, 2));
await writeFile(`${root}/asset-audit.json`, JSON.stringify(audit, null, 2));
console.log(
  `Extracted ${Object.keys(manifest).length} transparent frames from ${sources.length} preserved sheets.`,
);
