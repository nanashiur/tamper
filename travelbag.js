// ==UserScript==
// @name         🧳トラベルバッグ
// @version      1.32
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
const VERSION='1.32', INSTALLED='__tdr_travelbag_installed__', PANEL_ID='__tdr_travelbag_option_panel';
const PRIORITY_KEY='tdr_travelbag_priority_times', LEGACY_KEY='tdr_travelbag_priority_time';
if(window[INSTALLED]) return;
window[INSTALLED]=true;

let autoEnabled=false, fireTimer=null, countdownTimer=null, nextFireAt=0, autoButton=null;
let vacancySelectMode=0, vacancySelectButton=null, vacancySelectToken=0;
let autoConfirmEnabled=false, autoConfirmButton=null, autoConfirmTimer=null, lastObservedCurrentSignature='';
let notifyEnabled=false, notifyButton=null, webhookWarned=false;
let recordButton=null, recordStartedAt=new Date(), recordedLogs=[];
let currentRestaurantName='', currentReservationPrivilege=false, currentRoomPrivilege=false;
let reservationNoticeActive=false, restaurantModalHandled=false, pageObserver=null, purchasePending=0;
const stockSnapshots=new Map();
const HOURS=['11','12','13','14','15','16','17','18','19','20','21'];
const MINUTES=['00','10','20','30','40','50'], priorityRows=[];
const pad=(n,l=2)=>String(n).padStart(l,'0');

function formatTimeMs(d=new Date()){ return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`; }
function formatDateTimeMs(d=new Date()){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${formatTimeMs(d)}`; }
function formatFileStamp(d=new Date()){ return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; }

function valueText(v,seen=new WeakSet()){
  if(v===undefined) return 'undefined';
  if(v===null) return 'null';
  if(typeof v==='string') return v;
  if(typeof v==='bigint') return `${v}n`;
  if(v instanceof Error) return v.stack||v.message||String(v);
  if(v instanceof Element) return v.outerHTML;
  if(typeof v==='object'){
    try{
      return JSON.stringify(v,(k,x)=>{
        if(typeof x==='bigint') return `${x}n`;
        if(x&&typeof x==='object'){
          if(seen.has(x)) return '[Circular]';
          seen.add(x);
        }
        return x;
      });
    }catch{}
  }
  return String(v);
}
function consoleText(args){
  const a=[...args];
  if(typeof a[0]==='string'){
    const styles=(a[0].match(/%c/g)||[]).length;
    a[0]=a[0].replace(/%c/g,'');
    if(styles) a.splice(1,styles);
  }
  return a.map(v=>valueText(v)).join(' ');
}
function recordConsole(level,args){
  recordedLogs.push([formatDateTimeMs(),level,consoleText(args)]);
}

for(const name of ['log','info','warn','error','debug']){
  const original=console[name]?.bind(console);
  if(!original) continue;
  console[name]=(...args)=>{
    original(...args);
    recordConsole(name.toUpperCase(),args);
  };
}

function csvCell(v){ return `"${String(v??'').replace(/"/g,'""')}"`; }

function playExportSound(){
  try{
    const AudioCtx=window.AudioContext||window.webkitAudioContext;
    if(!AudioCtx) return;
    const ctx=new AudioCtx(), osc=ctx.createOscillator(), gain=ctx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(880,ctx.currentTime);
    gain.gain.setValueAtTime(.08,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.12);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime+.12);
    osc.addEventListener('ended',()=>ctx.close().catch(()=>{}),{once:true});
  }catch{}
}

function exportRecordedCsv(){
  const logs=recordedLogs;
  const startedAt=recordStartedAt;
  const exportedAt=new Date();

  recordedLogs=[];
  recordStartedAt=exportedAt;

  playExportSound();

  if(!logs.length) return;

  const rows=[['日時','レベル','ログ'],...logs];
  const csv='\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url;
  a.download=`travelbag_log_${formatFileStamp(startedAt)}.csv`;
  a.style.display='none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

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
function setRestaurantInfo(a){
  const name=a?.querySelector(':scope > p.caption > span')?.textContent?.trim();
  if(!name) return false;
  currentRestaurantName=name;
  currentReservationPrivilege=!!a.querySelector('img[alt="予約特典付き"]');
  currentRoomPrivilege=!!a.querySelector('img[alt="客室特典付き"]');
  return true;
}
function restaurantLabel(){
  return `${currentReservationPrivilege?'【宿泊特典】':''}${currentRoomPrivilege?'【客室特典】':''}${currentRestaurantName}`;
}
function captureRestaurantInfo(e){
  if(!(e.target instanceof Element)) return;
  const a=e.target.closest('a[href="javascript:void(0);"]');
  if(!a||!a.querySelector(':scope > p.photo')||!a.querySelector(':scope > p.caption > span')) return;
  const modal=a.closest('.js-travelBagModal');
  if(modal&&visible(modal)) setRestaurantInfo(a);
}
function refreshRestaurantInfo(){
  const modal=[...document.querySelectorAll('.js-travelBagModal')].find(visible);
  if(!modal) return;
  const a=[...modal.querySelectorAll('li.current > a')].find(x=>x.querySelector(':scope > p.photo')&&x.querySelector(':scope > p.caption > span'));
  if(a) setRestaurantInfo(a);
}
document.addEventListener('click',captureRestaurantInfo,true);

function getVisibleModals(){ return Array.from(document.querySelectorAll('#modalDialog,.modalDialog')).filter(visible); }
function modalTitle(modal){ return normalizeModalText(modal?.querySelector('h2,.hdgModal01')?.textContent||''); }
function findModalByTitle(title,preferHighLayer=false){
  const target=normalizeModalText(title), modals=getVisibleModals().filter(m=>modalTitle(m)===target);
  if(preferHighLayer){
    const high=modals.find(m=>m.classList.contains('highLayer'));
    if(high) return high;
  }
  return modals[0]||null;
}
function findOverlapReservationModal(){
  const modal=findModalByTitle('選択されたご予約時間が、下記のご予約時間と重なっています。');
  if(!modal) return null;
  const h3=Array.from(modal.querySelectorAll('h3')).map(el=>normalizeModalText(el.textContent));
  return h3.includes('選択予約')&&h3.includes('時間が重複している予約')&&modal.querySelector('img[alt="確認しました"]')?modal:null;
}
function closeOverlapReservationModal(){
  const modal=findOverlapReservationModal();
  if(!modal) return false;
  const img=modal.querySelector('img[alt="確認しました"]');
  console.log('[TDR TravelBag] 重複警告を自動クローズ');
  (img.closest('a,button')||img).click();
  return true;
}
function setupNoticeModal(modal){
  const accept=modal.querySelector('#accept'), next=modal.querySelector('#btnNext');
  if(!accept||!next){ reservationNoticeActive=false; return false; }
  if(reservationNoticeActive) return true;
  reservationNoticeActive=true;
  if(!accept.checked) accept.click();
  setTimeout(()=>{
    const m=findModalByTitle('ご予約の際のご注意',true);
    if(!m){ reservationNoticeActive=false; processTravelBagModals(); return; }
    const btn=m.querySelector('#btnNext');
    if(!btn){ reservationNoticeActive=false; return; }
    console.log('[TDR TravelBag] ポップアップ自動処理: 同意ON → 次へ');
    btn.click();
    setTimeout(()=>{ reservationNoticeActive=false; processTravelBagModals(); },300);
  },80);
  return true;
}
function processTravelBagModals(){
  const notice=findModalByTitle('ご予約の際のご注意',true);
  if(notice){ setupNoticeModal(notice); return; }
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
  const adult=modal.querySelector('
