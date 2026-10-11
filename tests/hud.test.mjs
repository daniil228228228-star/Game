// HUD regression checks (port of the v116 'hud' idea, adapted to v161), iPhone 13 emulation (390x664):
//   1. top stack: #carryRouteV139, #shiftGoalV127 and #toast do not overlap (layoutTopV46, commit 87707f1;
//      the lazily created chips are forced visible and a layout pass is requested through 'resize'),
//      v163 (2026-10-11 (16), user screenshot: carry-route card + the "2/3 · Неси груз..." coach strip + the toast stacked on top of each other): the stack now covers EVERY floating card of the top
//      area (carry route, manual coach, shift goal, next card, secondary objective, contracts, company chip, event banner, toast); all of them are forced visible and measured pairwise,
//   2. HUD stat feedback ('v48-stat-feedback') stays bounded under steady income (MutationObserver count over a
//      12 s window; per-stat cooldown is 4 s, so <= 4 per stat) while one chunky jump still fires it, and the
//      dead v47 pulse layer never adds its class,
//   3. no white ring decal colours (0xe6edf7 / 0xffefc7, removed in v116) on any mesh.
// ONE browser launch (fresh save). Overlap is measured with getBoundingClientRect, not the game's own audit.
import { openGame, check } from './lib/harness.mjs';

const g = await openGame({ save: 'clear', waitMs: 4000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = (o) => JSON.stringify(o);

// ---- 1. no white ring decals anywhere in the scene
const ring = await ev(() => {
  const BANNED = new Set([0xe6edf7, 0xffefc7]); let hits = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m?.color && BANNED.has(m.color.getHex())) hits++;
  });
  return hits;
});
check(ring === 0, `no mesh uses the removed white ring decal colours (${ring} found)`);

// ---- 2. top HUD stack does not overlap
const vp = await ev(() => ({ w: innerWidth, h: innerHeight }));
check(vp.w === 390 && vp.h === 664, `iPhone 13 emulation viewport 390x664 (${vp.w}x${vp.h})`);
// The game's own ticks keep toggling the classes that hide these chips (and layoutTopV46 then removes the shift
// offset because it ignores hidden panels), so one forced attempt can race it. Each attempt forces the three panels
// visible, requests a layout pass ('resize', which runs layoutV46 in the next frame) and measures right after that
// frame. The check passes when an attempt with all three panels on screen has no overlap; it fails only if EVERY
// attempt (up to 12) overlaps, which is what the pre-87707f1 layout did deterministically.
const runStack = (subset) => ev(async (subset) => {
  const ALL = [['carryRouteV139', 'Carry route: planks to the site 3/5'], ['manualCoachV143', '2/3 · Неси груз к зелёному маяку'], ['shiftGoalV127', 'Shift goal: deliver 6 loads'], ['nextCard', 'Next: build the sawmill'], ['secondaryObjectiveV36', 'Secondary: 2 houses'], ['contractsCard', 'Contracts 1/3'], ['companyChip', 'Company L2'], ['eventBanner', 'Event: demand +35%']];
  const CARDS = ALL.filter((c) => !subset || subset.includes(c[0]));
  const IDS = [...CARDS.map((c) => c[0]), 'toast'];
  const mk = (id, text) => { let el = document.getElementById(id); if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); } el.textContent = text; return el; };
  const force = () => {
    document.body.classList.remove('v139-carrying', 'v138-context-action', 'v50-action-focus', 'v47-moving');
    for (const [id, text] of CARDS) {
      const el = mk(id, text); el.hidden = false; el.style.setProperty('opacity', '1', 'important'); el.style.setProperty('visibility', 'visible', 'important'); el.style.setProperty('display', 'block', 'important');
      if (id === 'carryRouteV139') el.innerHTML = '<div class="v139Line"><span class="v139Arrow">↑</span><span>На стройку: 🪵 1</span><span class="v139Dist">40 м</span></div><div class="v139Meta">Доставить: ДОСКИ · 0/1</div><div class="v139Bar"><div class="v139Fill" style="width:30%"></div></div>';
    }
    toast('Test toast, long enough to wrap onto a second line on a phone screen');
    try { clearTimeout(toastTimer); } catch (_) {}
  };
  // the chip updaters re-hide an idle chip (hidden attribute / body classes) on their own ticks: undo that in a
  // microtask so the layout pass always sees both panels
  const keep = () => {
    for (const [id] of CARDS) {
      const el = document.getElementById(id);
      if (el && (el.hidden || el.style.opacity !== '1' || el.style.visibility !== 'visible' || el.style.display !== 'block')) { el.hidden = false; el.style.setProperty('opacity', '1', 'important'); el.style.setProperty('visibility', 'visible', 'important'); el.style.setProperty('display', 'block', 'important'); }
    }
    for (const c of ['v139-carrying', 'v138-context-action', 'v50-action-focus', 'v47-moving']) if (document.body.classList.contains(c)) document.body.classList.remove(c);
  };
  force();
  const keeper = new MutationObserver(keep);
  for (const [id] of CARDS) keeper.observe(document.getElementById(id), { attributes: true, attributeFilter: ['hidden', 'style', 'class'] });
  keeper.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const measure = () => {
    const out = {};
    for (const id of IDS) {
      const el = document.getElementById(id); const cs = el && getComputedStyle(el); const r = el?.getBoundingClientRect();
      out[id] = el && !el.hidden && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0 && r.width > 1 && r.height > 1
        ? { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) } : null;
    }
    return out;
  };
  const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const attempts = [];
  for (let i = 0; i < 12; i++) {
    force(); dispatchEvent(new Event('resize'));
    await raf(); await raf();
    const m = measure();
    const all = IDS.every((id) => m[id]) && document.getElementById('toast').classList.contains('show');
    const overlaps = []; for (let a = 0; a < IDS.length; a++) for (let b = a + 1; b < IDS.length; b++) if (hit(m[IDS[a]], m[IDS[b]])) overlaps.push(IDS[a] + '|' + IDS[b]);
    attempts.push({ all, overlaps, m });
    if (all && !overlaps.length) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  keeper.disconnect();
  return attempts;
}, subset);
// scenario A = the user's screenshot (carry route + coach strip + shift goal + toast), scenario B = all nine cards at once
const SCEN = [['A: carry route + coach + shift goal + toast (the user screenshot)', ['carryRouteV139', 'manualCoachV143', 'shiftGoalV127']], ['B: all nine top cards', null]];
for (const [name, subset] of SCEN) {
  const res = await runStack(subset);
  const last = res[res.length - 1];
  console.log(`top stack ${name}: ${res.length} attempt(s), last: ${J(last)}`);
  check(res.some((x) => x.all), `${name}: every card was on screen in at least one attempt (forced visible)`);
  check(res.some((x) => x.all && !x.overlaps.length), `${name}: no two cards overlap at 390x664 (attempts: ${J(res.map((x) => x.overlaps))})`);
  const fin = res.find((x) => x.all && !x.overlaps.length); if (fin) check(Math.max(...Object.values(fin.m).filter(Boolean).map((r) => r.b)) < 640, `${name}: the whole stack ends above the bottom controls (lowest card edge ${Math.max(...Object.values(fin.m).filter(Boolean).map((r) => r.b))} px of 664)`);
  if (subset && fin) check(fin.m.carryRouteV139.t <= 80, `${name}: the carry-route card keeps its own top (${fin.m.carryRouteV139.t} px), the others go below it`);
}

// ---- 3. stat feedback frequency under steady income
const fb = await ev(async () => {
  const hud = document.getElementById('hud');
  const per = new Map(); let v47 = 0;
  const obs = new MutationObserver((ms) => {
    for (const m of ms) {
      const t = m.target;
      if (t.classList?.contains('v47-stat-pulse')) v47++;
      if (t.classList?.contains('v48-stat-feedback') && !(m.oldValue || '').includes('v48-stat-feedback')) per.set(t.id || t.className, (per.get(t.id || t.className) || 0) + 1);
    }
  });
  obs.observe(hud, { attributes: true, attributeFilter: ['class'], attributeOldValue: true, subtree: true });
  const income = setInterval(() => { money += 9; }, 200);
  const sec = setInterval(() => { planks += 1; }, 1000);
  await new Promise((r) => setTimeout(r, 12000));
  clearInterval(income); clearInterval(sec);
  const steady = [...per.values()].reduce((a, b) => a + b, 0);
  const maxPer = Math.max(0, ...per.values());
  // one chunky event (a sale / bulk pickup) must still be allowed to give feedback
  const before = steady;
  money += 5000;
  await new Promise((r) => setTimeout(r, 2500));
  obs.disconnect();
  const after = [...per.values()].reduce((a, b) => a + b, 0);
  return { steady, maxPer, v47, chunky: after - before };
});
console.log('stat feedback:', J(fb));
check(fb.v47 === 0, `the dead v47 pulse layer never adds its class (${fb.v47})`);
check(fb.steady <= 15 && fb.maxPer <= 4, `steady income: <= 4 feedback triggers per stat, <= 15 total in 12 s (total ${fb.steady}, max per stat ${fb.maxPer})`);
check(fb.chunky >= 1, `a chunky +5000 jump still triggers feedback (${fb.chunky})`);

check(g.errors.length === 0, `0 console errors (${J(g.errors.slice(0, 3))})`);
await g.close();
