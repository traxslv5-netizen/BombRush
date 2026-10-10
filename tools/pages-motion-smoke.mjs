import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

// Exercises the untouched published bundle through real keyboard input.
const url = 'https://traxslv5-netizen.github.io/BombRush/';
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [], results = {};
await mkdir('test-results/pages-motion', { recursive: true });
const pages = [];
async function client() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: {dir: 'test-results/pages-motion', size: {width: 1280, height: 900}} });
  const page = await context.newPage();
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response', r=>{if(r.status()>=400) errors.push(`${r.status()} ${r.url().split('?')[0]}`);});
  await page.goto(url);
  await page.waitForFunction(()=>!document.getElementById('loading-status'));
  pages.push(page); return page;
}
try {
  const a=await client();
  results.bundle=await a.locator('script[type="module"]').getAttribute('src');
  await a.locator('#multiplayer').click(); await a.locator('#create-view').click();
  await a.locator('#nickname').fill('Public P1'); await a.locator('#create').click();
  await a.locator('#copy').waitFor(); const code=await a.locator('#copy strong').textContent();
  const b=await client(); await b.locator('#multiplayer').click(); await b.locator('#join-view').click();
  await b.locator('#nickname').fill('Public P2'); await b.locator('#room-code').fill(code);
  await b.locator('#join').click(); await b.locator('#ready').waitFor();
  await b.locator('#ready').click(); await a.locator('#ready').click(); await a.locator('#start:not([disabled])').click();
  for(const p of pages) await p.waitForFunction(()=>document.getElementById('overlay')?.textContent==='');
  for(let i=0;i<2;i++) {
    const mover=pages[i],observer=pages[1-i]; await mover.bringToFront();
    const keys=i===0?['KeyD','KeyA']:['KeyA','KeyD'];
    const start=Date.now();
    for(let lap=0;lap<9;lap++) for(const key of keys) {
      await mover.keyboard.down(key); await mover.waitForTimeout(1200); await mover.keyboard.up(key);
      await expect(mover.locator('#stage-number')).toBeVisible();
      if(lap===3) await observer.screenshot({path:`test-results/pages-motion/observed-p${i+1}.png`});
    }
    results[`p${i+1}MovementMs`]=Date.now()-start;
    await expect(observer.locator('#connection')).toContainText('ONLINE');
    await expect(mover.locator('#overlay')).toBeEmpty();
  }
  await b.keyboard.press('Space');
  await b.waitForTimeout(500);
  await a.screenshot({path:'test-results/pages-motion/published-two-players.png'});
  results.hostTimer=await a.locator('#timer').textContent();
  results.guestTimer=await b.locator('#timer').textContent();
  await a.locator('#pause').click(); await a.locator('#exit-game').click(); await b.locator('#play').waitFor();
  results.hostDeparture=true;
  expect(errors).toEqual([]);
} catch(e) {console.error(e);process.exitCode=1;}
finally {
  for(let i=0;i<pages.length;i++) await pages[i].context().close();
  await browser.close();
  await writeFile('test-results/pages-motion/report.json',JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({results,errors},null,2));
}
