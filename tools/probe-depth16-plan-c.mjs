// Depth-precision probe (z-fighting emulation): renders the game's own camera into an off-screen target whose depth buffer is a 16- or 24-bit DepthTexture (SwiftShader draws the
// default framebuffer with 24+ bit, an iPhone often with 16: that is where thin layers 2-12 mm apart start to stripe).  Same placement language as tools/shoot-plan-c-walk.mjs.
//   node tools/probe-depth16-plan-c.mjs OUT [--bits=16] [--near=0.35] [--far=500] "name:ramp,frac[,back,up]" | "name@x,z,dirx,dirz[,y,back,up]" ...
// Each spec writes name-d16.png and name-d24.png and prints the mean absolute difference (a z-fight shows as high-frequency noise; 0 = identical).
import fs from 'node:fs';
import path from 'node:path';
import { openGame } from '../tests/lib/harness.mjs';
const args = process.argv.slice(2), opt = (n, d) => { const a = args.find((s) => s.startsWith('--' + n + '=')); return a ? Number(a.split('=')[1]) : d; };
const out = path.resolve(args[0] || 'd16'); fs.mkdirSync(out, { recursive: true });
const specs = args.slice(1).filter((s) => !s.startsWith('--')).map((s) => {
  if (s.includes('@')) { const [n, r] = s.split('@'); const [x, z, dx, dz, y, back, up] = r.split(',').map(Number); return { n, x, z, dx, dz, y: y || 0, back: back || 6.5, up: up || 4.5 }; }
  const [n, r] = s.split(':'); const [ramp, frac, back, up] = r.split(',').map(Number); return { n, ramp, frac, back: back || 6.5, up: up || 4.5 };
});
const g = await openGame({ save: 'clear', layout: 'C', waitMs: 5000 });
await g.page.evaluate((n) => { try { __TYCOON_V40__.setTime(n ? 22 : 12); } catch (_) {} }, !!process.env.NIGHT);
const W = 390, H = 664;
for (const s of specs) {
  const r = await g.page.evaluate(async ({ s, near, far, W, H }) => {
    let x = s.x, z = s.z, y = s.y, dx = s.dx, dz = s.dz;
    if (s.ramp !== undefined) { const pts = PlanCDataV161.graph.ramps[s.ramp][2]; const i = Math.max(1, Math.min(pts.length - 2, Math.round(s.frac * (pts.length - 1)))); const a = pts[i - 1], b = pts[i + 1]; x = pts[i][0]; z = pts[i][1]; y = pts[i][2]; dx = b[0] - a[0]; dz = b[1] - a[1]; }
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    PlanCV161.R_BUILD = 128; PlanCV161.ensureNear(x, z); player.position.set(x, y, z); playerVelocity.set(0, 0, 0); PlanCV161.level = y;
    for (let i = 0; i < 3; i++) updatePlayer(1 / 30);
    player.rotation.y = Math.atan2(dx, dz);
    await new Promise((r) => setTimeout(r, 1500));
    const cam = new THREE.PerspectiveCamera(50, W / H, near, far);
    cam.position.set(x - dx * s.back, player.position.y + s.up, z - dz * s.back); cam.lookAt(x, player.position.y + 1, z); cam.updateMatrixWorld(true);
    const res = {};
    for (const bits of [16, 24]) {
      const dt = new THREE.DepthTexture(W, H); dt.type = bits === 16 ? THREE.UnsignedShortType : THREE.UnsignedIntType; dt.format = THREE.DepthFormat;
      const rt = new THREE.WebGLRenderTarget(W, H, { depthTexture: dt, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }); rt.texture.encoding = THREE.sRGBEncoding;
      const oldTM = renderer.toneMapping; const oldTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(oldTarget); renderer.toneMapping = oldTM;
      const buf = new Uint8Array(W * H * 4); renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      const c = document.createElement('canvas'); c.width = W; c.height = H; const cx = c.getContext('2d'); const im = cx.createImageData(W, H);
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) { const a = ((H - 1 - yy) * W + xx) * 4, b = (yy * W + xx) * 4; im.data[b] = buf[a]; im.data[b + 1] = buf[a + 1]; im.data[b + 2] = buf[a + 2]; im.data[b + 3] = 255; }
      cx.putImageData(im, 0, 0); res['d' + bits] = c.toDataURL('image/png'); res['raw' + bits] = Array.from(im.data.filter((_, i) => i % 4 < 3));
      rt.dispose(); dt.dispose();
    }
    let sum = 0, n = res.raw16.length; for (let i = 0; i < n; i++) sum += Math.abs(res.raw16[i] - res.raw24[i]);
    return { d16: res.d16, d24: res.d24, diff: sum / n };
  }, { s, near: opt('near', 0.35), far: opt('far', 500), W, H });
  const bits = opt('bits', 16);
  fs.writeFileSync(path.join(out, s.n + '-d16.png'), Buffer.from(r.d16.split(',')[1], 'base64')); fs.writeFileSync(path.join(out, s.n + '-d24.png'), Buffer.from(r.d24.split(',')[1], 'base64'));
  console.log(s.n, 'mean |d16-d24| =', r.diff.toFixed(3));
}
console.log('errors', g.errors.slice(0, 5));
await g.close();
