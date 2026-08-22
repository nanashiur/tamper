// ==UserScript==
// @name         🧳トラベルバッグ
// @version      1.26
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

const VERSION='1.26', INSTALLED='__tdr_travelbag_installed__', PANEL_ID='__tdr_travelbag_option_panel';
const PRIORITY_KEY='tdr_travelbag_priority_times', LEGACY_KEY='tdr_travelbag_priority_time';
if(window[INSTALLED]) return;
window[INSTALLED]=true;

let autoEnabled=false, fireTimer=null, countdownTimer=null, nextFireAt=0, autoButton=null;
let vacancySelectMode=0, vacancySelectButton=null, vacancySelectToken=0;
let autoConfirmEnabled=false, autoConfirmButton=null, autoConfirmTimer=null, lastObservedCurrentSignature='';
let notifyEnabled=true, notifyButton=null, currentRestaurantName='', webhookWarned=false;
let reservationNoticeActive=false, restaurantModalHandled=false, pageObserver=null, purchasePending=0;
const stockSnapshots=new Map();
const HOURS=['11','12','13','14','15','16','17','18','19','20','21'];
const MINUTES=['00','10','20','30','40','50'], priorityRows=[];

function normalizePriority(v){
  const m=String(v||'').trim().match(/^(11|12|13|14|15|16|17|18|19|20|21):(--|00|10|15|20|30|40|45|50)$/);
  if(!m) return '';
  return `${m[1]}:${m[2]==='15'?'10':m[2]==='45'?'40':m[2]}`;
}
function normalizePriorityTimes(a){
  const out=['','','','',''];
  if(!Array.isArray(a)) return out;
  let stop=false;
  for(let i=0;i<5;i++){
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
    const legacy=normalizePriority(localStorage.getItem(LEGACY_KEY));
    if(legacy) return [legacy,'','','',''];
  }catch(e){ console.warn('[TDR TravelBag] 優先時間読込失敗',e); }
  return ['','','','',''];
}
function getPriorityTimes(){
  const out=[];
  for(const {hour,minute} of priorityRows){
    if(!hour.value){ out.push(''); break; }
    out.push(`${hour.value}:${minute.value||'--'}`);
  }
  while(out.length<5) out.push('');
  return normalizePriorityTimes(out);
}
function savePriorityTimes(){
  try{
    localStorage.setItem(PRIORITY_KEY,JSON.stringify(getPriorityTimes()));
    localStorage.removeItem(LEGACY_KEY);
  }catch(e){ console.warn('[TDR TravelBag] 優先時間保存失敗',e); }
}
function getPriorities(){
  const vals=priorityRows.length?getPriorityTimes():loadPriorityTimes(), out=[];
  for(let i=0;i<vals.length;i++){
    const v=normalizePriority(vals[i]);
    if(!v) break;
    const [hour,minute]=v.split(':');
    out.push({index:i,hour,minute:minute==='--'?'':minute,display:v});
  }
  return out;
}
function priorityMatches(p,time){
  const m=String(time||'').trim().match(/^(\d{1,2}):(\d{2})$/);
  if(!p||!m) return false;
  const hour=m[1].padStart(2,'0'), minute=m[2];
  if(hour!==p.hour) return false;
  if(!p.minute) return true;
  if(p.minute==='10') return minute==='10'||minute==='15';
  if(p.minute==='40') return minute==='40'||minute==='45';
  return minute===p.minute;
}
function priorityRank(time,ps){
  for(let i=0;i<ps.length;i++) if(priorityMatches(ps[i],time)) return i;
  return ps.length;
}
function matchingPriority(time){ return getPriorities().find(p=>priorityMatches(p,time))||null; }

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
    }else minute.disabled=false;
  }
}
function priorityHourChanged(index){
  const r=priorityRows[index];
  if(!r) return;
  if(!r.hour.value){
    r.minute.value='';
    for(let i=index+1;i<priorityRows.length;i++) priorityRows[i].hour.value=priorityRows[i].minute.value='';
  }
  updatePriorityRows();
  savePriorityTimes();
}
function updateVacancyButton(){
  if(!vacancySelectButton) return;
  const states=[['選択OFF','#777'],['選択回避','#fb8c00'],['選択強制','#e65100']];
  vacancySelectButton.textContent=states[vacancySelectMode][0];
  vacancySelectButton.style.background=states[vacancySelectMode][1];
}
function updateAutoConfirmButton(){
  if(!autoConfirmButton) return;
  autoConfirmButton.textContent=autoConfirmEnabled?'確定 ON':'確定 OFF';
  autoConfirmButton.style.background=autoConfirmEnabled?'#d32f2f':'#777';
}
function updateNotifyButton(){
  if(!notifyButton) return;
  notifyButton.textContent=notifyEnabled?'通知 ON':'通知 OFF';
  notifyButton.style.background=notifyEnabled?'#f9a825':'#777';
}
function getPhoneNumber(){
  const phone=window.TDR_WEBHOOKS?.phone;
  if(typeof phone==='string'&&phone.trim()) return phone.trim();
  console.warn('[TDR TravelBag] 電話番号を取得できないため090を使用します');
  return '090';
}
function prepareReservationForm(){
  const phone=getPhoneNumber();
  if(window.jQuery) window.jQuery('input[name="telNum"]').val(phone);
  else{
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
    if(purchasePending>0) return console.log('[TDR TravelBag] 自動確定: purchase系通信中 → スキップ');
    const cur=getSelectedTimeInfo();
    if(!cur||cur.signature!==sig) return;
    prepareReservationForm();
    setTimeout(()=>{
      if(!autoConfirmEnabled) return;
      if(purchasePending>0) return console.log('[TDR TravelBag] 自動確定: purchase系通信中 → スキップ');
      const now=getSelectedTimeInfo(), btn=document.getElementById('confirmBtn');
      if(!now||now.signature!==sig) return;
      if(!btn) return console.warn('[TDR TravelBag] 自動確定: confirmBtn が見つかりません');
      console.log('[TDR TravelBag] 自動確定:',now.time,now.commodityCD,now.openNumKey);
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

function normalizeModalText(s){ return String(s||'').replace(/\s+/g,'').trim(); }
function visible(el){
  if(!el) return false;
  const s=getComputedStyle(el);
  return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity||1)!==0;
}
function captureRestaurantName(e){
  if(!(e.target instanceof Element)) return;
  const a=e.target.closest('a[href="javascript:void(0);"]');
  if(!a||!a.querySelector(':scope > p.photo')||!a.querySelector(':scope > p.caption > span')) return;
  const modal=a.closest('.js-travelBagModal');
  if(!modal||!visible(modal)) return;
  const name=a.querySelector(':scope > p.caption > span')?.textContent?.trim();
  if(name) currentRestaurantName=name;
}
document.addEventListener('click',captureRestaurantName,true);

function getVisibleModals(){
  return Array.from(document.querySelectorAll('#modalDialog,.modalDialog')).filter(visible);
}
function modalTitle(modal){
  return normalizeModalText(modal?.querySelector('h2,.hdgModal01')?.textContent||'');
}
function findModalByTitle(title,preferHighLayer=false){
  const target=normalizeModalText(title);
  const modals=getVisibleModals().filter(m=>modalTitle(m)===target);
  if(preferHighLayer){
    const high=modals.find(m=>m.classList.contains('highLayer'));
    if(high) return high;
  }
  return modals[0]||null;
}
function findOverlapReservationModal(){
  const modal=findModalByTitle('選択されたご予約時間が、下記のご予約時間と重なっています。',false);
  if(!modal) return null;
  const h3Texts=Array.from(modal.querySelectorAll('h3')).map(el=>normalizeModalText(el.textContent));
  if(!h3Texts.includes('選択予約')) return null;
  if(!h3Texts.includes('時間が重複している予約')) return null;
  if(!modal.querySelector('img[alt="確認しました"]')) return null;
  return modal;
}
function closeOverlapReservationModal(){
  const modal=findOverlapReservationModal();
  if(!modal) return false;
  const okImg=modal.querySelector('img[alt="確認しました"]');
  const clickTarget=okImg.closest('a,button')||okImg;
  console.log('[TDR TravelBag] 重複警告を自動クローズ');
  clickTarget.click();
  return true;
}
function setupNoticeModal(modal){
  const accept=modal.querySelector('#accept');
  const next=modal.querySelector('#btnNext');
  if(!accept||!next){
    reservationNoticeActive=false;
    return false;
  }
  if(reservationNoticeActive) return true;
  reservationNoticeActive=true;
  if(!accept.checked) accept.click();
  setTimeout(()=>{
    const m=findModalByTitle('ご予約の際のご注意',true);
    if(!m){
      reservationNoticeActive=false;
      processTravelBagModals();
      return;
    }
    const btn=m.querySelector('#btnNext');
    if(!btn){
      reservationNoticeActive=false;
      return;
    }
    console.log('[TDR TravelBag] ポップアップ自動処理: 同意ON → 次へ');
    btn.click();
    setTimeout(()=>{
      reservationNoticeActive=false;
      processTravelBagModals();
    },300);
  },80);
  return true;
}
function processTravelBagModals(){
  const noticeModal=findModalByTitle('ご予約の際のご注意',true);
  if(noticeModal){
    setupNoticeModal(noticeModal);
    return;
  }
  reservationNoticeActive=false;
  if(closeOverlapReservationModal()) setTimeout(processTravelBagModals,300);
}
function processRestaurantModal(){
  const modal=[...document.querySelectorAll('.js-travelBagModal')].find(visible);
  if(!modal||!modal.querySelector('select[name="adultNum"]')||!modal.querySelector('#timeSlider')){
    restaurantModalHandled=false;
    return;
  }
  if(restaurantModalHandled) return;
  restaurantModalHandled=true;
  const adult=modal.querySelector('select[name="adultNum"]');
  if(adult.value==='1') return;
  if(window.jQuery) window.jQuery(adult).val('1').trigger('change');
  else{
    adult.value='1';
    adult.dispatchEvent(new Event('change',{bubbles:true}));
  }
}
function installPageObserver(){
  if(pageObserver) return;
  if(!document.documentElement) return setTimeout(installPageObserver,0);
  pageObserver=new MutationObserver(()=>{
    processRestaurantModal();
    processTravelBagModals();
    checkAutoConfirmSelection();
  });
  pageObserver.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});
  processRestaurantModal();
  processTravelBagModals();
  checkAutoConfirmSelection();
  console.log('[TDR TravelBag] ページ状態監視 ON');
}
installPageObserver();

let pendingSeq=0, pendingTimer=null;
const pending=new Map();

function oldestPending(){
  let t=Infinity;
  for(const v of pending.values()) if(v<t) t=v;
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
  }else updatePending();
}

const isTimeGet=url=>/timeGet/i.test(String(url||''));
const isPurchase=url=>/\/(?:privilege)?purchase(?:\/|$|\?)/i.test(String(url||''));

function absUrl(url){
  try{ return new URL(String(url||''),location.href).toString(); }
  catch{ return String(url||''); }
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
         s==='満席'?'':
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
    try{ return new URLSearchParams([...body.entries()]).toString(); }
    catch{ return ''; }
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
  if(!text) return out;
  let p;
  try{ p=new URLSearchParams(text); }catch{ return out; }
  const date=p.get('useDate')||p.get('hotelUseDate')||'';
  const code=p.get('commodityCD')||'';
  return {...out,useDate:date,displayDate:formatDate(date),targetCommodityCD:code,targetCodeDisplay:splitCommodityCD(code).display};
}
function parseResponse(r){
  if(Array.isArray(r)) return r;
  if(typeof r==='string'){
    const t=r.trim();
    return t?JSON.parse(t):[];
  }
  return r&&typeof r==='object'?r:[];
}
function snapshotRows(rows){
  const map=new Map();
  for(const r of rows) map.set(r.time,{status:r.status,openNumKey:String(r.openNumKey??'')});
  return map;
}
function sendStockDiffNotification(payload,groups){
  if(!notifyEnabled||!groups.length) return;
  const webhook=window.TDR_WEBHOOKS?.restaurant;
  if(typeof webhook!=='string'||!webhook.trim()){
    if(!webhookWarned){
      webhookWarned=true;
      console.warn('[TDR TravelBag] restaurant Webhook が見つかりません');
    }
    return;
  }
  const restaurantName=currentRestaurantName||groups.find(g=>g.restaurantName)?.restaurantName||'レストラン在庫差分';
  const lines=[payload.displayDate||'日付不明'];
  for(const g of groups){
    lines.push(`【${splitCommodityCD(g.code).display}】`);
    lines.push(...g.changes);
  }
  let description=lines.join('\n');
  if(description.length>4000) description=description.slice(0,3990)+'\n…';
  originalFetch.call(window,webhook.trim(),{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      username:'🧳トラベルバッグ',
      embeds:[{
        title:`🔔 ${restaurantName}`,
        description,
        color:0xf9a825
      }]
    })
  }).catch(e=>console.warn('[TDR TravelBag] 差分通知送信失敗',e));
}
function processStockDiff(payload,grouped){
  const codes=new Set(Object.keys(grouped));
  if(payload.targetCommodityCD) codes.add(payload.targetCommodityCD);
  const noticeGroups=[];

  for(const code of codes){
    if(!code) continue;
    const rows=grouped[code]||[];
    const current=snapshotRows(rows);
    const key=`${payload.useDate||''}|${code}`;
    const previous=stockSnapshots.get(key);
    const restaurantName=currentRestaurantName||previous?.restaurantName||'';

    if(!previous){
      stockSnapshots.set(key,{restaurantName,rows:current});
      continue;
    }

    const changes=[];

    for(const [time,cur] of current){
      const old=previous.rows.get(time);
      if(!old) changes.push(`${time} 枠追加 → ${cur.status}`);
      else if(old.status!==cur.status) changes.push(`${time} ${old.status} → ${cur.status}`);
    }

    for(const [time,old] of previous.rows){
      if(!current.has(time)) changes.push(`${time} 枠削除（${old.status}）`);
    }

    stockSnapshots.set(key,{restaurantName:restaurantName||previous.restaurantName,rows:current});

    if(changes.length) noticeGroups.push({code,restaurantName:restaurantName||previous.restaurantName,changes});
  }

  sendStockDiffNotification(payload,noticeGroups);
}
function printTimeGet(source,url,response,body){
  let data;
  try{ data=parseResponse(response); }
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
    const item={time,status:statusLabel(row),openNumKey:getValue(row,'openNumKey'),salesStatus:salesStatus(row),commodityCD,commodityDisplay:splitCommodityCD(commodityCD).display};
    (grouped[commodityCD]??=[]).push(item);
    rows.push(item);
  }
  rows.sort((a,b)=>a.commodityCD.localeCompare(b.commodityCD)||a.time.localeCompare(b.time));
  Object.values(grouped).forEach(a=>a.sort((x,y)=>x.time.localeCompare(y.time)));
  const now=new Date().toLocaleTimeString();
  for(const code of Object.keys(grouped)){
    console.log(`%c${now}`,'background:#333;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px');
    console.log(`%c${payload.displayDate||'日付不明'} ${splitCommodityCD(code).display}`,'font-weight:bold');
    grouped[code].forEach(r=>console.log(`%c${r.time} ${r.status} ${r.openNumKey}`,statusStyle(r.status)));
  }
  window.tb_last_timeget={at:new Date().toISOString(),source,url:absUrl(url),payload,rows,grouped,raw:data};
  processStockDiff(payload,grouped);
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
  all.sort((a,b)=>priorityRank(a.time,ps)-priorityRank(b.time,ps)||a.time.localeCompare(b.time)||a.commodityCD.localeCompare(b.commodityCD));
  return vacancySelectMode===1?all.filter(x=>priorityRank(x.time,ps)<ps.length):all;
}
function clickVacancy(candidates){
  const items=document.querySelectorAll('#timeSlider li.vacancy');
  for(const target of candidates){
    for(const li of items){
      const a=li.querySelector('a');
      const time=a?.textContent?.trim()||'';
      const open=li.querySelector('input[name="openNumKey"]')?.value||'';
      const code=li.querySelector('input[name="commodityCD"]')?.value||'';
      if(time===target.time&&String(open)===String(target.openNumKey)&&code===target.commodityCD){
        const p=matchingPriority(target.time);
        console.log('[TDR TravelBag] 時間選択:',target.time,p?`【第${p.index+1}希望 ${p.display}】`:'【強制最早時間】',target.commodityCD,target.openNumKey);
        a.click();
        setTimeout(checkAutoConfirmSelection,0);
        return true;
      }
    }
  }
  return false;
}
function scheduleVacancySelect(data){
  if(!vacancySelectMode) return;
  const vacancies=Array.isArray(data)?data.filter(r=>statusLabel(r)==='空席'):[];
  if(!vacancies.length) return console.log('[TDR TravelBag] 時間選択: 空席なし');
  const candidates=getVacancyCandidates(data);
  if(vacancySelectMode===1&&!candidates.length) return console.log('[TDR TravelBag] 時間選択: 希望条件一致なし → 選択なし');
  if(!candidates.length) return;
  const token=++vacancySelectToken;
  let n=0;
  const run=()=>{
    if(!vacancySelectMode||token!==vacancySelectToken) return;
    if(clickVacancy(candidates)) return;
    if(++n<25) setTimeout(run,20);
    else console.warn('[TDR TravelBag] 時間選択: 対象DOMを確認できませんでした',candidates);
  };
  setTimeout(run,0);
}

const originalFetch=window.fetch;
window.fetch=function(input,init){
  const url=typeof input==='string'?input:input?.url||'';
  const method=(init?.method||(typeof input!=='string'?input?.method:'')||'GET').toUpperCase();
  const body=init?.body||'';
  const timeGet=isTimeGet(url), purchase=isPurchase(url);
  let id=null,p;
  if(timeGet) id=startPending();
  if(purchase) purchasePending++;
  try{ p=originalFetch.apply(this,arguments); }
  catch(e){
    if(id!==null) endPending(id);
    if(purchase) purchasePending=Math.max(0,purchasePending-1);
    throw e;
  }
  if(timeGet){
    p.then(res=>res.clone().text()
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
  if(purchase) p.finally(()=>purchasePending=Math.max(0,purchasePending-1)).catch(()=>{});
  return p;
};

const originalOpen=XMLHttpRequest.prototype.open;
const originalSend=XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open=function(method,url){
  this.__tb={method:String(method||'').toUpperCase(),url:String(url||'')};
  return originalOpen.apply(this,arguments);
};
XMLHttpRequest.prototype.send=function(body){
  const info=this.__tb, timeGet=info&&isTimeGet(info.url), purchase=info&&isPurchase(info.url);
  let id=null;
  if(timeGet){
    id=startPending();
    this.addEventListener('loadend',()=>{
      let response='';
      try{ response=(this.responseType===''||this.responseType==='text')?this.responseText||'':this.response; }
      catch{ try{ response=this.response||''; }catch{} }
      try{
        const data=printTimeGet(`xhr/${info.method}`,info.url,response,body);
        if(data) scheduleVacancySelect(data);
      }finally{ endPending(id); }
    });
  }
  if(purchase){
    purchasePending++;
    this.addEventListener('loadend',()=>purchasePending=Math.max(0,purchasePending-1),{once:true});
  }
  try{ return originalSend.apply(this,arguments); }
  catch(e){
    if(id!==null) endPending(id);
    if(purchase) purchasePending=Math.max(0,purchasePending-1);
    throw e;
  }
};

const isEditPage=()=>location.pathname.startsWith('/online/travelbag/edit/');

function adultNum(){
  if(!window.jQuery){
    console.warn('[TDR TravelBag] jQuery が見つかりません');
    return null;
  }
  const $a=window.jQuery('select[name="adultNum"]');
  if(!$a.length) return null;
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
  next.setSeconds(59,600);
  if(now>=next) next.setMinutes(next.getMinutes()+1);
  nextFireAt=next.getTime();
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
  const host=document.createElement('div');
  host.style.cssText='width:120px;pointer-events:auto';
  const shadow=host.attachShadow({mode:'open'}), box=document.createElement('div');
  box.style.cssText='display:flex;flex-direction:column;width:120px;gap:3px;font-family:sans-serif';
  const saved=loadPriorityTimes(), labels=['①','②','③','④','⑤'];
  const css='width:48px;height:30px;box-sizing:border-box;padding:0 1px;margin:0;border:1px solid #777;border-radius:4px;background:#fff;color:#000;font-size:13px;font-weight:bold;cursor:pointer';
  for(let i=0;i<5;i++){
    const row=document.createElement('div'), label=document.createElement('span');
    const hour=document.createElement('select'), minute=document.createElement('select');
    row.style.cssText='display:flex;align-items:center;width:120px;height:30px;gap:2px';
    label.textContent=labels[i];
    label.style.cssText='display:inline-flex;align-items:center;justify-content:center;width:20px;height:30px;font-size:15px;font-weight:bold;color:#000';
    hour.innerHTML='<option value="">--</option>'+HOURS.map(v=>`<option value="${v}">${v}</option>`).join('');
    minute.innerHTML='<option value="">--</option>'+MINUTES.map(v=>`<option value="${v}">${v}</option>`).join('');
    hour.style.cssText=minute.style.cssText=css;
    if(saved[i]){
      const [h,m]=saved[i].split(':');
      hour.value=h;
      minute.value=m==='--'?'':m;
    }
    hour.addEventListener('change',()=>priorityHourChanged(i));
    minute.addEventListener('change',savePriorityTimes);
    row.append(label,hour,minute);
    box.appendChild(row);
    priorityRows.push({row,label,hour,minute});
  }
  shadow.appendChild(box);
  updatePriorityRows();
  return host;
}
function makeButton(text,bg,handler){
  const b=document.createElement('button');
  b.type='button';
  b.textContent=text;
  b.style.cssText=`width:72px;height:42px;border:none;border-radius:6px;background:${bg};color:#fff;font-size:13px;font-weight:bold;cursor:pointer;pointer-events:auto`;
  b.addEventListener('click',handler);
  return b;
}
function createPanel(){
  if(!isEditPage()||document.getElementById(PANEL_ID)||!document.body) return;
  const panel=document.createElement('div');
  panel.id=PANEL_ID;
  panel.style.cssText='position:fixed;top:10px;right:10px;display:flex;flex-direction:column;align-items:flex-end;gap:4px;width:120px;z-index:2147483647;pointer-events:none';

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
    vacancySelectMode=vacancySelectMode===0?2:vacancySelectMode===2?1:0;
    vacancySelectToken++;
    updateVacancyButton();
  });

  const priorityControls=makePriorityControls();

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

  notifyButton=makeButton('通知 ON','#f9a825',()=>{
    notifyEnabled=!notifyEnabled;
    updateNotifyButton();
  });

  const manualButton=makeButton('1名','#198754',manualReload);

  panel.append(autoButton,vacancySelectButton,priorityControls,autoConfirmButton,notifyButton,manualButton);
  document.body.appendChild(panel);

  updateVacancyButton();
  updateAutoConfirmButton();
  updateNotifyButton();
  updateAutoButtonBg();
  pending.size?updatePending():updateCountdown();

  const c=getSelectedTimeInfo();
  lastObservedCurrentSignature=c?c.signature:'';
  console.log(`[TDR TravelBag] v${VERSION} パネル起動`);
}

if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',createPanel,{once:true});
else createPanel();

console.log(`[TDR TravelBag] v${VERSION} 通信監視起動`);
})();
