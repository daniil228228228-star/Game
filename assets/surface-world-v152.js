/* Apply dimension-aware surface UVs to the scene and newly built objects. */
(()=>{
  'use strict';
  const visited=new WeakSet(),geometryCache=new WeakMap(),scale=new THREE.Vector3();let last=0;
  let labels=[],labelLast=0;const point=new THREE.Vector3(),world=new THREE.Vector3(),labelScale=new THREE.Vector3();
  function scan(now,force=false){
    if(!force&&(document.hidden||now-last<1500))return;
    last=now;scene.updateMatrixWorld(true);const retired=new Set();labels=[];
    scene.traverse(o=>{
      if(o.userData?.v152WorldLabel)labels.push(o);
      if(!o.isMesh||visited.has(o)||Array.isArray(o.material))return;
      const m=o.material,family=m?.map?.userData?.v152Family;
      if(!family)return;
      visited.add(o);
      // Preserve animated/deformed UVs and the canonical road style owner.
      if(o.isSkinnedMesh||o.isInstancedMesh||o.geometry?.isInstancedBufferGeometry)return;
      o.getWorldScale(scale);const original=o.geometry;
      let variants=geometryCache.get(original);
      if(!variants){variants=new Map();geometryCache.set(original,variants);}
      const key=family+':'+[scale.x,scale.y,scale.z].join(':');
      let g=variants.get(key);
      if(!g){
        g=original.type==='BufferGeometry'&&original.index?original.toNonIndexed():original.clone();
        if(original.type==='BufferGeometry')g.computeVertexNormals();
        if(!surfaceUVV152(g,family,scale)){g.dispose();return;}variants.set(key,g);
      }
      o.geometry=g;
      retired.add(original);
      m.bumpMap=family==='grass'?null:surfaceTextureV152(family,'height');
      m.roughnessMap=family==='grass'?null:surfaceTextureV152(family,'roughness'); // v161: grass roughness is flat 0.97 (std 2/255); one sampler less, no extra aliasing channel
      m.bumpScale=SURFACES_V152[family].bump;
      m.roughness=1;m.needsUpdate=true;
      if(typeof applyTerrainMaterialV154==='function')applyTerrainMaterialV154(m);
      surfaceRuntimeV152.uvMeshes++;
    });
    if(retired.size){const used=new Set();scene.traverse(o=>{if(o.geometry)used.add(o.geometry);});for(const g of retired)if(!used.has(g))g.dispose();}
  }
  function labelLayout(now){
    if(document.hidden||now-labelLast<180)return;labelLast=now;
    const candidates=[],accepted=[],limit=VISUAL_MOBILE?4:6;
    const target=typeof currentGuidanceTarget==='function'?currentGuidanceTarget()?.pos:null;
    for(const label of labels){
      let visible=label.visible;
      for(let p=label.parent;p&&visible;p=p.parent)visible=p.visible;
      if(!visible)continue;
      label.getWorldPosition(world);const distance=world.distanceTo(player.position);
      point.copy(world).project(camera);
      const m=label.material;
      if(!m.userData)m.userData={};
      if(m.userData.v152BaseOpacity===undefined)m.userData.v152BaseOpacity=m.opacity;
      m.opacity=0;
      if(distance>(VISUAL_MOBILE?24:36)||point.z<-1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1)continue;
      const cameraDistance=world.distanceTo(camera.position);
      const pixels=innerHeight/(2*Math.tan(camera.fov*Math.PI/360)*Math.max(.1,cameraDistance));
      const base=label.userData.v157LabelScale||(label.userData.v157LabelScale=label.scale.clone());
      const zoom=distance<9?THREE.MathUtils.clamp(104/(base.x*pixels),1,2):1;
      label.scale.copy(base).multiplyScalar(zoom);label.getWorldScale(labelScale);
      const priority=target&&Math.hypot(world.x-target.x,world.z-target.z)<2.6?0:1;
      candidates.push({label,distance,priority,x:(point.x+1)*innerWidth/2,y:(1-point.y)*innerHeight/2,
        w:labelScale.x*pixels+12,h:labelScale.y*pixels+10});
    }
    candidates.sort((a,b)=>a.priority-b.priority||a.distance-b.distance);
    for(const c of candidates){
      if(accepted.length>=limit)break;
      if(accepted.some(a=>Math.abs(a.x-c.x)<(a.w+c.w)/2&&Math.abs(a.y-c.y)<(a.h+c.h)/2))continue;
      c.label.material.opacity=c.label.material.userData.v152BaseOpacity;accepted.push(c);
    }
    surfaceRuntimeV152.visibleLabels=accepted.length;
  }
  scan(performance.now(),true);
  window.__TYCOON_VISUAL_TICKS__.push(now=>{scan(now);labelLayout(now);if(typeof animateFoliageV154==='function')animateFoliageV154(now);});
  window.__TYCOON_V152__={version:'v152-surfaces-lighting',runtime:surfaceRuntimeV152,
    audit(){return {version:this.version,ok:surfaceRuntimeV152.loadErrors.length===0,
      surfaces:Object.keys(SURFACES_V152).length,textures:surfaceCacheV152.size,
      renderer:renderer.info?.render,geometryCount:renderer.info?.memory?.geometries,
      shadowSize:sun.shadow.mapSize.x,...surfaceRuntimeV152};}};
})();
