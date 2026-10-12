// Fleet / base / tenders / market sheets stay still and every tap lands (2026-10-12; assets/panel-stable-v161.js).
// User report: "the Transport sheet keeps refreshing, I cannot buy or upgrade anything". Root cause: ~10 wrappers around renderFleetPanel (and the base / tenders renderers)
// rewrote the whole sheet several times per second, so every button was replaced under the finger (31 buttons, ~2750 DOM mutations per 10 s of idle).
// ONE browser launch (old-format save, stage jumped, vehicle owned):
//   1. idle 10 s with each sheet open: ZERO buttons replaced; the fleet sheet <= 2 DOM mutations; no sheet grows (duplicated sections / listeners);
//   2. real touch taps (CDP touchStart / touchEnd, hold 80-200 ms) on upgrade buttons at full speed and with the CPU throttled 4x (~5 fps):
//      every tap arrives, one purchase per tap, the price charged equals the price printed on the button, the sheet shows the new level;
//   3. a press that is held WHILE the renderers run again (forced renders + updateHUD) still ends as exactly one purchase on the SAME button node;
//   4. 25 forced re-renders do not multiply listeners (one tap == one purchase) and do not change the number of sections / ids (no duplicates);
//   5. market sheet (systems) and staff sheet purchases also land once; 0 console errors / 4xx.
import { openGame, check, OLD_SAVE, jumpStage } from './lib/harness.mjs';

const g = await openGame({ save: OLD_SAVE, waitMs: 6000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = JSON.stringify;
const cdp = await page.context().newCDPSession(page);
const sleep = (ms) => page.waitForTimeout(ms);

const SHEETS = [
  ['fleetOverlay', 'renderFleetPanel'], ['baseOverlay', 'renderBasePanel'], ['tendersOverlay', 'renderTendersPanel'], ['systemsOverlay', 'renderSystemsPanel'],
  ['staffOverlay', 'renderStaffPanel'], ['bonusOverlay', 'renderBonusPanel'], ['projectsOverlay', 'renderProjectsPanel'], ['metaOverlay', 'renderMetaPanel'], ['operationsOverlay', 'renderOperationsPanel'],
];
async function openSheet(id, fn) {
  await ev(({ id, fn }) => {
    document.querySelectorAll('[id$=Overlay].show').forEach((e) => e.classList.remove('show'));
    window[fn] ? window[fn]() : eval(fn + '()');
    document.getElementById(id).classList.add('show');
  }, { id, fn });
  await sleep(1500);
}
// Real touch: touchStart, hold, touchEnd on the centre of the element (scrolled into view). The pointerdown target is recorded: when the layout moved between
// aiming and touching (a card grows a Service button after an upgrade; slow at 4x CPU) the tap lands on a neighbour, which is a MISS of the test, not of the sheet: aim again (<= 3 tries).
await ev(() => document.addEventListener('pointerdown', (e) => { window.__down = e.target; }, true));
let misses = 0;
async function tap(selector, holdMs = 120, between = null) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pt = await ev((sel) => {
      const el = document.querySelector(sel); if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
      window.__down = null;
      return { x, y, ok: !!top && (top === el || el.contains(top)) };
    }, selector);
    if (!pt || !pt.ok) { await sleep(300); continue; }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pt.x, y: pt.y }] });
    if (between) await between();
    await sleep(holdMs);
    const landed = await ev((sel) => { const el = document.querySelector(sel); return !!(window.__down && (el === window.__down || (el && el.contains(window.__down)))); }, selector);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    if (landed) return true;
    misses++;
    await sleep(500);
  }
  return false;
}
// every real charge of the game, as the game itself reports it (tryPayResources), so income during the wait does not blur the price check
await ev(() => { window.__charges = []; const orig = tryPayResources; tryPayResources = function (c) { const ok = orig.apply(this, arguments); if (ok && c && c.money) window.__charges.push(c.money); return ok; }; });
const charges = () => ev(() => window.__charges.splice(0));

try {
  await jumpStage(page, 16);
  await ev(() => {
    money = 1e7; wood = 9999; concrete = 9999; metal = 9999; planks = 9999;
    window.__TYCOON_V123__.state.owned.planks = true; // the lumber truck is bought: its upgrade button becomes live
    fleetState.planks = 0; staffState && 0;
    updateHUD();
  });
  check(await ev(() => !!window.PanelStableV161), 'panel-stable layer loaded');

  // ---- 1. idle: no button replaced, no growth
  const idle = {};
  for (const [id, fn] of SHEETS) await openSheet(id, fn); // warm-up: the one-off decoration of freshly shown cards (v45 'entered', first card classes) is not idle churn
  for (const [id, fn] of SHEETS) {
    await openSheet(id, fn);
    await sleep(2500); // the one-off 'entered' decoration of freshly shown cards (v45) is not idle churn
    idle[id] = await ev(async (id) => {
      const el = document.getElementById(id), sel = 'button,[data-fleet],[data-service]';
      const before = new Set(el.querySelectorAll(sel)), len0 = el.innerHTML.length, ids0 = el.querySelectorAll('[id]').length;
      let muts = 0, added = 0; const what = [];
      const mo = new MutationObserver((l) => { for (const m of l) { muts++; if (m.type === 'childList') added += m.addedNodes.length; if (what.length < 4) what.push(m.type + ':' + (m.attributeName || '') + ':' + (m.target.id || m.target.className || m.target.nodeName).toString().slice(0, 30)); } });
      mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true });
      await new Promise((r) => setTimeout(r, 10000));
      mo.disconnect();
      const now = [...el.querySelectorAll(sel)];
      return { muts, added, replaced: now.filter((b) => !before.has(b)).length, buttons: now.length, grew: el.innerHTML.length - len0, idsGrew: el.querySelectorAll('[id]').length - ids0, what };
    }, id);
  }
  console.log('idle (10 s per sheet):', J(idle));
  for (const [id] of SHEETS) check(idle[id].replaced === 0 && idle[id].added === 0 && Math.abs(idle[id].idsGrew) === 0, `${id}: idle 10 s replaces 0 buttons, adds 0 nodes, no duplicated ids (${J(idle[id])})`);
  check(idle.fleetOverlay.muts <= 2, `fleet sheet idle: <= 2 DOM mutations in 10 s (${idle.fleetOverlay.muts}; was ~2750)`);
  check(Object.values(idle).every((s) => s.muts <= 20), `no sheet exceeds 20 mutations in 10 s of idle (${J(Object.fromEntries(Object.entries(idle).map(([k, v]) => [k, v.muts])))})`);

  // ---- 2. real taps, normal speed and 4x CPU throttle
  async function upgradeRun(label, holds) {
    await openSheet('fleetOverlay', 'renderFleetPanel');
    const results = [];
    for (const hold of holds) {
      const pre = await ev(() => { const cost = fleetUpgradeCost('planks'), lv = fleetLevel('planks'), b = document.querySelector('[data-fleet="planks"]'); return { cost: cost.money, lv, text: b?.textContent || '', disabled: !!b?.disabled, m: money }; });
      if (pre.lv >= 3) break;
      const printed = Number((pre.text.match(/(\d[\d\s.,]*)\s*$/) || [])[1]?.replace(/[^\d]/g, '')) || null;
      await charges();
      const ok = await tap('[data-fleet="planks"]', hold);
      await sleep(900);
      const ch = await charges();
      const post = await ev(() => { const b = document.querySelector('[data-fleet="planks"]'); return { lv: fleetLevel('planks'), m: money, text: b?.textContent || '', status: b?.closest('.fleetCard')?.querySelector('.status')?.textContent || '' }; });
      results.push({ hold, ok, lv: [pre.lv, post.lv], paid: ch, cost: pre.cost, printed, textChanged: post.text !== pre.text, status: post.status.trim() });
    }
    console.log(label, J(results));
    return results;
  }
  await ev(() => { fleetState.planks = 0; renderFleetPanel(); });
  const fast = await upgradeRun('taps @ normal speed', [80, 140, 200]);
  check(fast.length === 3 && fast.every((r) => r.ok && r.lv[1] === r.lv[0] + 1 && r.paid.length === 1 && r.paid[0] === r.cost && (r.lv[0] > 0 || r.printed === r.cost) && r.textChanged && r.status.includes(`upgrade ${r.lv[1]}/3`)), `3 of 3 touch taps (80/140/200 ms) upgrade once at the printed exact price, the sheet shows the new level ${J(fast.map((r) => r.paid))}`);
  check(await ev(() => fleetLevel('planks') === 3 && /3\/3/.test(document.querySelector('[data-fleet="planks"]').closest('.fleetCard').textContent)), 'the sheet shows the new state (level 3 / MAX)');
  await ev(() => { fleetState.planks = 0; renderFleetPanel(); });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const slow = await upgradeRun('taps @ CPU x4', [80, 140, 200]);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check(slow.length === 3 && slow.every((r) => r.ok && r.lv[1] === r.lv[0] + 1 && r.paid.length === 1 && r.paid[0] === r.cost && (r.lv[0] > 0 || r.printed === r.cost) && r.textChanged && r.status.includes(`upgrade ${r.lv[1]}/3`)), `3 of 3 touch taps at 4x CPU throttle upgrade once at the exact price, the sheet shows the new level ${J(slow.map((r) => r.paid))}`);

  // ---- 3. press held across forced renders
  await ev(() => { fleetState.planks = 0; renderFleetPanel(); });
  await sleep(600);
  const held = await (async () => {
    const pre = await ev(() => ({ m: money, lv: fleetLevel('planks'), cost: fleetUpgradeCost('planks').money }));
    await charges();
    const same = { before: null };
    const ok = await tap('[data-fleet="planks"]', 250, async () => {
      same.before = true;
      await ev(() => { window.__heldNode = document.querySelector('[data-fleet="planks"]'); for (let i = 0; i < 6; i++) { renderFleetPanel(); updateHUD(); } });
      await sleep(400);
      same.kept = await ev(() => window.__heldNode === document.querySelector('[data-fleet="planks"]') && window.__heldNode.isConnected);
    });
    await sleep(900);
    const post = await ev(() => ({ m: money, lv: fleetLevel('planks') }));
    return { ok, pre, post, kept: same.kept, paid: await charges() };
  })();
  check(held.ok && held.kept && held.post.lv === held.pre.lv + 1 && held.paid.length === 1 && held.paid[0] === held.pre.cost, `press held across 6 forced renders + 400 ms: same button node, one purchase at the exact price (${J(held)})`);

  // ---- 4. 25 re-renders: no listener multiplication, no duplicated sections
  const dup = await ev(() => {
    const ids = () => [...document.querySelectorAll('#fleetOverlay [id]')].map((e) => e.id);
    fleetState.planks = 0; renderFleetPanel();
    const a = ids(), n0 = document.querySelectorAll('#fleetOverlay *').length;
    for (let i = 0; i < 25; i++) renderFleetPanel();
    const b = ids();
    return { same: JSON.stringify(a) === JSON.stringify(b), n0, n1: document.querySelectorAll('#fleetOverlay *').length, uniq: new Set(b).size === b.length };
  });
  check(dup.same && dup.uniq && Math.abs(dup.n1 - dup.n0) <= 4, `25 forced renders keep the section/id list identical and unique (${J(dup)})`);
  const once = await (async () => {
    const pre = await ev(() => ({ m: money, lv: fleetLevel('planks'), cost: fleetUpgradeCost('planks').money }));
    await charges();
    await tap('[data-fleet="planks"]', 100);
    await sleep(900);
    const post = await ev(() => ({ m: money, lv: fleetLevel('planks') }));
    return { pre, post, paid: await charges() };
  })();
  check(once.post.lv === once.pre.lv + 1 && once.paid.length === 1 && once.paid[0] === once.pre.cost, `after 25 renders one tap is still ONE purchase at the exact price (${J(once)})`);

  // ---- 5. staff sheet + market (systems) sheet
  await openSheet('staffOverlay', 'renderStaffPanel');
  const staff = await (async () => {
    const pre = await ev(() => ({ m: money, text: document.querySelector('[data-staff="builder"]')?.textContent || '', dis: !!document.querySelector('[data-staff="builder"]')?.disabled }));
    const printed = Number((pre.text.match(/(\d[\d\s.,]*)\s*$/) || [])[1]?.replace(/[^\d]/g, '')) || null;
    await charges();
    const ok = await tap('[data-staff="builder"]', 120);
    await sleep(900);
    const post = await ev(() => ({ m: money, text: document.querySelector('[data-staff="builder"]')?.textContent || '' }));
    return { ok, paid: await charges(), printed, dis: pre.dis, after: post.text.trim() };
  })();
  check(staff.ok && staff.paid.length === 1 && staff.paid[0] === staff.printed, `staff sheet: one tap hires once at the printed price (${J(staff)})`);
  await openSheet('systemsOverlay', 'renderSystemsPanel');
  const market = await (async () => {
    const pre = await ev(() => ({ n: document.querySelectorAll('#systemsOverlay button').length, lv: fieldUpgrades.carry || 0, m: money }));
    await charges();
    const ok = await tap('[data-v60-field="carry"]', 120);
    await sleep(900);
    const post = await ev(() => ({ n: document.querySelectorAll('#systemsOverlay button').length, lv: fieldUpgrades.carry || 0, m: money, sub: document.querySelector('[data-v60-field="carry"]')?.closest('.v30Row')?.querySelector('.sub')?.textContent || '' }));
    await sleep(1500);
    const later = await ev(() => ({ lv: fieldUpgrades.carry || 0 }));
    return { ok, lv: [pre.lv, post.lv, later.lv], dMoney: pre.m - post.m, shown: post.sub.trim(), buttonsBefore: pre.n, buttonsAfter: post.n };
  })();
  check(market.ok && market.lv[1] === market.lv[0] + 1 && market.lv[2] === market.lv[1] && market.dMoney > 0 && market.shown.includes(`L${market.lv[1]}/`) && market.buttonsBefore === market.buttonsAfter, `market sheet: one tap on the production upgrade raises the level once, charges, and the row shows the new level (${J(market)})`);

  check(g.errors.length === 0, `no console/page errors (${J(g.errors.slice(0, 5))})`);
  check(g.badResponses.length === 0, 'no 4xx');
  console.log('tap misses (layout moved under the aim, retried):', misses);
  console.log('panel-stable stats', J(await ev(() => window.PanelStableV161.stats)));
} finally { await g.close(); }
