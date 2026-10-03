// In-world guidance (ported from archive/tycoon-v116/tests/guidance.test.mjs, re-verified against v161):
// nextActionableTargetV117() must walk the new player through house -> road -> depot -> sawmill,
// the pad highlight must follow it, the gold ground arrow must point (numerically, not "by eye") at
// the target, hide when close, and the floating text popup must spawn and dispose itself.
// Changes in v161 versus v116 that the checks follow:
//   - the road target is the next 3 m road SECTION (roadBuildPadPosV122, v122), not the far endpoint,
//   - on a fresh save currentGuidanceTarget() (compass) is owned by the v144 starter job until two
//     supply runs are done, while nextActionableTargetV117() (pad highlight / ground arrow) is not.
// One browser launch, fresh save. State is driven through the owning functions, not real-time waits.
import { openGame, check } from './lib/harness.mjs';

const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-3;

// ---- 1. fresh boot: the first target is the first house pad, even though the depot is also affordable
const s1 = await ev(() => {
  const t = nextActionableTargetV117(), cg = currentGuidanceTarget();
  return {
    type: t?.type, pos: t && { x: t.pos.x, z: t.pos.z }, pad: currentPad && { x: currentPad.pos.x, z: currentPad.pos.z },
    money: money, depotCost: industrialStepV118('depot').cost.money,
    compass: cg && { type: cg.type, x: cg.pos.x, z: cg.pos.z },
  };
});
check(s1.type === 'stage' && s1.pad && near(s1.pos, s1.pad), `fresh boot targets the first house pad (type ${s1.type})`);
check(s1.money >= s1.depotCost, `sanity: the depot is also affordable at boot (${s1.money} >= ${s1.depotCost}), house must still win`);
check(s1.compass?.type === 'starter', `compass target is owned by the v144 starter job until the supply runs are done (${s1.compass?.type})`);

// ---- 2. buy the house (real cost path): the target moves to the road pad
await ev(() => { money = 100000; });
const bought = await ev(() => purchaseCurrentPad());
check(bought === true, 'first house purchased through purchaseCurrentPad()');
await page.waitForFunction(() => !!roadPadMarkersV116.get(0), null, { timeout: 30000, polling: 250 }).catch(() => {});
const s2 = await ev(() => {
  const t = nextActionableTargetV117(), want = globalThis.roadBuildPadPosV122(0), m = roadPadMarkersV116.get(0);
  return {
    type: t?.type, idx: t?.stageIndexV117, pos: t && { x: t.pos.x, z: t.pos.z }, want: { x: want.x, z: want.z },
    marker: !!m, markerInScene: !!m && (() => { for (let p = m; p; p = p.parent) if (p === scene) return true; return false; })(),
    markerPos: m && { x: m.position.x, z: m.position.z },
  };
});
check(s2.type === 'road' && s2.idx === 0, `after buying the house the target is the pending road of house 0 (${s2.type}/${s2.idx})`);
check(near(s2.pos, s2.want), `road target = the current road section pad roadBuildPadPosV122(0) (${JSON.stringify(s2.pos)})`);
check(s2.marker && s2.markerInScene && near(s2.markerPos, s2.want), 'a road pad marker exists in the scene exactly at that point');
const hl2 = await ev(() => { updateActionableHighlightV117(); return roadPadMarkersV116.get(0)?.userData.disc.material.color.getHex(); });
check(hl2 === 0xE9AD3D, `the road pad is highlighted gold (0x${hl2?.toString(16)})`);

// ---- 3. floating text popup: one road section spawns one, it disposes itself (synthetic dt, not wall clock)
const popup = await ev(() => {
  for (let i = 0; i < 30; i++) updateFloatingTextPopupsV117(0.1); // drain anything spawned earlier
  const before = floatingTextPopupsV117.length, p = globalThis.roadBuildPadPosV122(0);
  player.position.set(p.x, 0, p.z);
  const ok = buildManualRoadStageV116(0, p);
  const spawned = floatingTextPopupsV117.length;
  for (let i = 0; i < 30; i++) updateFloatingTextPopupsV117(0.1);
  return { ok, before, spawned, after: floatingTextPopupsV117.length };
});
check(popup.ok === true && popup.before === 0 && popup.spawned >= 1, `building a road section spawns a floating text popup (${popup.before} -> ${popup.spawned})`);
check(popup.after === 0, `the popup disposes itself after its lifetime (${popup.after} left)`);

// ---- 4. finish the road (real section purchases): target moves on to the depot pad, highlight follows
const roadDone = await ev(() => {
  for (let i = 0; i < 40 && !manualRoadStagesV116.has(0); i++) {
    const p = globalThis.roadBuildPadPosV122(0);
    player.position.set(p.x, 0, p.z);
    buildManualRoadStageV116(0, p);
  }
  return manualRoadStagesV116.has(0);
});
check(roadDone, 'road of house 0 completed through its sections');
const s4 = await ev(() => {
  money = 5000;
  const t = nextActionableTargetV117(), depot = industrialStepV118('depot');
  updateActionableHighlightV117();
  const col = (id) => industrialPadMarkersV118.get(id)?.userData.disc.material.color.getHex();
  return {
    type: t?.type, step: t?.stepId, pos: t && { x: t.pos.x, z: t.pos.z }, depot: { x: depot.pos.x, z: depot.pos.z },
    planksNeeded: STAGES[stageIndex]?.plankCost, planks, depotCol: col('depot'), roadMarkerGone: !roadPadMarkersV116.get(0),
  };
});
check(s4.planksNeeded > s4.planks, `sanity: the next house needs planks the player has not got (${s4.planksNeeded} > ${s4.planks})`);
check(s4.type === 'industrial' && s4.step === 'depot' && near(s4.pos, s4.depot), `road done -> target is the depot pad (${s4.type}/${s4.step})`);
check(s4.depotCol === 0xE9AD3D && s4.roadMarkerGone, `depot pad highlighted, road marker removed (0x${s4.depotCol?.toString(16)}, gone ${s4.roadMarkerGone})`);

// ---- 5. ground arrow: far -> visible and numerically aimed at the real target; near -> hidden
const arrow = await ev(() => {
  const t = nextActionableTargetV117(), grp = ensureGroundArrowV117();
  const tip = () => { // world direction of the chevron: base-centre (local 0,0.34) -> tip (local 0,-0.6)
    grp.updateMatrixWorld(true);
    const m = grp.userData.arrowMesh, a = m.localToWorld(new THREE.Vector3(0, 0.34, 0)), b = m.localToWorld(new THREE.Vector3(0, -0.6, 0));
    return { x: b.x - a.x, z: b.z - a.z, y: b.y - a.y, len: Math.hypot(b.x - a.x, b.z - a.z) };
  };
  const dirTo = (pos) => { const dx = pos.x - player.position.x, dz = pos.z - player.position.z, l = Math.hypot(dx, dz); return { x: dx / l, z: dz / l }; };
  // the real target from a far position
  player.position.set(t.pos.x + 40, 0, t.pos.z + 30);
  updateActionableHighlightV117();
  const far = { visible: grp.visible, tip: tip(), want: dirTo(t.pos), at: { x: grp.position.x, y: grp.position.y, z: grp.position.z }, player: { x: player.position.x, z: player.position.z } };
  // six synthetic directions (axes + diagonals): the tip must match the target direction to 4 decimals
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]], six = [];
  for (const [dx, dz] of dirs) {
    const l = Math.hypot(dx, dz);
    player.position.set(0, 0, 0);
    updateGroundArrowV117({ pos: new THREE.Vector3((dx / l) * 25, 0, (dz / l) * 25) });
    const v = tip();
    six.push({ dir: [dx, dz], dot: (v.x * dx + v.z * dz) / (l * v.len), visible: grp.visible });
  }
  // close to the target: hidden
  player.position.set(t.pos.x + 1, 0, t.pos.z);
  updateActionableHighlightV117();
  return { far, six, nearVisible: grp.visible };
});
check(arrow.far.visible, 'ground arrow visible when the target is far');
const farDot = (arrow.far.tip.x * arrow.far.want.x + arrow.far.tip.z * arrow.far.want.z) / arrow.far.tip.len;
check(farDot > 0.9999 && farDot < 1.0001 && Math.abs(arrow.far.tip.y) < 1e-6, `arrow tip vector points at the real target (dot ${farDot.toFixed(5)}, flat)`);
const toward = Math.hypot(arrow.far.at.x - arrow.far.player.x, arrow.far.at.z - arrow.far.player.z);
check(Math.abs(toward - 1.65) < 0.01 && Math.abs(arrow.far.at.y - 0.05) < 1e-6, `arrow sits 1.65 m in front of the player on the ground (${toward.toFixed(3)} m, y ${arrow.far.at.y})`);
for (const s of arrow.six) check(s.visible && s.dot > 0.9999 && s.dot < 1.0001, `arrow tip matches direction ${JSON.stringify(s.dir)} (dot ${s.dot.toFixed(5)})`);
check(!arrow.nearVisible, 'ground arrow hides when the player is close to the target');

// ---- 6. depot built -> sawmill is next (depot marker gone); sawmill built -> chain done, guidance falls through
const s6 = await ev(() => {
  window.__TYCOON_V144__.state.runs = 2; // finish the starter supply loop so the compass chain is the base one again
  money = 5000;
  const okDepot = buildIndustrialStepV118(industrialStepV118('depot'));
  money = 5000;
  const t = nextActionableTargetV117(), sawmill = industrialStepV118('sawmill');
  updateActionableHighlightV117();
  const r = {
    okDepot, depotBuilt: fleetDepotBuiltV118, depotMarkerGone: !industrialPadMarkersV118.get('depot'),
    type: t?.type, step: t?.stepId, posOk: !!t && Math.hypot(t.pos.x - sawmill.pos.x, t.pos.z - sawmill.pos.z) < 1e-3,
    sawmillCol: industrialPadMarkersV118.get('sawmill')?.userData.disc.material.color.getHex(),
  };
  money = 5000;
  const okSaw = buildIndustrialStepV118(industrialStepV118('sawmill'));
  money = 10; // concrete (475) / metal (650) not affordable -> nothing actionable
  const after = nextActionableTargetV117(), fallback = currentGuidanceTarget();
  updateActionableHighlightV117();
  return { ...r, okSaw, sawmillBuilt: sawmillBuiltV118, sawmillMarkerGone: !industrialPadMarkersV118.get('sawmill'),
    afterNull: after === null, fallback: !!fallback && Number.isFinite(fallback.pos.x), arrowHidden: !ensureGroundArrowV117().visible };
});
check(s6.okDepot && s6.depotBuilt && s6.depotMarkerGone, 'depot built, its pad marker removed');
check(s6.type === 'industrial' && s6.step === 'sawmill' && s6.posOk && s6.sawmillCol === 0xE9AD3D, `target moves to the sawmill pad and highlights it (${s6.type}/${s6.step}, 0x${s6.sawmillCol?.toString(16)})`);
check(s6.okSaw && s6.sawmillBuilt && s6.sawmillMarkerGone, 'sawmill built, its pad marker removed');
check(s6.afterNull, 'once concrete/metal are unaffordable nextActionableTargetV117() is null (falls through)');
check(s6.fallback, 'currentGuidanceTarget() still returns a real target (tree / sawmill fetch chain)');
check(s6.arrowHidden, 'ground arrow hidden when there is no actionable target');

check(g.errors.length === 0, `no console errors ${JSON.stringify(g.errors.slice(0, 3))}`);
await g.close();
