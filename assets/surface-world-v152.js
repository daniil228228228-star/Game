/* Apply dimension-aware surface UVs to the scene and newly built objects. */
(()=>{
  'use strict';
  const visited=new WeakSet(),geometryCache=new WeakMap(),scale=new THREE.Vector3();let last=0;
  let labels=[],labelLast=0;const point=new THREE.Vector3(),world=new THREE.Vector3(),labelScale=new THREE.Vector3(),camDir=new THREE.Vector3();
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
      o.getWorldScale(scale);
      // v161 textures: a building under construction / upgrade is created at scale (0.94, 0.08, 0.94), hidden, and reaches (1,1,1) only when it is finished (growingMeshes).
      // UVs baked with that transient scale were stretched 12x in v for the whole life of the building (siding lines gone, brick courses smeared), so the entry mesh's own
      // scale is divided out: the UVs are those of the finished building.
      if(typeof growingMeshes!=='undefined'&&growingMeshes.length)for(let p=o;p;p=p.parent)if(growingMeshes.some(g=>g&&g.mesh===p)){scale.x/=p.scale.x||1;scale.y/=p.scale.y||1;scale.z/=p.scale.z||1;break;}
      const original=o.geometry;
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
  // v161 feel: a plate never sits under the top HUD (stat chips, top-right buttons, goal card): those rects are read at the layout tick (5 Hz) and such labels stay at opacity 0
  const hudIds=['hud','topRightBtns','actionPrompt','actionBtn','carryRouteV139','nextCard'],hudRects=[];
  let labelFadeLastV163=0;
  function fadeWorldLabelsV163(now){
    const dt=Math.min(.1,Math.max(0,(now-(labelFadeLastV163||now-33))/1000));labelFadeLastV163=now;
    const k=1-Math.exp(-dt*14);
    for(const label of labels){const m=label.material;if(!m)continue;const goal=label.userData.v163TargetOpacity||0;
      m.opacity+=(goal-m.opacity)*k;if(Math.abs(goal-m.opacity)<.002)m.opacity=goal;
    }
  }
  function hudBlocked(x,y,w,h){
    for(let i=0;i<hudRects.length;i++){const r=hudRects[i];if(Math.abs(x-r.x)<(w+r.w)/2&&Math.abs(y-r.y)<(h+r.h)/2)return true;}
    return false;
  }
  function labelLayout(now){
    if(document.hidden||now-labelLast<180)return;labelLast=now;
    // v161 feel: plates created since the last scan (opacity 0 until accepted here) join the list at once instead of waiting for the next 1.5 s scene scan
    const pend=window.__v152PendingLabels;
    if(pend&&pend.length){
      for(let i=pend.length-1;i>=0;i--){let o=pend[i];while(o.parent)o=o.parent;if(o===scene){if(!labels.includes(pend[i]))labels.push(pend[i]);pend.splice(i,1);}else if(pend.length>300)pend.splice(i,1);}
    }
    hudRects.length=0;
    for(const id of hudIds){const el=document.getElementById(id);if(!el||el.hidden)continue;const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<.02)continue;const r=el.getBoundingClientRect();if(r.width>1&&r.height>1)hudRects.push({x:(r.left+r.right)/2,y:(r.top+r.bottom)/2,w:r.width,h:r.height});}
    // v161 plates redesign (2026-10-11): plates are pills drawn ON TOP of the geometry (assets/plates-v161.js), so layout is the only thing that limits them: at most 4 in total (the goal
    // plate included), none beyond 24 m (36 desktop), none for a target behind the camera, a screen width clamped to [84..45 % of the viewport] px (never bigger than the phone allows, never
    // too small to read), each drawn whole or not at all, priority goal > the nearest pad > buildings; the last 30 % of the range fades out.
    const candidates=[],accepted=[],limit=PlatesV161.MAX_VISIBLE;
    const target=typeof currentGuidanceTarget==='function'?currentGuidanceTarget()?.pos:null;
    camera.getWorldDirection(camDir);
    const minW=VISUAL_MOBILE?84:96,maxW=Math.min(.45*innerWidth,VISUAL_MOBILE?200:260),range=VISUAL_MOBILE?24:36;
    for(const label of labels){
      const wasSelected=!!label.userData.v163Selected,mainGoal=!!label.userData.v163MainGoal;
      label.userData.v163TargetOpacity=0;label.userData.v163Selected=false;label.userData.v161Rect=null;
      let visible=label.visible;
      for(let p=label.parent;p&&visible;p=p.parent)visible=p.visible;
      if(!visible)continue;
      label.getWorldPosition(world);const distance=world.distanceTo(player.position);
      const reach=range+(wasSelected?2:0);
      if(!mainGoal&&distance>reach)continue;
      // behind the camera (or nearly beside it): projecting such a point is meaningless
      if((world.x-camera.position.x)*camDir.x+(world.y-camera.position.y)*camDir.y+(world.z-camera.position.z)*camDir.z<.5)continue;
      point.copy(world).project(camera);
      const m=label.material;
      if(!m.userData)m.userData={};
      if(m.userData.v152BaseOpacity===undefined)m.userData.v152BaseOpacity=m.opacity;
      if(point.z<-1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1)continue;
      const cameraDistance=world.distanceTo(camera.position);
      const pixels=innerHeight/(2*Math.tan(camera.fov*Math.PI/360)*Math.max(.1,cameraDistance));
      const base=label.userData.v157LabelScale||(label.userData.v157LabelScale=label.scale.clone());
      const natural=Math.max(1,base.x*pixels);
      const wpx=THREE.MathUtils.clamp(natural,mainGoal?Math.max(minW,Math.min(130,maxW)):minW,maxW);
      const zoom=THREE.MathUtils.clamp(wpx/natural,.15,8);
      label.scale.copy(base).multiplyScalar(zoom);label.getWorldScale(labelScale);
      const priority=mainGoal?-1:label.userData.padPlateV161||(target&&Math.hypot(world.x-target.x,world.z-target.z)<2.6)?0:1;
      const cx=(point.x+1)*innerWidth/2,cy=(1-point.y)*innerHeight/2,cw=labelScale.x*pixels+6,ch=labelScale.y*pixels+6;
      // a plate is drawn whole or not at all: its screen rectangle must lie inside the viewport
      if(cx-cw/2<2||cx+cw/2>innerWidth-2||cy-ch/2<2||cy+ch/2>innerHeight-2)continue;
      if(hudBlocked(cx,cy,cw,ch))continue;
      const fade=distance<=range*.7||mainGoal?1:Math.max(.3,1-(distance-range*.7)/(range*.3+2));
      candidates.push({label,distance,priority,fade,score:distance-(wasSelected?2.5:0),mainGoal,x:cx,y:cy,w:cw,h:ch});
    }
    candidates.sort((a,b)=>a.priority-b.priority||a.score-b.score);
    for(const c of candidates){
      if(accepted.length>=limit)break;
      if(accepted.some(a=>Math.abs(a.x-c.x)<(a.w+c.w)/2&&Math.abs(a.y-c.y)<(a.h+c.h)/2))continue;
      c.label.userData.v163TargetOpacity=c.label.material.userData.v152BaseOpacity*c.fade;
      c.label.userData.v163Selected=true;c.label.userData.v161Rect={x:c.x,y:c.y,w:c.w,h:c.h};accepted.push(c);
    }
    surfaceRuntimeV152.visibleLabels=accepted.length;
  }
  scan(performance.now(),true);
  window.__TYCOON_VISUAL_TICKS__.push(now=>{scan(now);labelLayout(now);fadeWorldLabelsV163(now);if(typeof animateFoliageV154==='function')animateFoliageV154(now);});
  window.__TYCOON_V152__={version:'v152-surfaces-lighting',runtime:surfaceRuntimeV152,
    audit(){return {version:this.version,ok:surfaceRuntimeV152.loadErrors.length===0,
      surfaces:Object.keys(SURFACES_V152).length,textures:surfaceCacheV152.size,
      renderer:renderer.info?.render,geometryCount:renderer.info?.memory?.geometries,
      shadowSize:sun.shadow.mapSize.x,...surfaceRuntimeV152};}};
})();
