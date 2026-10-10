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
    const candidates=[],accepted=[],limit=VISUAL_MOBILE?4:6;
    const target=typeof currentGuidanceTarget==='function'?currentGuidanceTarget()?.pos:null;
    for(const label of labels){
      const wasSelected=!!label.userData.v163Selected,mainGoal=!!label.userData.v163MainGoal;
      label.userData.v163TargetOpacity=0;label.userData.v163Selected=false;
      let visible=label.visible;
      for(let p=label.parent;p&&visible;p=p.parent)visible=p.visible;
      if(!visible)continue;
      label.getWorldPosition(world);const distance=world.distanceTo(player.position);
      point.copy(world).project(camera);
      const m=label.material;
      if(!m.userData)m.userData={};
      if(m.userData.v152BaseOpacity===undefined)m.userData.v152BaseOpacity=m.opacity;
      if((!mainGoal&&distance>(VISUAL_MOBILE?24:36)+(wasSelected?2:0))||point.z<-1||point.z>1||Math.abs(point.x)>1||Math.abs(point.y)>1)continue;
      const cameraDistance=world.distanceTo(camera.position);
      const pixels=innerHeight/(2*Math.tan(camera.fov*Math.PI/360)*Math.max(.1,cameraDistance));
      const base=label.userData.v157LabelScale||(label.userData.v157LabelScale=label.scale.clone());
      let zoom=mainGoal||distance<9?THREE.MathUtils.clamp(104/(base.x*pixels),1,mainGoal?5:label.userData.padPlateV161?3.2:2):1;
      // v161 QA: a zoomed plate is at most 60 % of the screen wide (the x3.2 / x5 near zoom made plates wider than the phone) and never zooms past its natural size
      if(label.userData.noZoomV161)zoom=1;else zoom=Math.max(1,Math.min(zoom,.6*innerWidth/(base.x*pixels)));
      label.scale.copy(base).multiplyScalar(zoom);label.getWorldScale(labelScale);
      const priority=mainGoal?-1:label.userData.padPlateV161||(target&&Math.hypot(world.x-target.x,world.z-target.z)<2.6)?0:1;
      const cx=(point.x+1)*innerWidth/2,cy=(1-point.y)*innerHeight/2,cw=labelScale.x*pixels+12,ch=labelScale.y*pixels+10;
      // v161 QA: a plate is drawn whole or not at all: its screen rectangle must lie inside the viewport (it used to be cut by the screen edge: only the centre was tested)
      if(cx-cw/2<2||cx+cw/2>innerWidth-2||cy-ch/2<2||cy+ch/2>innerHeight-2)continue;
      if(hudBlocked(cx,cy,cw,ch))continue;
      candidates.push({label,distance,priority,score:distance-(wasSelected?2.5:0),mainGoal,x:cx,y:cy,w:cw,h:ch});
    }
    candidates.sort((a,b)=>a.priority-b.priority||a.score-b.score);
    let regularCount=0;
    for(const c of candidates){
      if(!c.mainGoal&&regularCount>=limit)continue;
      if(accepted.some(a=>Math.abs(a.x-c.x)<(a.w+c.w)/2&&Math.abs(a.y-c.y)<(a.h+c.h)/2))continue;
      c.label.userData.v163TargetOpacity=c.label.material.userData.v152BaseOpacity;
      c.label.userData.v163Selected=true;accepted.push(c);if(!c.mainGoal)regularCount++;
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
