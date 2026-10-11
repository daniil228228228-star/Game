import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);
const root=new URL('../',import.meta.url).pathname;const THREE=require(root+'vendor/three_r128/three.min.js');
const scene=new THREE.Scene(),player=new THREE.Object3D();player.position.set(6,0,-125);
const c=vm.createContext({THREE,Math,Map,Set,window:{},scene,player,masterplanStateV161:{B01:true,B02:false,B03:true},GROUND_HALF:70,stageIndex:6,cityState:{reputation:25},totalRoadLevelsV37:()=>8,sourceTrees:[],TREE_INTERACT_RADIUS:3,gatherPhysicsCircles:()=>[],INDUSTRIAL_BUILD_STEPS_V118:[],refreshIndustrialPadMarkersV118:()=>{},knownSaveRawV64:null,nearestSafePlayerPosition:p=>p});
for(const file of ['assets/buildings-v161.js','assets/masterplan-port-data-v161.js','assets/masterplan-v161.js'])vm.runInContext(fs.readFileSync(root+file,'utf8'),c,{filename:file});
const group=scene.getObjectByName('mp161North');assert(group);let meshes=0;group.traverse(o=>{if(!o.isMesh)return;meshes++;assert([...o.geometry.attributes.position.array].every(Number.isFinite));});assert(meshes<=16,meshes);
const land=group.children.filter(o=>o.name.startsWith('mp161NorthLand_'));assert.equal(land.length,2);for(const m of land){m.geometry.computeBoundingBox();assert(m.geometry.boundingBox.getSize(new THREE.Vector3()).z<=60.001);assert(Math.abs(m.geometry.boundingBox.max.y+.035)<1e-5);}
assert(c.window.MasterplanV161.access(-7,-100));assert(!c.window.MasterplanV161.access(-9,-100));assert(c.window.MasterplanV161.access(6,-145));
console.log('PASS actual r128 geometry: '+meshes+' meshes, two <=60m land cells, paid ground walkable, outside blocked');
