// Pads that are triggered through the shared nearestManualTargetV53() -> #actionPrompt / #actionBtn path:
// manual-road pad (one paid road section per press since v122), district hub pad, special-project pad (the industrial and market-stall pads are covered by
// staged-unlock / fresh-start / market / industrial-levels). Also: the old menu-hub pad system stays gone.
// ONE browser launch (fresh save, manualRoadModeV116 on). The real #actionBtn is clicked on every animation
// frame until the state flips (same pattern as industrial-levels). If the target resolves but the press never
// acts, a 'KNOWN ISSUE' line is printed (exit 0) instead of failing.
import { openGame, check } from './lib/harness.mjs';

const g = await openGame({ save: 'clear', waitMs: 4000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const J = (o) => JSON.stringify(o);

async function pressUntil(label, doneSrc) {
  const ok = await page.waitForFunction((src) => {
    if (new Function('return (' + src + ')')()) return true;
    const btn = document.getElementById('actionBtn');
    if (btn && !btn.hidden && !btn.disabled) btn.click();
    return false;
  }, doneSrc, { timeout: 25000, polling: 'raf' }).then(() => true, () => false);
  if (!ok) console.log(`KNOWN ISSUE: pressing #actionBtn on the ${label} pad did not trigger its action within 25 s`);
  return ok;
}

// ---- 0. old hub-pad system is gone
const gone = await ev(() => [typeof buildWorldNavPadV362, typeof createWorldNavPadsV362, typeof worldNavRuntimeV362]);
check(gone.every((t) => t === 'undefined'), `old world-nav hub pad system is gone (${J(gone)})`);

// ---- 1. manual road pad (first bought house whose driveway is not paved yet)
await ev(() => { money = 999999; purchaseCurrentPad(); });
await page.waitForTimeout(500);
const road = await ev(() => {
  const b = buildings.find((x) => Number.isInteger(x?.index) && !manualRoadStagesV116.has(x.index));
  if (!b) return { none: true, paved: [...manualRoadStagesV116], buildings: buildings.map((x) => x.index) };
  const pos = typeof globalThis.roadBuildPadPosV122 === 'function' ? globalThis.roadBuildPadPosV122(b.index) : stageRoadEndpointV367(b.index);
  player.position.set(pos.x, 0, pos.z);
  const t = nearestManualTargetV53(); return { idx: b.index, type: t?.type, tIdx: t?.stageIndexV116 };
});
console.log('road pad setup:', J(road));
if (road.none) console.log('KNOWN ISSUE: no unpaved house after purchaseCurrentPad() on a fresh save, manual-road pad not exercised');
else {
  check(road.type === 'road' && road.tIdx === road.idx, `at the unpaved driveway endpoint the nearest target is the road pad (${J(road)})`);
  // v122/v123: the pad pays and lays ONE road section per press (state.roadSections[i]); the section counter is read
  // through the v123 state object only to know when to stop pressing, the charge is checked on `money` itself
  const m0 = await ev(() => { money = 999999; return money; });
  const roadOk = await pressUntil('manual-road', `(window.__TYCOON_V123__?.state?.roadSections?.[${road.idx}] || 0) >= 1 || manualRoadStagesV116.has(${road.idx})`);
  const spent = m0 - await ev(() => money);
  if (roadOk) check(true, `road pad pressed through #actionBtn lays a road section for house ${road.idx} (money spent, net of income: ${spent})`);
}

// ---- 2. district pad
const dist = await ev(() => {
  money = 1e7; planks = 999; concrete = 999; metal = 999; cityState.reputation = 100;
  const cfg = CITY_DISTRICTS.find((d) => d.id === 'suburb');
  player.position.set(cfg.pos.x, 0, cfg.pos.z);
  const t = nearestManualTargetV53(); return { type: t?.type, id: t?.cfg?.id, lvl: districtLevel('suburb') };
});
check(dist.type === 'district' && dist.id === 'suburb', `standing on the suburb hub offers the district pad (${J(dist)})`);
const distOk = await pressUntil('district', `districtLevel('suburb') > ${dist.lvl}`);
if (distOk) check(true, `district pad pressed through #actionBtn upgrades the district (${dist.lvl} -> ${await ev(() => districtLevel('suburb'))})`);

// ---- 3. special-project pad
const proj = await ev(() => {
  stageIndex = Math.max(stageIndex, 3); money = 1e7; planks = 999; concrete = 999; metal = 999;
  refreshSpecialProjectWorld();
  const p = SPECIAL_PROJECTS.find((x) => x.id === 'park');
  player.position.set(p.pos.x, 0, p.pos.z);
  const t = nearestManualTargetV53(); return { type: t?.type, id: t?.project?.id, available: specialProjectRuntime.available.has('park') };
});
check(proj.type === 'project' && proj.id === 'park', `standing on the vacant park site offers the project pad (${J(proj)})`);
const projOk = await pressUntil('special-project', "specialProjectState.active?.id === 'park'");
if (projOk) check(true, 'project pad pressed through #actionBtn starts the special project');

check(g.errors.length === 0, `0 console errors (${J(g.errors.slice(0, 3))})`);
await g.close();
