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
      nZebra++; if (!across(along, 0.9, (x, z) => R.near('paint', x, z, 0.12))) miss.zebra.push(`${j.id} ${j.at} ${a.cls} ${a.dir}`);
    } else if ((j.type === 'priority' || j.type === 'riro') && !(j.major && a.cls === j.major)) {
      nYield++; if (!across(ch + 1.0, 0.6, (x, z) => R.near('paint', x, z, 0.2))) miss.yield.push(`${j.id} ${j.at} ${a.cls} ${a.dir}`);
    } else if (j.type === 'roundabout') {
      nRing++; if (!across(j.R + 0.9, 0.5, (x, z) => R.near('paint', x, z, 0.2))) miss.ring.push(`${j.id} ${j.at} ${a.cls} ${a.dir}`);
    }
  }
  const sh = (a) => a.slice(0, 4).join('; ') + (a.length > 4 ? ` ... (+${a.length - 4})` : '');
  add('Все светофорные перекрёстки', 'стоп-линия 1.12 на каждом подходе', `${nStop - miss.stop.length} из ${nStop}${miss.stop.length ? ' (нет: ' + sh(miss.stop) + ')' : ''}`, 'стоп-линия перед светофором на каждой полосе подхода', 'ГОСТ Р 51256-2018 п. 5.1.? (линия 1.12), ГОСТ Р 52289-2019 п. 5.? ', miss.stop.length ? 'НАРУШЕНИЕ' : 'OK', 'было: местные улицы и служебные проезды без стоп-линии');
  add('Все светофорные перекрёстки', 'пешеходный переход 1.14.1 (зебра) на каждом подходе', `${nZebra - miss.zebra.length} из ${nZebra}${miss.zebra.length ? ' (нет: ' + sh(miss.zebra) + ')' : ''}`, 'зебра у каждого подхода регулируемого перекрёстка', 'ГОСТ Р 51256-2018 п. 5.1.? (1.14.1), СП 42.13330 п. 11.? ', miss.zebra.length ? 'НАРУШЕНИЕ' : 'OK');
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
        const inWedge = nearRampEnd(x, z, 24);
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
        if (paintNear(x, z, 0.2)) { if (run * 0.5 > 6) gaps.push([R1(st), R1(run * 0.5)]); run = 0; } else { if (!run) st = sv; run++; } }
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
  return { rows };
}
