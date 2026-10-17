// Camera zoom must not creep inward (user report 2026-10-17: "the camera gets closer over time and is hard to bring back").
// Root cause: OrbitControls' 'change' listener copied the CURRENT camera distance into desiredCameraDistance on every frame, and the obstruction
// resolver (resolveCameraObstructionV85) pulls the camera in near solid buildings, so every pull became the new "wanted" zoom and never relaxed.
// One launch: fresh save, a temporary wall is put between the player and the camera, the camera is pulled in, the wall is removed again.
//   * desiredCameraDistance (the zoom the player chose) survives the pull,
//   * the camera returns to it once the way is free,
//   * a double tap / double click on the canvas brings the zoom back to CAM_DEFAULT_DIST.
import { openGame, check, waitForState } from './lib/harness.mjs';

const J = JSON.stringify;
const g = await openGame({ save: 'clear', waitMs: 5000 });
const { page } = g;
const ev = (fn, arg) => page.evaluate(fn, arg);
try {
  const frames = (n) => ev(async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); return true; }, n);
  const dist = () => ev(() => +camera.position.distanceTo(controls.target).toFixed(2));
  const desired = () => ev(() => +desiredCameraDistance.toFixed(2));

  // choose a zoom of 13 m like a player would (the pinch ends in 'end' + damping 'change' events)
  await ev(() => {
    desiredCameraDistance = 13;
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, 13);
    controls.update();
    markCameraUserInput();
  });
  await waitForState(page, () => !V54_STABILITY.fallbackActive, null, { timeout: 40000 });
  await frames(40);
  const base = { dist: await dist(), desired: await desired() };
  check(Math.abs(base.desired - 13) < .6 && Math.abs(base.dist - 13) < 1.2, `start: the chosen zoom of 13 m holds in open ground (${J(base)})`);

  // a wall right behind the camera: the resolver pulls the camera in
  await ev(() => {
    const dir = camera.position.clone().sub(controls.target); dir.y = 0; dir.normalize();
    const w = new THREE.Mesh(new THREE.BoxGeometry(60, 40, 1.2), new THREE.MeshBasicMaterial());
    w.name = '__testCameraWall';
    const c = controls.target.clone().addScaledVector(dir, 4.5); w.position.set(c.x, 10, c.z); w.rotation.y = Math.atan2(dir.x, dir.z);
    scene.add(w); w.updateMatrixWorld(true);
    // the game rebuilds cameraSolidMeshes from its buildings every now and then: keep the test wall in the list while it stands
    window.__keepWall = true; const keep = () => { if (!window.__keepWall) return; if (!cameraSolidMeshes.includes(w)) cameraSolidMeshes.push(w); requestAnimationFrame(keep); }; keep();
  });
  await waitForState(page, () => !V54_STABILITY.fallbackActive && camera.position.distanceTo(controls.target) < 8, null, { timeout: 120000 });
  await frames(20);
  const pulled = { dist: await dist(), desired: await desired(), shift: await ev(() => +cameraResolverShiftV163.length().toFixed(2)) };
  check(pulled.dist < 6.5, `the camera is pulled in by the wall (${J(pulled)})`);
  check(pulled.desired > 12, `the zoom the player chose is NOT overwritten by the pulled distance (desired ${pulled.desired}, was 13)`);

  // the player touches the screen for a moment while the camera is pulled in (start / end refresh the wanted zoom)
  await ev(() => { controls.dispatchEvent({ type: 'start' }); });
  await frames(10);
  await ev(() => { controls.dispatchEvent({ type: 'end' }); });
  await frames(30);
  const touched = { dist: await dist(), desired: await desired() };
  check(touched.desired > 12, `a touch while pulled in keeps the chosen zoom (${J(touched)})`);

  // the wall goes away: the camera must come back to 13 m by itself
  await ev(() => { window.__keepWall = false; const w = scene.getObjectByName('__testCameraWall'); const i = cameraSolidMeshes.indexOf(w); if (i >= 0) cameraSolidMeshes.splice(i, 1); scene.remove(w); });
  await waitForState(page, () => !V54_STABILITY.fallbackActive && camera.position.distanceTo(controls.target) > 11.5, null, { timeout: 40000 });
  await frames(10);
  const back = { dist: await dist(), desired: await desired() };
  check(back.dist > 11.5, `after the wall is gone the camera returns to the chosen distance (${J(back)})`);

  // double tap on the canvas = zoom back to the default distance
  await ev(() => {
    const c = renderer.domElement, r = c.getBoundingClientRect(), x = r.left + r.width * .5, y = r.top + r.height * .35;
    const fire = (type) => c.dispatchEvent(new PointerEvent(type, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));
    fire('pointerdown'); fire('pointerup'); fire('pointerdown'); fire('pointerup');
  });
  await waitForState(page, () => !V54_STABILITY.fallbackActive && Math.abs(desiredCameraDistance - CAM_DEFAULT_DIST) < .3 && camera.position.distanceTo(controls.target) < 10.5, null, { timeout: 40000 });
  await frames(10);
  const dbl = { dist: await dist(), desired: await desired(), want: await ev(() => CAM_DEFAULT_DIST) };
  check(Math.abs(dbl.desired - dbl.want) < .3 && Math.abs(dbl.dist - dbl.want) < 1.2, `double tap / double click resets the zoom to the default distance (${J(dbl)})`);

  check(g.errors.length === 0, `no console/page errors (${J(g.errors.slice(0, 4))})`);
} catch (e) { console.error('FAIL: exception ' + (e && e.stack || e)); process.exitCode = 1; } finally { await g.close(); }
