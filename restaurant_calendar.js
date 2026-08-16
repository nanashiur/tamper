// ==UserScript==
// @name         🍴💻️レストラン週間モニター
// @version      1.72
// @match        https://reserve.tokyodisneyresort.jp/restaurant/calendar/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_calendar.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_calendar.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
'use strict';
if(window.__tdr_weekly_restaurant_monitor)return;
window.__tdr_weekly_restaurant_monitor=true;

const NAME='🍴💻️レストラン週間モニター';
const WAIT=60000,UI_TICK=1000,PENDING_ERROR_MS=300000,IP_TIMEOUT=5000;
const YELLOW=16776960,ORANGE=16753920;
const AUTO_PREFIX='tdr_weekly_restaurant_auto_',OLD_AUTO_KEY='tdr_weekly_restaurant_auto';
const NOTIFY_KEY='tdr_weekly_restaurant_notify',NOTIFY_MODE_KEY='tdr_weekly_restaurant_notify_mode';
const MEALS=['朝食','昼食','夕食'];
const PATHS=['/restaurant/weekReservation/','/restaurant/ajaxNextWeekList/','/restaurant/ajaxPreWeekList/'];
const blocks=new Map(),commodityMeal=new Map(),mealStates=new Map(),snapshots=new Map(),unresolved=[],errorNotifyHistory=new Map();

let panelRoot=null,notifyPanel=null,notifyModePanel=null,autoHint='',refreshTimer=null,wasMaintenance=isMaintenance();
let notifyState=loadNotifyState(),notifyMode=localStorage.getItem(NOTIFY_MODE_KEY)==='noFull'?'noFull':'all';

function ymd(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
function nowText(){
  const d=new Date();
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}
function isMaintenance(){const h=new Date().getHours();return h>=3&&h<5}
function loadNotifyState(){
  try{const v=JSON.parse(localStorage.getItem(NOTIFY_KEY)||'null');if(v?.date===ymd())return {date:v.date,enabled:v.enabled!==false}}catch{}
  const v={date:ymd(),enabled:true};localStorage.setItem(NOTIFY_KEY,JSON.stringify(v));return v;
}
function syncNotifyDay(){
  if(notifyState.date!==ymd()){
    notifyState={date:ymd(),enabled:true};
    localStorage.setItem(NOTIFY_KEY,JSON.stringify(notifyState));
  }
}
function normalizeMeal(text){const t=String(text||'').replace(/\s+/g,'');return MEALS.find(x=>t.includes(x))||''}
function getMealFromBox(box){
  const h=box.querySelector('.heading');
  return normalizeMeal([h?.textContent,h?.getAttribute('title'),h?.querySelector('img')?.alt,box.querySelector('img[alt*="朝食"],img[alt*="昼食"],img[alt*="夕食"]')?.alt].filter(Boolean).join(' '));
}
function restaurantName(){
  return document.querySelector('.boxRestaurant02 .header h1.heading')?.textContent.replace(/\s+/g,' ').trim()||'レストラン名取得失敗';
}
function getState(meal){
  if(mealStates.has(meal))return mealStates.get(meal);
  const saved=localStorage.getItem(AUTO_PREFIX+meal),old=localStorage.getItem(OLD_AUTO_KEY);
  const s={meal,enabled:saved!==null?saved!=='0':old!=='0',pending:0,startedAt:0,deadline:0,timer:null,row:null,manual:null,panel:null,error403:false,pendingError:false};
  mealStates.set(meal,s);return s;
}
function scanCommodityMap(){
  document.querySelectorAll('.boxRestaurant04').forEach(box=>{
    const meal=getMealFromBox(box),commodity=box.querySelector('.commodityCd,.commodityCD')?.value?.trim()||'';
    if(meal&&commodity)commodityMeal.set(commodity,meal);
  });
}
function resolveMeal(commodity){
  if(!commodity)return '';
  if(commodityMeal.has(commodity))return commodityMeal.get(commodity);
  scanCommodityMap();
  return commodityMeal.get(commodity)||'';
}
function refreshBlocks(){
  blocks.clear();
  document.querySelectorAll('.boxRestaurant04').forEach(box=>{
    const meal=getMealFromBox(box),next=box.querySelector('.nextWeekLink');
    if(!meal||!next)return;
    const commodity=box.querySelector('.commodityCd,.commodityCD')?.value?.trim()||'';
    blocks.set(meal,{box,next,commodity});
    if(commodity)commodityMeal.set(commodity,meal);
    getState(meal);
  });
  createPanels();
  drainUnresolved();
}
function queueRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshBlocks,100)}

function baseButtonStyle(el){
  Object.assign(el.style,{height:'32px',padding:'6px 2px',borderRadius:'7px',boxSizing:'border-box',fontSize:'13px',fontWeight:'700',textAlign:'center',cursor:'pointer',userSelect:'none',boxShadow:'0 2px 8px rgba(0,0,0,.25)',border:'1px solid rgba(0,0,0,.2)',fontFamily:'Arial,"Yu Gothic",sans-serif'});
}
function createPanels(){
  if(!document.body)return;
  if(!panelRoot){
    panelRoot=document.createElement('div');
    Object.assign(panelRoot.style,{position:'fixed',top:'14px',right:'14px',zIndex:'2147483647',display:'flex',flexDirection:'column',gap:'5px'});
    document.body.appendChild(panelRoot);
  }

  MEALS.forEach((meal,i)=>{
    const s=getState(meal);
    if(!blocks.has(meal)){if(s.row)s.row.style.display='none';return}

    if(!s.row){
      const row=document.createElement('div');
      Object.assign(row.style,{order:String(i),display:'flex',gap:'5px'});

      const manual=document.createElement('div');
      baseButtonStyle(manual);
      Object.assign(manual.style,{width:'32px',background:'#444',color:'#fff',fontSize:'18px',padding:'3px 0'});
      manual.textContent='↻';
      manual.title=`${meal} 手動発火`;
      manual.onclick=()=>manualFire(meal);

      const panel=document.createElement('div');
      baseButtonStyle(panel);
      Object.assign(panel.style,{width:'90px',color:'#fff'});
      panel.title=`${meal} 自動監視 ON / OFF`;
      panel.onclick=()=>toggleMeal(meal);

      row.append(manual,panel);
      panelRoot.appendChild(row);
      s.row=row;s.manual=manual;s.panel=panel;
    }
    s.row.style.display='flex';
  });

  if(!notifyPanel){
    notifyPanel=document.createElement('div');
    baseButtonStyle(notifyPanel);
    Object.assign(notifyPanel.style,{order:'10',width:'127px'});
    notifyPanel.title='通常の空席・満席変化通知 ON / OFF';
    notifyPanel.onclick=toggleNotify;
    panelRoot.appendChild(notifyPanel);
  }

  if(!notifyModePanel){
    notifyModePanel=document.createElement('div');
    baseButtonStyle(notifyModePanel);
    Object.assign(notifyModePanel.style,{order:'11',width:'127px'});
    notifyModePanel.title='通常通知モード切替';
    notifyModePanel.onclick=toggleNotifyMode;
    panelRoot.appendChild(notifyModePanel);
  }

  renderPanels();
}

function toggleMeal(meal){
  const s=getState(meal);
  s.enabled=!s.enabled;
  localStorage.setItem(AUTO_PREFIX+meal,s.enabled?'1':'0');
  if(!s.enabled)clearTimer(s);
  else if(!s.pending&&!isMaintenance())schedule(meal);
  renderPanels();
}
function manualFire(meal){
  const s=getState(meal);
  if(s.pending||isMaintenance())return;
  fireSameWeek(meal,true);
}
function toggleNotify(){
  syncNotifyDay();
  notifyState.enabled=!notifyState.enabled;
  localStorage.setItem(NOTIFY_KEY,JSON.stringify(notifyState));
  renderPanels();
}
function toggleNotifyMode(){
  notifyMode=notifyMode==='all'?'noFull':'all';
  localStorage.setItem(NOTIFY_MODE_KEY,notifyMode);
  renderPanels();
}
function clearTimer(s){if(s.timer)clearTimeout(s.timer);s.timer=null;s.deadline=0}
function schedule(meal){
  const s=getState(meal);
  clearTimer(s);
  if(!s.enabled||isMaintenance())return;
  s.deadline=performance.now()+WAIT;
  s.timer=setTimeout(()=>{s.timer=null;s.deadline=0;fireSameWeek(meal,false)},WAIT);
}
function renderPanels(){
  syncNotifyDay();
  const now=performance.now(),maintenance=isMaintenance();

  MEALS.forEach(meal=>{
    const s=mealStates.get(meal);
    if(!s?.panel||!blocks.has(meal))return;

    if(s.manual){
      s.manual.style.background=maintenance||s.pending?'#777':'#444';
      s.manual.style.color='#fff';
      s.manual.style.cursor=maintenance||s.pending?'default':'pointer';
      s.manual.style.opacity=maintenance||s.pending?'0.6':'1';
    }

    if(maintenance){
      s.panel.style.background='#777';s.panel.style.color='#fff';s.panel.textContent=`${meal} メンテ`;return;
    }
    if(s.pendingError){
      s.panel.style.background='#ff8c00';s.panel.style.color='#000';s.panel.textContent=`${meal} 5分超`;return;
    }
    if(s.pending>0){
      s.panel.style.background='#7b2cbf';s.panel.style.color='#fff';s.panel.textContent=`${meal} 読込 ${Math.floor((now-s.startedAt)/1000)}`;return;
    }
    if(s.error403){
      s.panel.style.background='#ff8c00';s.panel.style.color='#000';
      s.panel.textContent=s.deadline?`${meal} 403 ${Math.max(0,Math.ceil((s.deadline-now)/1000))}`:`${meal} 403`;return;
    }
    if(!s.enabled){
      s.panel.style.background='#555';s.panel.style.color='#fff';s.panel.textContent=`${meal} OFF`;return;
    }
    if(s.deadline){
      s.panel.style.background='#1976d2';s.panel.style.color='#fff';s.panel.textContent=`${meal} ON ${Math.max(0,Math.ceil((s.deadline-now)/1000))}`;return;
    }
    s.panel.style.background='#1976d2';s.panel.style.color='#fff';s.panel.textContent=`${meal} ON`;
  });

  if(notifyPanel){
    notifyPanel.style.background=notifyState.enabled?'#ffd43b':'#555';
    notifyPanel.style.color=notifyState.enabled?'#000':'#fff';
    notifyPanel.textContent=notifyState.enabled?'🔔 通知 ON':'🔕 通知 OFF';
  }
  if(notifyModePanel){
    notifyModePanel.style.background=notifyMode==='all'?'#1976d2':'#d32f2f';
    notifyModePanel.style.color='#fff';
    notifyModePanel.textContent=notifyMode==='all'?'📢 全通知':'🟥 満席除外';
  }
}

function maintenanceTick(){
  const maintenance=isMaintenance();
  if(maintenance===wasMaintenance)return;
  wasMaintenance=maintenance;
  if(maintenance){
    mealStates.forEach(clearTimer);
    console.log(`[${NAME}] メンテナンス停止`);
  }else{
    refreshBlocks();
    MEALS.forEach(meal=>{const s=mealStates.get(meal);if(s?.enabled&&!s.pending)fireSameWeek(meal,false)});
    console.log(`[${NAME}] メンテナンス終了・再開`);
  }
  renderPanels();
}

function fireSameWeek(meal,manual=false){
  const s=getState(meal);
  if((!manual&&!s.enabled)||s.pending||isMaintenance())return;

  refreshBlocks();
  const block=blocks.get(meal);
  if(!block){if(!manual)schedule(meal);return}

  const link=block.next;
  const display=link.closest('.header')?.nextElementSibling?.querySelector('.date li:first-child .display');
  const jq=window.jQuery||window.$,format=window.webapiFormat;

  if(!display||!jq?.datepicker||!format){
    console.warn(`[${NAME}] ${meal} 日付DOM未検出`);
    if(!manual)schedule(meal);
    return;
  }

  const current=display.textContent.trim();
  let prev;
  try{
    const d=jq.datepicker.parseDate(format,current,{});
    d.setDate(d.getDate()-7);
    prev=jq.datepicker.formatDate(format,d,{});
  }catch(e){
    console.warn(`[${NAME}] ${meal} 日付変換失敗`,e);
    if(!manual)schedule(meal);
    return;
  }

  const hadNoData=link.classList.contains('hasNoData'),before=s.pending;
  display.textContent=prev;
  link.classList.remove('hasNoData');
  autoHint=meal;

  try{link.click()}
  catch(e){console.error(`[${NAME}] ${meal} 自動発火失敗`,e);sendErrorDiscord(meal,'発火エラー')}
  finally{autoHint=''}

  if(s.pending===before){
    const d2=block.box.querySelector('.timeList .date li:first-child .display');
    if(d2)d2.textContent=current;
    if(hadNoData)link.classList.add('hasNoData');
    sendErrorDiscord(meal,'ajaxNextWeekList未発火');
    if(!manual)schedule(meal);
  }
}

function bodyString(body){if(typeof body==='string')return body;if(body instanceof URLSearchParams)return body.toString();return ''}
function watched(url){try{return PATHS.includes(new URL(url,location.href).pathname)}catch{return false}}
function has(obj,key){return Object.prototype.hasOwnProperty.call(obj,key)}
function slotStatus(li){
  if(li.classList.contains('reservationAble')||li.querySelector('a[onclick*="toOrderForWeek"]')||li.querySelector('img[alt="予約する"]'))return '空席';
  if(li.classList.contains('full')||li.querySelector('.text')?.textContent.includes('満席'))return '満席';
  return '不明';
}

function readCurrentSlots(meal){
  const block=blocks.get(meal);
  if(!block)throw new Error('食事区分DOMなし');

  const dates=[...block.box.querySelectorAll('.timeList .date li .display')].map(e=>e.textContent.trim()).filter(Boolean);
  const lists=[...block.box.querySelectorAll('.timeTable .slider .view > ul.cf')];

  if(!dates.length)throw new Error('日付DOMなし');
  if(!lists.length)throw new Error('週間在庫DOMなし');
  if(dates.length!==lists.length)throw new Error(`週間DOM不整合 ${dates.length}/${lists.length}`);

  const slots={};
  lists.forEach((ul,i)=>{
    const date=dates[i];
    [...ul.children].forEach(li=>{
      const time=li.querySelector('.time')?.textContent?.trim();
      if(!time)return;
      slots[`${date}|${time}`]=slotStatus(li);
    });
  });

  return {weekStart:dates[0],weekEnd:dates[dates.length-1],slots};
}

function snapshotKey(meta,meal,current){
  const p=new URLSearchParams(meta.body);
  return [meal,p.get('commodityCD')||'',current.weekStart,current.weekEnd,p.get('adultNum')||'',p.get('childNum')||'',p.get('childAgeInform')||'',p.get('wheelchairCount')||'',p.get('stretcherCount')||''].join('|');
}

function compareAndSave(meta,meal,current){
  const key=snapshotKey(meta,meal,current),previous=snapshots.get(key);
  if(!previous){snapshots.set(key,current.slots);return []}

  const prev=previous,curr=current.slots,changes=[];

  Object.keys(curr).forEach(slot=>{
    if(has(prev,slot))return;
    const [date,time]=slot.split('|');
    changes.push({type:'added',meal,date,time,to:curr[slot]});
  });

  Object.keys(prev).forEach(slot=>{
    if(has(curr,slot))return;
    const [date,time]=slot.split('|');
    changes.push({type:'deleted',meal,date,time});
  });

  Object.keys(curr).forEach(slot=>{
    if(!has(prev,slot))return;
    const from=prev[slot],to=curr[slot];
    if(from==='不明'||to==='不明'||from===to)return;
    const [date,time]=slot.split('|');
    changes.push({type:'changed',meal,date,time,from,to});
  });

  const next={};
  Object.keys(curr).forEach(slot=>{
    next[slot]=curr[slot]==='不明'&&has(prev,slot)&&prev[slot]!=='不明'?prev[slot]:curr[slot];
  });
  snapshots.set(key,next);
  return changes;
}

const nativeOpen=XMLHttpRequest.prototype.open,nativeSend=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.open=function(method,url,...args){
  this.__tdrWeek={method:String(method||'GET').toUpperCase(),url};
  return nativeOpen.call(this,method,url,...args);
};
XMLHttpRequest.prototype.send=function(body){
  const x=this.__tdrWeek;
  if(x?.method==='POST'&&watched(x.url)){
    const str=bodyString(body),params=new URLSearchParams(str),commodity=params.get('commodityCD')||'',meal=autoHint||resolveMeal(commodity);
    const meta={body:str,commodity,pendingTimer:null};

    if(meal){
      const s=getState(meal);
      clearTimer(s);
      if(s.pending++===0){s.startedAt=performance.now();s.pendingError=false}
      renderPanels();
    }

    meta.pendingTimer=setTimeout(()=>{
      const pendingMeal=meal||resolveMeal(commodity)||'食事区分不明',s=mealStates.get(pendingMeal);
      if(s)s.pendingError=true;
      renderPanels();
      sendErrorDiscord(pendingMeal,'Pending 5分超過');
    },PENDING_ERROR_MS);

    this.addEventListener('loadend',()=>{
      clearTimeout(meta.pendingTimer);
      let text='';
      try{text=this.responseText||''}catch{}
      const resolved=meal||resolveMeal(commodity);
      if(!resolved){unresolved.push({meta,status:this.status,text});queueRefresh();return}
      setTimeout(()=>finishRequest(resolved,meta,this.status,text),30);
    },{once:true});
  }
  return nativeSend.call(this,body);
};

function finishRequest(meal,meta,status,text){
  const s=getState(meal);

  if(status===403){
    s.error403=true;
    sendErrorDiscord(meal,'HTTP 403');
  }else if(status<200||status>=300){
    sendErrorDiscord(meal,status===0?'通信失敗（status 0）':`HTTP ${status}`);
  }else if(!text){
    sendErrorDiscord(meal,'空レスポンス');
  }else if(text.includes('paramErrorDiv')){
    sendErrorDiscord(meal,'サイト内部エラー（paramErrorDiv）');
  }else{
    try{
      refreshBlocks();
      const current=readCurrentSlots(meal),changes=compareAndSave(meta,meal,current);
      s.error403=false;
      if(changes.length)sendChangesDiscord(changes);
    }catch(e){
      console.error(`[${NAME}] ${meal} 解析失敗`,e);
      sendErrorDiscord(meal,`Response解析エラー：${e.message||e}`);
    }
  }

  if(s.pending>0)s.pending--;
  if(!s.pending){
    s.startedAt=0;
    s.pendingError=false;
    if(s.enabled)schedule(meal);
  }

  queueRefresh();
  renderPanels();
}

function drainUnresolved(){
  for(let i=unresolved.length-1;i>=0;i--){
    const x=unresolved[i],meal=resolveMeal(x.meta.commodity);
    if(!meal)continue;
    unresolved.splice(i,1);
    setTimeout(()=>finishRequest(meal,x.meta,x.status,x.text),30);
  }
}

function statusText(status){
  if(status==='空席')return '🟥空席';
  if(status==='満席')return '⬛満席';
  return '状態不明';
}
function changeIcon(changes){
  const added=changes.some(c=>c.type==='added'),deleted=changes.some(c=>c.type==='deleted');
  if(added||deleted)return `${added?'🟦':''}${deleted?'🟩':''}`;
  const states=new Set(changes.filter(c=>c.type==='changed').map(c=>c.to));
  if(states.size===1&&states.has('空席'))return '🟥';
  if(states.size===1&&states.has('満席'))return '⬛';
  return '🟥⬛';
}
function postDiscord(description,color,force=false){
  syncNotifyDay();
  if(!force&&!notifyState.enabled)return;
  const webhook=window.TDR_WEBHOOKS?.restaurant;
  if(!webhook)return;
  fetch(webhook,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username:NAME,embeds:[{description:description.slice(0,4000),color}]})
  }).catch(e=>console.error(`[${NAME}] Discord通知失敗`,e));
}

function sendChangesDiscord(changes){
  syncNotifyDay();

  const critical=changes.filter(c=>c.type==='added'||c.type==='deleted');
  const normal=notifyState.enabled
    ?changes.filter(c=>c.type==='changed'&&(notifyMode==='all'||c.to!=='満席'))
    :[];
  const outgoing=[...critical,...normal];
  if(!outgoing.length)return;

  outgoing.sort((a,b)=>a.date.localeCompare(b.date)||MEALS.indexOf(a.meal)-MEALS.indexOf(b.meal)||a.time.localeCompare(b.time));

  const lines=[`${changeIcon(outgoing)}${nowText()}`,restaurantName()];
  let group='';

  outgoing.forEach(c=>{
    const g=`${c.date}|${c.meal}`;
    if(g!==group){
      if(group)lines.push('');
      lines.push(`【${+c.date.slice(4,6)}/${+c.date.slice(6,8)} ${c.meal}】`);
      group=g;
    }

    if(c.type==='added')lines.push(`${c.time}　新規枠追加（${statusText(c.to)}）`);
    else if(c.type==='deleted')lines.push(`${c.time}　時間枠削除`);
    else lines.push(`${c.time}　${statusText(c.to)}`);
  });

  postDiscord(lines.join('\n'),YELLOW,critical.length>0);
}

async function getPublicIp(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),IP_TIMEOUT);
  try{
    const r=await fetch('https://api.ipify.org?format=json',{cache:'no-store',signal:controller.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    return data.ip||'取得不可';
  }catch(e){
    console.warn(`[${NAME}] IP取得失敗`,e);
    return '取得不可';
  }finally{clearTimeout(timer)}
}

async function sendErrorDiscord(meal,error){
  const key=`${meal}|${error}`,now=Date.now();
  if(now-(errorNotifyHistory.get(key)||0)<60000)return;
  errorNotifyHistory.set(key,now);

  const ip=await getPublicIp();
  postDiscord([
    `🚫${nowText()}`,
    restaurantName(),
    `【${meal}】`,
    `⚠️ ${error}`,
    `🌍 IP：${ip}`
  ].join('\n'),ORANGE,true);
}

function init(){
  refreshBlocks();
  setTimeout(refreshBlocks,300);
  setTimeout(refreshBlocks,1000);
  if(document.body){
    new MutationObserver(ms=>{if(ms.some(m=>!panelRoot?.contains(m.target)))queueRefresh()}).observe(document.body,{childList:true,subtree:true});
  }
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();

setInterval(()=>{maintenanceTick();renderPanels()},UI_TICK);
console.log(`[${NAME}] v1.72 起動`);
})();
