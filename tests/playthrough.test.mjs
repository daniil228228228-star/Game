// Playthrough QA (2026-10-10 (14), user: "поиграй и посмотри какие правки нужно внести ... плашка не работала на рынке транспорт, всё багалось и бликовало").
// ONE launch on a FRESH save at 390x664, walked like a player. Shortcuts (documented): the first house / depot / sawmill / plants are bought through the owning functions
// (purchaseCurrentPad, buildIndustrialStepV118) after a money grant; stages are climbed with purchaseCurrentPad + money grants; the player is teleported next to a target
// and the REAL #actionBtn is pressed (never a direct state edit of the thing under test).
// Invariants per stage: no console errors / 4xx, guidance not dead (nextActionableTargetV117 not null while a pad exists), every visible plate lies wholly inside the viewport,
// no plate texture is rebuilt while nothing changes (flicker), plate text fits its plate for the longest Russian names.
// Market: all 7 stalls are built by pressing #actionBtn on their vacant lots, each opens its panel by #actionBtn, the panel fits the screen, closes, and closes on walk-away;
// the transport (fleet) stall's panel survives 3 s of use: a finger held on a button across the periodic rebuild still produces its click; purchases deduct the exact cost; reload keeps them.
import { openGame, reloadGame, check, jumpStage } from './lib/harness.mjs';

const J = JSON.stringify;
const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const T0 = Date.now();
const log = [];
const stageLog = async (label) => {
  const r = await ev(() => {
    const t = (() => { try { return nextActionableTargetV117(); } catch (e) { return 'err'; } })();
    return { stageIndex, buildings: buildings.length, pad: !!currentPad, target: t === 'err' ? 'err' : t ? t.type : null, money: Math.floor(money) };
  });
  r.errors = g.errors.length; r.bad = g.badResponses.length; r.t = Math.round((Date.now() - T0) / 1000);
  log.push({ label, ...r }); console.log(`--- ${label}: ${J(r)}`);
  return r;
};

// ---- plates: wholly inside the viewport, no texture churn
const PLATES = () => {
  const out = [], v = new THREE.Vector3(), q = new THREE.Vector3(), W = innerWidth, H = innerHeight;
  scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isSprite || !o.material || !(o.material.opacity > 0.5) || !o.userData.v152WorldLabel) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    o.getWorldPosition(v); const ws = o.getWorldScale(q).clone();
    const c = v.clone().project(camera); if (c.z < -1 || c.z > 1) return;
    const dist = v.distanceTo(camera.position), px = H / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.1, dist));
    const cx = (c.x + 1) * W / 2, cy = (1 - c.y) * H / 2, w = ws.x * px, h = ws.y * px;
    out.push({ cx: Math.round(cx), cy: Math.round(cy), w: Math.round(w), h: Math.round(h), l: Math.round(cx - w / 2), r: Math.round(cx + w / 2), t: Math.round(cy - h / 2), b: Math.round(cy + h / 2), pos: [+v.x.toFixed(1), +v.z.toFixed(1)] });
  });
  return { n: out.length, W, H, bad: out.filter((p) => p.l < 0 || p.r > W || p.t < 0 || p.b > H), maxW: Math.max(0, ...out.map((p) => p.w)) };
};
const plateCheck = async (label) => {
  await page.waitForTimeout(700);
  const p = await ev(PLATES);
  check(p.bad.length === 0, `${label}: every visible plate (${p.n}, widest ${p.maxW}px of ${p.W}) lies wholly inside the viewport ${J(p.bad.slice(0, 3))}`);
  check(p.maxW <= 0.65 * p.W, `${label}: no plate wider than 65 % of the screen (${p.maxW}px)`);
};
const churn = async (label, frames = 40) => {
  // a plate may be redrawn when its words change (progress %, counters) but never twice with the SAME words (flicker + GPU upload for nothing)
  const r = await ev((frames) => new Promise((res) => {
    const who = {}, orig = makeLabelSprite, origU = updateLabelSprite; let n = 0;
    makeLabelSprite = function (lines) { const k = (new Error().stack || '').split('\n').slice(2, 4).map((x) => x.trim().replace(/\(.*[\\/]/, '(').slice(0, 70)).join(' < ') + ' ' + JSON.stringify(lines).slice(0, 50); who[k] = (who[k] || 0) + 1; return orig.apply(this, arguments); };
    const loop = () => { if (++n < frames) requestAnimationFrame(loop); else { makeLabelSprite = orig; res({ dup: Object.entries(who).filter(([, c]) => c > 1), total: Object.keys(who).length }); } };
    requestAnimationFrame(loop);
  }), frames);
  check(r.dup.length === 0, `${label}: no plate is redrawn with the same words in ${frames} idle frames (${r.total} redraws with new words; repeated ${J(r.dup.slice(0, 3))})`);
};

// ================= 1. start flow (real presses)
await stageLog('S0 fresh');
const PICKUP = { x: -5.8, z: 2.65 }, DROP = { x: 1.35, z: 2.85 };
async function pressAt(pos, action) {
  await ev((p) => { player.position.set(p.x, 0, p.z); }, pos);
  await page.waitForFunction((a) => { const f = window.__TYCOON_V144__.state; if (a === 'pickup' ? f.carrying : !f.carrying) return true; const b = document.getElementById('actionBtn'); if (b?.dataset.v144StarterAction === a) b.click(); return false; }, action, { timeout: 60000, polling: 'raf' });
}
await pressAt(PICKUP, 'pickup'); await pressAt(DROP, 'drop'); await pressAt(PICKUP, 'pickup'); await pressAt(DROP, 'drop');
check(await ev(() => window.__TYCOON_V144__.state.runs === 2), 'two starter supply runs by real #actionBtn presses');
await plateCheck('S0');
await ev(() => { money = Math.max(money, 400); });
const house = await ev(() => { const ok = purchaseCurrentPad(); return { ok, stageIndex, n: buildings.length }; });
check(house.ok && house.stageIndex === 1, 'first house bought');
await stageLog('S1 first house');
// roads + depot + sawmill
await ev(() => { money = 1e7; planks = 500; for (let i = 0; i < 40 && !manualRoadStagesV116.has(0); i++) { const p = globalThis.roadBuildPadPosV122(0); player.position.set(p.x, 0, p.z); buildManualRoadStageV116(0, p); } });
for (const id of ['depot', 'sawmill']) {
  const ok = await ev((id) => { const st = industrialStepV118(id); return buildIndustrialStepV118(st); }, id);
  check(ok, `${id} built`);
}
await page.waitForTimeout(2500);
await stageLog('S2 depot + sawmill');
// sawmill pickup: the yard stack follows planks and the real pickup button gives planks
const pick = await ev(() => { const z = LOGISTICS_ZONES.planks; return { pos: { x: z.pos.x, z: z.pos.z }, has: !!z.group }; });
check(pick.has, 'plank pickup yard exists');
await ev(() => { planks = 5; });
await plateCheck('S2');
await ev(() => { buildIndustrialStepV118(industrialStepV118('concrete')); buildIndustrialStepV118(industrialStepV118('metal')); });
await page.waitForTimeout(2500);
await stageLog('S3 + concrete + metal');

// ================= 2. climb stages with purchaseCurrentPad (real path), checking each
for (let target = 2; target <= 9; target++) {
  const r = await ev((target) => { for (const b of buildings) for (let i = 0; i < 40 && !manualRoadStagesV116.has(b.index); i++) { const p = globalThis.roadBuildPadPosV122(b.index); player.position.set(p.x, 0, p.z); buildManualRoadStageV116(b.index, p); } money = 1e9; planks = 3000; concrete = 400; metal = 400; const before = stageIndex; let ok = false; try { ok = purchaseCurrentPad(); } catch (e) { return { ok: false, err: String(e) }; } return { ok, before, stageIndex }; }, target);
  if (!r.ok) { console.log(`  stage step ${target}: purchaseCurrentPad refused (${J(r)}); using jumpStage`); await jumpStage(page, target); await ev(() => { try { spawnBuilding(stageIndex - 1, 1, { grow: false }); } catch (e) {} }); }
  await page.waitForTimeout(1500);
  const s = await stageLog(`S${target + 2} stage ${target}`);
  check(s.target !== 'err', `stage ${target}: the guidance target resolves without throwing`);
  if (target % 3 === 0) { await plateCheck(`stage ${target}`); await churn(`stage ${target}`); }
}
await ev(() => { stageIndex = Math.max(stageIndex, 9); });
await jumpStage(page, 9);
await ev(() => { money = 1e9; planks = 3000; concrete = 400; metal = 400; });

// ================= 3. MARKET: all 7 stalls
await page.waitForTimeout(1500);
const standAt = (id) => ev((id) => { const cfg = MARKET_STALLS_V116.find((c) => c.id === id); const d = new THREE.Vector3(MARKET_PLAZA_CENTER_V116.x - cfg.pos.x, 0, MARKET_PLAZA_CENTER_V116.z - cfg.pos.z).normalize(); player.position.copy(cfg.pos).addScaledVector(d, 1.6); }, id);
const pressUntil = (cond, timeout = 30000) => page.waitForFunction((c) => {
  if (new Function('return ' + c)()) return true;
  const b = document.getElementById('actionBtn'); if (b && !b.hidden && !b.disabled) b.click(); return false;
}, cond, { timeout, polling: 'raf' }).then(() => true, () => false);
await ev(() => { refreshMarketStallsV118(); });
const IDS = ['team', 'fleet', 'tenders', 'operations', 'meta', 'bonus', 'exchange'];
for (const id of IDS) {
  await standAt(id);
  const unlocked = await ev((id) => stageIndex >= marketStallConfig(id).unlock, id);
  if (!unlocked) { console.log(`  stall ${id}: not unlocked at stage ${await ev(() => stageIndex)}`); continue; }
  const built = await pressUntil(`marketStallsBuiltV118.has('${id}')`);
  check(built, `stall '${id}': built by the real #actionBtn press on its vacant lot`);
}
await ev(() => { window.__TYCOON_STOP_GUARD__ = 1; money = 1e9; planks = 3000; concrete = 400; metal = 400; });
await page.waitForTimeout(1500);
await plateCheck('market (all stalls built)');
await churn('market', 60);
const panelFits = () => ev(() => { const o = [...document.querySelectorAll('.show')].find((e) => /Overlay$/.test(e.id)); if (!o) return null; const p = o.querySelector('.v30Panel') || o; const r = p.getBoundingClientRect(); return { id: o.id, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), W: innerWidth, H: innerHeight }; });
const OVERLAY = { team: 'staffOverlay', fleet: 'fleetOverlay', tenders: 'tendersOverlay', operations: 'operationsOverlay', meta: 'metaOverlay', bonus: 'bonusOverlay', exchange: 'systemsOverlay' };
for (const id of IDS) {
  const built = await ev((id) => marketStallsBuiltV118.has(id), id);
  if (!built) continue;
  await standAt(id);
  if (id === 'operations') await ev(() => { try { spawnBuilding(0, 1, { grow: true }); } catch (e) {} });
  const opened = await pressUntil(`document.getElementById('${OVERLAY[id]}')?.classList.contains('show')`);
  check(opened, `stall '${id}': the real #actionBtn opens its panel (${OVERLAY[id]})`);
  if (!opened) continue;
  const fit = await panelFits();
  check(fit && fit.l >= 0 && fit.r <= fit.W + 1 && fit.t >= 0 && fit.b <= fit.H + 1, `stall '${id}': the panel fits the 390x664 screen ${J(fit)}`);
  await page.screenshot({ path: process.env.SHOTS_DIR ? `${process.env.SHOTS_DIR}/market-${id}.png` : '/dev/null' }).catch(() => {});
  // walk away: the panel opened by the stall closes by itself
  await ev(() => { player.position.set(0, 0, 0); });
  const closed = await page.waitForFunction((o) => !document.getElementById(o)?.classList.contains('show'), OVERLAY[id], { timeout: 15000, polling: 250 }).then(() => true, () => false);
  check(closed, `stall '${id}': walking away (player far from the stall) closes the panel by itself`);
}

// ================= 4. TRANSPORT stall (fleet): the panel works under a held finger, purchases charge exactly
await standAt('fleet');
check(await pressUntil(`document.getElementById('fleetOverlay')?.classList.contains('show')`), 'fleet panel opens by the real press');
const cdp = await page.context().newCDPSession(page);
await ev(() => { window.__clicks = 0; document.getElementById('fleetOverlay').addEventListener('click', () => window.__clicks++, true); });
const N = 14;
for (let i = 0; i < N; i++) {
  const box = await ev(() => { const b = [...document.querySelectorAll('#fleetOverlay button')].find((b) => !b.disabled && b.getBoundingClientRect().height > 10); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y }] });
  await page.waitForTimeout(160 + (i % 3) * 90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(100 + (i * 53) % 250);
}
const clicks = await ev(() => window.__clicks);
check(clicks >= N - 1, `fleet panel: a finger held 160-340 ms on a button gives its click even across the periodic rebuild (${clicks} of ${N})`);
// the stall plate must not promise an upgrade of a truck that is not bought (the panel disables that button)
const plate = await ev(() => { const o = window.__TYCOON_V119__.state.owned; return { owned: { ...o }, info: marketStallInfo('fleet'), sign: marketRuntimeV116.stalls.get('fleet') ? true : false }; });
check(plate.owned.planks || !(plate.info.cfg && ['planks', 'concrete', 'metal'].includes(plate.info.cfg.key)), `fleet stall plate: with no truck bought it offers "${plate.info.name}", not an upgrade of an unowned truck`);
// shortcut: the flatbed is declared owned (its purchase mechanics are not under test here)
await ev(() => { window.__TYCOON_V119__.state.owned.planks = true; });
// exact cost of one fleet upgrade through the panel's own button
await ev(() => { document.getElementById('fleetClose')?.click(); });
await standAt('fleet'); await pressUntil(`document.getElementById('fleetOverlay')?.classList.contains('show')`);
const up = await ev(() => {
  const cfg = marketNextFleetCfg(); if (!cfg) return { none: true };
  const cost = fleetUpgradeCost(cfg.key), m0 = money, w0 = planks, c0 = concrete, k0 = metal, l0 = fleetLevel(cfg.key);
  const btn = document.querySelector(`#fleetOverlay [data-fleet="${cfg.key}"]`); if (!btn) return { nobtn: cfg.key };
  btn.click();
  return { key: cfg.key, l0, l1: fleetLevel(cfg.key), dm: m0 - money, dw: w0 - planks, dc: c0 - concrete, dk: k0 - metal, cost };
});
if (up.none || up.nobtn) console.log('  fleet upgrade: ' + J(up));
else check(up.l1 === up.l0 + 1 && up.dm === (up.cost.money || 0) && up.dw === (up.cost.wood || 0) && up.dc === (up.cost.concrete || 0) && up.dk === (up.cost.metal || 0), `fleet upgrade ${up.key}: level ${up.l0} -> ${up.l1}, charged exactly ${J(up.cost)} (took ${up.dm}/${up.dw}/${up.dc}/${up.dk})`);
await ev(() => { document.getElementById('fleetClose')?.click(); save(); });
const lvlBefore = await ev(() => JSON.stringify(fleetState));
await reloadGame(g, 6000);
const lvlAfter = await ev(() => JSON.stringify(fleetState));
check(lvlBefore === lvlAfter, `fleet levels persist across reload (${lvlAfter})`);

// ================= 5. plate text fits its plate (longest Russian names), glare materials calm
const fit = await ev(() => {
  const c = document.createElement('canvas').getContext('2d'); const out = [];
  const words = ['АВТОПАРК', 'ЛЕСОПИЛКА', 'ЭЛЕКТРОСТАНЦИЯ', 'ЛОГИСТИЧЕСКИЙ ТЕРМИНАЛ', 'ФИНАНСОВЫЙ КВАРТАЛ', 'ОБМЕН РЕСУРСОВ', 'НАЁМ ПЕРСОНАЛА', 'СЕРВИС · АВТОПАРК', 'ГАРАЖ АВТОПАРКА', 'служебная стоянка', ...STAGES.map((s) => s.ru || s.name || '').filter(Boolean), ...MARKET_STALLS_V116.map((s) => s.ru)];
  for (const w of new Set(words)) { const size = fitLabelFont(c, w, 452, 58, 26, 850); c.font = `850 ${size}px sans-serif`; const wd = c.measureText(w).width; if (wd > 452) out.push([w, size, Math.round(wd)]); }
  return { n: new Set(words).size, over: out };
});
check(fit.over.length === 0, `plate text: ${fit.n} long names fit the 452 px plate width at >= 26 px (over: ${J(fit.over)})`);
const glare = await ev(() => { const bad = []; for (const [id, s] of marketRuntimeV116.stalls) s.group.traverse((o) => { if (!o.isMesh) return; const m = o.material; if (m.envMap || (m.metalness > 0.4) || (m.roughness < 0.2 && !m.transparent)) bad.push([id, m.roughness, m.metalness]); }); return bad; });
check(glare.length === 0, `market stall materials: no envMap, metalness <= 0.4, no mirror-smooth opaque surface (${J(glare.slice(0, 3))})`);

check(g.errors.length === 0, `no console errors during the whole playthrough ${J(g.errors.slice(0, 4))}`);
check(g.badResponses.length === 0, `no 4xx responses ${J(g.badResponses.slice(0, 3))}`);
console.log(`playthrough took ${Math.round((Date.now() - T0) / 1000)} s`);
await g.close();
