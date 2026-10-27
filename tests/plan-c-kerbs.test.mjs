// Drawn geometry checks, not bookkeeping or a browser/Safari acceptance claim.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pavementOracle} from '../tools/masterplan/lane-paths-plan-c.mjs';
const T={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../assets/plan-c-data-v161.js',import.meta.url),'utf8'),T);
const D=T.window.PlanCDataV161,O=pavementOracle(D),walls=[],unique=new Set();let checks=0;
for(const [key,c]of Object.entries(D.cells)){
  const [cx,cz]=key.split(',').map(Number),a=c.r?.w||[];
  for(let i=0;i<a.length;i+=7){
    const w=a.slice(i,i+7);walls.push(w);
    assert.ok(w.every(Number.isFinite),'finite kerb face');
    assert.ok(Math.hypot(w[2]-w[0],w[3]-w[1])>=.0009,'nondegenerate face');
    for(const k of [0,2])assert.ok(w[k]>=cx*60-.001&&w[k]<=cx*60+60+.001,'kerb x belongs to its loaded cell');
    for(const k of [1,3])assert.ok(w[k]>=cz*60-.001&&w[k]<=cz*60+60+.001,'kerb z belongs to its loaded cell');
    const edge=[w.slice(0,2).join(','),w.slice(2,4).join(',')].sort().join('|')+'|'+w.slice(4).join(',');
    assert.ok(!unique.has(edge),'no doubled kerb face: '+edge);unique.add(edge);checks+=7;
  }
}
let islandFaces=0,walkFaces=0;
for(const [,x,z,R,Ri]of D.graph.rings.concat(D.graph.minis)){
  // A grid split point lies on a chord, not on the ideal mathematical circle.
  const onRing=(a,b,r)=>{const d=Math.hypot(a-x,b-z);return d>=r*Math.cos(Math.PI/72)-.002&&d<=r+.002;};
  const near=walls.filter(w=>onRing(w[0],w[1],Ri)&&onRing(w[2],w[3],Ri));
  assert.ok(near.length>=72,'island outline has a continuous fine contour');
  let length=0;
  for(const w of near){
    const dx=w[2]-w[0],dz=w[3]-w[1],l=Math.hypot(dx,dz);length+=l;
    for(const t of [.15,.5,.85]){
      const px=w[0]+dx*t,pz=w[1]+dz*t,r=Math.hypot(px-x,pz-z),ux=(px-x)/r,uz=(pz-z)/r;
      const inside=O.surface(px-ux*.006,pz-uz*.006),outside=O.surface(px+ux*.006,pz+uz*.006);
      assert.ok(Math.abs(inside.y-w[5])<.006,'island top meets its kerb, no unsupported lip');
      assert.ok(outside.ci===D.palette.asph,'asphalt meets island kerb without a chord-shaped slit');checks+=2;
    }
    islandFaces++;
  }
  assert.ok(Math.abs(length-2*Math.PI*Ri)<.025,'closed complete island perimeter');
  for(const w of walls){
    if(Math.abs(w[5]-D.heights.walk)>.001||!onRing(w[0],w[1],R)||!onRing(w[2],w[3],R))continue;
    const px=(w[0]+w[2])/2,pz=(w[1]+w[3])/2,r=Math.hypot(px-x,pz-z);
    assert.ok(O.surface(px+(px-x)/r*.006,pz+(pz-z)/r*.006).y>=D.heights.walk-.004,'outer footway has a supported vertical edge');walkFaces++;checks++;
  }
}
assert.ok(walkFaces>100,'roundabout footways have vertical edges, not floating horizontal bands');
console.log(`PASS ${checks} kerb checks: ${walls.length} cell-owned unique faces; ${islandFaces} island faces; ${walkFaces} supported footway edges`);
