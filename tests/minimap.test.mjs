// Minimap + big map + debug movement tools (docs/MINIMAP_SPEC.md, assets/minimap-v161.js).  node tests/minimap.test.mjs   (SHOTS_DIR=dir writes phone screenshots)
//   launch 1 (layout C, fresh game, 390x664 then 360x640): the base canvas is DRAWN FROM THE PLAN DATA (asphalt under edge centres, sea = sea colour), the player marker sits where the player is
//            (minimap centre, big map projection, also after a move and in camera-up mode), open / close (tap, button, Escape), drag pans by the finger distance, wheel / buttons zoom, the dock
//            does not overlap any other HUD piece (stat chips, menu button, carry / coach / shift cards, toast, action button, joystick, stamina) at both phone sizes, teleport (real tap +
//            "Телепорт сюда" button; ground; water -> nearest shore; collider -> pushed out; deck-only point -> player stands ON the deck; the camera keeps its offset; the real loop does not
//            reset him), speed chip x1 -> x3 -> x6 (movement ratio through the real updatePlayer, saved in localStorage, survives a reload, walls and the shore still stop him at x6, the
//            plan-C height follows on a ramp), debug off (`?debug=0`: no teleport button, no speed chip, speed forced to x1), night tint, cost per update, draw calls / scene children unchanged
//   launch 2 (OLD_SAVE = layout B): simplified map (mode B), dock visible and placed, teleport / speed work inside the island, road signature 51 / -720375465 unchanged
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { openGame, reloadGame, check, OLD_SAVE, startServer } from './lib/harness.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const J = JSON.stringify;
const ctxVm = { window: {} }; vm.createContext(ctxVm); vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/plan-c-data-v161.js'), 'utf8'), ctxVm);
const D = ctxVm.window.PlanCDataV161;

const PAGE = () => {
  window.__rects = () => {
    const vis = (el) => { if (!el || el.hidden) return null; const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return null; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? r : null; };
    const out = {};
    const add = (name, el) => { const r = vis(el); if (r) out[name] = [r.left, r.top, r.right, r.bottom]; };
    document.querySelectorAll('#hud .stat').forEach((e, i) => add('stat' + i, e));
    document.querySelectorAll('#topRightBtns .iconBtn').forEach((e, i) => add('btn' + i, e));
    for (const id of ['carryRouteV139', 'manualCoachV143', 'shiftGoalV127', 'toast', 'eventBanner', 'actionBtn', 'actionPrompt', 'joyBase', 'staminaWrap', 'nextCard', 'contractsCard', 'companyChip', 'jumpBtn']) add(id, document.getElementById(id));
    add('mapBtn', document.getElementById('miniMapV161')); add('speedBtn', document.getElementById('speedBtnV161'));
    return out;
  };
  window.__sig = () => {
    const roads = [];
    scene.traverse((o) => { if (!o.isMesh) return; for (let p = o.parent; p; p = p.parent) { if (p.name === 'v70RefinedServiceRoads' || p.name === 'v113UnifiedStarterRoadSurface' || p === cityWorldRuntime?.stageRoads) { roads.push(o); break; } } });
    scene.updateMatrixWorld(true);
    const strs = roads.map((o) => { const b = new THREE.Box3().setFromObject(o); return [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => v.toFixed(2)).join(','); }).sort();
    let h = 5381; for (const s of strs.join('|')) h = ((h << 5) + h + s.charCodeAt(0)) | 0;
    return { count: roads.length, hash: h };
  };
  window.__frames = (n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res(true) : requestAnimationFrame(f)); f(); setTimeout(() => res(false), 25000); });
  // forced transient cards (same trick as premium-ui.test): the worst top HUD state
  window.__forceCards = () => {
    const mk = (id, html) => { let el = document.getElementById(id); if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); } if (html) el.innerHTML = html; el.hidden = false; for (const [k, v] of [['display', 'block'], ['visibility', 'visible'], ['opacity', '1']]) el.style.setProperty(k, v, 'important'); return el; };
    mk('carryRouteV139', '<div class="v139Line"><span class="v139Arrow">↑</span><span>На погрузку: 🪵 1</span><span class="v139Dist">23 м</span></div><div class="v139Meta">Забрать: ДОСКИ · 0/1 · 23 м</div>');
    mk('manualCoachV143', '1/3 · Иди к золотому маяку');
    for (const id of ['carryRouteV139', 'manualCoachV143']) { const el = document.getElementById(id); if (el.__keepOn) continue; el.__keepOn = true; el.classList.add('show'); new MutationObserver(() => { if (el.hidden) el.hidden = false; }).observe(el, { attributes: true, attributeFilter: ['hidden'] }); }   // the game re-hides them every frame (hud.test does the same)
    toast('Помощь принята · ускорение 1.1с · энергия 2/3');
  };
  window.__inside = () => { const c = gatherPhysicsCircles(), v = playerVelocity.clone(), s = resolvePlayerCircleCollisions(player.position.x, player.position.z, c); playerVelocity.copy(v); return Math.hypot(s.x - player.position.x, s.z - player.position.z); };
};
const overlap = (a, b, pad = 0) => a[0] < b[2] + pad && b[0] < a[2] + pad && a[1] < b[3] + pad && b[1] < a[3] + pad;
const pairs = (rects, mine) => { const bad = []; for (const m of mine) if (rects[m]) for (const k of Object.keys(rects)) if (k !== m && !mine.includes(k) && overlap(rects[m], rects[k])) bad.push(m + ' x ' + k); return bad; };
async function run(fn) { try { await fn(); } catch (e) { console.error('FAIL: launch crashed: ' + (e && e.stack || e)); process.exitCode = 1; } }

// ================================ offline: data the tests rely on ================================
const edgeMids = D.graph.edges.filter((e) => ['arterial', 'collector', 'local'].includes(e[3]) && Math.hypot(e[6] - e[4], e[7] - e[5]) > 30).map((e) => [(e[4] + e[6]) / 2, (e[5] + e[7]) / 2]);
// a point with a deck but no ground (a causeway / elevated carriageway) and a long clear open stretch for the speed runs
let DECK = null;
for (let x = -300; x < 400 && !DECK; x += 2) for (let z = -370; z < 262; z += 2) { const s = D.surfaces(x, z); if (s.length && !s.includes(0) && D.access(x, z, 0.6) && s[0] > 0.2) { DECK = [x, z, s[0]]; break; } }
check(!!DECK, `data: a deck-only point exists for the teleport test (${J(DECK)})`);

// ================================ launch 1: layout C ================================
await run(async () => {
  const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
  const { page } = g, ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    await page.waitForFunction(() => window.MiniMapV161 && MiniMapV161.ready, null, { timeout: 90000 });
    check(await ev(() => MiniMapV161.mode === 'C' && MiniMapV161.debug === true), 'layout C: map mode C, debug tools on by default');
    // ---- 1. the base map is drawn from the plan data
    const px = await ev((mids) => {
      const M = MiniMapV161, c = M.base, ctx = c.getContext('2d', { willReadFrequently: true }), D = PlanCDataV161, s = M.baseScale, b = M.baseBox;
      const rgb = (hexNum) => [(hexNum >> 16) & 255, (hexNum >> 8) & 255, hexNum & 255];
      const at = (x, z) => { const d = ctx.getImageData(Math.round((x - b.x0) * s), Math.round((z - b.z0) * s), 1, 1).data; return [d[0], d[1], d[2]]; };
      const near = (a, bb, t) => Math.abs(a[0] - bb[0]) <= t && Math.abs(a[1] - bb[1]) <= t && Math.abs(a[2] - bb[2]) <= t;
      const asph = rgb(D.colors[D.palette.asph]), sea = rgb(D.colors[D.palette.sea]);
      const okc = [D.palette.asph, D.palette.median, D.palette.medLawn, D.palette.medM, D.palette.conc, D.palette.ramp, D.palette.walk].map((i) => rgb(D.colors[i]));
      let hit = 0; const miss = []; for (const [x, z] of mids) { const p = at(x, z); if (okc.some((c) => near(p, c, 14))) hit++; else miss.push([Math.round(x), Math.round(z), p]); }
      return { n: mids.length, hit, miss: miss.slice(0, 6), seaPx: at(-100, 235), sea, size: [c.width, c.height] };
    }, edgeMids).catch(() => null);
    check(px && px.hit >= px.n * 0.9, `base map: road surface colour (asphalt / median / deck) under the centre of ${px && px.hit}/${px && px.n} long streets (>= 90 %; misses ${px && J(px.miss)})`);
    check(px && Math.abs(px.seaPx[0] - px.sea[0]) < 16 && Math.abs(px.seaPx[2] - px.sea[2]) < 16, `base map: the sea is drawn in the sea colour (${px && J(px.seaPx)} vs ${px && J(px.sea)})`);
    check(px && px.size[0] * px.size[1] <= 3.2e6, `base canvas pixels ${px && px.size.join('x')} <= 3.2 M (phone memory)`);
    const build = await ev(() => ({ ms: MiniMapV161.baseMs }));
    console.log(`info: base map drawn in ${Math.round(build.ms)} ms (time-sliced, 8 ms per slice; software GL)`);

    // ---- 2. player marker == player position (minimap centre, big map projection)
    const markerAt = async (x, z, label) => {
      await ev(([x, z]) => { player.position.set(x, 0, z); PlanCV161.level = 0; MiniMapV161.drawMini(); }, [x, z]);
      const m = await ev(() => { const c = document.querySelector('#miniMapV161 canvas'), d = c.getContext('2d').getImageData(c.width / 2 - 3, c.height / 2 - 3, 7, 7).data; let gold = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150 && d[i + 1] < 215 && d[i + 2] < 140) gold++; return gold; });
      check(m >= 4, `minimap: the gold player arrow is at the centre of the map at ${label} (${m} gold px)`);
    };
    await markerAt(11, -11, 'spawn');
    await markerAt(100, 60, '(100, 60)');
    await ev(() => { MiniMapV161.setSpeed(1); MiniMapV161.open(); });
    await page.waitForTimeout(400);
    const big = await ev(() => {
      const M = MiniMapV161, out = [];
      for (const [x, z] of [[100, 60], [60, 20], [-30, -90]]) {
        player.position.set(x, 0, z); player.rotation.y = 0.8; stCacheReset(); M.redraw();
        const [sx, sy] = M.worldToScreen(x, z), c = document.querySelector('#bigMapV161 canvas'), r = c.getBoundingClientRect(), k = c.width / r.width;
        const ctx = c.getContext('2d'); const d = ctx.getImageData(Math.round((sx - r.left) * k) - 4, Math.round((sy - r.top) * k) - 4, 9, 9).data;
        let gold = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150 && d[i + 1] < 215 && d[i + 2] < 140) gold++;
        out.push({ x, z, sx, sy, gold, inView: sx > r.left && sx < r.right && sy > r.top && sy < r.bottom });
      }
      return out;
      function stCacheReset() { MiniMapV161.drawMini(); }
    });
    for (const b of big) check(b.gold >= 3 || !b.inView, `big map: the player arrow is drawn at the projection of the player (${b.x}, ${b.z}) -> screen (${Math.round(b.sx)}, ${Math.round(b.sy)}), ${b.gold} gold px`);
    // pan so that every point of the world is reachable, then check the projection again off centre
    await ev(() => { MiniMapV161.setView(160, 40, 2.4); const p = player; p.position.set(150, 0, 30); MiniMapV161.redraw(); });
    await page.waitForTimeout(250);
    const off = await ev(() => { const M = MiniMapV161; M.redraw(); const [sx, sy] = M.worldToScreen(150, 30), c = document.querySelector('#bigMapV161 canvas'), r = c.getBoundingClientRect(), k = c.width / r.width; const d = c.getContext('2d').getImageData(Math.round((sx - r.left) * k) - 4, Math.round((sy - r.top) * k) - 4, 9, 9).data; let gold = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150 && d[i + 1] < 215 && d[i + 2] < 140) gold++; return { gold, sx, sy }; });
    check(off.gold >= 3, `big map zoomed 2.4 and panned: the arrow is at the projection of the player (${off.gold} gold px at ${Math.round(off.sx)}, ${Math.round(off.sy)})`);
    await ev(() => { MiniMapV161.close(); });

    // ---- 3. open / close / drag / zoom
    check(await ev(() => document.getElementById('bigMapV161').hidden === true), 'big map is closed at start');
    await page.click('#miniMapV161');
    check(await ev(() => !document.getElementById('bigMapV161').hidden && MiniMapV161.isOpen()), 'a tap on the minimap opens the big map');
    await page.click('#bigMapClose');
    check(await ev(() => document.getElementById('bigMapV161').hidden === true), 'the close button closes it');
    await page.click('#miniMapV161'); await page.keyboard.press('Escape');
    check(await ev(() => document.getElementById('bigMapV161').hidden === true), 'Escape closes it');
    await page.click('#miniMapV161');
    await ev(() => { MiniMapV161.setView(100, 60, 1.6); });
    const before = await ev(() => ({ ...MiniMapV161.view }));
    const box = await ev(() => { const r = document.querySelector('#bigMapV161 canvas').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
    await page.mouse.move(box[0] + 200, box[1] + 300); await page.mouse.down(); await page.mouse.move(box[0] + 150, box[1] + 260, { steps: 4 }); await page.mouse.up();
    const after = await ev(() => ({ ...MiniMapV161.view }));
    check(Math.abs((after.cx - before.cx) - 50 / before.k) < 1.5 && Math.abs((after.cz - before.cz) - 40 / before.k) < 1.5, `dragging the finger 50 px left / 40 px up moves the map centre 50 / 40 px right / down in metres (dcx ${(after.cx - before.cx).toFixed(1)} m expected ${(50 / before.k).toFixed(1)}, dcz ${(after.cz - before.cz).toFixed(1)} m expected ${(40 / before.k).toFixed(1)})`);
    check(await ev(() => !MiniMapV161.sel), 'a drag does not select a point (no teleport marker)');
    const k0 = after.k;
    await page.mouse.move(box[0] + 200, box[1] + 300); await page.mouse.wheel(0, -300);
    await page.waitForTimeout(150);
    const k1 = await ev(() => MiniMapV161.view.k);
    check(k1 > k0 * 1.2, `mouse wheel zooms in (${k0.toFixed(2)} -> ${k1.toFixed(2)})`);
    await page.click('#bigMapZoomOut'); await page.click('#bigMapZoomOut');
    const k2 = await ev(() => MiniMapV161.view.k);
    check(k2 < k1 * 0.6 && k2 >= 0.25, `the zoom-out button zooms out and is clamped (${k2.toFixed(2)})`);
    await ev(() => { for (let i = 0; i < 12; i++) MiniMapV161.zoomBy(0.5); });
    const kmin = await ev(() => MiniMapV161.view.k), kfit = await ev(() => Math.min(innerWidth / MiniMapV161.baseBox.w, innerHeight / MiniMapV161.baseBox.h));
    check(kmin >= kfit * 0.94, `zoom out stops at the whole map (${kmin.toFixed(3)} >= fit ${kfit.toFixed(3)})`);
    await ev(() => { for (let i = 0; i < 20; i++) MiniMapV161.zoomBy(1.6); });
    check(await ev(() => MiniMapV161.view.k) <= 7.001, 'zoom in is clamped at 7 px per metre');
    // pinch: two pointers through real events
    await ev(() => { MiniMapV161.setView(100, 60, 1.6); });
    const kp0 = await ev(() => MiniMapV161.view.k);
    await ev(() => {
      const c = document.querySelector('#bigMapV161 canvas'), r = c.getBoundingClientRect(), mk = (id, x, y, type) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, isPrimary: id === 1, pointerType: 'touch' }));
      mk(1, 150, 300, 'pointerdown'); mk(2, 240, 300, 'pointerdown'); mk(1, 100, 300, 'pointermove'); mk(2, 290, 300, 'pointermove'); mk(1, 100, 300, 'pointerup'); mk(2, 290, 300, 'pointerup');
    });
    const kp1 = await ev(() => MiniMapV161.view.k);
    check(kp1 > kp0 * 1.8 && kp1 < kp0 * 2.3, `a two-finger pinch (90 -> 190 px) zooms by ~2.1 (${kp0.toFixed(2)} -> ${kp1.toFixed(2)})`);
    await ev(() => MiniMapV161.close());

    // ---- 3b. deep zoom + LOD: at >= 2.4 px/m the visible cells are drawn as vectors (markings, ramps, loops, decks), node labels from the data
    {
      await ev(() => { MiniMapV161.open(); });
      const white = () => ev(() => { const c = document.querySelector('#bigMapV161 canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] > 225 && d[i + 2] > 215) n++; return n; });
      const spots = [['I1', 0, -240, 3.0], ['I2', 250, 0, 4.0], ['I3', 250, -240, 3.0], ['I4', 250, 160, 3.0]];
      for (const [id, x, z, k] of spots) {
        await ev(([x, z, k]) => { MiniMapV161.detail = true; MiniMapV161.setView(x, z, k); MiniMapV161.redraw(); }, [x, z, k]);
        const on = await ev(() => ({ cmds: MiniMapV161.stats.detailCmds, ms: MiniMapV161.stats.detailMs, err: MiniMapV161.detailError || MiniMapV161.nodeError || null, k: MiniMapV161.view.k }));
        const wOn = await white();
        await ev(() => { MiniMapV161.detail = false; MiniMapV161.redraw(); }); const wOff = await white();
        await ev(() => { MiniMapV161.detail = true; });
        check(!on.err && on.cmds > 400 && on.ms < 600 && wOn > wOff * 1.15, `LOD ${id} at ${on.k.toFixed(1)} px/m: ${on.cmds} vector draw commands in ${on.ms.toFixed(0)} ms (< 600), more marking pixels than the baked map (${wOn} vs ${wOff}), no error`);
      }
      await ev(() => { for (let i = 0; i < 6; i++) MiniMapV161.zoomBy(1.7); MiniMapV161.redraw(); });
      const mx = await ev(() => ({ k: MiniMapV161.view.k, err: MiniMapV161.detailError || MiniMapV161.nodeError || null, ms: MiniMapV161.stats.detailMs }));
      check(mx.k >= 6.99 && !mx.err && mx.ms < 600, `maximum zoom ${mx.k.toFixed(2)} px/m draws without error (${mx.ms.toFixed(0)} ms)`);
      await ev(() => { MiniMapV161.setView(0, -240, 3.0); MiniMapV161.redraw(); });
      const tapI1 = await ev(() => { const [sx, sy] = MiniMapV161.worldToScreen(10, -230); return [sx, sy]; });
      await page.mouse.click(tapI1[0], tapI1[1]);
      const selI1 = await ev(() => MiniMapV161.sel);
      check(selI1 && Math.hypot(selI1.x - 10, selI1.z + 230) < 1, `a tap at the deepest LOD still selects the point (${J(selI1)})`);
      const k0 = await ev(() => MiniMapV161.view.k);
      await page.mouse.click(tapI1[0], tapI1[1]); await page.mouse.click(tapI1[0], tapI1[1]);
      check(await ev((k0) => MiniMapV161.view.k > k0 * 1.5, k0), 'a double tap zooms in');
      const lodShots = SHOTS ? true : false;
      if (lodShots) for (const night of [false, true]) {
        await ev((n) => { try { __TYCOON_V40__.setTime(n ? 22 : 12); } catch (_) {} }, night);
        for (const [id, x, z, k] of spots.filter((q) => q[0] !== 'I3')) { await ev(([x, z, k]) => { MiniMapV161.sel = null; document.getElementById('bigMapSel').hidden = true; MiniMapV161.setView(x, z, k); }, [x, z, k]); await page.waitForTimeout(500); await page.screenshot({ path: path.join(SHOTS, `minimap-lod-${id}-${night ? 'night' : 'day'}.png`) }); }
      }
      await ev(() => { MiniMapV161.close(); try { __TYCOON_V40__.setTime(12); } catch (_) {} });
    }

    // ---- 4. the dock never overlaps another HUD piece (390x664 and 360x640, quiet and with every transient card forced on)
    const hudCheck = async (label) => {
      await ev(() => window.dispatchEvent(new Event('resize'))); await ev(() => __frames(6));
      const quiet = await ev(() => __rects()), badQ = pairs(quiet, ['mapBtn', 'speedBtn']);
      check(!!quiet.mapBtn && !!quiet.speedBtn && badQ.length === 0, `${label}: map + speed chip visible, no overlap with the other HUD pieces (${J(badQ)}; ${J(quiet.mapBtn)})`);
      await ev(() => { __forceCards(); document.getElementById('manualCoachV143')?.classList.add('show'); document.getElementById('carryRouteV139')?.classList.add('show'); }); await ev(() => __frames(20)); await page.waitForTimeout(700); await ev(() => __frames(8));
      const busy = await ev(() => __rects()), badB = pairs(busy, ['mapBtn', 'speedBtn']);
      const cards = ['carryRouteV139', 'manualCoachV143', 'toast'].filter((k) => busy[k]);
      let cardBad = []; for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) if (overlap(busy[cards[i]], busy[cards[j]])) cardBad.push(cards[i] + ' x ' + cards[j]);
      check(badB.length === 0 && cardBad.length === 0 && cards.length >= 2, `${label}: with carry / coach / toast forced on, the dock overlaps nothing and the cards stay apart (${J(badB)} ${J(cardBad)}; cards ${cards.join(',')}; ${J(Object.fromEntries(cards.map((k) => [k, busy[k].map(Math.round)])))})`);
      const iw = await ev(() => innerWidth);
      const inside = ['mapBtn', 'speedBtn'].every((k) => busy[k][0] >= 0 && busy[k][2] <= iw && busy[k][1] >= 0 && busy[k][3] <= 600);
      check(inside, `${label}: the dock is wholly on screen and above the controls (${J(busy.mapBtn)}, ${J(busy.speedBtn)}, joystick ${J(busy.joyBase)})`);
      return busy;
    };
    await hudCheck('390x664');
    if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'minimap-hud-390.png') }); }
    await page.setViewportSize({ width: 360, height: 640 }); await page.waitForTimeout(500);
    await hudCheck('360x640');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'minimap-hud-360.png') });
    await page.setViewportSize({ width: 390, height: 664 }); await page.waitForTimeout(500);
    await ev(() => { for (const id of ['carryRouteV139', 'manualCoachV143']) { const el = document.getElementById(id); if (el) { el.hidden = true; el.style.setProperty('display', 'none', 'important'); } } });

    // ---- 5. teleport
    await ev(() => { player.position.set(100, 0, 60); PlanCV161.level = 0; MiniMapV161.teleport(100, 60); }); await ev(() => __frames(30));
    const lvl0 = await ev(() => ({ off: camera.position.distanceTo(controls.target) }));
    // 5a. through the UI: open, tap a point, read the selection, press the button
    await page.click('#miniMapV161');
    await ev(() => MiniMapV161.setView(60, 20, 1.6));
    await page.waitForTimeout(200);
    const tap = await ev(() => { MiniMapV161.redraw(); const [sx, sy] = MiniMapV161.worldToScreen(70, 40); return [sx, sy]; });
    await page.mouse.click(tap[0], tap[1]);
    const selOk = await ev(() => ({ sel: MiniMapV161.sel, shown: !document.getElementById('bigMapSel').hidden, btn: !!document.getElementById('bigMapTeleport') && getComputedStyle(document.getElementById('bigMapTeleport')).display !== 'none' }));
    check(selOk.shown && selOk.btn && selOk.sel && Math.hypot(selOk.sel.x - 70, selOk.sel.z - 40) < 1.5, `tap on the big map selects the point and shows the "Телепорт сюда" button (${J(selOk.sel)})`);
    const nStep = await ev(() => document.querySelectorAll('#bigMapV161 button').length);
    await page.click('#bigMapTeleport');
    await ev(() => __frames(8));
    const t1 = await ev(() => ({ p: [player.position.x, player.position.y, player.position.z], closed: document.getElementById('bigMapV161').hidden, off: camera.position.distanceTo(controls.target), level: PlanCV161.level, inside: __inside(), acc: PlanCDataV161.access(player.position.x, player.position.z) }));
    check(Math.hypot(t1.p[0] - 70, t1.p[2] - 40) < 3 && t1.p[1] === 0 && t1.closed && t1.acc && t1.inside < 0.03, `UI teleport: the player stands at (${t1.p.map((v) => v.toFixed(1))}) near the tapped (70, 40), on the ground, on walkable floor, outside every collider; the map closed`);
    check(Math.abs(t1.off - lvl0.off) < 1.0, `the camera keeps its distance to the player after the teleport (${lvl0.off.toFixed(2)} -> ${t1.off.toFixed(2)})`);
    const snap = await ev(() => { const a = camera.position.clone().sub(player.position); MiniMapV161.teleport(150, 90); const b = camera.position.clone().sub(player.position); return a.distanceTo(b); });
    check(snap < 0.01, `the teleport moves camera and target by the same vector in the same call (offset change ${snap.toFixed(4)} m)`);
    const camNear = await ev(() => { const dx = camera.position.x - player.position.x, dz = camera.position.z - player.position.z; return Math.hypot(dx, dz); });
    check(camNear < 30, `the follow camera is next to the player (${camNear.toFixed(1)} m)`);
    // 5b. water -> nearest shore
    const sea = await ev(() => { const r = MiniMapV161.teleport(0, 240); return { r, p: [player.position.x, player.position.y, player.position.z], floor: PlanCDataV161.floor(player.position.x, player.position.z), acc: PlanCDataV161.access(player.position.x, player.position.z) }; });
    check(sea.r.ok && sea.floor && sea.acc && sea.r.moved > 5 && sea.r.moved < 60, `teleport into the sea (0, 240) puts him on the nearest walkable shore ${sea.p.map((v) => v.toFixed(1))} (${sea.r.moved} m away)`);
    // 5c. inside a collider -> pushed out
    const col = await ev(() => { const c = gatherPhysicsCircles().find((e) => e.shape === 'circle' && e.radius > 1); const r = MiniMapV161.teleport(c.pos.x, c.pos.z); return { r, d: Math.hypot(player.position.x - c.pos.x, player.position.z - c.pos.z), need: c.radius + 0.35, inside: __inside() }; });
    check(col.r.ok && col.d >= col.need - 0.05 && col.inside < 0.03, `teleport onto the centre of a collider (${col.r.moved} m moved): outside it (${col.d.toFixed(2)} m >= ${col.need.toFixed(2)}), no overlap (${col.inside.toFixed(3)})`);
    // 5d. a point that is a deck only: the player ends ON the deck
    const dk = await ev(([x, z]) => { const r = MiniMapV161.teleport(x, z); return { r, y: player.position.y, level: PlanCV161.level, want: PlanCDataV161.surfaces(player.position.x, player.position.z) }; }, [DECK[0], DECK[1]]);
    check(dk.r.ok && dk.y > 0.2 && Math.abs(dk.y - dk.level) < 1e-6 && dk.want.some((s) => Math.abs(s - dk.y) < 0.05), `teleport onto a deck-only point (${DECK[0]}, ${DECK[1]}): y ${dk.y.toFixed(2)} = the deck height, PlanCV161.level follows`);
    // the real loop (audit every 1.75 s, wrapper) keeps him there
    await ev(() => __frames(40)); await page.waitForTimeout(2500); await ev(() => __frames(10));
    const dk2 = await ev(() => ({ p: [player.position.x, player.position.y, player.position.z], level: PlanCV161.level, g: playerGrounded }));
    check(Math.abs(dk2.p[1] - dk.y) < 0.1 && Math.hypot(dk2.p[0] - (DECK[0]), dk2.p[2] - DECK[1]) < 40 && dk2.g, `after ~3 s of the real loop the player still stands on the deck (y ${dk2.p[1].toFixed(2)} vs ${dk.y.toFixed(2)}, grounded ${dk2.g})`);
    // 5e. back to the ground from the deck, and the level follows
    await ev(() => MiniMapV161.teleport(100, 60));
    const bk = await ev(() => ({ y: player.position.y, level: PlanCV161.level }));
    check(bk.y === 0 && bk.level === 0, `teleport from a deck back to the ground resets the level (${bk.y}, ${bk.level})`);

    // ---- 6. speed
    check(await ev(() => document.getElementById('speedBtnV161').textContent === 'x1'), 'the speed chip starts at x1');
    await page.click('#speedBtnV161');
    const s3 = await ev(() => ({ t: document.getElementById('speedBtnV161').textContent, ls: localStorage.getItem('tycoon_speed_v161'), sp: MiniMapV161.speed, on: document.getElementById('speedBtnV161').classList.contains('on') }));
    check(s3.t === 'x3' && s3.ls === '3' && s3.sp === 3 && s3.on, `tap on the chip: x3, saved in localStorage (${J(s3)})`);
    await page.click('#speedBtnV161');
    check(await ev(() => document.getElementById('speedBtnV161').textContent === 'x6' && localStorage.getItem('tycoon_speed_v161') === '6'), 'second tap: x6');
    await page.click('#speedBtnV161');
    check(await ev(() => document.getElementById('speedBtnV161').textContent === 'x1' && localStorage.getItem('tycoon_speed_v161') === '1'), 'third tap: back to x1');
    // measured through the real updatePlayer: a clear stretch of open ground, camera looking +z
    const run1 = (k) => ev(([k, N]) => {
      MiniMapV161.setSpeed(k); joyVec.x = 0; joyVec.z = 1;
      player.position.set(RUN.x, 0, RUN.z); PlanCV161.level = 0; playerVelocity.set(0, 0, 0); playerGrounded = true;
      camera.position.set(RUN.x, 13, RUN.z - 11); controls.target.set(RUN.x, 1, RUN.z); camera.lookAt(controls.target); camera.updateMatrixWorld(true);
      let minInside = 0; for (let i = 0; i < N; i++) { updatePlayer(1 / 30); minInside = Math.max(minInside, __inside()); }
      const d = Math.hypot(player.position.x - RUN.x, player.position.z - RUN.z), r = { d, inside: minInside, z: player.position.z };
      joyVec.z = 0; playerVelocity.set(0, 0, 0); return r;
    }, [k, 40]);
    // find the clear stretch: 70 m of walkable ground along +z with no collider
    const RUNp = await ev(() => {
      const D = PlanCDataV161;
      for (let x = 20; x < 300; x += 7) for (let z = 10; z < 120; z += 5) {
        let ok = true; for (let s = 0; s <= 90 && ok; s += 1.5) { if (!D.access(x, z + s, 0.8) || D.surfaces(x, z + s).length !== 1 || D.surfaces(x, z + s)[0] !== 0) ok = false; }
        if (!ok) continue;
        const c = gatherPhysicsCircles(); let free = true;
        for (let s = 0; s <= 90 && free; s += 1) { const v = playerVelocity.clone(), q = resolvePlayerCircleCollisions(x, z + s, c); playerVelocity.copy(v); if (Math.hypot(q.x - x, q.z - (z + s)) > 0.01) free = false; }
        if (free) return { x, z };
      }
      return null;
    });
    check(!!RUNp, `a clear 90 m stretch of open ground for the speed runs (${J(RUNp)})`);
    await ev((p) => { window.RUN = p; }, RUNp);
    // the game's own stamina / sprint changes the speed a little: run each speed from a rested state
    const r1 = await run1(1), r3 = await run1(3), r6 = await run1(6);
    console.log(`info: 40 frames forward: x1 ${r1.d.toFixed(1)} m, x3 ${r3.d.toFixed(1)} m, x6 ${r6.d.toFixed(1)} m`);
    check(r3.d / r1.d > 2.5 && r3.d / r1.d < 3.4, `x3 moves ${(r3.d / r1.d).toFixed(2)} x as far as x1 through the real updatePlayer`);
    check(r6.d / r1.d > 4.8 && r6.d / r1.d < 6.6, `x6 moves ${(r6.d / r1.d).toFixed(2)} x as far as x1`);
    check(Math.max(r1.inside, r3.inside, r6.inside) < 0.03, `no overlap with a collider on the runs (${Math.max(r1.inside, r3.inside, r6.inside).toFixed(3)})`);
    // x6 into a wall: every frame stays outside the collider and the player stops
    const wall = await ev(() => {
      MiniMapV161.setSpeed(6);
      const c = gatherPhysicsCircles().find((e) => e.shape === 'circle' && e.radius > 1.2 && PlanCDataV161.access(e.pos.x, e.pos.z - 14, 0.8));
      const sx = c.pos.x, sz = c.pos.z - 14;   // 14 m north of the collider, walk +z into it
      player.position.set(sx, 0, sz); PlanCV161.level = 0; playerVelocity.set(0, 0, 0); joyVec.x = 0; joyVec.z = 1;
      camera.position.set(sx, 13, sz - 11); controls.target.set(sx, 1, sz); camera.lookAt(controls.target); camera.updateMatrixWorld(true);
      let worst = 0, minD = 1e9; for (let i = 0; i < 120; i++) { updatePlayer(1 / 30); worst = Math.max(worst, __inside()); minD = Math.min(minD, Math.hypot(player.position.x - c.pos.x, player.position.z - c.pos.z) - c.radius); }
      joyVec.z = 0; playerVelocity.set(0, 0, 0); MiniMapV161.setSpeed(1);
      return { worst, minD, label: c.label };
    });
    check(wall.worst < 0.03 && wall.minD > 0.2, `x6 pushed 120 frames into a collider (${wall.label}): never inside (${wall.worst.toFixed(3)}), min gap ${wall.minD.toFixed(2)} m`);
    // x6 into the sea: stays on walkable floor
    const shore = await ev(() => {
      MiniMapV161.setSpeed(6);
      const D = PlanCDataV161; let x = 20; const z0 = 150; while (x < 300 && D.access(x, 205 + 0.0, 0.5)) x += 5;
      const t = MiniMapV161.teleport(60, 195); player.position.z = Math.min(player.position.z, 195); joyVec.x = 0; joyVec.z = 1;
      camera.position.set(player.position.x, 13, player.position.z - 11); controls.target.set(player.position.x, 1, player.position.z); camera.lookAt(controls.target); camera.updateMatrixWorld(true);
      let bad = 0; for (let i = 0; i < 90; i++) { updatePlayer(1 / 30); if (!D.access(player.position.x, player.position.z, 0.2)) bad++; }
      const z = player.position.z; joyVec.z = 0; playerVelocity.set(0, 0, 0); MiniMapV161.setSpeed(1);
      return { bad, z, start: t.z };
    });
    check(shore.bad === 0, `x6 walking into the sea (ended z ${shore.z.toFixed(1)}): never off the walkable floor (${shore.bad} frames)`);
    // x6 on a ramp: the player follows the plan-C height (up to the deck)
    const ramp = await ev(() => {
      MiniMapV161.setSpeed(6); const D = PlanCDataV161, rib = D.struct.ribbons.find((r) => r.p.length > 20 && Math.max(...r.p.map((q) => q[2])) > 3 && r.w >= 8); if (!rib) return null;
      const a = rib.p[0], b = rib.p[Math.min(rib.p.length - 1, 6)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
      MiniMapV161.teleport(a[0], a[1]); const sx = player.position.x, sz = player.position.z;
      const dir = [dx / l, dz / l]; camera.position.set(sx - dir[0] * 11, 13, sz - dir[1] * 11); controls.target.set(sx, 1, sz); camera.lookAt(controls.target); camera.updateMatrixWorld(true);
      joyVec.z = 1; let maxY = 0, bad = 0;
      for (let i = 0; i < 90; i++) { updatePlayer(1 / 30); const want = PlanCDataV161.surfaceY(player.position.x, player.position.z, PlanCV161.level, 0.75); if (player.position.y > maxY) maxY = player.position.y; if (playerGrounded && Math.abs(player.position.y - (want == null ? 0 : want)) > 0.6) bad++; }
      joyVec.z = 0; playerVelocity.set(0, 0, 0); MiniMapV161.setSpeed(1); return { id: rib.id, maxY, bad, extraErr: MiniMapV161.extraError || null };
    });
    check(ramp && !ramp.extraErr && ramp.bad === 0, `x6 along the ribbon ${ramp && ramp.id}: grounded frames stay on the plan-C surface (${ramp && ramp.bad} off by > 0.6 m, max y ${ramp && ramp.maxY.toFixed(2)})`);

    // ---- 7. persistence of the speed across a reload
    await ev(() => MiniMapV161.setSpeed(3));
    const errs = await reloadGame(g, 6000);
    await page.waitForFunction(() => window.MiniMapV161, null, { timeout: 30000 });
    const rl = await ev(() => ({ sp: MiniMapV161.speed, t: document.getElementById('speedBtnV161').textContent, on: document.getElementById('speedBtnV161').classList.contains('on') }));
    check(rl.sp === 3 && rl.t === 'x3' && rl.on, `the speed (x3) and the chip survive a reload (${J(rl)})`);
    await ev(PAGE); await ev(() => MiniMapV161.setSpeed(1));
    // the north / camera preference is saved too
    await page.waitForFunction(() => MiniMapV161.ready, null, { timeout: 90000 });
    await ev(() => MiniMapV161.open()); await page.click('#bigMapNorth'); await ev(() => MiniMapV161.close());
    const pref = await ev(() => JSON.parse(localStorage.getItem('tycoon_minimap_v161')));
    check(pref.rot === true, `camera-up mode is saved (${J(pref)})`);
    // camera-up: the arrow still sits in the middle and the map follows the camera azimuth
    const camUp = await ev(() => { player.position.set(100, 0, 60); PlanCV161.level = 0; MiniMapV161.drawMini(); const c = document.querySelector('#miniMapV161 canvas'), d = c.getContext('2d').getImageData(c.width / 2 - 3, c.height / 2 - 3, 7, 7).data; let gold = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150 && d[i + 1] < 215 && d[i + 2] < 140) gold++; return { gold, N: getComputedStyle(document.querySelector('#miniMapV161 .mmN')).opacity }; });
    check(camUp.gold >= 4 && +camUp.N < 0.5, `camera-up minimap: arrow in the middle, the N tick is hidden (${J(camUp)})`);
    await ev(() => { document.getElementById('bigMapNorth'); MiniMapV161.open(); }); await page.click('#bigMapNorth'); await ev(() => MiniMapV161.close());

    // ---- 8. night tint, cost per update, draw calls / scene children
    const lum = () => ev(() => { MiniMapV161.drawMini(); const c = document.querySelector('#miniMapV161 canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 16) s += d[i] + d[i + 1] + d[i + 2]; return s / (d.length / 16); });
    await ev(() => { try { __TYCOON_V40__.setTime(12); } catch (_) {} });
    const day = await lum();
    await ev(() => { try { __TYCOON_V40__.setTime(22); } catch (_) {} });
    const night = await lum();
    check(night < day * 0.8, `the minimap is dimmed at night (mean ${day.toFixed(0)} -> ${night.toFixed(0)})`);
    const cost = await ev(() => { MiniMapV161.close(); const t = []; for (let i = 0; i < 60; i++) { MiniMapV161.drawMini(); t.push(MiniMapV161.stats.miniMs); } t.sort((a, b) => a - b); return { med: t[30], max: t[59] }; });
    check(cost.med <= 3, `one minimap update costs ${cost.med.toFixed(2)} ms median (max ${cost.max.toFixed(2)}), at <= 10 Hz that is ${(cost.med * 10 / 60).toFixed(2)} ms per 60 fps frame (software canvas in this test)`);
    const gl = await ev(async () => {
      await __frames(4); player.position.set(100, 0, 60); PlanCV161.ensureNear(100, 60); camera.position.set(110, 16, 76); controls.target.set(100, 1, 60); camera.lookAt(controls.target); camera.updateMatrixWorld(true);
      await __frames(6); const calls = () => { renderer.info.reset(); renderer.render(scene, camera); return renderer.info.render.calls; };
      const closed = calls(), kids = scene.children.length; MiniMapV161.open(); const open = calls(), kidsOpen = scene.children.length; MiniMapV161.close(); const closed2 = calls();
      return { closed, open, closed2, kids, kidsOpen };
    });
    check(gl.closed === gl.open && gl.closed === gl.closed2 && gl.kids === gl.kidsOpen, `the map adds no WebGL draw call and no scene object (draw calls ${gl.closed} / ${gl.open}, scene children ${gl.kids} / ${gl.kidsOpen})`);

    // ---- 9. pictures (day + night, minimap + big map, a teleport)
    if (SHOTS) {
      await ev(() => { MiniMapV161.setSpeed(1); try { __TYCOON_V40__.setTime(12); } catch (_) {} MiniMapV161.teleport(0, 30); });
      await page.waitForTimeout(1200); await page.screenshot({ path: path.join(SHOTS, 'minimap-day-hud.png') });
      await ev(() => MiniMapV161.open()); await page.waitForTimeout(800); await page.screenshot({ path: path.join(SHOTS, 'minimap-day-big.png') });
      await ev(() => { MiniMapV161.setView(60, -20, 3.2); MiniMapV161.selectPoint(75, -35); }); await page.waitForTimeout(500); await page.screenshot({ path: path.join(SHOTS, 'minimap-day-big-zoom-sel.png') });
      await ev(() => { MiniMapV161.close(); try { __TYCOON_V40__.setTime(22); } catch (_) {} }); await page.waitForTimeout(1500); await page.screenshot({ path: path.join(SHOTS, 'minimap-night-hud.png') });
      await ev(() => MiniMapV161.open()); await page.waitForTimeout(800); await page.screenshot({ path: path.join(SHOTS, 'minimap-night-big.png') });
      await ev(() => { MiniMapV161.close(); try { __TYCOON_V40__.setTime(12); } catch (_) {} });
    }
    check(g.errors.length === 0, `no console errors in launch 1 (${J(g.errors.slice(0, 3))})`);
    check(g.badResponses.length === 0, 'no 4xx');
  } finally { await g.close(); }
});

// ================================ launch 1b: ?debug=0 ================================
await run(async () => {
  const srv = await startServer();
  const g = await openGame({ save: 'clear', url: srv.url + '/tycoon-v161.html?layout=C&debug=0', waitMs: 5000 });
  const { page } = g, ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    const r = await ev(() => ({ speedBtn: !!document.getElementById('speedBtnV161'), tp: !!document.getElementById('bigMapTeleport'), dbg: MiniMapV161.debug, sp: (MiniMapV161.setSpeed(6), MiniMapV161.speed), tele: MiniMapV161.teleport(50, 50), map: !!document.getElementById('miniMapV161') }));
    check(r.map && !r.speedBtn && !r.tp && r.dbg === false && r.sp === 1 && r.tele.ok === false, `?debug=0: the map stays, no speed chip, no teleport button, speed forced to x1, teleport refused (${J(r)})`);
    check(g.errors.length === 0, `no console errors with ?debug=0 (${J(g.errors.slice(0, 3))})`);
  } finally { await g.close(); await srv.close(); }
});

// ================================ launch 2: layout B (OLD_SAVE) ================================
await run(async () => {
  const g = await openGame({ save: OLD_SAVE, layout: null, waitMs: 6000 });
  const { page } = g, ev = (fn, arg) => page.evaluate(fn, arg);
  try {
    await ev(PAGE);
    await page.waitForFunction(() => window.MiniMapV161 && MiniMapV161.ready, null, { timeout: 60000 });
    check(await ev(() => window.LAYOUT_V161 === 'B' && MiniMapV161.mode === 'B' && !window.PlanCV161), 'OLD_SAVE: layout B, the minimap is in the simplified mode B');
    const sig = await ev(() => __sig());
    check(sig.count === 51 && sig.hash === -720375465, `OLD_SAVE road signature stays 51 / -720375465 (${sig.count}/${sig.hash})`);
    await ev(() => __frames(6));
    const rects = await ev(() => __rects()), bad = pairs(rects, ['mapBtn', 'speedBtn']);
    check(!!rects.mapBtn && bad.length === 0, `layout B: the dock is placed and overlaps nothing (${J(bad)}, ${J(rects.mapBtn)})`);
    await ev(() => { player.position.set(10, 0, 10); MiniMapV161.drawMini(); });
    const gold = await ev(() => { const c = document.querySelector('#miniMapV161 canvas'), d = c.getContext('2d').getImageData(c.width / 2 - 3, c.height / 2 - 3, 7, 7).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 150 && d[i + 1] < 215 && d[i + 2] < 140) n++; return n; });
    check(gold >= 4, `layout B: the player arrow is at the centre (${gold} gold px)`);
    const road = await ev(() => { const M = MiniMapV161, c = M.base.getContext('2d'), s = M.baseScale, b = M.baseBox, seg = window.__TYCOON_V84_ROADS__.segments()[0], mx = (seg.a.x + seg.b.x) / 2, mz = (seg.a.z + seg.b.z) / 2, d = c.getImageData(Math.round((mx - b.x0) * s), Math.round((mz - b.z0) * s), 1, 1).data; return { px: [d[0], d[1], d[2]], seg: [mx, mz] }; });
    check(road.px[0] < 90 && road.px[1] < 90 && road.px[2] < 90, `layout B: the first road segment is drawn dark on the map (${J(road)})`);
    const tp = await ev(() => { const r = MiniMapV161.teleport(500, 500); return { r, p: [player.position.x, player.position.z], inside: __inside() }; });
    check(tp.r.ok && Math.abs(tp.p[0]) <= 70 && Math.abs(tp.p[1]) <= 70 && tp.inside < 0.03, `layout B: a teleport outside the island lands on the island (${J(tp)})`);
    const sp = await ev(() => { MiniMapV161.setSpeed(3); joyVec.x = 0; joyVec.z = 1; playerVelocity.set(0, 0, 0); let bad = 0; for (let i = 0; i < 90; i++) { updatePlayer(1 / 30); const q = clampPlayerBoundsV161(player.position.x, player.position.z); if (Math.hypot(q.x - player.position.x, q.z - player.position.z) > 1e-6 || __inside() > 0.03) bad++; } joyVec.z = 0; MiniMapV161.setSpeed(1); return bad; });
    check(sp === 0, `layout B: x3 for 90 frames never leaves the island floor or enters a collider (${sp} bad frames)`);
    const sig2 = await ev(() => __sig());
    check(sig2.count === 51 && sig2.hash === -720375465, `road signature still 51 / -720375465 after the map work (${sig2.count}/${sig2.hash})`);
    check(g.errors.length === 0, `no console errors in layout B (${J(g.errors.slice(0, 3))})`);
  } finally { await g.close(); }
});
