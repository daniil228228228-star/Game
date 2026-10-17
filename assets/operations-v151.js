/* Road planning within the existing fleet screen; no extra save schema. */
(()=>{
  'use strict';
  const VERSION='v151-roads-input-and-transport';
  let chosenRoad=null,lastSignature='',lastCheck=0;
  const runtime={renders:0,selections:0,errors:[]};
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api=()=>window.__TYCOON_V123__;
  const plans=()=>api()?.roads?.()||[];
  const busy=()=>carriedLogs>0||Number(api()?.state?.carry?.amount||0)>0||!!api()?.work?.()||!!window.__TYCOON_START_CARRY__?.();
  function select(index){
    if(busy()||!plans().some(x=>x.index===index))return false;
    chosenRoad=index;runtime.selections++;document.getElementById('fleetClose')?.click();
    toast(lang==='ru'?'📍 Направляйся к концу оплаченной дороги':'📍 Go to the end of the paid road');return true;
  }
  function target(){
    if(chosenRoad===null||busy())return null;
    const job=api()?.roadTarget?.(chosenRoad);if(!job){chosenRoad=null;return null;}
    const p=job.pos;if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z))return null;
    return {pos:p.clone(),label:lang==='ru'?`Дорога: ${job.name}`:`Road: ${job.name}`,type:'road'};
  }
  const guidanceBefore=currentGuidanceTarget;
  currentGuidanceTarget=function(){return target()||guidanceBefore.apply(this,arguments);};
  const navBefore=window.__TYCOON_MANUAL_NAV__;
  window.__TYCOON_MANUAL_NAV__=function(){return target()?null:(typeof navBefore==='function'?navBefore.apply(this,arguments):null);};
  // An explicit material-route choice takes compass ownership back from road planning.
  function installRouteOwnership(){
    const a=api();if(!a||a.selectOrder.__v151)return;
    const previous=a.selectOrder;a.selectOrder=function(){const result=previous.apply(this,arguments);if(result)chosenRoad=null;return result;};a.selectOrder.__v151=true;
  }
  function render(force=false){
    installRouteOwnership();const grid=document.getElementById('fleetGrid');if(!grid||!api()?.roads)return;
    const list=plans(),ru=lang==='ru',blocked=busy(),crew=!!api()?.state?.owned?.roadCrew;
    const signature=JSON.stringify({list,ru,blocked,crew,chosenRoad});let panel=document.getElementById('roadPlanV151');
    if(!force&&panel&&signature===lastSignature)return;lastSignature=signature;
    if(!panel){panel=document.createElement('section');panel.id='roadPlanV151';grid.appendChild(panel);}
    panel.innerHTML=`<div class="v151-plan-head"><h3>${ru?'Дороги и бюджет':'Roads and budget'}</h3><span>${crew?(ru?'Каток куплен':'Roller owned'):(ru?'Ручная укладка':'Manual paving')}</span></div><p>${ru?'Каждый участок оплачивается отдельно. Выбери дорогу, чтобы найти конец готового асфальта.':'Every section has its own price. Choose a road to find the end of the paved asphalt.'}</p>${list.length?list.map(x=>`<article class="v151-road ${chosenRoad===x.index?'selected':''}"><div><b>${escape(x.name)}</b><span>${x.metres} / ${x.length} ${ru?'м':'m'} · ${x.built}/${x.total} ${ru?'участков':'sections'}</span><div class="v151-road-progress"><i style="width:${Math.max(0,Math.min(100,x.built/Math.max(1,x.total)*100))}%"></i></div></div><div class="v151-road-price"><b>${x.nextCost} 💰</b><span>${ru?'следующий участок':'next section'}</span><small>${ru?'До завершения':'To finish'}: ${x.remainingCost} 💰</small></div><button type="button" data-v151-road="${x.index}" ${blocked?'disabled':''}>${ru?'К дороге':'Find road'}</button>${!x.affordable?`<small class="v151-funds">${ru?'На следующий участок пока не хватает денег':'Not enough money for the next section yet'}</small>`:''}</article>`).join(''):`<div class="v151-empty">${ru?'Все дороги к текущим объектам оплачены.':'Roads to all current projects are paid for.'}</div>`}`;
    panel.querySelectorAll('[data-v151-road]').forEach(btn=>btn.addEventListener('click',()=>select(Number(btn.dataset.v151Road))));runtime.renders++;
  }
  const fleetBefore=renderFleetPanel;
  renderFleetPanel=function(){const result=fleetBefore.apply(this,arguments);render(true);return result;};
  const resetBefore=resetRunOperationsV302;
  resetRunOperationsV302=function(){chosenRoad=null;lastSignature='';return resetBefore.apply(this,arguments);};
  function tick(now){if(document.hidden||now-lastCheck<700)return;lastCheck=now;installRouteOwnership();if(document.getElementById('fleetOverlay')?.classList.contains('show'))try{render();}catch(error){if(runtime.errors.length<10)runtime.errors.push(String(error.message));}}
  window.__TYCOON_VISUAL_TICKS__.push(tick);
  window.__TYCOON_V151__={version:VERSION,runtime,plans,select,target,render,audit(){
    const list=plans(),prior=window.__TYCOON_V150__?.audit?.(),checks={roadApi:typeof api()?.roads==='function',roadNumbers:list.every(x=>[x.built,x.total,x.metres,x.length,x.nextCost,x.remainingCost].every(Number.isFinite)&&x.built>=0&&x.built<=x.total&&x.nextCost>0&&x.remainingCost>=x.nextCost),lifecycleReset:typeof resetPlayInputV151==='function',vehicleReconcile:typeof reconcileVehicleAssignmentV151==='function',priorChecks:prior?.ok!==false,noErrors:runtime.errors.length===0};return {version:VERSION,ok:Object.values(checks).every(Boolean),checks,roads:list.length,selected:chosenRoad,runtime:{...runtime},prior};
  }};
})();
