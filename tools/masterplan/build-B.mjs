// План B: линейный город на сетке 48 м вдоль главной оси запад-восток; река-эстуарий на юге; транспортный коридор (жд + М2) между ядром и рекой;
// вокзал сквозной на коридоре; жд уходит в тоннель под ядром на северный сортировочный парк; стек- и трубчатая развязки.
import fs from 'node:fs';
import { P, arc, catmull, bez, polyLen, smooth, r1 } from './lib.mjs';
import { Plan, cloverleaf, stackIC, trumpetIC } from './plan-core.mjs';
import { landPolygon, buildRectFabric, finishPlan } from './plan-fab.mjs';
import { PHASE_INFO } from './phases.mjs';
const R1 = 57.4, EDGE = 180;
const B = new Plan('B', 'План B: линейный город на сетке вдоль реки', { extent: EDGE, coreR: 70, R1, desc: 'Ядро r<70 не трогаем. Ось запад-восток, сетка кварталов 48 м, река-эстуарий на юге, коридор жд + скоростная М2, тоннель под ядром.' });
B.land = landPolygon((th) => { let sea = 0; if (th >= 112 && th <= 235) sea = 1; else if (th > 235 && th < 262) sea = 1 - smooth((th - 235) / 27); else if (th > 90 && th < 112) sea = 1 - smooth((112 - th) / 22);
  let R = 260 - 190 * sea; if (th >= 186 && th <= 252) R += 12 * smooth(Math.min((th - 186) / 8, (252 - th) / 12, 1)) * sea; if (th >= 156 && th <= 190) R += 22 * smooth(Math.min((th - 156) / 8, (190 - th) / 6, 1)); return R; }, EDGE);
B.water.push({ id: 'W-RIVER', name: 'Река Южная (эстуарий)', kind: 'river', w: 22, phase: 4, pts: catmull([[-14, 118], [10, 124], [44, 128], [84, 130], [124, 128], [160, 132], [196, 134]], 8) });
// узлы кольца-1
[['N', 291, 'Север (x=18)'], ['E', 0, 'Главный проспект'], ['S', 72.8, 'Юг (x=18)'], ['PORT', 168, 'Порт'], ['SID', 196, 'Ж/д ветка (переезд)']].forEach(([k, th, nm]) => { const [x, z] = P(th, R1); B.node({ id: `N-R1-${k}`, type: k === 'SID' ? 'level-crossing' : 'roundabout', x, z, r: k === 'SID' ? 5 : 9, name: `Узел кольца: ${nm}`, existing: 'E-RING', phase: k === 'PORT' ? 1 : k === 'N' ? 2 : 3 }); });
[['suburb', -46, -34], ['industrial', 43, -35], ['business', 45, 34], ['waterfront', -42, 38]].forEach(([k, x, z]) => B.node({ id: `N-HUB-${k}`, type: 'existing-hub', x, z, r: 4, name: 'Хаб ' + k, existing: 'E-HUB-' + k, phase: 0 }));
const nrp = (id, x, z, ph, t = 'roundabout') => B.node({ id, type: t, x, z, r: 8, name: id, phase: ph });
// порт и запад
B.road({ id: 'B-PORT', name: 'Портовая дорога', cls: 'avenue', pts: [P(168, R1), P(168, 82)], phase: 1, bus: true });
B.road({ id: 'B-QUAY-W', name: 'Причальная', cls: 'quay', pts: arc(158, 188, 84), phase: 1, terminal: true }); nrp('N-QUAY-W', ...P(168, 84), 1);
// главная ось и меридианы
B.road({ id: 'B-MAIN-E1', name: 'Главный проспект', cls: 'avenue', pts: [[R1, 0], [114, 0]], phase: 3, tram: true, bus: true });
B.road({ id: 'B-MAIN-E2', name: 'Главный проспект (восток)', cls: 'avenue', pts: [[114, 0], [180, 0]], phase: 3, tram: true, bus: true, terminal: true });
B.road({ id: 'B-N', name: 'Северный проспект', cls: 'avenue', pts: [[18, -54.5], [18, -180]], phase: 2, bus: true, terminal: true });
B.road({ id: 'B-S', name: 'Южный проспект', cls: 'avenue', pts: [[18, 54.5], [18, 100]], phase: 3, bus: true });
B.road({ id: 'B-S2', name: 'Южный проспект (к развязке)', cls: 'avenue', pts: [[18, 100], [18, 110]], phase: 4, bus: true });
B.road({ id: 'B-HORDA-N', name: 'Восточная хорда (север)', cls: 'arterial', pts: [[114, -180], [114, 0]], phase: 3, bus: true, terminal: true });
B.road({ id: 'B-HORDA-S', name: 'Восточная хорда (юг)', cls: 'arterial', pts: [[114, 0], [114, 74]], phase: 3, bus: true });
B.road({ id: 'B-NAV', name: 'Северная магистраль', cls: 'arterial', pts: [[18, -96], [114, -96]], phase: 2, bus: true });
B.road({ id: 'B-NAV-W', name: 'Северная магистраль (запад)', cls: 'arterial', pts: [[-56, -96], [18, -96]], phase: 2, bus: true, terminal: true });
B.road({ id: 'B-S48', name: 'Южная магистраль', cls: 'arterial', pts: [[114, 48], [18, 66]], phase: 3, bus: true });
B.road({ id: 'B-S48E', name: 'Южная магистраль (восток)', cls: 'arterial', pts: [[114, 48], [180, 48]], phase: 3, bus: true, terminal: true });

[['N-A', 18, -96, 2], ['N-B', 114, -96, 2], ['N-C', 114, 0, 3], ['N-D', 114, 48, 3]].forEach((a) => nrp(...a));
// вокзальный проспект и бульвар
B.road({ id: 'B-STN-AV', name: 'Вокзальный проспект', cls: 'avenue', pts: [[48, 34], [48, 88]], phase: 6, terminal: true, tram: true, bus: true, note: 'ось хаб «Деловой центр» - привокзальная площадь' });
// транспортный коридор: М2 z=110, жд z=94 + вокзал
B.road({ id: 'B-M2', name: 'Скоростная магистраль М2', cls: 'expressway', pts: [[180, 110], [140, 110], [26, 110]], phase: 4, terminal: true });
B.road({ id: 'B-M2-FEED', name: 'Съезд М2 на Южный проспект', cls: 'arterial', pts: [[26, 110], [18, 110]], phase: 4 });
const SIC = stackIC('B-IC1', [114, 110], 0, { s: 12, L: 30, gV: 5, gH: 8 }); SIC.ramps.forEach((r) => B.road({ ...r, name: 'Развязка IC-1 (стек)', phase: 4 }));
B.road({ id: 'B-HORDA-IC', name: 'Восточная хорда (через развязку)', cls: 'arterial', pts: [[114, 74], [114, 110], [114, 150]], phase: 4, level: 1, bridge: false });
const TIC = trumpetIC('B-IC2', [18, 110], 0, {}); TIC.ramps.forEach((r) => B.road({ ...r, pts: r.pts.map(([x, z]) => [x, 220 - z]), name: 'Развязка IC-2 (труба)', phase: 4 }));
B.node({ id: 'N-IC1', type: 'interchange-stack', x: 114, z: 110, r: 30, name: 'Развязка «стек»: М2 × Восточная хорда', phase: 4 });
B.node({ id: 'N-IC2', type: 'interchange-trumpet', x: 18, z: 110, r: 26, name: 'Развязка «труба»: М2 → Южный проспект', phase: 4 });
// мосты через эстуарий
B.road({ id: 'B-BR1', name: 'Мост Южный', cls: 'avenue', pts: [[66, 118], [66, 156]], level: 1, bridge: true, span: 26, phase: 4, bus: true });
B.road({ id: 'B-BR1A', name: 'Мост Южный (подъезд)', cls: 'avenue', pts: [[66, 62], [66, 118]], phase: 4, bus: true });
B.road({ id: 'B-BR2', name: 'Мост Хорды', cls: 'arterial', pts: [[114, 118], [114, 150]], level: 1, bridge: true, span: 26, phase: 4 });
B.road({ id: 'B-SB', name: 'Улица Южного берега', cls: 'collector', pts: [[30, 156], [66, 156], [114, 156], [180, 156]], phase: 4, terminal: true });
// набережные
B.road({ id: 'B-EMB-S', name: 'Набережная (юг)', cls: 'quay', pts: [[20, 118], [150, 118]], phase: 7, tram: true, terminal: true });
B.road({ id: 'B-QUAY-SW', name: 'Набережная (SW)', cls: 'quay', pts: arc(104, 163, 72.5, 2.5), phase: 7, tram: true });
B.road({ id: 'B-WF-LINK', name: 'Соединение набережной с хабом', cls: 'collector', pts: [P(138, 57.4), P(138, 72.5)], phase: 7 });
B.node({ id: 'N-QSW-A', type: 'terminus', x: P(104, 72.5)[0], z: P(104, 72.5)[1], r: 4, name: 'Конец', phase: 7 }); B.node({ id: 'N-QSW-B', type: 'terminus', x: P(163, 72.5)[0], z: P(163, 72.5)[1], r: 4, name: 'Конец', phase: 7 });
// железная дорога
B.rail({ id: 'R-MAIN', name: 'Главный ход (коридор)', kind: 'main', tracks: 2, phase: 5, level: 0, pts: [[180, 94], [90, 94]], note: 'вдоль М2 и реки' });
B.rail({ id: 'R-MAIN2', name: 'Главный ход (к порталу)', kind: 'main', tracks: 2, phase: 5, level: 0, pts: [[90, 94], [10, 94], [0, 90], [-2, 82]] });
B.rail({ id: 'R-TUN', name: 'Тоннель под ядром', kind: 'tunnel', tracks: 2, phase: 8, level: -1, pts: [[-2, 82], [-6, 40], [-6, -40], [-2, -86]], note: 'глубокого заложения; в игре без меша: два портала + сигнатуры' });
B.rail({ id: 'R-N-YARD', name: 'Северная сортировочная', kind: 'yard', tracks: 1, phase: 5, pts: [[-2, -86], [20, -96]] });
[ -110, -114, -118, -122 ].forEach((z, i) => B.rail({ id: `R-NY${i + 1}`, name: 'Путь парка', kind: 'yard', tracks: 1, phase: 5, pts: [[-30, z], [40, z]] }));
B.rail({ id: 'R-FRT-W', name: 'Грузовая линия на запад (по насыпи)', kind: 'freight', tracks: 1, phase: 5, pts: catmull([[-30, -112], [-52, -108], [-64, -98], [-62, -84], [-60, -74], [-72, -62], [-76, -40], [-80, -20], [-84, 0], [-86, 12]], 6) });
B.rail({ id: 'R-W-YARD', name: 'Западная товарная (порт)', kind: 'yard', tracks: 3, phase: 5, pts: arc(172, 192, 84.4, 2.5) });
B.rail({ id: 'R-SID-SAW', name: 'Ветка к лесопилке', kind: 'siding', tracks: 1, phase: 5, pts: [P(188.6, 84.4), P(188.6, 62), P(188.6, 58.5)] });
B.rail({ id: 'R-SID-CONC', name: 'Ветка к бетонному и металлобазе', kind: 'siding', tracks: 1, phase: 5, pts: [P(196, 86), [-79, -22], [-61, -16.2], [-56, -15.8], [-36, -15.6]] });
// вокзал (сквозной) - фигуры
const sh = [];
const rc = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
[88, 91.5, 96.5, 100].forEach((z) => sh.push({ t: 'track', pts: [[44, z], [90, z]] }));
[[44, 80, 89.9, 90.1]].forEach(() => {});
sh.push({ t: 'poly', pts: rc(50, 82, 92.4, 95.6), fill: '#d9d4c7', stroke: '#6b6558' }, { t: 'poly', pts: rc(52, 80, 92.9, 95.1), fill: '#8aa0b8', stroke: '#41546b' });
sh.push({ t: 'poly', pts: rc(50, 82, 85.4, 87.2), fill: '#d9d4c7', stroke: '#6b6558' });
sh.push({ t: 'poly', pts: rc(46, 86, 72, 82), fill: '#e277ab', stroke: '#6a1e48', label: 'ВОКЗАЛ' });
sh.push({ t: 'poly', pts: rc(36, 96, 62, 72), fill: '#ece6d6', stroke: '#9a917c', label: 'площадь' });
sh.push({ t: 'poly', pts: rc(98, 112, 64, 80), fill: '#cfd8e3', stroke: '#6b7a8f', label: 'P' });
B.stations.push({ id: 'ST-PAX', name: 'Южный вокзал', kind: 'pax-through', phase: 6, shapes: sh, note: 'сквозной, 4 пути, 2 островных платформы; подземный переход к площади' });
B.stations.push({ id: 'ST-FRT-N', name: 'Северная сортировочная', kind: 'freight-yard', phase: 5, at: [5, -116] });
B.stations.push({ id: 'ST-FRT-W', name: 'Западная товарная (порт)', kind: 'freight-yard', phase: 5, at: P(182, 86) });
// районы (прямоугольники)
const Zr = (id, nm, type, x0, x1, z0, z1, ph, extra = {}) => B.districts.push({ id, name: nm, type, poly: rc(x0, x1, z0, z1), phase: ph, ...extra });
B.districts.push({ id: 'D-CORE', name: 'Старый город (ядро r<70)', type: 'old', t0: 0, t1: 360, r0: 0, r1: 70, phase: 0, frozen: true });
Zr('D-NW', 'Северо-западные кварталы', 'res-low', -78, 66, -150, -100, 2, {}); Zr('D-NY', 'Сортировочная и склады', 'freight', -34, 44, -126, -104, 5);
Zr('D-NE', 'Индустриальный парк «Север-Восток»', 'industry-light', 66, 180, -150, -100, 2);
Zr('D-E1', 'Восточные кварталы (жилые)', 'res-mid', 66, 180, -100, -42, 3);
Zr('D-CBD', 'Линейный деловой центр (Главный проспект)', 'cbd', 70, 160, -42, 54, 3);
Zr('D-E2', 'Смешанная застройка', 'mixed', 70, 180, 54, 84, 3);
Zr('D-W-NW', 'Северо-западные кварталы (2)', 'res-low', -78, 0, -100, -76, 2);
Zr('D-STN', 'Привокзальный район', 'station', 36, 112, 62, 102, 6);
Zr('D-COR', 'Транспортный коридор: жд + М2', 'service', -10, 180, 84, 116, 4);
Zr('D-EMB', 'Набережная и парк', 'park', 10, 180, 116, 126, 7);
Zr('D-SB', 'Южный берег: стадион, парк, резерв аэропорта', 'park', 10, 180, 138, 180, 8);
Zr('D-PARKN', 'Северный парк', 'park', 18, 66, -100, -76, 4);
B.districts.push({ id: 'D-PORT', name: 'Порт и западная промзона', type: 'port', t0: 156, t1: 192, r0: 26, r1: 94, phase: 1 });
B.districts.push({ id: 'D-SUB', name: 'Жилой район (Пригород)', type: 'res-low', t0: 200, t1: 250, r0: 26, r1: 70, phase: 0, frozen: true });
B.districts.push({ id: 'D-WF', name: 'Набережная (SW)', type: 'waterfront', t0: 106, t1: 165, r0: 26, r1: 70, phase: 0, frozen: true });
const xs = [-174, -126, -78, -30, 18, 66, 114, 162], zs = [-148, -100, -52, -4, 44, 80];
buildRectFabric(B, { xs, zs, edgeW: -1, kindAt: (cx, cz) => {
  if (cz > 60 || cz < -148) return null;
  if (cz < -100) return cx > 66 ? { kind: 'industry-light', depth: 10, front: 14, phase: 2 } : { kind: 'res-low', depth: 6.2, front: 6.6, phase: 2 };
  if (cx < 66) return cz < -76 ? { kind: 'res-low', depth: 6.2, front: 6.6, phase: 2 } : null;
  if (Math.abs(cz) < 50) return { kind: 'cbd', depth: 8.4, front: 9.6, phase: 3 };
  return { kind: 'mixed', depth: 6.8, front: 7.6, phase: 3 };
}, phaseAt: (x, z) => (z < -100 ? 2 : 3) });
const LM = (id, nm, kind, p, ph, extra = {}) => B.landmarks.push({ id, name: nm, kind, x: r1(p[0]), z: r1(p[1]), phase: ph, ...extra });
LM('LM-STADIUM', 'Стадион', 'stadium', [96, 165], 8, { w: 36, d: 24, yaw: 0 }); LM('LM-HOSP', 'Больница', 'hospital', [-20, -88], 7); LM('LM-UNI', 'Университет', 'university', [40, -88], 7);
LM('LM-WWTP', 'Очистные', 'utility', [150, 150], 7); LM('LM-LANDFILL', 'Мусорный полигон', 'utility', [150, -170], 8); LM('LM-TOWER', 'Телебашня', 'tower', [96, 20], 6); LM('LM-CRANES', 'Портовые краны', 'crane', P(175, 90), 1);
LM('LM-PORTAL-S', 'Портал тоннеля (юг)', 'portal', [-2, 82], 8); LM('LM-PORTAL-N', 'Портал тоннеля (север)', 'portal', [-2, -86], 8); LM('LM-AIR', 'Аэропорт (резерв за краем, O3+)', 'airport', [150, 176], 8);
B.phaseInfo = PHASE_INFO;
finishPlan(B);
fs.writeFileSync(new URL('./plan-B.json', import.meta.url), JSON.stringify(B));
console.log('plan-B.json', JSON.stringify(B).length, 'roads', B.roads.length, 'lots', B.lots.length, JSON.stringify(B.check.dead.slice(0, 8)), 'comps', B.check.components);
