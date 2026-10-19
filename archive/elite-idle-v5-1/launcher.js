(function(){
'use strict';
var boot=document.getElementById('boot');
var bootText=document.getElementById('bootText');
var bootDetail=document.getElementById('bootDetail');
var bootFill=document.getElementById('bootFill');
function status(percent,title,detail){bootFill.style.width=percent+'%';bootText.textContent=title;if(detail)bootDetail.textContent=detail}
function fail(error){var message=error&&error.message?error.message:String(error);status(100,'Ошибка запуска V5.1',message);boot.style.background='#211310';console.error(error)}
async function start(){
  try{
    status(8,'Проверка движка…','Локальный Three.js');
    if(!window.THREE)throw new Error('Three.js не загрузился из репозитория');
    status(18,'Проверка игрового кода…','Исправление совместимости Safari');
    var response=await fetch('../elite-idle-v5/app.js?v=5102',{cache:'no-store'});
    if(!response.ok)throw new Error('Не найден игровой код: HTTP '+response.status);
    var source=await response.text();
    source=source
      .replace('rough==null?.82:rough','rough == null ? .82 : rough')
      .replace('o.material.roughness==null?.8:o.material.roughness','o.material.roughness == null ? .8 : o.material.roughness')
      .replace("fetch('source/model.part-00?v=5001'","fetch('../elite-idle-v5/source/model.part-00?v=5102'");
    status(28,'Запуск улучшенной сцены…','Дом, техника и реальный GLB');
    var execute=new Function(source+'\n//# sourceURL=elite-idle-v5-fixed.js');
    execute();
  }catch(error){fail(error)}
}
window.addEventListener('error',function(event){if(boot&&document.body.contains(boot))fail(event.error||event.message)});
start();
})();