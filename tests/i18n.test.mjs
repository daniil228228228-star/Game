// i18n data-integrity regression test (VISION.md Phase 1, item 3).
//
// The game is a data-driven ru/en strings table (STRINGS) plus a nameEn/descEn field on every
// STAGES and ACHIEVEMENTS entry. This doesn't render the page or exercise the language toggle
// (that's verified manually with a headless-browser check each session) — it guards the thing
// most likely to silently rot over time: a future session adding a new STAGES/ACHIEVEMENTS
// entry or a new STRINGS key in only one language.
//
// Run with: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStages, loadAchievements, loadStrings } from './lib/stages.mjs';

test('STRINGS has ru and en with exactly the same set of keys', () => {
  const strings = loadStrings();
  assert.ok(strings.ru, 'STRINGS.ru is missing');
  assert.ok(strings.en, 'STRINGS.en is missing');
  const ruKeys = Object.keys(strings.ru).sort();
  const enKeys = Object.keys(strings.en).sort();
  assert.deepEqual(enKeys, ruKeys, 'STRINGS.en and STRINGS.ru must define the same keys');
});

test('no STRINGS value is empty in either language', () => {
  const strings = loadStrings();
  for (const langCode of ['ru', 'en']) {
    for (const [key, value] of Object.entries(strings[langCode])) {
      if (Array.isArray(value)) {
        assert.ok(value.length > 0, `STRINGS.${langCode}.${key} is an empty array`);
        value.forEach((v, i) => assert.ok(v && v.trim(), `STRINGS.${langCode}.${key}[${i}] is empty`));
      } else {
        assert.ok(value && value.trim(), `STRINGS.${langCode}.${key} is empty`);
      }
    }
  }
});

test('hint_bullets has the same number of lines in both languages', () => {
  const strings = loadStrings();
  assert.equal(strings.en.hint_bullets.length, strings.ru.hint_bullets.length);
});

test('every STAGES entry has a non-empty name and nameEn', () => {
  const stages = loadStages();
  for (const stage of stages) {
    assert.ok(stage.name && stage.name.trim(), `a stage is missing "name"`);
    assert.ok(stage.nameEn && stage.nameEn.trim(), `stage "${stage.name}" is missing "nameEn"`);
  }
});

test('every ACHIEVEMENTS entry has non-empty name/nameEn/desc/descEn', () => {
  const achievements = loadAchievements();
  for (const a of achievements) {
    assert.ok(a.name && a.name.trim(), `achievement "${a.id}" is missing "name"`);
    assert.ok(a.nameEn && a.nameEn.trim(), `achievement "${a.id}" is missing "nameEn"`);
    assert.ok(a.desc && a.desc.trim(), `achievement "${a.id}" is missing "desc"`);
    assert.ok(a.descEn && a.descEn.trim(), `achievement "${a.id}" is missing "descEn"`);
  }
});

test('every {token} placeholder used by the game appears in both language templates', () => {
  const strings = loadStrings();
  const tokenPattern = /\{(\w+)\}/g;
  for (const key of Object.keys(strings.ru)) {
    if (Array.isArray(strings.ru[key])) continue; // hint_bullets has no {tokens}
    const ruTokens = [...strings.ru[key].matchAll(tokenPattern)].map(m => m[1]).sort();
    const enTokens = [...strings.en[key].matchAll(tokenPattern)].map(m => m[1]).sort();
    assert.deepEqual(enTokens, ruTokens, `STRINGS.en.${key} and STRINGS.ru.${key} use different {tokens}`);
  }
});
