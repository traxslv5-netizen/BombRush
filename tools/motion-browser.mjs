import { chromium, expect } from '@playwright/test';
import { attachNetwork } from './browser-network.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ],
});
const pages = [],
  errors = [],
  results = [];
await mkdir('test-results', { recursive: true });
async function client() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const p = await context.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await p.goto('http://127.0.0.1:5174');
  await attachNetwork(p);
  await p.waitForFunction(() => !document.getElementById('loading-status'));
  await p.evaluate(async () => {
    const source = await (await fetch('/src/main.ts')).text();
    const sceneUrl = source.match(/from "(\/src\/scenes\/GameScene\.ts[^"]*)"/)?.[1];
    if (!sceneUrl) throw new Error('Active scene module not found');
    const { GameScene } = await import(sceneUrl);
    const original = GameScene.prototype.actor;
    window.__motionRows = [];
    window.__captureId = '';
    let lastAt = 0,
      lastX = 0,
      lastY = 0,
      oldX = 0,
      oldY = 0,
      lastDirection = '',
      changedAt = 0,
      lastSprite;
    GameScene.prototype.actor = function (a, prefix, height, dt, buffered) {
      // Reduce raster cost for four simultaneous software-WebGL contexts.
      // World positions, simulation, input and network rate are unchanged.
      if (!window.__resolutionSet) {
        this.scale.setGameSize(640, 450);
        this.cameras.main.setZoom(0.5).setScroll(320, 225);
        window.__resolutionSet = true;
      }
      original.call(this, a, prefix, height, dt, buffered);
      if (a.id !== window.__captureId) return;
      const now = performance.now(),
        sprite = this.objects.get(a.id);
      const auth = window.__testNetwork.state.players.find(
        (p) => p.id === a.id,
      );
      if (!auth) return;
      // Derive pixel origin from the actual scene, not a second rendering path.
      // px differences depend only on tile size, exported by ArenaPresentation below.
      const tx = window.__px(auth.x),
        ty = window.__py(auth.y) + 25;
      if (!lastAt || now - lastAt > 200 || lastDirection !== auth.direction) {
        changedAt = now;
        oldX = tx;
        oldY = ty;
      }
      const elapsed = now - lastAt,
        blend = 1 - Math.exp(-elapsed / 48);
      const beforeX = oldX,
        beforeY = oldY;
      oldX += (tx - oldX) * blend;
      oldY += (ty - oldY) * blend;
      if (
        lastAt &&
        elapsed > 0 &&
        elapsed < 250 &&
        now - changedAt > 500 &&
        auth.action === 'walk'
      ) {
        window.__motionRows.push({
          dt: elapsed,
          speed:
            (Math.hypot(sprite.x - lastX, sprite.y - lastY) / elapsed) * 1000,
          oldSpeed:
            (Math.hypot(oldX - beforeX, oldY - beforeY) / elapsed) * 1000,
          buffered,
          spriteStable: !lastSprite || lastSprite === sprite,
          direction: a.direction,
          interval: window.__testNetwork.debug.snapshotIntervalMs,
          rtt: window.__testNetwork.debug.rttMs,
          delay: window.__testNetwork.remoteMotion.delayMs,
          cursor: window.__testNetwork.remoteMotion.cursor,
          latest: window.__testNetwork.remoteMotion.latest,
          history: window.__testNetwork.remoteMotion.tracks.get(a.id)?.samples.map(s=>[s.time,s.x,s.y]),
        });
      }
      lastAt = now;
      lastX = sprite.x;
      lastY = sprite.y;
      lastDirection = auth.direction;
      lastSprite = sprite;
    };
    const arena = await import('/src/systems/ArenaPresentation.ts');
    window.__px = arena.px;
    window.__py = arena.py;
  });
  pages.push(p);
  return p;
}
async function join(p, code, n) {
  await p.locator('#multiplayer').click();
  await p.locator('#join-view').click();
  await p.locator('#nickname').fill(`Motion ${n}`);
  await p.locator('#room-code').fill(code);
  await p.locator('#join').click();
  await p.locator('#ready').waitFor();
}
const cv = (a) => {
  const mean = a.reduce((n, v) => n + v, 0) / a.length;
  return {
    mean,
    cv: Math.sqrt(a.reduce((n, v) => n + (v - mean) ** 2, 0) / a.length) / mean,
  };
};
async function measure(mover, observers, label) {
  const id = await mover.evaluate(() => window.__testNetwork.id);
  for (const p of observers)
    await p.evaluate((id) => {
      window.__captureId = id;
      window.__motionRows = [];
    }, id);
  await mover.bringToFront();
  await pages[0].evaluate((id) => {
    const g = window.__testNetwork.localGame,
      p = g.state.players.find((p) => p.id === id);
    p.x = 3;
    p.y = 3;
    g.inputs.clear();
  }, id);
  for (let lap = 0; lap < 4; lap++)
    for (const key of ['KeyD', 'KeyS', 'KeyA', 'KeyW']) {
      await mover.keyboard.down(key);
      await mover.waitForTimeout(1300);
      await mover.keyboard.up(key);
    }
  for (let i = 0; i < observers.length; i++) {
    const rows = await observers[i].evaluate(() => {
      window.__captureId = '';
      return window.__motionRows;
    });
    await writeFile(`test-results/motion-rows-${results.length}.json`, JSON.stringify(rows));
    expect(rows.length).toBeGreaterThan(40);
    const smooth = cv(rows.map((r) => r.speed)),
      old = cv(rows.map((r) => r.oldSpeed));
    expect(rows.every((r) => r.buffered && r.spriteStable)).toBe(true);
    results.push({
      label,
      observer: i,
      frames: rows.length,
      smooth,
      old,
      rttMs: rows.at(-1).rtt,
      bufferMs: rows.at(-1).delay,
    });
    console.log(JSON.stringify(results.at(-1)));
    expect(smooth.cv).toBeLessThan(old.cv * 0.65);
  }
}
try {
  const host = await client();
  await host.locator('#multiplayer').click();
  await host.locator('#create-view').click();
  await host.locator('#nickname').fill('Motion 1');
  await host.locator('#create').click();
  await host.locator('#copy').waitFor();
  const code = await host.evaluate(() => window.__testNetwork.state.code);
  const guest = await client();
  await join(guest, code, 2);
  for (const p of pages) await p.locator('#ready').click();
  await host.locator('#start:not([disabled])').click();
  for (const p of pages)
    await p.waitForFunction(
      () => window.__testNetwork.state?.phase === 'PLAYING',
    );
  const fixture = async () =>
    host.evaluate(() => {
      const s = window.__testNetwork.localGame.state;
      s.enemies = [];
      s.bombs = [];
      s.blasts = [];
      for (const p of s.players) p.invulnerability = s.time + 999;
      for (let y = 1; y < 10; y++)
        for (let x = 1; x < 14; x++) s.grid[y][x] = 0;
    });
  await fixture();
  if (!process.env.ONLY_FOUR) {
    await measure(host, [guest], '2 players: P1 observed by P2, 20.8 seconds');
    await measure(guest, [host], '2 players: P2 observed by P1, 20.8 seconds');
  }
  // Return only the authoritative room to its lobby to admit P3/P4.
  await host.evaluate(() => {
    const n = window.__testNetwork;
    n.localGame.state.phase = 'LOBBY';
    n.localGame.state.players.forEach((p) => (p.ready = false));
    n.publishLocal(true);
  });
  for (let n = 3; n <= 4; n++) await join(await client(), code, n);
  for (const p of pages) await p.locator('#ready').click();
  await host.locator('#start:not([disabled])').click();
  for (const p of pages)
    await p.waitForFunction(
      () => window.__testNetwork.state?.phase === 'PLAYING',
    );
  await fixture();
  // Explicit packet-delay fixture: real Supabase messages receive 60–85 ms extra transit.
  await pages[3].evaluate(() => {
    const n = window.__testNetwork,
      original = n.receivePeer.bind(n);
    let i = 0;
    n.receivePeer = (m) =>
      m.type === 'snapshot'
        ? setTimeout(() => original(m), 60 + [0, 25, 5, 20][i++ % 4])
        : original(m);
  });
  for (let i = 0; i < 4; i++)
    await measure(
      pages[i],
      pages.filter((_, j) => j !== i),
      `4 players: P${i + 1}, 20.8 seconds`,
    );
  await pages[3].screenshot({ path: 'test-results/motion-four-players.png' });
  expect(errors).toEqual([]);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/motion-browser.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
