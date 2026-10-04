/* Soft vegetation, shared instanced flower parts, and non-repeating terrain shading. */
'use strict';
function vegetationKindV154(root){
  const data=root?.userData||{};
  return data.foliageKindV154||data.v64SceneryKind||(data.harvestableTree?'tree':'soft');
}
function treeTrunkRadiusV154(root){
  const scale=new THREE.Vector3();root.getWorldScale(scale);
  return Math.max(.08,Number(root.userData?.treeTrunkRadiusV154||.26)*Math.max(Math.abs(scale.x),Math.abs(scale.z)));
}
function createFlowerPatchV154(radius=.42,count=7,palette=[0xf1df9d,0xe8e1cc,0xcc9eaa]){
  radius=Number.isFinite(radius)?Math.max(.1,Math.min(2,radius)):.42;
  count=Number.isFinite(count)?Math.max(1,Math.min(16,Math.floor(count))):7;
  let parts=createFlowerPatchV154.parts;
  if(!parts){
    const stem=new THREE.CylinderGeometry(.012,.018,1,5),petal=new THREE.SphereGeometry(1,6,4),centre=new THREE.SphereGeometry(1,7,5);
    const green=new THREE.MeshStandardMaterial({color:0x68834b,roughness:1}),bloom=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.94}),heart=new THREE.MeshStandardMaterial({color:0xbfa34f,roughness:1});
    for(const item of [stem,petal,centre,green,bloom,heart])item.userData.sharedSurfaceV153=true;
    parts=createFlowerPatchV154.parts={stem,petal,centre,green,bloom,heart};
  }
  const root=new THREE.Group();root.name='flowersV154';root.userData.foliageKindV154='soft';root.userData.flowerPatchV154=true;
  const stems=new THREE.InstancedMesh(parts.stem,parts.green,count),petals=new THREE.InstancedMesh(parts.petal,parts.bloom,count*8),centres=new THREE.InstancedMesh(parts.centre,parts.heart,count),leaves=new THREE.InstancedMesh(parts.petal,parts.green,count*2);
  const transform=new THREE.Object3D(),color=new THREE.Color();
  function place(mesh,index,x,y,z,sx,sy,sz,yaw=0,tilt=0){transform.position.set(x,y,z);transform.scale.set(sx,sy,sz);transform.rotation.set(tilt,yaw,0);transform.updateMatrix();mesh.setMatrixAt(index,transform.matrix);}
  for(let i=0;i<count;i++){
    const a=i/count*Math.PI*2+.21*(i%2),r=radius*(.28+.11*(i%3)),x=Math.cos(a)*r,z=Math.sin(a)*r,h=.20+.028*(i%3);
    place(stems,i,x,h*.5,z,1,h,1);
    place(centres,i,x,h+.006,z,.035,.021,.035);
    color.setHex(palette[i%palette.length]||0xe8e1cc).lerp(new THREE.Color(0xe8dcc0),.12);
    for(let k=0;k<8;k++){const p=k*Math.PI/4+a;place(petals,i*8+k,x+Math.sin(p)*.051,h,z+Math.cos(p)*.051,.026,.012,.049,p);petals.setColorAt(i*8+k,color);}
    for(let k=0;k<2;k++){const p=a+k*Math.PI;place(leaves,i*2+k,x+Math.sin(p)*.025,h*.44,z+Math.cos(p)*.025,.016,.006,.062,p,.18);}
  }
  for(const mesh of [stems,petals,centres,leaves]){mesh.instanceMatrix.needsUpdate=true;mesh.receiveShadow=true;mesh.castShadow=false;root.add(mesh);}
  return root;
}
function applyTerrainMaterialV154(material){
  if(!material||material.userData.v154Terrain||material.map?.userData?.v152Family!=='grass')return;
  material.userData.v154Terrain=true;
  material.onBeforeCompile=shader=>{
    shader.uniforms.v154SoilMap={value:surfaceTextureV152('dirt')};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 v154TerrainXZ;').replace('#include <begin_vertex>','#include <begin_vertex>\nv154TerrainXZ=(modelMatrix*vec4(transformed,1.0)).xz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 v154TerrainXZ;
      uniform sampler2D v154SoilMap;
      float v154Hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float v154Noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(v154Hash(i),v154Hash(i+vec2(1.0,0.0)),f.x),mix(v154Hash(i+vec2(0.0,1.0)),v154Hash(i+vec2(1.0,1.0)),f.x),f.y);}
    `).replace('#include <map_fragment>',`#include <map_fragment>
      float broad=v154Noise(v154TerrainXZ*.065);
      float wearField=v154Noise(v154TerrainXZ*.27+vec2(13.0,7.0));
      vec3 soil=mapTexelToLinear(texture2D(v154SoilMap,v154TerrainXZ/4.0)).rgb;
      float wear=smoothstep(.60,.91,wearField)*.19;
      diffuseColor.rgb=mix(diffuseColor.rgb,soil*diffuse,wear)*(0.94+0.12*broad);
    `);
  };
  material.customProgramCacheKey=()=> 'terrain-v154';material.needsUpdate=true;
}
function animateFoliageV154(now){
  if(document.hidden)return;
  const state=animateFoliageV154.state||(animateFoliageV154.state={last:now,roots:[],count:-1,bases:new WeakMap()});
  if(state.count!==cameraFoliageRoots.length){state.roots=cameraFoliageRoots.filter(r=>r?.userData?.flowerPatchV154);state.count=cameraFoliageRoots.length;}
  const dt=Math.max(0,Math.min(.05,(now-state.last)/1000));state.last=now;
  const blend=1-Math.exp(-12*dt),limit=VISUAL_MOBILE?40:80;let touched=0;
  for(const root of state.roots){
    if(!root.visible||!root.parent)continue;
    const position=root.getWorldPosition(animateFoliageV154.world||(animateFoliageV154.world=new THREE.Vector3()));
    const dx=player.position.x-position.x,dz=player.position.z-position.z,d=Math.hypot(dx,dz);
    // Plants leaving the budget relax rather than remaining permanently bent.
    const near=d<18&&touched<limit;if(near)touched++;
    let base=state.bases.get(root);if(!base){base={x:root.rotation.x,z:root.rotation.z,y:root.scale.y};state.bases.set(root,base);}
    const press=near?Math.max(0,1-d/1.05):0,wind=near?Math.sin(now*.0016+root.position.x*.41+root.position.z*.23)*.018:0;
    root.rotation.x+=(base.x+wind-press*dz/Math.max(.15,d)*.16-root.rotation.x)*blend;
    root.rotation.z+=(base.z+press*dx/Math.max(.15,d)*.16-root.rotation.z)*blend;
    root.scale.y+=(base.y*(1-press*.23)-root.scale.y)*blend;
  }
}
