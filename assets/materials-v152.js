/* Shared surface ownership for Three r128. No economy or save state. */
'use strict';
const SURFACES_V152 = {
  grass:{tile:4,roughness:1,bump:0},dirt:{tile:4,roughness:1,bump:.025},
  asphalt:{tile:4,roughness:1,bump:.025},concrete:{tile:4,roughness:1,bump:.035},
  metal:{tile:2,roughness:1,bump:.009,metalness:.48},
  corrugated:{tile:2.4,roughness:1,bump:.09,metalness:.28},
  wood:{tile:2,roughness:1,bump:.045},'wood-end':{tile:.45,roughness:1,bump:.025},
  brick:{tile:2.4,roughness:1,bump:.075},roof:{tile:3.2,roughness:1,bump:.065},
  siding:{tile:2.4,roughness:1,bump:.05}
};
const surfaceCacheV152 = new Map();
const surfaceRuntimeV152 = {loadErrors:[],uvMeshes:0,quality:'',lightingFrames:0};
const logCapGeometryV152=new Map();let logCapMaterialV152=null;
function surfaceTextureV152(family, kind='albedo') {
  if (!SURFACES_V152[family]) family='concrete';
  const key=family+':'+kind;
  if (surfaceCacheV152.has(key)) return surfaceCacheV152.get(key);
  const file=kind==='albedo'?family+'.jpg':family+(kind==='height'?'-height.png':'-roughness.jpg');
  const texture=new THREE.TextureLoader().load('assets/'+file,undefined,undefined,()=>{
    if(!surfaceRuntimeV152.loadErrors.includes(file)) surfaceRuntimeV152.loadErrors.push(file);
    console.error('Surface texture failed to load:',file);
  });
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
  texture.encoding=kind==='albedo'?THREE.sRGBEncoding:THREE.LinearEncoding;
  texture.anisotropy=8; // v161: 4 -> 8 (applySceneLightingV152 re-applies the quality tier below)
  texture.userData={v152Family:family,v152Kind:kind};
  surfaceCacheV152.set(key,texture);
  return texture;
}
function createSurfaceMaterialV152(family,color=0xffffff,opts={}) {
  const recipe=SURFACES_V152[family]||SURFACES_V152.concrete;
  const material=new THREE.MeshStandardMaterial({
    color,map:surfaceTextureV152(family),bumpMap:surfaceTextureV152(family,'height'),
    roughnessMap:surfaceTextureV152(family,'roughness'),roughness:recipe.roughness,
    bumpScale:recipe.bump,metalness:recipe.metalness||0,...opts
  });
  material.userData.v152Family=family;
  return material;
}
function finishLogV152(log) {
  const p=log.geometry?.parameters;if(!p||log.userData.v152LogCaps)return log;
  log.userData.v152LogCaps=true;
  if(!logCapMaterialV152){logCapMaterialV152=createSurfaceMaterialV152('wood-end');logCapMaterialV152.userData.sharedSurfaceV153=true;}
  for(const side of [-1,1]){
    const radius=side>0?p.radiusTop:p.radiusBottom,key=radius+':'+p.radialSegments;
    let geometry=logCapGeometryV152.get(key);
    if(!geometry){geometry=new THREE.CircleGeometry(radius*.995,p.radialSegments);geometry.userData.sharedSurfaceV153=true;logCapGeometryV152.set(key,geometry);}
    const cap=new THREE.Mesh(geometry,logCapMaterialV152);
    cap.name='logEndGrainV152';cap.rotation.x=side>0?-Math.PI/2:Math.PI/2;
    cap.position.y=side*(p.height/2+.001);log.add(cap);
  }
  return log;
}
function surfaceUVV152(geometry,family,scale) {
  const pos=geometry?.attributes?.position,norm=geometry?.attributes?.normal;
  if(!pos||!norm||!SURFACES_V152[family]) return false;
  const uv=new Float32Array(pos.count*2),tile=SURFACES_V152[family].tile;
  const cylindrical=geometry.type==='CylinderGeometry',previousUV=geometry.attributes.uv;
  for(let i=0;i<pos.count;i++) {
    const nx=Math.abs(norm.getX(i)),ny=Math.abs(norm.getY(i)),nz=Math.abs(norm.getZ(i));
    const x=pos.getX(i)*scale.x,y=pos.getY(i)*scale.y,z=pos.getZ(i)*scale.z;
    let u,v;
    if(cylindrical&&ny<.99&&previousUV){
      const r=Math.max(geometry.parameters.radiusTop,geometry.parameters.radiusBottom);
      u=previousUV.getX(i)*2*Math.PI*r*Math.max(scale.x,scale.z);
      v=y;
    }
    else if(ny>=nx&&ny>=nz){u=x;v=z;}
    else if(nx>nz){u=z;v=y;}
    else {u=x;v=y;}
    // PlaneGeometry lives in XY before rotation; its normal chooses XY above.
    uv[i*2]=u/tile+(family==='wood-end'?.5:0);uv[i*2+1]=v/tile+(family==='wood-end'?.5:0);
  }
  geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  return true;
}
function lightingProfileV152(day,weather='clear') {
  day=Number.isFinite(day)?THREE.MathUtils.clamp(day,0,1):1;
  const w={clear:[1,1,1,210],cloudy:[.72,1.03,.98,175],rain:[.48,.94,.94,128],fog:[.58,.96,.98,90]}[weather]||[1,1,1,210];
  return {day,sun:(.06+day*1.55)*w[0],hemi:(.38+day*.76)*w[1],
    fill:.12+day*.12,rim:.10+day*.18,exposure:(.94+day*.10)*w[2],
    near:weather==='fog'?22:42,far:Math.min(130+day*80,w[3])};
}
let lightingLastV152=0,lightingWeatherV152=null;
function applySceneLightingV152() {
  const day=daylightV40(),weather=weatherDefV40().key,target=lightingProfileV152(day,weather);
  const now=performance.now(),delta=Math.max(0,Math.min(.1,(now-lightingLastV152)/1000));
  lightingLastV152=now;
  if(!lightingWeatherV152)lightingWeatherV152={...target};
  const k=1-Math.exp(-delta*1.5);
  for(const key of ['sun','hemi','exposure','near','far'])lightingWeatherV152[key]+=(target[key]-lightingWeatherV152[key])*k;
  sun.intensity=lightingWeatherV152.sun;hemi.intensity=lightingWeatherV152.hemi;
  fillLight.intensity=target.fill;rimLight.intensity=target.rim;
  renderer.toneMappingExposure=lightingWeatherV152.exposure;
  sun.color.set(day>.4?0xfff0d4:0xffcaa0);
  if(scene.fog){scene.fog.near=lightingWeatherV152.near;scene.fog.far=lightingWeatherV152.far;}
  const q=document.body.classList.contains('v51-perf-low')?'low':document.body.classList.contains('v51-perf-mid')?'mid':'high';
  if(surfaceRuntimeV152.quality!==q){
    surfaceRuntimeV152.quality=q;
    const size=q==='low'?512:(VISUAL_MOBILE||q==='mid'?1024:2048);
    if(sun.shadow.mapSize.x!==size){sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.mapSize.set(size,size);sun.shadow.needsUpdate=true;}
    const aniso=Math.min(q==='low'?2:q==='mid'?4:8,renderer.capabilities.getMaxAnisotropy()); // v161: high tier 8 on phones too (was 4): oblique grass/road no longer aliases
    for(const texture of surfaceCacheV152.values()){texture.anisotropy=aniso;texture.needsUpdate=true;}
  }
  surfaceRuntimeV152.lightingFrames++;
}
