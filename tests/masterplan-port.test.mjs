// Real DOM actions, movement boundary, real geometry/registry and core-save reload.
import {openGame,reloadGame,check,waitForState,OLD_SAVE} from './lib/harness.mjs';
const g=await openGame({save:'clear',waitMs:5000}),page=g.page;
const ev=(fn,arg)=>page.evaluate(fn,arg),J=JSON.stringify;
const snapshot=()=>ev(()=>{const ids=[];scene.traverse(o=>{if(o.isMesh&&['v59RoadDeck','v86StageRoad','v66ServiceRoad','v116PersistentRoad'].some(t=>o.userData[t]))ids.push(o.uuid);});return ids.sort();});
try{
  check(await ev(()=>!scene.getObjectByName('mp161Net')&&!industrialPadMarkersV118.has('mp161-B01')&&!industrialPadMarkersV118.has('mp161-B02')),'fresh game: no port geometry or pads');
  const early=await ev(()=>{money=1e6;const before=money;return {ok:buildIndustrialStepV118(industrialStepV118('mp161-B01')),spent:before-money};});
  check(!early.ok&&early.spent===0,'early gate cannot charge or build');
  const gate=await ev(()=>{stageIndex=4;checkCompanyTierRewards();refreshIndustrialPadMarkersV118();const noRing=!industrialPadMarkersV118.has('mp161-B01');CITY_DISTRICTS.forEach((c,i)=>cityState.districtRoads[c.id]={level:i<2?3:1,pendingUntil:0,roadsBuilt:true});window.__TYCOON_ROAD_AUDIT_V59__.syncOuter();refreshIndustrialPadMarkersV118();return {noRing,b1:industrialPadMarkersV118.has('mp161-B01'),b2:industrialPadMarkersV118.has('mp161-B02')};});
  check(gate.noRing&&gate.b1&&!gate.b2,'B01 needs the paid ring; B02 remains locked until B01');
  const base=await snapshot();
  const poor=await ev(()=>{money=349;const step=industrialStepV118('mp161-B01'),before=money;return {ok:buildIndustrialStepV118(step),spent:before-money,root:!!scene.getObjectByName('mp161Net')};});
  check(!poor.ok&&poor.spent===0&&!poor.root,'insufficient money leaves state and scene unchanged');
  async function press(id){
    await ev(id=>{money=1e6;const p=industrialStepV118('mp161-'+id).pos;player.position.copy(p);playerVelocity.set(0,0,0);updateTreeInteraction();},id);
    check(await waitForState(page,id=>{const t=nearestManualTargetV53(),b=document.getElementById('actionBtn'),p=document.getElementById('actionPrompt');return t?.step?.id==='mp161-'+id&&p.classList.contains('show')&&!b.hidden&&!b.disabled&&/Build|Построить/.test(b.textContent);},id,{timeout:20000}),`${id}: visible enabled button owns this pad`);
    const before=await snapshot();
    await ev(id=>{window.__mpTestCharge=null;window.__mpTestOriginalPay=tryPayResources;tryPayResources=function(c){const before=money,r=window.__mpTestOriginalPay(c);if(r&&c.money===industrialStepV118('mp161-'+id).cost.money)window.__mpTestCharge=before-money;return r;};document.getElementById('actionBtn').click();},id);
    await waitForState(page,id=>masterplanStateV161[id],id,{timeout:20000});
    const paid=await ev(id=>{tryPayResources=window.__mpTestOriginalPay;return {charged:window.__mpTestCharge,state:masterplanStateV161[id]};},id);
    check(paid.state&&paid.charged===(id==='B01'?350:750),`${id}: real button purchased once for exact price (${J(paid)})`);
    const after=await snapshot();check(J(before)===J(after),`${id}: purchase preserves old road UUIDs (${before.length} -> ${after.length})`);
  }
  await press('B01');

  check(await ev(()=>industrialPadMarkersV118.has('mp161-B02')&&!industrialPadMarkersV118.has('mp161-B01')),'B01 pad removed; B02 appears at the end of the avenue');
  const movement=await ev(()=>{let p={x:-65,z:13.82};for(let x=-65;x>=-98;x-=.25){const z=-x*20.83/97.99;player.position.set(p.x,0,p.z);const solved=resolvePlayerCircleCollisions(x,z,gatherPhysicsCircles());p=clampPlayerBoundsV161(solved.x,solved.z);}player.position.set(p.x,0,p.z);const outside=clampPlayerBoundsV161(-130,0);return {end:p,outside,allowed:MasterplanV161.access(-110,25)};});
  check(movement.end.x<-97&&!movement.allowed&&movement.outside.x===movement.end.x,'paid avenue is walkable beyond x=-70; unbought pier cannot be entered');
  check(await ev(()=>{player.position.set(-61,0,13);const p=clampPlayerBoundsV161(-50,25);return p.x===-50&&p.z===25;}),'player can leave the paid corridor back into the old city');
  await press('B02');

  const geo=await ev(()=>{const root=scene.getObjectByName('mp161Net'),meshes=[],bad=[],cells=[];root.traverse(o=>{if(!o.isMesh)return;meshes.push(o.name);const a=o.geometry.attributes.position;for(let i=0;i<a.array.length;i++)if(!Number.isFinite(a.array[i]))bad.push(o.name);if(/^mp161_(walk|asphalt)_/.test(o.name)){o.geometry.computeBoundingBox();const size=o.geometry.boundingBox.getSize(new THREE.Vector3());cells.push([size.x,size.z]);}});const guard=[...__TYCOON_V83_COLLISIONS__.registry.values()].filter(c=>c.label==='mp161:guardrail');return {meshes,bad,cells,guard:guard.length,lots:root.getObjectByName('mp161VacantParcels')?.count,access:MasterplanV161.access(-120,30),water:MasterplanV161.access(-150,30)};});
  check(geo.bad.length===0&&geo.cells.every(s=>s[0]<=60.001&&s[1]<=60.001)&&geo.meshes.length<=16,'finite merged surfaces, <=60 m cells, <=16 meshes');
  check(geo.guard===3&&geo.lots===20&&geo.access&&!geo.water,'real guardrails; five vacant parcel outlines; no walking on open water');
  const again=await ev(()=>{const m=money;return {ok:buildIndustrialStepV118(industrialStepV118('mp161-B02')),spent:m-money};});check(!again.ok&&again.spent===0,'repeat action cannot charge twice');
  check(await ev(()=>{const id=scene.getObjectByName('mp161Net').uuid;MasterplanV161.refresh();__TYCOON_V83_COLLISIONS__.rebuild();return scene.getObjectByName('mp161Net').uuid===id&&[...__TYCOON_V83_COLLISIONS__.registry.values()].filter(c=>c.label==='mp161:guardrail').length===3;}),'refresh keeps geometry; collision rebuild retains three guardrails');
  await ev(()=>{player.position.set(-120,0,30);save();});await reloadGame(g,5000);
  check(await ev(()=>masterplanStateV161.B01&&masterplanStateV161.B02&&!!scene.getObjectByName('mp161Net')&&player.position.x<-119),'core save reload retains purchases and player position at the pier');
  if(process.env.SHOT)await page.screenshot({path:process.env.SHOT});
  await ev(()=>{player.position.set(69,0,0);save();});await reloadGame(g,4000);
  check(await ev(()=>masterplanStateV161.B02&&!scene.getObjectByName('mp161Net')),'paid geometry is not created on a far-away reload');
  await ev(()=>{player.position.set(-65,0,14);MasterplanV161.refresh();});
  check(await ev(()=>!!scene.getObjectByName('mp161Net')),'entering the 150 m radius recreates the paid port');
  await ev(()=>{resetRunOperationsV302();save();});await reloadGame(g,4000);
  check(await ev(()=>!masterplanStateV161.B01&&!masterplanStateV161.B02&&!scene.getObjectByName('mp161Net')),'prestige/reset clears expansion state and geometry');
  await ev(({key,data})=>{localStorage.clear();localStorage.setItem(key,JSON.stringify(data));}, {key:'tycoon3d_save_v3',data:OLD_SAVE});await reloadGame(g,4000);
  check(await ev(()=>stageIndex===1&&buildings.length===1&&!masterplanStateV161.B01&&!masterplanStateV161.B02&&!scene.getObjectByName('mp161Net')),'legacy save loads its city without granting free port');
  check(g.errors.length===0,`no console/page errors (${J(g.errors.slice(0,5))})`);check(g.badResponses.length===0,'all assets resolved');
}finally{await g.close();}
