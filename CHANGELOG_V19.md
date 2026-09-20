# Changelog — Tycoon 3D v19+ (tycoon-v19.html)

Separate from the root `CHANGELOG.md`, which tracks the earlier
`tycoon.html` prototype. See `TYCOON_V19_PLAN.md` for the roadmap this log
tracks progress against.

## Session log

### 2026-09-20 — Adopt v19, add contracts, fix a mobile HUD collision
- Imported the user-provided `tycoon_v19_construction_system.html` (28.5MB,
  base64-embedded textures) into this repo as `tycoon-v19.html`, using the
  same extraction technique as earlier sessions: 10 images pulled out to
  `assets_v19/*.jpg|png` (~213KB source left), and Three.js r128 + classic
  `OrbitControls` vendored locally under `vendor_v19/three_r128/` instead
  of the original CDN `<script>` tags (matches this repo's no-CDN policy;
  this sandbox blocks `cdnjs.cloudflare.com`/`cdn.jsdelivr.net` for local
  testing). Verified booting cleanly, zero console errors, real textures
  visible.
- Audited the existing construction system against the user's detailed
  spec via headless-browser playtesting (not just reading code): the
  6-phase construction pipeline, tower crane / cement mixer / excavator
  models and their phase-gated animation, and delivery-vehicle
  construction-time-acceleration all already work correctly and are
  visually grounded (no floating parts). Wrote up the full audit in
  `TYCOON_V19_PLAN.md` so future sessions don't re-build working systems.
- **Added a contracts system** (spec item 19, previously entirely absent).
  Up to 2 simultaneous short objectives drawn from 4 templates (build N
  buildings / produce N planks / chop N logs / earn N money), cash reward
  scaled to the amount, tracked via new `stats.buildingsCompleted` and
  `stats.logsChopped` counters (delta from a per-contract `startValue`
  snapshot) alongside the existing `stats.planksEarned`/`totalEarned`.
  Piggybacks on the existing 1s tick (`checkContracts()` alongside
  `checkAchievements()`); a completed contract pays out, toasts, and is
  replaced next tick. Persisted in `save()`/`load()` so a reload doesn't
  reset progress. Compact card UI (`#contractsCard`, top-right under the
  icon buttons), bilingual via the same inline `lang === 'ru' ? ... : ...`
  pattern the rest of the file already uses for dynamic strings.
- Verified with a headless-browser pass: contracts generate on first load;
  forced a contract to completion via the real `earn()` path (not by
  faking state) and confirmed payout + toast + replacement; confirmed
  contract IDs survive a reload; confirmed text re-renders in both
  languages after a language toggle.
- **Found and fixed a real mobile-layout bug** while testing at 390px
  width: `#topRightBtns` (5 icon buttons) wraps to two rows at that width
  (pre-existing behavior, not introduced this session), and the new
  contracts card's initial top offset only cleared one row, so it visually
  collided with the wrapped `RU`/`Reset` buttons. Fixed by pushing the
  card down far enough to clear both wrapped rows at both mobile
  breakpoints (`max-width: 680px` and `max-width: 390px`).
- Also found, but did **not** fix this session (documented in
  `TYCOON_V19_PLAN.md` as a follow-up instead, to keep this session's
  slice focused): the 5-chip top-left HUD stats row itself overflows and
  wraps badly at 390px width, and the field-upgrade world-space label
  ("Build Speed 1/3") can render partially off the left edge of the
  viewport. Both predate this session.

---

## Format for new entries

```
### YYYY-MM-DD — Short summary
- What changed and why, one bullet per notable change.
- Note any TYCOON_V19_PLAN.md checklist items completed.
```
