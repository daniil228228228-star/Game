// The software preview must agree with Three.js visibility for nearly coplanar
// ground/road surfaces seen in perspective. No browser or WebGL is involved.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {render,THREE}=require('../tools/offline-v161/render.cjs');
const group=new THREE.Group();
const ground=new THREE.Mesh(new THREE.PlaneGeometry(80,80),new THREE.MeshBasicMaterial({color:0x227722}));
ground.rotation.x=-Math.PI/2;group.add(ground);
const road=new THREE.Mesh(new THREE.PlaneGeometry(4,50),new THREE.MeshBasicMaterial({color:0x777777}));
road.rotation.x=-Math.PI/2;road.position.y=.05;group.add(road);
const W=240,H=240,az=.6,el=.55,dist=30,target=[0,0,0],fov=55;
const result=render(group,{W,H,az,el,dist,target,fov,ground:false});
const cam=new THREE.PerspectiveCamera(fov,W/H,.1,200);
cam.position.set(Math.sin(az)*Math.cos(el)*dist,Math.sin(el)*dist,Math.cos(az)*Math.cos(el)*dist);cam.lookAt(0,0,0);cam.updateMatrixWorld(true);
group.updateMatrixWorld(true);
let n=0;
for(const z of [-18,-12,-6,0,6,12,18]) {
  const p=new THREE.Vector3(0,.05,z).project(cam);
  const x=Math.floor((p.x*.5+.5)*W),y=Math.floor((.5-p.y*.5)*H);
  if(x<2||x>=W-2||y<2||y>=H-2)continue;
  const ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((x+.5)/W*2-1,1-(y+.5)/H*2),cam);
  assert.equal(ray.intersectObjects(group.children)[0]?.object,road,'reference ray hits the raised road');
  const k=(y*W+x)*3,r=result.buf[k],g=result.buf[k+1],b=result.buf[k+2];
  assert.ok(Math.abs(r-g)<=1&&Math.abs(g-b)<=1,`software road pixel incorrectly occluded by grass at ${x},${y}: ${r},${g},${b}`);n++;
}
assert.ok(n>=5);
console.log(`PASS software depth agrees with raycasts at ${n} perspective road samples`);
