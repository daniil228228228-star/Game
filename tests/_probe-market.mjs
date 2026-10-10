import { openGame, OLD_SAVE, jumpStage } from './lib/harness.mjs';
const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
await jumpStage(page, 8);
await ev(() => { money = 200000; planks = 500; concrete = 200; metal = 200; });
await page.waitForTimeout(1500);
// A. plates over 60 frames
const plates = await ev(() => new Promise((res) => {
  const ids = MARKET_STALLS_V116.map(c => c.id);
  const snap = () => ids.map(id => { const s = marketRuntimeV116.stalls.get(id); return s ? { id, info: s.infoSign.material.map.uuid, sign: s.sign.material.map.uuid, iv: s.infoSign.visible, sv: s.sign.visible, io: s.infoSign.material.opacity, ip: s.infoSign.parent === s.group } : { id, missing: 1 }; });
  const first = JSON.stringify(snap()); let n = 0, changed = 0, tex = new Set(), dt = [];
  let last = performance.now();
  const loop = () => { const now = performance.now(); dt.push(now - last); last = now; const cur = JSON.stringify(snap()); if (cur !== first) { changed++; } n++; if (n < 60) requestAnimationFrame(loop); else res({ n, changed, avgDt: dt.reduce((a, b) => a + b, 0) / dt.length, first: JSON.parse(first) }); };
  requestAnimationFrame(loop);
}));
console.log('PLATES', JSON.stringify(plates));
// materials in stall
const mats = await ev(() => { const out = {}; for (const [id, s] of marketRuntimeV116.stalls) { const list = []; s.group.traverse(o => { if (o.isMesh) { const m = o.material; list.push([m.type, +(m.roughness ?? -1).toFixed(2), +(m.metalness ?? -1).toFixed(2), m.envMap ? 1 : 0, +(m.emissiveIntensity || 0).toFixed(2), m.transparent ? 1 : 0, m.opacity]); } }); out[id] = list; } return out; });
console.log('MATS', JSON.stringify(mats));
// B. press real action at fleet stall
await ev(() => { const cfg = MARKET_STALLS_V116.find(c => c.id === 'fleet'); const dir = new THREE.Vector3(MARKET_PLAZA_CENTER_V116.x - cfg.pos.x, 0, MARKET_PLAZA_CENTER_V116.z - cfg.pos.z).normalize(); player.position.copy(cfg.pos).addScaledVector(dir, 1.6); });
const act = await page.waitForFunction(() => { const b = document.getElementById('actionBtn'); const fo = document.getElementById('fleetOverlay'); if (fo?.classList.contains('show')) return { opened: true }; if (b && !b.hidden && !b.disabled) b.click(); return false; }, null, { timeout: 30000, polling: 'raf' }).then(h => h.jsonValue(), () => ({ opened: false }));
console.log('OPEN fleet', JSON.stringify(act));
await page.screenshot({ path: '/tmp/claude-0/-home-user/6299527b-4dd8-58b8-80c7-5674d93838ab/scratchpad/fleet-open.png' });
const info = await ev(() => { const fo = document.getElementById('fleetOverlay'); const r = fo.getBoundingClientRect(); const grid = document.getElementById('fleetGrid'); const sc = []; let e = grid; while (e && e !== document.body) { if (e.scrollHeight > e.clientHeight + 2) sc.push([e.id || e.className, e.scrollHeight, e.clientHeight]); e = e.parentElement; } return { rect: [r.x, r.y, r.width, r.height], scrollers: sc, kids: grid.children.length, html: grid.innerHTML.length, innerW: innerWidth, innerH: innerHeight, btns: [...fo.querySelectorAll('button')].length }; });
console.log('PANEL', JSON.stringify(info));
// mutation count + scroll
const mut = await ev(() => new Promise((res) => {
  const fo = document.getElementById('fleetOverlay'); let nm = 0, added = 0;
  const mo = new MutationObserver(l => { nm += l.length; for (const m of l) added += m.addedNodes.length; }); mo.observe(fo, { childList: true, subtree: true });
  const sc = [...fo.querySelectorAll('*')].find(e => e.scrollHeight > e.clientHeight + 20 && getComputedStyle(e).overflowY !== 'visible') || fo;
  sc.scrollTop = 250; const s0 = sc.scrollTop; let resets = 0, samples = 0;
  const t0 = performance.now();
  const iv = setInterval(() => { samples++; if (sc.scrollTop < s0 - 5) { resets++; sc.scrollTop = 250; } if (performance.now() - t0 > 4000) { clearInterval(iv); mo.disconnect(); res({ nm, added, sc: sc.id || sc.className, s0, resets, samples }); } }, 50);
}));
console.log('MUT 4s', JSON.stringify(mut));
// C. taps on buttons while rebuild running
const btns = await ev(() => [...document.querySelectorAll('#fleetOverlay button')].filter(b => !b.disabled).map(b => (b.id || b.dataset.v119Buy || b.dataset.fleet || b.textContent.slice(0, 20))).slice(0, 12));
console.log('BTNS', JSON.stringify(btns));
let clicked = 0, tries = 12;
await ev(() => { window.__clicks = 0; document.getElementById('fleetOverlay').addEventListener('click', () => window.__clicks++, true); });
for (let i = 0; i < tries; i++) {
  const box = await ev(() => { const b = [...document.querySelectorAll('#fleetOverlay button')].find(b => !b.disabled && b.getBoundingClientRect().height > 10); if (!b) return null; b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, t: b.textContent.slice(0, 20) }; });
  if (!box) break;
  await page.touchscreen.tap(box.x, box.y);
  await page.waitForTimeout(120);
}
console.log('TAP clicks', await ev(() => window.__clicks), 'of', tries);
// close: how
await ev(() => { document.querySelectorAll('#fleetOverlay [id*=lose], #fleetOverlay .v30Close').forEach(b => b.dataset.x = 1); });
console.log('CLOSEBTN', JSON.stringify(await ev(() => [...document.querySelectorAll('#fleetOverlay .v30Close,#fleetOverlay [id*=Close]')].map(b => b.id + '/' + b.className))));
console.log('ERR', JSON.stringify(g.errors.slice(0, 5)), g.badResponses.length);
await g.close();
