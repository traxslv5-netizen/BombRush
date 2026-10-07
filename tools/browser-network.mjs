// Resolve the module used by the scene, including Vite's current HMR stamp.
export async function attachNetwork(page) {
  await page.evaluate(async () => {
    const source = await (await fetch('/src/scenes/GameScene.ts')).text();
    const url = source.match(
      /from "(\/src\/networking\/NetworkSystem\.ts[^"]*)"/,
    )?.[1];
    if (!url) throw new Error('Scene networking module not found');
    window.__testNetwork = (await import(url)).network;
  });
}
