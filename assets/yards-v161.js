/* Loading yards (v161 layer, CHANGELOG_V161.md 2026-10-10 (12)) -- user: "отдельно давай всю погрузку в другое место, а не на дороги, там бетон, металл, давай всё-таки не жестить
 * и соблюдать структуру".
 *
 * Until now the concrete / metal pickup pads and the piles on them stood ON the service lane (pad = the lane centre, z -7.2), the trucks of all three cargos stopped on the carriageway
 * (the plank spur's last metres, the corridor), and the plants' own plates / aprons reached into the lane. Every cargo now has a LOADING YARD of its own beside the lane:
 *   - a paved slab (concrete family, NOT asphalt) with a kerb and a dropped-kerb gate that two bollards flank, hazard stripes across the gate, a truck bay marked on the slab (side lines,
 *     wheel stop), a lamp post and a cargo sign; the static parts are merged (slab+kerb / paint / lamp heads = 3 meshes, +1 for the plank stack);
 *   - the stock on display equals the real stock: concrete / metal = the pile the plant already animates (PlantsV161 PILES, its pose now points into the yard: the blocks hop over the
 *     lane onto it, the jib reaches it), planks = a board stack in the plank yard (floor(planks), at most STACK_CAP, one mesh with a draw range);
 *   - the trucks stop IN the bay (cargoInfo(...).source), off the carriageway; the route is the game's own up to the lane node (`entry`) and a short lead-in polyline through the gate
 *     (leadIn), the way out is the same polyline reversed. The player's pad stands on the concrete / metal pile (LOGISTICS_ZONES pos); the plank pad stays under the sawmill's lean-to.
 * Roads, nodes, driveways and the depot lot are untouched (road signatures stay): the yards are drawn OUTSIDE the road groups.
 * YardsV161.enabled = false gives the old on-the-lane layout back for before/after numbers (the game must be rebuilt then: plants, zones, cargo sources).
 * Coordinates are written relative to the industrial zone offset (INDUSTRIAL_ZONE_OFFSET_X), like the service graph. `yaw` is the rotation.y of a truck heading along the bay.
 */
'use strict';
(() => {
  const TAU = Math.PI * 2;
  const OX = () => { try { return INDUSTRIAL_ZONE_OFFSET_X; } catch (e) { return -32; } };   // lexical global of the main script, read lazily
  const FLOOR = 0.05, KERB_H = 0.09, KERB_W = 0.1;
  const RAW = {
    // slab: [x0, z0, x1, z1]; stop: truck centre; leadIn: points between the lane node `entry` and the stop; pile: centre of the stock display (pad); gate: dropped kerb on one edge
    planks: {
      flag: () => sawmillBuiltV118, entry: 'plankBay', slab: [-20.2, -4.5, -16.45, -2.0], stop: [-17.6, -3.2], yaw: -Math.PI / 2, leadIn: [[-16.5, -3.2]], pile: [-19.5, -3.2],
      gate: { edge: 'x1', c: -3.2, len: 2.5 }, lamp: [-20.0, -2.2], sign: [-20.0, -4.3], accent: 0xd0ab68,
    },
    concrete: {
      flag: () => concretePlantBuiltV118 && stageIndex >= CONCRETE_UNLOCK_STAGE, entry: 'depotWest', slab: [-15.0, -6.3, -9.6, -4.85], stop: [-13.4, -5.5], yaw: Math.PI / 2,
      leadIn: [[-14.2, -6.7], [-14.4, -6.0], [-14.35, -5.5]], pile: [-11.1, -5.5],
      gate: { edge: 'z0', c: -14.15, len: 1.8 }, lamp: [-9.85, -5.05], sign: [-9.95, -6.1], accent: 0xc8c3ac,
    },
    metal: {
      flag: () => metalYardBuiltV118 && stageIndex >= METAL_UNLOCK_STAGE, entry: 'metalBay', slab: [-5.1, -8.6, -0.4, -5.5], stop: [-3.6, -6.3], yaw: Math.PI / 2,
      leadIn: [[-6.0, -7.2], [-5.0, -6.55], [-4.3, -6.3]], pile: [-2.9, -7.9],
      gate: { edge: 'x0', c: -6.65, len: 2.4 }, lamp: [-0.7, -5.75], sign: [-0.7, -8.3], accent: 0x91acb6,
    },
  };
  // choppable trees the concrete yard stands on (the generator ring puts one on the lane's edge): moved the shortest way off the slab (matched by position, rel. to the zone offset)
  const TREE_MOVES = [{ from: [-11.24, -6.27], to: [-11.2, -3.7] }];
  const KEYS = ['planks', 'concrete', 'metal'];
  const STACK_CAP = 24;

  let SPEC = null, SPEC_OX = null;
  function spec() {
    const ox = OX();
    if (SPEC && SPEC_OX === ox) return SPEC;
    SPEC = {}; SPEC_OX = ox;
    for (const k of KEYS) {
      const r = RAW[k], s = { key: k, flag: r.flag, entry: r.entry, yaw: r.yaw, accent: r.accent, gate: r.gate };
      s.slab = { x0: r.slab[0] + ox, z0: r.slab[1], x1: r.slab[2] + ox, z1: r.slab[3] };
      s.stop = new THREE.Vector3(r.stop[0] + ox, 0, r.stop[1]);
      s.pile = new THREE.Vector3(r.pile[0] + ox, 0, r.pile[1]);
      s.leadIn = r.leadIn.map((p) => new THREE.Vector3(p[0] + ox, 0, p[1]));
      s.lamp = new THREE.Vector3(r.lamp[0] + ox, 0, r.lamp[1]);
      s.sign = new THREE.Vector3(r.sign[0] + ox, 0, r.sign[1]);
      s.gateC = r.gate.edge === 'x0' || r.gate.edge === 'x1' ? r.gate.c : r.gate.c + ox;
      SPEC[k] = s;
    }
    return SPEC;
  }

  // ---------------------------------------------------------------------------------------------- plain-data helpers (used by the game, the plants, the tests)
  const pad = (k) => spec()[k].pile.clone();
  const stop = (k) => spec()[k].stop.clone();
  // plant-local pose of the pile for PlantsV161 (plants stand unrotated at CONCRETE_PLANT_POS / METAL_YARD_POS)
  function pilePose(kind) {
    const s = spec()[kind]; if (!s) return null;
    let o = null; try { o = kind === 'concrete' ? CONCRETE_PLANT_POS : kind === 'metal' ? METAL_YARD_POS : null; } catch (e) { return null; }
    if (!o) return null;
    return { x: s.pile.x - o.x, y: 0.075, z: s.pile.z - o.z, rot: 0 };
  }
  const inRect = (s, x, z, m) => x >= s.slab.x0 - m && x <= s.slab.x1 + m && z >= s.slab.z0 - m && z <= s.slab.z1 + m;
  function yardAt(pos, m) {   // the yard whose slab (grown by m) contains the point
    if (!pos) return null;
    const S = spec();
    for (const k of KEYS) if (inRect(S[k], pos.x, pos.z, m || 0)) return S[k];
    return null;
  }
  function entryPos(s) {
    try { const n = serviceAccessGraph().find((q) => q.id === s.entry); if (n) return n.p.clone(); } catch (e) { /* graph not ready */ }
    return null;
  }
  // game route wrapper: `base(from, to)` is the game's own route builder. A route to a truck bay = the game's route to the lane node `entry` + the lead-in + the bay;
  // a route out of a yard = the lead-in reversed to the node + the game's route onward. Returns null when neither end is a yard (the caller then uses `base`).
  function route(from, to, base) {
    const S = spec();
    let toY = null; for (const k of KEYS) if (Math.hypot(to.x - S[k].stop.x, to.z - S[k].stop.z) < 0.35) toY = S[k];
    const fromY = yardAt(from, 0.4);
    if (!toY && !fromY) return null;
    if (toY && fromY === toY) return [from.clone(), toY.stop.clone()];
    const out = [from.clone()];
    let cur = from;
    if (fromY) {   // leave through the gate, along the lead-in reversed, to the lane node
      const e = entryPos(fromY); if (!e) return null;
      for (let i = fromY.leadIn.length - 1; i >= 0; i--) out.push(fromY.leadIn[i].clone());
      out.push(e); cur = e;
    }
    const dest = toY ? entryPos(toY) : to;
    if (!dest) return null;
    const rest = base(cur, dest);   // the game's own route; its first point is `cur`
    for (let i = 1; i < rest.length; i++) out.push(rest[i].clone ? rest[i].clone() : rest[i]);
    if (toY) { for (const p of toY.leadIn) out.push(p.clone()); out.push(toY.stop.clone()); }
    return out;
  }

  // ---------------------------------------------------------------------------------------------- geometry
  const K = () => window.PlantsV161 && window.PlantsV161.kit;
  const colors = { slabKerb: 0xc7cbd0, white: 0xe9eef2, yellow: 0xf0b21a, dark: 0x2b3440, post: 0x39434e, steel: 0x56697c, wood: 0xe3c590, woodDark: 0xc9a56b };
  let GROUP = null; const yards = {};   // key -> { group, stack, shown }
  function buildYard(s) {
    const kit = K(); if (!kit) return null;
    const { batch, mats, C } = kit, M = mats();
    const g = new THREE.Group(); g.name = 'v161Yard_' + s.key; g.userData.v161Yard = s.key;
    const W = s.slab.x1 - s.slab.x0, D = s.slab.z1 - s.slab.z0, cx = (s.slab.x0 + s.slab.x1) / 2, cz = (s.slab.z0 + s.slab.z1) / 2;
    const SL = batch(false), P = batch(true), L = batch(false);
    SL.box(W, FLOOR, D, cx, FLOOR / 2, cz);
    // kerb around the slab, a gap (dropped kerb) where the trucks come in
    const gap = s.gate;
    const edge = (name, ax, az, len, x, z, along) => {   // along 'x': strip runs along x
      const c0 = along === 'x' ? x - len / 2 : z - len / 2, c1 = c0 + len;
      let segs = [[c0, c1]];
      if (gap.edge === name) { const g0 = gap.c - gap.len / 2, g1 = gap.c + gap.len / 2; segs = []; if (g0 > c0) segs.push([c0, Math.min(g0, c1)]); if (g1 < c1) segs.push([Math.max(g1, c0), c1]); }
      for (const [a, b] of segs) { if (b - a < 0.02) continue; if (along === 'x') SL.box(b - a, KERB_H, KERB_W, (a + b) / 2, KERB_H / 2, z); else SL.box(KERB_W, KERB_H, b - a, x, KERB_H / 2, (a + b) / 2); }
    };
    const gc = s.gate.edge === 'x0' || s.gate.edge === 'x1' ? s.gateC : s.gateC;
    const gapIn = { edge: s.gate.edge, c: gc, len: s.gate.len };
    const saved = s.gate; s.gate = gapIn;
    edge('z0', 0, 0, W, cx, s.slab.z0 + KERB_W / 2, 'x'); edge('z1', 0, 0, W, cx, s.slab.z1 - KERB_W / 2, 'x');
    edge('x0', 0, 0, D, s.slab.x0 + KERB_W / 2, cz, 'z'); edge('x1', 0, 0, D, s.slab.x1 - KERB_W / 2, cz, 'z');
    s.gate = saved;
    // hazard stripes across the gate (yellow / dark, diagonal blocks) + bollards flanking it
    const gx = s.gate.edge === 'x0' ? s.slab.x0 + 0.3 : s.gate.edge === 'x1' ? s.slab.x1 - 0.3 : gc;
    const gz = s.gate.edge === 'z0' ? s.slab.z0 + 0.3 : s.gate.edge === 'z1' ? s.slab.z1 - 0.3 : gc;
    const alongX = s.gate.edge === 'z0' || s.gate.edge === 'z1';
    const nStripe = Math.max(4, Math.round(s.gate.len / 0.2));
    for (let i = 0; i < nStripe; i++) {
      const t = (i + 0.5) / nStripe - 0.5, o = t * (s.gate.len - 0.3);
      P.box(0.16, 0.012, 0.16, alongX ? gx + o : gx, FLOOR + 0.006, alongX ? gz : gz + o, { c: i % 2 ? colors.dark : colors.yellow, ry: 0.78 });
    }
    s.bollards = [];
    for (const sgn of [-1, 1]) {
      const bx = alongX ? gc + sgn * (s.gate.len / 2 + 0.02) : (s.gate.edge === 'x0' ? s.slab.x0 + 0.1 : s.slab.x1 - 0.1);
      const bz = alongX ? (s.gate.edge === 'z0' ? s.slab.z0 + 0.1 : s.slab.z1 - 0.1) : gc + sgn * (s.gate.len / 2 + 0.02);
      P.cyl(0.075, 0.075, 0.72, 10, bx, FLOOR + 0.36, bz, { c: colors.yellow });
      P.cyl(0.078, 0.078, 0.12, 10, bx, FLOOR + 0.55, bz, { c: colors.dark });
      s.bollards.push([bx, bz]);
    }
    // truck bay: side lines + wheel stop (local frame of the truck: +z = forward)
    const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
    const loc = (lx, lz) => [s.stop.x + c * lx + n * lz, s.stop.z - n * lx + c * lz];   // rotation.y = yaw: x' = c x + s z, z' = -s x + c z
    for (const sx of [-0.78, 0.78]) { const [bx, bz] = loc(sx, 0.0); P.box(0.07, 0.01, 2.7, bx, FLOOR + 0.005, bz, { c: colors.white, ry: s.yaw }); }
    { const [bx, bz] = loc(0, 1.3); P.box(1.0, 0.1, 0.14, bx, FLOOR + 0.05, bz, { c: colors.yellow, ry: s.yaw }); P.box(1.0, 0.012, 0.07, bx, FLOOR + 0.106, bz, { c: colors.dark, ry: s.yaw }); }
    if (s.key === 'planks') {   // corner marks around the board stack (the concrete / metal piles stand on the game's own pad mat with its corner posts)
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const px = s.pile.x + sx * 0.48, pz = s.pile.z + sz * 0.95;
        P.box(0.3, 0.01, 0.05, px - sx * 0.12, FLOOR + 0.005, pz, { c: colors.white }); P.box(0.05, 0.01, 0.3, px, FLOOR + 0.005, pz - sz * 0.12, { c: colors.white });
      }
    }
    // lamp post with a short arm toward the yard, sign post with an accent plate
    P.cyl(0.05, 0.065, 3.0, 8, s.lamp.x, FLOOR + 1.5, s.lamp.z, { c: colors.post });
    const tx = cx - s.lamp.x, tz = cz - s.lamp.z, tl = Math.hypot(tx, tz) || 1, ax = s.lamp.x + tx / tl * 0.5, az = s.lamp.z + tz / tl * 0.5;
    P.bar(s.lamp.x, FLOOR + 2.95, s.lamp.z, ax, FLOOR + 2.95, az, 0.05, 0.05, colors.post);
    L.box(0.26, 0.06, 0.2, ax, FLOOR + 2.9, az);
    P.box(0.3, 0.025, 0.24, ax, FLOOR + 2.96, az, { c: colors.post });
    P.box(0.07, 1.25, 0.07, s.sign.x, FLOOR + 0.625, s.sign.z, { c: colors.post });
    P.box(0.56, 0.34, 0.05, s.sign.x, FLOOR + 1.28, s.sign.z, { c: colors.dark });
    P.box(0.5, 0.28, 0.06, s.sign.x, FLOOR + 1.28, s.sign.z, { c: s.accent });
    P.box(0.34, 0.05, 0.065, s.sign.x, FLOOR + 1.2, s.sign.z, { c: colors.dark });
    const add = (m) => { if (m) { g.add(m); } return m; };
    add(SL.toMesh(M.slab, { name: 'v161YardSlab_' + s.key, cast: false }));
    add(P.toMesh(M.paint, { name: 'v161YardPaint_' + s.key }));
    add(L.toMesh(M.lamp, { name: 'v161YardLamp_' + s.key, cast: false }));
    if (s.key === 'planks') {   // dispatch stack of boards: 3 across, layer by layer, the first n boards = the bottom n (draw range follows floor(planks))
      const B = batch(true);
      for (let i = 0; i < STACK_CAP; i++) { const layer = Math.floor(i / 3), k = i % 3; B.box(0.2, 0.075, 1.5, s.pile.x + (k - 1) * 0.22 + ((i * 37) % 7 - 3) * 0.004, FLOOR + 0.0375 + 0.03 + layer * 0.08, s.pile.z + ((i * 13) % 5 - 2) * 0.012, { c: i % 3 === 1 ? colors.woodDark : colors.wood }); }
      const stack = add(B.toMesh(M.paint, { name: 'v161YardPlankStack' }));
      stack.frustumCulled = false; stack.userData.drawPer = 36; stack.visible = false; stack.geometry.setDrawRange(0, 0);
      stack.userData.v161Soft = true;
      yards.planks_stack = stack;
    }
    // obstacles: bollards, lamp post, sign post (small oriented boxes, registry flags like the plants')
    s.obstacles = [];
    s.bollards.forEach((b, i) => s.obstacles.push({ label: `yard-${s.key}:bollard${i}`, x: b[0], z: b[1], hx: 0.09, hz: 0.09 }));
    s.obstacles.push({ label: `yard-${s.key}:lamp`, x: s.lamp.x, z: s.lamp.z, hx: 0.1, hz: 0.1 }, { label: `yard-${s.key}:sign`, x: s.sign.x, z: s.sign.z, hx: 0.1, hz: 0.1 });
    return g;
  }

  // decor (bushes / flowers) standing on a slab is hidden like the sawmill does; choppable trees are moved (TREE_MOVES), never deleted
  function clearDecor(s) {
    let hidden = 0;
    for (const o of scene.children) {
      const ud = o.userData;
      if (!ud || !ud.foliageKindV154 || ud.harvestableTree || o.visible === false) continue;
      if (inRect(s, o.position.x, o.position.z, 0.5)) { o.visible = false; ud.v161YardClearance = true; ud.v93RoadClearance = true; hidden++; }
    }
    return hidden;
  }
  function nudgeTrees(trees) {
    const ox = OX(); let moved = 0;
    for (const t of trees || []) {
      const m = t.mesh && t.mesh.position; if (!m) continue;
      for (const mv of TREE_MOVES) if (Math.hypot(m.x - (mv.from[0] + ox), m.z - mv.from[1]) < 0.4) { m.set(mv.to[0] + ox, m.y, mv.to[1]); moved++; }
    }
    return moved;
  }

  // a truck that stands in its bay (state 'loading') eases its heading to the bay's yaw (the lead-in is short, the truck arrives a few degrees off)
  function settle(v, dt) {
    const ud = v && v.userData; if (!ud || ud.state !== 'loading' || !api.enabled) return;
    const S = spec();
    for (const k of KEYS) {
      const s = S[k]; if (Math.hypot(v.position.x - s.stop.x, v.position.z - s.stop.z) > 0.3) continue;
      let d = s.yaw - v.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      v.rotation.y += d * Math.min(1, (dt || 0.05) * 5);
      return;
    }
  }
  function sync() {   // builds on first use, then follows the building flags
    if (!api.enabled) { if (GROUP) GROUP.visible = false; return; }
    let S; try { S = spec(); } catch (e) { return; }
    if (!GROUP) {
      if (!K() || typeof scene === 'undefined' || !scene) return;
      GROUP = new THREE.Group(); GROUP.name = 'v161LoadingYards';
      for (const k of KEYS) { const g = buildYard(S[k]); if (!g) { GROUP = null; return; } yards[k] = { group: g, hidden: clearDecor(S[k]) }; GROUP.add(g); }
      scene.add(GROUP);
      try { nudgeTrees(sourceTrees); } catch (e) { /* trees not there yet */ }
      try { window.__TYCOON_V83_COLLISIONS__?.rebuild?.(); } catch (e) { /* registry not up yet */ }
    }
    let changed = false;
    for (const k of KEYS) {
      let on = false; try { on = !!S[k].flag(); } catch (e) { on = false; }
      const g = yards[k].group; if (g.visible !== on) { g.visible = on; changed = true; }
    }
    GROUP.visible = true;
    if (changed) { try { window.__TYCOON_V83_COLLISIONS__?.rebuild?.(); } catch (e) { /* ignore */ } }
  }
  // plank stack follows floor(planks), called every frame by syncPlankStackV161 (the boards appear in the frame the game credits them)
  function tick(n) {
    const st = yards.planks_stack; if (!st) return -1;
    n = Math.max(0, Math.min(STACK_CAP, n | 0));
    if (st.userData.shown !== n) { st.userData.shown = n; st.geometry.setDrawRange(0, n * st.userData.drawPer); st.visible = n > 0; }
    return n;
  }
  function obstacles() {
    const out = []; if (!GROUP || !api.enabled) return out;
    const S = spec();
    for (const k of KEYS) { const y = yards[k]; if (!y || !y.group.visible) continue; for (const o of S[k].obstacles || []) out.push({ owner: y.group, label: o.label, pos: new THREE.Vector3(o.x, 0, o.z), hx: o.hx, hz: o.hz, yaw: 0 }); }
    return out;
  }
  function snap() {
    const S = spec(), out = { built: !!GROUP, yards: {} };
    for (const k of KEYS) {
      const y = yards[k]; if (!y) continue;
      let meshes = 0; y.group.traverse((m) => { if (m.isMesh) meshes++; });
      out.yards[k] = { visible: y.group.visible, meshes, decorHidden: y.hidden, stop: { x: S[k].stop.x, z: S[k].stop.z }, pile: { x: S[k].pile.x, z: S[k].pile.z }, slab: S[k].slab };
    }
    const st = yards.planks_stack; out.plankStack = st ? { shown: st.userData.shown, visible: st.visible, range: st.geometry.drawRange.count, boards: st.userData.drawPer ? st.geometry.drawRange.count / st.userData.drawPer : 0 } : null;
    return out;
  }
  const api = { enabled: true, version: 'v161-yards', KEYS, STACK_CAP, spec, pad, stop, pilePose, yardAt, route, settle, sync, tick, obstacles, snap, nudgeTrees, group: () => GROUP, yardGroup: (k) => (yards[k] ? yards[k].group : null), padPos: pad, stopPos: stop };
  window.YardsV161 = api;
})();
