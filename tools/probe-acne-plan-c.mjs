// Shadow-acne probe for plan C decks: stresses the sun's shadow (bias = normalBias = 0, optionally a smaller map) and renders the walk view of several ramps / hours
// with the deck shadow-depth push ON (the game) and OFF (customDepthMaterial removed), plus a reference with the decks not receiving shadow at all.
// Acne = pixels of the deck that differ from the no-receive reference although no other mesh shadows them: reported as the mean |diff| and the share of pixels > 12/255.
//   node tools/probe-acne-plan-c.mjs OUT [--bias=0] [--nbias=0] [--map=1024]
import fs from 'node:fs';
import path from 'node:path';
import { openGame } from '../tests/lib/harness.mjs';
const args = process.argv.slice(2), opt = (n, d) => { const a = args.find((s) => s.startsWith('--' + n + '=')); return a ? Number(a.split('=')[1]) : d; };
const out = path.resolve(args[0] || 'acne'); fs.mkdirSync(out, { recursive: true });
const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
const spots = [['r1', 1, 0.5], ['r0', 0, 0.3], ['r5', 5, 0.4], ['r9', 9, 0.5]];
const bad = [];
for (const hour of [9, 12, 16]) for (const [name, ramp, frac] of spots) {
  const r = await g.page.evaluate(async ({ hour, ramp, frac, bias, nbias, map }) => {
    try { __TYCOON_V40__.setTime(hour); } catch (_) {}
    const pts = PlanCDataV161.graph.ramps[ramp][2]; const i = Math.round(frac * (pts.length - 1)), a = pts[i - 1], b = pts[i + 1];
    let dx = b[0] - a[0], dz = b[1] - a[1]; const l = Math.hypot(dx, dz); dx /= l; dz /= l; const x = pts[i][0], z = pts[i][1], y = pts[i][2];
    PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(x, z); player.position.set(x, y, z); PlanCV161.level = y; for (let k = 0; k < 3; k++) updatePlayer(1 / 30);
    await new Promise((r) => setTimeout(r, 1200));
    sun.shadow.bias = bias; sun.shadow.normalBias = nbias; if (map && sun.shadow.mapSize.x !== map) { try { sun.shadow.map.dispose(); sun.shadow.map = null; } catch (_) {} sun.shadow.mapSize.set(map, map); }
    const cv = renderer.domElement, W = cv.width, H = cv.height;
    const cam = new THREE.PerspectiveCamera(50, W / H, 0.35, 500); cam.position.set(x - dx * 6.5, y + 4.5, z - dz * 6.5); cam.lookAt(x, y + 1, z); cam.updateMatrixWorld(true);
    const decks = []; PlanCV161.root.traverse((o) => { if (o.userData && o.userData.planCSolid) decks.push(o); });
    const shot = () => { sun.shadow.needsUpdate = true; renderer.shadowMap.needsUpdate = true; const sa = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = true; sun.shadow.autoUpdate = true; renderer.render(scene, cam); renderer.shadowMap.autoUpdate = sa; const c = document.createElement("canvas"); c.width = W; c.height = H; const cx = c.getContext("2d"); cx.drawImage(cv, 0, 0); return { url: c.toDataURL('image/png'), d: cx.getImageData(0, 0, W, H).data }; };
    const on = shot(); decks.forEach((m) => { m.customDepthMaterial = undefined; }); const off = shot(); decks.forEach((m) => { m.customDepthMaterial = PlanCV161.deckDepthMaterial; });
    decks.forEach((m) => { m.receiveShadow = false; }); const ref = shot(); decks.forEach((m) => { m.receiveShadow = true; });
    const m = (A) => { let s = 0, n = 0, hi = 0; for (let k = 0; k < A.d.length; k += 4) { const d = Math.abs(A.d[k] - ref.d[k]) + Math.abs(A.d[k + 1] - ref.d[k + 1]) + Math.abs(A.d[k + 2] - ref.d[k + 2]); s += d; n++; if (d > 36) hi++; } return { mean: s / n / 3, hi: hi / n }; };
    return { on: m(on), off: m(off), urlOn: on.url, urlOff: off.url };
  }, { hour, ramp, frac, bias: opt('bias', 0), nbias: opt('nbias', 0), map: opt('map', 0) });
  console.log(`${name} h${hour}: push ON mean ${r.on.mean.toFixed(2)} hi ${(r.on.hi * 100).toFixed(2)}%   push OFF mean ${r.off.mean.toFixed(2)} hi ${(r.off.hi * 100).toFixed(2)}%`);
  fs.writeFileSync(path.join(out, `${name}-h${hour}-on.png`), Buffer.from(r.urlOn.split(',')[1], 'base64')); fs.writeFileSync(path.join(out, `${name}-h${hour}-off.png`), Buffer.from(r.urlOff.split(',')[1], 'base64'));
}
console.log('errors', g.errors.slice(0, 3));
await g.close();
