// Gap probe (2026-10-19): the player-camera view (phone, 390x664) from many standing places on / beside every ramp and deck of the interchanges; counts SKY-coloured pixels in the lower part of the picture
// (the horizon of the plan C world sits above 45 % of the height; sky below that line = a gap / hole in the geometry).  node tools/probe-gaps-plan-c.mjs OUT_DIR [--step 14]
import fs from 'node:fs';
import path from 'node:path';
import { openGame } from '../tests/lib/harness.mjs';
const out = path.resolve(process.argv[2] || 'gaps'); fs.mkdirSync(out, { recursive: true });
const step = Number((process.argv.find((a) => a.startsWith('--step=')) || '--step=16').split('=')[1]);
const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
const spots = await g.page.evaluate((step) => {
  const D = PlanCDataV161, L = [];
  for (const [ic, kind, pts] of D.graph.ramps) { let acc = 0; for (let i = 1; i < pts.length - 1; i++) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc >= step) { acc = 0; const a = pts[i - 1], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    L.push({ tag: `${ic}.${kind}@${pts[i][0].toFixed(0)},${pts[i][1].toFixed(0)}`, on: [pts[i][0], pts[i][2], pts[i][1]], dir: [dx / l, dz / l], h: pts[i][2] }); } } }
  return L;
}, step);
const bad = [];
for (const s of spots) {
  for (const mode of ['on', 'beside']) {
    const r = await g.page.evaluate(async ({ s, mode }) => {
      const [x, y, z] = s.on, [dx, dz] = s.dir; let px = x, pz = z, py = y;
      if (mode === 'beside') { px = x + -dz * 6.5; pz = z + dx * 6.5; py = 0; }
      PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(px, pz); player.position.set(px, py, pz); playerVelocity.set(0, 0, 0); PlanCV161.level = mode === 'on' ? y : 0;
      for (let i = 0; i < 2; i++) updatePlayer(1 / 30);
      const sign = mode === 'on' ? -1 : 1, cx = px - dx * 9 * sign, cz = pz - dz * 9 * sign;   // behind the player (looking along the ramp) / from the side
      const cam = new THREE.PerspectiveCamera(50, 390 / 664, 0.35, 900); const base = mode === 'on' ? y : 0;
      if (mode === 'on') cam.position.set(px - dx * 9, base + 7, pz - dz * 9); else cam.position.set(px + -dz * 7, base + 4, pz + dx * 7);
      cam.lookAt(px, base + 1, pz); cam.updateMatrixWorld(true);
      const cv = renderer.domElement; const oldSize = renderer.getSize(new THREE.Vector2()); renderer.setSize(390, 664, false); const fog = scene.fog; renderer.render(scene, cam);
      const url = cv.toDataURL('image/png'); renderer.setSize(oldSize.x, oldSize.y, false); scene.fog = fog;
      const im = new Image(); im.src = url; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const x2 = c.getContext('2d'); x2.drawImage(im, 0, 0);
      const W = im.width, H = im.height, d = x2.getImageData(0, 0, W, H).data, px0 = (xx, yy) => { const i = (yy * W + xx) * 4; return [d[i], d[i + 1], d[i + 2]]; };
      const sky = px0(Math.floor(W / 2), 3); let n = 0, y0 = Infinity;
      const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); const far = new THREE.Vector3(cam.position.x + fwd.x * 3000, cam.position.y, cam.position.z + fwd.z * 3000).project(cam), hor = (1 - far.y) / 2 * H;   // screen row of the true horizon at the camera height
      for (let yy = Math.floor(Math.min(H * 0.95, Math.max(H * 0.2, hor + H * 0.05))); yy < H * 0.95; yy += 2) for (let xx = 0; xx < W; xx += 2) { const p = px0(xx, yy); if (Math.abs(p[0] - sky[0]) < 14 && Math.abs(p[1] - sky[1]) < 14 && Math.abs(p[2] - sky[2]) < 14) { n++; if (yy < y0) y0 = yy; } }
      return { n, url: n > 40 ? url : null };
    }, { s, mode });
    if (r.n > 40) { bad.push([s.tag, mode, r.n]); fs.writeFileSync(path.join(out, `${s.tag.replace(/[^\w.@,-]/g, '_')}-${mode}.png`), Buffer.from(r.url.split(',')[1], 'base64')); }
  }
}
console.log('spots', spots.length, 'views', spots.length * 2, 'with sky below the horizon line:', bad.length);
for (const b of bad) console.log(JSON.stringify(b));
console.log('errors', g.errors.slice(0, 3));
await g.close();
