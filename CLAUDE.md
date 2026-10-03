# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A mobile-first 3D tycoon / city-builder game (Three.js r128) shipped as **one HTML file**: `tycoon-v116.html` (~34k lines). No build step for development; open it through any static server. Three.js and OrbitControls are vendored in `vendor_v31/`, textures live in `assets_v31/` (referenced via `EMBEDDED_ASSETS`). No CDN dependencies — keep it that way.

Docs are mostly in Russian and are the real project memory: read `VISION.md` (standing design brief), then the top sections of `CHANGELOG_V116.md` (one dated "заход" per change, with file:line evidence) and `ROADS_V116_NOTES.md` (road network history) before changing anything non-trivial. `archive/` holds abandoned prototypes and the v19→v63 lineage; it is not part of the live game (`assets_v31/` and `vendor_v31/` are still needed by v116 — do not move them).

## Commands

```bash
npm install            # only needed for tests (playwright); node_modules/ is gitignored
npm test               # runs every tests/*.test.mjs sequentially via tests/run-all.mjs
node tests/roads.test.mjs   # run a single test file (each is a standalone script; exit 0 = pass)
python3 -m http.server 8000 # manual play: open http://localhost:8000/tycoon-v116.html
```

Tests are Playwright + Chromium with iPhone 13 emulation and software WebGL (the harness passes `--use-gl=swiftshader`; the game runs at only ~3 fps there, so wall-clock waits are slow and tests that drive timers use synthetic `dt` instead). Chromium is expected at `/opt/pw-browsers/chromium`. There is no linter. Always sanity-check script syntax after editing the HTML:

```bash
node -e "const s=require('fs').readFileSync('tycoon-v116.html','utf8');let n=0,b=0;for(const m of s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)){n++;try{new Function(m[1])}catch(e){b++;console.log(n,e.message)}}console.log(n,'blocks',b,'bad')"   # expect 63 blocks, 0 bad
```

A standalone playable build (vendor JS + textures inlined as base64, ~30 MB) is produced by an out-of-repo script; it is not committed.

## Architecture: a stack of patch layers

The file is 63 inline `<script>` blocks, many named `<script id="vNN-...">`, where later layers re-assign functions/variables defined by earlier ones. Rules that every change must respect:

- **Only the last assignment, in execution order, is live.** Grep *all* definitions of a name before editing; edit the one that actually wins. Layers from v56 onward are IIFEs, so their functions are invisible to other layers unless exported on `window`.
- **Execution order is not source order.** Deferred code (`DOMContentLoaded`, `setTimeout(...,80)`, `setInterval`) runs after every synchronous block and can clobber a wrapper installed synchronously by a later-in-file layer (this hid the `constructionDuration` lengthening until commit `978bde8`; the early boot timers calling `refreshTransportAccessRoads` raced the same way). When a "fixed" value doesn't stick, check what runs later.
- **Temporal-dead-zone traps:** a top-level call that references a `let`/`const` declared thousands of lines later in the same block throws and silently aborts the rest of that block (broke boot once; see the thirteenth-pass changelog). Put such calls after `load();` near the end of the file.
- **Fix at the owning function; never add a new patch `<script>` layer** (the block count must stay 63 or go down). Past "final/canonical rebuild" layers for roads are exactly why this file doesn't converge.
- **Don't trust the file's self-audit objects** (`window.__TYCOON_V11x_..._AUDIT__`, etc.): they check their own bookkeeping. Assert on real scene/DOM state (`scene.traverse`, Box3/OBB overlaps, computed style).

Major subsystems (all defined across several layers): stage-based house progression (`STAGES`, `purchaseCurrentPad()`, `spawnBuilding()`), road network (master grid + stage roads + service/industrial roads, rendered by `addCorner`/`addIntersection59`/union contours; `serviceAccessGraph()` is the industrial-zone node tree), logistics (`createBuildDeliveryPlan()` gates construction progress on a delivery ticket; trucks via `syncDeliveryFleet()`, yielding in `serviceVehicleYieldFactor()`), the market plaza (`MARKET_STALLS_V116`), in-world guidance (`nextActionableTargetV117()`), and feedback (`sfx`, `spawnBurst`, `triggerShake`).

## Design rules that constrain implementations

- Progression UI is **circular ground pads** triggered through `nearestManualTargetV53()` → `#actionPrompt` / `#actionBtn`. Floating quest/toast/objective panels are intentionally hidden (`#nextCard`, `#requiredActionV38`, `#eventBanner`); the only sanctioned panel exceptions are the market's resource-exchange menu and the top resource bar. Reuse the pad mechanism for new interactions.
- A **brand-new save** (no `tycoon3d_save_v3` in localStorage) starts as an empty world; **any existing save** must default every staged-unlock flag to "already built" (`industrialZoneBuiltV116`, `sawmillBuiltV118`/`fleetDepotBuiltV118`/`concretePlantBuiltV118`/`metalYardBuiltV118`, `marketStallsBuiltV118`, `manualRoadModeV116`) so returning players see no change. Save-format changes need a migration.
- Roads: one connected network that is not re-laid on upgrades (guard rebuilds with signatures), every building has its own connected driveway, delivery routes are paved end to end, turns are smooth arcs, no road/curb through parking, conveyors or buildings, junction arm count matches real destinations.
- Feedback must be rare and meaningful (HUD stat pulses once fired near-continuously and read as flicker). Keep mobile performance in mind (modest particle counts, pooled objects).

## Testing notes

`tests/lib/harness.mjs` is the shared setup (static server on the repo root, iPhone 13 context, save injection, console-error collection). Known traps documented there: setting `stageIndex` alone does not spawn buildings (call `spawnBuilding()`, or `purchaseCurrentPad()` to exercise the real path); a fresh game is an *absent* localStorage key, not `{}`; the standard old-save fixture is exported as `OLD_SAVE`. A rare benign `navigator.vibrate` console warning appears in headless runs and is filtered. Run tests one process at a time — concurrent headless browsers cause flaky timing failures.

## Workflow conventions

Develop on branch `claude/3d-building-tycoon-game-pigx1h` and push there directly (no PRs). After each change add a dated section to `CHANGELOG_V116.md` (Russian, with file:line root cause and before/after evidence) and update `VISION.md` if the described behavior changes.
