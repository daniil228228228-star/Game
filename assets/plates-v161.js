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
  const FONT = (size, weight) => `${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif`;
  const probe = document.createElement('canvas').getContext('2d');
  const COLORS = ['#f2f7ff', '#ffd479', '#a9cfff'];
  const BASE = { 1: [58], 2: [54, 42], 3: [48, 38, 32] };
  const WEIGHT = { 1: [850], 2: [850, 800], 3: [850, 800, 750] };
  const MIN_SIZE = 18;
  const cleanLines = (lines) => (Array.isArray(lines) ? lines : [lines]).filter((v) => v !== undefined && v !== null).map((v) => String(v)).slice(0, 3);

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
    if (width(probe, t, comfort, 850) <= maxW || t.indexOf(' ') < 0) return lines;
    let best = -1;
    for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - t.length / 2) < Math.abs(best - t.length / 2))) best = i;
    return [t.slice(0, best), t.slice(best + 1)];
  }

  /* draw(lines, {w, h, stem, pill}) -> {canvas, info}; info.inner = text box width, info.rows = measured rows */
  function draw(linesIn, opt = {}) {
    let lines = cleanLines(linesIn);
    if (!lines.length) lines = [''];
    const W = opt.w || 512;
    const H = opt.h || (lines.length >= 3 ? 246 : 210);
    const stem = opt.stem === false ? 0 : Math.round(H * (opt.stemK || 0.13));
    const pill = opt.pill !== false;
    const inset = pill ? 10 : 0, padX = pill ? Math.round(W * 0.052) : Math.round(W * 0.02);
    const inner = W - 2 * inset - 2 * padX;
    lines = wrapSingle(lines, inner, Math.round(H * 0.17));
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    const top = inset, bottom = H - stem - (pill ? 8 : 0), pillH = bottom - top;
    if (pill) {
      const g = ctx.createLinearGradient(0, top, 0, bottom);
      g.addColorStop(0, 'rgba(24,33,48,0.96)'); g.addColorStop(1, 'rgba(9,14,22,0.95)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(inset, top, W - 2 * inset, pillH, Math.min(34, pillH / 2.4)); ctx.fill();
      ctx.strokeStyle = 'rgba(255,212,121,0.78)'; ctx.lineWidth = 4; ctx.stroke();
      if (stem) { // leader stem pointing down at the target
        const cx = W / 2, sw = Math.round(W * 0.045);
        ctx.fillStyle = 'rgba(11,17,26,0.96)';
        ctx.beginPath(); ctx.moveTo(cx - sw, bottom - 2); ctx.lineTo(cx + sw, bottom - 2); ctx.lineTo(cx, bottom + stem - 2); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(255,212,121,0.78)'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(cx - sw, bottom - 1); ctx.lineTo(cx, bottom + stem - 2); ctx.lineTo(cx + sw, bottom - 1); ctx.stroke();
        ctx.fillStyle = 'rgba(11,17,26,0.98)'; ctx.fillRect(cx - sw + 3, bottom - 6, 2 * sw - 6, 8);
      }
    }
    const n = lines.length, k = pillH / (210 - 36 - 10 - 8);
    const rowH = (pillH - (pill ? 20 : 0)) / n;
    const rows = [];
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    for (let i = 0; i < n; i++) {
      const weight = WEIGHT[n][i], max = Math.min(Math.round(BASE[n][i] * Math.max(0.6, k)), Math.floor(rowH * 0.78));
      const f = fit(ctx, lines[i], inner, Math.max(MIN_SIZE, max), Math.min(MIN_SIZE, max), weight);
      const y = top + (pill ? 10 : 0) + rowH * (i + 0.5) + 2;
      ctx.font = FONT(f.size, weight);
      ctx.lineWidth = Math.max(3, f.size * 0.1); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(f.text, W / 2, y);
      ctx.fillStyle = opt.colors ? opt.colors[i] || opt.colors[0] : COLORS[i]; ctx.fillText(f.text, W / 2, y);
      rows.push({ text: f.text, size: f.size, w: f.w, ellipsis: f.ellipsis, y });
    }
    return { canvas, info: { W, H, inner, stem, rows, ok: rows.every((r) => r.w <= inner + 0.5), ellipsis: rows.some((r) => r.ellipsis) } };
  }

  function texture(canvas) {
    const t = new THREE.CanvasTexture(canvas);
    t.encoding = THREE.sRGBEncoding; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false;
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

  window.PlatesV161 = { version: 'v161-plates', draw, fit, makeBoard, redrawBoard, makeSpriteParts, MIN_SIZE, MAX_VISIBLE: 4, RENDER_ORDER: 1000 };
})();
