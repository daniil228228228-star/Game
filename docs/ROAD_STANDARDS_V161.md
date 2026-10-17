# Нормы дорог, с которыми сверяется игра (2026-10-17)

Владелец: «сверяй всё с реальной практикой и интернетом». Ниже: что говорят источники, как это ложится на масштаб игры и что в коде сделано/не сделано.

## Что говорят источники

| Что | Норма | Источник |
|---|---|---|
| Угол пересечения улиц | 90° идеал, **не меньше 75°** там, где место ограничено; 60° AASHTO считает пределом, после которого теряется выгода прямоугольного пересечения | FHWA (Handbook for Designing Roadways for the Aging Population, гл. 7), ITE Traffic Engineering Handbook, Iowa DOT Design Manual 6A-8 |
| Радиус бордюра на углу | 10-15 футов (3-4,6 м) стандарт в городе, больше 15 футов только исключение; муниципальные нормы для магистралей и грузовиков 25-35 футов (7,6-10,7 м) | NACTO Urban Street Design Guide «Corner radii»; ecode360 / городские своды |
| Ширина полосы | 10 футов (3,0 м) в городе, 11 футов (3,35 м) для автобусных и грузовых маршрутов; более широкие 11-13 футов исторически, но не нужны в тесной застройке | NACTO «Lane width», Alameda Vision Zero |
| Тротуар (пешеходная зона) | 5-7 футов (1,5-2,1 м) в жилой застройке, 8-12 футов (2,4-3,7 м) в деловой | NACTO «Sidewalk zones» |
| Смещённые T-перекрёстки | оси не ближе 150 футов (около 46 м) | городские нормы (Kansas, ecode360) |
| Длина квартала | не больше 150 м (500 футов); местные улицы 120-180 м (400-600 футов) | Charlotte Urban Street Design Guidelines, LEED / 2030 Palette |
| Видимость на пересечении | треугольник видимости по остановочному пути | СП 42.13330 (учебные материалы) |

(Сайт NACTO из песочницы не открывается, числа взяты из выдержек поиска; российский СП 42.13330 прямых значений в выдержках не дал.)

## Масштаб игры

Игровая улица 2,4-2,9 м шириной вместе с двумя тротуарами; настоящая местная улица с двумя полосами по 3 м и тротуарами это около 10-12 м. Масштаб примерно 1:4. Поэтому:
- радиус скругления угла берётся пропорционально ширине улицы (около 0,7-0,8 ширины), а не в метрах нормы (1,9 м вместо 0,66 м);
- углы пересечений не масштабируются: 90°, не меньше 75°;
- полосы, тротуары и квартальная сетка остаются в стилизованном масштабе игры.

## Что было не так и что сделано

**Было** (ядро старого города, слои v86/v84): дорога от центральной площади к каждому зданию шла по прямой диагонали под произвольным углом (`branchCandidates99`: «префер direct road across open ground»); районные соединители тоже (`planOrthogonal`: первый кандидат `[start,end]`). Итог: 92 пары стыков вне 75-105°, звезда из острых слияний, углы 36°, 38°, 112°, 135° (см. скриншот владельца 2026-10-17 02:21).

**Сделано:**
1. `branchCandidates99` и `planOrthogonal` (`tycoon-v161.html`): прямая дорога только если она уже вдоль оси; иначе один прямоугольный «зигзаг» (колено 90°).
2. Радиус скругления центральной линии стадийных дорог 0,66 -> 1,9 м (`centerline()`).
3. Объединение контуров дорог (`roadUnionContours`): допуск пересечения рёбер расширен (1e-7 -> 1e-4 / 1e-5): прямоугольные дороги кончаются ровно на рёбрах соседей, float32-вершины давали «промах» и разомкнутый контур.
4. Проверка: 0 стыков вне 75-105° (было 92), все направления сегментов вдоль осей (0°/90°), кроме одного служебного сегмента промышленной зоны.

**Не сделано (нужно отдельное решение владельца):**
- Центральная площадь: все дороги сходятся в одну точку, в реальных городах радиальные улицы встречаются на кольце/круге (circle), а не в точке; нужен «круговой узел».
- Расстояние между перекрёстками и длина кварталов не проверялись на новой сетке.
- Сети районов (v59 outer, v70 service) не менялись.
- Ширина полос, тротуаров и бордюрные радиусы на старых дорогах остаются прежними (масштаб игры).

Скрипт анализа (углы и направления сегментов): см. `tools/` (`tools/road-audit-v161.mjs`).

## Источники

- FHWA, Handbook for Designing Roadways for the Aging Population, ch. 7 Intersections: https://highways.dot.gov/safety/other/older-road-user/handbook-designing-roadways-aging-population/chapter-7-intersections
- FHWA Intersection Safety (skew angle): https://www.fhwa.dot.gov/publications/research/safety/97135/rs1.cfm
- Iowa DOT Design Manual 6A-8 Intersection alignment: https://iowadot.gov/design-manual/chapter-6-geometric-design/6a-8-intersection-alignment-and-realignment
- NACTO Urban Street Design Guide, corner radii: https://nacto.org/publication/urban-street-design-guide/street-design-elements/corner-radii
- NACTO, sidewalk zones: https://nacto.org/publication/urban-street-design-guide/street-design-elements/sidewalks/sidewalk-zones/
- NACTO, lane width: https://nacto.org/publication/urban-street-design-guide/streets/lane-width
- Charlotte Urban Street Design Guidelines, Table 4.1 block lengths: https://greatstreets-stl.org/document-library/doc_view/273-charlotte-street-design-guide-chap-4-segments
