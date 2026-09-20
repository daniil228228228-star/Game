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

**Progression-stage milestone banner** (this session, spec section 18,
top of the "suggested next slice" list). The 10-stage `STAGES` array
already tracked raw progress (`🏗️ N/10` in the HUD), but there was no
explicit "you've entered a new era" moment the spec calls out as
important for always knowing the next big milestone. Added
`MILESTONE_ERAS`, a 5-entry table grouping `STAGES` into named eras two
buildings at a time (Residential Quarter → Commercial District →
Industrial Zone → Corporate District → Metropolis, each with an
emoji/title/subtitle in both languages), and `eraIndexForCount(n)`, a
pure function of `stageIndex` (`Math.floor((n-1)/2)`, clamped) so no
separate "have I announced this" flag is needed — prestige resetting
`stageIndex` to 0 naturally re-announces the same eras on the way back
up. `purchaseCurrentPad()` compares the era before/after each purchase
and calls `showMilestone()` only on an actual transition (5 of the 10
purchases, not all 10) -- a centered, auto-dismissing banner
(`#milestoneBanner`, 3.4s) separate from the existing toast system so it
doesn't fight with the "Construction started" toast that fires in the
same call.

Verified with a headless-browser pass: confirmed `eraIndexForCount()`'s
output for every count 0-10 matches the intended 5 two-building eras;
bought all 10 buildings in sequence and confirmed the banner's title/
subtitle text only changes at the 5 correct transition points (indices
0, 2, 4, 6, 8) and stays put on the other 5 purchases; screenshotted the
banner on a 390px mobile viewport after the very first building and
confirmed it's fully on-screen and legible, not clipped or colliding
with the HUD. Zero new console errors; re-ran the boot, pinch-zoom, and
the three-fixes regression tests with no failures.

**Three direct user-reported fixes this session** (real gameplay feedback,
not a plan-list item): (1) **joystick-driven camera auto-follow** --
`updatePlayer()`'s camera-follow tail used to translate the camera by the
player's per-frame delta only, so the camera's *viewing angle* never
changed while walking (uncomfortable per the user: "неудобно ходить").
Now, while the joystick is actively pushed (`joyMag > 0.08`) and the
player is moving, the camera's XZ offset from the player is reinterpreted
as a spherical azimuth around a fixed radius, and that azimuth is
interpolated (shortest-path, `atan2(sin(da), cos(da))`, rate `dt * 2.6`)
toward "directly behind the player's facing direction"
(`player.rotation.y + Math.PI`) every frame, before `controls.update()`
runs. Falls back to the old plain-translation behavior when the joystick
is idle/centered, so free-look via drag/OrbitControls when standing still
is untouched. (2) **Construction "growing" look fixed** -- the building
mesh used to fade/scale in gradually across phases 3-5 (frame through
finish), which read as the finished house slowly inflating out of the
ground the moment the frame went up, well before its real textures
appeared -- the user specifically flagged this as looking unnatural. Now
`growingMeshes` stays fully invisible through phase 4 (frame/walls/roof,
crane+scaffolding+fence visuals carry all the "under construction" read
instead) and only reveals in phase 5 (finish, last 12% of build time)
with a quick ease-out-cubic pop (`scale` 0.92->1.0 on Y, 0.97->1.0 on
XZ) -- textures and geometry appear together in one beat instead of a
long slow grow. (3) **Label overflow on mobile fixed** -- root-caused (in
a prior session) to label *sprite* world-space scale being too large
relative to the visible viewport width at typical close-up camera
distances on narrow portrait screens, not a font-fitting bug. Reduced
every label sprite's `.scale.set()` by ~0.68x across all ~9 creation/
regeneration call sites (sawmill dropoff, field-upgrade pads x2,
construction-site phase label, building upgrade pad, lift/delivery
vehicle status labels, `makeLabelSprite`'s internal default, the main
gold build-pad label) while preserving each one's aspect ratio, and fixed
one stale hardcoded `regenerateSprite(..., 1.15)` scaleY override in
`applyLanguage()` that had drifted out of sync with its creation-time
value (now `0.82`, matching the upgrade-pad's new scale).

Verified with a headless-browser pass: simulated 90 frames of joystick-
held movement with the player turning and confirmed the camera's azimuth
converges from a 2.7 rad offset down to 0.005 rad behind the player;
sampled `growingMeshes` visibility/scale across the full 0-1 construction
timeline and confirmed the mesh stays hidden through t=0.85 (end of
phase 4) and only appears at t=0.9+ with the new narrow scale range;
confirmed the new label scales are applied and took a close-up screenshot
of a field-upgrade label at the same tight camera distance that
previously showed real clipping -- text now fits cleanly inside the
viewport. Re-ran the pinch-zoom-fix and boot regression tests with zero
new console errors.

**Delivery-vehicle status labels now name the target building** (this
session, spec item from the "suggested next slice" list). Previously
both the delivery truck and the lift showed a generic secondary line
("доставка на объект" / "delivery", "работает на стройке" / "working")
regardless of which building they were actually headed to or working on
-- despite `assignVehicleJob()` already picking a specific real target.
Added `jobTargetName(ud)`, reading a new `ud.assignedEntry` that
`assignVehicleJob()` now sets in every branch -- both for a real
construction/upgrade target *and* the delivery role's "nothing under
construction, restock the nearest built warehouse/factory" fallback,
which previously used a bare-position helper (`nearestBuiltByArchetype()`,
now removed, its one caller inlined) with no way to name what it found.
Status text now reads e.g. "МАТЕРИАЛЫ / → Дом" while driving out, and
"разгрузка: Дом" / "работает: Дом" once arrived, through all three
phases of a job (assign -> arrive/work -> the label stays correct since
`assignedEntry` isn't cleared until the next assignment). Note: the game
doesn't yet track *which* resource is being delivered (concrete doesn't
exist yet, spec item under section 3) so "МАТЕРИАЛЫ"/"MATERIALS" stays as
the resource side of the label for now -- the target-naming half is what
this slice actually had real data for.

Verified with a headless-browser pass: confirmed a real construction
target is named correctly right after `assignVehicleJob()`; confirmed
the delivery restock fallback (no active construction, a built warehouse
exists) also correctly names that warehouse via `assignedEntry`, not just
a bare position; confirmed the "nothing to do" idle/waiting paths (no
active construction and no warehouse/factory built yet) are untouched
and don't crash on a null `assignedEntry`. Re-ran the full existing
regression suite (boot, construction, contracts, road-node routing, the
lift, worker roles, the pinch-zoom fix) with zero new failures.

**Note on this session's Bloom attempt**: the user asked for the Bloom
image-generation connector to be used for the still-open texture pass
(spec sections 12-13). Generated 4 candidate seamless textures (brick,
concrete, corrugated metal, asphalt) via `bloom_generate_image` against
the account's existing "Элитруф" brand — all 4 completed successfully.
However, this sandbox's outbound network policy blocks `trybloom.ai`
(confirmed via a direct `curl` 403 and the agent-proxy's own status log),
and no other available tool path (`Read`, `WebFetch`, which only
extracts text) can retrieve the actual image bytes from that host into
this environment. The generated images exist in the Bloom workspace but
could not be downloaded, converted, or embedded into the game from here.
**This is an environment limitation, not a prompt-quality problem** --
don't re-attempt Bloom texture generation from this same sandboxed dev
environment without first confirming a way to pull the resulting file
bytes in (e.g. the user downloading the 4 already-generated images from
their Bloom account and attaching them directly, which this session
*can* read as local files). Pivoted this session's remaining time to the
delivery-label slice above instead.

**Critical fix: pinch-zoom crashed the whole game on real phones**
(previous session, user-reported). The user published this file as a Claude
Artifact and immediately hit a hard crash on their iPhone: `TypeError:
undefined is not an object (evaluating 'event.touches[1].pageX')`, which
blanked the entire screen behind the boot-error overlay (that overlay's
global `window.addEventListener('error', ...)` handler treats *any*
uncaught runtime error, not just boot-time ones, as fatal). Traced the
reported line number to the vendored `vendor_v19/three_r128/OrbitControls.js`
(the game's own `tycoon-v19.html` has no `touches[1]` reference at all):
`handleTouchStartDolly()`/`handleTouchMoveDolly()` read
`event.touches[0]`/`event.touches[1]` completely unguarded, while the
sibling rotate/pan handlers in the same file already correctly check
`event.touches.length` first. The controls' touch state machine
(`onTouchMove`) dispatches purely on a `state` value set once at
`touchstart` and only reset on `touchend` -- so lifting the *second*
finger mid-pinch (routine on a real phone, essentially never produced by
a synthetic mouse-driven test) can fire one more `touchmove` with only 1
touch left while state is still `TOUCH_DOLLY_PAN`, hitting the unguarded
`touches[1]`.
Fixed by adding the same `if (event.touches.length < 2) return;` guard
already used elsewhere in the file to both dolly handlers -- a one-line
change per function, matching the file's own established defensive
pattern.

Verified with a headless-browser pass (Playwright launched with
`hasTouch: true` so real `Touch`/`TouchEvent` constructors work):
first confirmed the repro was faithful by running it against the
*unfixed* file (`git stash`) and getting the exact same error plus the
boot-error overlay appearing; restored the fix and re-ran the identical
two-finger-touchstart -> two-finger-touchmove -> one-finger-touchmove
sequence and got zero errors with the game still fully responsive
afterward; separately verified a genuine two-finger pinch (both fingers
staying down the whole gesture) still actually zooms the camera
(distance changed 9.55 -> 3.5), so the fix doesn't silently disable
pinch-zoom, only the crash on an asymmetric finger-lift. Re-ran the full
existing regression suite with zero new failures. Republished the
Claude Artifact (same URL) with the patched vendor file so the user's
already-shared link is immediately fixed, and pushed the same fix to the
repo.

**Dedicated audit pass: fixed an orphaned-construction-site bug in
`doPrestige()`** (previous session, following through on last session's own
suggestion to do a focused "does this visibly do what it claims" pass
rather than build something new). Read through `doPrestige()`,
`purchaseCurrentPad()`, and `upgradeBuilding()` together and found a real,
reachable bug: `stageIndex` reaches `STAGES.length` (which is what
unlocks the prestige button) the instant the **last** building's
construction *starts*, not when it finishes -- and any building can have
an upgrade in progress at prestige time too. `doPrestige()` only ever
cleared the `buildings` array; it never touched `growingMeshes` or
`constructionSites`, which are separate arrays holding the in-progress
construction animation state and the crane/scaffolding/fence site group
for anything still building. A player who prestiges while any
construction/upgrade is mid-flight would leave that site's crane and
scaffolding running in the scene forever (or until its own timer
happened to expire) with no building behind it anymore -- a textbook
orphaned object, same bug family as the lift's disconnected platform and
the duplicate sawmill, just in a different system.
Fixed by clearing `growingMeshes` and `constructionSites` (removing their
scene objects) inside `doPrestige()`, and clearing any NPC worker's
`workBuild`/`target` if it pointed at one of the now-gone sites (so they
re-roll a sensible target next frame instead of playing their "hammering"
animation forever next to an empty foundation).

Verified with a headless-browser pass: bought all 10 stages back-to-back
with cheated money/planks (so all 10 were simultaneously mid-construction
-- the worst case for this bug) and called the real `doPrestige()`
(auto-accepting its `confirm()` dialog); captured direct references to
every construction-site group and under-construction mesh *before*
prestige and confirmed all of them were detached from the scene
(`.parent === null`) afterward, `growingMeshes`/`constructionSites` were
both empty, and no worker was still targeting a stale build. Also
verified the ordinary path (let every construction actually finish, then
prestige) still works correctly: money/stageIndex/buildings reset, prestige
count and income multiplier increment, a fresh stage-0 pad spawns. Re-ran
the full existing regression suite (boot, construction, contracts,
road-node routing, the lift, worker roles) with zero new failures.

Incidental finding, not fixed this session (out of scope for the slice,
noted for later): while testing the 10-simultaneous-construction-sites
edge case, the in-game construction timer visibly fell behind real wall-
clock time under that load (roughly 3x slower) -- `animate()`'s `dt` is
clamped to a 0.1s ceiling per frame, so when the software-rendered scene
gets heavy enough that real frame time exceeds that, the simulation
itself slows down rather than the game just skipping visual frames. This
specific scenario (buying all 10 buildings simultaneously) is not
reachable in ordinary economically-realistic play given the steep cost
curve (the last building alone costs 200,000), so it's a synthetic
stress-test finding rather than a live bug -- but it's a real data point
for spec section 28 (performance pass), still `[ ]` not started.

**NPC worker roles + stay-near-base idle behavior** (previous session, spec
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
- [x] **Delivery visualization** (section 5) — trucks accelerate
      construction and (this session) status labels now name the real
      target building (`jobTargetName()`/`ud.assignedEntry`). The specific
      *resource* half of "resource → building" stays generic ("МАТЕРИАЛЫ")
      since the game only has one delivered-materials concept until a
      second raw resource (section 3) exists to actually differentiate.
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
      size" requirement (repeat values per archetype). A Bloom-based
      attempt this session generated 4 replacement candidates but hit an
      environment limitation (can't download from `trybloom.ai` in this
      sandbox) — see the session log note; still open, needs a different
      path to get file bytes in (e.g. the user attaching the already-
      generated images, or re-attempting from an environment with
      broader network access).
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
- [x] **Progression stages** (section 18) — added a milestone banner
      this session: `STAGES` grouped into 5 named eras (2 buildings each)
      with a centered "you've entered a new era" announcement the first
      time a building from it starts.
- [x] **Contracts** (section 19) — done this session.
- [ ] **Economy pacing re-check** (section 20) — not re-validated against
      the fuller feature set (contracts should help; worth simulating).
- [x] **Prestige** (section 21) — exists (`doPrestige`), messaging clear.
- [~] **UI cleanliness** (section 22) — the two specific bugs the previous
      session flagged were re-audited and downgraded (see note above, not
      real issues); general responsive polish beyond that pair not
      exhaustively re-checked.
- [x] **3D label auto-fit** (section 23) — font-fit logic was already
      correct; the real overflow bug was label *sprite world-scale* being
      too large for close-up mobile viewports, fixed this session (see
      note above) by shrinking every label sprite's scale ~0.68x.
- [~] **Camera tuning** (section 24) — this session added joystick-driven
      camera auto-follow (camera azimuth now turns to stay behind the
      player while actively steering, per direct user feedback); default
      follow distance/angle constants themselves not further re-tuned.
- [~] **Lighting** (section 25) — sun/hemisphere/fog present in screenshots;
      not specifically audited against bloom/tone-mapping asks.
- [~] **Effects** (section 26) — particle bursts, smoke, sawmill dust seen;
      full checklist (welding sparks, chop chips) not audited.
- [~] **Sound** (section 27) — synthesized SFX system exists
      (`ensureAudio`/`sfx`); volume categories (SFX/Music/Ambient) and full
      sound list not audited.
- [ ] **Performance pass** (section 28) — not profiled directly, but a
      synthetic stress test this session (10 simultaneous construction
      sites) showed the game's own simulation timer falling behind real
      time under heavy load (`dt` clamped at 0.1s/frame in `animate()`),
      not just dropped visual frames. Not reachable in normal economically-
      paced play, but worth keeping in mind once a real profiling pass
      happens.
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
- **v22 — Economy & Contracts**: contracts and milestone-era UI now done;
  a fresh balance pass remains.
- **v23 — Visual Polish**: models/textures/lighting/effects/animation/camera.
- **v24 — Mobile & Performance**: the two previously-flagged mobile HUD
  items turned out not to need fixing (see audit above); a real
  performance profiling pass is still outstanding.
- **v25 — Release Candidate**: full bug/softlock/save/UI/perf sweep.

## Suggested next slice (pick one, don't do everything at once)

In priority order, given what's already solid vs. genuinely missing:
1. Second raw resource (concrete) + a warehouse-as-storage mechanic
   (section 3) — only once the log→plank chain's existing sinks (planks
   already used for building cost, upgrades, and now nothing else
   pending) feel complete; check economy pacing (section 20) first.
2. Economy pacing re-check (section 20) — not re-validated against the
   fuller feature set (contracts + milestone eras should both help the
   feel of it; worth simulating a full playthrough's cost/income curve).
3. **Keep doing incidental audits, not just this one dedicated pass**:
   four sessions running have now found a real bug purely by reading code
   closely (`buildSawmillScenery()` called twice; the lift's platform
   never attached to its lifting mechanism; the old ambient-worker wander
   target ignored home base; `doPrestige()` never cleaned up an
   in-progress construction site). Whatever slice gets picked next, read
   the surrounding code for this same "does this visibly do what it
   claims" class of bug before assuming it's fine — it has paid off every
   single time so far.

## Process reminder for future sessions

1. Read this file first.
2. Pick the next unstarted/partial item above (or the user's latest
   explicit request, if any, takes priority over this list).
3. Implement a real, meaningful slice.
4. Playtest headless (see the "non-negotiable rules" testing checklist).
5. Update this file's checklist + append to `CHANGELOG_V19.md`.
6. Commit and push to `claude/3d-building-tycoon-game-pigx1h`.
