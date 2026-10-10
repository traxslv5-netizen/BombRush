import { chromium, expect } from '@playwright/test';
import { attachNetwork } from './browser-network.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.env.TEST_URL || 'http://127.0.0.1:5174';
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
const errors = [],
  results = {};
await mkdir('test-results', { recursive: true });
const pages = [];
const state = (p) =>
  p.evaluate(() => structuredClone(window.__testNetwork.state));
async function newClient() {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await attachNetwork(page);
  await page.waitForFunction(() => !document.getElementById('loading-status'));
  pages.push(page);
  return page;
}
async function join(page, code, nickname) {
  await page.locator('#multiplayer').click();
  await page.locator('#join-view').click();
  await page.locator('#room-code').fill(code);
  await page.locator('#nickname').fill(nickname);
  await page.locator('#join').click();
  await page.locator('#ready').waitFor();
}
async function finishObjective(host) {
  // Fixture at the authoritative boundary: exercise the real objective rules and
  // transition clock, never tell any guest to load a level or inject guest state.
  await host.evaluate(() => {
    const n = window.__testNetwork,
      g = n.localGame,
      s = g.state;
    for (const p of s.players) {
      p.invulnerability = s.time + 100;
      p.alive = true;
    }
    for (const e of s.enemies) e.alive = false;
    for (const point of s.objective.points) {
      point.hidden = false;
      s.grid[point.y][point.x] = 0;
      const p = s.players[0];
      p.x = point.x;
      p.y = point.y;
      if (point.kind === 'core') {
        for (let hit = 0; hit < 2; hit++) {
          point.hitUntil = 0;
          g.addBlast(point.x, point.y, 'center', p.id);
          g.tick(0.1);
        }
      } else {
        for (let step = 0; step < 17; step++) g.tick(0.1);
      }
    }
    s.blasts = [];
    for (const p of s.players) {
      p.x = s.exit.x;
      p.y = s.exit.y;
    }
    // Two completion ticks at the same boundary must not skip a stage.
    g.tick(1 / 30);
    g.tick(1 / 30);
    n.publishLocal(true);
  });
}
try {
  const a = await newClient();
  await a.locator('#multiplayer').click();
  await a.locator('#create-view').click();
  const name = a.locator('#nickname');
  await name.fill('');
  await name.pressSequentially('TRAX 2026');
  await name.press('Backspace');
  await name.pressSequentially('6');
  await expect(name).toHaveValue('TRAX 2026');
  await name.press('Control+a');
  await name.pressSequentially('WASD 2026');
  await expect(name).toHaveValue('WASD 2026');
  await name.press('Home');
  await name.press('Delete');
  await name.press('End');
  await name.pressSequentially(' ');
  await name.press('Backspace');
  await expect(name).toHaveValue('ASD 2026');
  await name.fill('TRAX 2026');
  results.nickname =
    'physical typing, space, Backspace, Ctrl+A, Home, Delete, End passed';
  await a.locator('#create').click();
  await a.locator('#copy').waitFor();
  const code = (await state(a)).code;
  for (let i = 1; i < 4; i++)
    await join(await newClient(), code, `Player ${i + 1}`);
  const b = pages[1];
  for (const p of pages) await p.locator('#ready').click();
  await a.locator('#start:not([disabled])').click();
  for (const p of pages)
    await p.waitForFunction(
      () => window.__testNetwork.state?.phase === 'PLAYING',
    );
  results.fourPlayers = true;
  // Isolate keyboard from map obstructions while retaining the real simulation/input path.
  await a.evaluate(() => {
    const s = window.__testNetwork.localGame.state;
    for (const p of s.players) p.invulnerability = s.time + 999;
    for (const e of s.enemies) e.alive = false;
    for (let y = 3; y <= 7; y++) for (let x = 5; x <= 9; x++) s.grid[y][x] = 0;
  });
  for (const key of [
    'KeyW',
    'KeyA',
    'KeyS',
    'KeyD',
    'ArrowUp',
    'ArrowLeft',
    'ArrowDown',
    'ArrowRight',
  ]) {
    await a.evaluate(() => {
      const g = window.__testNetwork.localGame;
      g.inputs.clear();
      g.state.players[0].x = 7;
      g.state.players[0].y = 5;
    });
    await a.bringToFront();
    await a.keyboard.down(key);
    await a.waitForTimeout(140);
    await a.keyboard.up(key);
    const p = (await state(a)).players[0];
    const direction =
      key === 'KeyW' || key === 'ArrowUp'
        ? p.y < 4.9
        : key === 'KeyS' || key === 'ArrowDown'
          ? p.y > 5.1
          : key === 'KeyA' || key === 'ArrowLeft'
            ? p.x < 6.9
            : p.x > 7.1;
    if (!direction)
      throw new Error(`Physical keyboard failed: ${key} at ${p.x},${p.y}`);
  }
  for (const [one, two] of [
    ['KeyW', 'KeyA'],
    ['KeyW', 'KeyD'],
    ['KeyS', 'KeyA'],
    ['KeyS', 'KeyD'],
  ]) {
    await a.keyboard.down(one);
    await a.keyboard.down(two);
    await a.waitForTimeout(70);
    await a.keyboard.up(two);
    await a.keyboard.up(one);
  }
  await a.keyboard.down('KeyD');
  await a.waitForTimeout(80);
  await a.evaluate(() => window.dispatchEvent(new Event('blur')));
  await a.keyboard.up('KeyD');
  const stopped = (await state(a)).players[0];
  await a.waitForTimeout(200);
  const later = (await state(a)).players[0];
  expect([later.x, later.y]).toEqual([stopped.x, stopped.y]);
  await a.evaluate(() => window.dispatchEvent(new Event('focus')));
  results.keyboard = 'WASD, arrows, WA/WD/SA/SD, release, window blur passed';
  // Focus a real editable element over active gameplay to test focus isolation.
  await a.evaluate(() => {
    const input = document.createElement('input');
    input.id = 'focus-regression';
    input.style = 'position:fixed;z-index:9999;top:200px';
    document.body.append(input);
  });
  const typing = a.locator('#focus-regression');
  await typing.click();
  const beforeTyping = (await state(a)).players[0];
  await typing.pressSequentially('wasd TRAX 2026');
  await typing.press('ArrowLeft');
  await typing.press('Backspace');
  const afterTyping = (await state(a)).players[0];
  expect([afterTyping.x, afterTyping.y]).toEqual([
    beforeTyping.x,
    beforeTyping.y,
  ]);
  await a.evaluate(() => document.getElementById('focus-regression').remove());
  results.focus = true;
  await a.keyboard.press('Space');
  await b.waitForFunction(() => window.__testNetwork.state.bombs.length > 0);
  results.bombSync = true;
  await a.locator('#pause').click();
  await a.locator('#resume').click();
  results.menuRecovery = true;
  const staleSnapshot = await state(a);
  for (let stage = 1; stage <= 4; stage++) {
    await finishObjective(a);
    for (const p of pages)
      await p.waitForFunction(
        (next) => {
          const s = window.__testNetwork.state;
          return s.stage === next && s.phase === 'PLAYING';
        },
        stage,
        { timeout: 20000 },
      );
    const snapshots = await Promise.all(pages.map(state));
    expect(new Set(snapshots.map((s) => s.stageRevision)).size).toBe(1);
    for (const s of snapshots) {
      expect(s.stage).toBe(stage);
      expect(s.grid).toEqual(snapshots[0].grid);
      expect(s.objective).toEqual(snapshots[0].objective);
    }
    results[`stage${stage}_to_${stage + 1}`] = true;
    if (stage === 1) {
      await a.evaluate(async (old) => {
        const n = window.__testNetwork;
        await n.channel.send({
          type: 'broadcast',
          event: 'room',
          payload: { type: 'snapshot', from: n.id, sequence: 0, payload: old },
        });
      }, staleSnapshot);
      await b.waitForTimeout(400);
      expect((await state(b)).stage).toBe(1);
      results.staleSnapshotRejected = true;
    }
    if (stage === 2) {
      const oldId = await b.evaluate(() => window.__testNetwork.id);
      await b.reload();
      await attachNetwork(b);
      await b.locator('#multiplayer').click();
      await b.locator('#join-view').click();
      await b.locator('#room-code').fill(code);
      await b.locator('#nickname').fill('Player 2');
      await b.locator('#join').click();
      await b.waitForFunction(
        () =>
          window.__testNetwork.state?.stage === 2 &&
          window.__testNetwork.status === 'CONNECTED',
      );
      expect(await b.evaluate(() => window.__testNetwork.id)).toBe(oldId);
      results.reconnectStage3 = true;
      await b.evaluate(() => window.__testNetwork.channel.socket.disconnect());
      await b.waitForFunction(
        () => window.__testNetwork.status === 'RECONNECTING',
        null,
        { timeout: 10000 },
      );
      await b.evaluate(() => window.__testNetwork.channel.socket.connect());
      await b.waitForFunction(
        () =>
          window.__testNetwork.status === 'CONNECTED' &&
          window.__testNetwork.state.stage === 2,
      );
      results.socketReconnectStage3 = true;
    }
  }
  await a.screenshot({ path: 'test-results/coop-host-stage5.png' });
  await b.screenshot({ path: 'test-results/coop-guest-stage5.png' });
  // Seed boss defeat on the authority to exercise victory/restart replication.
  await a.evaluate(() => {
    const g = window.__testNetwork.localGame;
    g.state.boss.hp = 0;
    g.state.boss.alive = false;
    g.state.transitionAt = g.state.time + 0.1;
  });
  for (const p of pages)
    await p.waitForFunction(
      () => window.__testNetwork.state.phase === 'VICTORY',
    );
  await a.locator('#restart').click();
  for (const p of pages)
    await p.waitForFunction(
      () =>
        window.__testNetwork.state.stage === 0 &&
        window.__testNetwork.state.phase === 'PLAYING',
    );
  results.restart = true;
  await b.locator('#pause').click();
  await b.locator('#exit-game').click();
  await b.locator('#play').waitFor();
  await a.waitForFunction(
    () => window.__testNetwork.state.players.length === 3,
  );
  results.leave = true;
  await a.locator('#pause').click();
  await a.locator('#exit-game').click();
  await pages[2].locator('#play').waitFor();
  results.hostDeparture = true;
  await b.locator('#play').click();
  await b.locator('#solo').click();
  await b.locator('#nickname').fill('Solo Áção');
  await b.locator('#create').click();
  await b.waitForFunction(
    () => window.__testNetwork.state?.phase === 'PLAYING',
  );
  const firstSolo = await state(b);
  expect(firstSolo.code).toBe('SOLO');
  await b.locator('#pause').click();
  await b.locator('#exit-game').click();
  await b.locator('#play').click();
  await b.locator('#solo').click();
  await b.locator('#create').click();
  await b.waitForFunction(
    () => window.__testNetwork.state?.phase === 'PLAYING',
  );
  expect((await state(b)).players[0].id).not.toBe(firstSolo.players[0].id);
  results.repeatedSolo = true;
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ results, errors }, null, 2));
} catch (error) {
  for (let i = 0; i < pages.length; i++)
    await pages[i]
      .screenshot({ path: `test-results/coop-failure-${i}.png` })
      .catch(() => {});
  console.error(error);
  console.log(JSON.stringify({ results, errors }, null, 2));
  process.exitCode = 1;
} finally {
  await writeFile(
    'test-results/cooperative-browser.json',
    JSON.stringify({ results, errors }, null, 2),
  );
  await browser.close();
}
