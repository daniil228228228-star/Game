// Flat disc enumeration (2026-10-11 (16)): every visible, horizontal, roughly circular flat mesh (CircleGeometry / CylinderGeometry / RingGeometry / PlaneGeometry with a round map)
// within R m of the player, grouped by owner (top-level scene child name / userData keys). node tools/probe-discs-v161.mjs [--save fresh|stage1|stage3|stage6|old] [--out DIR] [--shot]
import fs from 'node:fs';
import path from 'node:path';
import { openGame, OLD_SAVE, REPO_ROOT } from '../tests/lib/harness.mjs';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : args[i + 1]; };
const which = opt('save', 'fresh');
const SAVES = { fresh: 'clear', old: OLD_SAVE, stage1: { saveVersion: 20, stageIndex: 1, money: 900, planks: 10, concrete: 0, metal: 0, buildings: [{ index: 0, level: 1 }] },
  stage3: { saveVersion: 20, stageIndex: 3, money: 3000, planks: 20, concrete: 5, metal: 5, buildings: Array.from({ length: 3 }, (_, i) => ({ index: i, level: 1 })) },
  stage6: { saveVersion: 20, stageIndex: 6, money: 5e6, planks: 30, concrete: 30, metal: 30, buildings: Array.from({ length: 6 }, (_, i) => ({ index: i, level: 1 })) } };
const OUT = path.resolve(opt('out', path.join(REPO_ROOT, '..', 'shots'))); fs.mkdirSync(OUT, { recursive: true });
const g = await openGame({ save: SAVES[which], waitMs: 7000 });
if (args.includes('--boxes')) await g.page.evaluate(() => { window.__boxes = true; });
const at = opt('at', ''); if (at) { const [ax, az] = at.split(',').map(Number); await g.page.evaluate(([x, z]) => { player.position.set(x, 0, z); playerVelocity.set(0, 0, 0); }, [ax, az]); await g.page.waitForTimeout(3500); }
const rows = await g.page.evaluate(() => {
  const vis = (o) => { for (let p = o; p; p = p.parent) if (p.visible === false) return false; return true; };
  const out = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const bb = new THREE.Box3().setFromObject(o); if (bb.isEmpty()) return;
    const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z, h = bb.max.y - bb.min.y, big = Math.max(w, d);
    if (h > 0.2 || bb.min.y > 0.3 || big < 0.8 || big > 30) return;
    const asp = Math.min(w, d) / big; if (asp < (window.__boxes ? 0.1 : 0.7)) return;   // round-ish footprints only unless --boxes
    const wp = new THREE.Vector3(); o.getWorldPosition(wp);
    const t = o.geometry.type;
    let top = o; while (top.parent && top.parent !== scene) top = top.parent;
    const m = (Array.isArray(o.material) ? o.material[0] : o.material) || {}; const col = m.color ? m.color.getHexString() : '';
    // circularity of the footprint: fraction of bbox area covered by the mesh would need triangles; use the geometry type as the hint
    out.push({ x: +((bb.min.x + bb.max.x) / 2).toFixed(1), y: +bb.min.y.toFixed(2), z: +((bb.min.z + bb.max.z) / 2).toFixed(1), w: +w.toFixed(1), d: +d.toFixed(1), t, col, op: m.opacity, vis: vis(o), name: o.name || '', top: top.name || '', topKeys: Object.keys(top.userData || {}).slice(0, 4).join(','), dist: +Math.hypot((bb.min.x + bb.max.x) / 2 - player.position.x, (bb.min.z + bb.max.z) / 2 - player.position.z).toFixed(1), map: !!m.map, par: o.parent && o.parent !== scene ? (o.parent.name || o.parent.type) : '' });
  });
  return { stage: stageIndex, player: [+player.position.x.toFixed(1), +player.position.z.toFixed(1)], rows: out };
});
const near = rows.rows.filter((r) => r.vis).sort((a, b) => a.dist - b.dist);
console.log(which, 'stage', rows.stage, 'player', rows.player, 'visible flat discs', near.length);
for (const r of near.slice(0, 80)) console.log(JSON.stringify(r));
fs.writeFileSync(path.join(OUT, `discs-${which}.json`), JSON.stringify(rows, null, 1));
if (args.includes('--shot')) await g.page.screenshot({ path: path.join(OUT, `discs-${which}${at ? '-' + at : ''}${opt('tag', '')}.png`) });
await g.close();
