(function(){
 'use strict';
 const tabs=[['work','Работа','Выбери занятие или наряд. Серия добычи позволяет выполнить несколько подходов подряд.'],['delivery','Поставки','Выбери объект, возьми нужный ресурс и доставь его на площадку.'],['growth','Развитие','Планируй новые здания и программы компании. Условия и стоимость указаны в карточках.']];
 let selected='work';const $=id=>document.getElementById(id);
 const english=[['Work','Choose a task or work order. Gathering batches run several attempts in sequence.'],['Deliveries','Choose a site, collect the required resource and deliver it to the construction area.'],['Development','Plan new buildings and company programmes. Cards show their requirements and prices.']];
 const ru=()=>typeof lang==='undefined'||lang==='ru';
 function attr(el,key,value){if(el.getAttribute(key)!==value)el.setAttribute(key,value);}
 function show(el,yes){if(el&&el.hidden===yes)el.hidden=!yes;}
 function select(key,focus){if(!tabs.some(t=>t[0]===key))return false;selected=key;sync();if(focus)$('workTabsV161')?.querySelector('[data-tab="'+key+'"]')?.focus({preventScroll:true});if(typeof requestLayoutV46==='function')requestLayoutV46();return true;}
 function mount(grid){
  let nav=$('workTabsV161');if(nav&&nav.parentNode!==grid)nav.remove();
  if(!nav||nav.parentNode!==grid){
   nav=document.createElement('div');nav.id='workTabsV161';nav.className='v161-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Разделы рабочей смены');
   for(const [key,label] of tabs){const b=document.createElement('button');b.type='button';b.id='workTabV161-'+key;b.dataset.tab=key;b.textContent=label;b.setAttribute('role','tab');b.setAttribute('aria-controls','workViewV161');b.addEventListener('click',()=>select(key,false));b.addEventListener('keydown',e=>{const i=tabs.findIndex(t=>t[0]===key);let next;if(e.key==='ArrowRight')next=tabs[(i+1)%tabs.length][0];if(e.key==='ArrowLeft')next=tabs[(i+tabs.length-1)%tabs.length][0];if(e.key==='Home')next=tabs[0][0];if(e.key==='End')next=tabs[tabs.length-1][0];if(next){e.preventDefault();e.stopPropagation();select(next,true);}});nav.appendChild(b);}
   const back=document.createElement('button');back.type='button';back.id='workReturnV161';back.className='v161-return';back.addEventListener('click',()=>{$('workdayCloseV158')?.click();});grid.prepend(back);
   const view=document.createElement('div');view.id='workViewV161';view.className='v161-view';grid.prepend(view);grid.prepend(nav);
  }
 }
 function sync(){
  const grid=$('workdayGridV158');if(!grid||!$('systemsOverlay')?.classList.contains('v158-work-mode'))return;mount(grid);
  for(const b of $('workTabsV161').querySelectorAll('button')){const active=b.dataset.tab===selected,i=tabs.findIndex(t=>t[0]===b.dataset.tab),label=ru()?tabs[i][1]:english[i][0];attr(b,'aria-selected',String(active));if(b.tabIndex!==(active?0:-1))b.tabIndex=active?0:-1;if(b.textContent!==label)b.textContent=label;}
  const view=$('workViewV161');attr(view,'aria-labelledby','workTabV161-'+selected);const i=tabs.findIndex(t=>t[0]===selected),text=ru()?tabs[i][2]:english[i][1];if(view.textContent!==text)view.textContent=text;
  const back=$('workReturnV161'),backText=ru()?'Вернуться в город':'Return to town';if(back&&back.textContent!==backText)back.textContent=backText;
  // The actual controlled panel contains the original interactive sections.
  attr(grid,'role','tabpanel');attr(grid,'aria-labelledby','workTabV161-'+selected);
  for(const b of $('workTabsV161').children)attr(b,'aria-controls','workdayGridV158');
  const work=$('workdayV158');show(work,selected!=='growth');if(work)for(const el of work.children){const delivery=el.classList.contains('v158-deliveries');show(el,selected==='delivery'?delivery:!delivery);}
  for(const id of ['expansionV159','developmentV160']){const el=$(id);show(el,selected==='growth');if(el&&selected==='growth'&&!el.dataset.v161Opened){el.open=true;el.dataset.v161Opened='1';}}
 }
 function accessible(){
  for(const el of document.querySelectorAll('.v30Close,#achClose,#systemsBtn')){if(el.tagName!=='BUTTON'&&!el.dataset.v161Keyboard){el.dataset.v161Keyboard='1';el.setAttribute('role','button');el.tabIndex=0;el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();if(!e.repeat)el.click();}});}if(!el.getAttribute('aria-label'))el.setAttribute('aria-label',el.id==='systemsBtn'?'Меню компании':'Закрыть меню');}
  const technical=$('yandexReadyText')?.closest('.v30Section');if(technical)show(technical,false);
 }
 accessible();sync();if(window.__TYCOON_VISUAL_TICKS__)window.__TYCOON_VISUAL_TICKS__.push(sync);
 $('openWorkdayV158')?.addEventListener('click',sync);
 document.addEventListener('click',e=>{if(e.target?.closest('.v30Close,#systemsBtn,#openWorkdayV158')){accessible();sync();}});
 window.__TYCOON_V161__={select,sync,accessible,selected:()=>selected};
})();
