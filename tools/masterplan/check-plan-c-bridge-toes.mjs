// Independent geometry check for C1c: inspect the shipped data, not the compiler's
// own height function. Run after compile-plan-c.mjs and before browser acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL('../../assets/plan-c-data-v161.js', import.meta.url), 'utf8'), ctx);
const D = ctx.window.PlanCDataV161;
const bridges = D.struct.ribbons.filter((r) => /^FB/.test(r.id));
assert.equal(bridges.length, 5, 'all five built pedestrian bridges must be checked');
for (const bridge of bridges) {
  for (const [label, i, j] of [['start', 0, 1], ['end', bridge.p.length - 1, bridge.p.length - 2]]) {
    const p = bridge.p[i], q = bridge.p[j];
    assert.ok(Math.abs(p[2]) <= 0.01, `${bridge.id} ${label} ends ${p[2]} m above ground`);
    assert.ok(D.ground(p[0], p[1]), `${bridge.id} ${label} has no land at the ramp toe`);
    const len = Math.hypot(p[0] - q[0], p[1] - q[1]);
    const outside = [p[0] + (p[0] - q[0]) / len, p[1] + (p[1] - q[1]) / len];
    assert.ok(D.access(...outside), `${bridge.id} ${label} has no accessible ground approach`);
    // Verify the actual rendered triangles at the seam. Their y values must match
    // the collision ribbon so a data-only fix cannot leave a visible floating lip.
    let drawn = false;
    for (const cell of Object.values(D.cells)) {
      const a = cell.d?.v || [];
      for (let k = 0; k < a.length; k += 10) {
        if (a[k + 9] !== D.palette.conc) continue;
        for (let v = 0; v < 3; v++) {
          const n = k + v * 3;
          if (Math.hypot(a[n] - p[0], a[n + 2] - p[1]) <= 1.21 && Math.abs(a[n + 1] - p[2]) <= 0.01) drawn = true;
        }
      }
    }
    assert.ok(drawn, `${bridge.id} ${label} has no ground-level drawn deck`);
  }
  for (let i = 1; i < bridge.p.length; i++) {
    const a = bridge.p[i - 1], b = bridge.p[i];
    const grade = Math.abs(b[2] - a[2]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert.ok(grade <= 0.08 + 1e-6, `${bridge.id} ramp grade ${grade} > 8 % (SP 59.13330)`);
  }
  console.log(`PASS ${bridge.id}: both toes meet drawn, accessible ground; ramp grade <= 8 %`);
}
