// UI screenshot probe (2026-10-11 (17), premium UI): node tools/probe-ui-v161.mjs OUT_DIR TAG
// ONE launch, phone viewport 390x664: fresh start, toast + cards, stall panel, exchange panel, a world plate near / far, night. Writes OUT_DIR/TAG-<state>.png and prints geometry
// (stat chips, cards, buttons) as JSON so before / after sizes can be compared.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, OLD_SAVE } from '../tests/lib/harness.mjs';
const OUT = path.resolve(process.argv[2] || '../shots'), TAG = process.argv[3] || 'ui';
fs.mkdirSync(OUT, { recursive: true });
const shot = async (page, name) => { await page.screenshot({ path: path.join(OUT, `${TAG}-${name}.png`) }); console.log('shot', name); };
const settle = (page, n = 12) => page.evaluate((n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); f(); setTimeout(r, 20000); }), n);
const geo = (page) => page.evaluate(() => {
  const ids = ['hud', 'moneyStat', 'nextCard', 'toast', 'actionBtn', 'actionPrompt', 'joyBase', 'jumpBtn', 'systemsBtn', 'compass', 'carryRouteV139', 'manualCoachV143', 'shiftGoalV127'];
  const o = {};
  for (const id of ids) { const el = document.getElementById(id); if (!el) continue; const r = el.getBoundingClientRect(); o[id] = { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), vis: getComputedStyle(el).display !== 'none' && !el.hidden }; }
  o.stats = [...document.querySelectorAll('#hud .stat')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  return o;
});
// 1. fresh start
let g = await openGame({ save: 'clear', waitMs: 6000 });
await settle(g.page, 20);
await shot(g.page, 'fresh');
console.log('geo-fresh', JSON.stringify(await geo(g.page)));
await g.page.evaluate(() => { toast('Помощь принята · ускорение 1.1с · энергия 2/3'); });
await settle(g.page, 10);
await shot(g.page, 'toast');
await g.close();
// 2. stage-1 save: market panels, plates, night
g = await openGame({ save: { ...OLD_SAVE, money: 100000, planks: 50, concrete: 5, metal: 5 }, waitMs: 6000 });
const { page } = g;
await page.evaluate(() => { try { toast('Помощь принята · ускорение 1.1с · энергия 2/3'); } catch (_) {} });
await settle(page, 10);
await shot(page, 'stage1-toast');
console.log('geo-stage1', JSON.stringify(await geo(page)));
await page.evaluate(() => { toast('Куплено'); });
await page.evaluate(() => window.openMarketTraderV119('team'));
await settle(page, 12); await shot(page, 'stall-team');
await page.evaluate(() => { const o = document.getElementById('systemsOverlay'); document.querySelector('#systemsOverlay .v30Close')?.click(); });
await settle(page, 6);
await page.evaluate(() => window.openMarketTraderV119('exchange'));
await settle(page, 12); await shot(page, 'exchange');
await page.evaluate(() => { document.getElementById('marketExchangeCloseV119')?.click(); document.querySelector('#systemsOverlay .v30Close')?.click(); });
await settle(page, 6);
// plates: stand near / far from a floating plate
const plate = await page.evaluate(() => {
  const list = []; scene.traverse((o) => { if (o.isSprite && o.userData && o.userData.v161Plate && o.visible) { const p = o.getWorldPosition(new THREE.Vector3()); list.push({ x: p.x, z: p.z, rows: o.userData.v161Plate.rows.map((r) => r.text) }); } });
  return list.slice(0, 6);
});
console.log('plates', JSON.stringify(plate));
if (plate.length) {
  const p = plate[0];
  await page.evaluate((p) => { player.position.set(p.x + 5, 0, p.z + 7); playerVelocity.set(0, 0, 0); }, p);
  await settle(page, 40); await shot(page, 'plate-near');
  await page.evaluate((p) => { player.position.set(p.x + 18, 0, p.z + 24); playerVelocity.set(0, 0, 0); }, p);
  await settle(page, 40); await shot(page, 'plate-far');
  await page.evaluate((p) => { v40State.timeOfDay = 22; player.position.set(p.x + 5, 0, p.z + 7); }, p);
  await settle(page, 60); await shot(page, 'night');
}
console.log('errors', JSON.stringify(g.errors.slice(0, 3)));
await g.close();
