import * as THREE from 'three';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9d8e7);
scene.fog = new THREE.Fog(0xb9d8e7, 28, 80);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(18, 14, 20);
camera.lookAt(0, 2, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.querySelector('#app').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xe7f4ff, 0x6f5638, 1.5));
const sun = new THREE.DirectionalLight(0xffdfaa, 3.2);
sun.position.set(-12, 22, -10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(70, 55),
  new THREE.MeshStandardMaterial({ color: 0x6d8250, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const site = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 18),
  new THREE.MeshStandardMaterial({ color: 0x9b7651, roughness: 1 })
);
site.rotation.x = -Math.PI / 2;
site.position.y = 0.015;
site.receiveShadow = true;
scene.add(site);

const marker = new THREE.Mesh(
  new THREE.BoxGeometry(8, 0.5, 6),
  new THREE.MeshStandardMaterial({ color: 0xb8bdc1, roughness: 0.85 })
);
marker.position.y = 0.25;
marker.castShadow = marker.receiveShadow = true;
scene.add(marker);

let yaw = 0.7;
let pitch = 0.62;
let distance = 28;
let pointer = null;

function updateCamera() {
  const target = new THREE.Vector3(0, 2.5, 0);
  camera.position.set(
    target.x + Math.cos(yaw) * Math.cos(pitch) * distance,
    target.y + Math.sin(pitch) * distance,
    target.z + Math.sin(yaw) * Math.cos(pitch) * distance
  );
  camera.lookAt(target);
}
updateCamera();

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointer = { x: event.clientX, y: event.clientY };
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!pointer) return;
  yaw -= (event.clientX - pointer.x) * 0.006;
  pitch = THREE.MathUtils.clamp(pitch + (event.clientY - pointer.y) * 0.004, 0.25, 1.15);
  pointer = { x: event.clientX, y: event.clientY };
  updateCamera();
});
renderer.domElement.addEventListener('pointerup', () => { pointer = null; });
renderer.domElement.addEventListener('wheel', (event) => {
  distance = THREE.MathUtils.clamp(distance + event.deltaY * 0.02, 12, 44);
  updateCamera();
}, { passive: true });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => renderer.render(scene, camera));
