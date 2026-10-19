// Optional git-backed legacy regression. The normal unit test itself needs no git history.
// node tools/check-plan-c-traffic-parity.mjs [baseline=473a78a]
import { makeContext } from '../tests/plan-c-traffic-levels.test.mjs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const ref=process.argv[2]||'473a78a';
if(!/^[a-f0-9]{7,40}$/.test(ref))throw new Error('baseline must be a commit hash');
const old=execFileSync('git',['show',`${ref}:tycoon-v161.html`],{encoding:'utf8',maxBuffer:8000000});
let n=0;
for(const mode of ['waypoint','loop','arterial','service']){
  const snapshots=[];
  for(const T of [makeContext('B',old),makeContext('B')]){
    const V=T.THREE.Vector3,g=new T.THREE.Object3D();g.position.set(-10,.04,0);g.rotation.y=Math.PI/2;
    const route=[new V(-10,0,0),new V(20,0,0),new V(20,0,30)];
    const a={group:g,kind:'civilian',pause:0,route,districtId:'fixture',_v82LoopDistance:0,_v82ArterialDistance:0};
    const loop=T.fixture.pathDataV82([new V(-10,0,0),new V(20,0,0),new V(20,0,30),new V(-10,0,30)],true);
    g.userData={role:'delivery',state:'returning',path:route,pathIndex:0,speed:2.8,currentSpeed:0,home:route.at(-1).clone()};
    const frames=[];
    for(let i=0;i<300;i++){
      if(mode==='waypoint')T.transportMotionKernel.moveWaypointCityVehicle(a,1/30,()=>{});
      if(mode==='loop')T.fixture.moveClosedLoopV82(a,1/30,loop,'_v82LoopDistance');
      if(mode==='arterial')T.transportMotionKernel.moveArterialCar(a,1/30);
      if(mode==='service')T.moveWorkVehicle(g,1/30);
      frames.push([g.position.toArray(),g.rotation.y,mode==='service'?g.userData.currentSpeed:T.fixture.stateOf(a).speed]);
    }
    snapshots.push(frames);
  }
  assert.deepEqual(snapshots[0],snapshots[1],`${mode} B must match ${ref} exactly`);n+=300;
}
console.log(`PASS legacy B frame-for-frame parity: ${n} frames, waypoint/loop/arterial/service owners`);
