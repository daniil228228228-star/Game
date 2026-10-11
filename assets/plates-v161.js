/* Plates v161 (2026-10-11): ONE drawing + fitting routine for every text plate of the world.
 * User, after the iPhone test: «плашки налезают, если подходишь со стороны, врезаются в стену» (a sprite plate was depth-tested against
 * walls / fences / boards and cut by them; the fleet-yard board text was clipped at the right edge).
 * Two kinds:
 *  - FLOATING plates = billboard sprites (makeLabelSprite in tycoon-v161.html): a compact dark pill with a small leader stem, drawn ON TOP of
 *    the geometry (depthTest false, renderOrder 1000, no depth write) so no wall can ever cut them. Placement / size / fade / cap: labelLayout
 *    in assets/surface-world-v152.js.
 *  - BOARD texts that are PART of a building (fleet yard sign, bay numbers, construction-site board) = a real textured plane lying on the
 *    board face (makeBoardLabelV161), depth-tested like any other part of the building, so geometry occludes it correctly and it can never
 *    stick out of the board.
 * Text is fitted with REAL measureText widths (font shrinks down to MIN, one long single line wraps into 2 lines, ellipsis only as a last resort);
 * the measured result is kept in userData.v161Plate for tests. */
(() => {
  'use strict';
  const FONT = (size, weight) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Arial, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  /* premium style (2026-10-11 (17)): graphite glass body, warm-gold hairline, round icon medallion on the left (resource / building category), a semi-bold title over a smaller muted
   * subtitle, a thin progress hairline when a row carries "a/b", a small tail pointer. Same design tokens as assets/premium-ui-v161.css (kept in sync by hand: the canvas cannot read CSS). */
  const TOKENS = { panelTop: 'rgba(28,34,43,0.97)', panelBottom: 'rgba(15,19,25,0.97)', goldHi: '#f4d98e', gold: '#e8c36a', mint: '#6fe3b0', amber: '#f0a94a', steel: '#8db4e8', ink: '#f4f1e8', ink2: '#b9c2cd' };
  const COLORS = [TOKENS.ink, TOKENS.ink2, TOKENS.ink2];
  const BASE = { 1: [62], 2: [58, 42], 3: [50, 38, 32] };
  const WEIGHT = { 1: [700], 2: [700, 600], 3: [700, 600, 600] };
  const MIN_SIZE = 18;
  const cleanLines = (lines) => (Array.isArray(lines) ? lines : [lines]).filter((v) => v !== undefined && v !== null).map((v) => String(v)).slice(0, 3);
  const EMOJI = /^(\p{Extended_Pictographic}️?)\s*/u;
  const CATS = [
    ['wood', /🪵|ДОСК|PLANK|WOOD|ЛЕС\b|LOG\b/i, TOKENS.amber],
    ['concrete', /🧱|БЕТОН|CONCRETE/i, '#a9bccf'],
    ['steel', /🔩|СТАЛ|STEEL|METAL|МЕТАЛЛ/i, TOKENS.steel],
    ['money', /💰|💵|\$|ДЕНЬГ|MONEY/i, TOKENS.gold],
    ['goal', /ЦЕЛЬ|GOAL|ИДИ К|GO TO/i, TOKENS.mint],
    ['fleet', /🚛|🚚|LOGISTIC|ЛОГИСТ|АВТОПАРК|FLEET|TRUCK|ГРУЗОВИК/i, TOKENS.steel],
    ['build', /🏠|🏗|HOUSE|ДОМ\b|BUILD|СТРОЙ|ГАРАЖ|GARAGE|SHOP|МАГАЗИН|OFFICE|ОФИС|TOWER|БАШН|ЗАВОД|PLANT|YARD|ЛЕСОПИЛ|SAWMILL/i, TOKENS.gold],
  ];
  function categoryOf(lines) {
    for (const row of lines) for (const [name, re, color] of CATS) if (re.test(row)) return { name, color };   // the first row (the title) decides, then the next ones
    return { name: 'info', color: TOKENS.steel };
  }
  // the leading emoji of a row goes to the medallion and is removed from the text (the medallion is its place)
  function splitEmoji(lines) {
    for (let i = 0; i < lines.length; i++) { const m = EMOJI.exec(lines[i]); if (m && lines[i].length > m[0].length) { const out = lines.slice(); out[i] = lines[i].slice(m[0].length); return { lines: out, emoji: m[1] }; } }
    return { lines, emoji: '' };
  }
  const fraction = (lines) => { for (const l of lines) { const m = /(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/.exec(l); if (m) { const a = parseFloat(m[1].replace(',', '.')), b = parseFloat(m[2].replace(',', '.')); if (b > 0) return Math.max(0, Math.min(1, a / b)); } } return -1; };

  function width(ctx, text, size, weight) { ctx.font = FONT(size, weight); return ctx.measureText(text).width; }

  // largest size in [min, max] at which `text` fits `maxW`; ellipsis only if even `min` is too wide
  function fit(ctx, text, maxW, max, min, weight) {
    let size = max;
    while (size > min && width(ctx, text, size, weight) > maxW) size -= 1;
    let out = text, ell = false, w = width(ctx, out, size, weight);
    while (w > maxW && out.length > 1) { out = out.slice(0, -1); w = width(ctx, out.trimEnd() + '…', size, weight); ell = true; }
    if (ell) out = out.trimEnd() + '…';
    return { text: out, size, w: ell ? w : width(ctx, out, size, weight), ellipsis: ell };
  }

  // a single long line becomes two (split at the space nearest to the middle) when it cannot reach `comfort` px
  function wrapSingle(lines, maxW, comfort) {
    if (lines.length !== 1) return lines;
    const t = lines[0];
    if (width(probe, t, comfort, 700) <= maxW || t.indexOf(' ') < 0) return lines;
    let best = -1;
    for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - t.length / 2) < Math.abs(best - t.length / 2))) best = i;
    return [t.slice(0, best), t.slice(best + 1)];
  }

  function medallion(ctx, cx, cy, d, cat, emoji) {
    const r = d / 2;
    const g = ctx.createRadialGradient(cx, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = cat.color + '33'; ctx.fill(); ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = 3.5; ctx.strokeStyle = cat.color; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (emoji) { ctx.font = `${Math.round(d * 0.52)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText(emoji, cx, cy + d * 0.03); return; }
    ctx.fillStyle = cat.color; ctx.strokeStyle = cat.color; ctx.lineWidth = Math.max(3, d * 0.07); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const u = d * 0.2;
    if (cat.name === 'build') {   // a house
      ctx.beginPath(); ctx.moveTo(cx - u * 1.5, cy - u * 0.1); ctx.lineTo(cx, cy - u * 1.5); ctx.lineTo(cx + u * 1.5, cy - u * 0.1); ctx.stroke();
      ctx.beginPath(); ctx.rect(cx - u * 1.05, cy - u * 0.1, u * 2.1, u * 1.45); ctx.stroke();
    } else if (cat.name === 'goal') {   // a target
      ctx.beginPath(); ctx.arc(cx, cy, u * 1.35, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, u * 0.45, 0, Math.PI * 2); ctx.fill();
    } else if (cat.name === 'money') {   // a coin
      ctx.beginPath(); ctx.arc(cx, cy, u * 1.3, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx - u * 0.5, cy); ctx.lineTo(cx + u * 0.5, cy); ctx.stroke();
    } else {   // a faceted cube
      ctx.beginPath(); ctx.moveTo(cx, cy - u * 1.4); ctx.lineTo(cx + u * 1.3, cy - u * 0.7); ctx.lineTo(cx + u * 1.3, cy + u * 0.7); ctx.lineTo(cx, cy + u * 1.4); ctx.lineTo(cx - u * 1.3, cy + u * 0.7); ctx.lineTo(cx - u * 1.3, cy - u * 0.7); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - u * 1.3, cy - u * 0.7); ctx.lineTo(cx, cy); ctx.lineTo(cx + u * 1.3, cy - u * 0.7); ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + u * 1.4); ctx.stroke();
    }
  }

  function bodyPath(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

  /* draw(lines, {w, h, stem, pill, colors}) -> {canvas, info}; info.inner = text box width, info.rows = measured rows.
   * Floating plates (stem) = medallion + left-aligned title / subtitle (+ progress hairline); boards (no stem) = the same body, text centred, no medallion. */
  function draw(linesIn, opt = {}) {
    let lines = cleanLines(linesIn);
    if (!lines.length) lines = [''];
    const W = opt.w || 512;
    const H = opt.h || (lines.length >= 3 ? 246 : 210);
    const stem = opt.stem === false ? 0 : Math.round(H * (opt.stemK || 0.13));
    const pill = opt.pill !== false;
    const floating = pill && stem > 0;
    const cat = categoryOf(lines);
    let emoji = '';
    if (floating) { const sp = splitEmoji(lines); lines = sp.lines; emoji = sp.emoji; }
    const frac = floating ? fraction(lines) : -1;
    const inset = pill ? 10 : 0;
    const top = inset, bottom = H - stem - (pill ? 8 : 0), pillH = bottom - top;
    const padX = pill ? Math.round(W * 0.036) : Math.round(W * 0.02);
    const md = floating ? Math.min(Math.round(pillH * 0.46), 76) : 0;
    const x0 = inset + padX + (floating ? md + 12 : 0), x1 = W - inset - padX;
    const inner = x1 - x0;
    lines = wrapSingle(lines, inner, Math.round(H * 0.17));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (pill) {
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, TOKENS.panelTop); g.addColorStop(1, TOKENS.panelBottom);
      const rad = Math.min(30, pillH / 2.4);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 3;
      ctx.fillStyle = g; bodyPath(ctx, inset, top, W - 2 * inset, pillH, rad); ctx.fill(); ctx.restore();
      const hg = ctx.createLinearGradient(0, top, 0, bottom);   // the warm-gold hairline: brighter at the top rim
      hg.addColorStop(0, 'rgba(244,217,142,0.95)'); hg.addColorStop(1, 'rgba(232,195,106,0.45)');
      ctx.strokeStyle = hg; ctx.lineWidth = 3; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,236,190,0.14)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(inset + rad, top + 5); ctx.lineTo(W - inset - rad, top + 5); ctx.stroke();
      if (stem) { // tail pointer pointing down at the target
        const cx = W / 2, sw = Math.round(W * 0.045);
        ctx.fillStyle = TOKENS.panelBottom;
        ctx.beginPath(); ctx.moveTo(cx - sw, bottom - 2); ctx.lineTo(cx + sw, bottom - 2); ctx.lineTo(cx, bottom + stem - 2); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(232,195,106,0.75)'; ctx.lineWidth = 3; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(cx - sw, bottom - 1); ctx.lineTo(cx, bottom + stem - 2); ctx.lineTo(cx + sw, bottom - 1); ctx.stroke();
        ctx.fillStyle = TOKENS.panelBottom; ctx.fillRect(cx - sw + 3, bottom - 6, 2 * sw - 6, 8);
      }
    }
    if (floating) medallion(ctx, inset + padX + md / 2, top + pillH / 2 - (frac >= 0 ? 4 : 0), md, cat, emoji);
    const n = lines.length, k = pillH / (210 - 36 - 10 - 8);
    const barH = frac >= 0 ? 14 : 0;
    const rowH = (pillH - (pill ? 20 : 0) - barH) / n;
    const rows = [];
    ctx.textAlign = floating ? 'left' : 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const tx = floating ? x0 : W / 2;
    for (let i = 0; i < n; i++) {
      const weight = WEIGHT[n][i], max = Math.min(Math.round(BASE[n][i] * Math.max(0.6, k)), Math.floor(rowH * 0.78));
      const f = fit(ctx, lines[i], inner, Math.max(MIN_SIZE, max), Math.min(MIN_SIZE, max), weight);
      const y = top + (pill ? 10 : 0) + rowH * (i + 0.5) + 2;
      ctx.font = FONT(f.size, weight);
      ctx.fillStyle = opt.colors ? opt.colors[i] || opt.colors[0] : COLORS[i]; ctx.fillText(f.text, tx, y);
      rows.push({ text: f.text, size: f.size, w: f.w, ellipsis: f.ellipsis, y, weight, font: FONT(f.size, weight) });
    }
    if (frac >= 0) {   // thin progress hairline along the bottom of the pill, aligned with the text
      const by = bottom - 13, bw = floating ? inner : W - 2 * (inset + padX) - 8, bx = floating ? x0 : inset + padX + 4;
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; bodyPath(ctx, bx, by, bw, 5, 2.5); ctx.fill();
      if (frac > 0.01) { ctx.fillStyle = frac >= 0.999 ? TOKENS.gold : TOKENS.mint; bodyPath(ctx, bx, by, Math.max(5, bw * frac), 5, 2.5); ctx.fill(); }
    }
    return { canvas, info: { W, H, inner, stem, rows, cat: cat.name, emoji, progress: frac, ok: rows.every((r) => r.w <= inner + 0.5), ellipsis: rows.some((r) => r.ellipsis) } };
  }

  function texture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.encoding = THREE.sRGBEncoding; t.magFilter = THREE.LinearFilter;
    // a plate is drawn at 15-40 % of its canvas size: without mipmaps the minification aliased the text into noise (shots 2026-10-11 (17)). Mipmaps need a power-of-two canvas or WebGL2.
    let mip = false, aniso = 1;
    try { const caps = renderer.capabilities; mip = !!caps.isWebGL2 || (THREE.MathUtils.isPowerOfTwo(canvas.width) && THREE.MathUtils.isPowerOfTwo(canvas.height)); aniso = Math.min(4, caps.getMaxAnisotropy ? caps.getMaxAnisotropy() : 1); } catch (_) { /* renderer not ready: no mipmaps */ }
    t.generateMipmaps = mip; t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter; t.anisotropy = aniso;
    return t;
  }

  // board text = a real plane on the board face (depth-tested, polygon offset against z-fighting); faces +z, rotate the mesh for other sides
  function makeBoard(lines, w, h, opt = {}) {
    const W = 512, H = Math.max(64, Math.round(512 * h / w));
    const d = draw(lines, { w: W, h: H, stem: false, pill: opt.pill !== false, colors: opt.colors });
    const mat = new THREE.MeshBasicMaterial({ map: texture(d.canvas), transparent: true, depthTest: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.renderOrder = 3;
    mesh.userData.v161Board = true; mesh.userData.v161Plate = d.info; mesh.userData.v161PlateOpt = { w, h, pill: opt.pill !== false, colors: opt.colors };
    mesh.userData.v161LinesKey = JSON.stringify(lines);
    return mesh;
  }
  function redrawBoard(mesh, lines) {
    const key = JSON.stringify(lines);
    if (mesh.userData.v161LinesKey === key) return;
    mesh.userData.v161LinesKey = key;
    const o = mesh.userData.v161PlateOpt, W = 512, H = Math.max(64, Math.round(512 * o.h / o.w));
    const d = draw(lines, { w: W, h: H, stem: false, pill: o.pill, colors: o.colors });
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.map = texture(d.canvas); mesh.material.needsUpdate = true;
    mesh.userData.v161Plate = d.info;
  }

  // floating plate: texture + sprite material (the sprite itself is built by makeLabelSprite)
  function makeSpriteParts(lines) {
    const d = draw(lines, {});
    const material = new THREE.SpriteMaterial({ map: texture(d.canvas), depthTest: false, depthWrite: false, transparent: true, toneMapped: false });
    return { material, info: d.info };
  }

  window.PlatesV161 = { version: 'v161-plates', draw, fit, makeBoard, redrawBoard, makeSpriteParts, TOKENS, categoryOf, MIN_SIZE, MAX_VISIBLE: 4, RENDER_ORDER: 1000 };
})();
