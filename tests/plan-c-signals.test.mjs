// Actual rendered signal instances must use the same controller as vehicle admission.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {ctx} from './plan-c-height-unit.test.mjs';
ctx.LAYOUT_V161='C';
vm.runInContext(fs.readFileSync(new URL('../assets/plan-c-traffic-v161.js',import.meta.url),'utf8'),ctx);
const A=ctx.PlanCTrafficV161,C=ctx.PlanCV161,D=ctx.PlanCDataV161,THREE=ctx.THREE;
C.ensureNear(80,0);ctx.player.position.set(1000,0,1000);
const mesh=C.root.getObjectByName('planCfurn_signalLights');assert.ok(mesh?.isInstancedMesh,'actual light mesh exists');
const heads=D.graph.signalHeads.filter(s=>C.cells.has(Math.floor(s[0]/D.cell)+','+Math.floor(s[1]/D.cell)));
assert.equal(mesh.count,heads.length*3,'one active lens per head');
const phaseColors=[0xff352a,0xffbc25,0x35e467],color=new THREE.Color();let checks=0;
for(let slot=0;slot<5;slot++){
  for(const c of A.controllers.values())Object.assign(c,{slot,elapsed:0,actor:null});
  C.updateSignalLights(A.state);
  for(let n=0;n<heads.length;n++){
    const s=heads[n],phase=A.state(s[3],[s[4],s[5]]);
    for(let k=0;k<3;k++){
      mesh.getColorAt(n*3+k,color);
      const expected=new THREE.Color(['red','amber','green'][k]===phase?phaseColors[k]:0x20252a).convertSRGBToLinear();
      assert.ok(color.distanceTo?color.distanceTo(expected)<1e-5:Math.max(Math.abs(color.r-expected.r),Math.abs(color.g-expected.g),Math.abs(color.b-expected.b))<1e-5);checks++;
    }
  }
}
console.log(`PASS ${checks} rendered lens colours match all five admission phases (${heads.length} visible signal heads)`);
