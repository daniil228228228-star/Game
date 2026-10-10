/* Market v161 (2026-10-05 (7), "improve physics and design of every building, one at a time", family #3: the market plaza and its 7 stalls).
 *
 * Benchmark = the sawmill v2: one coherent object per stall, readable silhouette, details, merged meshes (4-6 draw calls per stall instead of 11), solid where it is solid.
 *   plaza     : paving rings (light / walking ring / dark bands) on the old 6.7 m disc (top 0.06 as before, nothing sunk: min y 0), a curb ring, a fountain in the middle
 *               (basin, pillar, bowl, animated jet), 4 benches and 3 stone planters around it (never on a lane to a stall), 6 lamps between the stalls, the entrance gate on
 *               the side of the spawn (two posts with lanterns, the "РЫНОК" sign). Lanterns glow at night (the game's own isNightV40()).
 *   stall     : deck + customer apron, back wall, low side panels, counter with an accent band, posts, striped awning (accent + cream, scalloped edge), lantern, goods.
 *               One silhouette per trade: team (notice board + hard hats), fleet (tyre stack + drum, wide flat awning, beacon), tenders (flag pole, blueprint rack), operations
 *               (dish + mast + monitors, cable reel), meta (tall gabled tent, golden arrow on a pedestal), bonus (balloons, gift stack, bunting), exchange (a closed kiosk with a
 *               service window, balance scale, sample plank / block / ingot, sign board with two arrows). Props carry NO stock: nothing here implies a number the game does not
 *               show (rule 1 of the world-consistency rules); the exchange samples are one item each.
 *   vacant    : an unlocked-but-not-built stall is an empty market lot: the orange build pad, four corner stakes with a rope on three sides and a flag in the future stall's
 *               accent colour. Not a ghost of the stall.
 * Physics: every stall lists its real solid parts in `userData.v161Footprint` (local x, z, hx, hz): the sealed stall body (back wall + side panels + counter, the customer side in
 *   front of the counter is open and walkable) and the big solid props. Registered by the v83 registry (tycoon-v161.html rebuildStatic -> MarketV161.obstacles()) as oriented boxes
 *   with the stall's yaw. Awning posts and the awning itself have no collider (thin / above the head). The plaza lists the fountain (circle), benches and planters.
 * `MarketV161.enabled = false` brings the old plaza / stalls / vacant markers back (the showcase tool uses it for before/after numbers).
 */
'use strict';
(() => {
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const TAU = Math.PI * 2;
  const DECK = 0.10;                 // stall deck top (the plaza slab top is 0.06)
  const PLAZA_TOP = 0.06;
  const CREAM = 0xf3e8cf;

  // ---------------------------------------------------------------------------------------------- merged geometry batch (optionally vertex coloured)
  function batch(vc) {
    const pos = [], nor = [], uv = [], col = [], idx = [];
    const m4 = new THREE.Matrix4(), n3 = new THREE.Matrix3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), v = new THREE.Vector3();
    function addMatrix(geo, matrix, color) {
      n3.getNormalMatrix(matrix);
      const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv, base = pos.length / 3;
      const rgb = vc ? lin(color === undefined ? 0xffffff : color) : null;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(N, i).applyMatrix3(n3).normalize(); nor.push(v.x, v.y, v.z);
        uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
        if (vc) col.push(rgb.r, rgb.g, rgb.b);
      }
      const I = geo.index;
      if (I) for (let k = 0; k < I.count; k++) idx.push(base + I.getX(k));
      else for (let k = 0; k < P.count; k++) idx.push(base + k);
      geo.dispose();
    }
    function add(geo, x, y, z, o) {
      o = o || {};
      q.setFromEuler(e.set(o.rx || 0, o.ry || 0, o.rz || 0, o.order || 'YXZ'));
      sc.set(o.sx || 1, o.sy || 1, o.sz || 1);
      addMatrix(geo, m4.compose(p.set(x, y, z), q, sc), o.c);
    }
    // one flat / smooth quad given as four points (counter-clockwise seen from outside) with one normal per point
    function quad(a, b, c, d, na, nb, nc, nd, color) {
      const base = pos.length / 3, rgb = vc ? lin(color === undefined ? 0xffffff : color) : null;
      const P = [a, b, c, d], N = [na, nb, nc, nd];
      for (let i = 0; i < 4; i++) {
        pos.push(P[i][0], P[i][1], P[i][2]); nor.push(N[i][0], N[i][1], N[i][2]); uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
        if (vc) col.push(rgb.r, rgb.g, rgb.b);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    // annulus slab r0..r1 from y0 to y1 about (cx, cz): top, outer wall, inner wall (r0 > 0), bottom only when y0 > 0
    function ring(cx, cz, r0, r1, y0, y1, seg, o) {
      o = o || {};
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * TAU, a1 = (i + 1) / seg * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
        const P = (r, c, s, y) => [cx + c * r, y, cz + s * r];
        if (o.top !== false) quad(P(r0, c0, s0, y1), P(r0, c1, s1, y1), P(r1, c1, s1, y1), P(r1, c0, s0, y1), [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], o.c);
        if (o.outer !== false) quad(P(r1, c0, s0, y0), P(r1, c0, s0, y1), P(r1, c1, s1, y1), P(r1, c1, s1, y0), [c0, 0, s0], [c0, 0, s0], [c1, 0, s1], [c1, 0, s1], o.c);
        if (r0 > 0 && o.inner !== false) quad(P(r0, c0, s0, y0), P(r0, c1, s1, y0), P(r0, c1, s1, y1), P(r0, c0, s0, y1), [-c0, 0, -s0], [-c1, 0, -s1], [-c1, 0, -s1], [-c0, 0, -s0], o.c);
        if (y0 > 0 && o.bottom) quad(P(r0, c0, s0, y0), P(r1, c0, s0, y0), P(r1, c1, s1, y0), P(r0, c1, s1, y0), [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0], o.c);
      }
    }
    return {
      add, ring, quad,
      box: (w, h, d, x, y, z, o) => add(new THREE.BoxGeometry(w, h, d), x, y, z, o),
      cyl: (rt, rb, h, seg, x, y, z, o) => add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false), x, y, z, o),
      ell: (rx, ry, rz, x, y, z, o) => add(new THREE.SphereGeometry(1, 8, 6), x, y, z, Object.assign({ sx: rx, sy: ry, sz: rz }, o || {})),
      get count() { return idx.length / 3; },
      toMesh(material, { cast = true, receive = true, name = '', soft = false } = {}) {
        if (!idx.length) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        if (vc) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.setIndex(idx);
        g.computeBoundingBox(); g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, material);
        mesh.castShadow = cast; mesh.receiveShadow = receive; mesh.name = name;
        if (soft) mesh.userData.v161Soft = true;
        return mesh;
      },
    };
  }

  // ---------------------------------------------------------------------------------------------- shared materials (never disposed)
  let MATS = null;
  function mats() {
    if (MATS) return MATS;
    const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
    const fam = (family, hex, opts) => share(createSurfaceMaterialV152(family, lin(hex), opts));
    MATS = {
      wood: fam('wood', 0xb78650, { roughness: 0.9 }),
      siding: fam('siding', 0xefe2c0, { roughness: 0.9 }),
      stoneLight: fam('concrete', 0xd2cbbb, { roughness: 0.93 }),
      stoneMid: fam('concrete', 0xb4ab9a, { roughness: 0.93 }),
      stoneDark: fam('concrete', 0x8a8377, { roughness: 0.92 }),
      deck: fam('concrete', 0xa89f90, { roughness: 0.94 }),
      paint: share(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0.03 })),
      lamp: share(new THREE.MeshStandardMaterial({ color: lin(0xfff0c2), emissive: lin(0xffb84a), emissiveIntensity: 0.35, roughness: 0.4 })),
      glass: share(new THREE.MeshStandardMaterial({ color: lin(0x9ccbe6), emissive: lin(0x1b3a52), emissiveIntensity: 0.3, roughness: 0.08, metalness: 0.25, transparent: true, opacity: 0.8, depthWrite: false })),
      water: share(new THREE.MeshStandardMaterial({ color: lin(0x4fb4e0), emissive: lin(0x0f4a68), emissiveIntensity: 0.35, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.88 })),
      jet: share(new THREE.MeshStandardMaterial({ color: lin(0xcdeeff), emissive: lin(0x5aa6c8), emissiveIntensity: 0.35, roughness: 0.2, transparent: true, opacity: 0.7, depthWrite: false })),
      pad: share(new THREE.MeshStandardMaterial({ color: lin(0xffb84d), roughness: 0.5, metalness: 0.05, emissive: lin(0x8a5216), emissiveIntensity: 0.24 })),
    };
    return MATS;
  }
  const castOk = () => { try { return !VISUAL_MOBILE; } catch (e) { return true; } };

  // a set of batches filled by the builders and turned into one mesh per material
  function parts() { return { wood: batch(false), siding: batch(false), deck: batch(false), paint: batch(true), lamp: batch(false), glass: batch(false) }; }
  function finish(P, group, extra) {
    const M = mats(), cast = castOk();
    const add = (m) => { if (m) group.add(m); return m; };
    add(P.deck.toMesh(M.deck, { cast: false, name: 'v161MarketDeck' }));
    add(P.wood.toMesh(M.wood, { cast, name: 'v161MarketWood' }));
    add(P.siding.toMesh(M.siding, { cast, name: 'v161MarketSiding' }));
    add(P.paint.toMesh(M.paint, { cast, name: 'v161MarketPaint' }));
    add(P.lamp.toMesh(M.lamp, { cast: false, receive: false, name: 'v161MarketLamp' }));
    add(P.glass.toMesh(M.glass, { cast: false, receive: false, name: 'v161MarketGlass' }));
    if (extra) extra(add);
  }

  // ---------------------------------------------------------------------------------------------- stall pieces
  // striped slanted awning: stripes along x (full width W centred on 0), from (zA, yA) at the back to (zB, yB) at the front (top surface, front lower), thickness t;
  // an odd stripe count so both edges are the accent colour; a diamond per stripe hangs over the front edge (scalloped valance)
  function awning(P, W, zA, yA, zB, yB, accent, cream, o) {
    o = o || {};
    const t = o.t || 0.04, n = o.n || (2 * Math.round(W / 0.6) + 1), w = W / n;
    const dz = zB - zA, dy = yA - yB, len = Math.hypot(dz, dy), th = Math.atan2(dy, dz), sn = Math.sin(th), cs = Math.cos(th);
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (i + 0.5) * w, c = i % 2 === 0 ? accent : cream;
      P.paint.box(w - 0.004, t, len, x, (yA + yB) / 2 - t / 2 * cs, (zA + zB) / 2 - t / 2 * sn, { c, rx: th });
      if (o.scallop !== false) {
        const s = w / Math.SQRT2, drop = t / 2 + 0.004;
        P.paint.box(s, t, s, x, yB - 0.12 * w * sn - drop * cs, zB + 0.12 * w * cs - drop * sn, { c, rx: th, ry: Math.PI / 4, order: 'XYZ' });
      }
    }
  }
  const post = (P, x, z, y0, y1, w, c) => P.wood.box(w || 0.09, y1 - y0, w || 0.09, x, (y0 + y1) / 2, z, c ? { c } : undefined);

  // everything every stall has: deck, apron, back wall, side panels, counter + band, posts, header, awning, lantern; returns the footprint of the sealed body
  function common(P, S, fp) {
    const { hw, hd, accent } = S, yF = S.yF, yB = S.yB, W = 2 * hw + 0.3;
    // deck + customer apron (walkable)
    P.deck.box(2 * hw + 0.3, DECK, 2 * hd + 0.2, 0, DECK / 2, 0);
    P.wood.box(2 * hw + 0.3, 0.078, 0.72, 0, 0.039, hd + 0.1 + 0.36);
    // sealed body: back wall (siding up to the awning), wainscot, low side panels, counter
    const backH = yB - DECK - 0.06;
    P.siding.box(2 * hw - 0.1, backH, 0.08, 0, DECK + backH / 2, -hd + 0.04);
    P.paint.box(2 * hw - 0.1, 0.5, 0.06, 0, DECK + 0.25, -hd + 0.105, { c: 0x6b4a2c });
    for (const sx of [-1, 1]) P.siding.box(0.06, 0.95, 2 * hd - 0.5, sx * (hw - 0.04), DECK + 0.475, -0.25 + 0.0, {});
    P.wood.box(2 * hw, 0.72, 0.43, 0, DECK + 0.36, hd - 0.235);
    P.wood.box(2 * hw + 0.10, 0.045, 0.54, 0, DECK + 0.72 + 0.0225, hd - 0.2);
    P.paint.box(2 * hw - 0.16, 0.22, 0.02, 0, DECK + 0.36, hd - 0.014, { c: accent });
    P.paint.box(2 * hw - 0.16, 0.03, 0.025, 0, DECK + 0.5, hd - 0.012, { c: CREAM });
    P.paint.box(2 * hw - 0.16, 0.03, 0.025, 0, DECK + 0.22, hd - 0.012, { c: CREAM });
    // posts (thin) + header beam
    for (const sx of [-1, 1]) { post(P, sx * hw, hd - 0.05, DECK, yF); post(P, sx * hw, -hd + 0.05, DECK, yB); }
    P.wood.box(2 * hw + 0.12, 0.1, 0.1, 0, yF + 0.0, hd - 0.05);
    // awning: slanted from the back (high) to over the customer side (low)
    awning(P, W, -hd - 0.12, yB + 0.06, hd + 0.40, yF + 0.07, accent, CREAM, S.awning);
    // lanterns on the header
    for (const sx of [-1, 1]) lantern(P, sx * (hw - 0.14), yF - 0.12, hd + 0.02);
    fp.push({ x: 0, z: -0.015, hx: hw + 0.07, hz: hd + 0.045 });   // sealed body: back wall + side panels + counter + 5 cm skin (customers stand on the open apron in front of it)
  }
  function lantern(P, x, y, z) {
    P.paint.box(0.012, 0.16, 0.012, x, y + 0.16, z, { c: 0x2a2f36 });
    P.paint.box(0.14, 0.03, 0.14, x, y + 0.075, z, { c: 0x2a2f36 });
    P.lamp.box(0.11, 0.14, 0.11, x, y, z);
    P.paint.box(0.14, 0.03, 0.14, x, y - 0.085, z, { c: 0x2a2f36 });
  }
  // a goods shelf on the back wall: board + items (inside the sealed stall)
  function shelf(P, hw, hd, y, items) {
    P.wood.box(2 * hw - 0.3, 0.04, 0.2, 0, y, -hd + 0.18);
    for (const it of items) P.paint.box(it.w, it.h, it.d || 0.14, it.x, y + 0.02 + it.h / 2, -hd + 0.18, { c: it.c });
  }
  const counterTop = (S) => DECK + 0.72 + 0.045;   // 0.865

  // ---------------------------------------------------------------------------------------------- the seven trades (local frame: +z = customers / plaza centre)
  const KINDS = {
    team(P, S, fp) {
      const { hw, hd } = S, ct = counterTop(S);
      common(P, S, fp);
      // five hard hats on pegs on the back wall + two on the counter
      const hat = [0xf5c518, 0xf5f5f0, 0xf08a1c, 0xf5c518, 0x4aa3e8];
      hat.forEach((c, i) => { const x = -0.8 + i * 0.4; P.wood.box(0.03, 0.03, 0.08, x, 1.28, -hd + 0.12); P.paint.ell(0.1, 0.07, 0.1, x, 1.34, -hd + 0.15, { c }); });
      shelf(P, hw, hd, 1.62, [{ x: -0.7, w: 0.3, h: 0.16, c: 0x5ab0ff }, { x: -0.3, w: 0.22, h: 0.22, c: 0xf3e8cf }, { x: 0.2, w: 0.3, h: 0.14, c: 0x3f78c4 }, { x: 0.65, w: 0.24, h: 0.2, c: 0xf3e8cf }]);
      P.paint.ell(0.11, 0.075, 0.11, -0.55, ct + 0.04, 0.35, { c: 0xf5c518 });
      P.paint.ell(0.11, 0.075, 0.11, 0.55, ct + 0.04, 0.4, { c: 0xf08a1c });
      for (let i = 0; i < 4; i++) P.paint.box(0.32, 0.02, 0.24, 0.0, ct + 0.01 + i * 0.022, 0.38, { c: i % 2 ? 0xfaf7ee : 0xe9e1cf, ry: 0.1 * i });   // paper stack
      P.paint.box(0.2, 0.01, 0.28, 0.0, ct + 0.1, 0.38, { c: 0x6b86a8, rx: -0.25 });                                            // clipboard
      // notice board on two posts at the left, pinned notes
      const bx = -hw - 0.5, bz = hd - 0.32;
      post(P, bx - 0.34, bz, 0, 1.0, 0.07); post(P, bx + 0.34, bz, 0, 1.0, 0.07);
      P.wood.box(0.84, 0.8, 0.05, bx, 1.2, bz);
      P.paint.box(0.76, 0.7, 0.012, bx, 1.2, bz + 0.03, { c: 0xcaa56e });
      [[-0.24, 1.36, 0xfaf7ee], [0.0, 1.4, 0xf5d84a], [0.24, 1.34, 0xff9bb0], [-0.18, 1.1, 0x9fd2ff], [0.1, 1.08, 0xfaf7ee], [0.28, 1.12, 0xb8e08a]].forEach(([dx, y, c], i) => P.paint.box(0.2, 0.26, 0.012, bx + dx, y - 0.0, bz + 0.042, { c, rz: (i % 3 - 1) * 0.06 }));
      P.paint.box(0.84, 0.07, 0.07, bx, 1.64, bz, { c: S.accent });
      fp.push({ x: bx, z: bz, hx: 0.47, hz: 0.13 });
    },
    fleet(P, S, fp) {
      const { hw, hd } = S, ct = counterTop(S);
      common(P, S, fp);
      // tyre stack + oil drum on the right
      const tx = hw + 0.5, tz = 0.15;
      for (let i = 0; i < 3; i++) { P.paint.cyl(0.3, 0.3, 0.2, 14, tx, 0.1 + i * 0.2, tz, { c: 0x2b2e33 }); P.paint.cyl(0.16, 0.16, 0.205, 10, tx, 0.1 + i * 0.2, tz, { c: 0x9aa1a8 }); }
      fp.push({ x: tx, z: tz, hx: 0.35, hz: 0.35 });
      P.paint.cyl(0.22, 0.22, 0.62, 12, tx, 0.31, tz - 0.74, { c: 0x2f6fb5 });
      P.paint.cyl(0.23, 0.23, 0.04, 12, tx, 0.4, tz - 0.74, { c: 0xe9eef2 });
      P.paint.cyl(0.23, 0.23, 0.04, 12, tx, 0.22, tz - 0.74, { c: 0xe9eef2 });
      fp.push({ x: tx, z: tz - 0.74, hx: 0.27, hz: 0.27 });
      // beacon on the awning (amber dome on a base) + a hazard stripe board on the parapet
      const bt = S.awnTop(-hd + 0.25) - 0.03;
      P.paint.cyl(0.13, 0.15, 0.1, 10, -hw + 0.3, bt + 0.05, -hd + 0.25, { c: 0x3a3f46 });
      P.paint.ell(0.12, 0.12, 0.12, -hw + 0.3, bt + 0.14, -hd + 0.25, { c: 0xffb11a });
      // toy trucks on the counter (cab + box), a key rack on the back wall
      for (const [x, c] of [[-0.55, 0xff9d4d], [0.2, 0xf3e8cf]]) { P.paint.box(0.22, 0.12, 0.14, x + 0.11, ct + 0.06, 0.34, { c }); P.paint.box(0.12, 0.17, 0.14, x - 0.11, ct + 0.085, 0.34, { c: 0x3d4650 }); for (const dx of [-0.13, 0.12]) P.paint.cyl(0.04, 0.04, 0.16, 8, x + dx, ct + 0.04, 0.34, { c: 0x1c1f24, rz: Math.PI / 2 }); }
      P.wood.box(1.4, 0.06, 0.05, 0, 1.35, -hd + 0.11);
      for (let i = 0; i < 7; i++) P.paint.box(0.05, 0.12, 0.012, -0.6 + i * 0.2, 1.26, -hd + 0.14, { c: i % 2 ? 0xffd34d : 0xe0e4e8 });
      shelf(P, hw, hd, 1.65, [{ x: -0.8, w: 0.36, h: 0.18, c: 0xff9d4d }, { x: -0.3, w: 0.3, h: 0.24, c: 0x3d4650 }, { x: 0.35, w: 0.4, h: 0.16, c: 0xf3e8cf }, { x: 0.85, w: 0.26, h: 0.22, c: 0xff9d4d }]);
    },
    tenders(P, S, fp) {
      const { hw, hd } = S, ct = counterTop(S);
      common(P, S, fp);
      // flag pole on the left (from the deck to above the awning) + a stepped pennant
      const fx = -hw - 0.12, fz = hd - 0.05, top = S.yF + 1.8;
      P.wood.box(0.05, top - DECK, 0.05, fx, (top + DECK) / 2, fz);
      P.paint.ell(0.045, 0.045, 0.045, fx, top + 0.03, fz, { c: 0xf2b522 });
      [0.62, 0.5, 0.36, 0.2].forEach((w, i) => P.paint.box(w, 0.09, 0.02, fx + w / 2 + 0.02, top - 0.12 - i * 0.092, fz, { c: i % 2 ? 0xd9d0ff : S.accent }));
      // blueprint rack on the right: a frame with three tubes
      const rx = hw + 0.45, rz = 0.1;
      P.wood.box(0.5, 0.55, 0.38, rx, 0.275, rz);
      for (let i = 0; i < 3; i++) P.paint.cyl(0.07, 0.07, 0.5, 8, rx - 0.15 + i * 0.15, 0.78, rz, { c: i === 1 ? 0xdfe6f2 : 0xf3e8cf });
      fp.push({ x: rx, z: rz, hx: 0.3, hz: 0.24 });
      // counter: a rolled plan, folders, a stamp; back wall: plan sheets pinned
      P.paint.cyl(0.055, 0.055, 0.6, 8, -0.3, ct + 0.055, 0.36, { c: 0xdfe6f2, rz: Math.PI / 2 });
      for (let i = 0; i < 3; i++) P.paint.box(0.3, 0.025, 0.22, 0.35, ct + 0.0125 + i * 0.026, 0.38, { c: [0x9b87ef, 0xf3e8cf, 0x6f5bc9][i], ry: 0.12 * i });
      P.paint.cyl(0.035, 0.035, 0.1, 8, 0.7, ct + 0.05, 0.3, { c: 0x7b2d2d });
      [[-0.58, 0x4f78b8], [-0.17, 0xdfe6f2], [0.24, 0x4f78b8], [0.65, 0xf3e8cf]].forEach(([x, c], i) => P.paint.box(0.38, 0.5, 0.012, x, 1.35, -hd + 0.1, { c, rz: (i - 1.5) * 0.03 }));
      shelf(P, hw, hd, 1.78, [{ x: -0.5, w: 0.3, h: 0.14, c: 0x9b87ef }, { x: 0.1, w: 0.4, h: 0.12, c: 0xf3e8cf }]);
    },
    operations(P, S, fp) {
      const { hw, hd } = S, ct = counterTop(S);
      common(P, S, fp);
      // dish on a mast on the awning (opens up and towards the customers) + an aerial with a red tip
      const dx = hw - 0.35, mt = S.awnTop(-hd + 0.3) - 0.03;
      P.paint.cyl(0.04, 0.05, 0.5, 8, dx, mt + 0.25, -hd + 0.3, { c: 0x4a5560 });
      P.paint.cyl(0.42, 0.06, 0.2, 14, dx, mt + 0.62, -hd + 0.34, { c: 0xeef2f6, rx: 0.55 });
      P.paint.cyl(0.012, 0.012, 0.3, 6, dx, mt + 0.62 + 0.128, -hd + 0.34 + 0.078, { c: 0x4a5560, rx: 0.55 });
      P.paint.ell(0.04, 0.04, 0.04, dx, mt + 0.62 + 0.27, -hd + 0.34 + 0.16, { c: 0x4a5560 });
      const ax = -hw + 0.3, at = S.awnTop(-hd + 0.25) - 0.03;
      P.paint.cyl(0.015, 0.015, 1.1, 6, ax, at + 0.55, -hd + 0.25, { c: 0x4a5560 });
      P.paint.ell(0.035, 0.035, 0.035, ax, at + 1.12, -hd + 0.25, { c: 0xff3b3b });
      // three monitors on the back wall (glass), keyboard + radio on the counter
      for (const x of [-0.58, 0, 0.58]) { P.paint.box(0.46, 0.33, 0.04, x, 1.38, -hd + 0.11, { c: 0x23303b }); P.glass.box(0.38, 0.25, 0.012, x, 1.38, -hd + 0.136); }
      P.wood.box(1.4, 0.04, 0.2, 0, 1.12, -hd + 0.18);
      P.paint.box(0.34, 0.025, 0.12, 0.2, ct + 0.0125, 0.3, { c: 0x2b3640 });
      P.paint.box(0.2, 0.12, 0.1, -0.5, ct + 0.06, 0.36, { c: 0x6dbce8 });
      P.paint.cyl(0.012, 0.012, 0.22, 6, -0.42, ct + 0.2, 0.36, { c: 0x2b3640, rz: -0.4 });
      // cable reel on the left (lying on its side: two discs and a core)
      const rx = -hw - 0.42, rz = 0.15;
      P.wood.cyl(0.3, 0.3, 0.05, 14, rx - 0.13, 0.3, rz, { rz: Math.PI / 2 });
      P.wood.cyl(0.3, 0.3, 0.05, 14, rx + 0.13, 0.3, rz, { rz: Math.PI / 2 });
      P.paint.cyl(0.13, 0.13, 0.28, 10, rx, 0.3, rz, { c: 0x2f3a46, rz: Math.PI / 2 });
      P.paint.cyl(0.18, 0.18, 0.2, 12, rx, 0.3, rz, { c: 0xff9d4d, rz: Math.PI / 2 });
            fp.push({ x: rx, z: rz, hx: 0.24, hz: 0.36 });
    },
    meta(P, S, fp) {
      const { hw, hd } = S, ct = counterTop(S);
      common(P, S, fp);
      // gold caps on the posts, a golden trim along the front edge of the awning, a ridge pole with a finial
      for (const sx of [-1, 1]) P.paint.box(0.13, 0.04, 0.13, sx * hw, S.yF + 0.07, hd - 0.05, { c: 0xf2b522 });
      P.paint.box(2 * hw + 0.3, 0.05, 0.05, 0, S.yF + 0.095, hd + 0.38, { c: 0xf2b522 });
      const ft = S.awnTop(-hd + 0.25) - 0.03;
      P.wood.box(0.05, 0.9, 0.05, 0, ft + 0.45, -hd + 0.25);
      P.paint.ell(0.1, 0.1, 0.1, 0, ft + 0.98, -hd + 0.25, { c: 0xf2b522 });
      P.paint.cyl(0.0, 0.08, 0.28, 8, 0, ft + 1.2, -hd + 0.25, { c: 0xf2b522 });
      // golden "up" arrow on a stone pedestal on the right
      const px = -(hw + 0.5), pz = 0.2;   // on the left (towards the previous stall): the gap on the right stays free for the entrance gate lane
      P.deck.box(0.56, 0.55, 0.56, px, 0.275, pz);
      P.paint.box(0.46, 0.05, 0.46, px, 0.575, pz, { c: 0xf2b522 });
      P.paint.box(0.14, 0.86, 0.1, px, 1.03, pz, { c: 0xf2b522 });
      P.paint.box(0.4, 0.1, 0.1, px - 0.14, 1.32, pz, { c: 0xf2b522, rz: Math.PI / 4 });
      P.paint.box(0.4, 0.1, 0.1, px + 0.14, 1.32, pz, { c: 0xf2b522, rz: -Math.PI / 4 });
      fp.push({ x: px, z: pz, hx: 0.33, hz: 0.33 });
      // counter: three trophies, gold bars, a laurel book
      for (let i = 0; i < 3; i++) { const x = -0.65 + i * 0.28; P.paint.cyl(0.05, 0.03, 0.1, 8, x, ct + 0.05, 0.36, { c: 0xf2b522 }); P.paint.cyl(0.07, 0.05, 0.1, 8, x, ct + 0.15, 0.36, { c: 0xf2b522 }); }
      P.paint.box(0.26, 0.05, 0.14, 0.45, ct + 0.025, 0.36, { c: 0xe7a21a }); P.paint.box(0.22, 0.05, 0.12, 0.45, ct + 0.075, 0.36, { c: 0xf2c542 });
      P.paint.box(0.3, 0.04, 0.22, 0.85, ct + 0.02, 0.38, { c: 0x6b3a3a });
      shelf(P, hw, hd, 1.55, [{ x: -0.75, w: 0.26, h: 0.2, c: 0xf2b522 }, { x: -0.2, w: 0.3, h: 0.16, c: 0xf3e8cf }, { x: 0.4, w: 0.26, h: 0.24, c: 0xf2b522 }, { x: 0.85, w: 0.24, h: 0.14, c: 0xf3e8cf }]);
    },
    bonus(P, S, fp) {
      const { hw, hd } = S, ct = counterTop(S);
      common(P, S, fp);
      // balloons on strings tied to a knot on the right of the awning (above the awning: the silhouette)
      const bx = hw - 0.12, bz = hd - 0.3, y0 = S.awnTop(bz) - 0.01;
      P.paint.ell(0.04, 0.04, 0.04, bx, y0, bz, { c: 0xe9e4d6 });
      [[-0.22, 3.15, 0xff6f91], [0.1, 3.4, 0xffd34d], [0.34, 3.1, 0x5ab0ff], [-0.4, 2.95, 0x7ed67f], [0.0, 2.9, 0xff4d4d]].forEach(([dx, y, c]) => {
        const y1 = y - 0.23, L = Math.hypot(dx, y1 - y0);
        P.paint.ell(0.19, 0.23, 0.19, bx + dx, y, bz, { c });
        P.paint.box(0.01, L, 0.01, bx + dx / 2, (y0 + y1) / 2, bz, { c: 0xe9e4d6, rz: -Math.atan2(dx, y1 - y0) });
      });
      // gift stack on the left (three boxes + ribbons)
      const gx = hw + 0.5, gz = 0.2;      // on the right: the gap on the left (towards the gate) stays free
      [[0.52, 0.4, 0.46, 0x7ed3c8, 0.0, 0.2, 0.0], [0.4, 0.32, 0.38, 0xff6f91, 0.04, 0.56, 0.15], [0.28, 0.26, 0.28, 0xffd34d, -0.03, 0.85, -0.2]].forEach(([w, h, d, c, dx, y, ry]) => {
        P.paint.box(w, h, d, gx + dx, y, gz, { c, ry });
        P.paint.box(0.06, h + 0.012, d + 0.012, gx + dx, y, gz, { c: 0xfaf7ee, ry });
        P.paint.box(w + 0.012, h + 0.012, 0.06, gx + dx, y, gz, { c: 0xfaf7ee, ry });
      });
      fp.push({ x: gx, z: gz, hx: 0.32, hz: 0.3 });
      // counter: wrapped gifts, a candy bowl
      [[-0.55, 0xff6f91], [0.1, 0x7ed3c8], [0.62, 0xffd34d]].forEach(([x, c], i) => { P.paint.box(0.2, 0.16, 0.18, x, ct + 0.08, 0.36, { c, ry: 0.2 * i }); P.paint.box(0.045, 0.165, 0.185, x, ct + 0.08, 0.36, { c: 0xfaf7ee, ry: 0.2 * i }); });
      P.paint.cyl(0.12, 0.08, 0.08, 10, -0.2, ct + 0.04, 0.4, { c: 0xe9e4d6 });
      [0xff6f91, 0xffd34d, 0x7ed67f].forEach((c, i) => P.paint.ell(0.04, 0.04, 0.04, -0.24 + i * 0.05, ct + 0.1, 0.4 + (i % 2) * 0.03, { c }));
      shelf(P, hw, hd, 1.58, [{ x: -0.6, w: 0.28, h: 0.2, c: 0xff6f91 }, { x: -0.1, w: 0.3, h: 0.24, c: 0xfaf7ee }, { x: 0.5, w: 0.26, h: 0.18, c: 0xffd34d }]);
    },
  };

  // exchange: a closed kiosk with a service window (not the common open stall)
  function exchange(P, S, fp) {
    const { hw, hd, accent } = S;
    const H = 1.95, wy0 = 1.08, wy1 = 1.78;          // wall height above the deck, window sill / lintel (absolute y)
    // deck + apron
    P.deck.box(2 * hw + 0.4, DECK, 2 * hd + 0.2, 0, DECK / 2, 0);
    P.wood.box(2 * hw + 0.4, 0.078, 0.8, 0, 0.039, hd + 0.1 + 0.4);
    // booth walls (siding), corner boards, plinth
    P.paint.box(2 * hw + 0.06, 0.14, 2 * hd + 0.06, 0, DECK + 0.07, 0, { c: 0x6b4a2c });
    P.siding.box(2 * hw - 0.16, H, 0.08, 0, DECK + H / 2, -hd + 0.04);
    for (const sx of [-1, 1]) P.siding.box(0.08, H, 2 * hd, sx * (hw - 0.04), DECK + H / 2, 0);
    const zf = hd - 0.04, wx = 0.62, pw = hw - 0.08 - wx;   // front wall z, window half width, pier width beside the window
    P.siding.box(2 * hw - 0.16, wy0 - DECK, 0.08, 0, DECK + (wy0 - DECK) / 2, zf);                       // below the window
    P.siding.box(2 * hw - 0.16, DECK + H - wy1, 0.08, 0, wy1 + (DECK + H - wy1) / 2, zf);                // above the window
    for (const sx of [-1, 1]) P.siding.box(pw, wy1 - wy0, 0.08, sx * (wx + pw / 2), (wy0 + wy1) / 2, zf);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) post(P, sx * (hw - 0.02), sz * (hd - 0.04), DECK, DECK + H, 0.1);
    // window frame + glass + two cross bars
    P.wood.box(1.34, 0.06, 0.12, 0, wy0 - 0.03, zf + 0.02); P.wood.box(1.34, 0.06, 0.1, 0, wy1 + 0.03, zf + 0.01);
    for (const sx of [-1, 1]) P.wood.box(0.06, wy1 - wy0 + 0.1, 0.1, sx * 0.65, (wy0 + wy1) / 2, zf + 0.01);
    P.glass.box(1.24, wy1 - wy0 - 0.02, 0.014, 0, (wy0 + wy1) / 2, zf - 0.005);
    P.wood.box(0.04, wy1 - wy0, 0.05, 0, (wy0 + wy1) / 2, zf + 0.012); P.wood.box(1.24, 0.035, 0.05, 0, (wy0 + wy1) / 2 + 0.1, zf + 0.012);
    // striped roof, low pitch, overhanging the service window; a counter ledge with brackets
    const rTop = (z) => DECK + H + 0.2 + (DECK + H + 0.02 - (DECK + H + 0.2)) * (z - (-hd - 0.1)) / ((hd + 0.45) - (-hd - 0.1));
    awning(P, 2 * hw + 0.4, -hd - 0.1, DECK + H + 0.2, hd + 0.45, DECK + H + 0.02, accent, CREAM, { n: 9, t: 0.06 });
    P.wood.box(1.5, 0.05, 0.36, 0, wy0 - 0.12, zf + 0.22);
    for (const sx of [-1, 1]) P.wood.box(0.05, 0.12, 0.28, sx * 0.62, wy0 - 0.2, zf + 0.2);
    // sign board above the roof on two posts, with two exchange arrows (cream on the accent colour)
    const sy = rTop(zf - 0.1) + 0.58;
    for (const sx of [-1, 1]) P.wood.box(0.06, 0.62, 0.06, sx * 0.5, rTop(zf - 0.1) + 0.21, zf - 0.1);
    P.paint.box(1.34, 0.55, 0.07, 0, sy, zf - 0.1, { c: accent });
    P.paint.box(1.34 + 0.08, 0.04, 0.09, 0, sy + 0.295, zf - 0.1, { c: CREAM }); P.paint.box(1.34 + 0.08, 0.04, 0.09, 0, sy - 0.295, zf - 0.1, { c: CREAM });
    P.paint.box(0.7, 0.07, 0.03, 0, sy + 0.1, zf - 0.055, { c: CREAM }); P.paint.box(0.18, 0.18, 0.03, 0.4, sy + 0.1, zf - 0.055, { c: CREAM, rz: Math.PI / 4 });
    P.paint.box(0.7, 0.07, 0.03, 0, sy - 0.1, zf - 0.055, { c: CREAM }); P.paint.box(0.18, 0.18, 0.03, -0.4, sy - 0.1, zf - 0.055, { c: CREAM, rz: Math.PI / 4 });
    // on the ledge: balance scale, plank / block / ingot samples (one each: no stock implied)
    const ly = wy0 - 0.12 + 0.025;   // top of the ledge
    P.paint.box(0.05, 0.3, 0.05, 0.0, ly + 0.15, zf + 0.24, { c: 0x4a5560 }); P.paint.box(0.5, 0.025, 0.025, 0.0, ly + 0.3, zf + 0.24, { c: 0x4a5560 });
    for (const sx of [-1, 1]) { P.paint.cyl(0.1, 0.1, 0.012, 10, sx * 0.24, ly + 0.2, zf + 0.24, { c: 0xe0b44a }); P.paint.box(0.008, 0.1, 0.008, sx * 0.24, ly + 0.255, zf + 0.24, { c: 0x4a5560 }); }
    P.paint.box(0.26, 0.04, 0.08, -0.5, ly + 0.02, zf + 0.28, { c: 0xc59a60 });
    P.paint.box(0.16, 0.1, 0.1, 0.5, ly + 0.05, zf + 0.28, { c: 0x9aa2aa });
    P.paint.box(0.2, 0.05, 0.08, 0.5, ly + 0.125, zf + 0.28, { c: 0x7f90a3 });
    for (const sx of [-1, 1]) lantern(P, sx * (hw + 0.1), DECK + H - 0.15, hd + 0.3);
    fp.push({ x: 0, z: -0.005, hx: hw + 0.07, hz: hd + 0.055 });
  }

  // awning / counter band colour per trade (the game's own `accent` stays the burst / marker colour; these are a little stronger so the stripes read against the cream)
  const STRIPE = { team: 0x4aa3ee, fleet: 0xf08a2c, tenders: 0x8b73e0, operations: 0x2fb5b0, meta: 0xe5a526, bonus: 0xf2658a, exchange: 0x4fbf6a };
  const stripeOf = (cfg) => STRIPE[cfg.id] || cfg.accent;
  const SPEC = {
    team:       { hw: 1.05, hd: 0.72, yF: 1.85, yB: 2.30 },
    fleet:      { hw: 1.20, hd: 0.72, yF: 1.90, yB: 2.10, awning: { n: 11 } },
    tenders:    { hw: 1.00, hd: 0.72, yF: 1.85, yB: 2.30 },
    operations: { hw: 0.95, hd: 0.72, yF: 1.95, yB: 2.15 },
    meta:       { hw: 1.10, hd: 0.82, yF: 1.95, yB: 2.55 },
    bonus:      { hw: 1.00, hd: 0.72, yF: 1.85, yB: 2.30 },
    exchange:   { hw: 0.85, hd: 0.78, yF: 2.0, yB: 2.0 },
  };
  // where the icon / the name plate hover (above the roof)
  const SIGN = { team: [2.75, 3.4], fleet: [2.7, 3.35], tenders: [2.7, 3.35], operations: [2.75, 3.5], meta: [3.3, 4.0], bonus: [2.55, 3.1], exchange: [3.15, 3.85] };

  // ---------------------------------------------------------------------------------------------- one stall
  function buildStall(cfg) {
    const S = Object.assign({ accent: stripeOf(cfg) }, SPEC[cfg.id] || SPEC.team);
    // top surface height of the awning at local z (posts / dish / beacon / finial stand on it, 3 cm sunk)
    S.awnTop = (z) => { const zA = -S.hd - 0.12, yA = S.yB + 0.06, zB = S.hd + 0.40, yBf = S.yF + 0.07; return yA + (yBf - yA) * (z - zA) / (zB - zA); };
    const g = new THREE.Group(); g.name = 'marketStallV116_' + cfg.id;
    const P = parts(), fp = [];
    (cfg.id === 'exchange' ? exchange : KINDS[cfg.id] || KINDS.team)(P, S, fp);
    finish(P, g);
    g.userData.v161Footprint = fp; g.userData.v161Market = cfg.id;
    const [signY, iconY] = SIGN[cfg.id] || [2.7, 3.4];
    const icon = makeIconSprite(cfg.emoji, 0.82); icon.position.set(0, iconY, 0); g.add(icon);
    const sign = makeLabelSprite([lang === 'ru' ? cfg.ru : cfg.en]);
    sign.position.set(0, signY, S.hd + 0.3); sign.scale.set(1.55, 0.5, 1); g.add(sign);
    const infoSign = makeLabelSprite(['...']);
    infoSign.position.set(0, 1.12, S.hd + 0.6); infoSign.scale.set(1.55, 0.42, 1); g.add(infoSign);
    g.position.copy(cfg.pos); g.rotation.y = cfg.facing || 0;
    return { group: g, icon, sign, infoSign, cfg };
  }

  // ---------------------------------------------------------------------------------------------- vacant lot (unlocked, not built)
  function buildVacant(cfg) {
    const g = new THREE.Group(); g.name = 'marketLotV161_' + cfg.id;
    const M = mats(), P = parts(), hw = 1.2, hd = 0.8;
    // build pad (the invitation the old marker had), flat on the plaza
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.08, 0.04, 28), M.pad);
    pad.position.y = PLAZA_TOP + 0.02 - 0.0; pad.receiveShadow = true; pad.name = 'v161LotPad'; g.add(pad);
    // four corner stakes, a rope on the back and the two sides (the front stays open), a flag in the accent colour on a front stake
    const acc = stripeOf(cfg);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      P.wood.box(0.07, 0.55, 0.07, sx * hw, PLAZA_TOP + 0.275, sz * hd);
      P.paint.box(0.09, 0.05, 0.09, sx * hw, PLAZA_TOP + 0.575, sz * hd, { c: 0xfaf7ee });
    }
    const rope = (x0, z0, x1, z1) => { const L = Math.hypot(x1 - x0, z1 - z0); P.paint.box(0.025, 0.025, L, (x0 + x1) / 2, PLAZA_TOP + 0.42, (z0 + z1) / 2, { c: 0xe9e4d6, ry: Math.atan2(x1 - x0, z1 - z0) }); };
    rope(-hw, -hd, hw, -hd); rope(-hw, -hd, -hw, hd); rope(hw, -hd, hw, hd);
    P.wood.box(0.035, 0.7, 0.035, hw, PLAZA_TOP + 0.35 + 0.55, hd);
    P.paint.box(0.3, 0.2, 0.012, hw - 0.17, PLAZA_TOP + 1.12, hd, { c: acc });
    P.paint.box(0.15, 0.1, 0.012, hw - 0.37, PLAZA_TOP + 1.14, hd, { c: CREAM });
    // lot corner markers in the paving: four flat cream L-shaped ticks
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { P.paint.box(0.3, 0.012, 0.06, sx * (hw - 0.15), PLAZA_TOP + 0.006, sz * hd, { c: 0xe9e4d6 }); P.paint.box(0.06, 0.012, 0.3, sx * hw, PLAZA_TOP + 0.006, sz * (hd - 0.15), { c: 0xe9e4d6 }); }
    const cast = castOk();
    for (const [b, m, n] of [[P.wood, M.wood, 'v161LotWood'], [P.paint, M.paint, 'v161LotPaint']]) { const mesh = b.toMesh(m, { cast, name: n }); if (mesh) g.add(mesh); }
    const icon = makeIconSprite(cfg.emoji, 0.72); icon.position.y = 0.95; g.add(icon);
    const sign = makeLabelSprite([lang === 'ru' ? cfg.ru : cfg.en, marketStallCostText(cfg)]);
    sign.position.set(0, 1.8, 0); sign.scale.set(1.7, 0.6, 1); g.add(sign);
    g.position.copy(cfg.pos); g.rotation.y = cfg.facing || 0;
    return g;
  }

  // ---------------------------------------------------------------------------------------------- plaza
  const RING_R = 4.6, OUTER_R = RING_R + 2.1, N_STALLS = 7;
  const stallAngle = (i) => -Math.PI / 2 + i * TAU / N_STALLS;
  function buildPlaza(centre) {
    const M = mats(), g = new THREE.Group(); g.name = 'marketPlazaV116';
    const L = batch(false), Mi = batch(false), D = batch(false), W = batch(false), P = batch(true), LP = batch(false), WA = batch(false);
    const fp = [];
    // --- paving: light disc (the old plaza, top 0.06), walking ring, bands, curb
    L.ring(0, 0, 0, OUTER_R, 0, PLAZA_TOP, 48, { bottom: false });
    Mi.ring(0, 0, 1.56, 2.88, PLAZA_TOP, PLAZA_TOP + 0.012, 48, { outer: false, inner: false });
    Mi.ring(0, 0, 5.0, 5.9, PLAZA_TOP, PLAZA_TOP + 0.012, 48, { outer: false, inner: false });
    D.ring(0, 0, 1.43, 1.56, PLAZA_TOP, PLAZA_TOP + 0.02, 48, { inner: false });
    D.ring(0, 0, 2.88, 3.0, PLAZA_TOP, PLAZA_TOP + 0.02, 48, { inner: false });
    D.ring(0, 0, 4.88, 5.0, PLAZA_TOP, PLAZA_TOP + 0.02, 48, { inner: false });
    D.ring(0, 0, OUTER_R - 0.28, OUTER_R + 0.06, 0, 0.14, 48);   // curb ring
    // --- fountain: basin, water, pillar, bowl, ball (the jet is its own mesh)
    Mi.ring(0, 0, 1.06, 1.3, PLAZA_TOP, 0.5, 28);
    L.cyl(0.2, 0.26, 0.9, 12, 0, 0.5, 0);
    L.cyl(0.62, 0.3, 0.2, 18, 0, 1.0, 0);
    L.ring(0, 0, 0.5, 0.64, 1.1, 1.17, 18, { bottom: true });
    L.cyl(0.1, 0.14, 0.4, 10, 0, 1.3, 0);
    WA.cyl(1.05, 1.05, 0.02, 28, 0, 0.44, 0);
    WA.cyl(0.52, 0.52, 0.02, 18, 0, 1.12, 0);
    P.ell(0.16, 0.16, 0.16, 0, 1.55, 0, { c: 0xe0b44a });
    fp.push({ x: 0, z: 0, r: 1.32 });
    // --- benches (4) and planters (3) on the inner ring between the lanes to the stalls; lamps (6) on the outer ring
    const slot = (i) => stallAngle(i) + Math.PI / N_STALLS;
    // the entrance faces the spawn (world origin), snapped to the middle of the nearest gap between two stalls (a stall in the lane would block the way in)
    const towardOrigin = Math.atan2(-centre.z, -centre.x);
    let gateSlot = 0; for (let i = 1; i < N_STALLS; i++) if (Math.abs(Math.atan2(Math.sin(slot(i) - towardOrigin), Math.cos(slot(i) - towardOrigin))) < Math.abs(Math.atan2(Math.sin(slot(gateSlot) - towardOrigin), Math.cos(slot(gateSlot) - towardOrigin)))) gateSlot = i;
    const gateAngle = slot(gateSlot);
    const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    for (let i = 0; i < N_STALLS; i++) {
      const a = slot(i), c = Math.cos(a), s = Math.sin(a);
      if (i === gateSlot) continue;   // the lane from the gate to the fountain stays open
      if (i % 2 === 0) {
        // bench: a stone base under a wooden seat, the backrest on the outer side
        const r = 2.4, x = c * r, z = s * r, ry = -a + Math.PI / 2, tx = Math.sin(a), tz = -Math.cos(a);
        D.box(0.7, 0.38, 0.3, x, PLAZA_TOP + 0.19, z, { ry });
        W.box(0.9, 0.06, 0.4, x, 0.47, z, { ry });
        W.box(0.9, 0.05, 0.04, x + c * 0.19, 0.64, z + s * 0.19, { ry }); W.box(0.9, 0.05, 0.04, x + c * 0.19, 0.76, z + s * 0.19, { ry });
        for (const sx of [-0.4, 0.4]) W.box(0.05, 0.4, 0.05, x + tx * sx + c * 0.19, 0.64, z + tz * sx + s * 0.19, { ry });
        fp.push({ x, z, hx: 0.48, hz: 0.24, yaw: ry });
      } else {
        // stone planter with a shrub and flowers
        const r = 2.35, x = c * r, z = s * r;
        Mi.ring(x, z, 0.0, 0.46, PLAZA_TOP, 0.5, 14);
        D.ring(x, z, 0.38, 0.5, 0.5, 0.58, 14, { bottom: true });
        P.ell(0.38, 0.34, 0.38, x, 0.78, z, { c: 0x3f7f3a }); P.ell(0.28, 0.24, 0.28, x + 0.1, 0.98, z - 0.07, { c: 0x57a14a });
        [[0.2, 0.18, 0xff6f91], [-0.22, 0.12, 0xffd34d], [0.05, -0.28, 0xfaf7ee], [-0.12, 0.26, 0xff6f91]].forEach(([dx, dz, cc]) => P.ell(0.06, 0.06, 0.06, x + dx, 0.96, z + dz, { c: cc }));
        fp.push({ x, z, r: 0.5 });
      }
    }
    // lamps between the stalls on the outer ring (not at the entrance): base, pole, arm, lantern
    for (let i = 0; i < N_STALLS; i++) {
      const a = slot(i);
      if (angDiff(a, gateAngle) < 0.3) continue;
      const x = Math.cos(a) * 5.9, z = Math.sin(a) * 5.9;
      D.cyl(0.1, 0.13, 0.16, 8, x, PLAZA_TOP + 0.08, z); P.cyl(0.04, 0.055, 2.2, 8, x, PLAZA_TOP + 1.1, z, { c: 0x3a4250 });
      P.box(0.22, 0.05, 0.22, x, PLAZA_TOP + 2.5, z, { c: 0x2a2f36 });
      LP.box(0.15, 0.2, 0.15, x, PLAZA_TOP + 2.36, z);
      P.box(0.2, 0.03, 0.2, x, PLAZA_TOP + 2.22, z, { c: 0x2a2f36 });
    }
    // entrance gate: two posts with lanterns and a beam (the plaza sign hangs above it)
    const gd = [Math.cos(gateAngle), Math.sin(gateAngle)], tn = [-gd[1], gd[0]], gr = OUTER_R - 0.1;
    for (const sx of [-1, 1]) {
      const x = gd[0] * gr + tn[0] * sx * 1.15, z = gd[1] * gr + tn[1] * sx * 1.15;
      D.box(0.46, 0.9, 0.46, x, 0.45, z); P.box(0.52, 0.05, 0.52, x, 0.925, z, { c: 0x6d665b });   // stone pier under the wooden post
      W.box(0.2, 2.6, 0.2, x, 1.3, z); P.box(0.28, 0.06, 0.28, x, 2.63, z, { c: 0x4a2f1a });
      LP.box(0.14, 0.18, 0.14, x, 2.8, z);
      P.box(0.18, 0.03, 0.18, x, 2.92, z, { c: 0x2a2f36 }); P.box(0.18, 0.03, 0.18, x, 2.68, z, { c: 0x2a2f36 });
      fp.push({ x, z, hx: 0.3, hz: 0.3 });
    }
    W.box(2.5, 0.16, 0.14, gd[0] * gr, 2.38, gd[1] * gr, { ry: -gateAngle + Math.PI / 2 });
    // --- meshes
    const cast = castOk(), add = (m) => { if (m) g.add(m); return m; };
    add(L.toMesh(M.stoneLight, { cast: false, name: 'v161PlazaLight' }));
    add(Mi.toMesh(M.stoneMid, { cast: false, name: 'v161PlazaMid' }));
    add(D.toMesh(M.stoneDark, { cast: false, name: 'v161PlazaDark' }));
    add(W.toMesh(M.wood, { cast, name: 'v161PlazaWood' }));
    add(P.toMesh(M.paint, { cast, name: 'v161PlazaPaint' }));
    add(LP.toMesh(M.lamp, { cast: false, receive: false, name: 'v161PlazaLamp' }));
    add(WA.toMesh(M.water, { cast: false, receive: false, name: 'v161PlazaWater' }));
    // the jet: a slim column with a spray bulb on top, one mesh with its base at the origin, scaled by the tick
    const J = batch(false);
    J.cyl(0.028, 0.05, 0.62, 8, 0, 0.31, 0); J.ell(0.1, 0.075, 0.1, 0, 0.66, 0);
    const jm = J.toMesh(M.jet, { cast: false, receive: false, name: 'v161PlazaJet' });
    jm.position.set(0, 1.66, 0); jm.renderOrder = 2; g.add(jm);
    g.userData.jet = jm;
    // sprites: entrance sign + icon (old positions, now on the beam)
    const gateSign = makeLabelSprite([lang === 'ru' ? 'РЫНОК' : 'MARKET']);
    gateSign.position.set(gd[0] * gr, 2.95 + 0.12, gd[1] * gr); gateSign.scale.set(2.3, 0.75, 1); g.add(gateSign);
    const gateIcon = makeIconSprite('🏪', 1.1); gateIcon.position.set(gd[0] * gr, 3.65, gd[1] * gr); g.add(gateIcon);
    g.userData.v161Footprint = fp; g.userData.v161Gate = { x: gd[0] * gr, z: gd[1] * gr, angle: gateAngle, slot: gateSlot };
    g.position.copy(centre);
    startTick();
    return g;
  }

  // ---------------------------------------------------------------------------------------------- life: fountain jet + lantern glow (shared material, no allocations)
  let tickOn = false, lastT = 0, jetCache = null;
  function startTick() {
    if (tickOn) return; tickOn = true;
    (window.__TYCOON_VISUAL_TICKS__ = window.__TYCOON_VISUAL_TICKS__ || []).push(tick);
  }
  function tick(now) {
    if (now - lastT < 90) return; lastT = now;
    if (!jetCache || !jetCache.parent || !jetCache.parent.parent) { /* (re)find the jet when the plaza group was replaced */ const plaza = scene.getObjectByName('marketPlazaV116'); jetCache = plaza && plaza.userData.jet || null; }
    if (jetCache) { const t = now * 0.004; jetCache.scale.y = 0.9 + 0.12 * Math.sin(t) + 0.05 * Math.sin(t * 2.3); jetCache.scale.x = jetCache.scale.z = 1 + 0.12 * Math.sin(t * 1.7 + 1); }
    if (MATS) {
      let night = false; try { night = isNightV40(); } catch (e) { /* layer not ready */ }
      MATS.lamp.emissiveIntensity += ((night ? 1.1 : 0.3) - MATS.lamp.emissiveIntensity) * 0.08;
    }
  }

  // ---------------------------------------------------------------------------------------------- registry
  // oriented boxes / circles in world space for the v83 registry (tycoon-v161.html rebuildStatic): the sealed stall bodies and big props, the fountain, benches, planters
  function groupObstacles(group, label, yawOf) {
    const fp = group && group.userData && group.userData.v161Footprint;
    if (!fp || !fp.length || group.visible === false) return [];
    group.updateMatrixWorld(true);
    const out = [];
    fp.forEach((f, i) => {
      const w = new THREE.Vector3(f.x, 0, f.z).applyMatrix4(group.matrixWorld), pos = new THREE.Vector3(w.x, 0, w.z);
      if (f.r) out.push({ owner: group, label: `${label}:${i}`, shape: 'circle', pos, radius: f.r });
      else out.push({ owner: group, label: `${label}:${i}`, shape: 'obb', pos, hx: f.hx, hz: f.hz, yaw: group.rotation.y + (f.yaw || 0) });
    });
    return out;
  }
  function obstacles() {
    const out = [];
    try {
      const plaza = scene.getObjectByName('marketPlazaV116');
      if (plaza && plaza.userData.v161Footprint) out.push(...groupObstacles(plaza, 'market-plaza-v161'));
      if (typeof marketRuntimeV116 !== 'undefined') for (const [id, st] of marketRuntimeV116.stalls) if (st.group && st.group.userData.v161Footprint) out.push(...groupObstacles(st.group, 'market-stall-' + id + '-v161'));
    } catch (e) { /* not declared yet */ }
    return out;
  }

  window.MarketV161 = {
    enabled: true, version: 'v161-market', buildStall, buildVacant, buildPlaza, obstacles, SPEC, SIGN, DECK, PLAZA_TOP, OUTER_R, RING_R, mats,
  };
})();
