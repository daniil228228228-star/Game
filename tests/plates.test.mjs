// Plates redesign, CHANGELOG_V161.md 2026-10-11 -- user (iPhone): «Проблема с плашками не ушла ... они налезают если подходишь со стороны, типа они врезаются в стену»
// (screenshot: the fleet yard sign "АВТОП... / служебная ст..." clipped at the board's right edge, the fence crossing it).
// ONE launch (late-game save, stage 6, everything built), checked against the real scene objects:
//   A. every plate TYPE: the text measured with the real canvas font (measureText at the stored size) is <= the pill's inner width at the actual texture scale, no plate is clipped
//      (ellipsis only as a last resort and none for the game's own strings), synthetic worst-case strings (3 long lines, one very long single line) fit, a long single line wraps to 2 lines;
//   B. flags on the real objects: every floating plate (Sprite with v152WorldLabel) has depthTest false, depthWrite false, renderOrder >= 1000 (no wall can cut it); every plate that is
//      PART of a building (userData.v161Board: fleet yard sign on both faces, bay numbers, sign plate of the garage, site boards) is a depth-tested Mesh with the pill texture;
//   C. probes at the phone viewport from 8 directions around the fleet yard sign, the sawmill pickup and the current pad: every plate the layout accepts lies WHOLLY inside the viewport,
//      its pixels are the pill (dark) + bright text (not covered by a wall), at most 4 plates are accepted, the board of the yard sign is readable where the camera ray hits it first;
//   D. the compass chip ("Стройка · 48м") is wholly inside the viewport from 8 directions around the objective (clamped, never cut by the screen edge);
//   E. night: the pill + light text contrast stays (luminance of the drawn pill / text) with the night tint on.
// SHOTS_DIR=/some/dir also writes the probe pictures.
import { openGame, check, waitForState } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = process.env.SHOTS_DIR || '';
const J = JSON.stringify;
const SAVE = { saveVersion: 20, stageIndex: 6, money: 5e6, planks: 30, concrete: 30, metal: 30, buildings: Array.from({ length: 6 }, (_, i) => ({ index: i, level: 1 })) };
const g = await openGame({ save: SAVE, waitMs: 9000 });
const { page } = g;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

await page.evaluate(() => {
  { const o = window.__TYCOON_V119__?.state?.owned; if (o) o.planks = o.concrete = o.metal = true; }
  try { syncDeliveryFleet(); syncDeliveryFleet(); } catch (e) { /* ignore */ }
});
const frames = (n) => page.evaluate((n) => new Promise((res) => { const f0 = V54_STABILITY.frame; const t = () => (V54_STABILITY.frame - f0 >= n ? res(true) : requestAnimationFrame(t)); t(); setTimeout(() => res(false), 20000); }), n);

// ------------------------------------------------------------------------------------------------ A. text fits the pill
const A = await page.evaluate(() => {
  const P = window.PlatesV161, probe = document.createElement('canvas').getContext('2d');
  const FONT = (s, w) => `${w} ${s}px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
  const rowsOf = (info, weights) => info.rows.map((r, i) => { probe.font = r.font || FONT(r.size, weights[i]); return { text: r.text, size: r.size, measured: probe.measureText(r.text).width, inner: info.inner, ell: r.ellipsis }; });
  const WEIGHTS = { 1: [850], 2: [850, 800], 3: [850, 800, 750] };
  const types = new Map();
  const add = (o) => {
    const info = o.userData.v161Plate; if (!info) return;
    const kind = o.userData.v161Board ? 'board' : 'sprite';
    const key = kind + ':' + info.rows.map((r) => r.text).join('|').replace(/\d+/g, '#');
    if (!types.has(key)) types.set(key, { kind, info });
  };
  scene.traverse((o) => { if (o.userData && o.userData.v161Plate) add(o); });
  const real = [...types.values()].map(({ kind, info }) => {
    const rows = rowsOf(info, WEIGHTS[Math.min(3, info.rows.length)]);
    return { kind, n: rows.length, worst: Math.max(...rows.map((r) => r.measured - r.inner)), ell: rows.some((r) => r.ell), texts: rows.map((r) => r.text) };
  });
  // synthetic worst cases through the REAL constructors
  const syn = [
    ['ПОДЪЁМНИК АВТОПАРКА ТЕХНИЧЕСКОЕ ОБСЛУЖИВАНИЕ БОЛЬШОЕ', 'очень длинная вторая строка для проверки сжатия шрифта до минимума', '🧱 склад 12345/12345 · ещё одна строка'],
    ['ГАРАЖ АВТОПАРКА И СЕРВИСНАЯ СТАНЦИЯ'],
    ['🪵 ДОСКИ', 'ВЫГРУЗКА ПИЛЫ'],
    ['АВТОПАРК', 'служебная стоянка'],
    ['ЦЕЛЬ', '495 м · ИДИ К ЦЕЛИ'],
    ['x'.repeat(80)],
  ].map((lines) => { const s = makeLabelSprite(lines), info = s.userData.v161Plate, rows = rowsOf(info, WEIGHTS[info.rows.length]); return { lines: lines.length, outRows: rows.length, worst: Math.max(...rows.map((r) => r.measured - r.inner)), ell: rows.some((r) => r.ell), canvasW: s.material.map.image.width, inner: info.inner }; });
  return { real, syn, inner: P.draw(['x']).info.inner };
});
check(A.real.length >= 6, `plate types found in the scene: ${A.real.length} (${A.real.map((r) => r.kind + ':' + r.texts[0]).join(' ; ').slice(0, 400)})`);
check(A.real.every((r) => r.worst <= 0.5), `every real plate type: measured text width <= pill inner width (worst overshoot ${Math.max(...A.real.map((r) => r.worst)).toFixed(2)} px)`);
check(A.real.every((r) => !r.ell), `no real plate needs an ellipsis (${A.real.filter((r) => r.ell).map((r) => r.texts.join('/')).join(' ; ')})`);
check(A.syn.every((r) => r.worst <= 0.5 && r.inner <= r.canvasW), `synthetic worst cases fit the pill at the actual canvas scale (${A.syn.map((r) => r.worst.toFixed(1)).join(', ')} px overshoot)`);
check(A.syn[1].outRows === 2 && A.syn[2].ell === false && A.syn[5].ell === true, `a long single line wraps to 2 lines (${A.syn[1].outRows}); an 80-char string needs the ellipsis as the LAST resort (${A.syn[5].ell}); short strings never do`);

// ------------------------------------------------------------------------------------------------ B. flags on the real objects
const B = await page.evaluate(() => {
  const sprites = [], boards = [], other = [];
  scene.traverse((o) => {
    if (o.isSprite && o.userData.v152WorldLabel) sprites.push({ depthTest: o.material.depthTest, depthWrite: o.material.depthWrite, ro: o.renderOrder, name: o.parent?.name || '' });
    else if (o.userData && o.userData.v161Board) boards.push({ mesh: !!o.isMesh, depthTest: o.material.depthTest, hasMap: !!o.material.map, ro: o.renderOrder });
    else if (o.isSprite && o.material && o.material.map && o.material.depthTest && o.userData.v152WorldLabel !== undefined) other.push(o.name);
  });
  let yard = null; scene.traverse((o) => { if (o.userData && o.userData.v161YardSign) yard = o; });
  return { sprites, boards, yardSign: !!yard };
});
check(B.sprites.length >= 10, `floating plates in the scene: ${B.sprites.length}`);
check(B.sprites.every((s) => s.depthTest === false && s.depthWrite === false && s.ro >= 1000), `every floating plate: depthTest false, depthWrite false, renderOrder >= 1000 (bad: ${B.sprites.filter((s) => !(s.depthTest === false && s.depthWrite === false && s.ro >= 1000)).length})`);
check(B.yardSign && B.boards.length >= 1 && B.boards.every((b) => b.mesh && b.depthTest === true && b.hasMap), `text that is part of a building is a depth-tested textured Mesh (${B.boards.length} board texts incl. the fleet yard sign)`);

// ------------------------------------------------------------------------------------------------ C. probes from 8 directions
await page.evaluate(() => {
  window.__plateProbe = (opts) => {
    const W = innerWidth, H = innerHeight, cv = renderer.domElement, k = cv.width / W;
    renderer.render(scene, camera);
    const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height; const x2 = c2.getContext('2d', { willReadFrequently: true }); x2.drawImage(cv, 0, 0);
    const stat = (r) => { // dark (pill) / bright (text) share of a screen rect
      const x0 = Math.max(0, Math.floor((r.x - r.w / 2) * k)), y0 = Math.max(0, Math.floor((r.y - r.h / 2) * k)), w = Math.max(1, Math.min(c2.width - x0, Math.floor(r.w * k))), h = Math.max(1, Math.min(c2.height - y0, Math.floor(r.h * k)));
      const d = x2.getImageData(x0, y0, w, h).data; let dark = 0, bright = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 3) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; if (l < 70) dark++; else if (l > 120) bright++; }   // 2026-10-11 (17): text is semi-bold / muted and mip-mapped on small plates: its anti-aliased pixels sit at 120..190, not only above 190
      return { dark: dark / n, bright: bright / n };
    };
    const plates = [];
    scene.traverse((o) => { if (o.isSprite && o.userData.v152WorldLabel && o.userData.v161Rect && o.material.opacity > 0.9) plates.push({ name: o.parent?.name || o.parent?.type || '?', rect: o.userData.v161Rect, ...stat(o.userData.v161Rect) }); });
    let accepted = 0; scene.traverse((o) => { if (o.isSprite && o.userData.v152WorldLabel && o.userData.v163Selected) accepted++; });
    // the yard sign board: projected rect + first hit of the camera ray
    let sign = null;
    scene.traverse((o) => { if (o.userData && o.userData.v161YardSign) sign = o.userData.v161YardSign; });
    let board = null;
    if (sign) {
      sign.updateMatrixWorld(true);
      const c = new THREE.Vector3(); sign.getWorldPosition(c);
      const nrm = new THREE.Vector3(0, 0, 1).transformDirection(sign.matrixWorld), toCam = camera.position.clone().sub(c).normalize();
      const sc = sign.geometry.parameters, pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * sc.width / 2, b * sc.height / 2, 0).applyMatrix4(sign.matrixWorld).project(camera));
      const xs = pts.map((p) => (p.x + 1) * W / 2), ys = pts.map((p) => (1 - p.y) * H / 2);
      const rect = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      const inside = rect.x - rect.w / 2 >= 0 && rect.x + rect.w / 2 <= W && rect.y - rect.h / 2 >= 0 && rect.y + rect.h / 2 <= H && pts.every((p) => p.z > -1 && p.z < 1);
      const rc = new THREE.Raycaster(camera.position, c.clone().sub(camera.position).normalize(), 0.1, camera.position.distanceTo(c) + 0.5);
      rc.camera = camera; const hits = rc.intersectObjects(scene.children, true).filter((h) => h.object.isMesh && h.object.visible && !(h.object.material && h.object.material.transparent && h.object.material.opacity < 0.5));
      const first = hits[0] ? (hits[0].object === sign || hits[0].object.userData.v161Board ? 'sign' : (hits[0].object.name || hits[0].object.parent?.name || 'mesh')) : 'none';
      board = { facing: nrm.dot(toCam), inside, first, rect, dist: camera.position.distanceTo(c), ...stat(rect) };
    }
    return { W, H, plates, accepted, board, shot: opts && opts.shot ? document.querySelector('canvas') && cv.toDataURL('image/jpeg', 0.8) : null };
  };
});
const dirs = [...Array(8)].map((_, i) => [Math.sin(i * Math.PI / 4), Math.cos(i * Math.PI / 4)]);
const probes = [];
async function probeAround(name, getCentre, radius, shotName) {
  for (let i = 0; i < 8; i++) {
    const [dx, dz] = dirs[i];
    await page.evaluate(({ c, dx, dz, r }) => { player.position.set(c.x + dx * r, 0, c.z + dz * r); playerVelocity.set(0, 0, 0); if (window.__lookAtCentre) { const cd = Math.hypot(camera.position.x - controls.target.x, camera.position.z - controls.target.z) || 8; controls.target.set(player.position.x, controls.target.y, player.position.z); camera.position.set(player.position.x + dx * cd, camera.position.y, player.position.z + dz * cd); controls.update(); } }, { c: await page.evaluate(getCentre), dx, dz, r: radius });
    await frames(6);
    // the chase camera glides to the teleported player: wait until it has arrived and stopped
    await waitForState(page, () => { const d = Math.hypot(camera.position.x - player.position.x, camera.position.z - player.position.z), p = window.__camPrev || 1e9; window.__camPrev = d; return d < 30 && Math.abs(d - p) < 0.02; }, null, { timeout: 60000, fallback: true });
    await frames(8);
    await waitForState(page, () => { let ok = true; scene.traverse((o) => { if (o.isSprite && o.userData.v152WorldLabel && o.userData.v163Selected && o.material.opacity < 0.9) ok = false; }); return ok; }, null, { timeout: 8000, fallback: true });
    const r = await page.evaluate((shot) => window.__plateProbe({ shot }), !!(SHOTS && shotName));
    r.name = name; r.dir = i; probes.push(r);
    if (SHOTS && shotName && r.shot) fs.writeFileSync(path.join(SHOTS, `${shotName}-${i}.jpg`), Buffer.from(r.shot.split(',')[1], 'base64'));
    delete r.shot;
  }
}
const signCentre = () => { let p = null; scene.traverse((o) => { if (o.userData && o.userData.v161YardSign) { const v = new THREE.Vector3(); o.userData.v161YardSign.getWorldPosition(v); p = { x: v.x, z: v.z }; } }); return p; };
const sawCentre = () => ({ x: LOGISTICS_ZONES.planks.group.position.x, z: LOGISTICS_ZONES.planks.group.position.z });
const padCentre = () => { const t = currentGuidanceTarget(); return t ? { x: t.pos.x, z: t.pos.z } : { x: 0, z: 0 }; };
// 2026-10-17: the wanted zoom no longer drifts with obstruction pulls (camera-drift test); the probes look from a player-chosen 12.5 m like the old creeping camera did on average
await page.evaluate(() => { desiredCameraDistance = 12.5; markCameraUserInput(); window.__lookAtCentre = true; });
await probeAround('yard sign', signCentre, 6.5, 'plates-yard-sign');
await probeAround('sawmill', sawCentre, 4.5, 'plates-sawmill');
await probeAround('pad', padCentre, 4.5, 'plates-pad');
const allPlates = probes.flatMap((p) => p.plates.map((q) => ({ ...q, probe: p.name + '#' + p.dir, W: p.W, H: p.H })));
check(allPlates.length >= 8, `plates accepted by the layout over 24 probes: ${allPlates.length}`);
check(allPlates.every((q) => q.rect.x - q.rect.w / 2 >= 0 && q.rect.x + q.rect.w / 2 <= q.W && q.rect.y - q.rect.h / 2 >= 0 && q.rect.y + q.rect.h / 2 <= q.H), `every drawn plate lies WHOLLY inside the ${probes[0].W}x${probes[0].H} viewport (outside: ${J(allPlates.filter((q) => !(q.rect.x - q.rect.w / 2 >= 0 && q.rect.x + q.rect.w / 2 <= q.W && q.rect.y - q.rect.h / 2 >= 0 && q.rect.y + q.rect.h / 2 <= q.H)).map((q) => q.probe))})`);
check(allPlates.every((q) => q.rect.w <= 0.46 * q.W + 8), `plate width <= 45 % of the viewport (max ${Math.max(...allPlates.map((q) => q.rect.w / q.W)).toFixed(2)})`);
check(allPlates.every((q) => q.rect.w >= 78), `plate width >= readable minimum 78 px (min ${Math.min(...allPlates.map((q) => q.rect.w)).toFixed(0)})`);
const covered = allPlates.filter((q) => q.dark < 0.22 || q.bright < 0.01);
check(covered.length === 0, `pixels: every drawn plate is a dark pill with bright text, nothing covers it (covered: ${J(covered.map((q) => [q.probe, +q.dark.toFixed(2), +q.bright.toFixed(3)]))})`);
check(probes.every((p) => p.accepted <= 4), `at most 4 plates accepted per view (max ${Math.max(...probes.map((p) => p.accepted))})`);
const ys = probes.filter((p) => p.name === 'yard sign' && p.board);
const seen = ys.filter((p) => p.board.inside && Math.abs(p.board.facing) > 0.2 && p.board.first === 'sign');
check(seen.length >= 2, `the yard sign board is seen (facing, wholly inside, first hit by the camera ray) from ${seen.length} of 8 directions (${J(ys.map((p) => [p.board.inside, +p.board.facing.toFixed(2), p.board.first]))})`);
check(seen.every((p) => p.board.bright > 0.015 && p.board.dark > 0.2), `yard sign text: bright text pixels on the dark navy board where it is seen (${J(seen.map((p) => [+p.board.bright.toFixed(3), +p.board.dark.toFixed(2)]))})`);

// ------------------------------------------------------------------------------------------------ D. compass chip
const D = [];
for (let i = 0; i < 8; i++) {
  const [dx, dz] = dirs[i];
  await page.evaluate(({ dx, dz }) => { const t = currentGuidanceTarget(); const c = t ? t.pos : { x: 0, z: 0 }; player.position.set(c.x + dx * 48, 0, c.z + dz * 48); playerVelocity.set(0, 0, 0); }, { dx, dz });
  await frames(10); await page.waitForTimeout(500); await frames(4);
  D.push(await page.evaluate(() => { const el = document.getElementById('compassDistance'), c = document.getElementById('compass'); const r = el.getBoundingClientRect(); return { shown: getComputedStyle(c).display !== 'none', l: r.left, r: r.right, t: r.top, b: r.bottom, W: innerWidth, H: innerHeight, text: el.textContent }; }));
}
check(D.filter((d) => d.shown).length >= 6, `compass chip shown from ${D.filter((d) => d.shown).length} of 8 directions 48 m from the objective (${D[0].text})`);
check(D.filter((d) => d.shown).every((d) => d.l >= 0 && d.r <= d.W && d.t >= 0 && d.b <= d.H), `compass chip wholly inside the viewport from every direction (${J(D.filter((d) => d.shown).map((d) => [Math.round(d.l), Math.round(d.r), Math.round(d.t), Math.round(d.b)]))})`);

// ------------------------------------------------------------------------------------------------ E. night contrast
const E = await page.evaluate(() => {
  const s = makeLabelSprite(['🪵 ДОСКИ', 'ВЫГРУЗКА ПИЛЫ']), cv = s.material.map.image, x = cv.getContext('2d'), d = x.getImageData(0, 0, cv.width, cv.height).data;
  let darkPx = 0, light = 0, n = 0; for (let i = 0; i < d.length; i += 16) { const a = d[i + 3]; if (a < 200) continue; const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; if (l < 60) darkPx++; else if (l > 190) light++; }
  return { dark: darkPx / n, light: light / n, toneMapped: s.material.toneMapped, fog: s.material.fog };
});
check(E.dark > 0.5 && E.light > 0.03 && E.toneMapped === false, `pill is dark (${E.dark.toFixed(2)}) with light text (${E.light.toFixed(2)}) and no tone mapping / day-night tint (toneMapped ${E.toneMapped}): same contrast day and night`);

// ------------------------------------------------------------------------------------------------ F. premium style (2026-10-11 (17))
const F = await page.evaluate(() => {
  const P = window.PlatesV161, T = P.TOKENS;
  const rgb = (c) => { if (c[0] === '#') return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); const m = c.match(/[\d.]+/g).map(Number); return m.slice(0, 3); };
  const lum = (c) => { const v = rgb(c).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // the pill is 97 % opaque: worst case over white
  const over = (c) => { const [r, g, b] = rgb(c); const a = 0.97; return `rgb(${Math.round(r * a + 255 * (1 - a))},${Math.round(g * a + 255 * (1 - a))},${Math.round(b * a + 255 * (1 - a))})`; };
  const panel = [over(T.panelTop), over(T.panelBottom)];
  const types = new Map();
  scene.traverse((o) => { if (o.isSprite && o.userData.v161Plate) { const i = o.userData.v161Plate; types.set(i.rows.map((r) => r.text).join('|').replace(/\d+/g, '#'), i); } });
  const infos = [...types.values()];
  const withFrac = infos.filter((i) => i.progress >= 0), s2 = P.makeSpriteParts(['🪵 ДОСКИ', 'ВЫГРУЗКА 3/12']).info, s0 = P.makeSpriteParts(['ГАРАЖ', 'СТОЯНКА']).info;
  const tex = P.makeSpriteParts(['x']).material.map, caps = renderer.capabilities;
  return {
    n: infos.length, noCat: infos.filter((i) => !i.cat).length, fracBad: withFrac.filter((i) => !(i.progress >= 0 && i.progress <= 1)).length, nFrac: withFrac.length,
    ink: Math.min(...panel.map((p) => ratio(T.ink, p))), ink2: Math.min(...panel.map((p) => ratio(T.ink2, p))), gold: Math.min(...panel.map((p) => ratio(T.gold, p))),
    weights: infos.filter((i) => i.rows.length >= 2).map((i) => [i.rows[0].weight, i.rows[1].weight]), s2: { cat: s2.cat, emoji: s2.emoji, progress: s2.progress, rows: s2.rows.map((r) => r.text) }, s0: { progress: s0.progress },
    mip: tex.generateMipmaps, expectMip: !!caps.isWebGL2, minFilter: tex.minFilter === THREE.LinearMipmapLinearFilter, aniso: tex.anisotropy,
  };
});
console.log('premium plates', J(F));
check(F.n >= 6 && F.noCat === 0, `every plate type carries a category for its medallion (${F.n} types, ${F.noCat} without)`);
check(F.ink >= 4.5 && F.ink2 >= 4.5 && F.gold >= 4.5, `WCAG AA on the pill (worst case over white): title ${F.ink.toFixed(1)}:1, subtitle ${F.ink2.toFixed(1)}:1, gold ${F.gold.toFixed(1)}:1 (>= 4.5)`);
check(F.weights.every(([a, b]) => a >= 700 && b <= 650 && a > b), `title semi-bold over a lighter subtitle on every 2+ row plate (${J(F.weights.slice(0, 4))})`);
check(F.s2.cat === 'wood' && F.s2.emoji === '🪵' && F.s2.rows[0] === 'ДОСКИ' && F.s2.progress > 0.2 && F.s2.progress < 0.3 && F.s0.progress === -1, `leading emoji moves into the medallion (${J(F.s2)}); a progress hairline only where a row has a/b (${F.nFrac} such real plates, none out of range: ${F.fracBad})`);
check(F.mip === F.expectMip && (!F.mip || F.minFilter), `plate textures are mip-mapped on WebGL2 (generateMipmaps ${F.mip}, anisotropy ${F.aniso}): small far plates no longer alias`);

check(g.errors.length === 0, `no console errors ${J(g.errors.slice(0, 3))}`);
check(g.badResponses.length === 0, `no 4xx ${J(g.badResponses.slice(0, 3))}`);
await g.close();
