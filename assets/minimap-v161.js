/* Minimap + big map + debug movement tools (2026-10-19, docs/MINIMAP_SPEC.md).
 *
 *  - ONE top HUD card (#miniMapDockV161: round 96 px minimap + speed chip) under the menu button; layoutTopV46 (tycoon-v161.html) places it and keeps the STACK cards clear of it.
 *  - Layout C: the map is DRAWN FROM THE PLAN DATA (PlanCDataV161 cells: ground, landscape, asphalt, walks, decks) once into an offscreen canvas (time-sliced, ~2.2 px per metre).
 *    Per update only the markers move (player arrow + heading, guidance target, built houses, bus stops); update <= 10 Hz, no 3D render, no extra WebGL draw call.
 *    Layout B / old saves: a simplified map (square of the island + paid masterplan floor + the drawn road segments) from the live game state.
 *  - Tap the minimap -> full screen map: drag, pinch / wheel zoom, centre on me, north-up / camera-up switch (also for the minimap), layers (labels, transit), legend.
 *  - DEBUG TOOLS (owner request: "быстрое перемещение для отладки стройки"): tap a point on the big map, press "Телепорт сюда" -> the player stands on the nearest walkable, collider-free
 *    point (plan C: PlanCDataV161.access + surface height; a deck / bridge point lifts the player onto it); speed chip x1 / x3 / x6 (kept in localStorage) multiplies the player's
 *    movement in updatePlayer with the game's own collision sub-steps (<= 0.14 m each, so walls and the water edge still stop him).
 *    Release switch: the constant DEBUG_TOOLS below, or `?debug=0` in the URL (the map stays, teleport + speed chip disappear, speed is forced to x1).
 */
(() => {
  'use strict';
  const DEBUG_TOOLS = true;                                   // set false for a release build
  const DEBUG = DEBUG_TOOLS && !/[?&]debug=0(&|$)/.test(location.search);
  const PREF_KEY = 'tycoon_minimap_v161', SPEED_KEY = 'tycoon_speed_v161';
  const MINI = 96, MINI_R = 55, MS = 2.2;                     // minimap css px, view radius in metres, base canvas px per metre
  const isC = () => window.LAYOUT_V161 === 'C' && !!window.PlanCDataV161;
  const D = window.PlanCDataV161;
  const L = (ru, en) => ((typeof lang !== 'undefined' ? lang : 'ru') === 'ru' ? ru : en);
  const $ = (id) => document.getElementById(id);
  const api = { version: 1, debug: DEBUG, speed: 1, rot: false, labels: true, transit: true, ready: false, baseMs: 0, base: null, mode: isC() ? 'C' : 'B',
    stats: { miniMs: 0, miniN: 0, bigMs: 0, bigN: 0 }, view: { cx: 0, cz: 0, k: 1.6 }, sel: null, last: null };
  window.MiniMapV161 = api;

  // ------------------------------------------------------------------ preferences
  try { const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); api.rot = !!p.rot; api.labels = p.labels !== false; api.transit = p.transit !== false; } catch (_) {}
  try { const s = +localStorage.getItem(SPEED_KEY); if (DEBUG && (s === 3 || s === 6)) api.speed = s; } catch (_) {}
  const savePrefs = () => { try { localStorage.setItem(PREF_KEY, JSON.stringify({ rot: api.rot, labels: api.labels, transit: api.transit })); } catch (_) {} };
  const saveSpeed = () => { try { localStorage.setItem(SPEED_KEY, String(api.speed)); } catch (_) {} };

  // ------------------------------------------------------------------ DOM + CSS
  const css = document.createElement('style');
  css.id = 'miniMapStyleV161';
  css.textContent = `
#miniMapDockV161{position:fixed;right:max(7px,calc(env(safe-area-inset-right) + 7px));top:var(--v46-minimap-top,64px);z-index:12;display:flex;align-items:flex-end;gap:6px;pointer-events:none;font-family:var(--pu-font,-apple-system,Roboto,Arial,sans-serif)}
#miniMapDockV161[hidden]{display:none}
#miniMapV161{position:relative;width:${MINI}px;height:${MINI}px;padding:0;border-radius:50%;overflow:hidden;pointer-events:auto;cursor:pointer;background:var(--pu-panel-solid,#12161c);border:1px solid var(--pu-line,rgba(232,195,106,.3));box-shadow:var(--pu-shadow,0 8px 22px rgba(0,0,0,.3)),var(--pu-rim,none);-webkit-tap-highlight-color:transparent;touch-action:manipulation}
#miniMapV161 canvas{display:block;width:100%;height:100%}
#miniMapV161 .mmN{position:absolute;left:50%;top:3px;transform:translateX(-50%);font:700 9px/1 var(--pu-font,sans-serif);color:var(--pu-gold,#e8c36a);text-shadow:0 1px 2px #000;pointer-events:none}
#miniMapV161 .mmStreet{position:absolute;left:50%;bottom:7px;transform:translateX(-50%);max-width:70px;padding:1px 5px;border-radius:7px;background:rgba(18,22,28,.78);color:var(--pu-ink,#f4f1e8);font:600 8.5px/1.25 var(--pu-font,sans-serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}
#speedBtnV161{pointer-events:auto;min-width:40px;height:30px;padding:0 8px;border-radius:15px;border:1px solid var(--pu-line,rgba(232,195,106,.3));background:var(--pu-panel,rgba(18,22,28,.86));color:var(--pu-ink,#f4f1e8);font:700 13px/1 var(--pu-font,sans-serif);font-variant-numeric:tabular-nums;box-shadow:var(--pu-shadow-soft,none);cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
#speedBtnV161.on,#bigMapV161 .mmSpeed.on{color:#12161c;background:var(--pu-gold,#e8c36a);border-color:var(--pu-gold-hi,#f4d98e)}
#bigMapV161{position:fixed;inset:0;z-index:70;background:#0d1116;color:var(--pu-ink,#f4f1e8);font-family:var(--pu-font,-apple-system,Roboto,Arial,sans-serif);touch-action:none;user-select:none;-webkit-user-select:none}
#bigMapV161[hidden]{display:none}
#bigMapV161 canvas{position:absolute;inset:0;width:100%;height:100%;touch-action:none}
#bigMapV161 .mmChip,#bigMapV161 button{font:600 13px/1 var(--pu-font,sans-serif);color:var(--pu-ink,#f4f1e8);background:var(--pu-panel,rgba(18,22,28,.9));border:1px solid var(--pu-line,rgba(232,195,106,.3));border-radius:14px;box-shadow:var(--pu-shadow-soft,none);-webkit-tap-highlight-color:transparent}
#bigMapV161 button{min-width:44px;min-height:44px;padding:0 12px;cursor:pointer;touch-action:manipulation}
#bigMapV161 button:active{transform:scale(.97)}
#bigMapV161 button.on{color:var(--pu-gold,#e8c36a);border-color:var(--pu-gold,#e8c36a)}
#bigMapV161 .mmTop{position:absolute;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));top:max(8px,env(safe-area-inset-top));display:flex;gap:8px;align-items:center;pointer-events:none}
#bigMapV161 .mmTop>*{pointer-events:auto}
#bigMapV161 .mmTitle{flex:1;min-width:0;padding:0 12px;height:44px;display:flex;align-items:center;gap:8px;white-space:nowrap;overflow:hidden}
#bigMapV161 .mmTitle b{color:var(--pu-gold,#e8c36a)}
#bigMapV161 .mmTitle span{color:var(--pu-ink-2,#b9c2cd);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}
#bigMapV161 .mmSide{position:absolute;right:max(8px,env(safe-area-inset-right));top:calc(max(8px,env(safe-area-inset-top)) + 56px);display:flex;flex-direction:column;gap:8px}
#bigMapV161 .mmSide button{font-size:20px;padding:0}
#bigMapV161 .mmLayers{position:absolute;left:max(8px,env(safe-area-inset-left));top:calc(max(8px,env(safe-area-inset-top)) + 56px);display:flex;flex-direction:column;gap:8px}
#bigMapV161 .mmLayers button{font-size:12px;min-height:36px;min-width:0;padding:0 10px}
#bigMapV161 .mmBottom{position:absolute;left:max(8px,env(safe-area-inset-left));right:max(8px,env(safe-area-inset-right));bottom:max(8px,env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px;pointer-events:none}
#bigMapV161 .mmBottom>*{pointer-events:auto}
#bigMapV161 .mmSel{display:flex;gap:8px;align-items:center;padding:6px 6px 6px 12px;min-height:56px}
#bigMapV161 .mmSel[hidden]{display:none}
#bigMapV161 .mmSel .mmSelText{flex:1;min-width:0;font-size:12px;line-height:1.3;color:var(--pu-ink-2,#b9c2cd);overflow:hidden}
#bigMapV161 .mmSel .mmSelText b{display:block;color:var(--pu-ink,#f4f1e8);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bigMapV161 #bigMapTeleport{background:var(--pu-gold,#e8c36a);color:#12161c;border-color:var(--pu-gold-hi,#f4d98e);min-width:136px;font-weight:700}
#bigMapV161 .mmLegend{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:0 8px 0 12px;height:44px;font-size:11px;color:var(--pu-ink-2,#b9c2cd)}
#bigMapV161 .mmLegend i{font-style:normal;color:var(--pu-gold,#e8c36a);margin-right:3px}
#bigMapV161 .mmLegend .mmLg{flex:1;display:flex;gap:10px;overflow:hidden;white-space:nowrap}
#bigMapV161 .mmSpeed{min-width:60px;min-height:36px;font-size:13px;font-variant-numeric:tabular-nums}
@media (prefers-reduced-motion:reduce){#bigMapV161 button:active{transform:none}}
`;
  document.head.appendChild(css);

  const dock = document.createElement('div');
  dock.id = 'miniMapDockV161';
  dock.innerHTML = `${DEBUG ? `<button id="speedBtnV161" type="button" aria-label="${L('Ускорение', 'Speed')}">x1</button>` : ''}<button id="miniMapV161" type="button" aria-label="${L('Карта', 'Map')}"><canvas></canvas><span class="mmN">N</span><span class="mmStreet"></span></button>`;
  document.body.appendChild(dock);
  const mini = $('miniMapV161'), miniCanvas = mini.querySelector('canvas'), mctx = miniCanvas.getContext('2d'), mmN = mini.querySelector('.mmN'), mmStreet = mini.querySelector('.mmStreet'), speedBtn = $('speedBtnV161');
  const dprM = Math.min(2, window.devicePixelRatio || 1);
  miniCanvas.width = miniCanvas.height = Math.round(MINI * dprM);

  const big = document.createElement('div');
  big.id = 'bigMapV161'; big.hidden = true; big.setAttribute('role', 'dialog'); big.setAttribute('aria-label', L('Карта', 'Map'));
  big.innerHTML = `<canvas></canvas>
<div class="mmTop"><div class="mmChip mmTitle"><b>${L('Карта', 'Map')}</b><span id="bigMapPos"></span></div><button id="bigMapClose" type="button" aria-label="${L('Закрыть', 'Close')}">✕</button></div>
<div class="mmLayers"><button id="bigMapLabels" type="button">${L('Подписи', 'Labels')}</button><button id="bigMapTransit" type="button">${L('Транспорт', 'Transit')}</button><button id="bigMapNorth" type="button"></button></div>
<div class="mmSide"><button id="bigMapZoomIn" type="button" aria-label="+">+</button><button id="bigMapZoomOut" type="button" aria-label="-">−</button><button id="bigMapCenter" type="button" aria-label="${L('Я здесь', 'Me')}">⌖</button></div>
<div class="mmBottom"><div class="mmChip mmSel" id="bigMapSel" hidden><div class="mmSelText"><b id="bigMapSelName"></b><span id="bigMapSelPos"></span></div>${DEBUG ? `<button id="bigMapTeleport" type="button">${L('Телепорт сюда', 'Teleport here')}</button>` : ''}</div>
<div class="mmChip mmLegend"><div class="mmLg"><span><i>▲</i>${L('Вы', 'You')}</span><span><i>◎</i>${L('Цель', 'Goal')}</span><span><i>●</i>${L('Остановка', 'Stop')}</span><span><i>■</i>${L('Здание', 'Building')}</span></div>${DEBUG ? `<button class="mmSpeed" id="bigMapSpeed" type="button">x1</button>` : ''}</div></div>`;
  document.body.appendChild(big);
  const bcanvas = big.querySelector('canvas'), bctx = bcanvas.getContext('2d');
  const isOpen = () => !big.hidden;

  // keep clicks / drags on the map away from the game (they are not on the renderer canvas, but older layers listen on document / window)
  for (const el of [dock, big]) for (const ev of ['pointerdown', 'touchstart', 'mousedown']) el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });

  // ------------------------------------------------------------------ base map (offscreen canvas)
  let X0 = 0, Z0 = 0, BW = 0, BH = 0;     // base canvas extent in metres (world of x0, z0, width, height)
  let baseToken = 0;
  const hex = (n) => '#' + n.toString(16).padStart(6, '0');
  function newBase(x0, z0, w, h, ms) {
    const c = document.createElement('canvas'); c.width = Math.ceil(w * ms); c.height = Math.ceil(h * ms);
    X0 = x0; Z0 = z0; BW = c.width / ms; BH = c.height / ms;
    api.base = c; api.baseScale = ms; api.baseBox = { x0, z0, w: BW, h: BH };
    return c;
  }
  // plan C: every cell layer in the order of the real meshes (by height), flat colours; markings / kerb walls are too thin for a map and are skipped.
  function renderBaseC() {
    const token = ++baseToken, t0 = performance.now();
    const keys = Object.keys(D.cells).map((k) => k.split(',').map(Number));
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const [cx, cz] of keys) { if (cx < mnx) mnx = cx; if (cx > mxx) mxx = cx; if (cz < mnz) mnz = cz; if (cz > mxz) mxz = cz; }
    const cell = D.cell, c = newBase(mnx * cell, mnz * cell, (mxx - mnx + 1) * cell, (mxz - mnz + 1) * cell, MS), ctx = c.getContext('2d');
    ctx.fillStyle = hex(D.colors[D.palette.sea]); ctx.fillRect(0, 0, c.width, c.height);
    const skip = new Set([D.palette.white, D.palette.yellow, D.palette.kerb]);
    const col = D.colors.map(hex);
    let queue = keys.slice();
    const order = ['g', 'r', 'p', 'd'];
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.7;
    function cellDraw(cx, cz) {
      const data = D.cells[cx + ',' + cz]; if (!data) return;
      for (const layer of order) {
        const l = data[layer]; if (!l) continue;
        const prims = [];
        if (l.q) for (let i = 0; i < l.q.length; i += 6) if (!skip.has(l.q[i + 5])) prims.push([l.q[i + 4], 0, i]);
        if (l.t) for (let i = 0; i < l.t.length; i += 8) if (!skip.has(l.t[i + 7])) prims.push([l.t[i + 6], 1, i]);
        if (l.v) for (let i = 0; i < l.v.length; i += 10) if (!skip.has(l.v[i + 9])) prims.push([(l.v[i + 1] + l.v[i + 4] + l.v[i + 7]) / 3, 2, i]);
        prims.sort((a, b) => a[0] - b[0]);
        let cur = '';
        for (const [, kind, i] of prims) {
          if (kind === 0) {
            const q = l.q, f = col[q[i + 5]]; if (f !== cur) { ctx.fillStyle = f; cur = f; }
            const x0 = Math.floor((q[i] - X0) * MS), z0 = Math.floor((q[i + 1] - Z0) * MS), x1 = Math.ceil((q[i + 2] - X0) * MS), z1 = Math.ceil((q[i + 3] - Z0) * MS);
            ctx.fillRect(x0, z0, Math.max(1, x1 - x0), Math.max(1, z1 - z0));
          } else {
            let ax, az, bx, bz, cx2, cz2, f;
            if (kind === 1) { const t = l.t; ax = t[i]; az = t[i + 1]; bx = t[i + 2]; bz = t[i + 3]; cx2 = t[i + 4]; cz2 = t[i + 5]; f = col[t[i + 7]]; }
            else { const v = l.v; ax = v[i]; az = v[i + 2]; bx = v[i + 3]; bz = v[i + 5]; cx2 = v[i + 6]; cz2 = v[i + 8]; f = col[v[i + 9]]; if (Math.abs((bx - ax) * (cz2 - az) - (bz - az) * (cx2 - ax)) < 1e-3) continue; }
            if (f !== cur) { ctx.fillStyle = f; cur = f; }
            ctx.strokeStyle = f;
            ctx.beginPath(); ctx.moveTo((ax - X0) * MS, (az - Z0) * MS); ctx.lineTo((bx - X0) * MS, (bz - Z0) * MS); ctx.lineTo((cx2 - X0) * MS, (cz2 - Z0) * MS); ctx.closePath(); ctx.fill(); ctx.stroke();
          }
        }
      }
    }
    return new Promise((resolve) => {
      const slice = () => {
        if (token !== baseToken) return resolve(false);
        const t = performance.now();
        while (queue.length && performance.now() - t < 8) { const [cx, cz] = queue.pop(); cellDraw(cx, cz); }
        if (queue.length) setTimeout(slice, 0);
        else { api.ready = true; api.baseMs = performance.now() - t0; api.baseVersion = (api.baseVersion || 0) + 1; resolve(true); }
      };
      slice();
    });
  }
  // layout B: the island square + the paid masterplan floor + the drawn road segments (rebuilt when their signature changes)
  let bSig = '';
  function bSignature() {
    let s = '';
    try { for (const id in masterplanStateV161) if (masterplanStateV161[id]) s += id; } catch (_) {}
    try { s += '|' + window.__TYCOON_V84_ROADS__.segments().length; } catch (_) {}
    return s;
  }
  function renderBaseB() {
    bSig = bSignature();
    let ext = 75;
    try {
      const P = window.MasterplanPortDataV161;
      if (P) for (const id in P.walkable) if (masterplanStateV161[id]) { const b = P.bbox[id]; ext = Math.max(ext, Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]), Math.abs(b[3])); }
    } catch (_) {}
    ext = Math.ceil(ext / 5) * 5;
    const ms = Math.min(5, 2000 / (2 * ext)), c = newBase(-ext, -ext, 2 * ext, 2 * ext, ms), ctx = c.getContext('2d');
    const P = (x, z) => [(x - X0) * ms, (z - Z0) * ms];
    ctx.fillStyle = '#2d5d7a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#5f9f48';
    const half = (typeof GROUND_HALF !== 'undefined' ? GROUND_HALF : 70);
    const [gx, gz] = P(-half, -half); ctx.fillRect(gx, gz, 2 * half * ms, 2 * half * ms);
    try {
      const Pd = window.MasterplanPortDataV161;
      if (Pd) for (const id in Pd.walkable) {
        if (!masterplanStateV161[id]) continue;
        for (const region of Pd.walkable[id]) {
          ctx.beginPath();
          for (const loop of region) { loop.forEach((p, i) => { const q = P(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }); ctx.closePath(); }
          ctx.fill('evenodd');
        }
      }
    } catch (_) {}
    try {
      ctx.lineCap = 'butt'; ctx.strokeStyle = '#353b3f';
      for (const s of window.__TYCOON_V84_ROADS__.segments()) {
        const a = P(s.a.x, s.a.z), b = P(s.b.x, s.b.z); ctx.lineWidth = Math.max(1.5, (s.w || 2) * ms);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
    } catch (_) {}
    api.ready = true; api.baseVersion = (api.baseVersion || 0) + 1;
  }
  function startBase() {
    api.mode = isC() ? 'C' : 'B';
    if (api.mode === 'C') renderBaseC(); else renderBaseB();
  }
  api.rebuildBase = () => { api.ready = false; startBase(); };

  // ------------------------------------------------------------------ world data for markers / labels
  const G = isC() ? D.graph : null;
  const streetNames = [];
  if (G) {
    const byName = new Map();
    for (const e of G.edges) {
      const name = e[8]; if (!name) continue;
      const len = Math.hypot(e[6] - e[4], e[7] - e[5]);
      const cls = e[3];
      if (cls !== 'arterial' && cls !== 'collector' && cls !== 'motorway' && cls !== 'motorway3') continue;
      const cur = byName.get(name); if (!cur || cur.len < len) byName.set(name, { name, len, x: (e[4] + e[6]) / 2, z: (e[5] + e[7]) / 2, ang: Math.atan2(e[7] - e[5], e[6] - e[4]) });
    }
    for (const s of byName.values()) streetNames.push(s);
  }
  function nearestStreet(x, z, maxD = 14) {
    if (!G) return null;
    let best = null, bd = maxD;
    for (const e of G.edges) {
      if (!e[8]) continue;
      const ax = e[4], az = e[5], bx = e[6], bz = e[7], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0, d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < bd) { bd = d; best = e[8]; }
    }
    return best;
  }
  api.nearestStreet = nearestStreet;
  const nameAt = (x, z) => {
    if (G) {
      let lm = null, ld = 22;
      for (const m of G.landmarks) { const d = Math.hypot(x - m[3], z - m[4]); if (d < ld) { ld = d; lm = m[2]; } }
      if (lm) return lm;
    }
    return nearestStreet(x, z) || L('Без названия', 'Unnamed');
  };

  // ------------------------------------------------------------------ marker sources (cheap, polled at the draw rate)
  function gameState() {
    const s = { px: player.position.x, pz: player.position.z, yaw: player.rotation.y, target: null, pad: null, houses: [] };
    try { const t = currentGuidanceTarget(); if (t && t.pos) s.target = { x: t.pos.x, z: t.pos.z, label: t.label }; } catch (_) {}
    try { if (typeof currentPad !== 'undefined' && currentPad && currentPad.pos) s.pad = { x: currentPad.pos.x, z: currentPad.pos.z }; } catch (_) {}
    try { for (const b of buildings) if (b && b.pos && b.mesh && b.mesh.visible !== false) s.houses.push([b.pos.x, b.pos.z]); } catch (_) {}
    return s;
  }
  let stCache = null, stAt = 0;
  const state = (now) => { if (!stCache || now - stAt > 90) { stCache = gameState(); stAt = now; } return stCache; };
  const nightNow = () => { try { return isNightV40(); } catch (_) { return false; } };

  // ------------------------------------------------------------------ drawing (shared marker painter; ctx is in screen px, project() maps world -> screen)
  function paintMarkers(ctx, st, project, k, opts) {
    const ink = '#12161c';
    // transit lines (big map) + bus stops
    if (G && opts.transit) {
      if (opts.lines) {
        ctx.lineWidth = Math.max(2, 1.2 * k * 0.9); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.globalAlpha = 0.85;
        for (const line of G.transit) {
          ctx.strokeStyle = line.color; ctx.beginPath();
          line.pts.forEach((p, i) => { const q = project(p[0], p[1]); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); });
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      const col = {}; for (const line of G.transit) col[line.id] = line.color;
      const r = opts.stopR;
      for (const s of G.stops) {
        const q = project(s.at[0], s.at[1]); if (q[0] < -8 || q[1] < -8 || q[0] > opts.w + 8 || q[1] > opts.h + 8) continue;
        ctx.fillStyle = '#f4f1e8'; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 6.2832); ctx.fill();
        ctx.lineWidth = Math.max(1, r * 0.45); ctx.strokeStyle = col[s.line] || '#4aa3ff'; ctx.stroke();
      }
    }
    // built houses
    ctx.fillStyle = '#e8c36a'; ctx.strokeStyle = ink; ctx.lineWidth = 1;
    const hs = opts.houseS;
    for (const h of st.houses) { const q = project(h[0], h[1]); if (q[0] < -8 || q[1] < -8 || q[0] > opts.w + 8 || q[1] > opts.h + 8) continue; ctx.fillRect(q[0] - hs / 2, q[1] - hs / 2, hs, hs); ctx.strokeRect(q[0] - hs / 2, q[1] - hs / 2, hs, hs); }
    // pad
    if (st.pad) { const q = project(st.pad.x, st.pad.z); ctx.strokeStyle = '#f0a94a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(q[0], q[1], opts.padR, 0, 6.2832); ctx.stroke(); }
    // guidance target
    if (st.target) {
      const q = project(st.target.x, st.target.z), pulse = 0.5 + 0.5 * Math.sin(performance.now() / 320);
      let tx = q[0], tz = q[1], edge = false;
      if (opts.clampR) {
        const cx = opts.w / 2, cz = opts.h / 2, dx = tx - cx, dz = tz - cz, d = Math.hypot(dx, dz);
        if (d > opts.clampR) { tx = cx + dx / d * opts.clampR; tz = cz + dz / d * opts.clampR; edge = true; }
      }
      ctx.save(); ctx.translate(tx, tz);
      ctx.strokeStyle = '#6fe3b0'; ctx.fillStyle = 'rgba(111,227,176,.28)'; ctx.lineWidth = 2;
      if (edge) {
        const a = Math.atan2(tz - opts.h / 2, tx - opts.w / 2); ctx.rotate(a);
        ctx.fillStyle = '#6fe3b0'; ctx.beginPath(); ctx.moveTo(4.5, 0); ctx.lineTo(-3.5, -4); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(0, 0, opts.tgtR + pulse * 1.5, 0, 6.2832); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#6fe3b0'; ctx.beginPath(); ctx.arc(0, 0, 1.8, 0, 6.2832); ctx.fill();
      }
      ctx.restore();
    }
    // selection (teleport point)
    if (opts.sel) {
      const q = project(opts.sel.x, opts.sel.z);
      ctx.save(); ctx.translate(q[0], q[1]); ctx.strokeStyle = '#f08a80'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, 8, 0, 6.2832); ctx.moveTo(-13, 0); ctx.lineTo(-4, 0); ctx.moveTo(13, 0); ctx.lineTo(4, 0); ctx.moveTo(0, -13); ctx.lineTo(0, -4); ctx.moveTo(0, 13); ctx.lineTo(0, 4); ctx.stroke(); ctx.restore();
    }
    // player arrow (heading = the world direction (sin yaw, cos yaw)), drawn last
    const q = project(st.px, st.pz);
    const ang = Math.atan2(Math.cos(st.yaw), Math.sin(st.yaw)) + (opts.rotate || 0);
    ctx.save(); ctx.translate(q[0], q[1]); ctx.rotate(ang);
    const s = opts.arrow;
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.beginPath(); ctx.arc(0, 0, s * 1.35, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#e8c36a'; ctx.strokeStyle = ink; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(s * 1.15, 0); ctx.lineTo(-s * 0.8, -s * 0.8); ctx.lineTo(-s * 0.35, 0); ctx.lineTo(-s * 0.8, s * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  function cameraRot() {   // radians to rotate the world so that the camera's viewing direction points UP on the map
    const fx = controls.target.x - camera.position.x, fz = controls.target.z - camera.position.z;
    if (fx * fx + fz * fz < 1e-6) return 0;
    return -Math.PI / 2 - Math.atan2(fz, fx);
  }
  let lastStreet = '', lastStreetAt = 0;
  function drawMini(now) {
    if (!api.base) { return; }
    const t0 = performance.now(), st = state(now), c = mctx, S = miniCanvas.width, k = MINI / (2 * MINI_R) * dprM;
    const rot = api.rot ? cameraRot() : 0, ca = Math.cos(rot), sa = Math.sin(rot);
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#1b2a2f'; c.fillRect(0, 0, S, S);
    c.save();
    c.translate(S / 2, S / 2); c.rotate(rot); c.scale(k, k); c.translate(-st.px, -st.pz);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'medium';
    c.drawImage(api.base, X0, Z0, BW, BH);
    c.restore();
    if (nightNow()) { c.fillStyle = 'rgba(8,16,40,.38)'; c.fillRect(0, 0, S, S); }
    const project = (x, z) => { const dx = (x - st.px) * k, dz = (z - st.pz) * k; return [S / 2 + dx * ca - dz * sa, S / 2 + dx * sa + dz * ca]; };
    paintMarkers(c, st, project, k, { w: S, h: S, clampR: S / 2 - 7 * dprM, transit: true, lines: false, stopR: 1.6 * dprM, houseS: 3.2 * dprM, padR: 4 * dprM, tgtR: 4 * dprM, arrow: 4.4 * dprM, rotate: rot, sel: null });
    mmN.style.transform = `translateX(-50%)` + (api.rot ? '' : ''); mmN.style.opacity = api.rot ? '0' : '1';
    if (now - lastStreetAt > 500) { lastStreetAt = now; const nm = nearestStreet(st.px, st.pz) || ''; if (nm !== lastStreet) { lastStreet = nm; mmStreet.textContent = nm; mmStreet.style.display = nm ? '' : 'none'; } }
    const dt = performance.now() - t0; api.stats.miniMs = dt; api.stats.miniN++; api.stats.miniAvg = (api.stats.miniAvg || dt) * 0.9 + dt * 0.1;
  }

  // ---- big map
  const view = api.view;
  let bw = 0, bh = 0, bdpr = 1, bDirty = true, kFit = 0.4;
  const K_MAX = 7;
  function sizeBig() {
    bw = big.clientWidth || innerWidth; bh = big.clientHeight || innerHeight; bdpr = Math.min(2, window.devicePixelRatio || 1);
    if (bcanvas.width !== Math.round(bw * bdpr) || bcanvas.height !== Math.round(bh * bdpr)) { bcanvas.width = Math.round(bw * bdpr); bcanvas.height = Math.round(bh * bdpr); }
    kFit = Math.min(bw / BW, bh / BH) || 0.4;
  }
  function clampView() {
    view.k = Math.max(kFit * 0.95, Math.min(K_MAX, view.k));
    const hw = bw / 2 / view.k, hh = bh / 2 / view.k;
    view.cx = Math.max(X0 + Math.min(hw, BW / 2), Math.min(X0 + BW - Math.min(hw, BW / 2), view.cx));
    view.cz = Math.max(Z0 + Math.min(hh, BH / 2), Math.min(Z0 + BH - Math.min(hh, BH / 2), view.cz));
  }
  const w2s = (x, z) => [bw / 2 + (x - view.cx) * view.k, bh / 2 + (z - view.cz) * view.k];
  const s2w = (sx, sz) => [view.cx + (sx - bw / 2) / view.k, view.cz + (sz - bh / 2) / view.k];
  api.worldToScreen = (x, z) => { const r = bcanvas.getBoundingClientRect(), q = w2s(x, z); return [r.left + q[0], r.top + q[1]]; };
  function drawLabels(c, st) {
    if (!api.labels || !G) return;
    const placed = [], k = view.k;
    const put = (text, x, z, o = {}) => {
      const q = w2s(x, z); if (q[0] < -40 || q[1] < -20 || q[0] > bw + 40 || q[1] > bh + 20) return;
      c.font = `${o.bold ? 700 : 600} ${o.size || 11}px ${getComputedStyle(document.documentElement).getPropertyValue('--pu-font') || 'sans-serif'}`;
      const w = c.measureText(text).width, h = (o.size || 11) + 2;
      const rect = o.ang ? [q[0] - Math.abs(w * Math.cos(o.ang)) / 2 - h / 2, q[1] - Math.abs(w * Math.sin(o.ang)) / 2 - h / 2, Math.abs(w * Math.cos(o.ang)) + h, Math.abs(w * Math.sin(o.ang)) + h] : [q[0] - w / 2 - 2 + (o.dx || 0), q[1] - h / 2 + (o.dy || 0), w + 4, h];
      for (const p of placed) if (rect[0] < p[0] + p[2] && p[0] < rect[0] + rect[2] && rect[1] < p[1] + p[3] && p[1] < rect[1] + rect[3]) return;
      placed.push(rect);
      c.save(); c.translate(q[0] + (o.dx || 0), q[1] + (o.dy || 0)); if (o.ang) c.rotate(o.ang);
      c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round'; c.lineWidth = 3.2; c.strokeStyle = 'rgba(14,18,24,.85)'; c.strokeText(text, 0, 0); c.fillStyle = o.color || '#f4f1e8'; c.fillText(text, 0, 0); c.restore();
    };
    for (const m of G.landmarks) { const q = w2s(m[3], m[4]); c.fillStyle = '#e8c36a'; c.strokeStyle = '#12161c'; c.lineWidth = 1.2; c.beginPath(); c.arc(q[0], q[1], 3.6, 0, 6.2832); c.fill(); c.stroke(); put(m[2], m[3], m[4], { size: 11, bold: true, dy: -11, color: '#f4d98e' }); }
    if (k >= 0.9) for (const s of streetNames) { let a = s.ang; if (a > Math.PI / 2) a -= Math.PI; if (a < -Math.PI / 2) a += Math.PI; put(s.name, s.x, s.z, { size: 10, ang: a, color: '#dfe6ee' }); }
  }
  function drawBig(now) {
    if (!isOpen()) return;
    const t0 = performance.now(), st = state(now), c = bctx;
    sizeBig(); clampView();
    c.setTransform(bdpr, 0, 0, bdpr, 0, 0);
    c.fillStyle = '#0d1116'; c.fillRect(0, 0, bw, bh);
    if (api.base) {
      c.save(); c.translate(bw / 2, bh / 2); c.scale(view.k, view.k); c.translate(-view.cx, -view.cz);
      c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(api.base, X0, Z0, BW, BH); c.restore();
      if (nightNow()) { c.fillStyle = 'rgba(8,16,40,.30)'; c.fillRect(0, 0, bw, bh); }
    } else { c.fillStyle = '#b9c2cd'; c.font = '14px sans-serif'; c.textAlign = 'center'; c.fillText(L('Карта строится…', 'Drawing the map…'), bw / 2, bh / 2); }
    drawLabels(c, st);
    paintMarkers(c, st, w2s, view.k, { w: bw, h: bh, clampR: 0, transit: api.transit, lines: api.transit, stopR: 3.4, houseS: 6, padR: 8, tgtR: 8, arrow: 8, rotate: 0, sel: api.sel });
    const dt = performance.now() - t0; api.stats.bigMs = dt; api.stats.bigN++;
    $('bigMapPos').textContent = `${Math.round(st.px)}, ${Math.round(st.pz)} · ${nameAt(st.px, st.pz)}`;
  }
  let bigRaf = 0;
  function bigLoop(now) { bigRaf = 0; if (!isOpen()) return; drawBig(now); bigRaf = requestAnimationFrame(bigLoop); }
  api.redraw = () => drawBig(performance.now());

  function open() {
    if (isOpen()) return;
    if (api.mode === 'B') renderBaseB();
    big.hidden = false; sizeBig();
    const st = gameState(); view.cx = st.px; view.cz = st.pz; view.k = Math.max(kFit, Math.min(1.6, 1.6)); clampView();
    api.sel = null; $('bigMapSel').hidden = true; syncButtons();
    document.body.classList.add('mmV161-open');
    drawBig(performance.now()); if (!bigRaf) bigRaf = requestAnimationFrame(bigLoop);
  }
  function close() { if (!isOpen()) return; big.hidden = true; api.sel = null; document.body.classList.remove('mmV161-open'); }
  api.open = open; api.close = close; api.isOpen = isOpen;
  mini.addEventListener('click', (e) => { e.preventDefault(); open(); });
  $('bigMapClose').addEventListener('click', close);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); else if ((e.key === 'm' || e.key === 'M') && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA/.test((e.target || {}).tagName || '')) (isOpen() ? close : open)(); });

  function syncButtons() {
    $('bigMapLabels').classList.toggle('on', api.labels); $('bigMapTransit').classList.toggle('on', api.transit);
    $('bigMapNorth').textContent = api.rot ? L('По камере', 'Camera up') : L('Север сверху', 'North up'); $('bigMapNorth').classList.toggle('on', api.rot);
    const lbl = 'x' + api.speed;
    if (speedBtn) { speedBtn.textContent = lbl; speedBtn.classList.toggle('on', api.speed > 1); }
    const bs = $('bigMapSpeed'); if (bs) { bs.textContent = L('Скорость ', 'Speed ') + lbl; bs.classList.toggle('on', api.speed > 1); }
    $('bigMapTransit').style.display = G ? '' : 'none';
  }
  $('bigMapLabels').addEventListener('click', () => { api.labels = !api.labels; savePrefs(); syncButtons(); });
  $('bigMapTransit').addEventListener('click', () => { api.transit = !api.transit; savePrefs(); syncButtons(); });
  $('bigMapNorth').addEventListener('click', () => { api.rot = !api.rot; savePrefs(); syncButtons(); });
  const zoomBy = (f, sx = bw / 2, sz = bh / 2) => { const before = s2w(sx, sz); view.k *= f; clampView(); const after = s2w(sx, sz); view.cx += before[0] - after[0]; view.cz += before[1] - after[1]; clampView(); };
  $('bigMapZoomIn').addEventListener('click', () => zoomBy(1.5));
  $('bigMapZoomOut').addEventListener('click', () => zoomBy(1 / 1.5));
  $('bigMapCenter').addEventListener('click', () => { const st = gameState(); view.cx = st.px; view.cz = st.pz; clampView(); });
  api.setView = (cx, cz, k) => { view.cx = cx; view.cz = cz; if (k) view.k = k; clampView(); };
  api.zoomBy = zoomBy;

  // ---- pointers: one finger drags / taps, two fingers pinch, wheel zooms
  const ptrs = new Map(); let pinch = null, moved = 0, downAt = 0;
  bcanvas.addEventListener('pointerdown', (e) => {
    try { bcanvas.setPointerCapture(e.pointerId); } catch (_) {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) { moved = 0; downAt = performance.now(); }
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: view.k }; moved = 99; }
  });
  bcanvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptrs.size === 1) { moved += Math.abs(dx) + Math.abs(dy); if (moved > 8) { view.cx -= dx / view.k; view.cz -= dy / view.k; clampView(); } }
    else if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1, r = bcanvas.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left, my = (a.y + b.y) / 2 - r.top, want = pinch.k * d / pinch.d;
      zoomBy(want / view.k, mx, my);
    }
  });
  const endPtr = (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    const wasTap = ptrs.size === 1 && moved <= 8 && performance.now() - downAt < 600 && e.type === 'pointerup';
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (wasTap) { const r = bcanvas.getBoundingClientRect(), w = s2w(e.clientX - r.left, e.clientY - r.top); selectPoint(w[0], w[1]); }
  };
  bcanvas.addEventListener('pointerup', endPtr); bcanvas.addEventListener('pointercancel', endPtr);
  bcanvas.addEventListener('wheel', (e) => { e.preventDefault(); const r = bcanvas.getBoundingClientRect(); zoomBy(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  function selectPoint(x, z) {
    api.sel = { x, z };
    const el = $('bigMapSel'); el.hidden = false;
    $('bigMapSelName').textContent = nameAt(x, z);
    $('bigMapSelPos').textContent = `x ${Math.round(x)}, z ${Math.round(z)}`;
  }
  api.selectPoint = selectPoint;

  // ------------------------------------------------------------------ teleport (debug)
  function walkable(x, z) {
    if (isC()) return !!D.access(x, z, 0.6);
    try { const r = clampPlayerBoundsV161(x, z); return Math.abs(r.x - x) < 1e-6 && Math.abs(r.z - z) < 1e-6 && (masterplanAccessV161(x, z) || (Math.abs(x) <= GROUND_HALF - 1 && Math.abs(z) <= GROUND_HALF - 1)); } catch (_) { return false; }
  }
  function surfaceFor(x, z) {   // plan C: the ground when there is one, otherwise the only / lowest deck
    if (!isC()) return 0;
    const s = D.surfaces(x, z); if (!s.length) return null;
    return s.includes(0) ? 0 : Math.min(...s);
  }
  function findStand(x, z, maxR = 120) {
    if (!isC()) {   // layout B: a tap beside / beyond the island means the nearest point of the island
      const h = (typeof GROUND_HALF !== 'undefined' ? GROUND_HALF : 70) - 2;
      if (!walkable(x, z) && (Math.abs(x) > h || Math.abs(z) > h)) { const cx = Math.max(-h, Math.min(h, x)), cz = Math.max(-h, Math.min(h, z)); const r = findStandAt(cx, cz, maxR); if (r) { r.moved += Math.hypot(cx - x, cz - z); return r; } }
    }
    return findStandAt(x, z, maxR);
  }
  function findStandAt(x, z, maxR) {
    const v = playerVelocity.x, w = playerVelocity.z, lvl = window.PlanCV161 ? window.PlanCV161.level : 0;
    try {
      for (let r = 0; r <= maxR; r += (r < 6 ? 1.5 : 3)) {
        const n = r === 0 ? 1 : Math.max(8, Math.round(2 * Math.PI * r / 2.4));
        for (let i = 0; i < n; i++) {
          const a = i / n * 6.2832, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
          if (!walkable(px, pz)) continue;
          const y = surfaceFor(px, pz); if (y == null) continue;
          if (window.PlanCV161) window.PlanCV161.level = y;
          const circles = gatherPhysicsCircles(), sol = resolvePlayerCircleCollisions(px, pz, circles);
          if (Math.hypot(sol.x - px, sol.z - pz) > 0.02) continue;
          return { x: px, z: pz, y, moved: r };
        }
      }
    } finally { playerVelocity.x = v; playerVelocity.z = w; if (window.PlanCV161) window.PlanCV161.level = lvl; }
    return null;
  }
  api.findStand = findStand;
  function teleport(x, z) {
    if (!DEBUG) return { ok: false, reason: 'debug off' };
    const s = findStand(x, z);
    if (!s) { try { toast(L('Рядом нет проходимой точки', 'No walkable spot nearby')); } catch (_) {} return { ok: false, reason: 'no spot' }; }
    const o = player.position.clone();
    player.position.set(s.x, s.y, s.z);
    playerVelocity.set(0, 0, 0); playerVerticalVelocity = 0; playerGrounded = true;
    if (window.PlanCV161) { window.PlanCV161.level = s.y; window.PlanCV161.airborneBase = null; }
    const d = player.position.clone().sub(o);
    camera.position.add(d); controls.target.add(d); try { camEyeTarget.add(d); } catch (_) {}
    try { if (window.PlanCV161) window.PlanCV161.ensureNear(s.x, s.z); } catch (_) {}
    try { if (window.MasterplanV161 && window.MasterplanV161.ensureNear) window.MasterplanV161.ensureNear(s.x, s.z); } catch (_) {}
    stCache = null; api.last = { x: s.x, z: s.z, y: s.y, moved: s.moved };
    try { toast(L('Телепорт: ', 'Teleport: ') + Math.round(s.x) + ', ' + Math.round(s.z)); } catch (_) {}
    return { ok: true, ...s };
  }
  api.teleport = teleport;
  const tpBtn = $('bigMapTeleport');
  if (tpBtn) tpBtn.addEventListener('click', () => { if (!api.sel) return; const r = teleport(api.sel.x, api.sel.z); if (r.ok) close(); });

  // ------------------------------------------------------------------ speed (debug): extra movement through the game's own collision sub-steps
  function liftTo(x, z) {   // plan C: stay on the surface under the new point (camera moves with it, like the layer's own updatePlayer wrapper)
    const P = window.PlanCV161; if (!P || !isC() || !playerGrounded) return;
    const lvl = P.level; let t = D.surfaceY(x, z, lvl, 0.75); if (t == null) t = 0;
    if (lvl - t > 0.45 || Math.abs(t - lvl) < 1e-6) return;      // a real drop: the layer's wrapper starts the fall next frame
    const dy = t - lvl; player.position.y += dy; P.level = t; camera.position.y += dy; controls.target.y += dy; try { camEyeTarget.y += dy; } catch (_) {}
  }
  function extraMove(dt, extra) {
    const vx = playerVelocity.x, vz = playerVelocity.z, sp = Math.hypot(vx, vz); if (sp < 0.05) return 0;
    dt = Math.min(dt, 0.1);
    const total = sp * dt * extra, n = Math.max(1, Math.ceil(total / 0.14)), circles = gatherPhysicsCircles();
    let moved = 0;
    for (let s = 0; s < n; s++) {
      const bx = player.position.x, bz = player.position.z, sx = playerVelocity.x * dt * extra / n, sz = playerVelocity.z * dt * extra / n;
      const b = clampPlayerBoundsV161(bx + sx, bz + sz), sol = resolvePlayerCircleCollisions(b.x, b.z, circles), safe = clampPlayerBoundsV161(sol.x, sol.z);
      moved += Math.hypot(safe.x - bx, safe.z - bz);
      player.position.x = safe.x; player.position.z = safe.z; liftTo(safe.x, safe.z);
    }
    return moved;
  }
  const baseUpdatePlayer = updatePlayer;
  updatePlayer = function (dt) {
    const r = baseUpdatePlayer.apply(this, arguments);
    if (DEBUG && api.speed > 1) { try { api.extraMoved = extraMove(dt, api.speed - 1); } catch (e) { api.extraError = String(e); } }
    return r;
  };
  api.setSpeed = (v) => { api.speed = DEBUG && (v === 3 || v === 6) ? v : 1; saveSpeed(); syncButtons(); };
  const cycle = () => api.setSpeed(api.speed === 1 ? 3 : api.speed === 3 ? 6 : 1);
  if (speedBtn) speedBtn.addEventListener('click', cycle);
  const bs = $('bigMapSpeed'); if (bs) bs.addEventListener('click', cycle);
  syncButtons();

  // ------------------------------------------------------------------ boot: base map after the first frames, markers at <= 10 Hz from the game's visual tick list
  setTimeout(startBase, isC() ? 1200 : 400);
  let lastDraw = 0, lastB = 0;
  (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push((now) => {
    if (document.hidden) return;
    if (!isC() && now - lastB > 2000) { lastB = now; if (api.ready && bSignature() !== bSig) renderBaseB(); }
    if (now - lastDraw < 100) return; lastDraw = now;
    if (!isOpen()) drawMini(now);
  });
  api.drawMini = () => { stCache = null; drawMini(performance.now()); };
  window.dispatchEvent(new Event('resize'));   // layoutTopV46 places the dock
})();
