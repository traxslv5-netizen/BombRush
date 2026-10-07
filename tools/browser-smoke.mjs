import { chromium } from '@playwright/test';
import { attachNetwork } from './browser-network.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({
  headless: true,
  args: [
    '--enable-webgl',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const errors = [];
const a = await browser.newPage({ viewport: { width: 1366, height: 768 } });
const b = await browser.newPage({ viewport: { width: 1366, height: 768 } });
for (const p of [a, b]) {
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
}
try {
  await a.goto('http://127.0.0.1:5173');
  await attachNetwork(a);
  await a.locator('#play').waitFor();
  await a.screenshot({ path: 'test-results/menu.png', fullPage: true });
  await a.locator('#play').click();
  await a.locator('#create-view').click();
  await a.locator('#nickname').fill('Alice');
  await a.locator('#create').click();
  await a.locator('#copy').waitFor();
  const code = (await a.locator('#copy').innerText()).match(
    /BR-[A-Z0-9]{6}/,
  )[0];
  await b.goto('http://127.0.0.1:5173');
  await attachNetwork(b);
  await b.locator('#multiplayer').click();
  await b.locator('#join-view').click();
  await b.locator('#nickname').fill('Bob');
  await b.locator('#room-code').fill(code);
  await b.locator('#join').click();
  await b.locator('#ready').waitFor();
  await b
    .locator('[data-color=red]')
    .isDisabled()
    .then((v) => {
      if (!v) throw new Error('Occupied color not locked');
    });
  await b.locator('#ready').click();
  await a.locator('#ready').click();
  await a.locator('#start:not([disabled])').waitFor();
  await a.screenshot({ path: 'test-results/lobby.png' });
  await a.locator('#start').click();
  await a.waitForFunction(async () => {
    const network = window.__testNetwork;
    return network.state?.phase === 'PLAYING';
  });
  await a.bringToFront();
  await a.locator('canvas').click({ position: { x: 10, y: 10 } });
  await a.keyboard.press('Space');
  await a.keyboard.down('ArrowDown');
  await a.waitForTimeout(480);
  await a.keyboard.up('ArrowDown');
  const state = await b.evaluate(async () => {
    const network = window.__testNetwork;
    return network.state;
  });
  if (!state.bombs.some((bomb) => bomb.owner === state.players[0].id)) {
    await a.screenshot({ path: 'test-results/input-failure.png' });
    console.log(JSON.stringify(state.players));
    throw new Error('Bomb was not synchronized in browser');
  }
  if (state.players[0].y < 1.5) throw new Error('Keyboard movement failed');
  await a.waitForTimeout(180);
  await a.screenshot({ path: 'test-results/game.png' });
  await b.screenshot({ path: 'test-results/game-client-2.png' });
  await a.waitForTimeout(2000);
  await a.screenshot({ path: 'test-results/explosion.png' });
  const session = await b.evaluate(() => window.__testNetwork.id);
  await b.evaluate(() =>
    window.__testNetwork.room.connection.close(
      4010,
      'browser reconnection test',
    ),
  );
  await b.waitForFunction(() => window.__testNetwork.status === 'RECONNECTING');
  await b.waitForFunction(() => window.__testNetwork.status === 'CONNECTED');
  if ((await b.evaluate(() => window.__testNetwork.id)) !== session)
    throw new Error('Reconnection changed identity');
  await b.keyboard.down('ArrowLeft');
  await b.waitForTimeout(250);
  await b.keyboard.up('ArrowLeft');
  await a.locator('#pause').click();
  await a.locator('#resume').waitFor();
  if (await a.evaluate(() => window.__testNetwork.state.paused))
    throw new Error('Multiplayer paused the server');
  await a.locator('#resume').click();
  await b.locator('#pause').click();
  await b.locator('#exit-game').click();
  await b.locator('#play').waitFor();
  await a.waitForFunction(
    () => window.__testNetwork.state.players.length === 1,
  );
  await a.locator('#pause').click();
  await a.locator('#resume').waitFor();
  await a.screenshot({ path: 'test-results/pause.png' });
  await a.waitForFunction(() => window.__testNetwork.state.paused);
  const pausedTime = await a.evaluate(() => window.__testNetwork.state.time);
  await a.waitForTimeout(250);
  if ((await a.evaluate(() => window.__testNetwork.state.time)) !== pausedTime)
    throw new Error('Solo pause did not freeze the server');
  await a.locator('#resume').click();
  await a.waitForFunction(() => !window.__testNetwork.state.paused);
  console.log(JSON.stringify({ code, errors }, null, 2));
  await writeFile(
    'test-results/browser-report.json',
    JSON.stringify(
      {
        code,
        errors,
        keyboardMovement: true,
        bombSync: true,
        colorLock: true,
        reconnect: true,
        multiplayerPersonalPause: true,
        soloServerPause: true,
      },
      null,
      2,
    ),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
