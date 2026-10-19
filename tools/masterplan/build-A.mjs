// План A: радиально-кольцевой город (ядро r<70 заморожено; кольцо-1 = существующая кольцевая r57,4; радиалы от кольца наружу;
// река-дуга с востока; жд вдоль восточного берега; клеверный лист кольцо-2 x скоростная М1; вокзал в юго-восточном секторе; порт и промзона на западе).
import fs from 'node:fs';
import { P, arc, catmull, bez, dist, polyLen, polyDist, inPoly, xf, smooth, polarOf, D2R, r1 } from './lib.mjs';
import { Plan, CLS, cloverleaf, trumpetIC, perimeterBlock, lotRec } from './plan-core.mjs';
import { buildFabrics, landPolygon, finishPlan } from './plan-fab.mjs';
import { PHASE_INFO, makePads } from './phases.mjs';

const ac = (a, b, r, st) => arc(a, b < a ? b + 360 : b, r, st);
const R1 = 57.4, R2 = 124, RR = 160, EB = 171, RL = 175.5, EDGE = 180;
const A = new Plan('A', 'План A: радиально-кольцевой город', { extent: EDGE, coreR: 70, R1, R2, riverR: RR, desc: 'Ядро r<70 не трогаем. Радиалы и кольцо-2 вокруг старого острова, река-дуга на востоке, жд по восточному берегу, порт и тяжёлая промзона на западе (море).' });

// --- суша: море на W/SW/NW (как в игре сейчас), на N/E/S суша до края карты; порт и насыпь расширяют берег на W/NW
A.land = landPolygon((th) => {
  let sea = 0;
  if (th >= 90 && th <= 235) sea = 1; else if (th > 235 && th < 262) sea = 1 - smooth((th - 235) / 27); else if (th > 68 && th < 90) sea = 1 - smooth((90 - th) / 22);
  let R = 220 - (220 - 70) * sea;
  if (th >= 186 && th <= 252) R += 12 * smooth(Math.min((th - 186) / 8, (252 - th) / 12, 1)) * sea;                  // насыпь грузовой линии
  if (th >= 156 && th <= 190) R += 22 * smooth(Math.min((th - 156) / 8, (190 - th) / 6, 1));                        // намывной порт
  return R;
}, EDGE);

// --- река: из севера, дугой вокруг востока, в море на юге
A.water.push({ id: 'W-RIVER', name: 'Река Лесная', kind: 'river', w: 14, phase: 4,
  pts: catmull([P(279, 200), P(284, 172), P(296, RR + 2), P(320, RR), P(345, RR), P(10, RR), P(35, RR), P(55, RR), P(68, RR - 6), P(76, RR - 18), P(84, RR - 40)], 8) });
A.water.push({ id: 'W-HARBOUR', name: 'Бухта (море)', kind: 'sea', phase: 0 });

// --- узлы кольца-1 (существующая кольцевая r57,4)
const ringNodes = [['N', 270, 'Север'], ['NNE', 340, 'Северо-восток'], ['E', 5, 'Восток'], ['M1', 55, 'Деловой проспект'], ['S', 78, 'Юг'], ['PORT', 168, 'Порт'], ['SID', 196, 'Ж/д ветка (переезд)']];
ringNodes.forEach(([k, th, nm]) => { const [x, z] = P(th, R1); A.node({ id: `N-R1-${k}`, type: k === 'SID' ? 'level-crossing' : 'roundabout', x, z, r: k === 'SID' ? 5 : 9, name: `Узел кольца: ${nm}`, existing: 'E-RING', phase: k === 'S' || k === 'M1' || k === 'E' ? 3 : (k === 'NNE' || k === 'N') ? 2 : 1 }); });
// узлы существующих хабов (на кольце)
[['suburb', -46, -34, 'Жилой'], ['industrial', 43, -35, 'Промзона'], ['business', 45, 34, 'Деловой центр'], ['waterfront', -42, 38, 'Набережная']].forEach(([k, x, z, nm]) => A.node({ id: `N-HUB-${k}`, type: 'existing-hub', x, z, r: 4, name: `Хаб района: ${nm}`, existing: 'E-HUB-' + k, phase: 0 }));

// --- радиальные проспекты от кольца-1 наружу
const rad = (id, name, th, ra, rb, extra = {}) => A.road({ id, name, cls: 'avenue', pts: [P(th, ra), P(th, rb)], ...extra });
rad('A-PORT', 'Портовая дорога', 168, R1, 82, { phase: 1, cls: 'avenue', bus: true, joins: ['N-R1-PORT', 'N-QUAY-W'], note: 'продолжение западной служебной оси; ведёт на намывную территорию порта' });
A.road({ id: 'A-QUAY-W', name: 'Причальная', cls: 'quay', pts: arc(158, 188, 84), phase: 1, terminal: true, joins: ['N-QUAY-W', 'N-QUAY-W2'], note: 'причал порта, краны, контейнерная площадка' });
rad('A-N', 'Северный проспект', 270, R1, EDGE, { phase: 2, bus: true, joins: ['N-R1-N', 'N-R2-N'], note: 'выход на север (шоссе к холмам, край карты)' });
rad('A-NNE-1', 'Северо-восточный проспект', 340, R1, R2, { phase: 2, bus: true, joins: ['N-R1-NNE', 'N-R2-NNE'] });
rad('A-NNE-2', 'Северо-восточный проспект (за кольцом-2)', 340, R2, RR - 8, { phase: 4, bus: true, joins: ['N-R2-NNE', 'N-BR-NNE-W'] });
A.road({ id: 'A-NNE-BR', name: 'Мост Северный', cls: 'avenue', pts: [P(340, RR - 8), P(340, EB)], level: 1, phase: 4, bridge: true, span: 16, joins: ['N-BR-NNE-W', 'N-EB-NNE'], note: 'автодорожный мост через Лесную, 3 пролёта' });
rad('A-E-1', 'Восточный проспект', 5, R1, R2, { phase: 3, bus: true, joins: ['N-R1-E', 'N-R2-E'] });
rad('A-E-2', 'Восточный проспект (за кольцом-2)', 5, R2, RR - 8, { phase: 4, bus: true, joins: ['N-R2-E', 'N-BR-E-W'] });
A.road({ id: 'A-E-BR', name: 'Мост Восточный', cls: 'avenue', pts: [P(5, RR - 8), P(5, EB)], level: 1, phase: 4, bridge: true, span: 16, joins: ['N-BR-E-W', 'N-EB-E'], note: 'главный городской мост (разводной в идее, 2 пилона)' });
rad('A-S', 'Южный проспект', 78, R1, R2, { phase: 3, bus: true, joins: ['N-R1-S', 'N-R2-S'] });
// Деловой проспект (M1 внутри кольца-2) и скоростная магистраль М1
A.road({ id: 'A-M1-AV', name: 'Деловой проспект', cls: 'avenue', pts: [P(55, R1), P(55, R2 - 31)], phase: 4, tram: true, bus: true, joins: ['N-R1-M1', 'N-IC1'], note: 'трамвай T1 в разделительной полосе' });
A.road({ id: 'A-M1-IC', name: 'Магистраль М1 (через развязку)', cls: 'expressway', pts: [P(55, R2 - 31), P(55, RR - 7)], phase: 4, joins: ['N-IC1', 'N-M1-BR'] });
A.road({ id: 'A-M1-BR', name: 'Виадук М1 через Лесную', cls: 'expressway', pts: [P(55, RR - 7), P(55, EB + 6)], level: 1, bridge: true, span: 22, phase: 4, joins: ['N-M1-BR', 'N-M1-OUT'] });
A.road({ id: 'A-M1-OUT', name: 'Магистраль М1 (на выезд)', cls: 'expressway', pts: [P(55, EB + 6), P(55, 213)], level: 1, phase: 4, joins: ['N-M1-OUT'], terminal: true, note: 'эстакада над заречной улицей и жд-эстакадой; уходит за край карты' });

// --- кольцо-2 (магистраль) с сегментами по фазам
const r2seg = (id, nm, t0, t1, ph, joins, extra = {}) => A.road({ id, name: nm, cls: 'arterial', pts: ac(t0, t1, R2, 2.5), phase: ph, bus: true, joins, ...extra });
r2seg('A-R2-N', 'Кольцо-2, северная дуга', 248, 340, 2, ['N-R2-W', 'N-R2-N', 'N-R2-NNE']);
r2seg('A-R2-E', 'Кольцо-2, восточная дуга', 340, 40, 3, ['N-R2-NNE', 'N-R2-E', 'N-R2-RAILX']);
r2seg('A-R2-SE-a', 'Кольцо-2, юго-восточная дуга (до развязки)', 40, 51.8, 4, ['N-R2-RAILX', 'N-IC1']);
r2seg('A-R2-IC', 'Кольцо-2, путепровод над М1 (развязка IC-1)', 51.8, 58.2, 4, ['N-IC1'], { level: 1, bridge: true, span: 14 });
r2seg('A-R2-SE-b', 'Кольцо-2, юго-восточная дуга (после развязки)', 58.2, 78, 4, ['N-IC1', 'N-R2-S']);
for (const [k, th, nm, t] of [['W', 248, 'Северо-запад (конец у берега)', 'terminus'], ['N', 270, 'N', 'roundabout'], ['NNE', 340, 'NNE', 'roundabout'], ['E', 5, 'E', 'roundabout'], ['S', 78, 'S', 'roundabout']]) {
  const [x, z] = P(th, R2); A.node({ id: `N-R2-${k}`, type: t, x, z, r: 9, name: `Узел кольца-2: ${nm}`, phase: k === 'W' || k === 'N' || k === 'NNE' ? 2 : 3 });
}
{ const [x, z] = P(36, R2); A.node({ id: 'N-R2-RAILX', type: 'rail-overpass', x, z, r: 6, name: 'Кольцо-2 над жд-веткой вокзала', phase: 3 }); }
{ const [x, z] = P(55, R2); A.node({ id: 'N-IC1', type: 'interchange-cloverleaf', x, z, r: 26, name: 'Развязка «Клеверный лист»: М1 x Кольцо-2', phase: 4 }); }
// клеверный лист
const IC1 = cloverleaf('A-IC1', P(55, R2), 55, { R: 7.5, gV: 5.2, gH: 8.6 });
IC1.ramps.forEach((r) => A.road({ ...r, name: `Развязка IC-1, ${r.kind === 'loop' ? 'петля' : 'правоповоротный съезд'}`, phase: 4, joins: ['N-IC1'] }));
A.keepout.push({ id: 'KO-IC1', circle: [...P(55, R2), 33] });
// опорные узлы мостов, береговой, порта
[['N-BR-NNE-W', 340, RR - 8], ['N-BR-E-W', 5, RR - 8], ['N-EB-NNE', 340, EB], ['N-EB-E', 5, EB], ['N-M1-BR', 55, RR - 7], ['N-M1-OUT', 55, EB + 6]].forEach(([id, th, r]) => { const [x, z] = P(th, r); A.node({ id, type: id.startsWith('N-EB') ? 'roundabout' : 'bridge-head', x, z, r: id.startsWith('N-EB') ? 8 : 4, name: id, phase: 4 }); });
{ const [x, z] = P(168, 84); A.node({ id: 'N-QUAY-W', type: 'roundabout', x, z, r: 8, name: 'Порт: круговой у причала', phase: 1 }); const q = P(158, 84); A.node({ id: 'N-QUAY-W2', type: 'terminus', x: q[0], z: q[1], r: 4, name: 'Конец причала S', phase: 1 }); }
// Заречная улица (east bank) - собирающая
A.road({ id: 'A-EB', name: 'Заречная улица', cls: 'collector', pts: ac(292, 72, EB, 2.5), phase: 4, joins: ['N-EB-NNE', 'N-EB-E', 'N-EB-N', 'N-EB-S'], note: 'вдоль восточного берега; под жд-эстакадой' });
[['N-EB-N', 292], ['N-EB-S', 72]].forEach(([id, th]) => { const [x, z] = P(th, EB); A.node({ id, type: 'terminus', x, z, r: 5, name: 'Разворот заречной улицы', phase: 4 }); });
// береговые / набережные
A.road({ id: 'A-QUAY-SW', name: 'Набережная (SW)', cls: 'quay', pts: arc(104, 163, 72.5, 2.5), phase: 7, tram: true, joins: ['N-QSW-A', 'N-QSW-B'], note: 'променад вдоль бухты, трамвай T2, пирсы' });
[['N-QSW-A', 104], ['N-QSW-B', 163]].forEach(([id, th]) => { const [x, z] = P(th, 72.5); A.node({ id, type: 'terminus', x, z, r: 4, name: 'Конец набережной', phase: 7 }); });
A.road({ id: 'A-WF-LINK', name: 'Соединение набережной с хабом', cls: 'collector', pts: [P(138, 57.4), P(138, 72.5)], phase: 7, joins: ['N-HUB-waterfront', 'A-QUAY-SW'], note: 'от хаба «Набережная» к променаду' });
// привокзальный бульвар (пешеходно-трамвайный)
A.road({ id: 'A-STN-BLV', name: 'Привокзальный бульвар', cls: 'ped', w: 7, pts: [[45, 34], P(36, 66)], phase: 6, tram: true, terminal: true, joins: ['N-HUB-business', 'N-STN-PLAZA'], note: 'трамвай T1, пешеходная улица; ось: хаб «Деловой центр» - вокзальная площадь' });
// местные радиальные коллекторы из фабрик добавляются автоматически (finishPlan)

// --- железная дорога
A.rail({ id: 'R-MAIN', name: 'Главный ход (эстакада)', kind: 'main', level: 1, tracks: 2, phase: 5, pts: ac(281, 80, RL, 2.5), note: 'вдоль восточного берега на эстакаде; все радиальные дороги проходят под ней' });
A.rail({ id: 'R-PAX', name: 'Пассажирская ветка', kind: 'pax', tracks: 4, phase: 6, level: 0, pts: [P(36, RL), P(36, EB - 3), P(36, RR + 6), P(36, 138)], note: 'вправо от главного хода, мост через реку, виадук над кольцом-2, тупиковые пути вокзала' });
A.rail({ id: 'R-FRT-LEAD', name: 'Грузовая ветка (мост)', kind: 'freight', phase: 5, level: 1, tracks: 2, pts: [P(330, RL), P(330, 152), P(334, 146)], note: 'съезд с главного хода в северо-восточный грузовой парк' });
const yardTracks = [132, 135.2, 138.4, 141.6, 144.8];
yardTracks.forEach((r, i) => A.rail({ id: `R-FRT-Y${i + 1}`, name: `Путь парка СВ №${i + 1}`, kind: 'yard', tracks: 1, phase: 5, pts: arc(311, 343, r, 3) }));
A.rail({ id: 'R-FRT-W', name: 'Грузовая линия на запад (вдоль берега)', kind: 'freight', tracks: 1, phase: 5, level: 0,
  pts: catmull([P(311, 138.4), P(292, 142), P(272, 136), P(257, 116), P(248, 98), P(240, 84), P(228, 79), P(212, 79.5), P(198, 82), P(186, 85)], 6), note: 'по насыпи вдоль северо-западного берега к порту и западной промзоне' });
A.rail({ id: 'R-W-YARD', name: 'Западная товарная станция (порт)', kind: 'yard', tracks: 3, phase: 5, pts: arc(172, 192, 84.4, 2.5), });
A.rail({ id: 'R-W-YARD2', name: 'Западная товарная: путь 2', kind: 'yard', tracks: 1, phase: 5, pts: arc(172, 192, 88, 2.5) });
const sidAt = (th, rr) => P(th, rr);
A.rail({ id: 'R-SID-SAW', name: 'Ветка к лесопилке', kind: 'siding', tracks: 1, phase: 5, pts: [P(188.6, 84.4), P(188.6, 62), P(188.6, 58.5)], note: 'пересекает кольцо-1 по переезду; упирается в тыл лесопилки (брёвна/доски)' });
A.rail({ id: 'R-SID-CONC', name: 'Ветка к бетонному и металлобазе', kind: 'siding', tracks: 1, phase: 5, pts: [P(196, 86), [-79, -22], [-61, -16.2], [-56, -15.8], [-36, -15.6]], note: 'переезд через кольцо-1, затем на восток параллельно северному коридору; щебень/цемент/сталь' });

A.stations.push({ id: 'ST-PAX', name: 'Центральный вокзал', kind: 'pax-terminal', phase: 6, axisTh: 36, rBuf: 88, note: 'тупиковый, 4 пути, 3 платформы' });
A.stations.push({ id: 'ST-FRT-NE', name: 'Грузовой парк «Северо-Восток»', kind: 'freight-yard', phase: 5, at: P(327, 136) });
A.stations.push({ id: 'ST-FRT-W', name: 'Западная товарная (порт)', kind: 'freight-yard', phase: 5, at: P(182, 86) });
A.stations.push({ id: 'ST-HALT-EB', name: 'Платформа «Заречье»', kind: 'halt', phase: 6, at: P(18, RL) });

// --- районы (сектора): существующие хабы сохраняются, зоны наращиваются наружу
const Z = (id, nm, type, t0, t1, r0, r1, ph, extra = {}) => A.districts.push({ id, name: nm, type, t0, t1, r0, r1, phase: ph, ...extra });
// ядро (заморожено) - для подписи
Z('D-OLD', 'Старый город', 'old', 0, 360, 0, 26, 0, { frozen: true, note: 'площадь-хаб, рынок, мастер-сетка, дома 1-2: не трогаем' });
Z('D-W-IND', 'Западная промзона и порт', 'industry-heavy', 165, 200, 26, 92, 1, { frozen: true, hub: 'existing industrial camp', note: 'лесопилка, бетонный, металлобаза, автопарк стоят на местах; порт и жд - новое' });
Z('D-SUB', 'Жилой район (Пригород)', 'res-low', 200, 250, 26, 70, 0, { frozen: true, hub: 'suburb' });
Z('D-NORTH', 'Северный пояс: производство и офисы', 'mixed', 250, 296, 26, 70, 0, { frozen: true });
Z('D-IND-HUB', 'Промзона (хаб) / лёгкая индустрия', 'industry-light', 296, 346, 26, 70, 0, { frozen: true, hub: 'industrial' });
Z('D-EAST', 'Восточные кварталы', 'res-mid', 346, 14, 26, 70, 0, { frozen: true });
Z('D-BIZ', 'Деловой центр (ядро)', 'cbd', 14, 70, 26, 70, 0, { frozen: true, hub: 'business' });
Z('D-UTIL', 'Коммунальная зона', 'utility', 70, 106, 26, 70, 0, { frozen: true, note: 'электростанция и водоканал (-12;52), (0;52)' });
Z('D-WF', 'Набережная (SW)', 'waterfront', 106, 165, 26, 70, 0, { frozen: true, hub: 'waterfront' });
// новые пояса
Z('D-NW', 'Северо-западные кварталы', 'res-low', 252, 296, 70, 120, 2, { note: 'малоэтажная застройка, школа, поликлиника' });
Z('D-IP', 'Индустриальный парк «Север-Восток»', 'industry-light', 300, 340, 70, 120, 2, { note: 'склады, мастерские, развоз грузов по кольцу-2' });
Z('D-E', 'Восточный пояс: смешанная застройка', 'mixed', 340, 24, 70, 120, 3, { note: 'среднеэтажка, магазины на первом этаже, школа, стадион' });
Z('D-STN', 'Привокзальный район', 'station', 25, 52, 62, 120, 6, { note: 'вокзал, площадь, автовокзал, такси, отель у вокзала' });
Z('D-CBD', 'CBD: высотный деловой центр', 'cbd', 55, 78, 70, 120, 3, { note: 'офисы и башни, площадь, парковки; продолжается от хаба «Деловой центр»' });
Z('D-OB-N', 'Лесопарк', 'park', 252, 300, 124, 150, 4);
Z('D-OB-NE', 'Грузовой парк и склады', 'freight', 308, 346, 126, 148, 5);
Z('D-OB-E', 'Спорт и парки', 'park', 348, 28, 126, 148, 4);
Z('D-OB-SE', 'Развязка и придорожный сервис', 'service', 28, 72, 148, 150, 4);
Z('D-OB-S', 'Очистные и коммунальный узел', 'utility', 70, 90, 126, 150, 7);
Z('D-EB', 'Заречье: лес, ЖД-коридор', 'forest', 288, 80, 163, 175, 4);
Z('D-NWC', 'Больница и университет', 'public', 246, 262, 74, 120, 7);
Z('D-PORT', 'Порт: контейнерный терминал и склады', 'port', 156, 192, 70, 94, 1);
Z('D-AIR', 'Аэропорт (резерв за краем карты, O3+)', 'airport', 20, 40, 175, 175, 8, { offmap: true });

// --- кварталы (фабрики): ключ района -> параметры сетки
buildFabrics(A, [
  { id: 'F-NW', district: 'D-NW', name: 'Северо-западные кварталы', kind: 'res-low', phase: 2, t0: 256, t1: 270, r0: 74, r1: 120, rows: 2, arc: 26, depth: 6.2, front: 6.6, skipT1: true },
  { id: 'F-NW2', district: 'D-NW', name: 'Северные кварталы', kind: 'res-low', phase: 2, t0: 270, t1: 300, r0: 74, r1: 120, rows: 2, arc: 26, depth: 6.2, front: 6.6, skipT0: true },
  { id: 'F-IP', district: 'D-IP', name: 'Индустриальный парк СВ', kind: 'industry-light', phase: 2, t0: 300, t1: 340, r0: 74, r1: 120, rows: 2, arc: 30, depth: 10, front: 14, skipT0: true, skipT1: true },
  { id: 'F-E1', district: 'D-E', name: 'Восточный пояс (север)', kind: 'mixed', phase: 3, t0: 340, t1: 5, r0: 74, r1: 120, rows: 2, arc: 26, depth: 6.8, front: 7.6, skipT0: true, skipT1: true },
  { id: 'F-E2', district: 'D-E', name: 'Восточный пояс', kind: 'mixed', phase: 3, t0: 5, t1: 24, r0: 74, r1: 120, rows: 2, arc: 26, depth: 6.8, front: 7.6, skipT0: true },
  { id: 'F-CBD', district: 'D-CBD', name: 'CBD', kind: 'cbd', phase: 3, t0: 55, t1: 78, r0: 74, r1: 120, rows: 2, arc: 26, depth: 8.4, front: 9.6, skipT0: true, skipT1: true },
  { id: 'F-PORT1', district: 'D-PORT', name: 'Порт (север)', kind: 'port', phase: 1, t0: 158, t1: 168, r0: 71, r1: 84, rows: 1, arc: 30, depth: 5.2, front: 12, skipT1: true },
  { id: 'F-PORT2', district: 'D-PORT', name: 'Порт', kind: 'port', phase: 1, t0: 168, t1: 188, r0: 71, r1: 84, rows: 1, arc: 30, depth: 5.2, front: 12, skipT0: true },
], { riverW: 14 });

// --- опорные объекты (достопримечательности, инфраструктура) - маркеры
const LM = (id, nm, kind, p, ph, extra = {}) => A.landmarks.push({ id, name: nm, kind, x: r1(p[0]), z: r1(p[1]), phase: ph, ...extra });
LM('LM-STADIUM', 'Стадион', 'stadium', P(356, 99), 4, { w: 36, d: 24, yaw: 86 });
LM('LM-HOSP', 'Городская больница', 'hospital', P(258, 100), 7);
LM('LM-UNI', 'Университет', 'university', P(262, 112), 7);
LM('LM-TOWER', 'Телебашня', 'tower', P(66, 108), 6);
LM('LM-WWTP', 'Очистные сооружения', 'utility', P(80, 138), 7);
LM('LM-SUBST', 'Подстанция', 'utility', P(322, 108), 4);
LM('LM-LANDFILL', 'Мусорный полигон', 'utility', P(300, 165), 8);
LM('LM-CEMETERY', 'Кладбище', 'park', P(280, 140), 7);
LM('LM-BUSTERM', 'Автовокзал', 'bus', P(30, 74), 6);
LM('LM-MARINA', 'Яхт-клуб / пристань', 'marina', P(86, 118), 7);
LM('LM-CRANES', 'Портовые краны', 'crane', P(175, 90), 1);
LM('LM-CITYHALL', 'Ратуша (у площади-хаба)', 'civic', [14, 14], 0);
LM('LM-IC', 'Развязка IC-1', 'interchange', P(55, R2), 4);
LM('LM-STAT', 'Вокзал', 'station', P(36, 82), 6);

A.phaseInfo = PHASE_INFO;
A.pads = makePads([
  ['PAD-A01', 'Порт: причал и портовая дорога', 1, 0.6, ['A-PORT', 'A-QUAY-W', 'N-QUAY-W', 'F-PORT1', 'F-PORT2']],
  ['PAD-A02', 'Узел кольца: Порт', 1, 0.3, ['N-R1-PORT']],
  ['PAD-A03', 'Северный проспект и узел кольца', 2, 0.4, ['A-N', 'N-R1-N', 'N-R2-N']],
  ['PAD-A04', 'Северо-восточный проспект (до кольца-2)', 2, 0.4, ['A-NNE-1', 'N-R1-NNE', 'N-R2-NNE']],
  ['PAD-A05', 'Кольцо-2: северная дуга', 2, 0.6, ['A-R2-N', 'N-R2-W']],
  ['PAD-A06', 'Северные кварталы (малоэтажные)', 2, 0.7, ['F-NW', 'F-NW2']],
  ['PAD-A07', 'Индустриальный парк «Север-Восток»', 2, 0.9, ['F-IP']],
  ['PAD-A08', 'Восточный проспект (до кольца-2)', 3, 0.25, ['A-E-1', 'N-R1-E', 'N-R2-E']],
  ['PAD-A09', 'Южный проспект', 3, 0.25, ['A-S', 'N-R1-S', 'N-R2-S']],
  ['PAD-A10', 'Кольцо-2: восточная дуга', 3, 0.4, ['A-R2-E', 'N-R2-RAILX']],
  ['PAD-A11', 'Восточный пояс (смешанная застройка)', 3, 0.6, ['F-E1', 'F-E2']],
  ['PAD-A12', 'CBD: кварталы и площадь', 3, 0.7, ['F-CBD']],
  ['PAD-A13', 'Деловой проспект (внутри кольца-2)', 4, 0.3, ['A-M1-AV', 'N-R1-M1']],
  ['PAD-A14', 'Мост Северный', 4, 0.3, ['A-NNE-2', 'A-NNE-BR', 'N-BR-NNE-W']],
  ['PAD-A15', 'Мост Восточный', 4, 0.3, ['A-E-2', 'A-E-BR', 'N-BR-E-W']],
  ['PAD-A16', 'Развязка IC-1 и кольцо-2 (ЮВ)', 4, 0.9, ['A-R2-SE-a', 'A-R2-IC', 'A-R2-SE-b', 'A-IC1-L1', 'A-IC1-L2', 'A-IC1-L3', 'A-IC1-L4', 'A-IC1-D1', 'A-IC1-D2', 'A-IC1-D3', 'A-IC1-D4', 'N-IC1']],
  ['PAD-A17', 'Скоростная М1 и виадук', 4, 0.7, ['A-M1-IC', 'A-M1-BR', 'A-M1-OUT']],
  ['PAD-A18', 'Заречная улица', 4, 0.2, ['A-EB']],
  ['PAD-A19', 'Жд-эстакада: главный ход', 5, 0.6, ['R-MAIN']],
  ['PAD-A20', 'Грузовой парк «Северо-Восток»', 5, 0.6, ['R-FRT-LEAD', 'R-FRT-Y1', 'R-FRT-Y2', 'R-FRT-Y3', 'R-FRT-Y4', 'R-FRT-Y5']],
  ['PAD-A21', 'Грузовая линия на запад (насыпь)', 5, 0.5, ['R-FRT-W']],
  ['PAD-A22', 'Западная товарная станция', 5, 0.4, ['R-W-YARD', 'R-W-YARD2']],
  ['PAD-A23', 'Ветки к лесопилке и заводам (переезды)', 5, 0.3, ['R-SID-SAW', 'R-SID-CONC', 'N-R1-SID']],
  ['PAD-A24', 'Центральный вокзал и ветка', 6, 1.0, ['R-PAX', 'ST-PAX', 'D-STN']],
  ['PAD-A25', 'Привокзальный бульвар и трамвай T1', 6, 0.3, ['A-STN-BLV']],
  ['PAD-A26', 'Автовокзал, телебашня', 6, 0.2, ['LM-BUSTERM', 'LM-TOWER']],
  ['PAD-A27', 'Набережная SW и пирсы', 7, 0.35, ['A-QUAY-SW', 'A-WF-LINK']],
  ['PAD-A28', 'Больница и университет', 7, 0.45, ['LM-HOSP', 'LM-UNI']],
  ['PAD-A29', 'Очистные, марина, кладбище', 7, 0.3, ['LM-WWTP', 'LM-MARINA', 'LM-CEMETERY']],
  ['PAD-A30', 'Аэропорт (резерв) и метро (концепт)', 8, 0.3, ['D-AIR']]
]);
finishPlan(A);
fs.writeFileSync(new URL('./plan-A.json', import.meta.url), JSON.stringify(A));
console.log('plan-A.json', JSON.stringify(A).length, 'bytes; roads', A.roads.length, 'lots', A.lots.length);
