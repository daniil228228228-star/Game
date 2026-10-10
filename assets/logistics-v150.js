/* V150: explicit manual dispatch, route choice and readable logistics planning. */
(()=>{
  'use strict';
  const VERSION='v150-logistics-and-fieldwork';
  let signature='',lastCheck=0,fieldTool=null;
  const runtime={renders:0,selections:0,errors:[]};
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function api(){return window.__TYCOON_V123__;}
  function orders(){return api()?.orders?.()||[];}
  function ensureTool(){
    if(fieldTool||typeof forearmR==='undefined')return;
    fieldTool=new THREE.Group();fieldTool.name='fieldPickaxeV150';fieldTool.visible=false;fieldTool.position.set(0,-.335,.025);fieldTool.rotation.z=-.30;
    const wood=new THREE.MeshStandardMaterial({color:0x8d5d32,roughness:.85}),steel=new THREE.MeshStandardMaterial({color:0x8597a2,roughness:.43,metalness:.62});
    const handle=new THREE.Mesh(new THREE.CylinderGeometry(.027,.033,.62,8),wood);handle.position.y=.08;handle.castShadow=true;fieldTool.add(handle);
    const head=new THREE.Mesh(new THREE.BoxGeometry(.46,.07,.075),steel);head.position.y=.39;head.castShadow=true;fieldTool.add(head);
    for(const side of [-1,1]){const tip=new THREE.Mesh(new THREE.ConeGeometry(.047,.17,4),steel);tip.rotation.z=side*Math.PI/2;tip.position.set(side*.30,.39,0);tip.castShadow=true;fieldTool.add(tip);}
    forearmR.add(fieldTool);
  }
  function select(index,cargo){
    if(!api()?.selectOrder?.(index,cargo))return false;
    runtime.selections++;document.getElementById('fleetClose')?.click();return true;
  }
  function render(force=false){
    const grid=document.getElementById('fleetGrid');if(!grid||!api()?.orders)return;
    const list=orders(),carry=api().state.carry,ru=lang==='ru',busy=carry.amount>0||carriedLogs>0||!!api()?.work?.()||window.__TYCOON_START_CARRY__?.();
    const gathering=!!api()?.work?.();
    const nextSignature=JSON.stringify({list,ru,busy,gathering,amount:carry.amount,type:carry.type});
    let panel=document.getElementById('manualRoutesV150');
    if(!force&&panel&&signature===nextSignature)return;
    signature=nextSignature;
    if(!panel){panel=document.createElement('section');panel.id='manualRoutesV150';grid.prepend(panel);}
    const names=ru?{planks:'Доски',concrete:'Бетон',metal:'Металл'}:{planks:'Planks',concrete:'Concrete',metal:'Steel'};
    const icons={planks:'🪵',concrete:'🧱',metal:'🔩'};
    panel.innerHTML=`<div class="v150-route-heading"><div><span class="v150-eyebrow">${ru?'РУЧНАЯ ЛОГИСТИКА':'MANUAL LOGISTICS'}</span><h3>${ru?'Выбери свой маршрут':'Choose your route'}</h3></div><span class="v150-route-count">${list.length} ${ru?'заказов':'orders'}</span></div><p class="v150-route-note">${gathering?(ru?'Добыча занимает руки. Заверши её, затем выбирай маршрут.':'Gathering occupies your hands. Finish it before choosing a route.'):busy?(ru?'Сначала разгрузи текущий груз. Маршрут остаётся закреплённым за тобой.':'Unload your current cargo first. Your route stays reserved.'):(ru?'Выбери стройку → забери груз у производства → отнеси в зону разгрузки. Стройматериалы уже оплачены заказом.':'Choose a site → collect at production → deliver to the unloading bay. Job materials are already paid for.')}</p><div class="v150-route-list">${list.length?list.map(x=>`<article class="v150-route ${x.selected?'selected':''}"><div class="v150-route-icon">${icons[x.cargo]||'📦'}</div><div class="v150-route-copy"><b>${escape(x.name)}</b><span>${names[x.cargo]||'—'} · ${x.done}/${x.total} · ${ru?`${x.trips} рейс${x.trips===1?'':x.trips<5?'а':'ов'}`:`${x.trips} trip${x.trips===1?'':'s'}`}</span><small>${!x.ready?(ru?`Построй ${x.cargo==='planks'?'лесопилку':x.cargo==='concrete'?'бетонный завод':'металлобазу'}`:`Build the ${x.cargo==='planks'?'sawmill':x.cargo==='concrete'?'concrete plant':'steel yard'}`):x.held?(ru?'Груз у тебя':'Your delivery'):x.waiting?(ru?'Стройка ждёт материал':'Site is waiting for cargo'):(ru?'Можно доставить заранее':'Early delivery available')}${x.ready?` · ${x.distance} ${ru?'м до погрузки':'m to pickup'}`:''}</small><div class="v150-route-track"><i style="width:${Math.max(0,Math.min(100,x.done/Math.max(1,x.total)*100))}%"></i></div></div><button type="button" data-v150-index="${x.index}" data-v150-cargo="${x.cargo}" ${!x.ready||busy?'disabled':''}>${x.selected?(ru?'К погрузке':'To pickup'):(ru?'Выбрать':'Choose')}</button></article>`).join(''):`<div class="v150-empty">${ru?'📦 Все текущие поставки закрыты. Новые заказы появятся при строительстве.':'📦 Current deliveries are complete. New orders appear when construction starts.'}</div>`}</div>`;
    panel.querySelectorAll('[data-v150-index]').forEach(btn=>btn.addEventListener('click',()=>select(Number(btn.dataset.v150Index),btn.dataset.v150Cargo)));
    runtime.renders++;
  }
  if(typeof renderFleetPanel==='function'){
    const previous=renderFleetPanel;
    renderFleetPanel=function(){const result=previous.apply(this,arguments);render(true);return result;};
  }
  function tick(now){
    ensureTool();if(fieldTool)fieldTool.visible=!document.hidden&&!!api()?.work?.();
    if(document.hidden||now-lastCheck<500)return;lastCheck=now;
    if(document.getElementById('fleetOverlay')?.classList.contains('show')){
      try{render();}catch(error){if(runtime.errors.length<10)runtime.errors.push(String(error.message));}
    }
  }
  window.__TYCOON_VISUAL_TICKS__=window.__TYCOON_VISUAL_TICKS__||[];
  ensureTool();
  window.__TYCOON_VISUAL_TICKS__.push(tick);
  window.__TYCOON_V150__={version:VERSION,runtime,orders,select,render,audit(){
    const a=api(),list=orders(),carry=a?.state?.carry,work=a?.work?.(),btn=document.getElementById('actionBtn'),prior=window.__TYCOON_V149__?.audit?.();
    const checks={orderApi:typeof a?.orders==='function'&&typeof a?.selectOrder==='function',validOrders:list.every(x=>x.total>0&&x.done>=0&&x.done<x.total&&x.trips>0&&Number.isFinite(x.distance)),finiteCargo:!!carry&&Number.isFinite(carry.amount)&&carry.amount>=0,workBounded:!work||(Number.isFinite(work.elapsed)&&work.elapsed>=0&&work.elapsed<work.duration),toolBlockPreserved:!btn?.dataset.v150Unavailable||btn.disabled===true,previousChecks:prior?.ok!==false,noErrors:runtime.errors.length===0};
    return {version:VERSION,ok:Object.values(checks).every(Boolean),checks,orderCount:list.length,work,runtime:{...runtime},previousFailures:prior?.previousFailures||[]};
  }};
})();
