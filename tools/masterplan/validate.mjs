// Валидатор плана B (без браузера):  node tools/masterplan/validate.mjs [--report] [--json]
// Проверяет граф, тупики, радиусы, углы, интервалы, кварталы, лоты, зазоры до существующих построек, пересечения, мосты, фазы, площадки; печатает таблицу и отчёт полезности дорог.
import fs from 'node:fs';
import { dist, polyDist, polyPolylineDist, polyPolyDist, segInter, inPoly, norm, angDiff, segsStartDir, segsEndDir, D2R } from './geo.mjs';
import { CLS, RAIL, off, adjacency, junctions } from './net.mjs';
const plan = JSON.parse(fs.readFileSync(new URL('plan-B.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2), REPORT = args.includes('--report'), JSON_OUT = args.includes('--json');
plan.nodeById = Object.fromEntries(plan.nodes.map((n) => [n.id, n]));
const rows = [], fails = []; let warns = 0;
const chk = (name, ok, detail = '', warn = false) => { rows.push([ok ? 'OK  ' : warn ? 'WARN' : 'FAIL', name, detail]); if (!ok) { if (warn) warns++; else fails.push(name + ': ' + detail); } };
const E = plan.edges, RoadE = E.filter((e) => !e.existing), RAILS = plan.rails;
const ids = (arr) => new Set(arr.map((a) => a.id)); chk('уникальные id', ids(E).size === E.length && ids(plan.nodes).size === plan.nodes.length && ids(plan.lots).size === plan.lots.length && ids(RAILS).size === RAILS.length);
// 1. привязка концов рёбер к узлам и касательность
{ let bad = [], tan = [];
  for (const e of E) { const n0 = plan.nodeById[e.from], n1 = plan.nodeById[e.to]; if (!n0 || !n1) { bad.push(e.id + ':node?'); continue; }
    const tol = (n) => (n.type === 'merge' ? 8 : n.type === 'roundabout' || n.type === 'terminal-roundabout' ? 0.2 : 0.2);
    if (dist(e.pts[0], [n0.x, n0.z]) > tol(n0)) bad.push(`${e.id}:from ${dist(e.pts[0], [n0.x, n0.z]).toFixed(2)}`);
    if (dist(e.pts[e.pts.length - 1], [n1.x, n1.z]) > tol(n1)) bad.push(`${e.id}:to ${dist(e.pts[e.pts.length - 1], [n1.x, n1.z]).toFixed(2)}`);
    for (let i = 1; i < e.segs.length; i++) { const a = e.segs[i - 1], b = e.segs[i]; const da = segsEndDir([a]), db = segsStartDir([b]); if (angDiff(da, db) > 0.6) tan.push(`${e.id}@${i}:${angDiff(da, db).toFixed(1)}°`); } }
  chk('концы рёбер совпадают с узлами', bad.length === 0, bad.join(' ')); chk('касательность стыков дуга/прямая (≤0.6°)', tan.length === 0, tan.join(' ')); }
// 2. связность по фазам, отсутствие висячих компонент
const maxPhase = 8;
function comps(phase, edges = E) { const par = new Map(); const f = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
  for (const e of edges.filter((q) => q.phase <= phase)) { for (const n of [e.from, e.to]) if (!par.has(n)) par.set(n, n); par.set(f(e.from), f(e.to)); }
  const roots = new Set([...par.keys()].map(f)); return { roots, f, par }; }
for (let p = 1; p <= maxPhase; p++) { const c = comps(p); chk(`связность фаза ${p} (одна компонента вместе с кольцом-1)`, c.roots.size === 1, `компонент ${c.roots.size}`); }
// 3. тупики
const deg = {}; for (const e of E) { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; }
const servedBy = {}; plan.lots.forEach((l) => { (servedBy[l.frontEdge] ||= []).push(l); });
const deadAll = [], cul = [], exits = [];
for (let p = 1; p <= maxPhase; p++) { const d = {}; const es = E.filter((e) => e.phase <= p); es.forEach((e) => { d[e.from] = (d[e.from] || 0) + 1; d[e.to] = (d[e.to] || 0) + 1; });
  for (const [n, k] of Object.entries(d)) if (k === 1) { const nd = plan.nodeById[n]; const inc = es.find((e) => e.from === n || e.to === n); if (nd.type === 'exit') { if (p === 4 || p === 5) exits.push(n); continue; } const serve = (servedBy[inc.id] || []).filter((l) => l.phase <= p).length; if (nd.type === 'cul-de-sac' || serve > 0 || false) { if (serve > 0 && nd.type !== 'cul-de-sac' && p === maxPhase) {} cul.push(`${n}@${p}`); if (serve === 0) deadAll.push(`${n}@${p}(0 лотов)`); } else deadAll.push(`${n}@${p}`); } }
chk('тупиков нет (кроме задокументированных тупиков с лотами и выходов за карту)', deadAll.length === 0, deadAll.join(' '));
const culFinal = [...new Set(cul.filter((c) => c.endsWith('@8')).map((c) => c.split('@')[0]))]; const exitsFinal = [...new Set(RoadE.length ? E.filter((e) => ['exit'].includes(plan.nodeById[e.from].type) || ['exit'].includes(plan.nodeById[e.to].type)).map((e) => e.id) : [])];
// 4. радиусы и стандарты ширины
{ const bad = [], wbad = []; for (const e of RoadE) { const c = CLS[e.cls]; if (e.minR !== null && e.minR < c.minR) bad.push(`${e.id} R=${e.minR}<${c.minR}`); if (e.w !== c.w || e.lanes !== c.lanes) wbad.push(e.id); }
  for (const r of RAILS) if (r.minR !== null && r.minR < RAIL.minR) bad.push(`${r.id} R=${r.minR}<${RAIL.minR}`);
  chk('минимальные радиусы по классам (местн 12, сборн 18, маг 30, скор 60, съезд 25, рельс 35)', bad.length === 0, bad.join(' ')); chk('ширины/полосы = стандарт класса', wbad.length === 0, wbad.join(' '));
  const minByCls = {}; for (const e of [...RoadE, ...RAILS.map((r) => ({ ...r, cls: 'rail' }))]) if (e.minR !== null) minByCls[e.cls] = Math.min(minByCls[e.cls] ?? 1e9, e.minR); rows.push(['INFO', 'мин. радиус по классам', JSON.stringify(minByCls)]); }
// 5. углы перекрёстков
const J = junctions(plan);
{ const bad = []; for (const j of J) { if (j.type === 'merge' || j.type === 'roundabout' && j.node.startsWith('N-R1-') && false) continue; if (j.minAngle < 70) bad.push(`${j.id} ${j.minAngle}°`); }
  chk('угол между плечами перекрёстка ≥ 70° (врезки съездов отдельно)', bad.length === 0, bad.join(' '));
  const gore = []; for (const e of RoadE.filter((q) => q.cls === 'ramp')) { const arcs = e.segs.filter((s) => s.k === 'A'); const g = e.ramp === 'off' ? arcs[0] : arcs[arcs.length - 1]; gore.push([e.id, Math.round(Math.abs(g.a1 - g.a0))]); }
  chk('раскрытие съездов у полосы М2 ≤ 15°', gore.every(([, a]) => a <= 15), gore.map((g) => g.join(':')).join(' ')); }
// 6. интервалы между перекрёстками (цепочки через узлы степени 2)
{ const degR = {}; for (const e of E) { degR[e.from] = (degR[e.from] || 0) + 1; degR[e.to] = (degR[e.to] || 0) + 1; }
  const isJ = (n) => degR[n] >= 3 || ['roundabout', 'terminal-roundabout'].includes(plan.nodeById[n].type); const bad = [], rep = [];
  const byNode = {}; E.forEach((e) => { (byNode[e.from] ||= []).push(e); (byNode[e.to] ||= []).push(e); }); const seen = new Set();
  for (const e of RoadE) { if (seen.has(e.id) || e.cls === 'ramp') continue; let chain = [e], len = e.len, a = e.from, b = e.to; seen.add(e.id);
    const ext = (n, dirEnd) => { while (!isJ(n) && degR[n] === 2) { const nx = byNode[n].find((q) => !seen.has(q.id)); if (!nx) break; seen.add(nx.id); chain.push(nx); len += nx.len; n = nx.from === n ? nx.to : nx.from; } return n; };
    a = ext(a); b = ext(b);
    const nj = [a, b].map((n) => plan.nodeById[n]); if (nj.some((n) => n.type === 'merge' || n.type === 'exit' || n.type === 'cul-de-sac')) continue;
    const need = Math.max(...chain.map((q) => CLS[q.cls].spacing)); rep.push(len); if (len + 0.5 < need) bad.push(`${chain.map((q) => q.id).join('+')} ${len.toFixed(1)}<${need}`); }
  chk('интервалы между перекрёстками (маг/пр ≥40, сборн ≥24, местн ≥20, скорост ≥60)', bad.length === 0, bad.join(' ')); rows.push(['INFO', 'мин. интервал, м', Math.min(...rep).toFixed(1)]); }
// 7. кварталы
{ const bad = plan.blocks.filter((b) => !(Math.min(b.w, b.h) >= 46 && Math.max(b.w, b.h) <= 96 && Math.min(b.w, b.h) <= 72)).map((b) => `${b.id} ${b.w}x${b.h}`); chk('размер кварталов в диапазоне 46..72 x ..96', bad.length === 0, bad.join(' ')); rows.push(['INFO', 'кварталов', plan.blocks.length + ': ' + [...new Set(plan.blocks.map((b) => b.w + 'x' + b.h))].join(', ')]); }
// 8. лоты
const stage = plan.existing.stageBuildings, landPoly = plan.land; const pierPolys = plan.piers.map((p) => p.poly);
{ const prob = { road: [], overlap: [], rail: [], stage: [], face: [], land: [], water: [], nostreet: [] }, frontDist = [];
  const lots = plan.lots;
  for (const l of lots) {
    for (const e of RoadE) if (polyPolylineDist(l.poly, e.pts) < e.w / 2 + 0.2) { prob.road.push(`${l.id}~${e.id}`); break; }
    for (const r of RAILS) if (polyPolylineDist(l.poly, r.pts) < 2.5) { prob.rail.push(`${l.id}~${r.id}`); break; }
    for (const s of stage) { const d = Math.min(...l.poly.map((p) => dist(p, [s.x, s.z]))) - s.r; if (d < 10) prob.stage.push(`${l.id}~stage${s.i} ${d.toFixed(1)}`); }
    const fe = E.find((e) => e.id === l.frontEdge); if (!fe) { prob.nostreet.push(l.id); continue; }
    const d = polyDist(l.door, fe.pts), need = off(fe.cls); frontDist.push(Math.abs(d - need));
    let bi = 0, bd = 1e9; for (let i = 0; i < fe.pts.length; i++) { const q = dist(fe.pts[i], l.door); if (q < bd) { bd = q; bi = i; } }
    const t = fe.pts[bi], v = [t[0] - l.door[0], t[1] - l.door[1]], vl = Math.hypot(...v) || 1; const dot = (v[0] * l.normal[0] + v[1] * l.normal[1]) / vl; if (Math.abs(d - need) > 0.8 || dot < 0.9) prob.face.push(`${l.id} d=${d.toFixed(1)} dot=${dot.toFixed(2)}`);
    if (!l.poly.every((p) => inPoly(p, landPoly) || pierPolys.some((pp) => inPoly(p, pp)))) prob.land.push(l.id);
    for (const w of plan.water) if (polyPolyDist(l.poly, w.poly) < 1) prob.water.push(l.id);
  }
  for (let i = 0; i < lots.length; i++) for (let j = i + 1; j < lots.length; j++) { const a = lots[i], b = lots[j]; if (Math.abs(a.door[0] - b.door[0]) > 60 || Math.abs(a.door[1] - b.door[1]) > 60) continue; if (polyPolyDist(a.poly, b.poly) < 0.9) prob.overlap.push(`${a.id}~${b.id}`); }
  chk('лоты не пересекают дороги (зазор ≥ полуширина + 0.2 м)', prob.road.length === 0, prob.road.join(' ')); chk('лоты не пересекаются друг с другом (зазор ≥ 0.9 м)', prob.overlap.length === 0, prob.overlap.join(' '));
  chk('лоты ≥ 2.5 м от рельсов', prob.rail.length === 0, prob.rail.join(' ')); chk('лоты ≥ 10 м от построек этапов', prob.stage.length === 0, prob.stage.join(' '));
  chk('у каждого лота есть фасадная улица, дверь на фасадной линии и смотрит на улицу', prob.face.length === 0 && prob.nostreet.length === 0, prob.face.concat(prob.nostreet).join(' '));
  chk('лоты на суше, не в воде', prob.land.length === 0 && prob.water.length === 0, prob.land.concat(prob.water).join(' '));
  rows.push(['INFO', 'лоты по видам', JSON.stringify(lots.reduce((m, l) => (m[l.kind] = (m[l.kind] || 0) + 1, m), {}))]);
}
// 9. зазоры дорог/рельсов до существующих построек, вторжение в ядро
{ const bad = [], coreArms = new Set(['B-PORT', 'B-N-1', 'B-MAIN-1', 'B-S-1', 'B-WF-LINK']), core = [], tree = [];
  for (const e of RoadE) { for (const s of stage) { const d = polyDist([s.x, s.z], e.pts) - s.r - e.w / 2; if (d < 10) bad.push(`${e.id}~stage${s.i} ${d.toFixed(1)}`); }
    const rmin = Math.min(...e.pts.map((p) => Math.hypot(p[0], p[1]))); if (rmin < 70 && !coreArms.has(e.id)) core.push(`${e.id} r=${rmin.toFixed(0)}`);
    for (const [x, z, r] of plan.existing.scenery) { const d = polyDist([x, z], e.pts) - r - e.w / 2; if (d < 0.5) tree.push(`${e.id}~tree(${x.toFixed(0)},${z.toFixed(0)})`); } }
  for (const n of plan.nodes) if (!n.existing && n.type !== 'existing-hub') for (const s of stage) { const d = dist([n.x, n.z], [s.x, s.z]) - s.r - (n.r || 0); if (d < 10) bad.push(`${n.id}~stage${s.i} ${d.toFixed(1)}`); }
  for (const r of RAILS) for (const s of stage) if (polyDist([s.x, s.z], r.pts) - s.r < 10) bad.push(`${r.id}~stage${s.i}`);
  for (const d of plan.districts) { if (d.frozen) continue; }
  chk('дороги/рельсы ≥ 10 м от построек этапов 1-16 (край покрытия)', bad.length === 0, bad.join(' '));
  chk('внутрь ядра (r<70) заходят только 5 назначенных плеч от кольца', core.length === 0, core.join(' '));
  chk('нет коллайдеров декора/деревьев на трассе (иначе слой вырезает)', tree.length === 0, tree.join(' '), true);
  const arm = coreArms; rows.push(['INFO', 'плечи в ядро', [...arm].join(', ')]); }
// 10. пересечения без узла
{ const bad = [], lc = []; const pairs = [];
  const all = [...RoadE.map((e) => ({ ...e, kind: 'road' })), ...RAILS.map((e) => ({ ...e, kind: 'rail' }))];
  const nodeAt = (p) => plan.nodes.some((n) => dist([n.x, n.z], p) < 1.2) || plan.railNodes.some((n) => dist([n.x, n.z], p) < 1.2);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) { const a = all[i], b = all[j]; if (a.kind === 'rail' && b.kind === 'rail' && false) continue;
    const bba = [Math.min(...a.pts.map((p) => p[0])), Math.max(...a.pts.map((p) => p[0])), Math.min(...a.pts.map((p) => p[1])), Math.max(...a.pts.map((p) => p[1]))], bbb = [Math.min(...b.pts.map((p) => p[0])), Math.max(...b.pts.map((p) => p[0])), Math.min(...b.pts.map((p) => p[1])), Math.max(...b.pts.map((p) => p[1]))];
    if (bba[1] < bbb[0] || bbb[1] < bba[0] || bba[3] < bbb[2] || bbb[3] < bba[2]) continue;
    for (let s = 1; s < a.pts.length; s++) { let hit = null; for (let t = 1; t < b.pts.length; t++) { const q = segInter(a.pts[s - 1], a.pts[s], b.pts[t - 1], b.pts[t]); if (q && !nodeAt(q)) { hit = q; break; } } if (hit) { if ((a.level ?? 0) !== (b.level ?? 0) && a.kind === 'road' && b.kind === 'road') {} else if (a.kind !== b.kind) lc.push(`${a.id}x${b.id}`); else bad.push(`${a.id}x${b.id}@${hit.map((v) => v.toFixed(0))}`); break; } } }
  // путепровод Хорды над траншеей М2 допустим: уровни различаются
  chk('нет пересечений дорог без узла (кроме разных уровней: путепровод)', bad.length === 0, bad.join(' ')); chk(`переездов в одном уровне: ${lc.length} (объявлено ${plan.levelCrossings.length})`, lc.length === plan.levelCrossings.length, lc.join(' '));
  const ov = RoadE.filter((e) => e.overpass); chk('путепровод: настил ≥ ширина проезда + тротуары, пролёт ≥ ширина М2 + 2x2 м, уровни разные', ov.every((e) => { const m = E.find((q) => q.id === e.overpass.over); return e.overpass.clearSpan >= m.w + 4 && (m.level ?? 0) < (e.level ?? 0) + 0 + 1 && m.level < e.level && e.overpass.deckW >= e.w + 2 * e.sw; }) && ov.length > 0, ov.map((e) => `${e.id} deck ${e.overpass.deckW} span ${e.overpass.clearSpan}`).join(' ')); }
// 11. мосты, траншея
{ const bad = []; for (const e of RoadE.filter((q) => q.bridge)) { const w = plan.water.find((x) => x.id === e.bridge.water); const span = e.bridge.s1 - e.bridge.s0; if (span < w.w + 2) bad.push(`${e.id} span ${span}<${w.w + 2}`); if (e.bridge.s0 < 8 || e.len - e.bridge.s1 < 6) bad.push(`${e.id} подходы ${e.bridge.s0}/${(e.len - e.bridge.s1).toFixed(0)}`);
    const z0 = e.pts[0][1] + e.bridge.s0, z1 = e.pts[0][1] + e.bridge.s1; if (z0 > w.z0 - 1 || z1 < w.z1 + 1) bad.push(`${e.id} не перекрывает воду ${w.z0}..${w.z1} (настил ${z0}..${z1})`); }
  chk('мосты перекрывают воду с запасом ≥ 2 м и имеют подходы (≥ 8 / ≥ 6 м)', bad.length === 0, bad.join(' '));
  const tr = RoadE.filter((q) => q.trench); chk('траншея М2: уклон ≤ 8 %, высота проезда ≥ 3 м', tr.every((e) => e.trench.grade <= 0.08 && e.trench.clearance >= 3 && Math.abs(e.trench.profile[0][0] - e.trench.profile[1][0]) * e.trench.grade + 0.5 >= e.trench.depth), tr.map((e) => `уклон ${e.trench.grade}, глубина ${e.trench.depth}`).join(' ')); }
// 12. рельсы: тупики только буфера/выходы; платформы у путей; концы совпадают с рельсовыми узлами
{ const rn = Object.fromEntries(plan.railNodes.map((n) => [n.id, n])), d = {}; RAILS.forEach((r) => { d[r.from] = (d[r.from] || 0) + 1; d[r.to] = (d[r.to] || 0) + 1; });
  const bad = Object.entries(d).filter(([n, k]) => k === 1 && !['bumper', 'exit'].includes(rn[n].type)).map(([n]) => n); chk('рельсы: концевые узлы только буфера/выходы', bad.length === 0, bad.join(' '));
  const gap = RAILS.filter((r) => dist(r.pts[0], [rn[r.from].x, rn[r.from].z]) > 0.3 || dist(r.pts[r.pts.length - 1], [rn[r.to].x, rn[r.to].z]) > 0.3).map((r) => r.id); chk('рельсы: концы совпадают с узлами', gap.length === 0, gap.join(' '));
  const st = plan.stations[0]; const trk = RAILS.filter((r) => st.tracks.includes(r.id)); const pd = st.platforms.map((p) => Math.min(...trk.map((t) => polyPolylineDist(p, t.pts)))); chk('платформы в 0.8..2.4 м от осей путей', pd.every((v) => v >= 0.8 && v <= 2.4), pd.map((v) => v.toFixed(1)).join(' '));
  const conf = []; for (const [nm, poly] of [['здание', st.building], ['площадь', st.plaza], ['автовокзал', st.bus]]) for (const r of RAILS) if (polyPolylineDist(poly, r.pts) < 1.5) conf.push(`${nm}~${r.id}`); for (const e of RoadE) for (const [nm, poly] of [['здание', st.building], ['автовокзал', st.bus], ['платформа', st.platforms[0]]]) if (polyPolylineDist(poly, e.pts) < e.w / 2) conf.push(`${nm}~${e.id}`);
  chk('станция не пересекает дороги и посторонние пути', conf.length === 0, conf.join(' ')); }
// 13. площадки и фазы
{ const P = Object.fromEntries(plan.pads.map((p) => [p.id, p])), bad = [], noPad = [];
  for (const e of RoadE) if (!e.pad || !P[e.pad]) noPad.push(e.id); for (const r of RAILS) if (!r.pad || !P[r.pad]) noPad.push(r.id); for (const l of plan.lots) if (!l.pad || !P[l.pad]) noPad.push(l.id);
  chk('каждый элемент (дорога, рельс, лот) принадлежит площадке', noPad.length === 0, noPad.join(' '));
  for (const p of plan.pads) { for (const q of p.requires) if (P[q].phase > p.phase) bad.push(`${p.id} требует более позднюю ${q}`); }
  const cyc = (id, seen = new Set()) => { if (seen.has(id)) return true; seen.add(id); return P[id].requires.some((q) => cyc(q, new Set(seen))); }; plan.pads.forEach((p) => { if (cyc(p.id)) bad.push('цикл ' + p.id); });
  const clo = (id, acc = new Set()) => { acc.add(id); P[id].requires.forEach((q) => clo(q, acc)); return acc; };
  for (const p of plan.pads) { const allow = clo(p.id); const es = RoadE.filter((e) => allow.has(e.pad)).concat(E.filter((e) => e.existing)); const par = new Map(); const f = (x) => { while (par.get(x) !== x) { par.set(x, par.get(par.get(x))); x = par.get(x); } return x; };
    for (const e of es) { for (const n of [e.from, e.to]) if (!par.has(n)) par.set(n, n); par.set(f(e.from), f(e.to)); } const mine = RoadE.filter((e) => e.pad === p.id); if (mine.some((e) => f(e.from) !== f('N-R1-E'))) bad.push(`${p.id}: не связна с кольцом через предшественников`); if (mine.length + p.lots + RAILS.filter((r) => r.pad === p.id).length + plan.stations.filter((s) => s.pad === p.id).length === 0) bad.push(p.id + ' пуста'); if (!(p.money > 0)) bad.push(p.id + ' цена'); }
  for (const e of RoadE) { const pe = P[e.pad]; if (pe && e.phase !== pe.phase) bad.push(`${e.id}: фаза ${e.phase} != фазе площадки ${pe.phase}`); }
  chk('фазы монотонны: площадка связна с кольцом только через предшественников, нет цикла и более поздних требований', bad.length === 0, bad.join(' ')); }
// 14. отчёт полезности: удаление ребра
{ const nodes = plan.nodes.map((n) => n.id); const A = new Map(); for (const e of E) { for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) { if (!A.has(a)) A.set(a, []); A.get(a).push([b, e.len, e.id]); } }
  const src = E.filter((e) => e.existing).flatMap((e) => [e.from, e.to]);
  const dij = (skip) => { const d = new Map(); const q = []; for (const s of src) { d.set(s, 0); q.push([0, s]); } while (q.length) { q.sort((a, b) => a[0] - b[0]); const [c, n] = q.shift(); if (c > d.get(n)) continue; for (const [m, w, id] of A.get(n) || []) { if (id === skip) continue; const nc = c + w; if (!(d.get(m) <= nc)) { d.set(m, nc); q.push([nc, m]); } } } return d; };
  const tgt = []; for (const l of plan.lots) { const e = E.find((q) => q.id === l.frontEdge); let s = 0, bd = 1e9, acc = 0; for (let i = 1; i < e.pts.length; i++) { const l0 = dist(e.pts[i - 1], e.pts[i]); const q = Math.min(dist(l.door, e.pts[i - 1]), dist(l.door, e.pts[i])); if (q < bd) { bd = q; s = acc + (dist(l.door, e.pts[i - 1]) < dist(l.door, e.pts[i]) ? 0 : l0); } acc += l0; } tgt.push({ id: l.id, e: e.id, f: e.from, t: e.to, s, len: e.len }); }
  for (const st of plan.stations) for (const a of st.access || []) { const e = E.find((q) => q.id === a); tgt.push({ id: st.id, e: e.id, f: e.from, t: e.to, s: e.len / 2, len: e.len }); }
  const dist0 = dij(null); const dOf = (t, d, skip) => { if (t.e === skip) return Infinity; return Math.min((d.get(t.f) ?? Infinity) + t.s, (d.get(t.t) ?? Infinity) + t.len - t.s); };
  const base = tgt.map((t) => dOf(t, dist0, null)); const rep = [], red = [];
  for (const e of RoadE) { const d = dij(e.id); let hit = 0, strand = 0, lots = (servedBy[e.id] || []).length; tgt.forEach((t, i) => { const v = dOf(t, d, e.id); if (!isFinite(v)) strand++; else if (v > base[i] + 0.5) hit++; });
    const parts = []; if (lots) parts.push(`${lots} лотов на фасаде`); if (strand) parts.push(`без неё ${strand} целей недостижимы`); if (hit) parts.push(`удлиняет путь ${hit} целям`); if (e.cls === 'ramp') parts.push('съезд развязки'); if (e.role === 'spine' || e.role === 'transport') parts.push('иерархия ' + (e.why || e.role));
    const needed = lots > 0 || strand > 0 || hit > 0 || e.cls === 'ramp' || e.role === 'spine' && ['arterial', 'avenue', 'expressway'].includes(e.cls) || ['district-link', 'cul-de-sac'].includes(e.role) && (lots > 0 || strand > 0 || hit > 0 || e.why);
    rep.push({ id: e.id, name: e.name, cls: e.cls, len: Math.round(e.len), lots, strand, hit, needed, why: parts.join('; ') || '—' }); if (!needed) red.push(e.id); }
  chk('нет бесполезных/дублирующих дорог (удаление ребра ухудшает путь хотя бы одной цели или ребро - иерархия/фасад/съезд)', red.length === 0, red.join(' '));
  plan.__report = rep; }
// 15. бюджет: оценка мешей по чанкам 60 м
{ const chunks = new Map(); const key = (p) => `${Math.floor((p[0] + 190) / 60)},${Math.floor((p[1] + 170) / 60)}`; for (const e of RoadE) { const s = new Set(e.pts.map(key)); s.forEach((k) => { const c = chunks.get(k) || { roads: 0, lots: 0 }; c.roads++; chunks.set(k, c); }); } for (const l of plan.lots) { const k = key(l.door), c = chunks.get(k) || { roads: 0, lots: 0 }; c.lots++; chunks.set(k, c); }
  const worst = Math.max(...[...chunks.values()].map((c) => (c.roads ? 4 : 0) + Math.min(8, new Set(plan.lots.filter((l) => key(l.door) === 0).map((l) => l.kind)).size))); const ic = 8, estPerChunk = 4 + 5; rows.push(['INFO', 'чанков 60 м с планом', String(chunks.size)]); rows.push(['INFO', 'оценка мешей', `дороги 4 меша/чанк + лоты ≤ 5 InstancedMesh/чанк; развязка IC-1 ≤ ${ic} мешей; в худшем кадре (3-4 чанка) ≈ ${estPerChunk * 4 + ic} мешей, ≤ 40 вызовов`]); }

// ---- вывод ------------------------------------------------------------------------------------------------------------------------
const widths = [5, 0]; console.log('\nВАЛИДАТОР ПЛАНА B (v2)\n' + '='.repeat(100));
for (const [st, name, detail] of rows) console.log(`${st} ${name}${detail ? '  |  ' + detail : ''}`);
const J2 = junctions(plan), types = J2.reduce((m, j) => (m[j.type] = (m[j.type] || 0) + 1, m), {});
const summary = { edges: RoadE.length, ringEdges: E.length - RoadE.length, nodes: plan.nodes.length, junctions: J2.length, junctionTypes: types, rails: RAILS.length, lots: plan.lots.length, blocks: plan.blocks.length, pads: plan.pads.length, deadEnds: deadAll.length, culDeSacs: culFinal.length, exits: exitsFinal.length, redundant: (plan.__report || []).filter((r) => !r.needed).length, lenRoadsM: Math.round(RoadE.reduce((s, e) => s + e.len, 0)), lenRailM: Math.round(RAILS.reduce((s, e) => s + e.len, 0)), fails: fails.length, warns };
console.log('\nИТОГО', JSON.stringify(summary));
if (REPORT || JSON_OUT) { console.log('\nОТЧЁТ ПОЛЕЗНОСТИ ДОРОГ\nid | класс | длина | лотов | обоснование'); for (const r of plan.__report) console.log(`${r.id.padEnd(16)} ${r.cls.padEnd(10)} ${String(r.len).padStart(4)} м ${String(r.lots).padStart(3)}  ${r.needed ? '' : 'ИЗБЫТОЧНА! '}${r.why}`); }
if (JSON_OUT) fs.writeFileSync(new URL('validate-report.json', import.meta.url), JSON.stringify({ summary, report: plan.__report, junctions: J2 }, null, 1));
if (fails.length) { console.log('\nНАРУШЕНИЙ: ' + fails.length); fails.forEach((f) => console.log(' - ' + f)); process.exit(1); } else console.log('\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
