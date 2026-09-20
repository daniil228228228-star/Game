# Tycoon 3D — v19+ design brief & roadmap

This is the standing brief for `tycoon-v19.html`, a separate, more advanced
prototype the user has been iterating outside this session (v1..v19) and
asked to continue here, edited in place, from v19 onward. It is **not** the
same file as `tycoon.html` (the archetype/sawmill-workers prototype from
earlier sessions in this repo) — the two are independent and this brief
only governs `tycoon-v19.html`.

Full original spec from the user is condensed below into a checklist so a
future session (autonomous loop or human-directed) can pick up the next
highest-impact gap without re-reading a 600-line prompt. When in doubt,
re-read the "non-negotiable rules" before touching anything.

## North star

*"I started a tiny construction outfit hand-cutting logs, and gradually
built a construction empire with factories, warehouses, equipment, offices
and skyscrapers."* The player should always be able to answer: what am I
doing right now, why, what do I get, what unlocks next, and how is my
territory visibly getting richer/more automated. Minimize moments where the
player just stands and waits.

## Non-negotiable rules

- **Every object on the map needs a function.** No vehicle that just drives
  around, no worker that wanders randomly, no building that's pure decor.
  If it's visible, it does something a player can name.
- **Pick the next priority yourself.** Never ask the user "what next" —
  read this doc, pick the highest-impact incomplete item, and do it.
- **Meaningful slices, not version-number bumps.** Each session should make
  the game *noticeably* better, not tweak one constant.
- **Test the real gameplay loop, not just syntax.** `node --check` passing
  proves nothing. Actually playtest: start → move → chop → carry → drop off
  → production → buy a building → construction → equipment → completion →
  income → upgrade → save → reload. Use the player-teleport-via-save (or
  via direct `player.position.set(...)` + calling the real purchase/state
  functions, since this file is classic scripts and top-level `let/const`
  bindings ARE reachable from `page.evaluate()`) — never fight the
  follow-camera by overriding `camera.position` alone, it gets stomped by
  `updatePlayer()` every frame.
- **No flying objects.** Before calling a slice done, check: wheels touch
  ground, workers stand on ground, foundations aren't floating, signs are
  attached, cranes aren't hovering, beams don't clip, trees grow from the
  ground, roofs sit on walls, cargo sits in truck beds. This is one of the
  main quality bars the user explicitly called out.
- Keep it a single self-contained `tycoon-v19.html` for now (matches this
  repo's existing no-build-step convention). Only split into `/src` modules
  once the design has settled (user's own item 29) — not yet.

## Audit — what v19 already had before this session

Confirmed by reading the code and by headless-browser playtesting (not just
grepping), so future sessions don't waste time re-building working systems:

- **6-phase construction pipeline already exists** and is genuinely good:
  `CONSTRUCTION_PHASES` (prep → foundation → frame → walls → roof →
  finish), `spawnConstructionSite()` builds a real site (fence, site office
  cabin, footings, steel skeleton, wall panels, archetype-aware roof,
  window/door finish kit, a working tower crane with rotating jib + bobbing
  hook + cargo block, a spinning cement mixer, an excavator with an
  oscillating arm, a rebar cage, a beam stack), and
  `setConstructionPhaseVisual()`/`updateConstructionSites()` animate all of
  it and swap visibility per phase. Verified visually via headless
  screenshots at multiple phases (see session log) — grounded, no floating
  parts, crane/mixer/excavator animate only during the right phases.
- **Delivery vehicles already accelerate construction.** `assignVehicleJob`
  / `moveWorkVehicle` route a delivery truck and a lift truck to whichever
  site needs them (by phase — delivery for phase ≤3, lift for phase ≥4),
  with a compact status label (`МАТЕРИАЛЫ / доставка на объект`), and
  arriving actually speeds up `build.timer`. Not yet: naming the specific
  resource + target building on the label (spec wants e.g. "Доски → Дом");
  currently generic "MATERIALS". Small, not urgent.
  labels.
- **Auto-fit label text already exists**: `fitLabelFont()` /
  `drawLabelLine()` shrink font until text fits, used by `makeLabelSprite`.
  Section 23's requirement is already satisfied generically.
- **Choppable trees, log-carrying, sawmill drop-off, conveyor, global
  field-upgrades (Build Speed / Carry Capacity / Wood Yield / Sawmill),
  achievements, prestige, i18n (ru/en), save versioning (`saveVersion: 4`)**
  all already exist and work (verified with a headless pass — build a
  house end to end, income starts, upgrade pad appears).
- **No contracts system existed** before this session (spec item 19) —
  implemented in the previous session, see below.
- Vehicle navigation was **not** on road nodes as of the previous session
  (`makeVehiclePath()` was a straight 3-point path: home → map center →
  target). **Fixed this session** — see "What this session added" below.
- Re-checked the two "known mobile bugs" noted by the previous session
  before spending a slice on them, and downgraded both after a closer look
  (measured actual DOM bounding boxes + screenshots at 390px, not just a
  glance): the 5-chip HUD stats row wraps to 2 lines at narrow widths, but
  reads cleanly (no overlap/garble) — not actually broken, just two lines
  instead of one; acceptable per section 22's "don't take half the
  screen" bar. The field-upgrade label appearing near the screen edge is a
  world-space 3D sprite near the current camera framing's edge, not a
  CSS/DOM overflow bug — any world-space label can be partially
  off-screen depending on where the player is standing, and that's
  expected behavior for this label system, not a defect. Neither is worth
  a dedicated slice; removed from the priority list below.

## What recent sessions added (most recent first)

**NPC worker roles + stay-near-base idle behavior** (this session, spec
section 17). Audited `createWorkerNPC()`/`spawnAmbientLife()` and found the
7 ambient workers were all the exact same model with only a random shirt
color from a 7-color palette — no role distinction at all — and when idle
(no construction to help with), `chooseWorkerTarget()` sent them to a
random point among *every* building position on the map via
`ambientTargetPoints()`, which could be far from wherever they actually
started. Neither matched spec section 17 (four named roles: 👷 Строитель/
🔧 Монтажник/🦺 Прораб/📦 Грузчик; idle workers should stay near base with
short routes, not roam the whole map).

Fixed both: added a `WORKER_ROLES` table (builder/rigger/foreman/loader)
with a distinct helmet+brim color per role (the most legible signal at
ambient-NPC distance) and a role-appropriate hand tool built by a new
`addWorkerTool()` helper (brick / wrench / clipboard / stacked crate),
each parented directly onto the existing `armR` limb group so it
automatically follows the same arm-swing animation the worker already
had — no new animation code needed. `createWorkerNPC()` now takes a role
key (a bare color still works via a back-compat branch, used by the
lift's rider). `spawnAmbientList()`'s 7 workers now cycle through the 4
roles and each stores its spawn point as `worker.homeBase`;
`chooseWorkerTarget()`'s "nothing to help with" branch now picks a point
near that stored `homeBase` (±1.6 units) instead of `ambientTargetPoints()`
(removed, now dead code) — deleted the ~24-line function.

Verified with a headless-browser pass: confirmed all 7 workers spawn with
the expected 2/2/2/1 role distribution and a stored `homeBase`; sampled
distance-from-home-base every 1.5s over a 12-second window with no active
construction and confirmed every worker stayed within ~1.9 units of home
(previously they could roam to any building anywhere on the spiral);
confirmed the "72% chance to go help an active build" behavior still
works unchanged (6 of 7 workers correctly picked up a freshly-started
house's construction site within 6 seconds); confirmed programmatically
that each role's helmet material is the exact intended distinct color
(not just relying on a screenshot, which this scene's bright tone-mapping
can wash out); and confirmed every tool prop is a direct child of `armR`
at the hand position and its world position genuinely moves when `armR`
rotates (0.557 units for a 1-radian test rotation) — i.e. not a
disconnected floating prop, the exact class of bug fixed on the lift last
session. Re-ran the full regression suite (boot, construction, contracts,
road-node routing, the lift) with zero new failures.

**Fixed the lift/telehandler's disconnected platform + gave it real
deploy/extend/retract behavior** (previous session, spec section 6). Audited
`createWorkLift()` against the spec (base, wheels, outriggers, telescoping
arm, basket, worker inside) and found a real bug: the platform (the
basket the whole vehicle exists to raise) was a **separate mesh at a
fixed absolute height**, not a child of the scissor-arm pivot
(`liftArms`) that the animation loop actually moves — so the "lift" never
visibly lifted its own basket; the arms shifted by a token amount
underneath a platform that just sat there. Confirmed with a structural
check (`platformIsChildOfArms: false`, platform fixed at local Y 1.72
while the arms only ever spanned roughly 0.46-1.5) before touching
anything. Fixed by: reparenting the platform (+ guard rail/posts) onto
`liftArms` so it now genuinely rides the mechanism; widening the
raise/lower range `moveWorkVehicle()` drives it across (retracted 0.34 →
working 1.35, or 1.95 during the finishing phase) so the raise is
actually visible instead of a token few centimeters; adding 8 outrigger
leg/pad meshes (hidden while driving/idle, shown while `state ===
'working'`); and adding a small rider (`createWorkerNPC()`, reused as-is)
standing on the platform, visible only while working. All of this is
driven from a single new always-runs-first block in `moveWorkVehicle()`
that retracts/hides everything whenever the vehicle isn't in the
`'working'` state, so idle/outbound/returning all correctly fold the lift
away — matching the spec's own described sequence ("arrives, deploys
legs, raises the basket, a worker does finishing work, then folds up,
leaves").

Verified with a headless-browser pass: confirmed `platformIsChildOfArms`
is now `true`; forced the lift into a real `'working'` state next to an
active construction site and sampled arm height / rider visibility /
outrigger visibility every 0.5s — height climbed steadily (0.57 → 0.89 →
1.07 → 1.16 → 1.22 → 1.28, converging on target) with rider and
outriggers visible throughout; then ended the work cycle and confirmed
the arms were already retracting (1.28 → 0.43) and the rider had gone
invisible again within 3.5s of returning. Screenshot shows the scissor
arms genuinely raised with the platform, rail, and rider sitting properly
on top — grounded, no disconnect. Re-ran the full existing regression
suite (boot, construction, contracts, road-node routing, a 25s multi-
vehicle soak) with zero new failures.

**Duplicate sawmill scenery bug fix + tree species variety** (previous
session). Two changes:

1. Found and fixed a real, previously-unaudited bug while reading the
   sawmill code to plan the tree-variety work: `buildSawmillScenery()` was
   called **twice** (two back-to-back statements right before
   `registerAllHarvestableTrees()`), with no guard against re-entry. Since
   the function unconditionally builds and `scene.add()`s a brand-new
   camp/shed/rack/mill/conveyor/blade every call, this silently doubled
   the entire sawmill complex on top of itself: 2 identical shed bodies
   z-fighting at the same position, 12 grove trees instead of 6 (all
   pushed into `sourceTrees`, so the sawmill's "gently gated by tree
   availability" production pacing was subtly wrong), a duplicated
   spinning saw blade (only one of the two ends up referenced by the
   `sawmillBlade` variable that the animation loop spins — the other sits
   there identical but frozen), and duplicated conveyor belt slats reading
   stale vs. fresh `conveyorData` geometry. Fixed by removing the
   duplicate call (one-line diff, but the runtime effect is large — see
   verification below). This is exactly the class of bug the plan's "no
   flying/duplicate objects" rule exists to catch, and it predates every
   session logged in this file (present from the original v19 import).
2. **Tree species variety** (spec section 7 — "the forest shouldn't look
   like 50 identical cones"). `makeTree()` used to always build the same
   stacked-cone conifer shape (only leaf color and uniform group scale
   varied). Replaced with `makeConiferTree(size)` (the original shape,
   kept) and a new `makeDeciduousTree(size)` (short thick trunk, two
   leaning fork limbs, a round leafy canopy built from overlapping
   spheres — genuinely different silhouette, not just a recolor), plus a
   `TREE_SIZES` table (`young`/`normal`/`large`) that scales trunk and
   canopy **independently** rather than uniformly scaling the whole
   group, so a young tree actually reads as spindly rather than just a
   shrunk adult. `makeTree(opts)` now picks species (~62% conifer / 38%
   deciduous) and size randomly unless told otherwise, and both species
   still return a plain group with `userData.harvestableTree = true` (now
   also `userData.treeSpecies`), so the chop/carry/regrow system — which
   only ever calls `group.scale.setScalar(...)` on whatever it's given —
   needed zero changes.

Verified with a headless-browser pass: before the fix, a scene traversal
counted 2 shed-body meshes at identical dimensions and 12 grove
`sourceTrees` within 3.2 units of `GENERATOR_POS`; after the fix, exactly
1 and 6, confirming the duplication is gone (and only the intended amount
of geometry remains — checked this wasn't secretly needed for anything
else, since nothing in the game reads a "second sawmill" concept). For
tree variety: counted species tags across the full scene (61 total trees
in one run, ~2:1 conifer:deciduous, matching the roll probability) and
confirmed every tree's group-level Y position is exactly 0 (grounded, per
the "no flying objects" rule); screenshots from ground level show clearly
distinct silhouettes side by side (sharp conical pines vs. round bushy
canopies). Confirmed the chop → shrink → regrow cycle still works
correctly end to end on the new tree shapes: teleported the player onto a
real grove `sourceTrees[0]` entry, called the actual `tryHarvestTree()`
function the E/Space handler uses (not a faked state change), and traced
`state`/`scale`/`position.y` across the chop and regrow phases — scale
animated smoothly (1.07 → 0.91 mid-chop → 0.34 mid-regrow) with `y`
staying exactly 0 throughout. Re-ran the full existing regression suite
(boot, construction pipeline, contracts, road-node routing) with zero new
failures.

**Road-node vehicle navigation** (spec item 16, previously a confirmed
open gap). Service vehicles (the delivery truck and the lift/telehandler)
used to route as a straight 3-point path — home, then literally the map
center `(0,0,0)`, then the target — cutting across open lawn regardless of
where the actual road ran. The visible road itself is already built from a
simple chain (`pathPoints`: plaza center, then each of the 10
`stagePosition(i)` points in order, per the existing road-segment-building
loop), so routing didn't need a real graph/pathfinder: added `ROAD_NODES`
(that same chain), `nearestRoadNodeIndex()`, and `buildRoadRoute(from, to)`
which finds the nearest road node to each end and slices the chain between
them (ascending or descending as needed), replacing `makeVehiclePath()` at
all 3 call sites (both `assignVehicleJob()` branches and the hardcoded
return-to-base path in `moveWorkVehicle()`). No changes needed to the
actual per-frame movement/rotation code — `moveWorkVehicle()` already
walked an arbitrary-length `path` array one waypoint at a time, so this
was a drop-in upgrade to *how* the path is built, not how it's followed.

Verified with a headless-browser pass: confirmed `ROAD_NODES` has the
expected 11 entries (center + 10 stages) at the right world positions;
force-assigned the delivery truck a job after building a house and
confirmed its route is no longer a fixed 3 points but walks multiple real
road nodes toward the target (6 waypoints in the test case, following the
spiral instead of cutting through open ground); watched the truck drive
for several seconds with position/rotation telemetry each frame (`y`
stayed exactly `0` throughout — grounded, no floating) and screenshots
along the way; ran a 25-second soak with both vehicles actively cycling
through outbound/working/returning/idle and re-assignment with zero
console errors and both still in valid, grounded states at the end. Also
re-ran the full existing regression pass (boot, construction pipeline,
contracts) to confirm nothing else broke — all green.

One known limitation carried forward, not a regression: since vehicle home
bases (the sawmill/generator area) sit off the spiral entirely, "nearest
road node" can occasionally be a node that isn't on the visually shortest
side of the chain, producing a slightly indirect first/last leg. Good
enough for this slice (real improvement over "always through dead
center"); a future refinement could give off-road bases their own fixed
driveway node instead of pure nearest-neighbor snapping.

**Contracts system** (spec item 19, previous session). Up to 2 simultaneous short-term
objectives, randomly drawn from 4 templates (build N buildings, produce N
planks, chop N logs, earn N money), each with a scaled cash reward. Tracked
via new `stats.buildingsCompleted` / `stats.logsChopped` counters (plus the
existing `stats.planksEarned` / `stats.totalEarned`) and a `startValue`
snapshot per contract so progress is a simple delta — no separate polling
system needed, it piggybacks on the existing 1s `setInterval` tick
alongside `checkAchievements()`. A completed contract pays out immediately,
toasts, and is replaced by a fresh one next tick. Persisted in `save()` /
restored in `load()` (contracts survive a reload instead of resetting).
Compact card UI (`#contractsCard`, top-right, below the icon buttons),
following the existing "no giant plaques" visual language, using the
already-existing `fmt()` number formatting. Fully bilingual (ru/en) via
inline `lang === 'ru' ? ... : ...`, matching this file's existing pattern
(not the separate `STRINGS`/`t()` table, which is reserved for static UI
strings here — dynamic contract text follows the same inline convention
`nextCard` already uses).

Verified with a headless-browser pass: contracts generate and render on
first load, progress advances and a contract completes + pays out + gets
replaced (forced via the real `earn()` path, not by faking state), survives
a reload with the same contract IDs, and re-renders correctly in both
languages. Also caught and fixed a real bug during mobile testing: the new
card's initial top offset assumed the icon-button row was one line, but at
narrow widths (`topRightBtns` wraps to 2 rows there) it collided — fixed by
pushing the card down far enough to clear both wrapped rows at both mobile
breakpoints.

## Condensed target checklist (from the user's full spec)

Legend: `[x]` done and verified, `[~]` partially there, `[ ]` not started.

- [~] **Production chain**: money, logs, planks done. Concrete/metal (spec
      section 3) not started — don't add until the log→plank chain's own
      sinks (below) are in good shape; the spec explicitly says add
      resources gradually, 5 max (money, logs, planks, concrete, metal).
- [x] **Construction stages** (section 4) — see audit above.
- [~] **Delivery visualization** (section 5) — trucks already exist and
      accelerate construction; specific "resource → target building" label
      text is the remaining polish.
- [x] **Construction equipment 3D models** (section 6) — excavator, tower
      crane, mixer, and (this session) the lift/telehandler all modelled
      with correct parts and animated at the right phases. Lift now has
      outriggers, a platform that actually rides its scissor arms, and a
      rider, all correctly shown/hidden by work state (see session log).
- [x] **Tree variety** (section 7) — done this session: conifer +
      deciduous species with independently-scaled trunk/canopy size tiers.
- [ ] **Log-carry stacking visual** (section 8) — carried logs currently
      shown via `refreshCarriedLogVisuals()`; whether it does the
      1/2/3/4-6 stacking pattern the spec wants hasn't been checked yet.
- [x] **Sawmill drop-off circle** (section 9) — `createSawmillDropoff()`
      exists with a labeled pad ("Bring logs here" / "Сдать N брёвен"
      pattern); considered adequate from earlier grep, not re-verified
      visually this session.
- [~] **Upgrade circles** (sections 10-11) — `fieldUpgradePads` (global,
      category-style: Build Speed / Carry Capacity / Wood Yield / Sawmill)
      already exist with auto-fit labels; whether they're visually
      differentiated by icon/color per category not yet audited.
- [ ] **Texture pass** (sections 12-13) — 10 embedded textures exist
      (brick/concrete/metal/roof/siding/asphalt/dirt/grass/wood + splash)
      but haven't been checked against the "correct scale per building
      size" requirement (repeat values per archetype).
- [ ] **World density / roads** (sections 14-15) — decor props
      (benches, streetlights, signs) already visible in playtest
      screenshots; full checklist (curbs, sidewalks, crosswalks, parking,
      hydrants, cones, etc.) not audited.
- [x] **Road-node vehicle navigation** (section 16) — done this session
      (`ROAD_NODES` / `buildRoadRoute()`). See known limitation noted above
      (off-road bases don't get a dedicated driveway node yet).
- [x] **NPC worker roles** (section 17) — done this session: 4 visually
      distinct roles (helmet color + hand tool) plus stay-near-home-base
      idle behavior instead of roaming the whole map.
- [~] **Progression stages** (section 18) — the 10-stage `STAGES` array
      covers this loosely; no explicit "you are now in Stage 3:
      Commercial Construction" milestone UI yet.
- [x] **Contracts** (section 19) — done this session.
- [ ] **Economy pacing re-check** (section 20) — not re-validated against
      the fuller feature set (contracts should help; worth simulating).
- [x] **Prestige** (section 21) — exists (`doPrestige`), messaging clear.
- [~] **UI cleanliness** (section 22) — the two specific bugs the previous
      session flagged were re-audited and downgraded (see note above, not
      real issues); general responsive polish beyond that pair not
      exhaustively re-checked.
- [x] **3D label auto-fit** (section 23) — already implemented generically.
- [ ] **Camera tuning** (section 24) — default follow-cam distance/angle
      not specifically re-tuned against the spec's "mobile tycoon" feel.
- [~] **Lighting** (section 25) — sun/hemisphere/fog present in screenshots;
      not specifically audited against bloom/tone-mapping asks.
- [~] **Effects** (section 26) — particle bursts, smoke, sawmill dust seen;
      full checklist (welding sparks, chop chips) not audited.
- [~] **Sound** (section 27) — synthesized SFX system exists
      (`ensureAudio`/`sfx`); volume categories (SFX/Music/Ambient) and full
      sound list not audited.
- [ ] **Performance pass** (section 28) — not profiled this session.
- [ ] **File split into /src** (section 29) — intentionally not started;
      spec itself says do this only once the design has settled.
- [x] **Save format / versioning** (section 30) — `saveVersion: 4` with
      migration-tolerant `load()` already exists; contracts folded in
      cleanly this session.

## Release line (user's own v19→v25 framing)

- **v19 — Construction System**: mostly already true of the file as
  received (see audit). This session's contracts feature and the mobile
  fix are the first v19→v20-ish increment.
- **v20 — Production Chain**: warehouse-as-storage, concrete, metal, real
  logistics. Not started.
- **v21 — City Life**: road-node navigation now done; worker roles and
  city decor remain.
- **v22 — Economy & Contracts**: contracts now done; milestone UI and a
  fresh balance pass remain.
- **v23 — Visual Polish**: models/textures/lighting/effects/animation/camera.
- **v24 — Mobile & Performance**: the two previously-flagged mobile HUD
  items turned out not to need fixing (see audit above); a real
  performance profiling pass is still outstanding.
- **v25 — Release Candidate**: full bug/softlock/save/UI/perf sweep.

## Suggested next slice (pick one, don't do everything at once)

In priority order, given what's already solid vs. genuinely missing:
1. **Worth a dedicated pass now, not just incidental findings**: three
   sessions in a row have found a real bug purely by reading code while
   planning something else (`buildSawmillScenery()` called twice; the
   lift's platform never attached to its lifting mechanism; the old
   ambient-worker wander target ignored home base entirely). A focused
   audit session — read through the remaining vehicle/building/economy
   code specifically asking "does this visibly do what it claims to do,"
   not implementing anything new — would likely keep paying off.
2. Delivery-vehicle status labels: name the specific resource + target
   building (spec wants e.g. "Доски → Дом") instead of the current generic
   "MATERIALS" — small polish on top of the road-routing work.
3. Second raw resource (concrete) + a warehouse-as-storage mechanic
   (section 3) — only once the log→plank chain's existing sinks (planks
   already used for building cost, upgrades, and now nothing else
   pending) feel complete; check economy pacing (section 20) first.
4. Progression-stage milestone UI (section 18) — the 10-stage `STAGES`
   array covers this loosely; no explicit "you are now in Stage 3:
   Commercial Construction" moment yet, which the spec calls out as
   important for the player always knowing the next big milestone.

## Process reminder for future sessions

1. Read this file first.
2. Pick the next unstarted/partial item above (or the user's latest
   explicit request, if any, takes priority over this list).
3. Implement a real, meaningful slice.
4. Playtest headless (see the "non-negotiable rules" testing checklist).
5. Update this file's checklist + append to `CHANGELOG_V19.md`.
6. Commit and push to `claude/3d-building-tycoon-game-pigx1h`.
