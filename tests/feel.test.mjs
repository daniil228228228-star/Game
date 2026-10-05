// Game feel + guidance (ROADMAP_V161 task 5, CHANGELOG_V161.md "2026-10-05 ... игровое ощущение"). ONE browser launch (fresh save).
//
//   A. feedback: every event added by tasks 2-4 / sawmill v2 triggers sfx + particle burst (+ camera shake where the game kicks): the real functions
//      are spied (sfx.*, spawnBurst, triggerShake, AudioContext.createOscillator, the #toast element), the events are driven through the game's own
//      owners (upgradeCityDistrict, buildIndustrialStepV118 for infra / workshop / level-3 pads, the production timers, upgradeBuilding + the
//      animate() completion for gold tiers 6 and the last level 10, the real #actionBtn plank pickup). Level 10 has a distinct fanfare.
//      Muted = no oscillator at all; unmuted spam is capped (<= 12 oscillators per 300 ms); bursts are capped (30) and leave no Points behind;
//      shake decays to an exactly zero offset.
//   B. guidance: "Дальше: ..." toast after a district / infra / chain purchase (existing toast channel only, no new DOM, one per 8 s), the compass
//      target is the NEAREST of the independent affordable pads, infra plates carry the district name, plates: <= 4 visible (opacity > 0), none
//      beyond 24 m, none under the top HUD, readable (>= 70 px at the far 20 m camera) when closer than 9 m.
//   C. polish: the thin white curve at x~-53.5 (innerPromenadeCurb) follows the ring road it borders; camera foliage fades by scale (shared materials
//      untouched, full size restored exactly, no flicker with the real 10 Hz pass); workers idle around the sawmill / real buildings, never around the
//      removed camp; "Рабочий темп" / repeated texts are rate limited.
//   D. life: tree sway touches <= 6 nearest trees, rotation.x only, relaxes back.
// Waits are on game state, not wall clock (software GL runs at a few fps). SHOTS_DIR=<dir> writes 3 screenshots.
import { openGame, check, waitForState } from './lib/harness.mjs';
import fs from 'node:fs';

const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;
const T0 = Date.now();
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

// ------------------------------------------------------------------ spies on the REAL functions
await ev(() => {
  const fx = window.__fx = { sfx: {}, bursts: [], shakes: [], osc: 0, toasts: [] };
  for (const k of Object.keys(sfx)) if (typeof sfx[k] === 'function') { const o = sfx[k]; sfx[k] = function (...a) { fx.sfx[k] = (fx.sfx[k] || 0) + 1; return o.apply(this, a); }; }
  const ob = spawnBurst; spawnBurst = function (p, c) { fx.bursts.push(c); return ob.apply(this, arguments); };
  const os = triggerShake; triggerShake = function (s, d) { fx.shakes.push([s, d]); return os.apply(this, arguments); };
  const AC = window.AudioContext || window.webkitAudioContext;
  const co = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { fx.osc++; return co.apply(this, arguments); };
  const el = document.getElementById('toast');
  new MutationObserver(() => fx.toasts.push({ t: performance.now(), text: el.textContent })).observe(el, { childList: true, characterData: true, subtree: true });
  window.__dbg = [];
  const oh = window.hintNextStepV161; window.hintNextStepV161 = function () { const r = oh.apply(this, arguments); window.__dbg.push(['hint-call', Math.round(performance.now()), r]); return r; };
  const ot = toast; toast = function (m) { if (/^(Дальше|Next): /.test(String(m))) window.__dbg.push(['hint-toast-call', Math.round(performance.now()), String(m)]); return ot.apply(this, arguments); };
  window.__mark = () => ({ sfx: Object.values(fx.sfx).reduce((a, b) => a + b, 0), by: { ...fx.sfx }, b: fx.bursts.length, s: fx.shakes.length, osc: fx.osc, toasts: fx.toasts.length, ripples: completionRipples.length });
  window.__delta = (m0) => { const m = window.__mark(); const by = {}; for (const k of Object.keys(m.by)) if (m.by[k] !== (m0.by[k] || 0)) by[k] = m.by[k] - (m0.by[k] || 0); return { sfx: m.sfx - m0.sfx, by, b: m.b - m0.b, s: m.s - m0.s, osc: m.osc - m0.osc, toasts: m.toasts - m0.toasts, ripples: m.ripples - m0.ripples, colors: fx.bursts.slice(m0.b), shakes: fx.shakes.slice(m0.s) }; };
});
const mark = () => ev(() => window.__mark());
const delta = (m0) => ev((m) => window.__delta(m), m0);
// run `fn` in the page and return what the spies saw during it (synchronous work only; frames in between are covered by waitForState calls)
const measure = async (fn, arg) => { const m0 = await mark(); const out = await ev(fn, arg); return { out, d: await delta(m0) }; };
const hintToast = () => ev(() => window.__fx.toasts.filter((t) => /^(Дальше|Next): /.test(t.text)).map((t) => ({ t: t.t, text: t.text })));
const waitHint = (n) => waitForState(page, (n) => window.__fx.toasts.filter((t) => /^(Дальше|Next): /.test(t.text)).length >= n, n, { timeout: 12000 });

// ------------------------------------------------------------------ setup: the industrial chain (stage 0), a construction site for the plank pickup
await ev(() => { money = 1e9; planks = 1e4; concrete = 1e3; metal = 1e3; for (const id of ['depot', 'sawmill', 'concrete', 'metal']) buildIndustrialStepV118(industrialStepV118(id)); });

// ---- A9. plank pickup through the real #actionBtn (burst + click + toast)
// stage 0 (house 1) costs money only: buy it, finish it, then the stage-1 house needs planks -> a plank ticket exists
await ev(() => { money = 1e9; planks = 99999; concrete = 99999; metal = 99999; purchaseCurrentPad(); });
await finishAll();
await ev(() => { money = 1e9; planks = 99999; concrete = 99999; metal = 99999; purchaseCurrentPad(); });
const ticket = await waitForState(page, () => growingMeshes.some((b) => b?.entry?.underConstruction && (b.deliveryPlan || []).some((t) => t.cargo === 'planks' && !t.delivered)), null, { timeout: 30000 });
check(ticket, 'a construction site with an open plank delivery ticket exists');
await ev(() => { planks = 6; syncPlankStackV161(); const c = growingMeshes.find((b) => b?.entry?.underConstruction); for (const t of c.deliveryPlan) if (t.cargo !== 'planks') t.delivered = true; });
await ev(() => { const L = SAWMILL_L_V161, p = sawmillMillV161.localToWorld(new THREE.Vector3(L.PICK_X + 0.4, 0, L.PICK_Z + 1.9)); player.position.set(p.x, 0, p.z); });
await waitForState(page, () => { const b = document.getElementById('actionBtn'); return b && !b.hidden && b.dataset.v119ManualAction === 'load'; }, null, { timeout: 20000 });
const pm0 = await mark();
const pressedPick = await waitForState(page, () => { if (window.__TYCOON_V123__.state.carry.amount > 0) return true; const b = document.getElementById('actionBtn'); if (b && !b.hidden && !b.disabled) b.click(); return false; }, null, { timeout: 25000 });
await waitForState(page, (n) => window.__fx.toasts.length > n, pm0.toasts, { timeout: 8000 }); // the pickup toast leaves the toast queue a moment later
const pd = await delta(pm0);
check(pressedPick && pd.b >= 1 && (pd.by.click || 0) >= 1 && pd.toasts >= 1, `plank pickup (real #actionBtn): burst ${pd.b}, sfx ${J(pd.by)}, toast ${pd.toasts}`);
await ev(() => { window.__TYCOON_V123__.state.carry = { type: null, amount: 0, targetIndex: null }; });

// ---- A1. district hub unlock: sound + flash existed, the burst / shake / ripple are new
const e1 = await measure(() => { const r0 = completionRipples.length; upgradeCityDistrict('suburb'); return { level: districtLevel('suburb'), ripples: completionRipples.length - r0 }; });
check(e1.out.level === 1 && (e1.d.by.build || 0) >= 1 && e1.d.b >= 1 && e1.d.colors.includes(0x74c97b) && e1.d.s >= 1 && e1.out.ripples >= 1,
  `district hub unlock: sfx.build ${e1.d.by.build}, ${e1.d.b} burst(s) in the district colour, shake ${e1.d.s}, ripple ${e1.out.ripples}`);
const bodyKids0 = await ev(() => document.body.children.length);
check(await waitHint(1), 'a "Дальше:" hint toast follows the district purchase');
const h1 = (await hintToast())[0];
console.log('INFO hint 1: ' + h1?.text);
const bodyKids1 = await ev(() => document.body.children.length);
check(bodyKids1 === bodyKids0, `the hint adds no panel/DOM element, only the toast text (body children ${bodyKids0} -> ${bodyKids1})`);
await shot('feel-hint-toast');

// ---- A2. infra pad: press the road pad -> sfx + burst + shake; completion (pending timer) -> burst + achievement
const em0 = await mark();
const e2 = await measure(() => { const st = industrialStepV118('infra-suburb-road'); return { ok: buildIndustrialStepV118(st), plate: st.plateSub, label: st.ru }; });
check(e2.out.ok && (e2.d.by.build || 0) >= 1 && e2.d.b >= 1 && e2.d.colors.includes(0xd6c9a8) && e2.d.s >= 1, `infra road pad: sfx.build ${e2.d.by.build}, burst ${e2.d.b}, shake ${e2.d.s}, label "${e2.out.label}", plate sub ${J(e2.out.plate)}`);
await page.waitForTimeout(2600); // a would-be hint (1.9 s timer) would have been shown by now
const hintsNow = await hintToast();
check(hintsNow.length === 1, `hint cooldown: the infra purchase right after the district hint does not stack a second hint (${hintsNow.length} hint toast so far)`);
const roadDone = await waitForState(page, () => districtRoadLevelV37('suburb') >= 1, null, { timeout: 45000 });
const e2d = await delta(em0);
check(roadDone && (e2d.by.achievement || 0) >= 1 && e2d.b >= 2 && e2d.colors.includes(0xbfc4cc), `road L1 completion adds a burst (${J(e2d.colors)}) and sfx.achievement ${e2d.by.achievement}`);

// light pad + plants (all go through buildIndustrialStepV118 -> run)
const e2l = await measure(() => ({ ok: buildIndustrialStepV118(industrialStepV118('infra-suburb-light')) }));
check(e2l.out.ok && e2l.d.sfx >= 1 && e2l.d.b >= 1 && e2l.d.s >= 1, `lighting pad: sfx ${e2l.d.sfx}, burst ${e2l.d.b}, shake ${e2l.d.s}`);
await waitForState(page, () => districtStreetlightLevelV37('suburb') >= 1, null, { timeout: 45000 });
const e2p = await measure(() => ({ ok: buildIndustrialStepV118(industrialStepV118('infra-plant-power')) }));
check(e2p.out.ok && e2p.d.sfx >= 1 && e2p.d.b >= 1 && e2p.d.s >= 1, `power plant pad: sfx ${e2p.d.sfx}, burst ${e2p.d.b}, shake ${e2p.d.s}`);

// plates: infra pads carry the district name on a second line (marker sprite canvas is 2 lines high enough for it); title stays short
const plate = await ev(() => {
  const st = INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf && s.infraOf !== 'city');
  const lines = st.map((s) => ({ id: s.id, ru: s.ru, sub: s.plateSub?.ru }));
  const withSub = lines.every((l) => l.sub && l.sub.length > 3 && l.ru.length <= 22);
  return { lines: lines.slice(0, 4), withSub, plants: INDUSTRIAL_BUILD_STEPS_V118.filter((s) => s.infraOf === 'city').map((s) => s.ru) };
});
check(plate.withSub, `every district infra pad plate has a short title (<= 22 chars) and a second line with the district (${J(plate.lines.slice(0, 2))}); plants: ${J(plate.plants)}`);

// ---- A4-A6. production chain: frame workshop built, frame produced, level-3 pad
await ev(() => { industrialLevelsV161.sawmill = 2; industrialLevelsV161.concrete = 2; industrialLevelsV161.metal = 2; stageIndex = 6; money = 1e9; planks = 1e4; concrete = 1e3; metal = 1e3; refreshIndustrialPadMarkersV118(); });
// the next hint is allowed 8 s after the last one
const hs0 = await hintToast();
await page.waitForTimeout(Math.max(0, 8400 - (await ev((t) => performance.now() - t, hs0[hs0.length - 1].t))));
const e4 = await measure(() => ({ ok: buildIndustrialStepV118(industrialStepV118('frame')) }));
check(e4.out.ok && (e4.d.by.build || 0) >= 1 && e4.d.b >= 1 && e4.d.s >= 1, `frame workshop built: sfx.build ${e4.d.by.build}, burst ${e4.d.b}, shake ${e4.d.s}`);
check(await waitHint(hs0.length + 1), `another "Дальше:" hint appears after the workshop purchase (8 s after the last one, ${hs0.length} before)`);
const hs1 = await hintToast();
console.log('INFO hint debug: ' + J(await ev(() => window.__dbg)));
console.log('INFO hint 2: ' + hs1[hs1.length - 1]?.text);
check(hs1.length === hs0.length + 1, `exactly one hint per purchase (${hs1.length} total)`);
const e5 = await measure(() => { const f0 = framesV161; const ok = PRODUCTION_CHAIN_V161.craft(); return { ok, made: framesV161 - f0 }; });
check(e5.out.ok && e5.out.made === 1 && (e5.d.by.plank || 0) >= 1 && e5.d.b >= 1, `frame produced: sfx.plank ${e5.d.by.plank}, burst ${e5.d.b}`);
const e6 = await measure(() => { framesV161 = 20; return { ok: buildIndustrialStepV118(industrialStepV118('sawmill3')) }; });
check(e6.out.ok && (e6.d.by.build || 0) >= 1 && e6.d.b >= 1 && e6.d.s >= 1, `level-3 pad (sawmill): sfx.build ${e6.d.by.build}, burst ${e6.d.b}, shake ${e6.d.s}`);

// ---- B. guidance: nearest of the independent affordable pads (workshop built: level-3 pads of concrete and metal at stage 8, plus the water works)
const near = await ev(() => {
  const keep = currentPad; currentPad = null; stageIndex = 8; const roadMarks = buildings.filter((b) => !manualRoadStagesV116.has(b.index)).map((b) => b.index); for (const i of roadMarks) manualRoadStagesV116.add(i); // a house without a road would win the chain (flags only, no road is laid)
  money = 1e9; planks = 1e4; concrete = 1e3; metal = 1e3; framesV161 = 50; refreshIndustrialPadMarkersV118();
  const ids = INDUSTRIAL_BUILD_STEPS_V118.filter((s) => (s.infraOf || s.chainV161) && !s.built() && s.prereq()).map((s) => s.id);
  const out = { ids };
  const pick = () => { const t = nextActionableTargetV117(); return t && t.stepId; };
  if (ids.length >= 2) {
    const a = industrialStepV118(ids[0]).pos, b = industrialStepV118(ids[1]).pos;
    player.position.set(a.x + 1, 0, a.z); out.pickNearA = pick(); out.expectA = ids[0];
    player.position.set(b.x + 1, 0, b.z); out.pickNearB = pick(); out.expectB = ids[1];
  }
  for (const i of roadMarks) manualRoadStagesV116.delete(i); currentPad = keep;
  return out;
});
console.log('INFO independent pads open: ' + J(near.ids));
check(near.ids.length >= 2 && near.pickNearA === near.expectA && near.pickNearB === near.expectB, `compass target = the nearest independent affordable pad (${near.pickNearA} near ${near.expectA}, ${near.pickNearB} near ${near.expectB})`);

// ---- A7/A8. sawmill: board batch (saw timer) and log delivery
const e7 = await measure(() => { const p0 = planks; sawmillAutoTimer = sawmillAutoInterval() + 0.1; updateSawmill(0.01); return { made: planks - p0 }; });
check(e7.out.made >= 1 && (e7.d.by.plank || 0) >= 1 && e7.d.b >= 1 && e7.d.colors.includes(0xc9a06a), `sawmill board batch: +${e7.out.made} planks, sfx.plank ${e7.d.by.plank}, burst ${e7.d.b}`);
const e8 = await measure(() => { const p0 = planks, n0 = logsInTransit.length; carriedLogs = 1; deliverCarriedLogs(); let i = 0; for (; i < 200 && logsInTransit.length > n0; i++) updateSawmill(0.1); return { made: planks - p0, steps: i }; });
check(e8.out.made >= 1 && (e8.d.by.plank || 0) >= 1 && e8.d.b >= 1, `hand-cut log delivered: +${e8.out.made} planks after ${e8.out.steps} steps, sfx.plank ${e8.d.by.plank}, burst ${e8.d.b}`);

async function finishAll() {
  await ev(() => { for (const b of growingMeshes) { for (const t of b.deliveryPlan || []) t.delivered = true; b.timer = Math.max(b.timer, b.duration - 0.05); } });
  return waitForState(page, () => growingMeshes.length === 0, null, { timeout: 40000 });
}
// ------------------------------------------------------------------ plates: cap, distance, HUD overlap, readability
await ev(() => { const keep = currentPad; window.__keepPad = keep; });
const PLATES = () => {
  const hud = ['hud', 'topRightBtns', 'nextCard'].map((id) => document.getElementById(id)).filter((e) => e && !e.hidden).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 1 && r.height > 1);
  const labels = []; scene.traverse((o) => { if (o.userData?.v152WorldLabel) labels.push(o); });
  const markerPlates = new Set(); for (const [id, grp] of industrialPadMarkersV118) { const sp = grp.children.find((c) => c.isSprite); if (sp) { markerPlates.add(sp); sp.userData.padIdV161 = id; } }
  const v = new THREE.Vector3(), ws = new THREE.Vector3(); camera.updateMatrixWorld(true);
  let chainVisible = 0, shown = 0, far = 0, underHud = 0, small = 0, minNear = 1e9; const rows = [];
  for (const l of labels) {
    let vis = l.visible; for (let p = l.parent; p && vis; p = p.parent) vis = p.visible;
    if (!vis) continue; chainVisible++;
    if (!(l.material.opacity > 0)) continue;
    shown++; l.getWorldPosition(v); const d = v.distanceTo(player.position); if (d > 24.5) far++;
    const cd = v.distanceTo(camera.position), pixels = innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.1, cd)); l.getWorldScale(ws);
    v.project(camera); const cx = (v.x + 1) * innerWidth / 2, cy = (1 - v.y) * innerHeight / 2, w = ws.x * pixels, h = ws.y * pixels;
    for (const r of hud) if (Math.abs(cx - (r.left + r.right) / 2) < (w + r.width) / 2 && Math.abs(cy - (r.top + r.bottom) / 2) < (h + r.height) / 2) underHud++;
    if (d < 9 && markerPlates.has(l)) { minNear = Math.min(minNear, w); if (w < 70) small++; }
    rows.push({ d: +d.toFixed(1), w: Math.round(w), y: Math.round(cy), pad: l.userData.padIdV161 || null });
  }
  return { total: labels.length, chainVisible, shown, far, underHud, small, minNear: minNear === 1e9 ? null : Math.round(minNear), rows };
};
const spots = await ev(() => {
  const s = INDUSTRIAL_BUILD_STEPS_V118.filter((x) => !x.built() && x.prereq()).map((x) => ({ id: x.id, x: x.pos.x, z: x.pos.z }));
  return { pads: s, sawmill: [SAWMILL_POS.x, SAWMILL_POS.z], metal: [METAL_YARD_POS.x, METAL_YARD_POS.z] };
});
console.log('INFO open pads: ' + J(spots.pads.map((p) => p.id)));
let worstShown = 0, worstFar = 0, worstHud = 0, worstSmall = 0, anyShown = 0, lastPlates = null;
const poses = [[spots.metal[0] + 4, spots.metal[1] + 3], [spots.sawmill[0] + 5, spots.sawmill[1] + 4], [0, 8], ...(spots.pads.length ? [[spots.pads[0].x + 3, spots.pads[0].z + 3]] : [])];
for (const [px, pz] of poses) {
  await ev(([x, z]) => { player.position.set(x, 0, z); }, [px, pz]);
  await page.waitForTimeout(1800);
  const P = await ev(PLATES);
  lastPlates = P; worstShown = Math.max(worstShown, P.shown); worstFar = Math.max(worstFar, P.far); worstHud = Math.max(worstHud, P.underHud); worstSmall = Math.max(worstSmall, P.small); anyShown += P.shown;
  console.log(`INFO plates at (${px.toFixed(0)},${pz.toFixed(0)}): ${P.total} plate sprites in the scene, ${P.chainVisible} with visible parents, ${P.shown} shown, near-plate min width ${P.minNear} px, rows ${J(P.rows)}`);
}
check(worstShown <= 4, `at most 4 plates are drawn at once (opacity > 0) at ${poses.length} spots (max ${worstShown}); scene has ${lastPlates.total} plate sprites (${lastPlates.chainVisible} with visible parents)`);
check(anyShown > 0 && worstFar === 0, `no plate is drawn beyond 24 m (${worstFar}) and plates do appear (${anyShown} drawn over the spots)`);
check(worstHud === 0, `no drawn plate overlaps the top HUD (#hud/#topRightBtns/#nextCard) at 390x664 (${worstHud})`);
check(worstSmall === 0, `pad plates (industrial/infra/chain markers) closer than 9 m are >= 70 px wide on screen (${worstSmall} too small)`);
// each open pad: standing 2.5 m beside it, ITS plate is drawn, wide enough and not under the HUD
const PADPLATE = (id) => {
  const grp = industrialPadMarkersV118.get(id), sp = grp && grp.children.find((c) => c.isSprite);
  if (!sp) return { none: true };
  const v = new THREE.Vector3(), ws = new THREE.Vector3(); camera.updateMatrixWorld(true);
  sp.getWorldPosition(v); const d = v.distanceTo(player.position), cd = v.distanceTo(camera.position), pixels = innerHeight / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.1, cd)); sp.getWorldScale(ws);
  v.project(camera); const cx = (v.x + 1) * innerWidth / 2, cy = (1 - v.y) * innerHeight / 2, w = ws.x * pixels, h = ws.y * pixels;
  let hud = 0; for (const hid of ['hud', 'topRightBtns', 'nextCard']) { const e = document.getElementById(hid); if (!e || e.hidden) continue; const r = e.getBoundingClientRect(); if (r.width > 1 && Math.abs(cx - (r.left + r.right) / 2) < (w + r.width) / 2 && Math.abs(cy - (r.top + r.bottom) / 2) < (h + r.height) / 2) hud++; }
  return { d: +d.toFixed(1), cd: +cd.toFixed(1), sx: +sp.scale.x.toFixed(2), base: sp.userData.v157LabelScale ? +sp.userData.v157LabelScale.x.toFixed(2) : null, fov: camera.fov, op: sp.material.opacity, w: Math.round(w), cx: Math.round(cx), cy: Math.round(cy), onScreen: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1, hud };
};
const padRows = [];
for (const p of spots.pads.slice(0, 4)) {
  await ev(([x, z]) => { player.position.set(x, 0, z); }, [p.x + 2.5, p.z + 2.5]);
  await waitForState(page, () => camera.position.distanceTo(player.position) < 14.5, null, { timeout: 15000 }); // the follow camera lags a teleport
  await page.waitForTimeout(900);
  padRows.push({ id: p.id, ...(await ev(PADPLATE, p.id)) });
  if (p.id === 'concrete3' || p.id === 'metal3') await shot('feel-pad-' + p.id);
}
console.log('INFO pad plates: ' + J(padRows));
check(padRows.length >= 3 && padRows.every((r) => !r.none && r.onScreen && r.op > 0 && r.w >= 70 && r.hud === 0), `standing 2.5 m beside each open pad (${padRows.length}) its own plate is drawn, >= 70 px wide, not under the HUD (${J(padRows.map((r) => [r.id, r.d, r.w, r.op > 0, r.hud]))})`);
await ev(([x, z]) => { player.position.set(x, 0, z); }, [spots.metal[0] + 3, spots.metal[1] + 2]);
await page.waitForTimeout(1500);
await shot('feel-plates-390x664');

// ------------------------------------------------------------------ C. polish
// (a) the thin white curve: innerPromenadeCurb follows the ring road
const ring = await ev(() => {
  const curb = scene.getObjectByName('innerPromenadeCurbV161');
  const tl = totalRoadLevelsV37();
  const r0 = { curb: !!curb, vis: curb?.visible, ring: outerRingRoad.visible, total: tl };
  // the west point of the user's observation: x ~ -53.5 on the ring r 54.0-54.5 (z ~ -7)
  const rr = Math.hypot(-53.5, -7.7);
  return { ...r0, radius: +rr.toFixed(2), inner: GROUND_HALF * 0.772, outer: GROUND_HALF * 0.779 };
});
check(ring.curb && ring.vis === ring.ring && ring.vis === false && ring.radius >= ring.inner - 0.2 && ring.radius <= ring.outer + 0.5, `the curve at x~-53.5 is r ${ring.radius} = innerPromenadeCurb (r ${ring.inner.toFixed(1)}-${ring.outer.toFixed(1)}): hidden together with the not-yet-unlocked ring road (curb ${ring.vis}, ring ${ring.ring}, road levels ${ring.total})`);
const ring2 = await ev(() => {
  const curb = scene.getObjectByName('innerPromenadeCurbV161'); setRingRoadEdgeVisibleV161(true); const on = curb.visible; setRingRoadEdgeVisibleV161(false); return { on, off: curb.visible };
});
check(ring2.on === true && ring2.off === false, 'setRingRoadEdgeVisibleV161 switches the curb with the ring road');

// (b) camera foliage fades by scale, shared materials untouched, exact restore, no flicker with the real pass
const fade = await ev(() => {
  const isSource = new Set(sourceTrees.map((t) => t.mesh));
  const root = cameraFoliageRoots.find((r) => r.visible && vegetationKindV154(r) === 'tree' && !isSource.has(r) && !sceneryRetiredV161(r) && r.userData.camFadeK === undefined)
    || cameraFoliageRoots.find((r) => r.visible && !isSource.has(r) && !sceneryRetiredV161(r));
  if (!root) return { none: true };
  const savedCam = camera.position.clone(), savedEye = camEyeTarget.clone();
  const p = root.getWorldPosition(new THREE.Vector3());
  const mats0 = []; root.traverse((o) => { if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) mats0.push([m, m.uuid, m.opacity, m.transparent]); });
  const base0 = root.scale.clone();
  const aim = (dz) => { camEyeTarget.set(p.x - 3, p.y + 1.4, p.z); camera.position.set(p.x + 3, p.y + 1.4, p.z + dz); camera.updateMatrixWorld(true); };
  aim(0);
  const out = { name: root.name || root.type, base: base0.x };
  updateCameraFoliageOcclusion();
  out.hit = hiddenCameraFoliage.includes(root);
  const seq = [], hitSeq = [], visSeq = [];
  for (let i = 0; i < 10; i++) { camFadeStepV161(0.05); seq.push(+(root.scale.x / base0.x).toFixed(3)); visSeq.push(root.visible); updateCameraFoliageOcclusion(); hitSeq.push(hiddenCameraFoliage.includes(root)); }
  out.seq = seq; out.visSeq = visSeq; out.stillWanted = hitSeq.every(Boolean);
  const baseObj = root.userData.camFadeBase;
  // away: the ray no longer passes the root
  camEyeTarget.set(p.x + 40, p.y + 1.4, p.z + 40); camera.position.set(p.x + 46, p.y + 1.4, p.z + 40); camera.updateMatrixWorld(true);
  updateCameraFoliageOcclusion(); out.releasedFromList = !hiddenCameraFoliage.includes(root);
  hiddenCameraFoliage.length = 0; // the far test ray may touch other roots: only the test root matters, the rest must also relax
  const grow = []; for (let i = 0; i < 12; i++) { camFadeStepV161(0.05); grow.push(+(root.scale.x / base0.x).toFixed(3)); }
  out.grow = grow;
  out.restored = Math.abs(root.scale.x - base0.x) < 1e-9 && Math.abs(root.scale.y - base0.y) < 1e-9 && Math.abs(root.scale.z - base0.z) < 1e-9 && root.visible === true;
  out.inActive = camFadeActiveV161.includes(root);
  out.sameBaseObj = root.userData.camFadeBase === baseObj;
  const mats1 = []; root.traverse((o) => { if (o.material) for (const m of (Array.isArray(o.material) ? o.material : [o.material])) mats1.push([m, m.uuid, m.opacity, m.transparent]); });
  out.matsSame = mats0.length === mats1.length && mats0.every((a, i) => a[0] === mats1[i][0] && a[1] === mats1[i][1] && a[2] === mats1[i][2] && a[3] === mats1[i][3]);
  out.mats = mats0.length;
  // drain every other root that the test ray touched
  for (let i = 0; i < 12; i++) camFadeStepV161(0.05);
  out.activeLeft = camFadeActiveV161.length;
  camera.position.copy(savedCam); camEyeTarget.copy(savedEye); camera.updateMatrixWorld(true);
  return out;
});
console.log('INFO fade: ' + J(fade));
check(!fade.none && fade.hit, `a foliage root on the camera ray is taken into the fade list (${fade.name})`);
check(fade.seq[0] < 1 && fade.seq.every((v, i) => i === 0 || v <= fade.seq[i - 1] + 1e-9) && fade.seq[fade.seq.length - 1] <= 0.06 && fade.visSeq[0] === true && fade.visSeq[fade.visSeq.length - 1] === false,
  `the root shrinks smoothly (${J(fade.seq)}), stays drawn while shrinking, is hidden only once ~0`);
check(fade.stillWanted, 'no flicker: the real occlusion pass keeps selecting the shrunk root (it is tested at full size)');
check(fade.releasedFromList && fade.grow[0] > fade.seq[fade.seq.length - 1] && fade.restored && !fade.inActive && fade.sameBaseObj, `leaving the ray: grows back (${J(fade.grow)}) to the exact base scale, visible, out of the fade list, base Vector3 reused`);
check(fade.matsSame && fade.mats > 0 && fade.activeLeft === 0, `materials untouched (${fade.mats} materials: same objects, opacity, transparent) and the fade list drains (${fade.activeLeft} left)`);

// (c) workers idle around the sawmill / real buildings, not around the removed camp (no construction site left to pull them away)
await finishAll();
const wk = await ev(() => {
  const real = [SAWMILL_POS, CONCRETE_PLANT_POS, METAL_YARD_POS, new THREE.Vector3(0, 0, 0), ...buildings.map((b) => b.pos)];
  const hall = sawmillObstaclesV161()[0], hc = Math.cos(hall.yaw), hs = Math.sin(hall.yaw);
  const inHall = (p) => { const dx = p.x - hall.pos.x, dz = p.z - hall.pos.z, lx = hc * dx - hs * dz, lz = hs * dx + hc * dz; return Math.abs(lx) < hall.hx && Math.abs(lz) < hall.hz; };
  const dReal = (p) => Math.min(...real.map((r) => Math.hypot(p.x - r.x, p.z - r.z)));
  const rows = [];
  for (const w of npcWorkers) {
    const home = w.homeBase;
    const picks = [];
    for (let i = 0; i < 4; i++) {
      w._v61NavQueue = null; w._v61Navigating = false; w.target = null; w.workBuild = null;
      chooseWorkerTarget(w);
      const fin = w._v61NavQueue && w._v61NavQueue.length ? w._v61NavQueue[w._v61NavQueue.length - 1] : w.target;
      if (fin) picks.push({ real: dReal(fin), camp: Math.hypot(fin.x - GENERATOR_POS.x, fin.z - GENERATOR_POS.z), hall: inHall(fin) });
    }
    rows.push({ role: w.role, home: home && [+home.x.toFixed(1), +home.z.toFixed(1)], homeCamp: home ? Math.hypot(home.x - GENERATOR_POS.x, home.z - GENERATOR_POS.z) : null, homeReal: home ? dReal(home) : null, maxReal: Math.max(...picks.map((p) => p.real)), minCamp: Math.min(...picks.map((p) => p.camp)), inHall: picks.filter((p) => p.hall).length, n: picks.length });
    w._v61NavQueue = null; w.target = null;
  }
  return rows;
});
console.log('INFO workers: ' + J(wk));
check(wk.length >= 4 && wk.every((r) => r.home && r.homeCamp > 6 && r.homeReal < 9), `${wk.length} workers: every home base is a real building spot, none at the removed camp (min camp distance ${Math.min(...wk.map((r) => r.homeCamp)).toFixed(1)} m)`);
check(wk.every((r) => r.n >= 3 && r.maxReal < 11 && r.minCamp > 5), `idle targets stay within 11 m of the sawmill / a real building (max ${Math.max(...wk.map((r) => r.maxReal)).toFixed(1)} m) and >= 5 m from the camp spot`);
check(wk.every((r) => r.inHall === 0), `no idle target lies inside the sawmill hall footprint (${wk.map((r) => r.inHall).join(',')} of ${wk.map((r) => r.n).join(',')} per worker)`);

// (d) toast spam: rhythm toast once per 20 s, identical general text once per 6 s; toasts per minute in this run
const spam = await ev(async () => {
  const el = document.getElementById('toast'); const seen = []; const mo = new MutationObserver(() => seen.push({ t: performance.now(), text: el.textContent })); mo.observe(el, { childList: true, characterData: true, subtree: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const t0 = performance.now();
  for (let i = 0; i < 6; i++) { toast(`🔥 Рабочий темп ${1 + (i % 3)}/3 — активная работа даёт небольшой бонус`); await wait(350); }
  for (let i = 0; i < 6; i++) { toast('🌲 Тест: одно и то же сообщение'); await wait(350); }
  await wait(4500); mo.disconnect();
  return { rhythm: seen.filter((s) => /Рабочий темп/.test(s.text)).length, same: seen.filter((s) => /Тест: одно и то же/.test(s.text)).length, ms: Math.round(performance.now() - t0) };
});
check(spam.rhythm <= 1, `6 "Рабочий темп" toasts in ${spam.ms} ms -> ${spam.rhythm} shown (cooldown 20 s overall, 2 min per text)`);
check(spam.same === 1, `the same general toast 6 times in ${spam.ms} ms -> ${spam.same} shown (6 s per text)`);
const perMin = await ev(() => { const t = window.__fx.toasts.map((x) => x.t), span = Math.max(1, (t[t.length - 1] - t[0]) / 60000); const worst = (() => { let w = 0; for (let i = 0; i < t.length; i++) { let n = 0; for (let j = i; j < t.length && t[j] - t[i] < 60000; j++) n++; w = Math.max(w, n); } return w; })(); return { n: t.length, minutes: +span.toFixed(2), worst60: worst }; });
console.log(`INFO toasts delivered in this run: ${perMin.n} over ${perMin.minutes} min, worst 60 s window ${perMin.worst60}`);
check(perMin.worst60 <= 30, `no 60 s window shows more than 30 toasts (worst ${perMin.worst60}; queue pace is >= 1.35 s per toast)`);

// ------------------------------------------------------------------ D. life: tree sway
const sway = await ev(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const st = animateFoliageV154.state, trees = st.trees || [], movers0 = trees.filter((t) => (t.userData.swayX || 0) !== 0).length;
  // stand in the middle of the trees
  const t0 = sourceTrees.find((t) => t.state === 'grown' && t.mesh.visible); player.position.set(t0.mesh.position.x + 2, 0, t0.mesh.position.z); await wait(1800);
  const moving = trees.filter((t) => (t.userData.swayX || 0) !== 0);
  const maxRot = Math.max(0, ...moving.map((t) => Math.abs(t.userData.swayX)));
  const nearList = st.nearTrees ? st.nearTrees.length : -1, nearMoving = (st.nearTrees || []).filter((t) => (t.userData.swayX || 0) !== 0).length;
  let far = null; for (let x = -60; x <= 60 && !far; x += 10) for (let z = -60; z <= 60 && !far; z += 10) if (trees.every((t) => Math.hypot(t.position.x - x, t.position.z - z) > 22)) far = [x, z];
  player.position.set(far ? far[0] : 0, 0, far ? far[1] : 60); await wait(3500);
  const left = trees.filter((t) => Math.abs(t.userData.swayX || 0) > 1e-6).length;
  const exact = trees.filter((t) => t.userData.swayBaseV161 !== undefined).every((t) => Math.abs(t.rotation.x - t.userData.swayBaseV161) < 1e-6 || Math.abs(t.userData.swayX) > 1e-6);
  return { trees: trees.length, movers0, moving: moving.length, nearMoving, nearList, maxRot: +maxRot.toFixed(4), left, exact, farSpot: far };
});
console.log('INFO sway: ' + J(sway));
check(sway.trees > 20 && sway.nearMoving >= 1 && sway.nearList <= 6, `only the nearest <= 6 of ${sway.trees} trees are driven (${sway.nearMoving} swaying, ${sway.nearList} picked, ${sway.moving} still non-zero incl. relaxing ones)`);
check(sway.maxRot > 0.002 && sway.maxRot <= 0.02, `sway is tiny: max ${sway.maxRot} rad on rotation.x`);
check(sway.farSpot && sway.left === 0 && sway.exact, `(far spot ${J(sway.farSpot)}) trees that are no longer near relax back to their original rotation (${sway.left} still swaying)`);

// ------------------------------------------------------------------ A3. gold tiers 6-10 and the level-10 fanfare (real upgradeBuilding + the animate() completion)
await finishAll();
await ev(() => { stageIndex = 8; money = 1e12; planks = 1e5; concrete = 1e4; metal = 1e4; framesV161 = 400; spawnBuilding(6, 5, { grow: false }); player.position.set(0, 0, 8); });
async function upgradeAndFinish(level) {
  const m0 = await mark();
  const r = await ev((lv) => { const e = buildings.find((b) => b.index === 6); e.level = lv - 1; e.underConstruction = false; const ok = upgradeBuilding(e, { fromQueue: true }); return { ok, level: e.level }; }, level);
  const started = await delta(m0);
  await ev(() => { const b = growingMeshes.find((x) => x.entry.index === 6); for (const t of b.deliveryPlan || []) t.delivered = true; b.timer = Math.max(b.timer, b.duration - 0.05); });
  const done = await waitForState(page, () => !buildings.find((b) => b.index === 6).underConstruction, null, { timeout: 40000 });
  if (level === 10) await waitForState(page, () => window.__fx.toasts.some((t) => /max!|максимум/.test(t.text)), null, { timeout: 12000 }); // the completion toast comes out of the toast queue
  else await page.waitForTimeout(800);
  return { r, started, done, all: await delta(m0) };
}
const u6 = await upgradeAndFinish(6);
check(u6.r.ok && u6.r.level === 6 && u6.done && u6.started.colors.includes(0xffd24a) && u6.all.colors.filter((c) => c === 0xffd24a).length >= 2 && (u6.all.by.prestige || 0) === 0,
  `level 6 (first gold tier): gold burst at the start and at completion (${J(u6.all.colors.map((c) => c.toString(16)))}), no fanfare (prestige sfx ${u6.all.by.prestige || 0})`);
const u10 = await upgradeAndFinish(10);
const crownShake = u10.all.shakes.find((s) => s[0] >= 0.17);
const crownToast = await ev(() => window.__fx.toasts.some((t) => /max!|максимум/.test(t.text)));
console.log('INFO last toasts: ' + J(await ev(() => window.__fx.toasts.slice(-8).map((t) => Math.round(t.t / 100) / 10 + ' ' + t.text.slice(0, 60)))));
check(u10.r.ok && u10.r.level === 10 && u10.done && (u10.all.by.prestige || 0) >= 1 && u10.all.colors.includes(0xfff1b8) && u10.all.colors.filter((c) => c === 0xffd24a).length >= 2 && !!crownShake && crownToast,
  `level 10: distinct fanfare (sfx.prestige ${u10.all.by.prestige}), white-gold + gold bursts (${J(u10.all.colors.map((c) => c.toString(16)))}), bigger shake ${J(crownShake)}, "level 10 (max!)" toast ${crownToast}`);
await shot('feel-level10-done');

// ------------------------------------------------------------------ mute silences everything; spam cap; bursts and shake clean up
await page.waitForTimeout(500);
const loud = await ev(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fx = window.__fx; if (muted) document.getElementById('muteBtn').click();
  await wait(400);
  const o0 = fx.osc; sfx.build(); await wait(50); const one = fx.osc - o0;
  await wait(400);
  const s0 = fx.osc; for (let i = 0; i < 10; i++) sfx.build(); const spam = fx.osc - s0;
  await wait(400);
  return { one, spam };
});
check(loud.one >= 1, `unmuted: a sound creates oscillators (${loud.one})`);
check(loud.spam <= 12, `unmuted spam is capped: 10 x sfx.build() created ${loud.spam} oscillators (<= 12 per 300 ms)`);
const quiet = await ev(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fx = window.__fx; document.getElementById('muteBtn').click(); const isMuted = muted;
  await wait(400);
  const o0 = fx.osc, b0 = fx.bursts.length, s0 = fx.shakes.length;
  for (const k of Object.keys(sfx)) if (typeof sfx[k] === 'function') { try { sfx[k](); } catch (_) {} }
  // real events while muted
  framesV161 = 0; planks = 1e4; metal = 1e3; PRODUCTION_CHAIN_V161.craft();
  upgradeCityDistrict('industrial');
  sawmillAutoTimer = sawmillAutoInterval() + 0.1; updateSawmill(0.01);
  await wait(300);
  const r = { muted: isMuted, osc: fx.osc - o0, bursts: fx.bursts.length - b0, shakes: fx.shakes.length - s0 };
  document.getElementById('muteBtn').click(); // restore
  return r;
});
check(quiet.muted && quiet.osc === 0 && quiet.bursts >= 1, `muted: every sfx.* and the real events (frame, sawmill batch, district) create 0 oscillators (${quiet.osc}) while the visuals still fire (${quiet.bursts} bursts)`);
const clean = await ev(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const before = new Set(particleBursts);
  for (let i = 0; i < 60; i++) spawnBurst(new THREE.Vector3(i, 0, 0), 0xffd479);
  const capped = particleBursts.length, mine = particleBursts.filter((b) => !before.has(b));
  const t0 = performance.now();
  while (mine.some((b) => particleBursts.includes(b)) && performance.now() - t0 < 40000) await wait(250);
  const burstPoints = mine.filter((b) => b.points.parent !== null).length;
  triggerShake(0.17, 0.34); let max = 0; const t1 = performance.now();
  while (shakeTime > 0 && performance.now() - t1 < 20000) { max = Math.max(max, shakeOffset.length()); await wait(40); }
  await wait(400);
  return { capped, mine: mine.length, left: mine.filter((b) => particleBursts.includes(b)).length, burstPoints, max, shakeTime, off: shakeOffset.length() };
});
check(clean.capped <= 30 && clean.mine >= 1 && clean.left === 0 && clean.burstPoints === 0, `60 bursts at once: ${clean.mine} accepted, live total capped at ${clean.capped} (<= 30), all expire (${clean.left} left), 0 of them stay in the scene (${clean.burstPoints})`);
check(clean.max > 0 && clean.shakeTime <= 0 && clean.off === 0, `shake decays: peak offset ${clean.max.toFixed(4)}, final offset ${clean.off}`);

// ------------------------------------------------------------------ report: draw calls, errors
const rep = await ev(() => { let meshes = 0; scene.traverse((o) => { if (o.isMesh && o.visible) meshes++; }); return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, meshes, active: camFadeActiveV161.length }; });
console.log(`INFO draw calls ${rep.calls}, triangles ${rep.tris}, visible meshes ${rep.meshes}, fading roots ${rep.active}; run took ${Math.round((Date.now() - T0) / 1000)} s`);
check(g.errors.length === 0, `0 console errors (${J(g.errors.slice(0, 3))})`);
check(g.badResponses.length === 0, `0 4xx responses (${J(g.badResponses.slice(0, 3))})`);
await g.close();
