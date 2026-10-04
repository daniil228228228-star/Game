// Shimmer ("ryab") regression test, ROADMAP/CHANGELOG_V161 2026-10-04 (user's phone screenshots: radial
// dark/grey fan on road corners, grainy crawling grass, crawling distant shadow edges).
// One browser launch on the old save + 6 bought houses (so stage-road CORNER pieces exist).
//   STRUCTURAL (hard checks, scene graph):
//     1. every tiled texture used by a mesh material (map/bump/normal/roughness/metalness) has mipmaps
//        (generateMipmaps, minFilter *Mipmap*) and anisotropy > 1 when the GPU supports it,
//     2. no two visible opaque horizontal meshes overlap in XZ with the same top height (< Z_EPS apart,
//        no polygonOffset): that is z-fighting, the radial dark/grey fan on corners,
//     3. corner/junction road pieces that carry a texture have finite UVs with a uniform
//        uv-area / world-area ratio (no radial stretching); unmapped pieces are reported,
//     4. shadow map: bias/normalBias large enough for the shadow texel size (acne at low sun),
//        and the camera depth range is not wasting precision (near >= 0.3).
//   MEASURED (reported, not hard-failed: software GL is noisy):
//     a. "jitter": the same still frame rendered at 6 camera positions 1.5 cm apart; mean absolute RGB
//        difference between consecutive frames (shimmer = aliasing that flickers under sub-pixel motion),
//     b. "alias": mean absolute difference between the 1x render and the 2x supersampled render
//        box-filtered down (static aliasing / moire energy).
//   Both are rendered in one JS task straight from renderer.render() + gl.readPixels(), so the game loop
//   and its animations cannot change the scene between the compared frames.
//   SHOTS_DIR=/path writes PNG/JPG screenshots of the poses; SHIMMER_REPORT_ONLY=1 never fails (baseline run).
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';
import fs from 'node:fs';
import path from 'node:path';

const REPORT_ONLY = !!process.env.SHIMMER_REPORT_ONLY;
const SHOTS = process.env.SHOTS_DIR || '';
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const tag = process.env.SHOT_TAG || 'now';

const g = await openGame({ save: OLD_SAVE, waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
await ev(() => { money = 999999999; planks = 999999; concrete = 999999; metal = 999999; });
for (let i = 0; i < 6; i++) {
  await ev(() => { purchaseCurrentPad(); });
  await page.waitForTimeout(150);
  await ev(() => {
    for (const b of buildings) if (b.underConstruction) { b.underConstruction = false; b.progress = 1; }
    for (let i = growingMeshes.length - 1; i >= 0; i--) if (!growingMeshes[i]?.entry?.underConstruction) { const gm = growingMeshes[i]; gm.mesh.visible = true; gm.mesh.scale.set(1, 1, 1); if (gm.site) { scene.remove(gm.site.group); disposeObject3D(gm.site.group); gm.site = null; } growingMeshes.splice(i, 1); }
  });
  await page.waitForTimeout(150);
}
await page.waitForFunction(() => (cityWorldRuntime?.stageRoads?.userData?.v86StageNetwork?.stageIds?.length || 0) >= 6, null, { timeout: 60000, polling: 500 }).catch(() => {});
await page.waitForTimeout(3000);

// ---------------------------------------------------------------- structural audit
const audit = await ev(() => {
  scene.updateMatrixWorld(true);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  // 1. textures
  const texInfo = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
      if (!m) continue;
      for (const k of ['map', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap']) {
        const t = m[k];
        if (!t || !t.isTexture) continue;
        let e = texInfo.get(t.uuid);
        if (!e) {
          const wrap = t.wrapS === THREE.RepeatWrapping || t.wrapT === THREE.RepeatWrapping;
          e = { slot: k, src: (t.image && (t.image.currentSrc || t.image.src || '')).split('/').pop().slice(0, 40) || (t.image?.tagName || 'canvas'),
            wrap, mip: !!t.generateMipmaps, min: t.minFilter, aniso: t.anisotropy, w: t.image?.width || 0, count: 0, rep: [t.repeat.x, t.repeat.y], fam: t.userData?.v152Family || '' };
          texInfo.set(t.uuid, e);
        }
        e.count++;
      }
    }
  });
  const MIPMIN = [THREE.NearestMipmapNearestFilter, THREE.LinearMipmapNearestFilter, THREE.NearestMipmapLinearFilter, THREE.LinearMipmapLinearFilter];
  const texList = [...texInfo.values()];
  const tiled = texList.filter((e) => e.wrap);
  const repeatBad = texList.filter((e) => e.fam && (e.rep[0] !== 1 || e.rep[1] !== 1)).map((e) => `${e.slot}:${e.src}:repeat=${e.rep}`);
  const badTex = tiled.filter((e) => !e.mip || !MIPMIN.includes(e.min) || (maxAniso > 1 && !(e.aniso > 1)));

  // 2. coplanar overlap of horizontal top faces (world space)
  const faces = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.visible === false) return;
    const box = new THREE.Box3().setFromObject(o);
    if (!(box.max.y < 0.2 && box.max.y - box.min.y < 0.2)) return;
    const ownsOffset = m.polygonOffset === true;
    const transparent = m.transparent === true || m.depthWrite === false;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, n = idx ? idx.count : pos.count;
    const tris = [];
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      const ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z); // + up (XZ winding), unnormalised
      const area = Math.abs(ny) / 2;
      if (area < 1e-5) continue;
      const hy = Math.max(a.y, b.y, c.y) - Math.min(a.y, b.y, c.y);
      if (hy > 1e-4) continue; // not horizontal
      tris.push({ y: (a.y + b.y + c.y) / 3, up: ny > 0, p: [[a.x, a.z], [b.x, b.z], [c.x, c.z]] });
    }
    if (!tris.length) return;
    const ks = Object.keys(o.userData || {}).filter((k) => !/^_/.test(k)).slice(0, 3).join('+'), chain = [];
    for (let q = o.parent; q && q !== scene && chain.length < 2; q = q.parent) if (q.name) chain.push(q.name);
    faces.push({ skin: !!o.userData?.v44SurfaceApplied || chain.includes('v44-building-details'), area: (box.max.x - box.min.x) * (box.max.z - box.min.z), o, name: `${o.geometry.type}[${ks}]<${chain.join('<')}`, ownsOffset, transparent, box, tris, renderOrder: o.renderOrder || 0 });
  });
  const overlap = (T, U) => { // strict SAT overlap > 0.01 of two XZ triangles
    for (const poly of [T, U]) for (let i = 0; i < 3; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % 3], ax = -(p2[1] - p1[1]), az = p2[0] - p1[0], len = Math.hypot(ax, az) || 1;
      const pr = (P) => { const d = P.map((p) => (p[0] * ax + p[1] * az) / len); return [Math.min(...d), Math.max(...d)]; };
      const [a0, a1] = pr(T), [b0, b1] = pr(U);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= 0.01) return false;
    }
    return true;
  };
  const Z_EPS = 0.0015;
  const pairs = [];
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const A = faces[i], B = faces[j];
    if (A.ownsOffset || B.ownsOffset || A.transparent || B.transparent) continue;
    if (Math.min(A.area, B.area) < 0.06) continue; // boots, studs, bolts: smaller than a visible flicker patch
    // identical shading on both faces (same material, or the same texture and a colour within 8/255): z-fighting is invisible
    const mA = Array.isArray(A.o.material) ? A.o.material[0] : A.o.material, mB = Array.isArray(B.o.material) ? B.o.material[0] : B.o.material;
    const dc = mA.color && mB.color ? Math.max(Math.abs(mA.color.r - mB.color.r), Math.abs(mA.color.g - mB.color.g), Math.abs(mA.color.b - mB.color.b)) : 1;
    if (mA === mB || (mA.map === mB.map && dc < 8 / 255 && (mA.emissiveIntensity || 0) === (mB.emissiveIntensity || 0))) continue;
    if (A.box.max.x < B.box.min.x || B.box.max.x < A.box.min.x || A.box.max.z < B.box.min.z || B.box.max.z < A.box.min.z) continue;
    let hit = 0, dy = 9;
    for (const T of A.tris) for (const U of B.tris) {
      if (T.up !== U.up) continue;
      const d = Math.abs(T.y - U.y);
      if (d >= Z_EPS) continue;
      if (hit >= 3) break;
      if (overlap(T.p, U.p)) { hit++; dy = Math.min(dy, d); }
    }
    if (hit) pairs.push({ skin: A.skin || B.skin, da: `${A.box.min.x.toFixed(2)},${A.box.min.z.toFixed(2)}..${A.box.max.x.toFixed(2)},${A.box.max.z.toFixed(2)} col=${(Array.isArray(A.o.material) ? A.o.material[0] : A.o.material).color?.getHex().toString(16)}`, db: `${B.box.min.x.toFixed(2)},${B.box.min.z.toFixed(2)}..${B.box.max.x.toFixed(2)},${B.box.max.z.toFixed(2)} col=${(Array.isArray(B.o.material) ? B.o.material[0] : B.o.material).color?.getHex().toString(16)}`, top: A.tris[0].y, a: A.name, b: B.name, dy: +dy.toFixed(5), y: +A.tris[0].y.toFixed(3), at: [+((A.box.min.x + A.box.max.x) / 2).toFixed(1), +((A.box.min.z + A.box.max.z) / 2).toFixed(1)] });
  }

  // 3. road pieces' UVs
  const roadTags = ['v86Curve', 'v59Intersection', 'v86Junction', 'v112TightCorner', 'v59RoadDeck', 'v113UnionSource'];
  const roadUV = { pieces: 0, mapped: 0, unmapped: 0, bad: [] };
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || !roadTags.some((k) => o.userData?.[k])) return;
    if (o.userData.v59RoadDeck && !o.userData.v86Curve && !o.userData.v112TightCorner) return; // straight boxes are not the complaint
    roadUV.pieces++;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const hasTex = !!(m && (m.map || m.bumpMap || m.normalMap || m.roughnessMap));
    if (!hasTex) { roadUV.unmapped++; return; }
    roadUV.mapped++;
    const uv = o.geometry.attributes.uv, pos = o.geometry.attributes.position;
    if (!uv) { roadUV.bad.push(o.name + ':no uv'); return; }
    let ok = true, lo = Infinity, hi = 0;
    const idx = o.geometry.index, n = idx ? idx.count : pos.count;
    for (let i = 0; i < uv.count; i++) if (!Number.isFinite(uv.getX(i)) || !Number.isFinite(uv.getY(i)) || Math.abs(uv.getX(i)) > 1e3 || Math.abs(uv.getY(i)) > 1e3) ok = false;
    for (let i = 0; i < n; i += 3) {
      const t = [0, 1, 2].map((k) => (idx ? idx.getX(i + k) : i + k));
      const w = t.map((q) => [pos.getX(q), pos.getZ(q) + pos.getY(q) * 0]), u = t.map((q) => [uv.getX(q), uv.getY(q)]);
      const aw = Math.abs((w[1][0] - w[0][0]) * (w[2][1] - w[0][1]) - (w[1][1] - w[0][1]) * (w[2][0] - w[0][0])) / 2;
      const au = Math.abs((u[1][0] - u[0][0]) * (u[2][1] - u[0][1]) - (u[1][1] - u[0][1]) * (u[2][0] - u[0][0])) / 2;
      if (aw < 1e-6) continue;
      const r = au / aw; if (r > 0) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
    }
    if (!ok || (hi / Math.max(lo, 1e-9) > 4)) roadUV.bad.push(`${o.name || o.geometry.type}: finite=${ok} uvScaleRatio=${(hi / Math.max(lo, 1e-9)).toFixed(1)}`);
  });

  // 3b. every visible flat ground-level mesh with a texture: texel density (tiles per metre) and consistency; asphalt-ish colours
  const mappedFlat = {}, colorGroups = {};
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    for (let q = o; q; q = q.parent) if (q.visible === false) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m || m.visible === false) return;
    const box = new THREE.Box3().setFromObject(o);
    if (!(box.max.y < 0.15 && box.max.y - box.min.y < 0.2)) return;
    const hex = m.color ? m.color.getHex().toString(16) : '-';
    const ks = Object.keys(o.userData || {}).filter((k) => !/^_/.test(k)).slice(0, 2).join('+');
    const lum = m.color ? 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b : 1;
    if (m.color && box.max.y > 0.05 && lum < 0.2) { const ck = `${hex}${m.map ? '+map' : ''}${m.userData?.sharedRoadSurface ? '+shared' : ''}`; (colorGroups[ck] = colorGroups[ck] || { n: 0, ex: `${o.geometry.type}[${ks}]` }).n++; }
    if (!m.map) return;
    const uv = o.geometry.attributes.uv, pos = o.geometry.attributes.position, idx = o.geometry.index;
    let aw = 0, au = 0, lo = Infinity, hi = 0;
    if (uv) {
      const n = idx ? idx.count : pos.count;
      for (let i = 0; i < n; i += 3) {
        const t = [0, 1, 2].map((k) => (idx ? idx.getX(i + k) : i + k));
        const W = t.map((q) => new THREE.Vector3().fromBufferAttribute(pos, q).applyMatrix4(o.matrixWorld));
        const w = Math.abs((W[1].x - W[0].x) * (W[2].z - W[0].z) - (W[1].z - W[0].z) * (W[2].x - W[0].x)) / 2;
        const U = t.map((q) => [uv.getX(q), uv.getY(q)]);
        const u = Math.abs((U[1][0] - U[0][0]) * (U[2][1] - U[0][1]) - (U[1][1] - U[0][1]) * (U[2][0] - U[0][0])) / 2;
        if (w < 1e-6 || u <= 0) continue;
        aw += w; au += u; const r = u / w; lo = Math.min(lo, r); hi = Math.max(hi, r);
      }
    }
    const rep = m.map.repeat, dens = aw ? Math.sqrt(au / aw) * Math.sqrt(rep.x * rep.y) : 0;
    const key = `${o.geometry.type}[${ks}] map=${(m.map.userData?.v152Family) || (m.map.image?.tagName || '?')} rep=${rep.x.toFixed(1)} tiles/m=${dens.toFixed(3)} uvRatio=${hi && lo < Infinity ? (hi / lo).toFixed(1) : '-'} y=${box.max.y.toFixed(2)}`;
    const e = (mappedFlat[key] = mappedFlat[key] || { n: 0, ex: '' }); e.n++;
    if (!e.ex && hi / lo > 4) { const ch = []; for (let q = o.parent; q && q !== scene && ch.length < 3; q = q.parent) ch.push(q.name || q.type); e.ex = `bbox ${box.min.x.toFixed(1)},${box.min.z.toFixed(1)}..${box.max.x.toFixed(1)},${box.max.z.toFixed(1)} col=${m.color.getHex().toString(16)} chain=${ch.join('<')} norm=${o.geometry.attributes.normal ? o.geometry.attributes.normal.getY(0).toFixed(2) : '-'} rot=${o.rotation.x.toFixed(2)}`; }
  });

  // 4. shadow + depth
  const sh = sun.shadow, cam = sh.camera;
  const texel = (cam.right - cam.left) / sh.mapSize.x;
  return {
    repeatBad, maxAniso, tiledTextures: tiled.length, allTextures: texList.length, badTex: badTex.map((e) => `${e.slot}:${e.src}:mip=${e.mip}:min=${e.min}:an=${e.aniso}`),
    texDump: tiled.slice(0, 40).map((e) => `${e.slot}:${e.src}:mip=${e.mip}:min=${e.min}:an=${e.aniso}:x${e.count}`),
    faces: faces.length, pairCount: pairs.length,
    groups: Object.values(pairs.reduce((acc, p) => { const k = `${p.a} | ${p.b} | y=${p.y}`; (acc[k] = acc[k] || { k, n: 0, at: p.at, da: p.da, db: p.db }).n++; return acc; }, {})).sort((x, y) => (x.k.includes('y=0.1') || x.k.includes('y=0.0') ? 0 : 1) - (y.k.includes('y=0.1') || y.k.includes('y=0.0') ? 0 : 1) || y.n - x.n).slice(0, 40),
    lowCount: pairs.filter((p) => p.top <= 0.1 && !p.skin).length, skinCount: pairs.filter((p) => p.skin).length,
    pairs: pairs.slice(0, 6),
    roadUV, mappedFlat: Object.entries(mappedFlat).sort((a, b) => b[1].n - a[1].n).slice(0, 14).map(([k, v]) => `${v.n} x ${k} ${v.ex}`), colorGroups: Object.entries(colorGroups).sort((a, b) => b[1].n - a[1].n).slice(0, 20).map(([k, v]) => `${v.n} x #${k} e.g. ${v.ex}`),
    shadow: { texel: +texel.toFixed(3), bias: sh.bias, normalBias: sh.normalBias, map: sh.mapSize.x, type: renderer.shadowMap.type, radius: sh.radius, left: cam.left, far: cam.far },
    camera: { near: camera.near, far: camera.far, dpr: renderer.getPixelRatio() },
  };
});
console.log('maxAnisotropy', audit.maxAniso, '| tiled textures', audit.tiledTextures, '/', audit.allTextures, '| flat top faces', audit.faces);
console.log('texture dump:', JSON.stringify(audit.texDump));
console.log('coplanar equal-y overlapping pairs:', audit.pairCount);
console.log('pairs on the road/ground layer (top <= 0.1, not a building skin):', audit.lowCount, '| building-skin pairs (v44 re-skinned base/porch/steps, not touched):', audit.skinCount);
for (const gr of audit.groups) console.log('   ', gr.n, 'x', gr.k, '@', JSON.stringify(gr.at), '| A', gr.da, '| B', gr.db);
console.log('textures whose repeat is not 1,1 although the surface UVs own tiling:', JSON.stringify(audit.repeatBad));
console.log('flat ground-level textured meshes:'); for (const l of audit.mappedFlat) console.log('   ', l);
console.log('flat ground-level DARK colours (linear luma < 0.2, y>0.05) = asphalt-like:'); for (const l of audit.colorGroups) console.log('   ', l);
console.log('road corner UV:', JSON.stringify(audit.roadUV));
console.log('shadow:', JSON.stringify(audit.shadow), 'camera:', JSON.stringify(audit.camera));

// ---------------------------------------------------------------- measured: jitter + alias
const poses = await ev(() => {
  const out = {};
  // corner: a v86Curve ribbon (or any intersection piece)
  let corner = null;
  scene.traverse((o) => { if (!corner && o.isMesh && (o.userData?.v86Curve || o.userData?.v112TightCorner)) corner = o; }); // the union layer shows it, the source ribbon may be hidden
  if (!corner) scene.traverse((o) => { if (!corner && o.isMesh && o.userData?.v59Intersection) corner = o; });
  const cp = new THREE.Vector3();
  if (corner) new THREE.Box3().setFromObject(corner).getCenter(cp);
  out.cornerFound = !!corner;
  out.corner = { x: cp.x, z: cp.z };
  return out;
});
console.log('corner piece at', JSON.stringify(poses));

const SHOT = async (name, b64) => { if (SHOTS && b64) fs.writeFileSync(path.join(SHOTS, `${tag}-${name}.jpg`), Buffer.from(b64.split(',')[1], 'base64')); };

const measureFn = (cfg) => {
  const W = renderer.domElement.width, H = renderer.domElement.height, gl = renderer.getContext();
  const savedPos = camera.position.clone(), savedQuat = camera.quaternion.clone();
  const savedAnim = typeof animate === 'function';
  const buf = new Uint8Array(W * H * 4);
  const grab = () => { gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf.slice(); };
  const render = () => { camera.updateMatrixWorld(true); renderer.render(scene, camera); };
  const meanDiff = (A, B) => { let s = 0, n = 0; for (let i = 0; i < A.length; i += 4) { s += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); n += 3; } return s / n; };
  const res = {}, shots = {};
  const views = cfg.views;
  for (const v of views) {
    camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
    camera.lookAt(v.look[0], v.look[1], v.look[2]);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const base = camera.position.clone();
    const frames = [];
    const KMAX = cfg.quick ? 1 : 6;
    for (let k = 0; k < KMAX; k++) {
      camera.position.copy(base).addScaledVector(right, k * 0.015);
      render();
      frames.push(grab());
      if (k === 0) { renderer.domElement.toDataURL; shots[v.name] = renderer.domElement.toDataURL('image/jpeg', 0.88); }
    }
    if (cfg.quick) { res[v.name] = { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, px: `${W}x${H}` }; continue; }
    let sum = 0; for (let k = 1; k < frames.length; k++) sum += meanDiff(frames[k - 1], frames[k]);
    const jitter = sum / (frames.length - 1);
    // supersampled reference: 2x pixel ratio, box-filtered down
    camera.position.copy(base); render(); const f1 = grab();
    const oldR = renderer.getPixelRatio();
    renderer.setPixelRatio(oldR * 2);
    const W2 = renderer.domElement.width, H2 = renderer.domElement.height;
    render();
    const big = new Uint8Array(W2 * H2 * 4); gl.readPixels(0, 0, W2, H2, gl.RGBA, gl.UNSIGNED_BYTE, big);
    renderer.setPixelRatio(oldR);
    let s2 = 0, n2 = 0;
    const sx = W2 / W, sy = H2 / H;
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0, cnt = 0;
        for (let dy = 0; dy < Math.round(sy); dy++) for (let dx = 0; dx < Math.round(sx); dx++) { acc += big[(((Math.min(H2 - 1, Math.round(y * sy) + dy)) * W2) + Math.min(W2 - 1, Math.round(x * sx) + dx)) * 4 + ch]; cnt++; }
        s2 += Math.abs(acc / cnt - f1[(y * W + x) * 4 + ch]); n2++;
      }
    }
    // hf = graininess: mean |pixel - mean of its 4 neighbours| (a weave/ripple near Nyquist raises it, a smooth lawn does not)
    let hs = 0, hn = 0;
    for (let y = 1; y < H - 1; y += 2) for (let x = 1; x < W - 1; x += 2) {
      const i = (y * W + x) * 4, c = f1[i] + f1[i + 1] + f1[i + 2];
      const l = f1[i - 4] + f1[i - 3] + f1[i - 2], r = f1[i + 4] + f1[i + 5] + f1[i + 6], u = f1[i - W * 4] + f1[i - W * 4 + 1] + f1[i - W * 4 + 2], d = f1[i + W * 4] + f1[i + W * 4 + 1] + f1[i + W * 4 + 2];
      hs += Math.abs(c - (l + r + u + d) / 4); hn += 3;
    }
    res[v.name] = { hf: +(hs / hn).toFixed(3), jitter: +jitter.toFixed(3), alias: +(s2 / n2).toFixed(3), px: `${W}x${H}`, calls: renderer.info.render.calls, tris: renderer.info.render.triangles };
  }
  camera.position.copy(savedPos); camera.quaternion.copy(savedQuat);
  return { res, shots };
};

const measure = await ev(measureFn, {
  views: [
    { name: 'corner-near', pos: [poses.corner.x + 5.5, 4.2, poses.corner.z + 6], look: [poses.corner.x, 0, poses.corner.z] },
    { name: 'corner-low', pos: [poses.corner.x + 14, 2.4, poses.corner.z + 16], look: [poses.corner.x - 4, 0, poses.corner.z - 4] },
    { name: 'grass', pos: [30, 3.0, 42], look: [30, 0, 8] },
    { name: 'sawmill-air', pos: [-51 + 0, 15, -7.7 + 11], look: [-51, 0, -7.7] },
    { name: 'sawmill-side', pos: [-51 + 8, 3.2, -7.7 + 9], look: [-51, 1.2, -7.7] },
  ],
});
for (const [name, b64] of Object.entries(measure.shots)) await SHOT(name, b64);
console.log('MEASURE (mean abs RGB diff 0-255; lower = calmer):');
for (const [k, v] of Object.entries(measure.res)) console.log(`  ${k.padEnd(12)} jitter ${v.jitter}  hf ${v.hf}  alias ${v.alias}  [${v.px}, ${v.calls} draw calls, ${v.tris} tris]`);

const sawInfo = {};
// ---------------------------------------------------------------- sawmill: meshes / draw calls per level + shots
const SAW_VIEWS = [
  { name: 'sawmill-air', pos: [-51, 15, -7.7 + 11], look: [-51, 0, -7.7] },
  { name: 'sawmill-side', pos: [-51 + 8, 3.2, -7.7 + 9], look: [-51, 1.2, -7.7] },
  { name: 'sawmill-front', pos: [-51 - 3.5, 5.5, -7.7 + 9.5], look: [-51, 1.3, -7.7 + 0.5] },
];
for (const lv of [1, 2, 3]) {
  const info = await ev((level) => {
    industrialLevelsV161.sawmill = level;
    if (typeof refreshSawmillVisualsV161 === 'function') refreshSawmillVisualsV161();
    let meshes = 0, tris = 0, name = null;
    const m = scene.getObjectByName('v161SawmillMill');
    if (m) m.traverse((o) => { if (o.isMesh) { meshes++; const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
    // apples-to-apples with the pre-redesign build: every mesh within 4.5 m of SAWMILL_POS except the belt and sprites
    let near = 0;
    const wp = new THREE.Vector3();
    scene.traverse((o) => { if (!o.isMesh || o.userData?.v116Conveyor) return; o.getWorldPosition(wp); if (Math.hypot(wp.x - SAWMILL_POS.x, wp.z - SAWMILL_POS.z) < 4.5) near++; });
    return { found: !!m, level: m?.userData?.levelV161, meshes, near, tris: Math.round(tris), spinners: m?.userData?.spinners?.length };
  }, lv);
  const r = await ev(measureFn, { views: SAW_VIEWS.map((v) => ({ ...v, name: `${v.name}-L${lv}` })), quick: true });
  for (const [name, b64] of Object.entries(r.shots)) await SHOT(name, b64);
  console.log(`SAWMILL level ${lv}:`, JSON.stringify(info), '| draw calls', Object.entries(r.res).map(([k, v]) => `${k.replace('sawmill-', '')}=${v.calls}`).join(' '));
  sawInfo[lv] = info;
}
check(sawInfo[1]?.found && sawInfo[2]?.level === 2 && sawInfo[3]?.level === 3, 'the redesigned sawmill rebuilds for level 2 and 3 (v161SawmillMill)');
check(sawInfo[3].meshes <= 26, `mill mesh count stays modest for mobile (sawmill v2 has animated parts: 22/23/24 meshes, v1 was 11/12/13) (L1 ${sawInfo[1]?.meshes}, L2 ${sawInfo[2]?.meshes}, L3 ${sawInfo[3]?.meshes} meshes)`);

// ---------------------------------------------------------------- hard checks
const hard = (cond, msg) => { if (REPORT_ONLY) console.log((cond ? 'ok(report): ' : 'WOULD FAIL(report): ') + msg); else check(cond, msg); };
hard(audit.badTex.length === 0, `every tiled texture has mipmaps + anisotropy>1 (bad: ${JSON.stringify(audit.badTex.slice(0, 6))})`);
hard(audit.lowCount === 0, `no visibly different coplanar overlapping meshes on the road/ground layer (top <= 0.1 m, outside building skins): ${audit.lowCount} pairs (building skins, reported only: ${audit.skinCount}; all: ${audit.pairCount})`);
hard(audit.repeatBad.length === 0, `surface textures keep repeat 1,1 (physical UVs own the tiling): ${JSON.stringify(audit.repeatBad)}`);
hard(audit.roadUV.bad.length === 0, `corner/junction road UVs sane (${audit.roadUV.mapped} mapped, ${audit.roadUV.unmapped} untextured; bad ${JSON.stringify(audit.roadUV.bad.slice(0, 3))})`);
hard(audit.shadow.normalBias >= Math.min(0.12, audit.shadow.texel * 0.5), `shadow normalBias ${audit.shadow.normalBias} >= half the texel size (${audit.shadow.texel} m) capped at 0.12`);
hard(audit.camera.near >= 0.3, `camera near ${audit.camera.near} >= 0.3 (depth precision)`);
check(poses.cornerFound, 'a road corner piece exists to look at');
check(g.errors.length === 0 && g.badResponses.length === 0, `no console errors / 4xx ${JSON.stringify([...g.errors, ...g.badResponses].slice(0, 3))}`);
await g.close();
