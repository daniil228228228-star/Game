/* Long-term goals are presented in the existing work desk, keeping the play view clear. */
(()=>{
 'use strict';const programme=companyDevelopmentV160;let signature='',last=0;
 const labels={ru:{storage:'Складская система',production:'Производственные процессы',crew:'Строительная бригада'},en:{storage:'Storage network',production:'Production processes',crew:'Construction crew'}};
 function metrics(){const a=window.__TYCOON_V123__?.state,roads=a?.roadStats;return {delivery:Number(a?.manualStats?.units||0),mining:Number(a?.mined?.concrete||0)+Number(a?.mined?.metal||0),checkpoints:Number(window.__TYCOON_V125__?.stats?.checkpoints||0),roads:Math.max(0,Number(roads?.sections||0)-Number(roads?.auto||0))};}
 function occupied(){const a=window.__TYCOON_V123__;return carriedLogs>0||!!window.__TYCOON_START_CARRY__?.()||Number(a?.state?.carry?.amount||0)>0||!!a?.work?.()||!!a?.session?.active;}
 function writable(){return !suppressAutoSaveV36&&!otherTabSaveLockV63;}
 function paused(){return document.hidden||!!window.modalOpenV46?.();}
 programme.attach({stage:()=>stageIndex,metrics,occupied,writable,paused,pay:tryPayResources});
 const capacityConcrete=concreteCapacity,capacityMetal=metalCapacity;
 concreteCapacity=function(){return capacityConcrete.apply(this,arguments)+programme.level('storage')*10;};
 metalCapacity=function(){return capacityMetal.apply(this,arguments)+programme.level('storage')*8;};
 const productionBefore=productionSpeedMultiplier;
 productionSpeedMultiplier=function(){return productionBefore.apply(this,arguments)*(1+programme.level('production')*.04);};
 const durationBefore=constructionDuration;
 constructionDuration=function(){return durationBefore.apply(this,arguments)*(1-programme.level('crew')*.03);};
 const loadingBefore=logisticsLoadingTime,unloadingBefore=logisticsUnloadingTime;
 logisticsLoadingTime=function(){return loadingBefore.apply(this,arguments)*(1-programme.level('storage')*.03);};
 logisticsUnloadingTime=function(){return unloadingBefore.apply(this,arguments)*(1-programme.level('storage')*.03);};
 function chapterLocked(index){return index>=10&&programme.total()<3;}
 const affordBefore=canAffordStage;
 canAffordStage=function(index,upgradeLevel=null){if(upgradeLevel===null&&chapterLocked(index))return false;return affordBefore.apply(this,arguments);};
 const missingBefore=missingStageResources;
 missingStageResources=function(index,upgradeLevel=null){const old=missingBefore.apply(this,arguments);return [old,upgradeLevel===null&&chapterLocked(index)?(lang==='ru'?`программы развития ${programme.total()}/3 — меню рабочей смены`:`development programmes ${programme.total()}/3 — work desk`):''].filter(Boolean).join(' · ');};
 const purchaseBefore=purchaseCurrentPad;
 purchaseCurrentPad=function(){if(currentPad&&chapterLocked(currentPad.index))return false;return purchaseBefore.apply(this,arguments);};
 const completeBefore=allBuildingsComplete;
 allBuildingsComplete=function(){return completeBefore.apply(this,arguments)&&programme.total()>=6;};
 const hudBefore=updateHUD;
 updateHUD=function(){const result=hudBefore.apply(this,arguments),total=programme.total(),chapter=stageIndex>=10&&stageIndex<STAGES.length&&total<3,prestige=completeBefore()&&total<6;if(chapter||prestige){const card=document.getElementById('nextCard'),needed=prestige?6:3;if(card){card.className='blocked';card.innerHTML=goalCardHtml(lang==='ru'?'Развитие компании':'Company development',lang==='ru'?'Открой рабочую смену и заверши программы развития':'Open the work desk and complete development programmes',{progress:total/needed,status:`${total}/${needed}`,meta:lang==='ru'?(prestige?'Подготовка к престижу':'Подготовка к новой главе'):(prestige?'Prestige preparation':'Expansion preparation')});}}return result;};
 const playerBefore=updatePlayer;
 updatePlayer=function(dt){const r=playerBefore.apply(this,arguments);programme.tick(dt);return r;};
 const resetBefore=resetRunOperationsV302;
 resetRunOperationsV302=function(){programme.reset();signature='';return resetBefore.apply(this,arguments);};
 function commit(){save();updateHUD();render(true);}
 function start(id){const ok=programme.start(id);if(ok){commit();toast(lang==='ru'?'Программа запущена. Вернись в игру и выполняй рабочие действия.':'Programme started. Return to play and complete work actions.');}return ok;}
 function commission(){const ok=programme.commission();if(ok){commit();toast(lang==='ru'?'Программа введена в работу — улучшение действует.':'Programme commissioned — the upgrade is active.');}return ok;}
 function formatTime(n){n=Math.max(0,Math.ceil(n));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
 function render(force=false){
   const desk=document.getElementById('systemsOverlay')?.classList.contains('v158-work-mode'),grid=document.getElementById(desk?'workdayGridV158':'fleetGrid');if(!grid)return;
   const rows=programme.view(),ru=lang==='ru',busy=occupied(),running=rows.some(r=>r.active),total=programme.total(),prices=rows.map(r=>r.cost&&canPayResources(r.cost)),sig=JSON.stringify({rows,ru,busy,total,prices,stageIndex,write:writable()});
   let panel=document.getElementById('developmentV160');if(!force&&sig===signature&&panel?.parentNode===grid)return;signature=sig;
   if(!panel){panel=document.createElement('details');panel.id='developmentV160';panel.open=stageIndex>=2;grid.prepend(panel);}else if(panel.parentNode!==grid)grid.prepend(panel);
   panel.innerHTML=`<summary>${ru?'Программы развития':'Development programmes'} <span>${total}/15</span></summary><p>${ru?'Новая глава после «Империи»: 3 завершённых уровня. Престиж: 6 уровней и все 16 готовых зданий.':'Expansion after Empire: 3 completed levels. Prestige: 6 levels and all 16 completed buildings.'}</p><p>${ru?'Каждый уровень: вложение → время в игре и рабочие действия → ввод в работу. Меню и закрытая игра приостанавливают время.':'Each level: invest → play time and work actions → commission. Menus and a closed game pause the timer.'}</p><div class="v160-programmes">${rows.map((r,n)=>{
     const a=r.active,locked=stageIndex<r.unlock,max=r.level>=5,can=!running&&!busy&&!locked&&!max&&prices[n]&&writable();
     const benefit=r.id==='storage'?(ru?`После следующего уровня: +${(r.level+1)*10} бетона и +${(r.level+1)*8} металла к складам; погрузка быстрее на ${(r.level+1)*3}%.`:`Next level total: +${(r.level+1)*10} concrete and +${(r.level+1)*8} steel storage; loading ${(r.level+1)*3}% faster.`):r.id==='production'?(ru?`Производство быстрее на ${(r.level+1)*4}% после следующего уровня.`:`Production ${(r.level+1)*4}% faster after the next level.`):(ru?`Стройки короче на ${(r.level+1)*3}% после следующего уровня.`:`Construction ${(r.level+1)*3}% shorter after the next level.`);
     return `<article><b>${labels[ru?'ru':'en'][r.id]} · ${r.level}/5</b><p>${max?(ru?'Все уровни завершены.':'All levels completed.'):benefit}</p>${a?`<p>${ru?'Время в игре':'Play time'}: ${formatTime(a.elapsed)} / ${formatTime(r.duration)}</p><p>${ru?'Рабочие действия':'Work actions'}: ${a.work}/${r.requiredWork}</p><progress max="1" value="${Math.min(a.elapsed/r.duration,a.work/r.requiredWork)}" aria-label="${ru?'Готовность программы':'Programme readiness'}"></progress><button type="button" data-v160-commission ${!a.ready||busy||!writable()?'disabled':''}>${a.ready?(ru?'Ввести в работу':'Commission'):(ru?'Продолжай работу в игре':'Keep working in the game')}</button>`:max?'':`<p>${opsCostText(r.cost)}</p><p>${formatTime(r.duration)} ${ru?'в игре':'in game'} · ${r.requiredWork} ${ru?'рабочих действий':'work actions'}</p><button type="button" data-v160-start="${r.id}" ${can?'':'disabled'}>${locked?(ru?`После ${r.unlock} объектов`:`After ${r.unlock} projects`):running?(ru?'Другая программа в работе':'Another programme is active'):!prices[n]?(ru?'Накопи ресурсы':'Gather resources'):(ru?'Запустить программу':'Start programme')}</button>`}</article>`;
   }).join('')}</div><p>${ru?'Рабочие действия засчитываются после запуска: единицы ручной доставки и добычи, точки нарядов и вручную построенные участки дорог. Старые действия не засчитываются.':'Actions count after starting: manual delivery and gathering units, work-order checkpoints and manually built road sections. Earlier actions do not count.'}</p>`;
   panel.querySelectorAll('[data-v160-start]').forEach(b=>b.addEventListener('click',()=>start(b.dataset.v160Start)));
   panel.querySelector('[data-v160-commission]')?.addEventListener('click',commission);
 }
 function tick(now){if(document.hidden||now-last<1000)return;last=now;if(document.getElementById('systemsOverlay')?.classList.contains('v158-work-mode')||document.getElementById('fleetOverlay')?.classList.contains('show'))render();}
 window.__TYCOON_VISUAL_TICKS__.push(tick);
 document.getElementById('openWorkdayV158')?.addEventListener('click',()=>render(true));
 const workday=window.__TYCOON_V158__;if(workday){const openBefore=workday.open;workday.open=function(){const r=openBefore.apply(this,arguments);render(true);return r;};}
 window.__TYCOON_V160__={version:'v160-development-programmes',start,commission,render,programme,audit:()=>({levels:programme.total(),active:programme.snapshot().active,chapterReady:programme.total()>=3,prestigeReady:programme.total()>=6})};
})();
