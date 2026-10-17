// Quick draft renderer for plan-B.json (SVG -> PNG via chromium). Usage: node quick-render-B.mjs [outDir]
import fs from 'node:fs'; import path from 'node:path'; import { chromium } from 'playwright';
const out = process.argv[2] || '../../docs/masterplan'; fs.mkdirSync(out, { recursive: true });
const d = JSON.parse(fs.readFileSync(new URL('./plan-B.json', import.meta.url)));
const W = d.world, pad = 14, S = 4.2; // px per metre
const X = (x) => ((x - W.x0 + pad) * S).toFixed(1), Z = (z) => ((z - W.z0 + pad) * S).toFixed(1);
const wpx = Math.round((W.x1 - W.x0 + 2 * pad) * S), hpx = Math.round((W.z1 - W.z0 + 2 * pad) * S);
const pl = (pts) => pts.map((p) => `${X(p[0])},${Z(p[1])}`).join(' ');
const ZONE = { old: '#efe6d2', 'res-low': '#f7e7a8', 'res-mid': '#f2cf94', 'industry-light': '#d9cce6', cbd: '#ecaeae', park: '#bfe0a3', station: '#f0bddd', freight: '#d9c7ad', mixed: '#f4c4a0', service: '#d4d4d4', waterfront: '#cfe6ee', port: '#a9bfd6' };
const RW = { expressway: 14, arterial: 9.5, avenue: 9, ring: 7.6, collector: 6, quay: 5, local: 4, ramp: 5 };
const RC = { expressway: '#ec6a3c', arterial: '#f2b53a', avenue: '#f6d36a', ring: '#f2b53a', collector: '#ffffff', quay: '#e5f0f4', local: '#ffffff', ramp: '#ec6a3c' };
const PH = ['#7a7a7a', '#2f8f5b', '#2f6fbf', '#8a4fbf', '#d1802a', '#c8453f', '#1f9aa5', '#7a5a2f', '#444'];
const phaseMode = process.argv[3] === 'phases';
let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${wpx}" height="${hpx + 330}" viewBox="0 0 ${wpx} ${hpx + 330}" font-family="DejaVu Sans, Arial, sans-serif">`;
s += `<rect width="100%" height="100%" fill="#f6f2e8"/>`;
s += `<rect x="0" y="0" width="${wpx}" height="${hpx}" fill="#a9d3ea"/>`;
s += `<polygon points="${pl(d.land)}" fill="#f2ede0" stroke="#d6c9a8" stroke-width="3"/>`;
for (const w of d.water) s += `<polygon points="${pl(w.poly)}" fill="#8fc6e4" stroke="#6fa9cc" stroke-width="2"/>`;
for (const p of d.piers || []) s += `<polygon points="${pl(p.poly)}" fill="#cfd8dc" stroke="#9aa7ad"/>`;
for (const z of d.districts) s += `<polygon points="${pl(z.poly)}" fill="${ZONE[z.type] || '#eee'}" fill-opacity="${z.type === 'old' ? .9 : .75}" stroke="#00000022"/>`;
for (const b of d.blocks) s += `<polygon points="${pl(b.poly)}" fill="none" stroke="#ffffff" stroke-width="3"/>`;
const phaseOf = (o) => o.phase ?? 0;
for (const l of d.lots) s += `<polygon points="${pl(l.poly)}" fill="${phaseMode ? PH[phaseOf(l)] : '#d9a441'}" fill-opacity="${phaseMode ? .8 : .85}" stroke="#7a5a1a" stroke-width=".6"/>`;
const order = ['local', 'collector', 'quay', 'ring', 'avenue', 'arterial', 'ramp', 'expressway'];
for (const cls of order) for (const e of d.edges.filter((e) => e.cls === cls)) {
  const w = (RW[cls] * S).toFixed(1);
  s += `<polyline points="${pl(e.pts)}" fill="none" stroke="#6b6b6b" stroke-width="${(RW[cls] * S + 3).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  s += `<polyline points="${pl(e.pts)}" fill="none" stroke="${phaseMode && !e.existing ? PH[phaseOf(e)] : RC[cls]}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
}
for (const r of d.rails) {
  s += `<polyline points="${pl(r.pts)}" fill="none" stroke="#333" stroke-width="${(2.6 * S).toFixed(1)}" stroke-linecap="butt"/>`;
  s += `<polyline points="${pl(r.pts)}" fill="none" stroke="#fff" stroke-width="${(1.5 * S).toFixed(1)}" stroke-dasharray="${(2.2 * S).toFixed(1)} ${(2.2 * S).toFixed(1)}"/>`;
}
for (const st of d.stations) {
  for (const k of ['plaza', 'building']) if (st[k]) s += `<polygon points="${pl(st[k])}" fill="${k === 'plaza' ? '#f5e7c8' : '#c2457f'}" stroke="#555"/>`;
  for (const p of st.platforms || []) s += `<polygon points="${pl(p)}" fill="#bbb" stroke="#555"/>`;
}
for (const n of d.nodes) if (n.type === 'roundabout') s += `<circle cx="${X(n.x)}" cy="${Z(n.z)}" r="${(n.r * S * .75).toFixed(1)}" fill="#8fcf7a" stroke="#fff" stroke-width="5"/>`;
const label = (x, z, t, fs = 30, col = '#222') => `<text x="${X(x)}" y="${Z(z)}" text-anchor="middle" font-size="${fs}" font-weight="700" fill="${col}" stroke="#ffffffd0" stroke-width="7" paint-order="stroke">${t}</text>`;
for (const z of d.districts) { if (z.type === 'old') continue; const c = z.poly.reduce((a, p) => [a[0] + p[0] / z.poly.length, a[1] + p[1] / z.poly.length], [0, 0]); s += label(c[0], c[1], z.name.replace(/ \(.*\)/, ''), 26, '#333'); }
s += label(0, -20, 'СТАРЫЙ ГОРОД', 28, '#6b5a2e');
for (const w of d.water) s += label((w.poly[0][0] + w.poly[1][0]) / 2, (w.z0 + w.z1) / 2 + 4, w.name, 30, '#1f5f8b');
for (const st of d.stations.filter((q) => q.building && q.building[0][0] > 80)) { const c = st.building[0]; s += label(c[0] + 12, c[1] - 4, st.name, 26, '#8a1f5a'); }
for (const p of d.pads) s += `<g><circle cx="${X(p.pos[0])}" cy="${Z(p.pos[1])}" r="20" fill="#1f2a37" stroke="#e8c36a" stroke-width="4"/><text x="${X(p.pos[0])}" y="${(+Z(p.pos[1]) + 7).toFixed(1)}" text-anchor="middle" font-size="19" font-weight="700" fill="#fff">${p.id.replace('B', '')}</text></g>`;
s += `<g transform="translate(40,${hpx + 20})"><text font-size="34" font-weight="700" fill="#222">План B (черновик отрисовки по plan-B.json): ${phaseMode ? 'фазы 1–8' : 'общий вид'}</text>`;
const leg = [['#ec6a3c', 'Скоростная М2 / съезды'], ['#f2b53a', 'Магистраль / кольцо'], ['#f6d36a', 'Проспект'], ['#ffffff', 'Сборная / местная улица'], ['#333', 'Железная дорога'], ['#d9a441', 'Участки застройки'], ['#8fcf7a', 'Круговой перекрёсток'], ['#1f2a37', 'Кружок открытия (номер B01–B18)']];
leg.forEach((l, i) => { const x = (i % 3) * 600, y = 60 + Math.floor(i / 3) * 52; s += `<rect x="${x}" y="${y}" width="46" height="26" fill="${l[0]}" stroke="#555"/><text x="${x + 58}" y="${y + 22}" font-size="24" fill="#222">${l[1]}</text>`; });
if (phaseMode) PH.slice(1, 9).forEach((c, i) => { const x = (i % 3) * 600, y = 170 + Math.floor(i / 3) * 52; s += `<rect x="${x}" y="${y}" width="46" height="26" fill="${c}"/><text x="${x + 58}" y="${y + 22}" font-size="24" fill="#222">Фаза ${i + 1}: ${(d.meta.phaseInfo?.[i + 1]?.name || d.meta.phaseInfo?.[i + 1] || '').toString().slice(0, 34)}</text>`; });
s += `</g></svg>`;
const name = phaseMode ? 'plan-B-phases-draft' : 'plan-B-overview-draft';
fs.writeFileSync(path.join(out, name + '.svg'), s);
const br = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const pg = await br.newPage({ viewport: { width: wpx, height: hpx + 330 } });
await pg.setContent(`<body style="margin:0">${s}</body>`);
await pg.screenshot({ path: path.join(out, name + '.png') }); await br.close();
console.log('ok', name, wpx, hpx);
