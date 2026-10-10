import { openGame, OLD_SAVE, jumpStage } from './lib/harness.mjs';
const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
await jumpStage(page, 8);
await ev(() => { money = 200000; planks = 500; concrete = 200; metal = 200; });
await page.waitForTimeout(1000);
await ev(() => window.openMarketTraderV119('fleet'));
await page.waitForTimeout(1500);
const cdp = await page.context().newCDPSession(page);
await ev(() => { window.__clicks = 0; window.__downs = 0; const fo = document.getElementById('fleetOverlay'); fo.addEventListener('click', () => window.__clicks++, true); fo.addEventListener('pointerdown', () => window.__downs++, true); });
const hold = async (x, y, ms) => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await page.waitForTimeout(ms); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); };
for (const ms of [60, 150, 250]) {
  await ev(() => { window.__clicks = 0; window.__downs = 0; });
  const N = 15;
  for (let i = 0; i < N; i++) {
    const box = await ev(() => { const b = [...document.querySelectorAll('#fleetOverlay button')].find(b => !b.disabled && b.textContent.includes('1 units')) || [...document.querySelectorAll('#fleetOverlay button')].find(b => !b.disabled); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await hold(box.x, box.y, ms);
    await page.waitForTimeout(90 + (i * 37) % 200);
  }
  console.log('HOLD', ms, 'downs', await ev(() => window.__downs), 'clicks', await ev(() => window.__clicks), 'of', N);
}
await g.close();
