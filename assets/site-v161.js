/* Construction site v161 (2026-10-10 (13), "improve physics and design of every building", backlog CONSTRUCTION SITE).
 *
 * spawnConstructionSite (tycoon-v161.html) built every site from ~140 separate meshes (62 .. 103 visible per phase, 2-3 sites at a time), scaled whole groups in y by the building's
 * height (walls 1.45 m -> 3.8 m with a stretched texture, the foundation slab 0.18 -> 0.47 m, the gable roof 2.6 times steeper, windows 2.6 times taller, the crane jib 1.9 times thicker),
 * and layered the v45 hazard boards + beacons and the v149 sign board on top (+25 meshes). This file builds the same rig (same group names the game's update loop drives: jibPivot, hook,
 * craneLoad, drumPivot, mixerStream, excavatorTurret / armBase / arm2Pivot / bucketPivot, foundation / frame / wall / roof / finish visuals, scaffolding, beamStack, rebarCage,
 * unloadZone, phaseLabel, beacon) as merged vertex-coloured meshes (one per rigid part, one per visual group):
 *   - the geometry has its FINAL size: walls, frame, roof, windows, crane mast are built at envH x their base height (no non-uniform group scale; site.envH = 1 so the game's growth
 *     animation scale.y 0.08 -> 1 only plays the growing), wall texture coordinates are per metre (no stretched texture), the crane keeps its cross-sections
 *   - everything stands on y 0 (min y 0.0, nothing floats), the yard fence is a low barrier (walkable by design: the game's `construction` category has no player collision)
 *   - the v45 hazard boards + pulsing beacons are part of the yard (v45Site is set so the wrapper skips its own copy), the v149 sign board with the progress line stays the sign
 *   - only the crane tower base is solid (a 0.5 m box while the crane stands, `SiteV161.obstacles()`); the yard, cabin, machines and piles are walkable like the whole site
 * Visible meshes per phase: 9 .. 15 (was 62 .. 103), 28 in total (was 141).
 * `SiteV161.enabled = false` brings the old rig back.
 */
'use strict';
(() => {
  const IK = window.InfraV161 && window.InfraV161.kit;
  if (!IK) return;
  const { batch, mats, castOk } = IK;
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

  // ---------------------------------------------------------------------------------------------- shared textured materials (one per colour family, never disposed)
  const SH = {};
  const share = (m) => { m.userData.sharedSurfaceV153 = true; return m; };
  function wallMat(group, tint) {
    const key = 'wall:' + group + ':' + tint;
    if (SH[key]) return SH[key];
    if (group === 'vertical') return (SH[key] = share(createCurtainWallMaterial(tint || 0x467aa2, { roughness: 0.15, metalness: 0.4 })));
    if (group === 'industrial') return (SH[key] = share(createCorrugatedMaterial(0xb9bec6, { roughness: 0.78, metalness: 0.14 })));
    return (SH[key] = share(createConcreteMaterial(group === 'house' ? 0xd7c9b8 : 0xc5c9cc, { roughness: 0.88 })));
  }
  const sharedMat = (key, make) => SH[key] || (SH[key] = share(make()));
  const concreteSite = () => sharedMat('concrete', () => createConcreteMaterial(0xbfc1be, { roughness: 0.92 }));
  const roofMatHouse = () => sharedMat('roofHouse', () => createRoofMaterial(0x6b5241, { roughness: 0.9 }));
  const stripeMat = () => sharedMat('stripe', () => new THREE.MeshBasicMaterial({ color: 0xffd479, transparent: true, opacity: 0.78 }));

  // a box whose texture coordinates run per metre (the old rig stretched one texture tile over any wall height)
  function wallBox(B, w, h, d, x, y, z, k) {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const j = f * 4 + i; uv.setXY(j, uv.getX(j) * dims[f][0] * k, uv.getY(j) * dims[f][1] * k); }
    B.add(g, x, y, z, {});
  }
  const mesh = (B, material, name, cast, soft) => B.toMesh(material, { cast: !!cast && castOk(), receive: true, name, soft: !!soft });
  const grp = (name) => { const g = new THREE.Group(); g.name = name; return g; };

  function build(pos, stage, buildDuration) {
    const MT = mats(), accent = stage && stage.color || 0xffb84d;
    const envW = clamp((stage && stage.baseSize || 2.2) / 2.2, 0.85, 1.55);
    const envH = clamp((stage && stage.height || 2.4) / 2.4, 0.85, 2.6);
    const craneH = clamp(1 + (envH - 1) * 0.55, 1, 1.9);
    const arch = stage && stage.archetype;
    const kind = (arch === 'warehouse' || arch === 'factory') ? 'industrial' : (arch === 'office' || arch === 'tower') ? 'vertical' : arch === 'house' ? 'house' : 'shop';
    const group = grp('v161ConstructionSite');
    const add = (parent, m) => { if (m) parent.add(m); return m; };

    // ---- yard (scaled in x / z only: the footprint follows the building's width)
    const yard = grp('yard'); yard.scale.set(envW, 1, envW); group.add(yard);
    {
      const Y = batch(true);
      Y.cyl(2.3, 2.45, 0.12, 28, 0, 0.06, 0, { c: 0x8b6d48 });
      Y.box(3.55, 0.1, 3.2, 0, 0.11, 0, { c: 0xc9c0b1 });
      for (const s of [-1, 1]) {
        Y.box(3.34, 0.24, 0.08, 0, 0.26, s * 1.6, { c: 0xffb84d });
        Y.box(0.08, 0.24, 3.1, s * 1.72, 0.26, 0, { c: 0xffb84d });
        for (const t of [-0.55, 0.55]) { Y.box(0.06, 0.42, 0.06, t * 1.9, 0.27, s * 1.6, { c: 0x7e8794 }); Y.box(0.06, 0.42, 0.06, s * 1.72, 0.27, t * 1.6, { c: 0x7e8794 }); }
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) Y.box(0.08, 0.76, 0.08, sx * 1.72, 0.38, sz * 1.6, { c: 0x7e8794 });
      for (const [cx, cz] of [[1.35, 1.05], [1.58, 0.4], [-1.5, -1.15]]) {    // traffic cones
        Y.box(0.22, 0.03, 0.22, cx, 0.175, cz, { c: 0xff7a1a }); Y.add(new THREE.ConeGeometry(0.09, 0.32, 10), cx, 0.335, cz, { c: 0xff7a1a }); Y.cyl(0.072, 0.08, 0.05, 10, cx, 0.335, cz, { c: 0xf2f0ea });
      }
      // site office (cabin): corrugated light body, door, window, roof
      const ox = -1.02, oy = 0.11, oz = 1.04;
      Y.box(0.96, 0.72, 0.74, ox, oy + 0.4, oz, { c: 0xdfe7ef }); Y.box(0.18, 0.42, 0.04, ox + 0.28, oy + 0.3, oz + 0.39, { c: 0x5b6470 }); Y.box(0.3, 0.22, 0.03, ox - 0.22, oy + 0.42, oz + 0.39, { c: 0x35536b });
      Y.box(1.06, 0.06, 0.84, ox, oy + 0.79, oz, { c: 0x707983 });
      add(yard, mesh(Y, MT.paint, 'v161SiteYard', false));
    }
    // hazard boards + beacons (the v45 wrapper's, now part of the rig): two striped boards at the back, a pulsing beacon on each
    {
      const H = batch(true);
      for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
        H.box(0.32, 0.09, 0.055, sx * 1.52 * envW + (i - 2) * 0.26, 0.42, -1.64 * envW, { rz: i % 2 ? 0.16 : -0.16, c: i % 2 ? 0x24292f : 0xf0b348 });
      }
      add(group, mesh(H, MT.paint, 'v161SiteBoards', false, true));
      const bm = new THREE.MeshStandardMaterial({ color: 0xffa84d, emissive: 0xff6a22, emissiveIntensity: 0.7, roughness: 0.25 });
      const bg = new THREE.SphereGeometry(0.055, 8, 8);
      for (const sx of [-1, 1]) { const b = new THREE.Mesh(bg, bm); b.position.set(sx * (1.62 * envW + 0.0), 0.61, -1.61 * envW); b.userData.v45SiteBeacon = true; b.name = 'v161SiteBeacon'; group.add(b); }
      bg.userData.sharedSurfaceV153 = false;
    }
    group.userData.v45Site = true;

    // ---- unload zone (a marker for the trucks; material per site: the game changes its colour / emissive)
    const unloadZone = grp('unloadZone');
    {
      const baseMat = new THREE.MeshStandardMaterial({ color: 0x3c4652, emissive: 0x0c1118, emissiveIntensity: 0.3, roughness: 0.82 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.045, 0.9), baseMat); base.position.y = 0.025; unloadZone.add(base);
      const L = batch(false);
      for (let i = -1; i <= 1; i++) L.box(0.12, 0.012, 0.74, i * 0.34, 0.052, 0, { ry: 0.35 });
      add(unloadZone, L.toMesh(stripeMat(), { cast: false, receive: false, name: 'v161SiteUnloadLines', soft: true }));
      const label = makeLabelSprite([lang === 'ru' ? '🚚 РАЗГРУЗКА' : '🚚 UNLOAD']);
      label.position.set(0, 0.82, 0); label.scale.set(0.78, 0.31, 1); unloadZone.add(label);
      unloadZone.position.set(-1.78 * envW, 0.11, 1.16 * envW);
      unloadZone.visible = false;   // shown by refreshSiteUnloadZone only while a delivery ticket exists (no marker for cargo that is not coming)
      unloadZone.userData.base = base; unloadZone.userData.label = label;
      group.add(unloadZone);
    }

    // ---- foundation (the slab grows in height only while it is poured: scale.y 0.08 -> 1)
    const foundationVisual = grp('foundation'); foundationVisual.scale.set(envW, 1, envW); foundationVisual.visible = false;
    {
      const F = batch(false);
      F.box(1.86, 0.18, 1.56, 0, 0.22, 0); for (const sx of [-0.72, 0.72]) for (const sz of [-0.56, 0.56]) F.box(0.28, 0.26, 0.28, sx, 0.22, sz);
      add(foundationVisual, F.toMesh(concreteSite(), { cast: false, receive: true, name: 'v161SiteFoundation' }));
      group.add(foundationVisual);
    }
    // ---- steel frame: final height envH x 2.1 (the beams ride at envH x their base height)
    const skeleton = grp('frame'); skeleton.scale.set(envW, 1, envW); skeleton.visible = false;
    {
      const S = batch(true), st = 0x8f98a4, Hh = 2.1 * envH;
      for (const sx of [-0.74, 0.74]) for (const sz of [-0.64, 0.64]) S.box(0.1, Hh, 0.1, sx, 0.11 + Hh / 2, sz, { c: st });
      const levels = envH > 1.7 ? [0.54, 1.12, 1.7, 2.3, 2.9, 3.5, 4.1, 4.7].filter((y) => y < Hh - 0.1) : [0.54 * envH, 1.12 * envH, 1.7 * envH];
      for (const y of levels) {
        for (const z of [0.64, -0.64]) S.box(1.68, 0.08, 0.08, 0, y, z, { c: st });
        for (const x of [0.8, -0.8]) S.box(0.08, 0.08, 1.28, x, y, 0, { c: st });
      }
      add(skeleton, mesh(S, MT.paint, 'v161SiteFrame', true)); group.add(skeleton);
    }
    // ---- walls: 4 panels at the real height (1.45 x envH), texture per metre
    const wallVisual = grp('walls'); wallVisual.scale.set(envW, 1, envW); wallVisual.visible = false;
    let wallW = 1.62, wallD = 1.16;
    if (kind === 'vertical') { wallW = 1.32; wallD = 1.18; } else if (kind === 'industrial') { wallW = 2.15; wallD = 1.7; }
    const wallH = 1.45 * envH, wallY = 0.92 - 0.725 + wallH / 2;
    {
      const W = batch(false);
      wallBox(W, wallW, wallH, 0.08, 0, wallY, wallD / 2, 0.6); wallBox(W, wallW, wallH, 0.08, 0, wallY, -wallD / 2, 0.6);
      wallBox(W, 0.08, wallH, wallD, -wallW / 2, wallY, 0, 0.6); wallBox(W, 0.08, wallH, wallD, wallW / 2, wallY, 0, 0.6);
      add(wallVisual, W.toMesh(wallMat(kind, stage && stage.color), { cast: false, receive: true, name: 'v161SiteWalls' })); group.add(wallVisual);
    }
    // ---- roof (true thickness / pitch at the top of the walls)
    const roofVisual = grp('roof'); roofVisual.scale.set(envW, 1, envW); roofVisual.visible = false;
    {
      const ry = wallY + wallH / 2 + 0.07;
      let tr;
      if (kind === 'house') { tr = createGableRoof(1.84, 1.5, 0.48, roofMatHouse()); tr.position.y = ry; }
      else if (kind === 'industrial') { tr = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 1.85), sharedMat('roofInd', () => createCorrugatedMaterial(0x596471, { roughness: 0.78, metalness: 0.16 }))); tr.position.y = ry; }
      else if (kind === 'vertical') { tr = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.1, 1.28), sharedMat('roofVert', () => createMetalMaterial(0x3e4b5a, { roughness: 0.6, metalness: 0.28 }))); tr.position.y = ry; }
      else { tr = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.42), sharedMat('roofShop', () => createMetalMaterial(0x69737f, { roughness: 0.72, metalness: 0.18 }))); tr.position.y = ry; }
      roofVisual.add(tr); group.add(roofVisual);
    }
    // ---- finish: window rows (one per ~1.45 m of wall) on the +z face + the door; flat colours, glass tint
    const finishVisual = grp('finish'); finishVisual.scale.set(envW, 1, envW); finishVisual.visible = false;
    {
      const G = batch(false), D = batch(true), rows = Math.max(1, Math.round(wallH / 1.45)), zf = wallD / 2 + 0.035, sx = wallW * 0.28;
      for (let r = 0; r < rows; r++) for (const x of [-sx, 0, sx]) { if (r === 0 && x === sx) continue; G.box(0.28, 0.34, 0.04, x, 1.0 + r * (wallH / rows), zf); }
      D.box(0.28, 0.56, 0.05, sx, 0.48, zf, { c: 0x4c5662 });
      add(finishVisual, mesh(D, MT.paint, 'v161SiteDoor', false)); add(finishVisual, G.toMesh(MT.glass, { cast: false, receive: false, name: 'v161SiteWindows', soft: true })); group.add(finishVisual);
    }

    // ---- crane: tower (base, mast, rungs) + jib pivot (jib, braces) + hook (cable, block) + load (beam, slings); no group scale: the mast is craneH x taller
    const craneRig = grp('craneRig'); craneRig.position.set(-1.2 * envW, 0, -1.18 * envW); group.add(craneRig);
    const mastH = 3.95 * craneH, topY = 4.02 * craneH;
    const craneBody = (() => {
      const B = batch(true);
      B.box(0.46, 0.22, 0.46, 0, 0.11, 0, { c: 0x555d6b }); B.box(0.22, mastH, 0.22, 0, 0.22 + mastH / 2 - 0.11, 0, { c: 0xffc35c });
      for (let i = 0; i < Math.floor(6 * craneH); i++) B.box(0.18, 0.04, 0.18, 0, 0.72 + i * 0.58, 0, { c: 0xfad58a });
      return add(craneRig, mesh(B, MT.paint, 'v161SiteCrane', true));
    })();
    const jibPivot = grp('jib'); jibPivot.position.set(0.02, topY, 0.04); craneRig.add(jibPivot);
    {
      const J = batch(true); J.box(3.26, 0.12, 0.12, 1.48, 0, 0, { c: 0xffcf74 });
      for (let i = 0; i < 4; i++) J.box(0.06, 0.52, 0.06, 0.48 + i * 0.62, 0.2 + (i % 2) * 0.12, 0, { rz: 0.52, c: 0xffcf74 });
      J.box(0.5, 0.3, 0.3, -0.35, 0.02, 0, { c: 0x555d6b });      // counterweight
      add(jibPivot, mesh(J, MT.paint, 'v161SiteJib', true));
    }
    const hook = grp('hook'); hook.position.set(2.36, -0.1, 0); jibPivot.add(hook);
    {
      const Hk = batch(true); Hk.cyl(0.018, 0.018, 1.65, 6, 0, -0.8, 0, { c: 0x4f5561 }); Hk.box(0.18, 0.14, 0.18, 0, -1.62, 0, { c: 0x343841 });
      add(hook, mesh(Hk, MT.paint, 'v161SiteHook', false, true));
    }
    const craneLoad = grp('craneLoad'); craneLoad.position.y = -1.9; hook.add(craneLoad);
    {
      const Lb = batch(true); Lb.box(1.05, 0.11, 0.12, 0, 0, 0, { c: 0x87919c });
      for (const sx of [-0.34, 0.34]) Lb.cyl(0.012, 0.012, 0.42, 5, sx, 0.24, 0, { rz: sx > 0 ? -0.34 : 0.34, c: 0x3c424a });
      add(craneLoad, mesh(Lb, MT.paint, 'v161SiteLoad', true));
    }

    // ---- concrete mixer (pours in phase 1): body (base, stand, chute), drum, stream
    const mixer = grp('mixer'); mixer.position.set(1.14 * envW, 0.08, -1.08 * envW); mixer.rotation.y = -0.42; group.add(mixer);
    {
      const Mx = batch(true);
      Mx.box(1.0, 0.18, 0.68, 0, 0.18, 0, { c: 0x404856 }); Mx.box(0.1, 0.52, 0.1, -0.28, 0.38, 0, { c: 0x69727c }); Mx.box(0.22, 0.06, 0.78, 0.55, 0.3, 0.12, { rx: -0.18, ry: -0.36, c: 0x8f98a4 });
      add(mixer, mesh(Mx, MT.paint, 'v161SiteMixer', true));
    }
    const drumPivot = grp('drum'); drumPivot.position.set(-0.06, 0.58, 0); mixer.add(drumPivot);
    { const Dr = batch(true); Dr.cyl(0.31, 0.42, 0.82, 16, 0, 0, 0, { rz: Math.PI / 2, c: accent }); add(drumPivot, mesh(Dr, MT.paint, 'v161SiteDrum', true)); }
    const mixerStream = (() => {
      const Sm = batch(true); Sm.cyl(0.035, 0.055, 0.42, 8, 0, 0, 0, { rz: 0.32, c: 0xb6b2aa });
      const m = mesh(Sm, MT.paint, 'v161SiteStream', false, true); m.position.set(0.82, 0.16, 0.24); mixer.add(m); return m;
    })();

    // ---- excavator (digs in phase 0): tracks + blade, turret (body, counterweight, cab, roof), boom, stick, bucket
    const excavator = grp('excavator'); excavator.position.set(1.12 * envW, 0.04, 1.02 * envW); excavator.rotation.y = -2.2; group.add(excavator);
    {
      const T = batch(true);
      for (const z of [-0.24, 0.24]) { T.box(1.06, 0.15, 0.25, 0, 0.09, z, { c: 0x2e3238 }); for (const x of [-0.34, 0, 0.34]) T.cyl(0.085, 0.085, 0.27, 10, x, 0.09, z, { rx: Math.PI / 2, c: 0x555d67 }); }
      T.box(0.12, 0.25, 0.9, 0.55, 0.12, 0, { c: 0x6d737b });
      add(excavator, mesh(T, MT.paint, 'v161SiteTracks', true));
    }
    const excavatorTurret = grp('turret'); excavatorTurret.position.y = 0.18; excavator.add(excavatorTurret);
    {
      const Tu = batch(true);
      Tu.box(0.92, 0.32, 0.62, 0, 0.28, 0, { c: 0xf0b243 }); Tu.box(0.32, 0.34, 0.58, -0.42, 0.34, 0, { c: 0xe7a53b });
      Tu.box(0.36, 0.34, 0.32, -0.1, 0.6, -0.08, { c: 0x5f7f99 }); Tu.box(0.4, 0.05, 0.36, -0.1, 0.79, -0.08, { c: 0xf0b243 });
      add(excavatorTurret, mesh(Tu, MT.paint, 'v161SiteTurret', true));
    }
    const armBase = grp('boom'); armBase.position.set(0.32, 0.5, 0); excavatorTurret.add(armBase);
    { const A = batch(true); A.box(0.72, 0.13, 0.13, 0.34, 0, 0, { c: 0xf3bd58 }); A.cyl(0.025, 0.025, 0.55, 7, 0.25, 0.12, 0.11, { rz: Math.PI / 2, c: 0xd5dbe0 }); add(armBase, mesh(A, MT.paint, 'v161SiteBoom', true)); }
    const arm2Pivot = grp('stick'); arm2Pivot.position.set(0.68, 0, 0); armBase.add(arm2Pivot);
    { const A2 = batch(true); A2.box(0.58, 0.11, 0.11, 0.27, 0, 0, { c: 0xf0b243 }); A2.cyl(0.02, 0.02, 0.42, 7, 0.22, -0.1, 0.09, { rz: Math.PI / 2, c: 0xd5dbe0 }); add(arm2Pivot, mesh(A2, MT.paint, 'v161SiteStick', true)); }
    const bucketPivot = grp('bucket'); bucketPivot.position.set(0.56, -0.02, 0); arm2Pivot.add(bucketPivot);
    { const Bk = batch(true); Bk.box(0.3, 0.22, 0.34, 0.12, 0, 0, { rz: -0.18, c: 0x625849 }); add(bucketPivot, mesh(Bk, MT.paint, 'v161SiteBucket', true)); }

    // ---- loose materials: steel beams (phase 2), rebar cage (phase 1)
    const beamStack = grp('beams'); beamStack.position.set(0.7 * envW, 0.08, -0.26 * envW); group.add(beamStack);
    { const Bs = batch(true); for (let i = 0; i < 4; i++) Bs.box(0.72, 0.08, 0.12, 0, 0.06 + i * 0.08, 0, { c: 0x87919c }); add(beamStack, mesh(Bs, MT.paint, 'v161SiteBeams', true)); }
    const rebarCage = grp('rebar'); rebarCage.position.set(-0.14 * envW, 0.12, 0.18 * envW); group.add(rebarCage);
    { const Rb = batch(true); for (const sx of [-0.24, 0.24]) for (const sz of [-0.18, 0.18]) Rb.box(0.02, 0.82, 0.02, sx, 0.42, sz, { c: 0x60656b }); add(rebarCage, mesh(Rb, MT.paint, 'v161SiteRebar', false, true)); }

    // ---- scaffolding on the long faces (phases 3 .. 5): posts, rails, a plank deck
    const scaffolding = grp('scaffolding'); scaffolding.visible = false; group.add(scaffolding);
    {
      const Sc = batch(true), sh = Math.max(1.65, 1.65 * envH * 0.85);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) Sc.box(0.035, sh, 0.035, sx * 1.12 * envW, sh / 2, sz * 0.82 * envW, { c: 0x8b949e });
      const ys = []; for (let y = 0.48; y < sh; y += 0.5) ys.push(y);
      for (const y of ys) for (const sz of [-1, 1]) Sc.box(2.25 * envW, 0.035, 0.035, 0, y, sz * 0.82 * envW, { c: 0x8b949e });
      Sc.box(2.1 * envW, 0.05, 0.28, 0, 1.02, 0.88 * envW, { c: 0xa37847 });
      add(scaffolding, mesh(Sc, MT.paint, 'v161SiteScaffold', true));
    }

    // ---- labels: the phase plate (same text as before) + the beam of light
    const phaseLabel = makeLabelSprite([lang === 'ru' ? 'ПОДГОТОВКА' : 'SITE PREP', '0%']);
    phaseLabel.position.set(0, clamp(1.9 + envH * 0.72, 2.15, 4.4), 0); phaseLabel.scale.set(0.96, 0.38, 1); group.add(phaseLabel);
    group.position.copy(pos);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 5.4 * envH, 8, 1, true), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }));
    beacon.renderOrder = 2; beacon.position.y = 2.8 * envH; beacon.name = 'v161SiteBeam'; beacon.userData.v161Soft = true; group.add(beacon);
    group.userData.v161Site = { envW, envH, craneH, kind };
    return {
      v161: true, group, jibPivot, hook, drumPivot, armBase, arm2Pivot, bucketPivot, excavatorTurret, beacon,
      mixer, mixerStream, excavator, craneLoad, beamStack, rebarCage, scaffolding, unloadZone,
      foundationVisual, frameVisual: skeleton, wallVisual, roofVisual, finishVisual,
      craneParts: [craneBody, jibPivot], phaseLabel, envH: 1, trueEnvH: envH, craneRig,
      phase: -1, lastPctBucket: -1, dustTimer: 0.25, timer: 0, duration: buildDuration, buildRef: null,
    };
  }

  // the crane tower base is the only solid part: a 0.5 m box while the crane stands (phases 2 .. 4, hidden otherwise)
  function obstacles() {
    const out = [];
    let sites = null; try { sites = constructionSites; } catch (e) { return out; }
    for (const s of sites || []) {
      if (!s || !s.v161 || !s.group || !s.group.parent || !s.craneParts || !s.craneParts[0] || !s.craneParts[0].visible) continue;
      const w = new THREE.Vector3(); s.craneRig.getWorldPosition(w);
      out.push({ owner: s.group, category: 'construction', label: 'site-crane-v161', shape: 'obb', pos: new THREE.Vector3(w.x, 0, w.z), hx: 0.27, hz: 0.27, yaw: 0, active: () => !!(s.group.parent && s.craneParts[0].visible) });
    }
    return out;
  }
  window.SiteV161 = { enabled: true, version: 'v161-site', build, obstacles };
})();
