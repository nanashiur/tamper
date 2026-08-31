// ==UserScript==
// @name         🍴レストラン時間変更
// @version      1.00
// @match        https://reserve.tokyodisneyresort.jp/online/restaurant/update/indexTravelBag*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==
(() => {
'use strict';

const VERSION='1.00', INSTALLED='__tdr_restaurant_update_installed__', PANEL_ID='__tdr_restaurant_update_panel';
const PRIORITY_KEY='tdr_restaurant_update_priority_times';
if(window[INSTALLED]) return;
window[INSTALLED]=true;

let autoEnabled=false, fireTimer=null, countdownTimer=null, nextFireAt=0, autoButton=null;
let selectMode=0, selectButton=null, selectToken=0;
let autoNextEnabled=false, autoNextButton=null, autoNextTimer=null;
let pendingCount=0, pendingStartedAt=0, pendingTimer=null;
const HOURS=['11','12','13','14','15','16','17','18','19','20','21'];
const MINUTES=['00','10','20','30','40','50'], priorityRows=[];

function normalizePriority(v){
  const m=String(v||'').trim().match(/^(11|12|13|14|15|16|17|18|19|20|21):(--|00|10|15|20|30|40|45|50)$/);
  if(!m) return '';
  return `${m[1]}:${m[2]==='15'?'10':m[2]==='45'?'40':m[2]}`;
}
function normalizePriorityTimes(a){
  const out=['','',''];
  if(!Array.isArray(a)) return out;
  let stop=false;
  for(let i=0;i<3;i++){
    if(stop) continue;
    const v=normalizePriority(a[i]);
    if(!v){ stop=true; continue; }
    out[i]=v;
  }
  return out;
}
function loadPriorityTimes(){
  try{
    const raw=localStorage.getItem(PRIORITY_KEY);
    if(raw) return normalizePriorityTimes(JSON.parse(raw));
  }catch(e){ console.warn('[TDR Restaurant Update] 優先時間読込失敗',e); }
  return ['','',''];
}
function getPriorityTimes(){
  const out=[];
  for(const {hour,minute} of priorityRows){
    if(!hour.value){ out.push(''); break; }
    out.push(`${hour.value}:${minute.value||'--'}`);
  }
  while(out.length<3) out.push('');
  return normalizePriorityTimes(out);
}
function savePriorityTimes(){
  try{ localStorage.setItem(PRIORITY_KEY,JSON.stringify(getPriorityTimes())); }
  catch(e){ console.warn('[TDR Restaurant Update] 優先時間保存失敗',e); }
}
function getPriorities(){
  const vals=priorityRows.length?getPriorityTimes():loadPriorityTimes(), out=[];
  for(let i=0;i<vals.length;i++){
    const v=normalizePriority(vals[i]);
    if(!v) break;
    const [hour,minute]=v.split(':');
    out.push({
      index:i,
      hour,
      minute:minute==='--'?'':minute,
      display:v
    });
  }
  return out;
}
function priorityMatches(p,time){
  const m=String(time||'').trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!p||!m||m[1].padStart(2,'0')!==p.hour) return false;
  if(!p.minute) return true;
  if(p.minute==='10') return m[2]==='10'||m[2]==='15';
  if(p.minute==='40') return m[2]==='40'||m[2]==='45';
  return m[2]===p.minute;
}
function priorityRank(time,ps){
  for(let i=0;i<ps.length;i++){
    if(priorityMatches(ps[i],time)) return i;
  }
  return ps.length;
}
function matchingPriority(time){
  return getPriorities().find(p=>priorityMatches(p,time))||null;
}
function updatePriorityRows(){
  let active=true;
  for(const {row,label,hour,minute} of priorityRows){
    if(!active){
      hour.value=minute.value='';
      hour.disabled=minute.disabled=true;
      row.style.opacity='.4';
      label.style.color='#777';
      continue;
    }
    hour.disabled=false;
    row.style.opacity='1';
    label.style.color='#000';
    if(!hour.value){
      minute.value='';
      minute.disabled=true;
      active=false;
    }else{
      minute.disabled=false;
    }
  }
}
function priorityHourChanged(index){
  const r=priorityRows[index];
  if(!r) return;
  if(!r.hour.value){
    r.minute.value='';
    for(let i=index+1;i<priorityRows.length;i++){
      priorityRows[i].hour.value='';
      priorityRows[i].minute.value='';
    }
  }
  updatePriorityRows();
  savePriorityTimes();
}

function adultNum(){
  return document.querySelector('select[name="adultNum"]');
}
function triggerChange(el){
  if(window.jQuery){
    window.jQuery(el).trigger('change');
  }else{
    el.dispatchEvent(new Event('change',{bubbles:true}));
  }
}
function fireStockReload(manual=false){
  const adult=adultNum();
  if(!adult){
    console.warn('[TDR Restaurant Update] adultNum が見つかりません');
    return;
  }
  adult.value='1';
  console.log(
    `[TDR Restaurant Update] ${manual?'手動':'自動'}更新:`,
    new Date().toLocaleTimeString()
  );
  triggerChange(adult);
}
function scheduleNextFire(){
  clearTimeout(fireTimer);
  if(!autoEnabled) return;

  const now=new Date();
  const next=new Date(now);
  next.setSeconds(59,600);

  if(now>=next){
    next.setMinutes(next.getMinutes()+1);
  }

  nextFireAt=next.getTime();
  fireTimer=setTimeout(()=>{
    if(!autoEnabled) return;
    fireStockReload(false);
    scheduleNextFire();
  },Math.max(0,nextFireAt-Date.now()));
}
function updateAutoButton(){
  if(!autoButton) return;

  if(pendingCount){
    autoButton.textContent=((Date.now()-pendingStartedAt)/1000).toFixed(1);
    autoButton.style.background='#800080';
  }else if(autoEnabled){
    const ms=nextFireAt-Date.now();
    autoButton.textContent=ms<=0
      ?'00'
      :String(Math.min(59,Math.ceil(ms/1000))).padStart(2,'0');
    autoButton.style.background='#1976d2';
  }else{
    autoButton.textContent='自動OFF';
    autoButton.style.background='#777';
  }
}
function startCountdown(){
  clearInterval(countdownTimer);
  updateAutoButton();
  countdownTimer=setInterval(updateAutoButton,200);
}
function stopCountdown(){
  clearInterval(countdownTimer);
  countdownTimer=null;
  updateAutoButton();
}
function startPending(){
  if(++pendingCount===1){
    pendingStartedAt=Date.now();
  }
  if(!pendingTimer){
    pendingTimer=setInterval(updateAutoButton,100);
  }
  updateAutoButton();
}
function endPending(){
  pendingCount=Math.max(0,pendingCount-1);
  if(!pendingCount){
    clearInterval(pendingTimer);
    pendingTimer=null;
    pendingStartedAt=0;
  }
  updateAutoButton();
}

function getVacancies(){
  return Array.from(
    document.querySelectorAll('#timeSlider li.vacancy')
  ).map(li=>{
    const a=li.querySelector('a');
    return {
      li,
      a,
      time:(a?.textContent||'').trim()
    };
  }).filter(x=>x.a&&/^\d{1,2}:\d{2}$/.test(x.time));
}
function scheduleAutoNext(time){
  clearTimeout(autoNextTimer);
  if(!autoNextEnabled) return;

  autoNextTimer=setTimeout(()=>{
    if(!autoNextEnabled) return;

    const btn=document.getElementById('nextBtn');
    if(!btn){
      console.warn('[TDR Restaurant Update] nextBtn が見つかりません');
      return;
    }

    console.log('[TDR Restaurant Update] 自動「次へ」:',time);
    btn.click();
  },0);
}
function selectVacancy(){
  if(!selectMode) return false;

  const ps=getPriorities();
  const all=getVacancies();

  if(!all.length) return false;

  all.sort((a,b)=>
    priorityRank(a.time,ps)-priorityRank(b.time,ps)||
    a.time.localeCompare(b.time)
  );

  const candidates=selectMode===1
    ?all.filter(x=>priorityRank(x.time,ps)<ps.length)
    :all;

  if(selectMode===1&&!candidates.length){
    console.log(
      '[TDR Restaurant Update] 時間選択: 希望条件一致なし → 未選択'
    );
    return true;
  }

  const target=candidates[0];
  if(!target) return false;

  const p=matchingPriority(target.time);

  console.log(
    '[TDR Restaurant Update] 時間選択:',
    target.time,
    p
      ?`【第${p.index+1}希望 ${p.display}】`
      :'【強制最早時間】'
  );

  target.a.click();
  scheduleAutoNext(target.time);
  return true;
}
function scheduleVacancySelect(){
  if(!selectMode) return;

  const token=++selectToken;
  let n=0;

  const run=()=>{
    if(!selectMode||token!==selectToken) return;
    if(selectVacancy()) return;

    if(++n<50){
      setTimeout(run,20);
    }else{
      console.log('[TDR Restaurant Update] 時間選択: 空席なし');
    }
  };

  setTimeout(run,0);
}

const isTimeGet=url=>/timeGet/i.test(String(url||''));

const originalFetch=window.fetch;
window.fetch=function(input,init){
  const url=typeof input==='string'
    ?input
    :input?.url||'';

  const timeGet=isTimeGet(url);

  if(timeGet){
    startPending();
  }

  let p;

  try{
    p=originalFetch.apply(this,arguments);
  }catch(e){
    if(timeGet){
      endPending();
    }
    throw e;
  }

  if(timeGet){
    p.finally(()=>{
      endPending();
      scheduleVacancySelect();
    }).catch(()=>{});
  }

  return p;
};

const originalOpen=XMLHttpRequest.prototype.open;
const originalSend=XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open=function(method,url){
  this.__tdrRestaurantUpdateUrl=String(url||'');
  return originalOpen.apply(this,arguments);
};
XMLHttpRequest.prototype.send=function(){
  const timeGet=isTimeGet(this.__tdrRestaurantUpdateUrl);

  if(timeGet){
    startPending();

    this.addEventListener('loadend',()=>{
      endPending();
      scheduleVacancySelect();
    },{once:true});
  }

  try{
    return originalSend.apply(this,arguments);
  }catch(e){
    if(timeGet){
      endPending();
    }
    throw e;
  }
};

function updateSelectButton(){
  if(!selectButton) return;

  const states=[
    ['選択OFF','#777'],
    ['選択回避','#fb8c00'],
    ['選択強制','#e65100']
  ];

  selectButton.textContent=states[selectMode][0];
  selectButton.style.background=states[selectMode][1];
}
function updateAutoNextButton(){
  if(!autoNextButton) return;

  autoNextButton.textContent=autoNextEnabled
    ?'次へ ON'
    :'次へ OFF';

  autoNextButton.style.background=autoNextEnabled
    ?'#d32f2f'
    :'#777';
}
function makePriorityControls(){
  const host=document.createElement('div');
  host.style.cssText='width:120px;pointer-events:auto';

  const shadow=host.attachShadow({mode:'open'});
  const box=document.createElement('div');

  box.style.cssText=
    'display:flex;flex-direction:column;width:120px;gap:3px;font-family:sans-serif';

  const saved=loadPriorityTimes();
  const labels=['①','②','③'];

  const css=
    'width:48px;height:30px;box-sizing:border-box;padding:0 1px;'+
    'margin:0;border:1px solid #777;border-radius:4px;background:#fff;'+
    'color:#000;font-size:13px;font-weight:bold;cursor:pointer';

  for(let i=0;i<3;i++){
    const row=document.createElement('div');
    const label=document.createElement('span');
    const hour=document.createElement('select');
    const minute=document.createElement('select');

    row.style.cssText=
      'display:flex;align-items:center;width:120px;height:30px;gap:2px';

    label.textContent=labels[i];
    label.style.cssText=
      'display:inline-flex;align-items:center;justify-content:center;'+
      'width:20px;height:30px;font-size:15px;font-weight:bold;color:#000';

    hour.innerHTML=
      '<option value="">--</option>'+
      HOURS.map(v=>`<option value="${v}">${v}</option>`).join('');

    minute.innerHTML=
      '<option value="">--</option>'+
      MINUTES.map(v=>`<option value="${v}">${v}</option>`).join('');

    hour.style.cssText=css;
    minute.style.cssText=css;

    if(saved[i]){
      const [h,m]=saved[i].split(':');
      hour.value=h;
      minute.value=m==='--'?'':m;
    }

    hour.addEventListener(
      'change',
      ()=>priorityHourChanged(i)
    );

    minute.addEventListener(
      'change',
      savePriorityTimes
    );

    row.append(label,hour,minute);
    box.appendChild(row);

    priorityRows.push({
      row,
      label,
      hour,
      minute
    });
  }

  shadow.appendChild(box);
  updatePriorityRows();

  return host;
}
function makeButton(text,bg,handler){
  const b=document.createElement('button');

  b.type='button';
  b.textContent=text;

  b.style.cssText=
    `width:72px;height:42px;border:none;border-radius:6px;`+
    `background:${bg};color:#fff;font-size:13px;font-weight:bold;`+
    `cursor:pointer;pointer-events:auto`;

  b.addEventListener('click',handler);

  return b;
}
function createPanel(){
  if(document.getElementById(PANEL_ID)||!document.body) return;

  const panel=document.createElement('div');
  panel.id=PANEL_ID;

  panel.style.cssText=
    'position:fixed;top:10px;right:10px;display:flex;'+
    'flex-direction:column;align-items:flex-end;gap:4px;'+
    'width:120px;z-index:2147483647;pointer-events:none';

  autoButton=makeButton(
    '自動OFF',
    '#777',
    ()=>{
      autoEnabled=!autoEnabled;

      if(autoEnabled){
        scheduleNextFire();
        startCountdown();
      }else{
        clearTimeout(fireTimer);
        fireTimer=null;
        nextFireAt=0;
        stopCountdown();
      }

      updateAutoButton();
    }
  );

  selectButton=makeButton(
    '選択OFF',
    '#777',
    ()=>{
      selectMode=
        selectMode===0
          ?2
          :selectMode===2
            ?1
            :0;

      selectToken++;
      updateSelectButton();
    }
  );

  const priorityControls=makePriorityControls();

  autoNextButton=makeButton(
    '次へ OFF',
    '#777',
    ()=>{
      autoNextEnabled=!autoNextEnabled;

      clearTimeout(autoNextTimer);
      autoNextTimer=null;

      updateAutoNextButton();
    }
  );

  const manualButton=makeButton(
    '1名',
    '#198754',
    ()=>fireStockReload(true)
  );

  panel.append(
    autoButton,
    selectButton,
    priorityControls,
    autoNextButton,
    manualButton
  );

  document.body.appendChild(panel);

  updateSelectButton();
  updateAutoNextButton();
  updateAutoButton();

  console.log(
    `[TDR Restaurant Update] v${VERSION} 起動`
  );
}

if(document.readyState==='loading'){
  document.addEventListener(
    'DOMContentLoaded',
    createPanel,
    {once:true}
  );
}else{
  createPanel();
}
})();
