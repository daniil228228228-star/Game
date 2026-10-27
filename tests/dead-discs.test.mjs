// Dead white discs (CHANGELOG_V161.md 2026-10-11 (16)). User, iPhone screenshots: «Убери вот эти белые кружки которые ничего не делают» -- flat white / cream ellipses lying on the grass
// (4 cream plaza-spoke end caps around the spawn whose spokes no longer exist; the white curb + walk discs of 4 garden courts and the pocket park). World consistency rule 2: a disc exists only
// with a function (a pad, a building's own part, a tree bed with its tree, a road cap, the hero shadow).
// FOUR launches (fresh save, OLD_SAVE = stage 1, a stage-3 save, a stage-6 save). In each: every visible, horizontal, roughly circular flat mesh (0.8..30 m, < 20 cm thick, any geometry type,
// merged BufferGeometry included) is listed with its owner and classified:
//   owned   = nested in a group, or its top-level object has a name / userData (pads, buildings, plates, markers, hubs, hero shadow);
//   road    = dark asphalt material (luma < 0.35: road caps / bays);
//   bed     = a brown mulch bed with a decorative tree / bench within 1.5 m (the bed of that tree);
//   ORPHAN  = anything else. HARD: 0 orphans, and 0 light (linear luma > 0.5: white / cream) anonymous top-level discs within 15 m of the player on a fresh save.
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';
const J = JSON.stringify;
const SAVES = {
  fresh: 'clear',
  'old save (stage 1)': OLD_SAVE,
  'stage 3': { saveVersion: 20, stageIndex: 3, money: 3000, planks: 20, concrete: 5, metal: 5, buildings: Array.from({ length: 3 }, (_, i) => ({ index: i, level: 1 })) },
  'stage 6': { saveVersion: 20, stageIndex: 6, money: 5e6, planks: 30, concrete: 30, metal: 30, buildings: Array.from({ length: 6 }, (_, i) => ({ index: i, level: 1 })) },
};
const SCAN = () => {
  const vis = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  scene.updateMatrixWorld(true);
  const trees = []; scene.children.forEach((o) => { if (o.userData && (o.userData.decorativeTree || o.userData.harvestableTree) || /bench/i.test(o.name || '')) trees.push(o.position); });
  scene.traverse((o) => { if (o.isMesh && o.parent !== scene && /bench/i.test(o.parent.name || '')) trees.push(o.parent.position); });
  const out = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !vis(o)) return;
    const bb = new THREE.Box3().setFromObject(o); if (bb.isEmpty()) return;
    const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z, h = bb.max.y - bb.min.y, big = Math.max(w, d);
    if (h > 0.2 || bb.min.y > 0.3 || big < 0.8 || big > 30 || Math.min(w, d) / big < 0.7) return;
    const m = (Array.isArray(o.material) ? o.material[0] : o.material) || {};
    if (m.transparent && m.opacity < 0.3) return;   // soft shadows / glows
    const col = m.color ? m.color.clone() : new THREE.Color(0x888888), luma = 0.2126 * col.r + 0.7152 * col.g + 0.0722 * col.b;
    let top = o; while (top.parent && top.parent !== scene) top = top.parent;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    const hex = col.getHexString(), light = luma > 0.5;   // linear luma > 0.5 ~ sRGB 0.74: cream / white
    const owned = top !== o || !!top.name || Object.keys(top.userData || {}).length > 0;
    const bed = /^(98714a|9a744d|897453)$/.test(hex) && trees.some((p) => Math.hypot(p.x - cx, p.z - cz) < 1.5);
    const road = luma < 0.12;   // linear luma ~ 0.35 sRGB
    const cls = owned ? 'owned' : road ? 'road' : bed ? 'bed' : 'ORPHAN';
    out.push({ cls, x: +cx.toFixed(1), z: +cz.toFixed(1), d: +big.toFixed(1), t: o.geometry.type, hex, light, owner: top.name || Object.keys(top.userData || {}).slice(0, 3).join(',') || (top !== o ? (top.type) : 'anonymous'), distPlayer: +Math.hypot(cx - player.position.x, cz - player.position.z).toFixed(1) });
  });
  return { stage: stageIndex, spawn: [+player.position.x.toFixed(1), +player.position.z.toFixed(1)], rows: out };
};
for (const [label, save] of Object.entries(SAVES)) {
  const g = await openGame({ save, waitMs: 6500 });
  const r = await g.page.evaluate(SCAN);
  const byCls = {}; for (const x of r.rows) byCls[x.cls] = (byCls[x.cls] || 0) + 1;
  console.log(`---- ${label}: stage ${r.stage}, flat discs ${r.rows.length} ${J(byCls)}`);
  const owners = {}; for (const x of r.rows) { const k = `${x.cls}:${x.owner}`; owners[k] = (owners[k] || 0) + 1; }
  console.log('  owners ' + J(owners));
  const orphans = r.rows.filter((x) => x.cls === 'ORPHAN');
  check(orphans.length === 0, `${label}: no visible flat disc without an owner / function ${J(orphans.slice(0, 6))}`);
  const lightNear = r.rows.filter((x) => x.cls !== 'owned' && x.light && x.distPlayer < 15);
  check(lightNear.length === 0, `${label}: no light-coloured anonymous disc within 15 m of the player ${J(lightNear.slice(0, 4))}`);
  check(r.rows.length > 0, `${label}: the scan finds the real pads / shadows (${r.rows.length} discs), so it is not blind`);
  check(g.errors.length === 0, `${label}: 0 console errors ${J(g.errors.slice(0, 2))}`);
  await g.close();
}
