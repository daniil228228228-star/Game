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
- Vehicle navigation is **not** yet on road nodes — `makeVehiclePath()` is
  still a straight 3-point path (home → map center → target). Section 16's
  ask (real `roadNodes` graph, turning, no cutting through lawns) is a real,
  still-open gap.
- **No contracts system existed** before this session (spec item 19) —
  implemented this session, see below.
- Known pre-existing mobile-layout bugs (not introduced this session, found
  while testing at 390px width): the 5-chip HUD stats row
  (money/income/progress/planks/carriedLogs) overflows and wraps badly on
  narrow phones, and the field-upgrade world-space label ("Build Speed
  1/3") can render partially off the left edge of the viewport. Left as a
  follow-up — see Phase list below. Do **not** confuse this with the
  contracts card, which was positioned defensively to clear the
  known-wrapping icon row (see CSS comment at `#contractsCard`).

## What this session added (v19 → next)

**Contracts system** (spec item 19). Up to 2 simultaneous short-term
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
- [~] **Construction equipment 3D models** (section 6) — excavator, tower
      crane and mixer already modelled with correct parts and animated at
      the right phases (verified). Lift/telehandler (`подъёмник`) exists as
      a vehicle role (`role: 'lift'`) with `liftArms` but wasn't visually
      audited this session — verify its model next (base, outriggers,
      telescoping arm, basket, worker inside, per spec).
- [ ] **Tree variety** (section 7) — `makeTree()` needs to produce a few
      distinct species (height/girth/color/canopy shape), not one cone
      repeated. Not yet audited/implemented.
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
- [ ] **Road-node vehicle navigation** (section 16) — confirmed still a
      straight 3-point path, not a road graph. Real gap, meaningful next
      slice.
- [~] **NPC worker roles** (section 17) — worker NPCs with `chooseWorkerTarget`
      exist; whether they have distinct visual roles (builder/rigger/
      foreman/loader per spec) not audited.
- [~] **Progression stages** (section 18) — the 10-stage `STAGES` array
      covers this loosely; no explicit "you are now in Stage 3:
      Commercial Construction" milestone UI yet.
- [x] **Contracts** (section 19) — done this session.
- [ ] **Economy pacing re-check** (section 20) — not re-validated against
      the fuller feature set (contracts should help; worth simulating).
- [x] **Prestige** (section 21) — exists (`doPrestige`), messaging clear.
- [~] **UI cleanliness** (section 22) — mostly good, but see the two known
      mobile bugs above (HUD stat row wrap, upgrade-pad label off-edge).
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
- **v21 — City Life**: road-node navigation, worker roles, city decor.
  Not started (road nodes is the clearest concrete next step here).
- **v22 — Economy & Contracts**: contracts now done; milestone UI and a
  fresh balance pass remain.
- **v23 — Visual Polish**: models/textures/lighting/effects/animation/camera.
- **v24 — Mobile & Performance**: the two known mobile HUD bugs belong here
  at the latest, ideally sooner since they're already found.
- **v25 — Release Candidate**: full bug/softlock/save/UI/perf sweep.

## Suggested next slice (pick one, don't do everything at once)

In priority order, given what's already solid vs. genuinely missing:
1. Fix the two known mobile HUD bugs (stat-row wrap, upgrade-label
   off-edge) — quick, concrete, user explicitly cares about mobile.
2. Road-node vehicle navigation (section 16) — clearly still a stub,
   meaningfully visible improvement (trucks stop cutting across lawns).
3. Tree species variety (section 7) — self-contained, visually obvious win.
4. Audit + finish the lift/telehandler model and NPC role visuals
   (sections 6, 17) against the spec, since these were flagged `[~]` not
   `[x]` this session for lack of time, not because they're known-broken.

## Process reminder for future sessions

1. Read this file first.
2. Pick the next unstarted/partial item above (or the user's latest
   explicit request, if any, takes priority over this list).
3. Implement a real, meaningful slice.
4. Playtest headless (see the "non-negotiable rules" testing checklist).
5. Update this file's checklist + append to `CHANGELOG_V19.md`.
6. Commit and push to `claude/3d-building-tycoon-game-pigx1h`.
