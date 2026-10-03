/* Choose meaningful work using existing rewards, gates, actions and save systems. */
(()=>{
 'use strict';
 let focus=null,last=0,signature='',lastTarget=null;
 const runtime={choices:0,renders:0};
 const api=()=>window.__TYCOON_V123__,jobs=()=>window.__TYCOON_V125__;
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const carrying=()=>carriedLogs>0||Number(api()?.state?.carry?.amount||0)>0||!!window.__TYCOON_START_CARRY__?.();
 const occupied=()=>carrying()||!!api()?.work?.()||!!api()?.session?.active;
 function currentTask(ru){
   const start=window.__TYCOON_V144__,step=start?.step?.();
   const hints=ru?{supplies:start?.state?.carrying?'Отнеси стартовые материалы к маяку прораба.':'Забери стартовые материалы у золотого маяка склада.',house:'Построй первый дом на золотой площадке.',road:'Соедини первый объект дорогой: каждый участок строится за деньги отдельным нажатием.',depot:'Построй автопарк, чтобы открыть промышленную цепочку.',sawmill:'Построй лесопилку, чтобы начать заготовку древесины.',plank:'Сруби дерево, забери бревно и отнеси его в круг лесопилки.'}:{supplies:start?.state?.carrying?'Carry starting supplies to the foreman beacon.':'Collect starting supplies at the gold warehouse beacon.',house:'Build the first house on the gold pad.',road:'Connect the first project: pay for and build each road section separately.',depot:'Build the fleet depot to unlock industry.',sawmill:'Build the sawmill to begin gathering timber.',plank:'Chop a tree, collect a log and deliver it to the sawmill circle.'};
   if(step)return hints[step.id]||'';
   if(carrying())return ru?'Отнеси текущий груз к указанной точке разгрузки.':'Deliver your cargo to the indicated unloading point.';
   return ru?'Выбери работу ниже. Если ждёшь доход, займись добычей, древесиной или нарядом.':'Choose work below. While income accumulates, gather resources or complete a work order.';
 }
 function closeDesk(){document.getElementById('systemsOverlay')?.classList.remove('show','v158-work-mode');document.getElementById('fleetClose')?.click();window.requestLayoutV46?.();}
 function openDesk(){
   const host=document.getElementById('systemsOverlay');if(!host)return;
   let panel=document.getElementById('workdayPanelV158');
   if(!panel){panel=document.createElement('div');panel.id='workdayPanelV158';panel.className='v30Panel';panel.innerHTML='<div class="v30Head"><strong>Рабочая смена</strong><button class="v30Close" id="workdayCloseV158" type="button" aria-label="Закрыть">✕</button></div><div id="workdayGridV158"></div>';host.appendChild(panel);document.getElementById('workdayCloseV158')?.addEventListener('click',closeDesk);}
   api()?.cancelWork?.();host.classList.remove('v119-exchange-mode');host.classList.add('show','v158-work-mode');render(true);window.requestLayoutV46?.();
 }
 document.getElementById('openWorkdayV158')?.addEventListener('click',openDesk);
 if(typeof renderSystemsPanel==='function'){const systemsBefore=renderSystemsPanel;renderSystemsPanel=function(){document.getElementById('systemsOverlay')?.classList.remove('v158-work-mode');return systemsBefore.apply(this,arguments);};}
 function loggingTarget(){
   if(!sawmillBuiltV118)return null;
   if(carriedLogs>0)return {pos:SAWMILL_DROPOFF_POS.clone(),label:lang==='ru'?'Отнести брёвна на лесопилку':'Deliver logs to the sawmill',type:'logging'};
   let tree=null,best=Infinity;
   for(const t of sourceTrees){if(t.state!=='grown'||t.mesh.visible===false)continue;const d=player.position.distanceToSquared(t.mesh.position);if(d<best){tree=t;best=d;}}
   return tree?{pos:tree.mesh.position.clone(),label:lang==='ru'?'Заготовить древесину':'Gather timber',type:'logging'}:null;
 }
 function target(){
   if(Number(api()?.state?.carry?.amount||0)>0||window.__TYCOON_START_CARRY__?.())return null;
   if(carriedLogs>0)return loggingTarget();
   const session=api()?.session?.active;
   if(session){const m=api().miningTargets().find(x=>x.cargo===session.cargo&&x.ready);return m?{pos:new THREE.Vector3(m.x,0,m.z),label:lang==='ru'?'Завершить серию добычи':'Finish gathering batch',type:'mining'}:null;}
   if(!focus)return null;
   let result=null;
   if(focus.kind==='logging')result=loggingTarget();
   else if(focus.kind==='mining'){const m=api()?.miningTargets?.().find(x=>x.cargo===focus.cargo&&x.ready&&!x.full);if(m)result={pos:new THREE.Vector3(m.x,0,m.z),label:lang==='ru'?`Добыть ${focus.cargo==='concrete'?'бетон':'металл'}`:`Gather ${focus.cargo==='concrete'?'concrete':'steel'}`,type:'mining'};}
   else if(focus.kind==='assist')result=window.__TYCOON_V146__?.target?.();
   else if(focus.kind==='workorder')result=jobs()?.target?.();
   if(!result)focus=null;return result;
 }
 function choose(kind,cargo=null){
   if(kind==='auto'){focus=null;runtime.choices++;return true;}
   if(occupied())return false;
   if(!['logging','mining','assist','workorder'].includes(kind))return false;
   const prior=focus;focus={kind,cargo};if(!target()){focus=prior;return false;}
   runtime.choices++;closeDesk();return true;
 }
 function delivery(index,cargo){if(occupied()||!api()?.selectOrder?.(index,cargo))return false;focus=null;runtime.choices++;closeDesk();return true;}
 const guidanceBefore=currentGuidanceTarget;
 currentGuidanceTarget=function(){return target()||guidanceBefore.apply(this,arguments);};
 const navBefore=window.__TYCOON_MANUAL_NAV__;
 window.__TYCOON_MANUAL_NAV__=function(){if(!Number(api()?.state?.carry?.amount||0)&&!window.__TYCOON_START_CARRY__?.()&&target())return null;return typeof navBefore==='function'?navBefore.apply(this,arguments):null;};
 const resetBefore=resetRunOperationsV302;
 resetRunOperationsV302=function(){focus=null;signature='';return resetBefore.apply(this,arguments);};
 document.addEventListener('visibilitychange',()=>{if(document.hidden)api()?.cancelWork?.();});
 const ring=new THREE.Mesh(new THREE.TorusGeometry(.95,.038,6,32),new THREE.MeshBasicMaterial({color:0xe4bf70,transparent:true,opacity:.84,depthWrite:false}));ring.name='workTargetV158';ring.rotation.x=-Math.PI/2;ring.visible=false;scene.add(ring);
 function render(force=false){
   const desk=document.getElementById('systemsOverlay')?.classList.contains('v158-work-mode');
   const grid=document.getElementById(desk?'workdayGridV158':'fleetGrid');if(!grid||!api()?.session)return;
   const ru=lang==='ru',queue=api().session.active,targets=api().miningTargets(),list=api().orders(),job=jobs()?.active,next=jobs()?.next?.(),choices=jobs()?.choices?.()||[],help=window.__TYCOON_V146__?.target?.(),busy=occupied();
   const data={ru,queue,targets,list,job,next,choices,help:help?{ready:help.ready,wait:help.wait,energy:help.energy,stage:help.stage}:null,busy,focus,size:api().session.size,logs:carriedLogs};
   const task=currentTask(ru);data.task=task;
   const sig=JSON.stringify(data);let panel=document.getElementById('workdayV158');if(!force&&panel&&signature===sig)return;signature=sig;
   if(!panel){panel=document.createElement('section');panel.id='workdayV158';grid.prepend(panel);}else if(panel.parentNode!==grid)grid.prepend(panel);
   const names=ru?{concrete:'Бетон',metal:'Металл',planks:'Доски'}:{concrete:'Concrete',metal:'Steel',planks:'Planks'};
   const log=loggingTarget();
   const buttons=[{kind:'logging',title:ru?'Заготовить древесину':'Gather timber',note:!sawmillBuiltV118?(ru?'Сначала построй лесопилку.':'Build the sawmill first.'):(ru?'Сруби дерево и отнеси брёвна на лесопилку.':'Cut a tree and bring logs to the sawmill.'),ready:!!log},...targets.map(m=>({kind:'mining',cargo:m.cargo,title:(ru?'Добыть ':'Gather ')+names[m.cargo].toLowerCase(),note:!m.ready?(ru?'Сначала построй производство.':'Build production first.'):m.full?(ru?'Склад заполнен — потрать или обменяй ресурс.':'Storage full — use or trade resources.'):(ru?'Выбери серию ниже. Начни добычу у рабочей точки.':'Choose a batch below. Start gathering at the work point.'),ready:m.ready&&!m.full})),{kind:'assist',title:ru?'Помочь стройке':'Help construction',note:help?(help.ready?(ru?'Бригада готова принять помощь.':'The crew can use your help.'):(ru?`Восстановление ${help.wait} с · энергия ${help.energy}`:`Recovery ${help.wait}s · energy ${help.energy}`)):(ru?'Помощь появится на активной стройке после запуска базы.':'Help is available on active sites after the base launches.'),ready:!!help},{kind:'workorder',title:ru?'Выполнить наряд':'Complete a work order',note:job?(ru?`Точка ${job.step}/${job.total} · ${Math.ceil(job.remaining)} с`:`Stop ${job.step}/${job.total} · ${Math.ceil(job.remaining)}s`):(ru?'Выбери следующий наряд ниже.':'Choose your next work order below.'),ready:!!job}];
   panel.innerHTML=`<div class="v158-head"><h3>${ru?'Рабочая смена':'Work shift'}</h3><button type="button" data-v158-focus="auto">${ru?'Автоцель':'Auto goal'}</button></div><p>${busy?(ru?'Руки заняты. Заверши текущую работу или доставь груз.':'Hands occupied. Finish current work or deliver cargo.'):(ru?'Выбери занятие — ориентир в мире покажет рабочую точку.':'Choose a task — the world marker shows where to work.')}</p><div class="v158-current"><b>${ru?'Сейчас':'Current task'}</b><p>${esc(task)}</p><button type="button" data-v158-return>${ru?'Вернуться к работе':'Return to work'}</button></div><div class="v158-grid">${buttons.map(x=>`<button type="button" class="v158-task ${focus?.kind===x.kind&&focus?.cargo===(x.cargo||null)?'selected':''}" data-v158-focus="${x.kind}" data-v158-cargo="${x.cargo||''}" ${!x.ready||busy?'disabled':''}><b>${x.title}</b><span>${x.note}</span></button>`).join('')}</div><div class="v158-batch"><b>${ru?'Серия добычи':'Gathering batch'}</b><div>${[1,3,5].map(n=>`<button type="button" data-v158-batch="${n}" aria-pressed="${api().session.size===n}" ${queue||api().work()?'disabled':''}>${n} ${ru?'ед.':'units'}</button>`).join('')}</div><p>${ru?'После первого нажатия персонаж продолжает работу с обычными паузами инструмента. Движение, прыжок или открытие меню прерывают серию.':'After the first press, work continues with normal tool cooldowns. Moving, jumping or opening a menu interrupts the batch.'}</p>${queue?`<p>${ru?'Выполнено':'Done'}: ${queue.done}/${queue.total} ${queue.waiting?`· ${ru?'инструмент':'tool'} ${Math.ceil(queue.wait/1000)} ${ru?'с':'s'}`:''}</p><button type="button" data-v158-stop>${ru?'Убрать оставшуюся очередь':'Clear remaining queue'}</button>`:''}</div><div class="v158-jobs"><h4>${ru?'Следующий наряд':'Next work order'}</h4><p>${job?(ru?'Сначала заверши текущий наряд.':'Finish the current work order first.'):(ru?`Выбор применяется при следующей выдаче · ожидание около ${next?.wait||0} с игрового времени.`:`Your choice applies at the next dispatch · about ${next?.wait||0}s of play time.`)}</p><div class="v158-grid">${choices.map(x=>`<button type="button" data-v158-job="${x.id}" aria-pressed="${x.selected}" ${!next?.available?'disabled':''}><b>${esc(x.name)}</b><span>${x.steps} ${ru?'точки':'stops'}</span></button>`).join('')}</div></div><div class="v158-deliveries"><h4>${ru?'Стройки ждут материалы':'Sites awaiting materials'}</h4>${list.filter(x=>x.ready).slice(0,3).map(x=>`<button type="button" data-v158-delivery="${x.index}" data-v158-cargo="${x.cargo}" ${busy?'disabled':''}><b>${esc(x.name)}</b><span>${names[x.cargo]} · ${x.done}/${x.total} · ${x.trips} ${ru?'рейс(а)':'trips'}</span></button>`).join('')||`<p>${ru?'Готовых поставок нет. Построй нужное производство или накопи материалы.':'No available deliveries. Check production requirements below.'}</p>`}</div>`;
   panel.querySelector('[data-v158-return]')?.addEventListener('click',closeDesk);
   panel.querySelectorAll('[data-v158-focus]').forEach(b=>b.addEventListener('click',()=>{choose(b.dataset.v158Focus,b.dataset.v158Cargo||null);render(true);}));
   panel.querySelectorAll('[data-v158-batch]').forEach(b=>b.addEventListener('click',()=>{api().session.choose(Number(b.dataset.v158Batch));render(true);}));
   panel.querySelectorAll('[data-v158-job]').forEach(b=>b.addEventListener('click',()=>{jobs()?.choose?.(b.dataset.v158Job);render(true);}));
   panel.querySelectorAll('[data-v158-delivery]').forEach(b=>b.addEventListener('click',()=>delivery(Number(b.dataset.v158Delivery),b.dataset.v158Cargo)));
   panel.querySelector('[data-v158-stop]')?.addEventListener('click',()=>{api().session.stop();render(true);});
   grid.querySelectorAll('[data-v151-road],[data-v150-index]').forEach(b=>{if(b.__v158ChoiceReset)return;b.__v158ChoiceReset=true;b.addEventListener('click',()=>{if(!occupied())focus=null;});});
   const title=document.getElementById('fleetTitle');if(title)title.textContent=ru?'Работы и автопарк':'Work and fleet';runtime.renders++;
 }
 const fleetBefore=renderFleetPanel;
 renderFleetPanel=function(){const result=fleetBefore.apply(this,arguments);render(true);return result;};
 function tick(now){if(document.hidden||now-last<250)return;last=now;const modal=window.modalOpenV46?.();if(modal&&(api()?.session?.active||api()?.work?.()))api()?.cancelWork?.();const t=target();ring.visible=!!t&&!modal;lastTarget=t;if(t){ring.position.copy(t.pos);ring.position.y=.075;}if(document.getElementById('fleetOverlay')?.classList.contains('show')||document.getElementById('systemsOverlay')?.classList.contains('v158-work-mode'))render();}
 window.__TYCOON_VISUAL_TICKS__.push(tick);
 window.__TYCOON_V158__={version:'v158-player-workday',choose,delivery,target,render,open:openDesk,runtime,audit(){return {ok:!!api()?.session&&typeof jobs()?.choose==='function',focus,session:api()?.session?.active,target:lastTarget?.type||null,...runtime};}};
})();
