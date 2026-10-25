// Real-world audit of the interchanges, flyovers, bridges, ramps and footbridges of plan C (2026-10-25).
// Reads the COMPILED data (assets/plan-c-data-v161.js: what the player really drives / walks on), not the plan, and the plan for the horizontal geometry of the ramps.
// Frame: game metres (x east, z south), 1 game m along the road = 2.5 real m.  Grades are ratios and carry over unchanged; lengths and radii are multiplied by 2.5 for the norms;
// lateral dimensions are kept as built (they come from the real vehicles, not from the 2.5 scale).
// Every row: { node, item, value, norm, source, verdict, note }; verdict = 'OK' | 'ИСПРАВЛЕНО' | 'ДОПУЩЕНИЕ' (a documented deviation) | 'НАРУШЕНИЕ' (hard: fails the audit).
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SCALE = 2.5;
export function loadData() {
  const ctx = { window: {} }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'assets/plan-c-data-v161.js'), 'utf8'), ctx);
  return ctx.window.PlanCDataV161;
}

// ---- norms (real metres / km/h).  AASHTO "A Policy on Geometric Design of Highways and Streets" (Green Book) 7th ed. 2018; SP 34.13330.2021 "Avtomobilnye dorogi", SP 42.13330.2016, GOST R 52289-2019, GOST R 52398-2005,
// SP 59.13330.2020 (accessibility), SP 35.13330 (bridges).  Values below are typed from the tables (not fetched online in this sandbox): sources are cited per row.
const KCREST = { 20: 1, 30: 2, 40: 4, 50: 7, 60: 11, 70: 17, 80: 26, 90: 39, 100: 52 };   // Green Book Table 3-34 (stopping sight distance, crest vertical curves, K = m per %)
const KSAG = { 20: 3, 30: 6, 40: 9, 50: 13, 60: 18, 70: 23, 80: 30, 90: 38, 100: 45 };   // Table 3-36 (sag, headlight sight distance)
const FMAX = { 30: 0.28, 40: 0.23, 50: 0.19, 60: 0.17, 70: 0.15, 80: 0.14, 90: 0.13, 100: 0.12 };   // maximum side friction (Table 3-7 / 3-10)
const rMin = (v, e = 0.08) => v * v / (127 * (e + FMAX[v]));   // R = V^2 / (127 (e + f)) (Green Book eq. 3-8), real metres
const speedForRadius = (rReal, e = 0.08) => { let best = 0; for (const v of Object.keys(FMAX).map(Number)) if (rMin(v, e) <= rReal) best = v; return best; };

const R1 = (v) => Math.round(v * 10) / 10, R2 = (v) => Math.round(v * 100) / 100;
const arcLen = (p) => { const s = [0]; for (let i = 1; i < p.length; i++) s.push(s[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return s; };
const lerpAt = (s, y, v) => { let k = 1; while (k < s.length - 1 && s[k] < v) k++; const t = Math.max(0, Math.min(1, (v - s[k - 1]) / ((s[k] - s[k - 1]) || 1))); return y[k - 1] + (y[k] - y[k - 1]) * t; };

// grade (max over a window of W metres) and the smallest K of crest / sag curves along a profile [[x, z, h]]
export function profileStats(p, W = 6) {
  const s = arcLen(p), y = p.map((q) => q[2]), L = s[s.length - 1];
  let maxG = 0, maxAt = 0, kc = Infinity, ks = Infinity, kcAt = 0, ksAt = 0;
  for (let v = 0; v + W <= L + 1e-9; v += 1) { const g = Math.abs(100 * (lerpAt(s, y, v + W) - lerpAt(s, y, v)) / W); if (g > maxG) { maxG = g; maxAt = v; } }
  for (let v = W; v <= L - W + 1e-9; v += 1) {
    const g1 = 100 * (lerpAt(s, y, v) - lerpAt(s, y, v - W)) / W, g2 = 100 * (lerpAt(s, y, v + W) - lerpAt(s, y, v)) / W, d = g2 - g1;
    if (Math.abs(d) < 0.12) continue;   // noise floor of the 1 mm height rounding (a grade change under 0.5-1 % needs no curve anyway)
    const K = W / Math.abs(d) * SCALE;   // real m per %: the grade changes by d between the centres of two adjacent windows of W (= curvature x W), K = 1 / curvature
    if (d < 0 && K < kc) { kc = K; kcAt = v; } if (d > 0 && K < ks) { ks = K; ksAt = v; }
  }
  return { maxG, maxAt, kc, ks, kcAt, ksAt, L };
}
// smallest horizontal radius (game m) of a polyline, measured on 3 m chords
export function minRadius(p) {
  const s = arcLen(p); let m = Infinity, at = 0; const step = 3;
  const pt = (v) => [lerpAt(s, p.map((q) => q[0]), v), lerpAt(s, p.map((q) => q[1]), v)];
  for (let v = step; v < s[s.length - 1] - step; v += 1) {
    const a = pt(v - step), b = pt(v), c = pt(v + step), ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ac = Math.hypot(c[0] - a[0], c[1] - a[1]), cr = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (cr > 1e-9) { const r = ab * bc * ac / (2 * cr); if (r < m) { m = r; at = v; } }
  }
  return { r: m, at };
}
const kReq = (table, v) => { const ks = Object.keys(table).map(Number).sort((a, b) => a - b); if (v <= ks[0]) return table[ks[0]]; for (let i = 1; i < ks.length; i++) if (v <= ks[i]) { const t = (v - ks[i - 1]) / (ks[i] - ks[i - 1]); return table[ks[i - 1]] + (table[ks[i]] - table[ks[i - 1]]) * t; } return table[ks[ks.length - 1]]; };

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
export function runRealWorld(P, D) {
  const rows = [], add = (node, item, value, norm, source, verdict, note = '') => rows.push({ node, item, value, norm, source, verdict, note });
  const rib = D.struct.ribbons, byId = (id) => rib.filter((r) => r.id === id);
  const idOf = (r, i) => (r.id === 'M1' || /^FB/.test(r.id)) ? r.id : r.id + '#' + i;   // ribbons of one interchange share ids
  const isFB = (r) => /^FB/.test(r.id);
  const rampName = (ic, kind, idx) => `${ic}.${idx} (${kind})`;
  const ramps = D.graph.ramps.map(([ic, kind, pts], i) => ({ ic, kind, pts, name: `${ic}.${i % 8 === i && ic === 'I1' ? i : (ic === 'I4' ? i - 8 : i)}` }));
  // index of a ramp in its interchange
  ramps.forEach((r, i) => { r.name = r.ic + '.' + (r.ic === 'I1' ? i : i - ramps.filter((q) => q.ic === 'I1').length) + ' ' + r.kind; });

  // ---- 1. longitudinal grades ------------------------------------------------------------------------------------------------------------------------------
  const m1 = D.graph.levels.filter((l) => l.id === 'e208' || l.id === 'e209');
  const m1p = [...m1[0].p, ...m1[1].p.slice(1)];
  const gM1 = profileStats(m1p, 6);
  add('M1 над Главным пр. (I1)', 'продольный уклон эстакады (макс. на 15 м)', `${R2(gM1.maxG)} %`, '<= 5 % (расч. скорость 70 км/ч, городская скоростная дорога)', 'AASHTO GB Табл. 8-1 (freeways, 70 км/ч); СП 34.13330 табл. 5.2 (скоростные дороги <= 40-50 ‰)', gM1.maxG <= 5.05 ? 'OK' : 'НАРУШЕНИЕ', 'было 6.0 % при K около 12 реальных м; профиль заменён на параболические дуги + прямая 5 %');
  const rampRows = [];
  for (const r of ramps) {
    const st = profileStats(r.pts, 10);
    const rr = minRadius(r.pts), rReal = rr.r * SCALE, v = Math.max(30, Math.min(r.kind === 'outer' || r.kind === 'direct' ? 60 : 50, speedForRadius(rReal)));
    rampRows.push({ ...r, st, rr, v });
  }
  const lim = 7.0;
  for (const r of rampRows) add(r.name, 'продольный уклон съезда (макс. на 25 м)', `${R2(r.st.maxG)} %`, `<= ${lim} % (8 % предел)`, 'AASHTO GB 10.9.6 (съезды 50 км/ч: 7-9 %, 40 км/ч: 8-10 %); СП 34.13330 п.? (съезды <= 60-70 ‰)', r.st.maxG <= lim ? 'OK' : 'НАРУШЕНИЕ');

  // ---- 2. vertical curves ------------------------------------------------------------------------------------------------------------------------------------
  const vM1 = 70;
  add('M1 над Главным пр. (I1)', 'выпуклая вертикальная кривая, K (реальные м на %)', `${R1(gM1.kc)}`, `>= ${kReq(KCREST, vM1)} (70 км/ч)`, 'AASHTO GB Табл. 3-34', gM1.kc >= kReq(KCREST, vM1) ? 'OK' : 'НАРУШЕНИЕ', 'было K 12 (около 50 км/ч)');
  add('M1 над Главным пр. (I1)', 'вогнутая вертикальная кривая, K', `${R1(gM1.ks)}`, `>= ${kReq(KSAG, vM1)} (70 км/ч)`, 'AASHTO GB Табл. 3-36', gM1.ks >= kReq(KSAG, vM1) ? 'OK' : 'НАРУШЕНИЕ', 'было K 13');
  for (const r of rampRows) {
    const kc = kReq(KCREST, r.v), ks = kReq(KSAG, r.v);
    add(r.name, `вертикальные кривые K (выпуклая / вогнутая), расч. скорость ${r.v} км/ч по радиусу ${R1(r.rr.r * SCALE)} м`, `${isFinite(r.st.kc) ? R1(r.st.kc) : '-'} / ${isFinite(r.st.ks) ? R1(r.st.ks) : '-'}`, `>= ${R1(kc)} / ${R1(ks)}`, 'AASHTO GB Табл. 3-34 / 3-36', (r.st.kc >= kc * 0.97 && r.st.ks >= ks * 0.97) ? 'OK' : 'НАРУШЕНИЕ');
  }

  // ---- 3. horizontal radii ------------------------------------------------------------------------------------------------------------------------------------
  const bend = (P.bends || []).find((b) => b.R === 80), bendR = bend ? bend.R * SCALE : null;
  if (bendR) add('Поворот М1 -> М2', 'радиус оси', `${bendR} м`, `>= ${R1(rMin(70, 0.08))} м (70 км/ч, e 8 %); >= ${R1(rMin(70, 0.06))} м при e 6 %`, 'AASHTO GB ур. 3-8: R = V^2 / (127 (e + f))', bendR >= rMin(70, 0.06) ? 'OK' : 'НАРУШЕНИЕ', 'вираж в игре не моделируется (плоская проезжая часть): норма при e 6 % выполнена с запасом по f');
  for (const r of rampRows) add(r.name, 'наименьший радиус оси', `${R1(r.rr.r * SCALE)} м (игр. ${R1(r.rr.r)})`, `>= ${R1(rMin(30))} м (30 км/ч, предел для петли)`, 'AASHTO GB Табл. 3-10, 10.9.3 (петли R 30-60 м)', r.rr.r * SCALE >= rMin(30) ? 'OK' : 'НАРУШЕНИЕ', `расчётная скорость ${r.v} км/ч`);


  // ---- 4. footbridges: ramp grade, clearance, width --------------------------------------------------------------------------------------------------------
  for (const fb of rib.filter(isFB)) {
    const st = profileStats(fb.p, 4), top = Math.max(...fb.p.map((q) => q[2])), info = (D.struct.fb || []).find((f) => f.id === fb.id);
    let segMax = 0; for (let i = 1; i < fb.p.length; i++) segMax = Math.max(segMax, Math.abs(fb.p[i][2] - fb.p[i - 1][2]) / Math.hypot(fb.p[i][0] - fb.p[i - 1][0], fb.p[i][1] - fb.p[i - 1][1]) * 100);
    add(fb.id, 'уклон пандуса пешеходного моста (макс. по звену 1.5 м)', `${R2(segMax)} %`, '<= 8 % предельно, 5 % основной (проект <= 7.5 %)', 'СП 59.13330.2020 п. 6.1.? / СП 42.13330 (пешеходные пандусы 5 %, <= 8 %)', segMax <= 8.0 ? 'OK' : 'НАРУШЕНИЕ', 'было 40 % (лестница-пандус, настил на 5.1 м)');
    add(fb.id, 'габарит под настилом над проезжей частью', `${R2(info ? info.clear : top - 0.35)} игр. м = ${R2((info ? info.clear : top - 0.35) * SCALE)} м`, '>= 5.0 м (СП 34.13330 / ГОСТ Р 52289: габарит приближения 5.0 м)', 'ГОСТ Р 52289-2019, СП 34.13330 п. 5.? ; AASHTO GB 10.4: 4.9 м min, 5.2 м желательно', (info ? info.clear : top - 0.35) * SCALE >= 5.0 ? 'OK' : 'НАРУШЕНИЕ', `настил на ${R2(top)} игр. м (было 5.1), балка 0.35`);
    add(fb.id, 'ширина прохода (ленты настила)', `${fb.w} игр. м = ${R2(fb.w * SCALE)} м`, '>= 2.0 м (1.5 м минимум на одну сторону, СП 59)', 'СП 59.13330 п. 6.1.2', fb.w * SCALE >= 2.0 ? 'OK' : 'НАРУШЕНИЕ');
    if (info) add(fb.id, 'схема пандусов', info.sides.map((q) => `${q.fold ? 'с разворотом' : 'прямой'} ${R2(q.g * 100)} %`).join(' / '), 'пандус не заходит на соседнюю улицу', 'СП 59.13330 (площадки поворота)', 'OK', 'прямой пандус, где хватает места до следующей улицы (+0.8 м); иначе марш - круглая площадка R 2.6 - марш (серпантин)');
  }
  // ---- 5. clearance under every elevated deck (the Plan C runtime treats the lowest surface above a point as a ceiling) ----------------------------------------------------
  // a ground point counts as a corridor (people / vehicles are under the deck) on a street with its sidewalks, on a motorway with its shoulders, on a ramp that is still on the ground
  const nodeById = new Map(P.nodes.map((n) => [n.id, n])), hwOf = (e) => P.classes ? 0 : 0;
  const CLSW = { motorway: [12.6, 0], arterial: [9.2, 1.8], collector: [4.4, 1.4], local: [4.0, 1.2], service: [4.0, 0], ramp: [2.8, 0] };
  const corridor = (x, z) => {
    for (const e of P.edges) {
      const a = nodeById.get(e.a), b = nodeById.get(e.b), dx = b.x - a.x, dz = b.z - a.z, ll = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / ll)), d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t), [w, sw] = CLSW[e.cls];
      if (d <= w / 2 + sw + 0.1) return true;
    }
    for (const [, , pts] of D.graph.ramps) for (let i = 1; i < pts.length; i++) { if (Math.max(pts[i][2], pts[i - 1][2]) > 0.4) continue; const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], ll = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / ll)); if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) <= 1.5) return true; }
    return false;
  };
  const THICK = (r) => isFB(r) ? 0.35 : 0.8, worst = new Map();
  rib.forEach((r, i) => {
    const name = idOf(r, i), T = THICK(r); let minClear = Infinity, atS = null, under = null;
    const pts = r.p;
    for (let k = 0; k < pts.length; k++) {
      const [x, z, h] = pts[k]; if (h < 0.9) continue;
      const a = pts[Math.max(0, k - 1)], b = pts[Math.min(pts.length - 1, k + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      for (const off of [-0.7, 0, 0.7]) {
        const qx = x - dz / l * off * r.w / 2, qz = z + dx / l * off * r.w / 2, S = D.surfaces(qx, qz);
        for (const s of S) { if (s > h - 1.2) continue; if (s < 0.3 && !corridor(qx, qz)) continue; const c = h - T - s; if (c < minClear) { minClear = c; atS = [qx, qz, h]; under = s; } }
      }
    }
    worst.set(name, { minClear, atS, under });
  });
  const need = 2.0;   // 5.0 m real
  for (const [name, w] of worst) {
    if (!isFinite(w.minClear)) continue;
    add(name, 'подмостовой габарит над нижним уровнем (минимум по всей ленте)', `${R2(w.minClear)} игр. м = ${R1(w.minClear * SCALE)} м (под ${R2(w.under)}; ${w.atS.slice(0, 2).map(R1)})`, '>= 5.0 м (2.0 игр. м)', 'ГОСТ Р 52289-2019, СП 34.13330 п. 5.? (5.0 м над проезжей частью); AASHTO GB 10.4', w.minClear >= need ? 'OK' : 'НАРУШЕНИЕ');
  }
  // rail embankment openings: roads 4.5 game, pedestrian passages 2.8 game
  for (const [x, half, clear] of D.struct.openings) {
    const ped = half < 2.5;
    add(ped ? `Переход под путями x ${x}` : `Проезд под ж/д насыпью x ${x}`, 'высота проёма / ширина', `${clear} игр. м = ${R1(clear * SCALE)} м / ${R1(half * 2)} игр. м`, ped ? '>= 2.5 м (пешеходный тоннель), 2.2 м = ГОСТ 33150' : '>= 5.0 м габарит; над ж/д 6.0-6.5 м (ГОСТ 9238) - сверху насыпь, не настил над путями', ped ? 'ГОСТ 33150-2014 п. 5.? ; СП 59' : 'ГОСТ Р 52289-2019; СП 34.13330', clear * SCALE >= (ped ? 2.5 : 5.0) ? 'OK' : 'НАРУШЕНИЕ');
  }


  // ---- 6. barriers (parapets) along every deck higher than 1.2 m, both sides ------------------------------------------------------------------------------------
  const rails = D.struct.rails, segD = (x, z, a) => { const dx = a[2] - a[0], dz = a[3] - a[1], ll = dx * dx + dz * dz, t = ll ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / ll)) : 0; return Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t); };
  const railNear = (x, z, h) => rails.some((a) => Math.abs(a[4] - h) < 1.2 && segD(x, z, a) < 0.55);
  const barrierRows = [];
  rib.forEach((r, i) => {
    const name = idOf(r, i), off = isFB(r) ? 1.25 : r.w / 2 + 0.15; let n = 0, miss = 0, firstMiss = null;
    const s = arcLen(r.p), L = s[s.length - 1];
    for (let v = 0; v <= L; v += 1.5) {
      const x = lerpAt(s, r.p.map((q) => q[0]), v), z = lerpAt(s, r.p.map((q) => q[1]), v), h = lerpAt(s, r.p.map((q) => q[2]), v); if (h < 1.3) continue;
      const a = [lerpAt(s, r.p.map((q) => q[0]), Math.max(0, v - 1)), lerpAt(s, r.p.map((q) => q[1]), Math.max(0, v - 1))], b = [lerpAt(s, r.p.map((q) => q[0]), Math.min(L, v + 1)), lerpAt(s, r.p.map((q) => q[1]), Math.min(L, v + 1))];
      const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
      for (const sg of [-1, 1]) {
        const qx = x - dz / l * sg * off, qz = z + dx / l * sg * off; n++;
        // the side is open only where another carriageway of the same height continues beside it (a slip lane running along the deck)
        const beside = [0, 0.5, 1.2, 2.4].some((o) => D.surfaces(x - dz / l * sg * (off + o), z + dx / l * sg * (off + o)).some((y) => Math.abs(y - h) < 0.5));
        if (!railNear(qx, qz, h) && !(beside && rails.some((a) => Math.abs(a[4] - h) < 1.2 && segD(qx, qz, a) < 3.2))) { miss++; if (!firstMiss) firstMiss = [R1(qx), R1(qz), R2(h)]; }
      }
    }
    if (n) barrierRows.push({ name, n, miss, firstMiss });
  });
  for (const b of barrierRows) add(b.name, 'ограждение (парапет) с обеих сторон на высоте > 1.3 м', `${b.n - b.miss} из ${b.n} проб (${b.miss ? 'нет у ' + b.firstMiss.join(', ') : 'сплошное'})`, 'сплошное ограждение на эстакаде / мосту (удерживающее, высота >= 0.8 м)', 'ГОСТ 33128-2014 (ограждения дорожные), СП 35.13330 п. 6.? ; AASHTO GB 10.? / 4.? (bridge rail)', b.miss === 0 ? 'OK' : 'НАРУШЕНИЕ');

  // ---- 7. earth slopes ------------------------------------------------------------------------------------------------------------------------------------------
  {
    const sl = D.palette.slope; let tot = 0, steep = 0, minRatio = Infinity;
    for (const c of Object.values(D.cells)) { const v = c.d && c.d.v; if (!v) continue; for (let i = 0; i + 9 < v.length; i += 10) { if (v[i + 9] !== sl) continue;
      const u = [v[i + 3] - v[i], v[i + 4] - v[i + 1], v[i + 5] - v[i + 2]], w = [v[i + 6] - v[i], v[i + 7] - v[i + 1], v[i + 8] - v[i + 2]], nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0], L = Math.hypot(nx, ny, nz);
      if (L < 1e-6 || Math.abs(ny) / L < 0.05) continue;   // vertical end caps of a bank are not slopes
      const ratio = Math.abs(ny) / Math.hypot(nx, nz); tot += L / 2; if (ratio < 1.5 - 1e-3) steep += L / 2; minRatio = Math.min(minRatio, ratio); } }
    add('Насыпи съездов и эстакад', 'крутизна травяных откосов (заложение H:V)', `min 1:${R2(minRatio)}; круче 1:1.5 - ${R1(steep)} из ${R1(tot)} м2`, '>= 1:1.5 (насыпь до 6 м), круче - подпорная стенка', 'СП 34.13330.2021 п. 7.? (откосы насыпей 1:1.5 до 6 м); AASHTO GB 4.? (откосы 1:2 желательно, 1:1.5 за ограждением)', steep < 1 ? 'OK' : 'НАРУШЕНИЕ', 'было 26 % площади круче 1:1.5 (до 1:1.25); теперь круче - бетонная стенка');
    // retaining walls: height <= deck
    let maxW = 0; for (const c of Object.values(D.cells)) { const q = c.d && c.d.s; if (!q) continue; for (let i = 0; i + 8 < q.length; i += 9) if (q[i + 8] === D.palette.wall) maxW = Math.max(maxW, q[i + 5], q[i + 7]); }
    add('Подпорные стенки съездов', 'наибольшая высота стенки', `${R2(maxW)} игр. м`, '<= высоты настила (5.3), стенка не выше проезжей части', 'AASHTO GB 4.? / СП 35.13330', maxW <= 5.31 ? 'OK' : 'НАРУШЕНИЕ');
  }

  // ---- 8. no steps in the profile of one road; heights agree where roads join ---------------------------------------------------------------------------------------
  {
    let worstStep = 0, worstId = '';
    const check1 = (id, p) => { for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) || 1e-3, g = Math.abs(p[i][2] - p[i - 1][2]) / d - 0.0 ; if (Math.abs(p[i][2] - p[i - 1][2]) > 0.02 + 0.075 * d && Math.abs(p[i][2] - p[i - 1][2]) > worstStep) { worstStep = Math.abs(p[i][2] - p[i - 1][2]); worstId = id + '@' + p[i].slice(0, 2).map(R1); } void g; } };
    for (const l of D.graph.levels) check1(l.id, l.p); for (const r of D.graph.ramps) check1(r[0] + '.' + r[1], r[2]); for (const r of rib) check1(r.id, r.p);
    add('Все дороги и настилы', 'ступень уровня между соседними точками одной дороги (сверх уклона 7.5 %)', `${worstStep ? R2(worstStep) + ' м у ' + worstId : 'нет'}`, 'профиль непрерывный, без ступеней', 'СП 34.13330 п. 5.? (профиль без изломов), здравый смысл', worstStep < 0.001 ? 'OK' : 'НАРУШЕНИЕ');
    // ramps end flush with the host
    let worstJoin = 0, wj = '';
    for (const [ic, kind, pts] of D.graph.ramps) for (const q of [pts[0], pts[pts.length - 1]]) {
      const S = D.surfaces(q[0], q[1]); const hs = S.filter((y) => Math.abs(y - q[2]) < 1.5); const d = hs.length ? Math.min(...hs.map((y) => Math.abs(y - q[2]))) : 9;
      // surfaces() returns the ribbon of the ramp itself too: look at the other levels (ground / M1 deck / host street) beside the end
      const others = D.graph.levels.map((l) => { let best = 9, h = null; for (let i = 1; i < l.p.length; i++) { const a = l.p[i - 1], b = l.p[i], dx = b[0] - a[0], dz = b[1] - a[1], ll = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / ll)), dd = Math.hypot(q[0] - a[0] - dx * t, q[1] - a[1] - dz * t); if (dd < best) { best = dd; h = a[2] + (b[2] - a[2]) * t; } } return best <= l.w / 2 + 0.2 ? h : null; }).filter((h) => h != null);
      const j = others.length ? Math.min(...others.map((h) => Math.abs(h - q[2]))) : 9; if (j < 9 && j > worstJoin) { worstJoin = j; wj = `${ic}.${kind} ${q.slice(0, 2).map(R1)}`; } void d;
    }
    add('Концы всех съездов', 'разность высот съезда и дороги, к которой он примыкает', `${R2(worstJoin)} м${wj ? ' (' + wj + ')' : ''}`, '<= 0.03 м (вровень)', 'отсутствие ступени на стыке (требование владельца, "уровень не должен быть разным на одной дороге")', worstJoin <= 0.03 ? 'OK' : 'НАРУШЕНИЕ');
  }

  return { rows, rampRows, m1p, gM1 };
}
