# Генплан C: журнал работы (шаг C1 «Каркас»)

Этот файл ведёт исполнитель C1, чтобы любой другой агент мог продолжить. Спецификация: `docs/MASTERPLAN_C_MIGRATION.md` (раздел 6), данные `tools/masterplan/plan-C.json`.

## Сделано (коммиты в ветке `claude/new-session-v2u5sj`)
- `assets/layout-v161.js` (грузится первым после Three.js): `window.LAYOUT_V161` = `'C'` для новой игры (нет сохранения) и сохранений с `layoutV161:'C'`, `'B'` для всех старых. `?layout=B|C` в адресе перекрывает. Сохранение пишет `layoutV161`.
- `tools/masterplan/compile-plan-c.mjs`: `plan-C.json` -> `assets/plan-c-data-v161.js` (ячейки 60 м; `--check`, `--stats`).
- `assets/plan-c-v161.js`: слой (ленивые ячейки вокруг игрока, одна слитая сетка на ячейку, instanced-фурнитура, проходимый пол `PlanCDataV161.floor/access`, `PlanCV161.clamp`).
- `tycoon-v161.html`: ядро учитывает layout C (access/clamp/загрузка позиции, точка старта, кольца острова, холмы/скайлайн, декор старого ядра выключены в их владельцах).

## Как запустить
- Картинки: `node tools/shoot-plan-c.mjs OUT "имя:x,z,dist,el,az" ...` (el 90 = вид сверху).
- Данные: `node tools/masterplan/compile-plan-c.mjs` (перегенерация), `--check`.
- Тест: `node tests/plan-c-roads.test.mjs` (SHOTS_DIR=dir для картинок).

## Дальше
См. раздел «Статус» ниже (обновляется по ходу).

## Статус
- [ ] старые дорожные системы выключены в C (v59/v84/v86/v113/v66/коннекторы/legacy roadside/круг roundabout-v161)
- [ ] тест plan-c-roads
- [ ] регрессия B (OLD_SAVE 51 / -720375465)
- [ ] сборка вариантов, CHANGELOG, CLAUDE.md
