/* Six sequential projects reuse paid roads, deliveries, upgrades and the existing save. */
(()=>{
 'use strict';
 const FIRST=10;let focus=null,last=0,signature='';
 const durationBefore=constructionDuration;
 constructionDuration=function(index,level=1,upgrading=false){
   const base=durationBefore.apply(this,arguments);
   return STAGES[index]?.expansionV159?base*(upgrading?1.65+(index-FIRST)*.15:2.6+(index-FIRST)*.25):base;
 };
 const descriptions={ru:[
   'Увеличивает склады: каждый готовый уровень даёт +16 бетона и +12 металла.',
   'Новый источник дохода. Четыре модернизации увеличивают прибыль и масштаб здания.',
   'Крупный коммерческий объект: потребуется несколько поставок всех трёх материалов.',
   'Промышленный объект с крупным заказом бетона и металла. Развивай логистику до стройки.',
   'Перед строительством проверь вместимость складов: материалы оплачиваются при запуске.',
   'Финальная стройка новой главы. Для престижа нужны все 16 готовых объектов и 6 уровней программ развития.'
 ],en:[
   'Each completed level adds storage for 16 concrete and 12 steel.',
   'A new income source. Four upgrades increase profit and building scale.',
   'A major commercial project with multiple deliveries of all three materials.',
   'An industrial project with a large concrete and steel order. Develop logistics first.',
   'Check storage capacity before starting: materials are paid at construction launch.',
   'The final project of this chapter. Prestige requires all 16 completed projects and 6 development levels.'
 ]};
 function occupied(){const a=window.__TYCOON_V123__;return carriedLogs>0||!!window.__TYCOON_START_CARRY__?.()||Number(a?.state?.carry?.amount||0)>0||!!a?.work?.()||!!a?.session?.active;}
 function target(){
   if(!focus||occupied())return null;
   const b=buildings.find(x=>x.index===focus.index);
   let pos=null;
   if(focus.kind==='build'&&focus.index===stageIndex&&!b)pos=stagePosition(focus.index);
   if(focus.kind==='upgrade'&&b&&!b.underConstruction&&b.level<MAX_BUILDING_LEVEL)pos=b.upgradePad?.pos;
   if(!pos){focus=null;return null;}
   if(player.position.distanceTo(pos)<2.2){focus=null;return null;}
   return {pos:pos.clone(),label:stageName(STAGES[focus.index]),type:'expansion'};
 }
 function locate(index,kind){
   if(!Number.isInteger(index)||index<FIRST||index>=STAGES.length||occupied())return false;
   const b=buildings.find(x=>x.index===index);
   if(kind==='build'&&(index!==stageIndex||b))return false;
   if(kind==='upgrade'&&(!b||b.underConstruction||b.level>=MAX_BUILDING_LEVEL||!b.upgradePad?.pos))return false;
   if(!['build','upgrade'].includes(kind))return false;
   window.__TYCOON_V158__?.choose?.('auto');focus={index,kind};
   document.getElementById('systemsOverlay')?.classList.remove('show','v158-work-mode');document.getElementById('fleetClose')?.click();window.requestLayoutV46?.();return true;
 }
 const guideBefore=currentGuidanceTarget;
 currentGuidanceTarget=function(){return target()||guideBefore.apply(this,arguments);};
 const navBefore=window.__TYCOON_MANUAL_NAV__;
 window.__TYCOON_MANUAL_NAV__=function(){return target()?null:navBefore?.apply(this,arguments)||null;};
 const resetBefore=resetRunOperationsV302;
 resetRunOperationsV302=function(){focus=null;signature='';return resetBefore.apply(this,arguments);};
 function snapshot(){return STAGES.slice(FIRST).map((s,n)=>{
   const index=FIRST+n,b=buildings.find(x=>x.index===index),build=growingMeshes.find(x=>x.entry===b);
   const status=b?(b.underConstruction?'building':b.level>=MAX_BUILDING_LEVEL?'max':'built'):index===stageIndex?'next':'locked';
   const level=b?.level||0,price=stageResourceCost(index,status==='built'?level:null);
   return {index,status,level,price,name:stageName(s),income:buildingIncome(index,Math.max(1,level)),nextIncome:level<MAX_BUILDING_LEVEL?buildingIncome(index,Math.max(1,level+1)):null,progress:build?Math.min(1,build.timer/Math.max(.1,build.duration)):null,capacity:status==='next'?{concrete:concreteCapacity(),metal:metalCapacity()}:null};
 });}
 function render(force=false){
   const desk=document.getElementById('systemsOverlay')?.classList.contains('v158-work-mode');
   const grid=document.getElementById(desk?'workdayGridV158':'fleetGrid');if(!grid)return;
   const rows=snapshot(),ru=lang==='ru',busy=occupied();
   const sig=JSON.stringify({rows,ru,busy,completed:completedBuildingCount()});
   let panel=document.getElementById('expansionV159');
   if(!force&&signature===sig&&panel?.parentNode===grid)return;signature=sig;
   if(!panel){panel=document.createElement('details');panel.id='expansionV159';panel.open=stageIndex>=FIRST;grid.prepend(panel);}else if(panel.parentNode!==grid)grid.prepend(panel);
   const finished=rows.filter(x=>['built','max'].includes(x.status)).length;
   const titles=ru?{building:'Строится',max:'Максимальный уровень',built:'Готово',next:'Следующий объект',locked:'Позже'}:{building:'Under construction',max:'Maximum level',built:'Completed',next:'Next project',locked:'Later'};
   panel.innerHTML=`<summary>${ru?'Развитие компании':'Company expansion'} <span>${finished}/6</span></summary><p>${ru?'После «Империи» — ещё 6 объектов и 24 модернизации. Строй последовательно и развивай готовые здания.':'After Empire: 6 more projects and 24 upgrades. Build sequentially and upgrade completed projects.'}</p><p>${ru?'Готовый склад':'Storage capacity'}: ${concreteCapacity()} ${ru?'бетона':'concrete'} · ${metalCapacity()} ${ru?'металла':'steel'}</p><div class="v159-projects">${rows.map((x,n)=>{
     const active=['next','built'].includes(x.status),cap=x.capacity,short=cap&&(x.price.concrete>cap.concrete||x.price.metal>cap.metal);
     return `<article class="v159-project ${x.status}"><div class="v159-title"><b>${x.index+1}. ${x.name}</b><span>${titles[x.status]}${x.level?` · ${x.level}/${MAX_BUILDING_LEVEL}`:''}</span></div><p>${descriptions[ru?'ru':'en'][n]}</p><p>${ru?'Базовый доход':'Base income'}: ${fmt(x.income)}/${ru?'с':'s'}${x.status==='built'?` · ${ru?'после улучшения':'after upgrade'} ${fmt(x.nextIncome)}/${ru?'с':'s'}`:''}</p>${active?`<p>${x.status==='built'?(ru?'Следующий уровень':'Next level'):(ru?'Строительство':'Construction')}: ${opsCostText(x.price)}</p>`:''}${short?`<p class="v159-warning">${ru?'Сначала модернизируй склад или терминал: заказ превышает вместимость.':'Upgrade a warehouse or the terminal first: this order exceeds storage capacity.'}</p>`:''}${x.progress!==null?`<progress max="1" value="${x.progress}" aria-label="${ru?'Прогресс строительства':'Construction progress'}"></progress>`:''}${active?`<button class="v30Btn primary" type="button" data-v159-index="${x.index}" data-v159-kind="${x.status==='built'?'upgrade':'build'}" ${busy?'disabled':''}>${ru?'Показать площадку':'Locate plot'}</button>`:''}</article>`;
   }).join('')}</div>`;
   panel.querySelectorAll('[data-v159-index]').forEach(b=>b.addEventListener('click',()=>locate(Number(b.dataset.v159Index),b.dataset.v159Kind)));
 }
 function tick(now){if(document.hidden||now-last<750)return;if(typeof panelBusyV161==='function'&&panelBusyV161(performance.now()))return;last=now;if(document.getElementById('systemsOverlay')?.classList.contains('v158-work-mode')||document.getElementById('fleetOverlay')?.classList.contains('show'))render();}
 window.__TYCOON_VISUAL_TICKS__.push(tick);
 const workday=window.__TYCOON_V158__;if(workday){const openBefore=workday.open;workday.open=function(){const r=openBefore.apply(this,arguments);render(true);return r;};}
 // The menu listener was bound before this extension, so add the board after that handler.
 document.getElementById('openWorkdayV158')?.addEventListener('click',()=>render(true));
 window.__TYCOON_V159__={version:'v159-city-expansion',locate,target,snapshot,render,audit(){return {projects:STAGES.length,added:STAGES.filter(x=>x.expansionV159).length,upgradeSteps:STAGES.filter(x=>x.expansionV159).length*(MAX_BUILDING_LEVEL-1),focused:focus};}};
})();
