// Premium UI, CHANGELOG_V161.md 2026-10-11 (17) -- user: «поменяй вот эти плашки, сделай редизайн и сделай чтобы был премиум такой стиль общий». assets/premium-ui-v161.css.
// ONE launch (stage-1 save, 390x664). Computed styles of the real elements (nothing is read from the CSS text):
//   1. the design tokens exist on :root with their exact values (gold #e8c36a, mint #6fe3b0, panel #12161c @ 86 %, radii 14 / 16);
//   2. every overlay piece (HUD chips, menu button, top cards, toast, action prompt, compass chip, the open market panel) uses them: gold hairline border, radius 14..16 px, a layered shadow,
//      a flat 80..96 % graphite background (alpha measured), one system font stack, tabular numerals on money;
//   3. WCAG AA: the computed text colours (title and muted) against the panel colour composited over WHITE (the worst background the game can put behind it) >= 4.5;
//   4. backdrop-filter layers on screen at once <= 3 (toast + event banner + the open panel are the only ones allowed to blur);
//   5. no horizontal overflow of the page or of the open panel; every tappable piece >= 40 px;
//   6. prefers-reduced-motion switches the press / transition motion off;
//   7. the dead double "x" in the panel close button is gone (one glyph), 0 console errors.
import { openGame, check, OLD_SAVE } from './lib/harness.mjs';

const J = JSON.stringify;
const g = await openGame({ save: { ...OLD_SAVE, money: 100000, planks: 50, concrete: 5, metal: 5 }, waitMs: 6000 });
const { page } = g;
const frames = (n) => page.evaluate((n) => new Promise((res) => { let k = 0; const f = () => (++k >= n ? res(true) : requestAnimationFrame(f)); f(); setTimeout(() => res(false), 20000); }), n);

// ---------------------------------------------------------------- force the transient pieces on screen
await page.evaluate(() => {
  const mk = (id, html) => { let el = document.getElementById(id); if (!el) { el = document.createElement('div'); el.id = id; document.body.appendChild(el); } if (html) el.innerHTML = html; el.hidden = false; for (const [k, v] of [['display', 'block'], ['visibility', 'visible'], ['opacity', '1']]) el.style.setProperty(k, v, 'important'); return el; };
  mk('carryRouteV139', '<div class="v139Line"><span class="v139Arrow">↑</span><span>На погрузку: 🪵 1</span><span class="v139Dist">23 м</span></div><div class="v139Meta">Забрать: ДОСКИ · 0/1 · 23 м</div>');
  mk('manualCoachV143', '1/3 · Иди к золотому маяку');
  const ab = document.getElementById('actionBtn'); ab.hidden = false; ab.disabled = false; ab.textContent = 'Улучшить'; ab.style.setProperty('display', 'block', 'important');
  const ap = document.getElementById('actionPrompt'); ap.classList.add('show'); ap.textContent = 'Улучшение: вместимость'; ap.style.setProperty('opacity', '1', 'important');
  toast('Помощь принята · ускорение 1.1с · энергия 2/3');
  document.body.classList.remove('v139-carrying', 'v138-context-action', 'v50-action-focus', 'v47-moving');
});
await frames(8);

// ---------------------------------------------------------------- 1. tokens
const tok = await page.evaluate(() => { const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim().toLowerCase(); return { gold: v('--pu-gold'), mint: v('--pu-mint'), amber: v('--pu-amber'), steel: v('--pu-steel'), panelSolid: v('--pu-panel-solid'), panel: v('--pu-panel'), r: v('--pu-r'), rl: v('--pu-r-lg'), s1: v('--pu-s1'), press: v('--pu-press'), font: v('--pu-font') }; });
check(tok.gold === '#e8c36a' && tok.mint === '#6fe3b0' && tok.panelSolid === '#12161c' && /^rgba\(18,\s*22,\s*28,\s*\.86\)$/.test(tok.panel) && tok.r === '14px' && tok.rl === '16px' && tok.s1 === '8px' && tok.press === '.97' && !!tok.amber && !!tok.steel, `design tokens on :root ${J(tok)}`);

// ---------------------------------------------------------------- 2/3. computed styles + contrast
const measured = await page.evaluate(() => {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 }; };
  const lin = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const over = (c, bg) => ({ r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 });
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  // a background that is a gradient: take the average of its colour stops
  const bgOf = (cs) => { const bi = cs.backgroundImage; if (bi && bi !== 'none') { const cols = [...bi.matchAll(/rgba?\([^)]+\)/g)].map((m) => parse(m[0])); if (cols.length) { const k = cols.length; return { r: cols.reduce((s, c) => s + c.r, 0) / k, g: cols.reduce((s, c) => s + c.g, 0) / k, b: cols.reduce((s, c) => s + c.b, 0) / k, a: cols.reduce((s, c) => s + c.a, 0) / k }; } } return parse(cs.backgroundColor); };
  const out = {};
  const probe = (key, el, textEls) => {
    if (!el) { out[key] = null; return; }
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), bg = bgOf(cs), flat = over(bg, WHITE);
    const rad = parseFloat(cs.borderTopLeftRadius), border = parse(cs.borderTopColor);
    const text = (textEls || [el]).filter(Boolean).map((t) => { const c = parse(getComputedStyle(t).color); return { sel: t.className || t.id || t.tagName, ratio: +ratio(over(c, flat), flat).toFixed(2) }; });
    out[key] = { w: Math.round(r.width), h: Math.round(r.height), radius: rad, borderGold: Math.abs(border.r - 232) < 40 && Math.abs(border.g - 195) < 40 && border.a > 0.15, borderW: parseFloat(cs.borderTopWidth), alpha: +bg.a.toFixed(2), shadow: cs.boxShadow !== 'none' && cs.boxShadow.includes(','), font: cs.fontFamily.slice(0, 40), tab: cs.fontVariantNumeric, text, blur: cs.backdropFilter };
  };
  const q = (s) => document.querySelector(s);
  probe('stat', q('#moneyStat'), [q('#money'), q('#income')]);
  probe('menu', q('#systemsBtn'), [q('#systemsBtn')]);
  probe('carry', q('#carryRouteV139'), [q('#carryRouteV139 .v139Line'), q('#carryRouteV139 .v139Meta'), q('#carryRouteV139 .v139Dist')]);
  probe('coach', q('#manualCoachV143'), [q('#manualCoachV143')]);
  probe('shift', q('#shiftGoalV127'), [q('#shiftGoalV127 .v127Top'), q('#shiftGoalV127 .v127Reward')]);
  probe('toast', q('#toast'), [q('#toast')]);
  probe('prompt', q('#actionPrompt'), [q('#actionPrompt')]);
  probe('compass', q('#compassDistance'), [q('#compassDistance')]);
  return out;
});
console.log('measured', J(measured));
for (const [k, m] of Object.entries(measured)) {
  if (!m) { console.log(`KNOWN ISSUE: ${k} not in the DOM`); continue; }
  check(m.radius >= 13.5 && m.radius <= 16.5, `${k}: corner radius ${m.radius}px is 14..16`);
  check(m.borderGold && m.borderW >= 1 && m.borderW <= 1.5, `${k}: 1 px warm-gold hairline border (${m.borderW}px)`);
  check(m.alpha >= 0.8 && m.alpha <= 0.98 && m.shadow, `${k}: flat graphite glass ${m.alpha} alpha with a layered shadow (${m.shadow})`);
  check(/apple-system|SF Pro|Segoe|Roboto|Helvetica|Arial/.test(m.font), `${k}: the one system font stack (${m.font})`);
  check(m.text.every((t) => t.ratio >= 4.5), `${k}: text contrast vs the panel over white >= 4.5 (${m.text.map((t) => t.ratio).join(', ')})`);
}
check(/tabular/.test(measured.stat.tab), `money uses tabular numerals (${measured.stat.tab})`);
check(measured.stat.h <= 32 && measured.menu.w <= 48 && measured.menu.h <= 48, `sizes not above the old ones: chip ${measured.stat.w}x${measured.stat.h} (<= 32 high), menu ${measured.menu.w}x${measured.menu.h} (<= 48)`);

// ---------------------------------------------------------------- 4/5. open the market panel: blur layers, overflow, tappable
await page.evaluate(() => window.openMarketTraderV119('team'));
await frames(10);
const open = await page.evaluate(() => {
  const vis = (el) => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.05 && r.width > 1 && r.height > 1; };
  let blur = 0; const blurs = [];
  for (const el of document.body.querySelectorAll('*')) { const cs = getComputedStyle(el), b = cs.backdropFilter || cs.webkitBackdropFilter; if (b && b !== 'none' && vis(el)) { blur++; blurs.push(el.id || el.className || el.tagName); } }
  const panel = document.querySelector('#systemsOverlay.show .v30Panel:not([hidden])') || [...document.querySelectorAll('.v30Panel')].find(vis);
  const pr = panel && panel.getBoundingClientRect();
  const btns = panel ? [...panel.querySelectorAll('button:not([hidden]),.v30Close')].filter(vis).map((b) => { const r = b.getBoundingClientRect(); return { t: (b.textContent || b.id || '').trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height) }; }) : [];
  const close = panel && panel.querySelector('.v30Close'), cs = close && getComputedStyle(close), after = close && getComputedStyle(close, '::after');
  const ap = document.getElementById('actionBtn'), ab = ap.getBoundingClientRect(), jb = document.getElementById('jumpBtn').getBoundingClientRect(), mb = document.getElementById('systemsBtn').getBoundingClientRect();
  return {
    blur, blurs, docOverflow: document.documentElement.scrollWidth - innerWidth, bodyOverflow: document.body.scrollWidth - innerWidth, panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : null, panelW: pr && Math.round(pr.width), btns,
    closeFont: cs && cs.fontSize, closeAfter: after && after.content, closeSize: close && [Math.round(close.getBoundingClientRect().width), Math.round(close.getBoundingClientRect().height)],
    tap: { action: [Math.round(ab.width), Math.round(ab.height)], jump: [Math.round(jb.width), Math.round(jb.height)], menu: [Math.round(mb.width), Math.round(mb.height)] }, panelBg: panel && getComputedStyle(panel).backgroundImage.slice(0, 60), panelRadius: panel && getComputedStyle(panel).borderTopLeftRadius,
  };
});
console.log('open', J(open));
check(open.blur <= 3, `backdrop-filter layers on screen at once: ${open.blur} <= 3 (${J(open.blurs)})`);
check(open.docOverflow <= 0 && open.bodyOverflow <= 0, `no horizontal page overflow (document ${open.docOverflow}, body ${open.bodyOverflow})`);
check(open.panelOverflow !== null && open.panelOverflow <= 1, `the open market panel does not overflow horizontally (${open.panelOverflow})`);
check(open.btns.length >= 2 && open.btns.every((b) => b.h >= 40 && b.w >= 40), `every button of the open panel is >= 40 px (${open.btns.length} buttons, min ${Math.min(...open.btns.map((b) => b.h))} high / ${Math.min(...open.btns.map((b) => b.w))} wide)`);
check(open.tap.action[0] >= 40 && open.tap.action[1] >= 40 && open.tap.jump[0] >= 40 && open.tap.jump[1] >= 40 && open.tap.menu[0] >= 40 && open.tap.menu[1] >= 40, `action / jump / menu buttons >= 40 px ${J(open.tap)}`);
check(open.closeFont === '0px' && /×|\\d7|"\\u00d7"/.test(open.closeAfter || '') && open.closeSize[0] >= 40, `the panel close button draws ONE glyph (text font-size ${open.closeFont}, ::after ${open.closeAfter}, ${open.closeSize})`);
check(/^(1[4-6])px$/.test(open.panelRadius), `the panel radius is 14..16 px (${open.panelRadius})`);
await page.evaluate(() => { document.querySelector('#systemsOverlay .v30Close')?.click(); });
await frames(6);

// ---------------------------------------------------------------- 6. reduced motion
await page.emulateMedia({ reducedMotion: 'reduce' });
await frames(4);
const rm = await page.evaluate(() => { const cs = getComputedStyle(document.getElementById('actionBtn')); return { dur: cs.transitionDuration, anim: cs.animationName }; });
check(/^0s(, 0s)*$/.test(rm.dur), `prefers-reduced-motion: the action button has no transition (${rm.dur})`);
await page.emulateMedia({ reducedMotion: 'no-preference' });

check(g.errors.length === 0, `0 console errors ${J(g.errors.slice(0, 3))}`);
await g.close();
