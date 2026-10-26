// Part 3 of the real-world audit (2026-10-25): road markings (GOST R 51256-2018 / GOST R 52289-2019), kerbs and edges, lighting (SP 52.13330) on the whole network of plan C,
// measured on the COMPILED data through the plan-view raster (tools/masterplan/raster-plan-c.mjs).  Rows like real-world-checks.mjs: { node, item, value, norm, source, verdict, note }.
import { CLS } from './plan-c.mjs';
import { makeRaster } from './raster-plan-c.mjs';

const R1 = (v) => Math.round(v * 10) / 10;
export function runMarkings(P, D) {
  const rows = [], add = (node, item, value, norm, source, verdict, note = '') => rows.push({ node, item, value, norm, source, verdict, note });
  const R = makeRaster(D, 0.1), K = makeRaster(D, 0.2);   // 0.1 m for the thin paint, 0.2 m for kerbs / asphalt
  const N = new Map(P.nodes.map((n) => [n.id, n])), hw = (c) => CLS[c].w / 2;
  const paintNear = (x, z, r = 0.15) => R.near('paint', x, z, r) || R.near('yellow', x, z, r);
  const rampEnds = []; for (const [, , pts] of D.graph.ramps) rampEnds.push(pts[0], pts[pts.length - 1]);
  const nearRampEnd = (x, z, d) => rampEnds.some((p) => Math.hypot(p[0] - x, p[1] - z) < d);

  // ---- A. junction approaches --------------------------------------------------------------------------------------------------------------------------
  const miss = { stop: [], zebra: [], yield: [], ring: [] }; let nStop = 0, nZebra = 0, nYield = 0, nRing = 0;
  for (const j of P.junctions) for (const a of j.arms) {
    if (a.cls === 'ramp2' || a.cls.startsWith('motorway')) continue;   // diamond mouths / the at-grade crossing I2 draw their own (5b)
    const cross = j.arms.filter((x) => (x.dir[0] !== 0) !== (a.dir[0] !== 0)).map((x) => hw(x.cls)), ch = cross.length ? Math.max(...cross) : 0, r = [a.dir[1], -a.dir[0]], w = hw(a.cls);
    const outside = (dist) => { const x = j.at[0] + a.dir[0] * dist, z = j.at[1] + a.dir[1] * dist; return x < -299 || x > 299 || z < -371 || z > 261; };   // beyond the drawn map (the P+R / turnaround stubs end in the extension)
    const across = (dist, depth, test) => (outside(dist + depth) ? true : (() => { for (let d = -depth; d <= depth + 1e-9; d += 0.15) for (let l = -w + 0.3; l <= w - 0.3; l += 0.3) if (test(j.at[0] + a.dir[0] * (dist + d) + r[0] * l, j.at[1] + a.dir[1] * (dist + d) + r[1] * l)) return true; return false; })());
    const along = (j.type === 'signal' ? Math.max(ch, j.boxZ && a.dir[0] !== 0 ? j.boxZ : 0) : ch) + 2.2;
    if (j.type === 'signal') {
      nStop++; if (!across(along + 1.7, 0.5, (x, z) => R.near('paint', x, z, 0.25))) miss.stop.push(`${j.id} ${j.at} ${a.cls} ${a.dir}`);
      // 2026-10-25: ground zebras are removed for now (owner), the check is off until they return
      if (false) nZebra++; if (false && !across(along, 0.9, (x, z) => R.near('paint', x, z, 0.12))) miss.zebra.push(`${j.id} ${j.at} ${a.cls} ${a.dir}`);
    } else if ((j.type === 'priority' || j.type === 'riro') && !(j.major && a.cls === j.major)) {
      nYield++; if (!across(ch + 1.0, 0.6, (x, z) => R.near('paint', x, z, 0.2))) miss.yield.push(`${j.id} ${j.at} ${a.cls} ${a.dir}`);
    } else if (j.type === 'roundabout') {
      nRing++; if (!across(j.R + 0.9, 0.5, (x, z) => R.near('paint', x, z, 0.2))) miss.ring.push(`${j.id} ${j.at} ${a.cls} ${a.dir}`);
    }
  }
  const sh = (a) => a.slice(0, 4).join('; ') + (a.length > 4 ? ` ... (+${a.length - 4})` : '');
  add('Все светофорные перекрёстки', 'стоп-линия 1.12 на каждом подходе', `${nStop - miss.stop.length} из ${nStop}${miss.stop.length ? ' (нет: ' + sh(miss.stop) + ')' : ''}`, 'стоп-линия перед светофором на каждой полосе подхода', 'ГОСТ Р 51256-2018 п. 5.1.? (линия 1.12), ГОСТ Р 52289-2019 п. 5.? ', miss.stop.length ? 'НАРУШЕНИЕ' : 'OK', 'было: местные улицы и служебные проезды без стоп-линии');
  add('Все светофорные перекрёстки', 'пешеходный переход 1.14.1 (зебра) на каждом подходе', `${nZebra - miss.zebra.length} из ${nZebra} (наземные переходы убраны до переработки)${miss.zebra.length ? ' (нет: ' + sh(miss.zebra) + ')' : ''}`, 'зебра у каждого подхода регулируемого перекрёстка', 'ГОСТ Р 51256-2018 п. 5.1.? (1.14.1), СП 42.13330 п. 11.? ', miss.zebra.length ? 'НАРУШЕНИЕ' : 'OK');
  add('Перекрёстки с главной дорогой / RIRO', 'линия 1.13 «уступи дорогу» на каждом второстепенном подходе', `${nYield - miss.yield.length} из ${nYield}${miss.yield.length ? ' (нет: ' + sh(miss.yield) + ')' : ''}`, 'линия 1.13 (треугольники) перед знаком 2.4', 'ГОСТ Р 51256-2018 п. 5.1.? (1.13)', miss.yield.length ? 'НАРУШЕНИЕ' : 'OK', 'было: 61 из 218 подходов');
  add('Кольца', 'линия 1.13 у въезда на кольцо', `${nRing - miss.ring.length} из ${nRing}${miss.ring.length ? ' (нет: ' + sh(miss.ring) + ')' : ''}`, 'въезд на кольцо - «уступи дорогу» (знак 4.3 + линия 1.13)', 'ГОСТ Р 51256-2018 (1.13), ПДД п. 13.11', miss.ring.length ? 'НАРУШЕНИЕ' : 'OK');

  // ---- B. continuity of lines along the straight roads ----------------------------------------------------------------------------------------------------
  const lineRows = [];
  for (const e of P.edges) {
    if (e.split) continue; const cl = CLS[e.cls], a = N.get(e.a), b = N.get(e.b), L = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / L, dz = (b.z - a.z) / L, nx = -dz, nz = dx;
    let lines = [], maxGap = 6;
    if (e.cls === 'arterial') lines = [[-(cl.median / 2 + cl.lane), 'полосная 1.5'], [cl.median / 2 + cl.lane, 'полосная 1.5']];
    else if (e.cls === 'collector') lines = [[0, 'осевая 1.5']];
    else if (e.cls === 'motorway' && e.ref === 'M1') { lines = [[-(cl.median / 2 + 0.3), 'разделительная 1.2.1'], [cl.median / 2 + 0.3, 'разделительная 1.2.1'], [-(cl.w / 2 - 0.2), 'краевая 1.2.1'], [cl.w / 2 - 0.2, 'краевая 1.2.1']]; }
    for (const [lat, name] of lines) {
      const lo = e.cls === 'motorway' ? 0 : 12, from = e.cls === 'motorway' ? 0 : lo; const gaps = []; let run = 0, st = 0;
      for (let s = from; s <= L - from; s += 0.5) {
        const x = a.x + dx * s + nx * lat, z = a.z + dz * s + nz * lat;
        if (e.cls === 'motorway' && (Math.abs(x - 0) < 0 || x < -165 || x > 165)) { run = 0; continue; }   // M1: the city part only (the bend and the rural ends are drawn by the bend / zone code)
        const inWedge = nearRampEnd(x, z, 24) || [a, b].some((q) => q.kind === 'roundabout' && Math.hypot(q.x - x, q.z - z) < 22);   // roundabout approach: the splitter island owns the lines (the zebra no longer bridges the gap, 2026-10-25)
        if (paintNear(x, z)) { if (run * 0.5 > maxGap) gaps.push([R1(st), R1(run * 0.5)]); run = 0; } else { if (!run) st = s; run++; if (inWedge) run = 0; }
      }
      if (run * 0.5 > maxGap) gaps.push([R1(st), R1(run * 0.5)]);
      lineRows.push({ id: e.id, cls: e.cls, name, gaps });
    }
  }
  const badLines = lineRows.filter((l) => l.gaps.length);
  add('Улицы (collector / arterial) и М1', 'разметка осевая / полосная / краевая без пропусков длиннее 6 м (кроме штатных пунктирных)', `${lineRows.length - badLines.length} из ${lineRows.length} линий сплошные${badLines.length ? ' (пропуски: ' + sh(badLines.map((l) => `${l.id} ${l.name} ${JSON.stringify(l.gaps[0])}`)) + ')' : ''}`, 'линия не прерывается вне штатных пунктиров и клиньев съездов', 'ГОСТ Р 51256-2018 п. 5.1.? (1.1 / 1.5 / 1.2.1)', badLines.length ? 'НАРУШЕНИЕ' : 'OK');
  // ramps: edge lines along both sides
  const rampBad = [];
  D.graph.ramps.forEach(([ic, kind, pts], ri) => {
    const S = [0]; for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    for (const sg of [-1, 1]) { let run = 0, st = 0, gaps = [];
      for (let sv = 22; sv < S[S.length - 1] - 22; sv += 0.5) {
        let i = 1; while (i < S.length - 1 && S[i] < sv) i++; const t = (sv - S[i - 1]) / ((S[i] - S[i - 1]) || 1), p = pts[i - 1], q = pts[i], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
        const x = p[0] + dx * t - dz / l * sg * 1.2, z = p[1] + dz * t + dx / l * sg * 1.2;
        if (paintNear(x, z, 0.2) || [[0, -240], [1, 250]].some(([hax, hc]) => { const lt = Math.abs((hax === 0 ? z : x) - hc), al = hax === 0 ? x : z; return Math.abs(lt - 6.0) < 2.0 && paintNear(hax === 0 ? al : hc + Math.sign((hax === 0 ? z : x) - hc) * 6.0, hax === 0 ? hc + Math.sign(z - hc) * 6.0 : al, 0.3); })) { if (run * 0.5 > 6) gaps.push([R1(st), R1(run * 0.5)]); run = 0; } else { if (!run) st = sv; run++; } }
      if (run * 0.5 > 6) gaps.push([R1(st), R1(run * 0.5)]);
      if (gaps.length) rampBad.push(`${ic}.${ri} ${sg > 0 ? 'R' : 'L'} ${JSON.stringify(gaps.slice(0, 2))}`);
    }
  });
  add('Съезды I1 / I4', 'краевые линии 1.2.2 по обеим сторонам, без пропусков длиннее 6 м (кроме 22 м у носов)', rampBad.length ? `пропуски: ${sh(rampBad)}` : `все ${D.graph.ramps.length * 2} краевых линий непрерывны`, 'краевая линия на съездах и эстакадах', 'ГОСТ Р 51256-2018 п. 5.1.? (1.2.2 на съездах)', rampBad.length ? 'НАРУШЕНИЕ' : 'OK');

  // ---- C. bus stops --------------------------------------------------------------------------------------------------------------------------------------
  const stops = []; for (const c of Object.values(D.cells)) { const l = c.f && c.f.stop; if (l) for (let i = 0; i + 3 < l.length; i += 4) stops.push([l[i], l[i + 1]]); }
  const noYellow = stops.filter((s) => !R.near('yellow', s[0], s[1], 6)).length;
  add('Остановки автобуса', 'разметка 1.17 (жёлтая линия вдоль бордюра остановки)', `${stops.length - noYellow} из ${stops.length}`, 'жёлтая линия 1.17 на длине остановки', 'ГОСТ Р 51256-2018 (1.17)', noYellow ? 'НАРУШЕНИЕ' : 'OK', 'было: жёлтой краски в сети не было вообще');

  // ---- D. kerbs ----------------------------------------------------------------------------------------------------------------------------------------------
  const kerbGaps = []; let kSamples = 0;
  for (const e of P.edges) {
    if (e.cls === 'motorway' || e.split) continue; const a = N.get(e.a), b = N.get(e.b), L = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / L, dz = (b.z - a.z) / L, nx = -dz, nz = dx;
    for (const sg of [-1, 1]) { let run = 0, st = 0;
      const flush = () => { if (run > 3) { const mx = a.x + dx * (st + run / 2), mz = a.z + dz * (st + run / 2); if (!stops.some((q) => Math.hypot(q[0] - mx, q[1] - mz) < 10) && !nearRampEnd(mx, mz, 70) && !P.nodes.some((n) => Math.hypot(n.x - mx, n.z - mz) < 20)) kerbGaps.push(`${e.id}${sg > 0 ? '+' : '-'} ${R1(mx)},${R1(mz)} ${run} m`); } run = 0; };
      for (let s = 0; s <= L; s += 1) { kSamples++; if (K.near('kerb', a.x + dx * s + nx * sg * (hw(e.cls) + 0.05), a.z + dz * s + nz * sg * (hw(e.cls) + 0.05), 0.3)) flush(); else { if (!run) st = s; run++; } } flush(); }
  }
  add('Все улицы', 'бордюр вдоль обеих кромок проезжей части без разрывов длиннее 3 м (кроме остановок, возвратов у перекрёстков, носов съездов)', kerbGaps.length ? `разрывы: ${sh(kerbGaps)}` : `${kSamples} проб, разрывов нет`, 'бордюр там, где проезжая часть граничит с тротуаром / газоном', 'ГОСТ 6665-91 (бордюры), СП 34.13330 п. 7.? ; СП 42.13330', kerbGaps.length ? 'НАРУШЕНИЕ' : 'OK');
  // asphalt / lawn boundary without a kerb (information: motorway edges have a shoulder + line, no kerb, by the norm)
  // ---- E. lighting ---------------------------------------------------------------------------------------------------------------------------------------------
  const lamps = []; for (const c of Object.values(D.cells)) { const l = c.f && c.f.lamp; if (l) for (let i = 0; i + 3 < l.length; i += 4) lamps.push(l.slice(i, i + 4)); }
  const grid = new Map(), key = (x, z) => Math.floor(x / 16) + ',' + Math.floor(z / 16); for (const l of lamps) { const k = key(l[0], l[1]); (grid.get(k) || grid.set(k, []).get(k)).push(l); }
  const nearest = (x, z) => { let best = 1e9; const cx = Math.floor(x / 16), cz = Math.floor(z / 16); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const l of grid.get((cx + i) + ',' + (cz + j)) || []) best = Math.min(best, Math.hypot(l[0] - x, l[1] - z)); return best; };
  const lit = (e, x, z) => e.cls !== 'motorway' || (e.ref === 'M1' ? Math.abs(x) <= 170 : e.ref === 'M2' ? z >= -150 && z <= 88 : true);   // the rural motorway is unlit by the norm; the city part, the interchanges and I2 are lit
  const dark = []; const scan = (id, pts, ok) => { let run = 0, st = null; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]); for (let t = 0; t < l; t += 2) { const x = a[0] + (b[0] - a[0]) * t / l, z = a[1] + (b[1] - a[1]) * t / l; if (ok(x, z) && nearest(x, z) > 14) { if (!run) st = [x, z]; run += 2; } else { if (run > 24) dark.push(`${id} ${st.map((v) => Math.round(v))} ${run} m`); run = 0; } } } if (run > 24) dark.push(`${id} ${st.map((v) => Math.round(v))} ${run} m`); };
  for (const e of P.edges) { const a = N.get(e.a), b = N.get(e.b); scan(e.id, [[a.x, a.z], [b.x, b.z]], (x, z) => lit(e, x, z) && !(e.cls === 'motorway' && e.ref === 'M2' && Math.abs(z) < 10)); }
  for (const [ic, kind, pts] of D.graph.ramps) scan(ic + '.' + kind, pts, () => true);
  add('Вся сеть', 'освещение: нет участков дороги / съезда / эстакады темнее 14 игр. м до ближайшего фонаря длиннее 24 м (шаг фонарей 14-16 игр. м = 35-40 м реальных)', dark.length ? `тёмные участки: ${sh(dark)}` : `${lamps.length} фонарей (из них на настилах ${lamps.filter((l) => l[3] > 0.1).length}), тёмных участков нет`, 'освещение магистралей, развязок и улиц; шаг 30-40 м', 'СП 52.13330.2016 табл. 7.? (освещение магистралей и развязок); ГОСТ Р 55706', dark.length ? 'НАРУШЕНИЕ' : 'OK', 'было: 0 фонарей на М1 / М2 / съездах, 14 тёмных участков');
  // lamp poles never stand on drivable asphalt at their own level
  let onRoad = []; for (const l of lamps) { if (l[3] > 0.1) continue; if (K.at('asph', l[0], l[1], 1)) onRoad.push(`${R1(l[0])},${R1(l[1])}`); }
  add('Фонари на земле', 'опора не стоит на проезжей части', onRoad.length ? `на асфальте: ${sh(onRoad)}` : 'нет', 'опора вне проезжей части', 'СП 34.13330 (опоры вне проезжей части)', onRoad.length ? 'НАРУШЕНИЕ' : 'OK');
  // ---- G. symmetry of the motorway edges: the same shoulder (0.2 m between the edge line and the asphalt edge) on both sides of every carriageway (owner 2026-10-25) --------------------------
  { let bad = [], n = 0;
    for (const [x0, x1] of [[-160, -50], [50, 160]]) for (let x = x0; x <= x1; x += 4) {
      if (nearRampEnd(x, -240, 30) || nearRampEnd(x, -246, 30) || nearRampEnd(x, -234, 30)) continue;
      const side = (lat) => [R.near('paint', x, -240 + lat, 0.12), K.at('asph', x, -240 + lat + (lat > 0 ? 0.15 : -0.15), 3)];
      const L = [side(-6.1), side(-6.3)], Rr = [side(6.1), side(6.3)]; n++;
      if (L[0][0] !== Rr[0][0] || L[1][1] !== Rr[1][1]) bad.push(`${x}`);
    }
    for (const z of [-140, -110, -80, -50, 50, 62]) { n++; const side = (lat) => R.near('paint', 250 + lat, z, 0.12); if (side(-6.1) !== side(6.1)) bad.push(`M2 z${z}`); }
    add('М1 / М2', 'кромки симметричны: краевая линия на одном и том же расстоянии от края асфальта слева и справа', bad.length ? `асимметрия: ${sh(bad)}` : `${n} сечений симметричны`, 'одинаковая обочина и кромочная линия по обе стороны', 'ГОСТ Р 52289-2019 (разметка 1.2.1); требование владельца 2026-10-25', bad.length ? 'НАРУШЕНИЕ' : 'OK', 'было: обочина 1.0 м справа и 0.2 м слева'); }
  // ---- F. pedestrian connectivity: a sidewalk along both sides of every urban street ----------------------------------------------------------------------
  const walkGaps = []; let wSamples = 0;
  for (const e of P.edges) {
    if (e.cls === 'motorway' || e.cls === 'service' || e.split) continue; const a = N.get(e.a), b = N.get(e.b), L = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / L, dz = (b.z - a.z) / L, nx = -dz, nz = dx, o = hw(e.cls) + CLS[e.cls].sidewalk * 0.5;
    for (const sg of [-1, 1]) { let run = 0, st = 0; const flush = () => { if (run > 6) { const mx = a.x + dx * (st + run / 2), mz = a.z + dz * (st + run / 2); if (!nearRampEnd(mx, mz, 70) && !P.nodes.some((n) => Math.hypot(n.x - mx, n.z - mz) < 20) && !stops.some((p) => Math.hypot(p[0] - mx, p[1] - mz) < 10)) walkGaps.push(`${e.id}${sg > 0 ? '+' : '-'} ${R1(mx)},${R1(mz)} ${run} m`); } run = 0; };
      for (let s = 0; s <= L; s += 1) { wSamples++; if (K.near('walk', a.x + dx * s + nx * sg * o, a.z + dz * s + nz * sg * o, 0.25)) flush(); else { if (!run) st = s; run++; } } flush(); }
  }
  add('Городские улицы', 'тротуар вдоль обеих сторон улицы без разрывов длиннее 6 м', walkGaps.length ? `разрывы: ${sh(walkGaps)}` : `${wSamples} проб, разрывов нет`, 'тротуары вдоль всех городских улиц (пешеходная связность)', 'СП 42.13330.2016 п. 11.? ; СП 59.13330', walkGaps.length ? 'НАРУШЕНИЕ' : 'OK');

  // ---- H. coverage of centre / lane lines along EVERY drivable street (2026-10-26, owner: "много где разметки нет"): rule table per class ------------------------------------------------
  //   arterial: lane dividers 1.5 on both sides of the median; collector / local / service: dashed centre line 1.5.  A 2 m window "has the line" if paint lies within 0.15 m of the line in it.
  const covRows = {}, zero = [], poor = [];
  for (const e of P.edges) {
    if (e.cls === 'motorway' || e.split) continue; const cl = CLS[e.cls], a = N.get(e.a), b = N.get(e.b), L = Math.hypot(b.x - a.x, b.z - a.z), dx = (b.x - a.x) / L, dz = (b.z - a.z) / L, nx = -dz, nz = dx;
    const lines = e.cls === 'arterial' ? [-(cl.median / 2 + cl.lane), cl.median / 2 + cl.lane] : [0];
    const lo = 12, hi = L - 12; if (hi - lo < 6 || L < 60) continue;   // a block shorter than 45 m between two junction trims is all junction
    let win = 0, has = 0;
    for (let s = lo; s + 2 <= hi; s += 2) for (const lat of lines) { win++; let ok = false; for (let t = 0; t <= 2 && !ok; t += 0.25) { const x = a.x + dx * (s + t) + nx * lat, z = a.z + dz * (s + t) + nz * lat; if (R.near('paint', x, z, 0.15)) ok = true; } if (ok) has++; }
    if (!win) continue; const c = covRows[e.cls] || (covRows[e.cls] = { win: 0, has: 0, n: 0 }); c.win += win; c.has += has; c.n++;
    if (has === 0) zero.push(e.id + ' ' + e.cls); else if (has / win < 0.35) poor.push(e.id + ' ' + e.cls + ' ' + Math.round(100 * has / win) + '%');
  }
  for (const [cls, c] of Object.entries(covRows)) add('Покрытие разметкой', `осевая / полосная разметка: ${cls}`, `${c.n} перегонов, окон с линией ${Math.round(100 * c.has / c.win)} %`, 'у каждого перегона с центральной линией (1.5 / 1.1) во всех окнах 2 м (штрих ~50 %)', 'ГОСТ Р 51256-2018', c.has / c.win >= 0.35 ? 'OK' : 'НАРУШЕНИЕ');
  add('Покрытие разметкой', 'улицы совсем без осевой / полосной разметки', zero.length ? `${zero.length}: ${sh(zero)}` : 'нет', 'ни одной улицы без разметки', 'ГОСТ Р 51256-2018', zero.length ? 'НАРУШЕНИЕ' : 'OK');
  add('Покрытие разметкой', 'улицы с редкой разметкой (< 35 % окон)', poor.length ? `${poor.length}: ${sh(poor)}` : 'нет', 'штрихи вдоль всей улицы между стоп-линиями', 'ГОСТ Р 51256-2018', poor.length ? 'НАРУШЕНИЕ' : 'OK');
  // ---- I. diverge / merge points and paint on pavement (2026-10-26 (6), owner: "doubled edge line on diverging ramps, ramp edge starting before the nose") ----------------------------------
  //   (1) no paint stub off the pavement (motorway corridors and ramps): every paint cell lies within 0.12 m of asphalt / deck pavement (a line may not start in the grass beside a 0-width wedge tip)
  //   (2) at every ramp end that joins a motorway: cross-sections every 0.7 m over the 30 m of the wedge show no two parallel lines closer than 0.5 m (doubled line) - the host's edge line and the ramp's line may meet (one cluster)
  //   (3) the host's edge line on the ramp side is BROKEN along the wedge (some gap >= 0.5 m in 12 m of the span) and solid (no gap > 0.3 m) 6 m before / after it
  const rampPtsAll = D.graph.ramps.flatMap(([, , pts]) => pts), nearRampPt = (x, z, d) => rampPtsAll.some((p) => Math.hypot(p[0] - x, p[1] - z) < d);
  const lotCells = new Set(); for (const c of Object.values(D.cells)) for (const L of ['g', 'r']) { const o = c[L]; if (!o) continue;
    const mark = (x0, z0, x1, z1) => { for (let x = Math.floor(x0); x <= Math.floor(x1); x++) for (let z = Math.floor(z0); z <= Math.floor(z1); z++) lotCells.add(x + ',' + z); };
    if (o.q) for (let i = 0; i + 5 < o.q.length; i += 6) if (o.q[i + 5] === D.palette.parking) mark(Math.min(o.q[i], o.q[i + 2]), Math.min(o.q[i + 1], o.q[i + 3]), Math.max(o.q[i], o.q[i + 2]), Math.max(o.q[i + 1], o.q[i + 3]));
    if (o.t) for (let i = 0; i + 7 < o.t.length; i += 8) if (o.t[i + 7] === D.palette.parking) mark(Math.min(o.t[i], o.t[i + 2], o.t[i + 4]), Math.min(o.t[i + 1], o.t[i + 3], o.t[i + 5]), Math.max(o.t[i], o.t[i + 2], o.t[i + 4]), Math.max(o.t[i + 1], o.t[i + 3], o.t[i + 5])); }
  { const P1 = R.G.paint, nxx = R.nx; let stubs = [], total = 0;
    for (let j = 0; j < R.nz; j++) for (let i = 0; i < nxx; i++) if (P1[j * nxx + i]) { total++; const x = -300 + (i + 0.5) * R.RES, z = -372 + (j + 0.5) * R.RES; if (lotCells.has(Math.floor(x) + ',' + Math.floor(z))) continue; if (!(Math.abs(z + 240) < 9 && Math.abs(x) < 170 || Math.abs(x - 250) < 9 && z > -100 || nearRampPt(x, z, 1.9))) continue; if (!K.near('asph', x, z, 0.14) && !K.near('walk', x, z, 0.14) && !K.near('island', x, z, 0.14) && !K.near('conc', x, z, 0.14) && !K.near('median', x, z, 0.14)) stubs.push([R1(x), R1(z)]); }
    // group the stub cells (within 1 m of each other) into clusters
    const cl0 = []; for (const q of stubs) { const c = cl0.find((k) => Math.hypot(k[0] - q[0], k[1] - q[1]) < 1.2); if (c) { c[2]++; } else cl0.push([q[0], q[1], 1]); }
    const cl = cl0.filter((c) => c[2] > 3);   // 1-3 cells = a lot line grazing the 1.9 m corridor, not a stub
    add('Вся сеть', 'краска (линии, стрелки) лежит на покрытии: нет обрывков в траве', cl.length ? `${cl.length} мест вне покрытия: ${cl.slice(0, 40).map((c) => c[0] + ',' + c[1] + ' (' + c[2] + ')').join('; ')}` : `${total} ячеек краски, вне покрытия 0`, 'краска только на асфальте / настиле', 'ГОСТ Р 51256-2018 п. 5 (разметка наносится на покрытие)', cl.length ? 'НАРУШЕНИЕ' : 'OK', '');
  }
  { const Rf = makeRaster(D, 0.05); const bad = [], seen = []; let nEnds = 0, nBroken = 0, nDoubled = 0;
    for (const ic of P.interchanges) for (const r of ic.ramps) for (const k of [0, 1]) {
      if (r.attach[k] !== 'motorway' || (r.noWedge || []).includes(k)) continue; nEnds++;   // a trunk ramp IS the carriageway (no wedge, no broken edge)
      const e = k ? r.pts[r.pts.length - 1] : r.pts[0], nxt = k ? r.pts[r.pts.length - 2] : r.pts[1];
      const host = [{ axis: 0, c: -240 }, { axis: 1, c: 250 }].reduce((a, b) => Math.abs(e[1 - a.axis] - a.c) <= Math.abs(e[1 - b.axis] - b.c) ? a : b), ax = host.axis, lat0 = Math.sign(e[1 - ax] - host.c) || 1, dirA = Math.sign(nxt[ax] - e[ax]) || 1;
      let doubled = 0, maxGapEdge = 0;
      for (let t = 1; t <= 30; t += 0.7) {
        const a = e[ax] + dirA * t;
        for (const mask of [1, 2]) {   // ground paint and deck paint are different levels: two lines on different levels are not a doubled line
          const lines = []; let run = null;
          for (let l = 0.2; l <= 16; l += 0.05) { const x = ax === 0 ? a : host.c + lat0 * l, z = ax === 0 ? host.c + lat0 * l : a; const on = Rf.at('paint', x, z, mask); if (on && !run) run = [l, l]; else if (on) run[1] = l; else if (run) { lines.push((run[0] + run[1]) / 2); run = null; } }
          for (let q = 0; q + 1 < lines.length; q++) if (lines[q + 1] - lines[q] > 0.06 && lines[q + 1] - lines[q] < 0.5) doubled++;
        }
      }
      // broken edge line: along the host edge (lat 5.95 / 6.1) look for gaps over 12 m of the wedge
      let gaps = 0, run = 0; for (let t = 4; t <= 20; t += 0.1) { const a = e[ax] + dirA * t; let on = false; for (const l of [5.95, 6.1]) { const x = ax === 0 ? a : host.c + lat0 * l, z = ax === 0 ? host.c + lat0 * l : a; if (Rf.near('paint', x, z, 0.06)) on = true; } if (!on) { run++; } else { if (run * 0.1 >= 0.5) gaps++; run = 0; } }
      if (doubled) { nDoubled++; bad.push(`${ic.id} end ${R1(e[0])},${R1(e[1])}: ${doubled} doubled-line sections`); }
      if (gaps >= 2) nBroken++;
      seen.push([ic.id, R1(e[0]), R1(e[1]), gaps, doubled]);
    }
    add('Развилки съездов с М1 / М2', 'нет сдвоенных линий (две параллельные линии ближе 0.5 м) на 30 м клина', bad.length ? sh(bad) : `${nEnds} развилок, сдвоенных нет`, 'одна линия на границе полосы', 'ГОСТ Р 51256-2018 прил. А (1.5, 1.6, 1.7)', bad.length ? 'НАРУШЕНИЕ' : 'OK', '');
    add('Развилки съездов с М1 / М2', 'краевая линия магистрали вдоль клина прерывистая (>= 2 разрыва по 0.5 м на 16 м)', `${nBroken} из ${nEnds}`, 'прерывистая линия вдоль полосы перестроения', 'ГОСТ Р 51256-2018 (1.5 / 1.6)', nBroken === nEnds ? 'OK' : 'НАРУШЕНИЕ', nBroken === nEnds ? '' : seen.filter((q) => q[3] < 2).map((q) => q.slice(0, 3).join(',')).join('; '));
  }
  // ---- J. lane arrows (2026-10-26 (6), owner: arrows at odd angles, an arrow with a bar through it) ---------------------------------------------------------------------------------------------
  //   every ground arrow: nearest lane path (navigation arc) within 2.2 m, its heading within 6 degrees of that lane's travel direction; no other white paint inside the arrow; no two arrows of one lane within 8 m
  { const segs = new Map(), key = (x, z) => Math.floor(x / 6) + ',' + Math.floor(z / 6);
    for (const a of D.graph.navigation.arcs) if (a.kind !== 'turn') for (let i = 1; i < a.p.length; i++) { const A = a.p[i - 1], B = a.p[i]; for (let x = Math.floor(Math.min(A[0], B[0]) / 6); x <= Math.floor(Math.max(A[0], B[0]) / 6); x++) for (let z = Math.floor(Math.min(A[1], B[1]) / 6); z <= Math.floor(Math.max(A[1], B[1]) / 6); z++) { const k = x + ',' + z; (segs.get(k) || segs.set(k, []).get(k)).push([A, B, a.id]); } }
    const bad = [], noLane = [], dup = [];
    for (const [x, z, hx, hz, ramp] of D.arrows) {
      let best = null; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [A, B, id] of segs.get((Math.floor(x / 6) + i) + ',' + (Math.floor(z / 6) + j)) || []) {
        const dx = B[0] - A[0], dz = B[1] - A[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (z - A[1]) * dz) / l2)), d = Math.hypot(x - A[0] - dx * t, z - A[1] - dz * t);
        if (d < 2.6 && (!best || d < best.d))   // 2.6: the navigation models ONE path per motorway carriageway (outer lane centre); an arrow in the inner lane lies 2.4-2.5 m from it
          best = { d, tx: dx / Math.sqrt(l2), tz: dz / Math.sqrt(l2), id }; }
      if (!best) { noLane.push(`${R1(x)},${R1(z)}`); continue; }
      const dot = hx * best.tx + hz * best.tz; if (dot < Math.cos(6 * Math.PI / 180)) bad.push(`${R1(x)},${R1(z)} ${Math.round(Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI)}°`);
    }
    for (let i = 0; i < D.arrows.length; i++) for (let j = i + 1; j < D.arrows.length; j++) { const a = D.arrows[i], b = D.arrows[j]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 8 && a[2] * b[2] + a[3] * b[3] > 0.9) { const dx = b[0] - a[0], dz = b[1] - a[1], lat = Math.abs(dx * -a[3] + dz * a[2]); if (lat < 1.0) dup.push(`${R1(a[0])},${R1(a[1])}`); } }
    add('Стрелки на полосах', 'стрелка направлена вдоль полосы (<= 6° к направлению движения по навигационной дуге)', bad.length || noLane.length ? `${bad.length} с углом > 6°: ${sh(bad)}; ${noLane.length} без полосы рядом: ${sh(noLane)}` : `${D.arrows.length} стрелок, все вдоль полосы`, 'стрелка 1.18 вдоль оси полосы', 'ГОСТ Р 51256-2018 (1.18)', bad.length || noLane.length ? 'НАРУШЕНИЕ' : 'OK', '');
    add('Стрелки на полосах', 'на стрелке нет другой белой разметки (штрих, линия поверх)', D.arrowOverlap.length ? `${D.arrowOverlap.length}: ${sh(D.arrowOverlap.map((o) => o[0] + ',' + o[1]))}` : `${D.arrows.length} стрелок без пересечений`, 'стрелка не пересекается с линиями', 'ГОСТ Р 51256-2018 п. 5.? (1.18)', D.arrowOverlap.length ? 'НАРУШЕНИЕ' : 'OK', '');
    add('Стрелки на полосах', 'одна стрелка на полосу (нет двух стрелок одной полосы ближе 8 м)', dup.length ? sh(dup) : 'нет повторов', 'одна стрелка на полосу у подхода', 'ГОСТ Р 52289-2019 п. 5.? / 1.18', dup.length ? 'НАРУШЕНИЕ' : 'OK', '');
  }
  return { rows };
}
