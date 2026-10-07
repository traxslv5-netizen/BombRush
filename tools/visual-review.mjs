// Rendering fixtures only. The browser smoke and server tests verify real gameplay.
import { chromium } from '@playwright/test';
import { attachNetwork } from './browser-network.mjs';
import { Game } from '../apps/server/src/state/Game.ts';
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
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('http://127.0.0.1:5173');
  await page.waitForFunction(() => !document.getElementById('loading-status'));
  await attachNetwork(page);
  await page.screenshot({ path: 'test-results/menu-1920.png' });
  await page.locator('#settings').click();
  await page.locator('#volume-master').fill('35');
  await page.locator('#volume-master').dispatchEvent('input');
  if ((await page.locator('#value-master').innerText()) !== '35%')
    throw new Error('Settings did not update');
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement !== null);
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => document.fullscreenElement === null);
  await page.screenshot({ path: 'test-results/settings.png' });
  await page.locator('#settings-close').click();
  for (let stage = 0; stage < 5; stage++) {
    const game = new Game(() => 0.6);
    game.addPlayer('review', 'TRAX');
    game.addPlayer('blue', 'LUCAS');
    game.loadStage(stage);
    game.state.code = 'BR-REVIEW';
    game.state.time = stage + 1;
    game.state.players.forEach((p) => (p.invulnerability = 0));
    if (stage === 4) {
      game.state.boss.phase = 2;
      game.state.boss.hp = 30;
    }
    await page.evaluate((s) => {
      const network = window.__testNetwork;
      network.room = { sessionId: 'review', send() {} };
      network.state = s;
      network.status = 'CONNECTED';
      network.onSnapshot(s);
    }, game.state);
    await page.waitForFunction(
      (name) => document.getElementById('stage-name')?.textContent === name,
      game.state.stageName,
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: `test-results/stage-${stage + 1}-1920.png` });
    if (stage === 0) {
      for (const [width, height] of [
        [960, 540],
        [390, 844],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(200);
        await page.screenshot({ path: `test-results/game-${width}.png` });
      }
      await page.setViewportSize({ width: 1920, height: 1080 });
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(
    'test-results/visual-report.json',
    JSON.stringify(
      {
        errors,
        viewports: ['1920x1080', '960x540', '390x844'],
        stages: 5,
        settings: true,
        fullscreen: true,
        renderFixtures: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'Five stages, responsive layouts, settings and fullscreen rendered successfully.',
  );
} finally {
  await browser.close();
}
