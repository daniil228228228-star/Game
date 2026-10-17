// План B v2 (канонический): линейный город на сетке вдоль реки. Пишет plan-B.json (чистая модель: узлы, рёбра с дугами/радиусами, перекрёстки,
// районы, кварталы, лоты с фасадом и дверью, рельсы, станция, развязка, мосты, площадки-кружки, существующее).
//   node tools/masterplan/build-B.mjs     затем    node tools/masterplan/validate.mjs
import fs from 'node:fs';
import { P, dir, dist, r1, r2, trace, lineSegs, arcSeg, tess, segsLen, minRadius, segsStart, segsEnd, rect, polyPolylineDist, polyPolyDist, polyArea, arcLots, norm, D2R, centroid } from './geo.mjs';
import { CLS, off, junctions } from './net.mjs';
import { makePads, PHASE_INFO, GATE, STAGE_COST } from './phases.mjs';

const HERE = new URL('.', import.meta.url);
const EX = JSON.parse(fs.readFileSync(new URL('existing.json', HERE), 'utf8'));
const LIVE = JSON.parse(fs.readFileSync(new URL('live-colliders.json', HERE), 'utf8'));
const R1 = 57.4;
const plan = { id: 'B', version: 2, name: 'План B (финал): линейный город на сетке вдоль реки', world: { x0: -190, x1: 215, z0: -170, z1: 242 }, nodes: [], edges: [], rails: [], railNodes: [], water: [], districts: [], blocks: [], lots: [], stations: [], interchanges: [], bridges: [], tunnels: [], levelCrossings: [], landmarks: [], pads: [], nodeById: {} };

// ---- узлы ----------------------------------------------------------------------------------------------------------------------
const nkey = new Map();
function N(x, z, o = {}) {
  const k = `${r1(x)},${r1(z)}`; if (nkey.has(k)) { const n = plan.nodeById[nkey.get(k)]; Object.assign(n, Object.fromEntries(Object.entries(o).filter(([a]) => a !== 'id'))); return n.id; }
  const id = o.id || `N${plan.nodes.length + 1}`; const n = { id, x: r2(x), z: r2(z), type: 'link', phase: 1, ...o }; n.id = id; plan.nodes.push(n); plan.nodeById[id] = n; nkey.set(k, id); return id;
}
const NP = (p, o) => N(p[0], p[1], o);

// ---- рёбра ---------------------------------------------------------------------------------------------------------------------
function E(id, name, cls, a, b, segs, o = {}) {
  const c = CLS[cls]; const pts = tess(segs, 2);
  const e = { id, name, cls, w: o.w ?? c.w, sw: o.sw ?? c.sw, lanes: o.lanes ?? c.lanes, from: a, to: b, segs: segs.map((s) => s.k === 'L' ? { k: 'L', a: s.a.map(r2), b: s.b.map(r2) } : { k: 'A', c: s.c.map(r2), r: r2(s.r), a0: r2(s.a0), a1: r2(s.a1) }), pts: pts.map((p) => p.map(r2)), len: r2(segsLen(segs)), minR: minRadius(segs) === Infinity ? null : r2(minRadius(segs)), phase: 1, level: 0, ...o };
  delete e.w_; plan.edges.push(e); return e;
}
// прямая через точки; узлы в каждой точке; id = id-1, id-2 ...
function LINE(id, name, cls, pts, o = {}) {
  const ids = pts.map((p, i) => NP(p, i === 0 ? (o.n0 || {}) : i === pts.length - 1 ? (o.n1 || {}) : (o.nm?.[i] || {})));
  return pts.slice(1).map((b, i) => E(pts.length > 2 ? `${id}-${i + 1}` : id, name, cls, ids[i], ids[i + 1], lineSegs([pts[i], b]), { ...o.e, ...(o.per?.[i] || {}) }));
}

// ---- сетка ---------------------------------------------------------------------------------------------------------------------
const XS = { W: -102, W2: -48, A: 6, X54: 54, H: 102, X150: 150, XE: 198 };
const ZS = { NC: -148, NAV: -100, Z52: -52, MAIN: 0, C48: 48, C100: 100, M2: 140, Q: 180, SB: 220 };
const { W, W2, A, X54, H, X150, XE } = XS, { NC, NAV, Z52, MAIN, C48, C100, M2, Q, SB } = ZS;
const aN = Math.sqrt(R1 * R1 - A * A); // z узла кольца на x=6

// существующее кольцо: пять узлов, дуги по часовой
const ringNodes = [['E', 0, 'Главный проспект'], ['S', Math.atan2(aN, A) / D2R, 'Южный проспект'], ['WF', 124, 'Набережная (хаб Набережная)'], ['PORT', 168, 'Порт'], ['N', 360 - Math.atan2(aN, A) / D2R, 'Северный проспект']];
const RN = {}; ringNodes.forEach(([k, th, nm]) => { const p = P(th, R1); RN[k] = N(p[0], p[1], { id: 'N-R1-' + k, type: 'roundabout', r: 9, existing: 'E-RING', name: `Узел кольца: ${nm}`, th: r2(th), phase: k === 'PORT' ? 1 : k === 'N' ? 2 : k === 'E' ? 3 : k === 'S' ? 4 : 7 }); });
ringNodes.forEach(([k, th], i) => { const [k2, th2] = ringNodes[(i + 1) % 5]; const t2 = th2 > th ? th2 : th2 + 360; E(`E-RING-${k}${k2}`, 'Кольцо-1 (существует)', 'ring', RN[k], RN[k2], [arcSeg([0, 0], R1, th, t2)], { phase: 0, existing: true, role: 'existing' }); });
[['suburb', -46, -34], ['industrial', 43, -35], ['business', 45, 34], ['waterfront', -42, 38]].forEach(([k, x, z]) => N(x, z, { id: 'N-HUB-' + k, type: 'existing-hub', r: 4, existing: 'E-HUB-' + k, name: 'Хаб ' + k, phase: 0 }));

// ---- ПОРТ и набережная ЮЗ (радиальные плечи + дуга r = RQ) -------------------------------------------------------------------------
const RQ = Math.hypot(A, C100); const thQS = Math.atan2(C100, A) / D2R; // дуга набережной приходит в (6,100)
const QX = (th) => P(th, RQ);
N(...QX(thQS), { id: 'N-J-S100', type: 'cross', phase: 4 });
N(...QX(124), { id: 'N-Q-WF', type: 'T', phase: 7 }); N(...QX(150), { id: 'N-Q-150', type: 'link', phase: 1 }); N(...QX(168), { id: 'N-Q-PORT', type: 'T', phase: 1 }); N(...QX(182), { id: 'N-Q-END', type: 'cul-de-sac', r: 6, phase: 1 });
E('B-PORT', 'Портовая авеню', 'avenue', RN.PORT, 'N-Q-PORT', lineSegs([P(168, R1), QX(168)]), { phase: 1, pad: 'B01', role: 'district-link', why: 'порт <-> кольцо-1; единственный въезд тяжёлого транспорта к причалу' });
const pierEnd = P(168, 130); N(...pierEnd, { id: 'N-PIER', type: 'cul-de-sac', r: 6, phase: 1 });
E('B-PIER', 'Пирс (грузовой причал)', 'collector', 'N-Q-PORT', 'N-PIER', lineSegs([QX(168), pierEnd]), { phase: 1, pad: 'B02', role: 'cul-de-sac', why: 'тупик-пирс, по обе стороны лоты порта' });
E('B-QUAY-4', 'Причальная (запад)', 'quay', 'N-Q-PORT', 'N-Q-END', [arcSeg([0, 0], RQ, 168, 182)], { phase: 1, pad: 'B02', role: 'cul-de-sac', why: 'западный конец набережной, фасад лотов порта, разворотный круг' });
E('B-QUAY-3', 'Причальная (восток, порт)', 'quay', 'N-Q-150', 'N-Q-PORT', [arcSeg([0, 0], RQ, 150, 168)], { phase: 1, pad: 'B02', role: 'cul-de-sac', why: 'пока тупик в фазе 1; фасад лотов порта; продлевается в фазе 7' });
E('B-QUAY-2', 'Набережная ЮЗ (порт-хаб)', 'quay', 'N-Q-WF', 'N-Q-150', [arcSeg([0, 0], RQ, 124, 150)], { phase: 7, pad: 'B16', role: 'spine', why: 'связь порта с Набережной и Южным проспектом в обход ядра (грузовой объезд)' });
E('B-QUAY-1', 'Набережная ЮЗ (к Южному проспекту)', 'quay', 'N-J-S100', 'N-Q-WF', [arcSeg([0, 0], RQ, thQS, 124)], { phase: 7, pad: 'B16', role: 'spine', why: 'замыкает кольцо порт - набережная - Южный проспект' });
E('B-WF-LINK', 'Набережная - хаб (соединение)', 'collector', RN.WF, 'N-Q-WF', lineSegs([P(124, R1), QX(124)]), { phase: 7, pad: 'B16', role: 'district-link', why: 'хаб «Набережная» <-> набережная' });

// ---- СЕВЕР: Северный проспект, Северная магистраль, NC, внутренние улицы ------------------------------------------------------------------
LINE('B-N', 'Северный проспект', 'avenue', [[A, -aN], [A, NAV], [A, NC]], { e: { phase: 2, pad: 'B03', role: 'spine' }, n0: {}, per: [{}, {}] });
LINE('B-NAV-W', 'Северная магистраль (запад)', 'arterial', [[W, NAV], [W2, NAV], [A, NAV]], { e: { phase: 2, pad: 'B04', role: 'spine', why: 'хребет квартала NW' } });
LINE('B-NAV-E1', 'Северная магистраль', 'arterial', [[A, NAV], [X54, NAV], [H, NAV]], { e: { phase: 2, pad: 'B05', role: 'spine' } });
LINE('B-NAV-E2', 'Северная магистраль (восток)', 'arterial', [[H, NAV], [X150, NAV], [XE, NAV]], { e: { phase: 3, pad: 'B08', role: 'spine' } });
LINE('B-NC-W', 'Северная улица (запад)', 'local', [[W, NC], [W2, NC], [A, NC]], { e: { phase: 2, pad: 'B04', role: 'frontage' } });
LINE('B-NC-E1', 'Северная улица', 'collector', [[A, NC], [X54, NC], [H, NC]], { e: { phase: 2, pad: 'B05', role: 'frontage' } });
LINE('B-NC-E2', 'Северная улица (восток)', 'collector', [[H, NC], [X150, NC], [XE, NC]], { e: { phase: 3, pad: 'B08', role: 'frontage' } });
LINE('B-X-W', 'Западная улица', 'local', [[W, NC], [W, NAV]], { e: { phase: 2, pad: 'B04', role: 'frontage' } });
LINE('B-X-W2', 'Средняя улица NW', 'local', [[W2, NC], [W2, NAV]], { e: { phase: 2, pad: 'B04', role: 'frontage' } });
LINE('B-X-54', 'Улица Промпарка', 'collector', [[X54, NC], [X54, NAV]], { e: { phase: 2, pad: 'B05', role: 'frontage' } });
// Восточная хорда (Horda, магистраль x=102)
LINE('B-H-N', 'Восточная хорда', 'arterial', [[H, NC], [H, NAV], [H, Z52], [H, MAIN], [H, C48], [H, C100]], { e: { phase: 3, pad: 'B07', role: 'spine' } });
LINE('B-X150', 'Улица 150', 'collector', [[X150, NC], [X150, NAV], [X150, Z52], [X150, MAIN], [X150, C48]], { e: { phase: 3, pad: 'B08', role: 'frontage' } });
LINE('B-XE', 'Восточная окружная', 'collector', [[XE, NC], [XE, NAV], [XE, Z52], [XE, MAIN], [XE, C48]], { e: { phase: 3, pad: 'B08', role: 'frontage' } });
// Главный проспект
LINE('B-MAIN-1', 'Главный проспект', 'avenue', [[R1, 0], [H, MAIN]], { e: { phase: 3, pad: 'B06', role: 'spine' } });
LINE('B-MAIN-2', 'Главный проспект (восток)', 'avenue', [[H, MAIN], [X150, MAIN], [XE, MAIN]], { e: { phase: 3, pad: 'B09', role: 'spine' } });
LINE('B-Z52', 'Улица -52', 'collector', [[H, Z52], [X150, Z52], [XE, Z52]], { e: { phase: 3, pad: 'B09', role: 'frontage' } });
LINE('B-C48', 'Привокзальная улица (север)', 'collector', [[H, C48], [X150, C48], [XE, C48]], { e: { phase: 3, pad: 'B10', role: 'frontage' } });

// ---- ЮГ: Южный проспект, C100, M2, развязка, Q180, мост ----------------------------------------------------------------------------
const S1 = E('B-S-1', 'Южный проспект', 'avenue', RN.S, 'N-J-S100', lineSegs([[A, aN], [A, C100]]), { phase: 4, pad: 'B11', role: 'spine' });
N(A, M2, { id: 'N-M2-RB', type: 'terminal-roundabout', r: 14, phase: 4, name: 'Круг М2 × Южный проспект' }); N(A, Q, { id: 'N-J-SQ', type: 'cross', phase: 4 });
E('B-S-2', 'Южный проспект', 'avenue', 'N-J-S100', 'N-M2-RB', lineSegs([[A, C100], [A, M2]]), { phase: 4, pad: 'B11', role: 'spine' });
E('B-S-3', 'Южный проспект', 'avenue', 'N-M2-RB', 'N-J-SQ', lineSegs([[A, M2], [A, Q]]), { phase: 4, pad: 'B11', role: 'spine' });
// Развязка IC-1: диамант с боковыми проездами (Texas diamond). Съезды = дуга большого радиуса (раскрытие 12°) + дуга R2, всё касательно.
const LANE = 5.25, RR = 33, R1T = 100, PHI = 12, XW = 78, XEs = 126; // XW/XEs: x, где съезд встаёт на боковой проезд
function rampOps(R2) { return [['A', R1T, PHI], ['A', R2, 90 - PHI]]; }
function solveR2(north) { let lo = 20, hi = 80; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2, t = trace([0, 0], 180, rampOps(m)); const n = -t.end[1]; if (n < north) lo = m; else hi = m; } return (lo + hi) / 2; }
const R2 = solveR2(RR + 0 - (R1T * (1 - Math.cos(PHI * D2R)) * 0)), tt = trace([0, 0], 180, rampOps(R2)), DXR = -tt.end[0], DZR = -tt.end[1];
// DZR = RR (смещение от полосы М2 до оси бокового проезда минус 1.75 хвоста)
const TAIL = C100 + (M2 - LANE - C100) - (M2 - LANE - RR); // = C100 - (M2-LANE-RR)  (хвост)
const zN = M2 - LANE, zS = M2 + LANE; // оси внешних полос М2: северная (запад-бound) и южная (восток-bound)
const tail = (zN - DZR) - C100; // 'хвост' до оси C100
const XM_E = XEs + DXR, XM_W = XW - DXR; // x врезки в М2 (восточная пара и западная пара)
N(XM_E, M2, { id: 'N-M2-E', type: 'merge', r: 7, phase: 4, name: 'Врезка съездов (восток)' }); N(XM_W, M2, { id: 'N-M2-W', type: 'merge', r: 7, phase: 4, name: 'Конец скоростной / врезка съездов (запад)' });
N(XW, C100, { id: 'N-C100-W', type: 'T', phase: 4 }); N(XEs, C100, { id: 'N-C100-E', type: 'T', phase: 4 }); N(XW, Q, { id: 'N-Q-W', type: 'T', phase: 4 }); N(XEs, Q, { id: 'N-Q-E', type: 'T', phase: 4 });
N(H, C100, { id: 'N-J-H100', type: 'cross', phase: 3 }); N(H, Q, { id: 'N-J-HQ', type: 'cross', phase: 4 });
function ramp(id, name, from, to, startPose, heading, ops, o) { const t = trace(startPose, heading, ops); return E(id, name, 'ramp', from, to, t.segs, { oneway: true, phase: 4, pad: 'B12', role: 'ramp', ...o }); }
const tailL = Math.max(0.01, tail);
// съезд с М2 на C100 (WB, северная сторона, восточнее Хорды): стартует на полосе М2, идёт на запад, направо на север
ramp('B-IC1-WB-OFF', 'Съезд WB (М2 -> C100)', 'N-M2-E', 'N-C100-E', [XM_E, zN], 180, [...rampOps(R2), ['L', tailL]], { ramp: 'off', dirTxt: 'запад' });
// въезд на М2 (WB, западнее Хорды): с C100 на юг, направо на запад
ramp('B-IC1-WB-ON', 'Въезд WB (C100 -> М2)', 'N-C100-W', 'N-M2-W', [XW, C100], 90, [['L', tailL], ['A', R2, 90 - PHI], ['A', R1T, PHI]], { ramp: 'on' });
// EB: съезд (западнее Хорды) на Q: с М2 на восток, направо на юг
ramp('B-IC1-EB-OFF', 'Съезд EB (М2 -> Q180)', 'N-M2-W', 'N-Q-W', [XM_W, zS], 0, [...rampOps(R2), ['L', tailL]], { ramp: 'off' });
// въезд EB (восточнее Хорды): с Q на север, направо на восток
ramp('B-IC1-EB-ON', 'Въезд EB (Q180 -> М2)', 'N-Q-E', 'N-M2-E', [XEs, Q], 270, [['L', tailL], ['A', R2, 90 - PHI], ['A', R1T, PHI]], { ramp: 'on' });
// М2: скоростная от края до N-M2-E, траншея, до N-M2-W; затем магистральная вставка до круга
N(210, M2, { id: 'N-M2-EXIT', type: 'exit', phase: 4, name: 'М2 на восток (за картой)' }); N(154, M2, { id: 'N-M2-TE', type: 'structure', phase: 4 }); N(50, M2, { id: 'N-M2-TW', type: 'structure', phase: 4 });
E('B-M2-1', 'Скоростная магистраль М2', 'expressway', 'N-M2-EXIT', 'N-M2-E', lineSegs([[210, M2], [XM_E, M2]]), { phase: 4, pad: 'B12', role: 'spine' });
E('B-M2-2', 'М2 (въезд в траншею)', 'expressway', 'N-M2-E', 'N-M2-TE', lineSegs([[XM_E, M2], [154, M2]]), { phase: 4, pad: 'B12', role: 'spine' });
E('B-M2-3', 'М2 (траншея под Хордой)', 'expressway', 'N-M2-TE', 'N-M2-TW', lineSegs([[154, M2], [50, M2]]), { phase: 4, pad: 'B12', level: -1, trench: { profile: [[154, 0], [111, -3], [93, -3], [50, 0]], depth: 3, grade: 0.07, clearance: 3.0 }, role: 'spine' });
E('B-M2-4', 'М2 (выход из траншеи)', 'expressway', 'N-M2-TW', 'N-M2-W', lineSegs([[50, M2], [XM_W, M2]]), { phase: 4, pad: 'B12', role: 'spine' });
E('B-M2-5', 'Южная магистраль (М2 в город)', 'arterial', 'N-M2-W', 'N-M2-RB', lineSegs([[XM_W, M2], [A, M2]]), { phase: 4, pad: 'B11', role: 'spine', why: 'конец скоростной, переход в магистраль, круг у Южного проспекта' });
// C100 и Q180: боковые проезды
LINE('B-C100-W', 'Южная улица (C100, запад)', 'collector', [[A, C100], [XW, C100], [H, C100]], { e: { phase: 4, pad: 'B11', role: 'frontage' } });
LINE('B-C100-E', 'Южная улица (C100, восток)', 'collector', [[H, C100], [XEs, C100], [XE, C100]], { e: { phase: 4, pad: 'B12', role: 'frontage', why: 'боковой проезд развязки + фасад складов' }, n1: { type: 'cul-de-sac', r: 6, id: 'N-C100-END' } });
LINE('B-Q-W', 'Набережная юг (Q180, запад)', 'collector', [[A, Q], [XW, Q], [H, Q]], { e: { phase: 4, pad: 'B12', role: 'transport', why: 'боковой проезд развязки + спуск к мосту' } });
LINE('B-Q-E', 'Набережная юг (Q180, восток)', 'collector', [[H, Q], [XEs, Q]], { e: { phase: 4, pad: 'B12', role: 'transport', why: 'боковой проезд развязки (въезд EB)' } });
// Хорда через М2 и вниз до Q
const hz = [[H, C100], [H, 127], [H, 153], [H, Q]];
const hb = LINE('B-H-S', 'Восточная хорда (юг)', 'arterial', hz, { e: { phase: 4, pad: 'B12', role: 'spine' }, nm: { 1: { type: 'structure' }, 2: { type: 'structure' } } });
plan.edges.find((e) => e.id === 'B-H-S-2').overpass = { over: 'B-M2-3', deckW: 10.8, clearSpan: 18, level: 0 }; plan.edges.find((e) => e.id === 'B-H-S-2').name = 'Хорда (путепровод над М2)';
// мост через эстуарий и Южный берег
N(A, SB, { id: 'N-J-SB', type: 'T', phase: 7 }); N(-22, SB, { id: 'N-SB-W', type: 'cul-de-sac', r: 7, phase: 8 }); N(62, SB, { id: 'N-SB-E', type: 'cul-de-sac', r: 7, phase: 8 });
E('B-S-BR', 'Южный мост', 'avenue', 'N-J-SQ', 'N-J-SB', lineSegs([[A, Q], [A, SB]]), { phase: 7, pad: 'B17', role: 'transport', bridge: { s0: 10, s1: 34, water: 'W-EST', clear: 3, span: 20 }, why: 'единственная связь Южного берега (стадион, парк) с городом' });
E('B-SB-W', 'Улица Южного берега (запад)', 'collector', 'N-J-SB', 'N-SB-W', lineSegs([[A, SB], [-22, SB]]), { phase: 8, pad: 'B18', role: 'cul-de-sac' });
E('B-SB-E', 'Улица Южного берега (восток)', 'collector', 'N-J-SB', 'N-SB-E', lineSegs([[A, SB], [62, SB]]), { phase: 8, pad: 'B18', role: 'cul-de-sac' });
plan.water.push({ id: 'W-EST', name: 'Река Южная (эстуарий)', kind: 'river', w: 20, z0: 192, z1: 212, poly: rect(-30, 192, 215, 212), phase: 4 });
plan.bridges.push({ id: 'BR-S', edge: 'B-S-BR', name: 'Южный мост', span: 20, deck: 12.2, level: 1, approach: [10, 6], water: 'W-EST' });

// ---- РЕЛЬСЫ ---------------------------------------------------------------------------------------------------------------------------
const RNX = (id, x, z, type, phase = 5) => { plan.railNodes.push({ id, x: r2(x), z: r2(z), type, phase }); return id; };
function RL(id, name, kind, a, b, segs, o = {}) { const pts = tess(segs, 2); const r = { id, name, kind, tracks: 1, from: a, to: b, segs: segs.map((s) => s.k === 'L' ? { k: 'L', a: s.a.map(r2), b: s.b.map(r2) } : { k: 'A', c: s.c.map(r2), r: r2(s.r), a0: r2(s.a0), a1: r2(s.a1) }), pts: pts.map((p) => p.map(r2)), len: r2(segsLen(segs)), minR: minRadius(segs) === Infinity ? null : r2(minRadius(segs)), phase: 5, level: 0, ...o }; plan.rails.push(r); return r; }
const TN = 74, TS = 80, RS = 40; const phiOf = (d, R = RS) => Math.acos(1 - d / (2 * R)) / D2R;
RNX('RN-EXN', 210, TN, 'exit'); RNX('RN-EXS', 210, TS, 'exit'); RNX('RN-SWN', 206, TN, 'switch'); RNX('RN-SWS', 206, TS, 'switch'); RNX('RN-BN', 112, TN, 'bumper'); RNX('RN-BS', 112, TS, 'bumper');
RL('R-N-1', 'Главный путь N (вход)', 'main', 'RN-EXN', 'RN-SWN', lineSegs([[210, TN], [206, TN]]), { pad: 'B13' });
RL('R-N-2', 'Главный путь N / станционный путь 1', 'main', 'RN-SWN', 'RN-BN', lineSegs([[206, TN], [112, TN]]), { pad: 'B13' });
RL('R-S-1', 'Главный путь S (вход)', 'main', 'RN-EXS', 'RN-SWS', lineSegs([[210, TS], [206, TS]]), { pad: 'B13' });
RL('R-S-2', 'Главный путь S / станционный путь 2', 'main', 'RN-SWS', 'RN-BS', lineSegs([[206, TS], [112, TS]]), { pad: 'B13' });
// грузовой парк (север): ход налево от пути N, затем прямой участок и ответвление второго пути
const fy = trace([206, TN], 180, [['A', RS, phiOf(8)], ['A', RS, -phiOf(8)]]); const fyEnd = fy.end; // конец S-кривой
RNX('RN-Y1A', fyEnd[0], fyEnd[1], 'link'); RNX('RN-Y1B', 150, fyEnd[1], 'bumper'); RNX('RN-Y2SW', 168, fyEnd[1], 'switch'); 
RL('R-Y-LEAD', 'Ход в грузовой парк', 'yard', 'RN-SWN', 'RN-Y1A', fy.segs, { pad: 'B13' });
RL('R-Y1-A', 'Парковый путь 1', 'yard', 'RN-Y1A', 'RN-Y2SW', lineSegs([fyEnd, [168, fyEnd[1]]]), { pad: 'B13' });
RL('R-Y1-B', 'Парковый путь 1 (тупик)', 'yard', 'RN-Y2SW', 'RN-Y1B', lineSegs([[168, fyEnd[1]], [150, fyEnd[1]]]), { pad: 'B13' });
const y2 = trace([168, fyEnd[1]], 180, [['A', RS, phiOf(4)], ['A', RS, -phiOf(4)]]); RNX('RN-Y2B', y2.end[0], y2.end[1], 'bumper');
RL('R-Y2', 'Парковый путь 2', 'yard', 'RN-Y2SW', 'RN-Y2B', y2.segs, { pad: 'B13' });
// ветка к складам (юг)
const sd = trace([206, TS], 180, [['A', RS, -phiOf(6)], ['A', RS, phiOf(6)]]); RNX('RN-SDA', sd.end[0], sd.end[1], 'link'); RNX('RN-SDB', 152, sd.end[1], 'bumper');
RL('R-SID-1', 'Ветка к складам', 'siding', 'RN-SWS', 'RN-SDA', sd.segs, { pad: 'B14' });
RL('R-SID-2', 'Ветка к складам (тупик у складов)', 'siding', 'RN-SDA', 'RN-SDB', lineSegs([sd.end, [152, sd.end[1]]]), { pad: 'B14' });
// станция
const st = { id: 'ST-PAX', name: 'Южный вокзал', kind: 'terminus', phase: 6, pad: 'B15', tracks: ['R-N-2', 'R-S-2'],
  building: rect(116, 56, 140, 64), plaza: rect(110, 51.9, 148, 56), platforms: [rect(114, 69.8, 138, 72.8), rect(114, 81.2, 138, 84.2)], bus: rect(112, 87, 146, 95), underpass: [[127, 60], [127, 86]], entrance: [128, 51.9], bumpers: ['RN-BN', 'RN-BS'], access: ['B-C48-1', 'B-C100-E-1'] };
plan.stations.push(st);
plan.stations.push({ id: 'ST-FRT', name: 'Грузовой парк', kind: 'freight-yard', phase: 5, pad: 'B13', tracks: ['R-Y-LEAD', 'R-Y1-A', 'R-Y1-B', 'R-Y2'], area: rect(142, 57, 208, 70) });
plan.stations.push({ id: 'ST-WH', name: 'Склады (подъездная ветка)', kind: 'siding-zone', phase: 5, pad: 'B14', access: ['B-C100-E-2'], tracks: ['R-SID-1', 'R-SID-2'], area: rect(150, 82, 208, 87) });

// ---- ВОДА / СУША -----------------------------------------------------------------------------------------------------------------
const shoreR = 120;
{
  const th0 = Math.acos(-26 / (shoreR - 18)) / D2R; // x = -26 на береговой дуге
  const arcPts = []; for (let t = 104; t <= 190; t += 2) arcPts.push(P(t, shoreR));
  plan.land = [[-190, -165], [212, -165], [212, 240], [-26, 240], [-26, Math.sqrt(shoreR * shoreR - 26 * 26)], ...arcPts.filter((p) => p[0] < -26.1), [-118, -35], [-125, -90], [-125, -165]].map((p) => p.map(r1));
  plan.land.push(...[]);
  // порт вдаётся пирсом за береговую дугу
  plan.pierLand = rect(...[P(168, 100)[0] - 22, 0, 0, 0]).length ? null : null;
}
plan.piers = [{ id: 'PIER-1', poly: (() => { const u = dir(168), n = dir(258), a = P(168, 96), b = P(168, 138); const w = 22; return [[a[0] + n[0] * w, a[1] + n[1] * w], [b[0] + n[0] * w, b[1] + n[1] * w], [b[0] - n[0] * w, b[1] - n[1] * w], [a[0] - n[0] * w, a[1] - n[1] * w]].map((p) => p.map(r1)); })() }];

// ---- КВАРТАЛЫ и ЛОТЫ ------------------------------------------------------------------------------------------------------------------
const KIND = { 'res-low': { d: 6.2, f: 6.6 }, 'res-mid': { d: 7.0, f: 8.0 }, cbd: { d: 8.4, f: 9.6 }, 'industry-light': { d: 12, f: 16 }, mixed: { d: 6.6, f: 7.6 }, port: { d: 12, f: 9.5 }, waterfront: { d: 8, f: 10 }, sport: { d: 12, f: 22 }, warehouse: { d: 7, f: 12 } };
const edgeIndex = () => plan.edges.filter((e) => !e.existing);
function frontEdgeOf(door) { let best = null, bd = 1e9; for (const e of plan.edges) { if (e.existing || e.cls === 'ramp') continue; let d = Infinity; for (let i = 1; i < e.pts.length; i++) { const a = e.pts[i - 1], b = e.pts[i]; const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz, t = l2 ? Math.max(0, Math.min(1, ((door[0] - a[0]) * vx + (door[1] - a[1]) * vz) / l2)) : 0; d = Math.min(d, Math.hypot(door[0] - a[0] - vx * t, door[1] - a[1] - vz * t)); } const need = off(e.cls); const score = Math.abs(d - need); if (score < bd) { bd = score; best = e; } } return best; }
let lotN = 0; const pendingLots = [];
function addLot(o) { pendingLots.push(o); }
function stripLots(blockId, kind, a, b, n, extra = {}) { // фасадная линия a->b, нормаль внутрь n; глубина по виду
  const { d, f } = KIND[kind]; const L = dist(a, b), cnt = Math.floor(L / f); if (cnt < 1) return; const fw = L / cnt, ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
  for (let i = 0; i < cnt; i++) { const s0 = i * fw + 0.5, s1 = (i + 1) * fw - 0.5; const A_ = [a[0] + ux * s0, a[1] + uz * s0], B_ = [a[0] + ux * s1, a[1] + uz * s1]; addLot({ block: blockId, kind, poly: [A_, B_, [B_[0] + n[0] * d, B_[1] + n[1] * d], [A_[0] + n[0] * d, A_[1] + n[1] * d]], door: [(A_[0] + B_[0]) / 2, (A_[1] + B_[1]) / 2], normal: [-n[0], -n[1]], w: r1(s1 - s0), d, ...extra }); }
}
const BLOCKS = [ // id, x0,z0,x1,z1, вид, стороны N,S,W,E (класс улицы | null), фаза-описание
  ['NW1', W, NC, W2, NAV, 'res-low', 'local', 'arterial', 'local', 'local'], ['NW2', W2, NC, A, NAV, 'res-low', 'local', 'arterial', 'local', 'avenue'],
  ['NE1', A, NC, X54, NAV, 'industry-light', 'collector', 'arterial', 'avenue', 'collector'], ['NE2', X54, NC, H, NAV, 'industry-light', 'collector', 'arterial', 'collector', 'arterial'],
  ['NE3', H, NC, X150, NAV, 'industry-light', 'collector', 'arterial', 'arterial', 'collector'], ['NE4', X150, NC, XE, NAV, 'industry-light', 'collector', 'arterial', 'collector', 'collector'],
  ['E1a', H, NAV, X150, Z52, 'res-mid', 'arterial', 'collector', 'arterial', 'collector'], ['E1b', X150, NAV, XE, Z52, 'res-mid', 'arterial', 'collector', 'collector', 'collector'],
  ['CBD1', H, Z52, X150, MAIN, 'cbd', 'collector', 'avenue', 'arterial', 'collector'], ['CBD2', X150, Z52, XE, MAIN, 'cbd', 'collector', 'avenue', 'collector', 'collector'],
  ['CBD3', H, MAIN, X150, C48, 'cbd', 'avenue', 'collector', 'arterial', 'collector'], ['CBD4', X150, MAIN, XE, C48, 'cbd', 'avenue', 'collector', 'collector', 'collector']];
for (const [id, x0, z0, x1, z1, kind, cN, cS, cW, cE] of BLOCKS) {
  const oN = off(cN), oS = off(cS), oW = off(cW), oE = off(cE), { d } = KIND[kind];
  const ix0 = x0 + oW, ix1 = x1 - oE, iz0 = z0 + oN, iz1 = z1 - oS;
  plan.blocks.push({ id, kind, poly: rect(x0, z0, x1, z1), inner: rect(ix0, iz0, ix1, iz1), w: x1 - x0, h: z1 - z0, streets: { N: cN, S: cS, W: cW, E: cE } });
  stripLots(id, kind, [ix0, iz0], [ix1, iz0], [0, 1]); stripLots(id, kind, [ix1, iz1], [ix0, iz1], [0, -1]);
  stripLots(id, kind, [ix0, iz0 + d + 1], [ix0, iz1 - d - 1], [1, 0]); stripLots(id, kind, [ix1, iz1 - d - 1], [ix1, iz0 + d + 1], [-1, 0]);
}
// полосы вдоль C100 (север) и порт/набережная
{ const oc = off('collector'); stripLots('S-C100W', 'mixed', [off('avenue') + A + 1, C100 - oc], [H - off('arterial') - 1, C100 - oc], [0, -1]); stripLots('S-C100E', 'warehouse', [154, C100 - oc], [196, C100 - oc], [0, -1]); }
{ // пирс: по две стороны
  const u = dir(168), nL = dir(168 - 90), nR = dir(168 + 90), o = off('collector');
  for (const [side, nn] of [['L', nL], ['R', nR]]) { const a = P(168, 108), b = P(168, 128), s = [a[0] + nn[0] * o, a[1] + nn[1] * o], t = [b[0] + nn[0] * o, b[1] + nn[1] * o]; stripLots('S-PIER-' + side, 'port', s, t, nn); }
}
const lotsArc = (id, kind, th0, th1) => { const { d, f } = KIND[kind]; arcLots([0, 0], RQ + off('quay'), d, th0, th1, f).forEach((l) => addLot({ block: id, kind, ...l, w: f, d })); };
lotsArc('S-QPORT', 'port', 150, 181); lotsArc('S-QWF', 'waterfront', 90, 148);
// южный берег
{ const o = off('collector'); stripLots('S-SB-E', 'sport', [A + 6, SB + o], [60, SB + o], [0, 1]); stripLots('S-SB-W', 'sport', [-20, SB + o], [A - 6, SB + o], [0, 1]); }

// ---- ФИЛЬТР лотов: не пересекать дороги/рельсы/воду/станцию/друг друга и существующее ------------------------------------------------------------------
const stage = EX.stages.map((s, i) => { const items = LIVE.colliders.filter((c) => c.label === `stage:${i}` || c.label.startsWith(`stage:${i}:`)); const root = items.find((c) => c.label === `stage:${i}`); const cx = root ? root.x : s.bld[0], cz = root ? root.z : s.bld[1]; let rad = 0; items.forEach((c) => { rad = Math.max(rad, Math.hypot(c.x - cx, c.z - cz) + Math.hypot(c.hx || c.r || 0, c.hz || 0)); }); return { i, ru: s.ru, x: cx, z: cz, r: r2(Math.max(rad, 3)) }; }).filter((s) => s.i >= 0);
plan.existing = { ring: { r: R1, w: 5.6, nodes: ringNodes.map(([k]) => RN[k]) }, coreR: 70, hubs: EX.districts.map((d) => ({ id: d.id, ru: d.ru, x: d.hub[0], z: d.hub[1] })), stageBuildings: stage, plots: LIVE.plots, industrial: EX.industrial, market: EX.market, infra: EX.infra, signatures: EX.signatures, scenery: LIVE.colliders.filter((c) => c.cat === 'tree' || c.cat.startsWith('decor')).map((c) => [c.x, c.z, c.r ?? Math.max(c.hx || 0, c.hz || 0)]) };
const roadsForLots = plan.edges.filter((e) => !e.existing);
const dropped = [];
const keep = [];
for (const l of pendingLots) {
  let bad = null;
  for (const e of roadsForLots) { const need = (e.w / 2) + 0.3; if (polyPolylineDist(l.poly, e.pts) < need) { bad = 'road ' + e.id; break; } }
  if (!bad) for (const r of plan.rails) if (polyPolylineDist(l.poly, r.pts) < 2.5) { bad = 'rail ' + r.id; break; }
  if (!bad) for (const s of stage) if (Math.min(...l.poly.map((p) => dist(p, [s.x, s.z]))) < s.r + 10) { bad = 'stage'; break; }
  if (!bad) for (const q of plan.piers) if (l.block.startsWith('S-Q') && polyPolyDist(l.poly, q.poly) < 0) { bad = 'pier'; }
  if (!bad) for (const o of keep) if (polyPolyDist(l.poly, o.poly) < 0.9) { bad = 'lot ' + o.id; break; }
  if (!bad) for (const w of plan.water) if (polyPolyDist(l.poly, w.poly) < 1) { bad = 'water'; break; }
  if (!bad) for (const q of [st.building, st.plaza, st.bus, ...st.platforms, plan.stations[1].area, plan.stations[2].area]) if (polyPolyDist(l.poly, q) < 1.5) { bad = 'station'; break; }
  if (bad) { dropped.push(`${l.block}:${bad}`); continue; }
  const fe = frontEdgeOf(l.door);
  const id = `L${String(++lotN).padStart(3, '0')}`;
  keep.push({ id, block: l.block, kind: l.kind, poly: l.poly.map((p) => p.map(r2)), door: l.door.map(r2), normal: l.normal.map((v) => r2(v)), w: l.w, d: l.d, frontEdge: fe.id, phase: fe.phase, pad: fe.pad });
}
plan.lots = keep; plan.lotsDropped = dropped;

// ---- РАЙОНЫ -----------------------------------------------------------------------------------------------------------------------------
const D = (id, name, type, poly, phase, o = {}) => plan.districts.push({ id, name, type, poly: poly.map((p) => p.map(r1)), phase, ...o });
D('D-CORE', 'Старый город (ядро r<70, заморожено)', 'old', Array.from({ length: 72 }, (_, i) => P(i * 5, 70)), 0, { frozen: true, label: [0, 0] });
D('D-NW', 'Северо-западные кварталы', 'res-low', rect(W - 6, NC - 8, A, NAV + 4), 2);
D('D-NE', 'Индустриальный парк «Север-Восток»', 'industry-light', rect(A, NC - 8, XE + 8, NAV + 4), 2);
D('D-E1', 'Восточные кварталы (жилые)', 'res-mid', rect(H, NAV + 4, XE + 8, Z52), 3);
D('D-CBD', 'Деловой центр', 'cbd', rect(H, Z52, XE + 8, C48), 3);
D('D-PARKN', 'Северный парк', 'park', rect(A + 8, NAV + 8, H - 8, -62), 3);
D('D-PARKE', 'Парк «Заречье»', 'park', rect(H + 8, 54, 108, 54), 9, { skip: true });
D('D-STN', 'Привокзальный район', 'station', rect(108, C48 + 3, 148, 97), 6);
D('D-FRT', 'Грузовой парк', 'freight', rect(142, 57, 211, 70), 5);
D('D-WH', 'Склады', 'industry-light', rect(150, 83, 211, 98), 5);
D('D-SBELT', 'Южный пояс', 'mixed', rect(A + 8, 86, H - 8, 98), 4);
D('D-PARKS', 'Южный парк', 'park', rect(34, 72, H - 8, 86), 4);
D('D-COR', 'Транспортный коридор М2', 'service', rect(A + 8, 102, 211, 150), 4);
D('D-EMB', 'Набережная юг', 'waterfront', rect(A + 8, 152, 211, 190), 7);
D('D-SBANK', 'Южный берег: стадион, парк', 'park', rect(-24, 214, 80, 240), 8);
D('D-PORT', 'Порт', 'port', [P(150, 98), P(182, 98), P(182, 124), P(150, 124)], 1, { arc: true });
D('D-WF', 'Набережная ЮЗ', 'waterfront', [P(90, 100), P(148, 100), P(148, 120), P(90, 120)], 7, { arc: true });
plan.districts = plan.districts.filter((d) => !d.skip);
plan.landmarks.push({ id: 'LM-CRANES', name: 'Портовые краны', kind: 'crane', at: P(168, 125).map(r1), phase: 1 }, { id: 'LM-TOWER', name: 'Телебашня', kind: 'tower', at: [126, -26], phase: 3 }, { id: 'LM-STADIUM', name: 'Стадион', kind: 'stadium', at: [36, 226], phase: 8 }, { id: 'LM-AIR', name: 'Аэропорт (резерв за краем карты)', kind: 'airport', at: [200, 200], phase: 8 });

// ---- ПЛОЩАДКИ-КРУЖКИ -------------------------------------------------------------------------------------------------------------------------
const PADS = [
  ['B01', 'Узел «Порт» и Портовая авеню', 1, 0.25], ['B02', 'Пирс, причал и лоты порта', 1, 0.5],
  ['B03', 'Северный проспект', 2, 0.35], ['B04', 'Северо-западные кварталы', 2, 0.7], ['B05', 'Промпарк (запад) и Северная магистраль', 2, 0.8],
  ['B06', 'Главный проспект (к Хорде)', 3, 0.4], ['B07', 'Восточная хорда (север)', 3, 0.6], ['B08', 'Промпарк (восток) и окружная', 3, 0.7], ['B09', 'Главный проспект (восток), жилые кварталы', 3, 0.8], ['B10', 'Деловой центр', 3, 1.0],
  ['B11', 'Южный проспект и Южная улица', 4, 0.5], ['B12', 'М2 и развязка IC-1', 4, 1.0],
  ['B13', 'Железная дорога и грузовой парк', 5, 1.0], ['B14', 'Подъездная ветка и склады', 5, 0.5], ['B15', 'Южный вокзал', 6, 1.0],
  ['B16', 'Набережная ЮЗ', 7, 0.8], ['B17', 'Южный мост', 7, 0.7], ['B18', 'Южный берег: стадион', 8, 0.6]];
const REQ = { B02: ['B01'], B03: ['B01'], B04: ['B03'], B05: ['B03'], B06: ['B03'], B07: ['B05'], B08: ['B07'], B09: ['B06', 'B07'], B10: ['B09'], B11: ['B10'], B12: ['B11'], B13: ['B12'], B14: ['B13'], B15: ['B13'], B16: ['B11'], B17: ['B12', 'B16'], B18: ['B17'] };
const elems = (id) => [...plan.edges.filter((e) => e.pad === id).map((e) => e.id), ...plan.rails.filter((e) => e.pad === id).map((e) => e.id), ...plan.stations.filter((e) => e.pad === id).map((e) => e.id)];
const padsRaw = makePads(PADS.map(([id, name, ph, k]) => [id, name, ph, k, elems(id)]));
plan.pads = padsRaw.map((p) => { const first = plan.edges.find((e) => e.pad === p.id) || plan.rails.find((e) => e.pad === p.id); const pt = first ? first.pts[0] : [0, 0]; const lots = plan.lots.filter((l) => l.pad === p.id).length; return { ...p, requires: REQ[p.id] || [], pos: pt.map(r1), lots }; });
// фаза узла = минимум фаз смежных рёбер (кроме существующих)
for (const n of plan.nodes) { const ph = plan.edges.filter((e) => (e.from === n.id || e.to === n.id) && !e.existing).map((e) => e.phase); if (ph.length && n.phase !== undefined && !n.existing) n.phase = Math.min(...ph); }
// типы узлов по степени
const deg = {}; plan.edges.forEach((e) => { deg[e.from] = (deg[e.from] || 0) + 1; deg[e.to] = (deg[e.to] || 0) + 1; });
for (const n of plan.nodes) { if (['roundabout', 'terminal-roundabout', 'merge', 'cul-de-sac', 'exit', 'structure', 'existing-hub'].includes(n.type)) continue; const d = deg[n.id] || 0; n.type = d >= 4 ? 'cross' : d === 3 ? 'T' : d === 2 ? 'link' : n.type; }
plan.junctions = junctions(plan);
plan.interchanges.push({ id: 'IC-1', name: 'Развязка М2 × Восточная хорда', type: 'diamond-frontage', kind: 'Диамант с боковыми проездами (Texas diamond), съезды-петли R2 и раскрытие ≥12°', crossing: { expressway: 'B-M2-3', arterial: 'B-H-S-2' }, ramps: plan.edges.filter((e) => e.cls === 'ramp').map((e) => e.id), frontage: ['B-C100-W', 'B-C100-E', 'B-Q-W', 'B-Q-E'],
  params: { laneOffset: LANE, R1: R1T, taperDeg: PHI, R2: r2(R2), tail: r2(tail), mergeX: [r2(XM_W), r2(XM_E)], toFrontage: [XW, XEs], trench: { x0: 154, x1: 50, flat: [111, 93], depth: 3, grade: 0.07 }, deck: { w: 10.8, clearSpan: 18 }, levels: { 'B-M2-3': -1, 'B-H-S-2': 0, ramps: 0, frontage: 0 } },
  why: 'M2 пересекает только магистраль (Хорду): клеверному листу нужна площадка 150 x 150 м и петли R≥25, а к югу сразу эстуарий. Диамант с боковыми проездами (2 светофорных узла на Хорде на расстоянии 80 м) занимает полосу 30 м вдоль М2, без петель, с одним путепроводом (М2 в траншее глубиной 3 м, Хорда поверху); съезды касательны к полосе М2 (раскрытие 12°)' });
plan.meta = { phaseInfo: PHASE_INFO, builtAt: '2026-10-11' };
delete plan.pierLand;
fs.writeFileSync(new URL('plan-B.json', HERE), JSON.stringify(plan));
console.log('plan-B.json', JSON.stringify(plan).length, 'edges', plan.edges.length, 'nodes', plan.nodes.length, 'lots', plan.lots.length, 'dropped', dropped.length, 'R2', r2(R2), 'merge x', r2(XM_W), r2(XM_E), 'tail', r2(tail));
