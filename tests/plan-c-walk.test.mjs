// Plan C, real-world audit part 2 (2026-10-25): the player climbs EVERY deck on foot and comes back down.  node tests/plan-c-walk.test.mjs   (SHOTS_DIR=dir writes phone shots)
//   offline : the access graph of tools/masterplan/real-world-checks.mjs (every ribbon reachable from the ground, 0.5 m steps of the game's own access / surfaceY)
//   launch  : fresh game, layout C.  For EVERY ribbon of PlanCDataV161.struct.ribbons (M1 deck, 4 + 4 ramps of the cloverleaf, the two pieces of the trumpet loop, semi-direct + direct ramps,
//             footbridges FB1 FB3 FB4 FB5 FB6): the real joystick vector (camera basis) through the real updatePlayer, at 1/30 s per frame, from up to 8 approach directions at the ground end,
//             up the whole centre line to the far end (or onto the deck of the ribbon it joins) and back down to the ground.  Per run: time, top reached, max |dy| per frame (<= 3 cm), longest standstill
//             (<= 0.5 s), distance of the player's height to the ribbon's height (a fall through the deck / a float), the game's own camera resolver every ~12 m: no drawn deck / wall mesh between
//             the player's head and the camera, camera never closer than 1.2 m.
import fs from 'node:fs';
import path from 'node:path';
import { openGame, check } from './lib/harness.mjs';
import { loadData, accessRows } from '../tools/masterplan/real-world-checks.mjs';

const J = JSON.stringify, R2 = (v) => Math.round(v * 100) / 100;
const SHOTS = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : null; if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

// ---- offline: the access graph ----
{
  const D = loadData(), { rows, info } = accessRows(D);
  check(info.length >= 17 && rows.every((r) => r.verdict === 'OK'), `offline: ${info.length} ribbons, every one reachable from the ground with a continuous centre line (${J(rows.filter((r) => r.verdict !== 'OK').map((r) => r.node))})`);
}

const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
const ev = (fn, arg) => g.page.evaluate(fn, arg);
const ribbons = await ev(() => PlanCDataV161.struct.ribbons.map((r, i) => ({ i, id: r.id, w: r.w, p: r.p })));
check(ribbons.length >= 17, `${ribbons.length} ribbons in the data`);

const results = [];
for (const rb of ribbons) {
  const res = await g.page.evaluate(({ rb }) => {
    const D = PlanCDataV161, P = rb.p, last = P.length - 1;
    const gEnds = [0, last].filter((k) => Math.abs(P[k][2]) < 0.06);
    const out = { id: rb.id, i: rb.i, runs: [], top: Math.max(...P.map((q) => q[2])) };
    if (!gEnds.length) { out.err = 'no ground end'; return out; }
    const hAt = (x, z) => { let best = 1e9, h = 0; for (let k = 0; k + 1 < P.length; k++) { const a = P[k], b = P[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = dx * dx + dz * dz, t = l ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l)) : 0, d = Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); if (d < best) { best = d; h = a[2] + (b[2] - a[2]) * t; } } return { d: best, h }; };
    let rec;
    const frame = (tx, tz) => {   // one joystick frame towards (tx, tz) with the real controls
      const dx = tx - player.position.x, dz = tz - player.position.z, l = Math.hypot(dx, dz) || 1;
      camera.getWorldDirection(camForward); camForward.y = 0; camForward.normalize(); camRight.crossVectors(camForward, worldUp).normalize();
      joyVec.z = dx / l * camForward.x + dz / l * camForward.z; joyVec.x = dx / l * camRight.x + dz / l * camRight.z;
      const px = player.position.x, pz = player.position.z, py = player.position.y; updatePlayer(1 / 30);
      const moved = Math.hypot(player.position.x - px, player.position.z - pz), dy = Math.abs(player.position.y - py);
      rec.frames++; rec.still = moved < 0.02 ? rec.still + 1 : 0; rec.maxStill = Math.max(rec.maxStill, rec.still); rec.maxDy = Math.max(rec.maxDy, dy); rec.maxY = Math.max(rec.maxY, player.position.y);
      rec.dist += moved;
      if (rb.id !== 'M1' || true) { const t = hAt(player.position.x, player.position.z); if (t.d < rb.w / 2 - 0.2) { const off = Math.abs(player.position.y - t.h); rec.maxOff = Math.max(rec.maxOff, off); } }
    };
    const camProbe = (rec2) => {   // the game's own obstruction resolver, camera behind the walking direction (6.5 m back, 4.5 m up), as the follow camera sits
      const x = player.position.x, y = player.position.y, z = player.position.z, fx = rec2.fx, fz = rec2.fz;
      camera.position.set(x - fx * 6.5, y + 4.5, z - fz * 6.5); controls.target.set(x, y + 1, z); camera.lookAt(controls.target);
      for (let k = 0; k < 6; k++) resolveCameraObstructionV85(1 / 30);
      const head = new THREE.Vector3(x, y + 1.4, z), d = camera.position.distanceTo(head), dir = camera.position.clone().sub(head).normalize();
      const rc = new THREE.Raycaster(head, dir, 0.05, Math.max(0.06, d - 0.05)), meshes = []; PlanCV161.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.visible) meshes.push(o); });
      const hit = rc.intersectObjects(meshes, false)[0]; rec.cam++;
      if (hit) { rec.camHits++; if (rec.camRows.length < 3) rec.camRows.push([R2(x), R2(z), R2(y), R2(hit.distance), R2(d), hit.object.name]); }
      if (d < 1.2) rec.camClose++;
    };
    const R2 = (v) => Math.round(v * 100) / 100;
    const walkTo = (tx, tz, maxFrames, tol, probe) => {
      let n = 0, nextProbe = 0;
      while (n++ < maxFrames && Math.hypot(player.position.x - tx, player.position.z - tz) > tol) {
        const dx = tx - player.position.x, dz = tz - player.position.z, l = Math.hypot(dx, dz) || 1; frame(tx, tz);
        if (probe && rec.dist >= nextProbe) { nextProbe = rec.dist + 12; camProbe({ fx: dx / l, fz: dz / l }); }
      }
      return n < maxFrames;
    };
    for (const ge of gEnds) {
      const A = P[ge], far = ge === 0 ? last : 0, B = P[far], o = P[ge === 0 ? 1 : last - 1];
      let ux = A[0] - o[0], uz = A[1] - o[1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
      // up to 8 approach directions around the ground end (outward first)
      const dirs = [];
      for (let k = 0; k < 8; k++) { const a = Math.atan2(uz, ux) + k * Math.PI / 4, S = [A[0] + Math.cos(a) * 4.5, A[1] + Math.sin(a) * 4.5]; if (rb.p.some((q) => q[2] > 0.8 && Math.hypot(q[0] - S[0], q[1] - S[1]) < 1.8)) continue; PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(S[0], S[1]); if (!D.access(S[0], S[1], 0.6, 0)) continue; dirs.push([k, S]); }
      for (const [k, S] of dirs) {
        if (!(k === 0 || k === 2 || k === 4 || k === 6) && rb.id === 'M1') continue;   // the long deck: 4 directions are enough
        PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(A[0], A[1]); player.position.set(S[0], 0, S[1]); playerVelocity.set(0, 0, 0); PlanCV161.level = 0;
        for (let q = 0; q < 3; q++) updatePlayer(1 / 30);
        rec = { frames: 0, still: 0, maxStill: 0, maxDy: 0, maxY: 0, maxOff: 0, dist: 0, cam: 0, camHits: 0, camClose: 0, camRows: [] };
        let ok = walkTo(A[0], A[1], 400, 0.9, false);
        rec.still = 0; rec.maxStill = 0;   // the approach over open ground is not the subject
        // up: every 2nd vertex (the 1.5-3 m spacing of the data is finer than the joystick needs), always the far end
        const idx = []; if (ge === 0) { for (let q = 1; q < P.length; q += 2) idx.push(q); idx.push(last); } else { for (let q = last - 1; q >= 0; q -= 2) idx.push(q); idx.push(0); }
        const up0 = rec.frames;
        for (const q of idx) { ok = walkTo(P[q][0], P[q][1], 600, 0.7, true) && ok; if (!ok) break; }
        const upFrames = rec.frames - up0, yTop = player.position.y, topY = rec.maxY;
        // down: back along the same line to the ground end and 3 m beyond
        const back = idx.slice().reverse().slice(1).concat([ge]);
        for (const q of back) { ok = walkTo(P[q][0], P[q][1], 600, 0.7, true) && ok; if (!ok) break; }
        ok = walkTo(S[0], S[1], 400, 1.0, false) && ok;
        joyVec.x = joyVec.z = 0;
        out.runs.push({ ge, k, ok, upSec: R2(upFrames / 30), topY: R2(topY), yEnd: R2(yTop), yBack: R2(player.position.y), maxDy: R2(rec.maxDy), maxStill: rec.maxStill, maxOff: R2(rec.maxOff), cam: rec.cam, camHits: rec.camHits, camClose: rec.camClose, camRows: rec.camRows, dist: R2(rec.dist) });
      }
    }
    return out;
  }, { rb });
  results.push(res);
  console.log('walked', res.id, '#' + res.i, 'runs', res.runs?.length, 'top', res.top, res.err || '');
}

const flat = results.flatMap((r) => (r.runs || []).map((q) => ({ id: r.id + '#' + r.i, top: r.top, ...q })));
const bad = (f) => flat.filter(f).map((q) => [q.id, q.ge, q.k, q.maxDy, q.maxStill, q.maxOff, q.topY, q.yBack, q.camHits]);
check(results.every((r) => !r.err && r.runs.length >= 1), `every ribbon was entered from the ground (${results.map((r) => r.id + '#' + r.i + ':' + (r.runs || []).length).join(' ')})`);
check(flat.length >= 40 && flat.every((q) => q.ok), `all ${flat.length} runs (ground end -> far end -> back) arrived (${J(bad((q) => !q.ok).slice(0, 5))})`);
check(flat.every((q) => q.topY >= q.top - 0.35 && q.yBack < 0.15), `every run climbs to the top of its deck (>= top - 0.35) and ends on the ground again (${J(bad((q) => !(q.topY >= q.top - 0.35 && q.yBack < 0.15)).slice(0, 5))})`);
check(flat.every((q) => q.maxDy <= 0.03 + 1e-6), `no jump in the player's height per 1/30 s frame above 3 cm (worst ${Math.max(...flat.map((q) => q.maxDy))}; ${J(bad((q) => q.maxDy > 0.03).slice(0, 5))})`);
check(flat.every((q) => q.maxStill <= 15), `no standstill longer than 0.5 s while walking along the deck (worst ${Math.max(...flat.map((q) => q.maxStill))} frames; ${J(bad((q) => q.maxStill > 15).slice(0, 5))})`);
check(flat.every((q) => q.maxOff <= 0.15), `the player's height stays within 15 cm of the deck under him: no fall through, no float (worst ${Math.max(...flat.map((q) => q.maxOff))})`);
check(flat.every((q) => q.camHits === 0 && q.camClose === 0), `the follow camera (the game's own resolver, ${flat.reduce((s, q) => s + q.cam, 0)} probes) has no drawn deck / wall between it and the head and is never closer than 1.2 m (${J(flat.filter((q) => q.camHits || q.camClose).slice(0, 4).map((q) => [q.id, q.camHits, q.camClose, q.camRows]))})`);
console.log('SUMMARY', J(results.map((r) => ({ id: r.id + '#' + r.i, top: r.top, runs: r.runs.length, upSec: r.runs.map((q) => q.upSec), dist: r.runs[0]?.dist }))));
check(g.errors.length === 0, `console clean (${J(g.errors.slice(0, 3))})`);
await g.close();
