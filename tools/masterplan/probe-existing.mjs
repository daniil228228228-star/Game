// Read-only замер живой сцены: ВСЕ коллайдеры реестра v83 (r>35) + позиции 12 земельных участков районов. Один запуск. Пишет tools/masterplan/live-colliders.json.
//   node tools/masterplan/probe-existing.mjs
import fs from 'node:fs';
import { openGame } from '../../tests/lib/harness.mjs';
const LATE = { saveVersion: 20, stageIndex: 16, money: 5e8, planks: 5000, concrete: 500, metal: 500, buildings: Array.from({ length: 16 }, (_, i) => ({ index: i, level: 5 })) };
const g = await openGame({ save: LATE, waitMs: 9000 });
const out = await g.page.evaluate(() => {
  const res = { colliders: [], plots: [], hubs: [], err: [] };
  try { for (const cfg of CITY_DISTRICTS) { res.hubs.push({ id: cfg.id, x: cfg.pos.x, z: cfg.pos.z }); for (let i = 0; i < LAND_PLOTS_PER_DISTRICT; i++) { const p = landPlotWorldPosition(cfg.id, i); res.plots.push({ d: cfg.id, i, x: +p.x.toFixed(2), z: +p.z.toFixed(2) }); } } } catch (e) { res.err.push(String(e)); }
  for (const e of __TYCOON_V83_COLLISIONS__.registry.values()) {
    const p = e.pos; if (!p) continue; const r = Math.hypot(p.x, p.z); if (r < 35) continue;
    res.colliders.push({ cat: e.category, label: String(e.label), shape: e.shape, x: +p.x.toFixed(2), z: +p.z.toFixed(2), r: e.shape === 'obb' ? undefined : +e.radius.toFixed(2), hx: e.hx && +e.hx.toFixed(2), hz: e.hz && +e.hz.toFixed(2), yaw: e.yaw && +e.yaw.toFixed(3), flags: e.flags && Object.keys(e.flags).filter((k) => e.flags[k]).join(',') });
  }
  return res;
});
fs.writeFileSync(new URL('./live-colliders.json', import.meta.url), JSON.stringify(out));
console.log('colliders', out.colliders.length, 'plots', out.plots.length, out.err);
await g.close?.();
process.exit(0);
