// Material audit of the plan-C meshes in the live game: side / transparency / depth flags (a single-sided or transparent material would show walls see-through).  node tools/probe-sides-plan-c.mjs
import { openGame } from '../tests/lib/harness.mjs';
const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
const r = await g.page.evaluate(() => {
  PlanCV161.R_BUILD = 400; PlanCV161.ensureNear(0, -240);
  const out = {}; let n = 0;
  scene.traverse((o) => { if (!o.isMesh || !/^planC/.test(o.name)) return; n++; const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) { const k = o.name.replace(/_.*/, '') + ' side=' + m.side + ' transp=' + m.transparent + ' op=' + m.opacity + ' dw=' + m.depthWrite + ' dt=' + m.depthTest + ' alphaTest=' + m.alphaTest + ' po=' + m.polygonOffset + '/' + m.polygonOffsetFactor + '/' + m.polygonOffsetUnits + ' ro=' + o.renderOrder + ' cs=' + o.castShadow + ' fc=' + o.frustumCulled; out[k] = (out[k] || 0) + 1; } });
  return { n, out, near: camera.near, far: camera.far };
});
console.log(JSON.stringify(r, null, 1)); await g.browser?.close?.(); process.exit(0);
