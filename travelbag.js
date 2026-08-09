// ==UserScript==
// @name         🧳トラベルバッグ
// @version      1.17
// @match        https://reserve.tokyodisneyresort.jp/online/travelbag/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/travelbag.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/travelbag.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// @noframes
// ==/UserScript==
(() => {
'use strict';
const VERSION='1.17', INSTALLED='__tdr_travelbag_installed__', PANEL_ID='__tdr_travelbag_option_panel';
const PRIORITY_KEY='tdr_travelbag_priority_times', LEGACY_KEY='tdr_travelbag_priority_time';
if (window[INSTALLED]) return; window[INSTALLED]=true;

let autoEnabled=false, fireTimer=null, countdownTimer=null, nextFireAt=0, autoButton=null;
let vacancySelectMode=0, vacancySelectButton=null, vacancySelectToken=0;
let autoConfirmEnabled=false, autoConfirmButton=null, autoConfirmTimer=null, lastObservedCurrentSignature='';
let reservationNoticeActive=false, pageObserver=null;
const HOURS=['11','12','13','14','15','16','17','18','19','20','21'], MINUTES=['00','10','20','30','40','50'], priorityRows=[];

function normalizePriority(v){
  const m=String(v||'').trim().match(/^(11|12|13|14|15|16|17|18|19|20|21):(--|00|10|15|20|30|40|45|50)$/);
  if (!m) return '';
  const min=m[2]==='15'?'10':m[2]==='45'?'40':m[2];
  return `${m[1]}:${min}`;
}
function loadPriorityTimes(){
  try {
    const raw=localStorage.getItem(PRIORITY_KEY);
    if (raw) {
      const a=JSON.parse(raw);
      if (Array.isArray(a)) return Array.from({length:5},(_,i)=>normalizePriority(a[i]));
    }
    const legacy=normalizePriority(localStorage.getItem(LEGACY_KEY));
    if (legacy) return [legacy,'','','',''];
  } catch(e){ console.warn('[TDR TravelBag] 優先時間読込失敗',e); }
  return ['','','','',''];
}
function getPriorityTimes(){
  return priorityRows.map(({hour,minute})=>hour.value?`${hour.value}:${minute.value||'--'}`:'');
}
function savePriorityTimes(){
  try {
    localStorage.setItem(PRIORITY_KEY,JSON.stringify(getPriorityTimes()));
    localStorage.removeItem(LEGACY_KEY);
  } catch(e){ console.warn('[TDR TravelBag] 優先時間保存失敗',e); }
}
function getPriorities(){
  const vals=priorityRows.length?getPriorityTimes():loadPriorityTimes(), out=[];
  vals.forEach((v,index)=>{
    v=normalizePriority(v);
    if (!v) return;
    const [hour,minute]=v.split(':');
    out.push({index,hour,minute:minute==='--'?'':minute,display:v});
  });
  return out;
}
function priorityMatches(p,time){
  const m=String(time||'').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!p||!m) return false;
  const h=m[1].padStart(2,'0'), min=m[2];
  if (h!==p.hour) return false;
  if (!p.minute) return true;
  if (p.minute==='10') return min==='10'||min==='15';
  if (p.minute==='40') return min==='40'||min==='45';
  return min===p.minute;
}
function priorityRank(time,ps){
  for(let i=0;i<ps.length;i++) if(priorityMatches(ps[i],time)) return i;
  return ps.length;
}
function matchingPriority(time){ return getPriorities().find(p=>priorityMatches(p,time))||null; }

function updateVacancyButton(){
  if (!vacancySelectButton) return;
  const states=[['選択OFF','#777'],['選択回避','#fb8c00'],['選択強制','#e65100']];
  [vacancySelectButton.textContent,vacancySelectButton.style.background]=states[vacancySelectMode];
}
function turnOffVacancySelect(){
  if(vacancySelectMode){ vacancySelectMode=0; vacancySelectToken++; updateVacancyButton(); }
}
document.addEventListener('click',e=>{
  if(e.target?.closest?.('#confirmBtn')) turnOffVacancySelect();
},true);

function updateAutoConfirmButton(){
  if (!autoConfirmButton) return;
  autoConfirmButton.textContent=autoConfirmEnabled?'確定 ON':'確定 OFF';
  autoConfirmButton.style.background=autoConfirmEnabled?'#d32f2f':'#777';
}
function getPhoneNumber(){
  const phone=window.TDR_WEBHOOKS?.phone;
  if (typeof phone==='string'&&phone.trim()) return phone.trim();
  console.warn('[TDR TravelBag] 電話番号を取得できないため090を使用します');
  return '090';
}
function prepareReservationForm(){
  const phone=getPhoneNumber();
  if (window.jQuery) window.jQuery('input[name="telNum"]').val(phone);
  else {
    const el=document.querySelector('input[name="telNum"]');
    if(el) el.value=phone;
  }
  const agree=document.getElementById('agree');
  if(agree&&!agree.checked) agree.click();
}
function getSelectedTimeInfo(){
  const li=document.querySelector('#timeSlider li.current');
  if(!li) return null;
  const time=li.querySelector('a')?.textContent?.trim()||'';
  const openNumKey=li.querySelector('input[name="openNumKey"]')?.value||'';
  const commodityCD=li.querySelector('input[name="commodityCD"]')?.value||'';
  return time?{time,openNumKey,commodityCD,signature:`${commodityCD}|${openNumKey}|${time}`}:null;
}
function scheduleAutoConfirm(info){
  if(!autoConfirmEnabled||!info) return;
  clearTimeout(autoConfirmTimer);
  const sig=info.signature;
  autoConfirmTimer=setTimeout(()=>{
    if(!autoConfirmEnabled) return;
    const cur=getSelectedTimeInfo();
    if(!cur||cur.signature!==sig) return;
    console.log('[TDR TravelBag] 自動確定準備:',cur.time,cur.commodityCD,cur.openNumKey);
    prepareReservationForm();
    setTimeout(()=>{
      if(!autoConfirmEnabled) return;
      const now=getSelectedTimeInfo();
      if(!now||now.signature!==sig) return;
      const btn=document.getElementById('confirmBtn');
      if(!btn) return console.warn('[TDR TravelBag] 自動確定: confirmBtn が見つかりません');
      console.log('[TDR TravelBag] 自動確定:',now.time);
      btn.click();
    },0);
  },0);
}
function checkAutoConfirmSelection(){
  const cur=getSelectedTimeInfo();
  if(!cur){ lastObservedCurrentSignature=''; return; }
  if(cur.signature===lastObservedCurrentSignature) return;
  lastObservedCurrentSignature=cur.signature;
  if(autoConfirmEnabled) scheduleAutoConfirm(cur);
}

function visible(el){
  if(!el) return false;
  const s=getComputedStyle(el);
  return s.display!=='none'&&s.visibility!=='hidden';
}
function processNoticeModal(){
  const modal=document.getElementById('modalDialog');
  if(!modal||!visible(modal)||modal.querySelector('.hdgModal01')?.textContent?.trim()!=='ご予約の際のご注意'){
    reservationNoticeActive=false;
    return;
  }
  const accept=modal.querySelector('#accept'), next=modal.querySelector('#btnNext');
  if(!accept||!next||reservationNoticeActive) return;
  reservationNoticeActive=true;
  console.log('[TDR TravelBag] ご予約の際のご注意を自動処理');
  if(!accept.checked) accept.click();
  setTimeout(()=>{
    const m=document.getElementById('modalDialog');
    if(!m||!visible(m)||m.querySelector('.hdgModal01')?.textContent?.trim()!=='ご予約の際のご注意'){
      reservationNoticeActive=false;
      return;
    }
    const b=m.querySelector('#btnNext');
    if(!b){ reservationNoticeActive=false; return; }
    console.log('[TDR TravelBag] 注意モーダル「次へ」自動クリック');
    b.click();
  },0);
}
function installPageObserver(){
  if(pageObserver) return;
  if(!document.documentElement) return setTimeout(installPageObserver,0);
  pageObserver=new MutationObserver(()=>{
    processNoticeModal();
    checkAutoConfirmSelection();
  });
  pageObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});
  processNoticeModal();
  checkAutoConfirmSelection();
  console.log('[TDR TravelBag] ページ状態監視 ON');
}
installPageObserver();

let pendingSeq=0, pendingTimer=null;
const pending=new Map();
function oldestPending(){
  let t=Infinity;
  for(const v of pending.values()) if(v<t)t=v;
  return t===Infinity?0:t;
}
function updateAutoButtonBg(){
  if(autoButton) autoButton.style.background=pending.size?'#800080':autoEnabled?'#1976d2':'#777';
}
function updatePending(){
  if(autoButton&&pending.size) autoButton.textContent=((Date.now()-oldestPending())/1000).toFixed(1);
}
function startPending(){
  const id=++pendingSeq;
  pending.set(id,Date.now());
  updateAutoButtonBg();
  if(!pendingTimer) pendingTimer=setInterval(updatePending,100);
  updatePending();
  return id;
}
function endPending(id){
  pending.delete(id);
  if(!pending.size){
    if(pendingTimer) clearInterval(pendingTimer);
    pendingTimer=null;
    updateAutoButtonBg();
    updateCountdown();
  } else updatePending();
}

const isTimeGet=url=>/timeGet/i.test(String(url||''));
function absUrl(url){
  try{return new URL(String(url||''),location.href).toString();}
  catch{return String(url||'');}
}
function getValue(row,key){
  if(!row||typeof row!=='object') return '';
  if(Object.prototype.hasOwnProperty.call(row,key)) return row[key];
  const k=Object.keys(row).find(x=>String(x).trim()===key);
  return k?row[k]:'';
}
function salesStatus(row){
  const a=getValue(row,'salesStatus');
  if(a!==''&&a!=null) return String(a).trim();
  const b=getValue(row,'saleStatus');
  return b!==''&&b!=null?String(b).trim():'';
}
function timeClosing(row){
  const v=getValue(row,'timeClosing');
  return v===true||String(v).trim().toLowerCase()==='true';
}
function statusLabel(row){
  const s=salesStatus(row);
  return timeClosing(row)?'締切':s==='0'?'空席':s==='1'?'満席':s==='2'?'吸収':`不明(${s||'空'})`;
}
function statusStyle(s){
  return s==='空席'?'color:red;font-weight:bold;':
         s==='満席'?'color:black;':
         s==='吸収'?'color:blue;font-weight:bold;':
         s==='締切'?'color:gray;font-weight:bold;':
         'color:purple;font-weight:bold;';
}
function splitCommodityCD(code){
  const base=String(code||'').split('_')[0].trim();
  let m=base.match(/^(XXXR)([A-Z])([A-Z0-9]{3})([A-Z]{2})(\d{3})$/);
  if(m) return {base,display:`${m[1]} ${m[2]} ${m[3]} ${m[4]} ${m[5]}`};
  m=base.match(/^(XSS\d{2}R)([A-Z0-9]{3})(\d{4})$/);
  if(m) return {base,display:`${m[1]} ${m[2]} ${m[3]}`};
  return {base,display:base};
}
function bodyString(body){
  if(!body) return '';
  if(typeof body==='string') return body;
  if(body instanceof URLSearchParams) return body.toString();
  if(body instanceof FormData){
    try{return new URLSearchParams([...body.entries()]).toString();}
    catch{return '';}
  }
  return String(body||'');
}
function formatDate(v){
  const s=String(v||'').trim();
  return /^\d{8}$/.test(s)?`${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6,8)}`:s;
}
function payloadInfo(body){
  const text=bodyString(body);
  const out={raw:text,useDate:'',displayDate:'',targetCommodityCD:'',targetCodeDisplay:''};
  if(!text)return out;
  let p;
  try{p=new URLSearchParams(text);}catch{return out;}
  const d=p.get('useDate')||p.get('hotelUseDate')||'';
  const c=p.get('commodityCD')||'';
  return {...out,useDate:d,displayDate:formatDate(d),targetCommodityCD:c,targetCodeDisplay:splitCommodityCD(c).display};
}
function parseResponse(r){
  if(Array.isArray(r)) return r;
  if(typeof r==='string'){
    const t=r.trim();
    return t?JSON.parse(t):[];
  }
  return r&&typeof r==='object'?r:[];
}
function printTimeGet(source,url,response,body){
  let data;
  try{data=parseResponse(response);}
  catch(e){
    console.warn('[TB timeGet] JSON解析失敗',{source,url:absUrl(url),response});
    return null;
  }
  if(!Array.isArray(data)){
    console.warn('[TB timeGet] 配列ではありません',{source,url:absUrl(url),data});
    return null;
  }

  const payload=payloadInfo(body), rows=[], grouped={};
  for(const row of data){
    const commodityCD=String(getValue(row,'commodityCD')||'').trim();
    const time=String(getValue(row,'exhibitionTime')||'').trim();
    if(!commodityCD||!time) continue;
    const item={
      time,
      status:statusLabel(row),
      openNumKey:getValue(row,'openNumKey'),
      salesStatus:salesStatus(row),
      commodityCD,
      commodityDisplay:splitCommodityCD(commodityCD).display
    };
    (grouped[commodityCD]??=[]).push(item);
    rows.push(item);
  }

  rows.sort((a,b)=>a.commodityCD.localeCompare(b.commodityCD)||a.time.localeCompare(b.time));
  Object.values(grouped).forEach(a=>a.sort((x,y)=>x.time.localeCompare(y.time)));

  const now=new Date().toLocaleTimeString();
  for(const code of Object.keys(grouped)){
    console.log(`%c${now}`,'background:#333;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px');
    console.log(`%c${payload.displayDate||'日付不明'} ${splitCommodityCD(code).display}`,'color:#000;font-weight:bold');
    grouped[code].forEach(r=>console.log(`%c${r.time} ${r.status} ${r.openNumKey}`,statusStyle(r.status)));
  }

  window.tb_last_timeget={
    at:new Date().toISOString(),
    source,
    url:absUrl(url),
    payload,
    rows,
    grouped,
    raw:data
  };
  return data;
}

function getVacancyCandidates(data){
  if(!Array.isArray(data)) return [];
  const ps=getPriorities(), all=[];
  for(const row of data){
    if(statusLabel(row)!=='空席') continue;
    const commodityCD=String(getValue(row,'commodityCD')||'').trim();
    const time=String(getValue(row,'exhibitionTime')||'').trim();
    const openNumKey=String(getValue(row,'openNumKey')??'').trim();
    if(commodityCD&&time) all.push({commodityCD,time,openNumKey});
  }
  all.sort((a,b)=>
    priorityRank(a.time,ps)-priorityRank(b.time,ps)||
    a.time.localeCompare(b.time)||
    a.commodityCD.localeCompare(b.commodityCD)
  );
  return vacancySelectMode===1
    ? all.filter(x=>priorityRank(x.time,ps)<ps.length)
    : all;
}
function clickVacancy(candidates){
  const items=document.querySelectorAll('#timeSlider li.vacancy');
  for(const target of candidates) for(const li of items){
    const a=li.querySelector('a');
    const time=a?.textContent?.trim()||'';
    const open=li.querySelector('input[name="openNumKey"]')?.value||'';
    const code=li.querySelector('input[name="commodityCD"]')?.value||'';

    if(time===target.time&&String(open)===String(target.openNumKey)&&code===target.commodityCD){
      const p=matchingPriority(target.time);
      console.log(
        '[TDR TravelBag] 空席自動選択:',
        target.time,
        p?`【第${p.index+1}希望 ${p.display}】`:'【強制最早時間】',
        target.commodityCD,
        target.openNumKey
      );
      a.click();
      setTimeout(checkAutoConfirmSelection,0);
      return true;
    }
  }
  return false;
}
function scheduleVacancySelect(data){
  if(!vacancySelectMode) return;

  const vacancies=Array.isArray(data)?data.filter(r=>statusLabel(r)==='空席'):[];
  if(!vacancies.length) return console.log('[TDR TravelBag] 空席自動選択: 空席なし');

  const ps=getPriorities(), candidates=getVacancyCandidates(data);
  if(vacancySelectMode===1&&!candidates.length)
    return console.log('[TDR TravelBag] 選択回避: 希望条件に一致する空席なし → 選択しません');
  if(!candidates.length) return;

  const matched=ps.find(p=>candidates.some(c=>priorityMatches(p,c.time)));
  if(matched)
    console.log('[TDR TravelBag] 優先時間:',`第${matched.index+1}希望`,matched.display,'空席');
  else if(vacancySelectMode===2)
    console.log('[TDR TravelBag] 選択強制:',ps.length?'希望条件に一致する空席なし → 全空席の最早時間を選択':'希望時間指定なし → 全空席の最早時間を選択');

  const token=++vacancySelectToken;
  let n=0;
  const run=()=>{
    if(!vacancySelectMode||token!==vacancySelectToken) return;
    if(clickVacancy(candidates)) return;
    if(++n<10) setTimeout(run,50);
    else console.warn('[TDR TravelBag] 空席自動選択: 対象DOMを確認できませんでした',candidates);
  };
  setTimeout(run,0);
}

const originalFetch=window.fetch;
window.fetch=function(input,init){
  const url=typeof input==='string'?input:input?.url||'';
  const method=(init?.method||(typeof input!=='string'?input?.method:'')||'GET').toUpperCase();
  const body=init?.body||'';
  let id=null,p;

  if(isTimeGet(url)) id=startPending();
  try{p=originalFetch.apply(this,arguments);}
  catch(e){if(id!==null)endPending(id);throw e;}

  if(isTimeGet(url)){
    p.then(res=>
      res.clone().text()
        .then(text=>{
          const data=printTimeGet(`fetch/${method}`,url,text,body);
          if(data) scheduleVacancySelect(data);
        })
        .catch(e=>console.warn('[TB timeGet] fetch response read failed',e))
        .finally(()=>endPending(id))
    ).catch(e=>{
      console.warn('[TB timeGet] fetch failed',e);
      endPending(id);
    });
  }
  return p;
};

const originalOpen=XMLHttpRequest.prototype.open;
const originalSend=XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open=function(method,url){
  this.__tb={method:String(method||'').toUpperCase(),url:String(url||'')};
  return originalOpen.apply(this,arguments);
};

XMLHttpRequest.prototype.send=function(body){
  const info=this.__tb;
  let id=null;

  if(info&&isTimeGet(info.url)){
    id=startPending();
    this.addEventListener('loadend',()=>{
      let response='';
      try{
        response=(this.responseType===''||this.responseType==='text')?this.responseText||'':this.response;
      }catch{
        try{response=this.response||'';}catch{}
      }

      try{
        const data=printTimeGet(`xhr/${info.method}`,info.url,response,body);
        if(data) scheduleVacancySelect(data);
      }finally{
        endPending(id);
      }
    });
  }

  try{return originalSend.apply(this,arguments);}
  catch(e){if(id!==null)endPending(id);throw e;}
};

const isEditPage=()=>location.pathname.startsWith('/online/travelbag/edit/');

function adultNum(){
  if(!window.jQuery){
    console.warn('[TDR TravelBag] jQuery が見つかりません');
    return null;
  }
  const $a=window.jQuery('select[name="adultNum"]');
  if(!$a.length){
    console.warn('[TDR TravelBag] adultNum が見つかりません');
    return null;
  }
  return $a;
}
function fireStockReload(){
  const $a=adultNum();
  if(!$a) return;
  console.log('[TDR TravelBag] 在庫状況リロード:',new Date().toLocaleTimeString());
  $a.trigger('change');
}
function manualReload(){
  const $a=adultNum();
  if(!$a) return;
  $a.val('1');
  prepareReservationForm();
  $a.trigger('change');
}
function scheduleNextFire(){
  clearTimeout(fireTimer);
  if(!autoEnabled) return;

  const now=new Date(), next=new Date(now);
  next.setSeconds(59,500);
  if(now>=next) next.setMinutes(next.getMinutes()+1);

  nextFireAt=next.getTime();
  console.log('[TDR TravelBag] 次回自動発火:',`${next.toLocaleTimeString()}.500`);

  fireTimer=setTimeout(()=>{
    if(!autoEnabled) return;
    if(autoButton&&!pending.size) autoButton.textContent='00';
    fireStockReload();
    scheduleNextFire();
  },Math.max(0,nextFireAt-Date.now()));
}
function updateCountdown(){
  if(!autoButton||pending.size) return;
  if(!autoEnabled){
    autoButton.textContent='自動OFF';
    return;
  }
  const ms=nextFireAt-Date.now();
  autoButton.textContent=ms<=0?'00':String(Math.min(59,Math.ceil(ms/1000))).padStart(2,'0');
}
function startCountdown(){
  clearInterval(countdownTimer);
  updateCountdown();
  countdownTimer=setInterval(updateCountdown,200);
}
function stopCountdown(){
  clearInterval(countdownTimer);
  countdownTimer=null;
  if(autoButton&&!pending.size) autoButton.textContent='自動OFF';
}

function makePriorityControls(){
  const box=document.createElement('div');
  box.style.cssText='display:flex;flex-direction:column;width:132px;gap:3px';

  const saved=loadPriorityTimes(), labels=['①','②','③','④','⑤'];

  for(let i=0;i<5;i++){
    const row=document.createElement('div');
    const label=document.createElement('span');
    const hour=document.createElement('select');
    const minute=document.createElement('select');

    row.style.cssText='display:flex;align-items:center;width:132px;height:30px;gap:2px';
    label.textContent=labels[i];
    label.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:24px;height:30px;font-size:15px;font-weight:bold;color:#000';

    hour.innerHTML='<option value="">--</option>'+HOURS.map(x=>`<option value="${x}">${x}</option>`).join('');
    minute.innerHTML='<option value="">--</option>'+MINUTES.map(x=>`<option value="${x}">${x}</option>`).join('');

    const css='width:52px;height:30px;box-sizing:border-box;padding:0 2px;margin:0;border:1px solid #777;border-radius:4px;background:#fff;color:#000;font-size:13px;font-weight:bold;cursor:pointer';
    hour.style.cssText=css;
    minute.style.cssText=css;

    const v=saved[i];
    if(v){
      const [h,m]=v.split(':');
      hour.value=h;
      minute.value=m==='--'?'':m;
    }

    hour.addEventListener('change',savePriorityTimes);
    minute.addEventListener('change',savePriorityTimes);

    row.append(label,hour,minute);
    box.appendChild(row);
    priorityRows.push({hour,minute});
  }
  return box;
}

function makeButton(text,bg,handler){
  const b=document.createElement('button');
  b.type='button';
  b.textContent=text;
  b.style.cssText=`width:132px;height:42px;border:none;border-radius:6px;background:${bg};color:#fff;font-size:15px;font-weight:bold;cursor:pointer`;
  b.addEventListener('click',handler);
  return b;
}

function createPanel(){
  if(!isEditPage()||document.getElementById(PANEL_ID)||!document.body) return;

  const panel=document.createElement('div');
  panel.id=PANEL_ID;
  panel.style.cssText='position:fixed;top:10px;right:10px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;width:132px;z-index:2147483647';

  autoButton=makeButton('自動OFF','#777',()=>{
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
    updateAutoButtonBg();
    pending.size?updatePending():updateCountdown();
  });

  vacancySelectButton=makeButton('選択OFF','#777',()=>{
    vacancySelectMode=(vacancySelectMode+1)%3;
    vacancySelectToken++;
    updateVacancyButton();
  });

  const priority=makePriorityControls();

  autoConfirmButton=makeButton('確定 OFF','#777',()=>{
    autoConfirmEnabled=!autoConfirmEnabled;
    clearTimeout(autoConfirmTimer);
    autoConfirmTimer=null;

    if(autoConfirmEnabled){
      const c=getSelectedTimeInfo();
      lastObservedCurrentSignature=c?c.signature:'';
    }
    updateAutoConfirmButton();
  });

  const manual=makeButton('1名','#198754',manualReload);

  panel.append(autoButton,vacancySelectButton,priority,autoConfirmButton,manual);
  document.body.appendChild(panel);

  updateVacancyButton();
  updateAutoConfirmButton();
  updateAutoButtonBg();
  pending.size?updatePending():updateCountdown();

  const c=getSelectedTimeInfo();
  lastObservedCurrentSignature=c?c.signature:'';

  console.log(`[TDR TravelBag] v${VERSION} パネル起動`);
}

if(document.readyState==='loading')
  document.addEventListener('DOMContentLoaded',createPanel,{once:true});
else
  createPanel();

console.log(`[TDR TravelBag] v${VERSION} 通信監視起動`);
})();
