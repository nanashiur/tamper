// ==UserScript==
// @name         🍴💻️レストラン週間モニター
// @version      1.51
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
const WAIT=60000,UI_TICK=1000,PENDING_ERROR_MS=300000;
const YELLOW=16776960,ORANGE=16753920;
const AUTO_PREFIX='tdr_weekly_restaurant_auto_';
const OLD_AUTO_KEY='tdr_weekly_restaurant_auto';
const NOTIFY_KEY='tdr_weekly_restaurant_notify';
const MEALS=['朝食','昼食','夕食'];
const PATHS=[
  '/restaurant/weekReservation/',
  '/restaurant/ajaxNextWeekList/',
  '/restaurant/ajaxPreWeekList/'
];

const blocks=new Map();
const commodityMeal=new Map();
const mealStates=new Map();
const unresolved=[];
const snapshots=new Map();
const errorNotifyHistory=new Map();

let panelRoot=null;
let notifyPanel=null;
let autoHint='';
let refreshTimer=null;
let wasMaintenance=isMaintenance();
let notifyState=loadNotifyState();

function ymd(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function isMaintenance(){
  const h=new Date().getHours();
  return h>=3&&h<5;
}

function loadNotifyState(){
  try{
    const v=JSON.parse(localStorage.getItem(NOTIFY_KEY)||'null');
    if(v?.date===ymd())return {date:v.date,enabled:v.enabled!==false};
  }catch{}
  const v={date:ymd(),enabled:true};
  localStorage.setItem(NOTIFY_KEY,JSON.stringify(v));
  return v;
}

function syncNotifyDay(){
  if(notifyState.date!==ymd()){
    notifyState={date:ymd(),enabled:true};
    localStorage.setItem(NOTIFY_KEY,JSON.stringify(notifyState));
  }
}

function normalizeMeal(text){
  const t=String(text||'').replace(/\s+/g,'');
  return MEALS.find(x=>t.includes(x))||'';
}

function getMealFromBox(box){
  const h=box.querySelector('.heading');
  return normalizeMeal([
    h?.textContent,
    h?.getAttribute('title'),
    h?.querySelector('img')?.alt,
    box.querySelector('img[alt*="朝食"],img[alt*="昼食"],img[alt*="夕食"]')?.alt
  ].filter(Boolean).join(' '));
}

function restaurantName(){
  return document
    .querySelector('.boxRestaurant02 .header h1.heading')
    ?.textContent.replace(/\s+/g,' ').trim()
    ||'レストラン名取得失敗';
}

function getState(meal){
  if(mealStates.has(meal))return mealStates.get(meal);

  const saved=localStorage.getItem(AUTO_PREFIX+meal);
  const old=localStorage.getItem(OLD_AUTO_KEY);

  const s={
    meal,
    enabled:saved!==null?saved!=='0':old!=='0',
    pending:0,
    startedAt:0,
    deadline:0,
    timer:null,
    panel:null,
    error403:false
  };

  mealStates.set(meal,s);
  return s;
}

function scanCommodityMap(){
  document.querySelectorAll('.boxRestaurant04').forEach(box=>{
    const meal=getMealFromBox(box);
    const commodity=box.querySelector('.commodityCd,.commodityCD')?.value?.trim()||'';
    if(meal&&commodity)commodityMeal.set(commodity,meal);
  });
}

function resolveMeal(commodity){
  if(!commodity)return '';
  if(!commodityMeal.has(commodity))scanCommodityMap();
  return commodityMeal.get(commodity)||'';
}

function refreshBlocks(){
  blocks.clear();

  document.querySelectorAll('.boxRestaurant04').forEach(box=>{
    const meal=getMealFromBox(box);
    const next=box.querySelector('.nextWeekLink');
    if(!meal||!next)return;

    const commodity=box.querySelector('.commodityCd,.commodityCD')?.value?.trim()||'';

    blocks.set(meal,{box,next,commodity});
    if(commodity)commodityMeal.set(commodity,meal);
    getState(meal);
  });

  createPanels();
  drainUnresolved();
}

function queueRefresh(){
  clearTimeout(refreshTimer);
  refreshTimer=setTimeout(refreshBlocks,100);
}

function createPanels(){
  if(!document.body)return;

  if(!panelRoot){
    panelRoot=document.createElement('div');

    Object.assign(panelRoot.style,{
      position:'fixed',
      top:'14px',
      right:'14px',
      zIndex:'2147483647',
      display:'flex',
      flexDirection:'column',
      gap:'5px'
    });

    document.body.appendChild(panelRoot);
  }

  MEALS.forEach((meal,i)=>{
    const s=getState(meal);

    if(!blocks.has(meal)){
      if(s.panel)s.panel.style.display='none';
      return;
    }

    if(!s.panel){
      const p=document.createElement('div');

      Object.assign(p.style,{
        order:String(i),
        width:'90px',
        height:'32px',
        padding:'6px 2px',
        borderRadius:'7px',
        boxSizing:'border-box',
        color:'#fff',
        fontSize:'13px',
        fontWeight:'700',
        textAlign:'center',
        cursor:'pointer',
        userSelect:'none',
        boxShadow:'0 2px 8px rgba(0,0,0,.25)',
        border:'1px solid rgba(0,0,0,.2)',
        fontFamily:'Arial,"Yu Gothic",sans-serif'
      });

      p.title=`${meal} 自動監視 ON / OFF`;
      p.onclick=()=>toggleMeal(meal);
      s.panel=p;
      panelRoot.appendChild(p);
    }

    s.panel.style.display='';
  });

  if(!notifyPanel){
    notifyPanel=document.createElement('div');

    Object.assign(notifyPanel.style,{
      order:'10',
      width:'90px',
      height:'32px',
      padding:'6px 2px',
      borderRadius:'7px',
      boxSizing:'border-box',
      fontSize:'13px',
      fontWeight:'700',
      textAlign:'center',
      cursor:'pointer',
      userSelect:'none',
      boxShadow:'0 2px 8px rgba(0,0,0,.25)',
      border:'1px solid rgba(0,0,0,.2)',
      fontFamily:'Arial,"Yu Gothic",sans-serif'
    });

    notifyPanel.title='Discord通知 ON / OFF';
    notifyPanel.onclick=toggleNotify;
    panelRoot.appendChild(notifyPanel);
  }

  renderPanels();
}

function toggleMeal(meal){
  const s=getState(meal);
  s.enabled=!s.enabled;

  localStorage.setItem(AUTO_PREFIX+meal,s.enabled?'1':'0');

  if(!s.enabled)clearTimer(s);
  else if(!s.pending&&!isMaintenance())fireSameWeek(meal);

  renderPanels();
}

function toggleNotify(){
  syncNotifyDay();
  notifyState.enabled=!notifyState.enabled;
  localStorage.setItem(NOTIFY_KEY,JSON.stringify(notifyState));
  renderPanels();
}

function clearTimer(s){
  if(s.timer)clearTimeout(s.timer);
  s.timer=null;
  s.deadline=0;
}

function schedule(meal){
  const s=getState(meal);
  clearTimer(s);

  if(!s.enabled||isMaintenance())return;

  s.deadline=performance.now()+WAIT;

  s.timer=setTimeout(()=>{
    s.timer=null;
    s.deadline=0;
    fireSameWeek(meal);
  },WAIT);
}

function renderPanels(){
  syncNotifyDay();

  const now=performance.now();
  const maintenance=isMaintenance();

  MEALS.forEach(meal=>{
    const s=mealStates.get(meal);
    if(!s?.panel||!blocks.has(meal))return;

    if(!s.enabled){
      s.panel.style.background='#555';
      s.panel.style.color='#fff';
      s.panel.textContent=`${meal} OFF`;
      return;
    }

    if(maintenance){
      s.panel.style.background='#777';
      s.panel.style.color='#fff';
      s.panel.textContent=`${meal} メンテ`;
      return;
    }

    if(s.error403){
      s.panel.style.background='#ff8c00';
      s.panel.style.color='#fff';

      if(s.pending>0){
        const sec=Math.floor((now-s.startedAt)/1000);
        s.panel.textContent=`${meal} 403 ${sec}`;
      }else if(s.deadline){
        const sec=Math.max(0,Math.ceil((s.deadline-now)/1000));
        s.panel.textContent=`${meal} 403 ${sec}`;
      }else{
        s.panel.textContent=`${meal} 403`;
      }
      return;
    }

    if(s.pending>0){
      const sec=Math.floor((now-s.startedAt)/1000);
      s.panel.style.background='#7b2cbf';
      s.panel.style.color='#fff';
      s.panel.textContent=`${meal} 読込 ${sec}`;
      return;
    }

    if(s.deadline){
      const sec=Math.max(0,Math.ceil((s.deadline-now)/1000));
      s.panel.style.background='#1976d2';
      s.panel.style.color='#fff';
      s.panel.textContent=`${meal} ON ${sec}`;
      return;
    }

    s.panel.style.background='#1976d2';
    s.panel.style.color='#fff';
    s.panel.textContent=`${meal} ON`;
  });

  if(notifyPanel){
    notifyPanel.style.background=notifyState.enabled?'#ffd43b':'#555';
    notifyPanel.style.color=notifyState.enabled?'#000':'#fff';
    notifyPanel.textContent=notifyState.enabled?'🔔 通知 ON':'🔕 通知 OFF';
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

    MEALS.forEach(meal=>{
      const s=mealStates.get(meal);
      if(s?.enabled&&!s.pending)fireSameWeek(meal);
    });

    console.log(`[${NAME}] メンテナンス終了・再開`);
  }

  renderPanels();
}

function fireSameWeek(meal){
  const s=getState(meal);
  if(!s.enabled||s.pending||isMaintenance())return;

  refreshBlocks();

  const block=blocks.get(meal);

  if(!block){
    console.warn(`[${NAME}] ${meal} DOM未検出`);
    schedule(meal);
    return;
  }

  const link=block.next;
  const header=link.closest('.header');
  const timeList=header?.nextElementSibling;
  const display=timeList?.querySelector('.date li:first-child .display');
  const jq=window.jQuery||window.$;
  const format=window.webapiFormat;

  if(!display||!jq?.datepicker||!format){
    console.warn(`[${NAME}] ${meal} 日付DOM/datepicker未検出`);
    schedule(meal);
    return;
  }

  const current=display.innerHTML.trim();
  let prev;

  try{
    const d=jq.datepicker.parseDate(format,current,{});
    d.setDate(d.getDate()-7);
    prev=jq.datepicker.formatDate(format,d,{});
  }catch(e){
    console.warn(`[${NAME}] ${meal} 日付変換失敗`,current,e);
    schedule(meal);
    return;
  }

  const hadNoData=link.classList.contains('hasNoData');
  const before=s.pending;

  display.innerHTML=prev;
  link.classList.remove('hasNoData');
  autoHint=meal;

  try{
    link.click();
  }catch(e){
    console.error(`[${NAME}] ${meal} 自動発火失敗`,e);
    sendErrorDiscord(meal,'自動発火エラー');
  }finally{
    autoHint='';
  }

  if(s.pending===before){
    const d2=block.box.querySelector('.timeList .date li:first-child .display');
    if(d2)d2.innerHTML=current;
    if(hadNoData)link.classList.add('hasNoData');

    console.warn(`[${NAME}] ${meal} ajaxNextWeekList未発火`);
    sendErrorDiscord(meal,'ajaxNextWeekList未発火');
    schedule(meal);
  }else{
    console.log(`[${NAME}] ${meal} 自動発火`);
  }
}

function bodyString(body){
  if(typeof body==='string')return body;
  if(body instanceof URLSearchParams)return body.toString();
  return '';
}

function watched(url){
  try{
    return PATHS.includes(new URL(url,location.href).pathname);
  }catch{
    return false;
  }
}

function addDays(v,n){
  if(!/^\d{8}$/.test(v||''))return v;

  const d=new Date(
    +v.slice(0,4),
    +v.slice(4,6)-1,
    +v.slice(6,8)
  );

  d.setDate(d.getDate()+n);

  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(v){
  return /^\d{8}$/.test(v||'')
    ?`${+v.slice(4,6)}/${+v.slice(6,8)}`
    :v;
}

function parseSlots(html,params){
  const start=params.get('useDate');
  if(!start)throw new Error('useDateなし');

  const doc=new DOMParser().parseFromString(html,'text/html');
  const lists=[...doc.querySelectorAll('.slider .view > ul.cf')];

  if(!lists.length)throw new Error('週間在庫DOMなし');

  const slots={};

  lists.forEach((ul,dayIndex)=>{
    const date=addDays(start,dayIndex);

    [...ul.children].forEach(li=>{
      const time=li.querySelector('.time')?.textContent?.trim();
      if(!time)return;

      let status='';

      if(li.classList.contains('reservationAble')){
        status='空席';
      }else if(li.classList.contains('full')){
        status='満席';
      }else{
        return;
      }

      slots[`${date}|${time}`]=status;
    });
  });

  return slots;
}

function snapshotKey(params){
  return [
    'commodityCD',
    'useDate',
    'adultNum',
    'childNum',
    'childAgeInform',
    'contentsCd',
    'nameCd',
    'wheelchairCount',
    'stretcherCount'
  ].map(k=>`${k}=${params.get(k)||''}`).join('&');
}

function compareAndSave(meta,html,meal){
  const params=new URLSearchParams(meta.body);
  const key=snapshotKey(params);
  const current=parseSlots(html,params);
  const previous=snapshots.get(key);

  snapshots.set(key,current);

  if(!previous)return [];

  const changes=[];
  const prevKeys=new Set(Object.keys(previous));
  const currKeys=new Set(Object.keys(current));

  // 1. 時間枠の増加
  currKeys.forEach(slot=>{
    if(prevKeys.has(slot))return;

    const [date,time]=slot.split('|');

    changes.push({
      type:'added',
      meal,
      date,
      time,
      to:current[slot]
    });
  });

  // 2. 時間枠の減少
  prevKeys.forEach(slot=>{
    if(currKeys.has(slot))return;

    const [date,time]=slot.split('|');

    changes.push({
      type:'deleted',
      meal,
      date,
      time
    });
  });

  // 3. 共通時間枠の空席・満席変化
  currKeys.forEach(slot=>{
    if(!prevKeys.has(slot))return;

    const from=previous[slot];
    const to=current[slot];

    if(from===to)return;

    const [date,time]=slot.split('|');

    changes.push({
      type:'changed',
      meal,
      date,
      time,
      from,
      to
    });
  });

  return changes;
}

const nativeOpen=XMLHttpRequest.prototype.open;
const nativeSend=XMLHttpRequest.prototype.send;

XMLHttpRequest.prototype.open=function(method,url,...args){
  this.__tdrWeek={
    method:String(method||'GET').toUpperCase(),
    url
  };

  return nativeOpen.call(this,method,url,...args);
};

XMLHttpRequest.prototype.send=function(body){
  const x=this.__tdrWeek;

  if(x?.method==='POST'&&watched(x.url)){
    const str=bodyString(body);
    const params=new URLSearchParams(str);
    const commodity=params.get('commodityCD')||'';
    const meal=autoHint||resolveMeal(commodity);

    const meta={
      body:str,
      commodity,
      url:x.url,
      pendingTimer:null
    };

    if(meal){
      const s=getState(meal);

      clearTimer(s);

      if(s.pending++===0){
        s.startedAt=performance.now();
      }

      renderPanels();
    }

    meta.pendingTimer=setTimeout(()=>{
      const pendingMeal=meal||resolveMeal(commodity)||'食事区分不明';

      console.warn(`[${NAME}] ${pendingMeal} Pending 5分超過`);
      sendErrorDiscord(
        pendingMeal,
        'Pending 5分超過',
        meta.url
      );
    },PENDING_ERROR_MS);

    this.addEventListener('loadend',()=>{
      clearTimeout(meta.pendingTimer);

      let text='';

      try{
        text=this.responseText||'';
      }catch{}

      const resolved=meal||resolveMeal(commodity);

      if(!resolved){
        unresolved.push({
          meta,
          status:this.status,
          text
        });

        queueRefresh();
        return;
      }

      finishRequest(
        resolved,
        meta,
        this.status,
        text
      );
    },{once:true});
  }

  return nativeSend.call(this,body);
};

function finishRequest(meal,meta,status,text){
  const s=getState(meal);

  if(status===403){
    s.error403=true;
    sendErrorDiscord(meal,'HTTP 403',meta.url);

  }else if(status<200||status>=300){
    sendErrorDiscord(
      meal,
      status===0?'通信失敗（status 0）':`HTTP ${status}`,
      meta.url
    );

  }else if(!text){
    sendErrorDiscord(meal,'空レスポンス',meta.url);

  }else if(text.includes('paramErrorDiv')){
    sendErrorDiscord(
      meal,
      'サイト内部エラー（paramErrorDiv）',
      meta.url
    );

  }else{
    try{
      const changes=compareAndSave(meta,text,meal);

      s.error403=false;

      if(changes.length){
        sendDiscord(changes);
      }

    }catch(e){
      console.error(`[${NAME}] ${meal} 解析失敗`,e);

      sendErrorDiscord(
        meal,
        `Response解析エラー：${e.message||e}`,
        meta.url
      );
    }
  }

  if(s.pending>0)s.pending--;

  if(!s.pending){
    s.startedAt=0;
    schedule(meal);
  }

  queueRefresh();
  renderPanels();
}

function drainUnresolved(){
  for(let i=unresolved.length-1;i>=0;i--){
    const x=unresolved[i];
    const meal=commodityMeal.get(x.meta.commodity)||'';

    if(!meal)continue;

    unresolved.splice(i,1);

    finishRequest(
      meal,
      x.meta,
      x.status,
      x.text
    );
  }
}

function postDiscord(description,color){
  syncNotifyDay();

  if(!notifyState.enabled)return;

  const webhook=window.TDR_WEBHOOKS?.restaurant;
  if(!webhook)return;

  fetch(webhook,{
    method:'POST',
    headers:{
      'Content-Type':'application/json'
    },
    body:JSON.stringify({
      username:NAME,
      embeds:[{
        description:description.slice(0,4000),
        color
      }]
    })
  }).catch(e=>{
    console.error(`[${NAME}] Discord通知失敗`,e);
  });
}

function statusText(status){
  return status==='空席'
    ?'🟥空席'
    :'⬛満席';
}

function sendDiscord(changes){
  changes.sort((a,b)=>
    a.date.localeCompare(b.date)||
    MEALS.indexOf(a.meal)-MEALS.indexOf(b.meal)||
    a.time.localeCompare(b.time)
  );

  const lines=[restaurantName()];
  let group='';

  changes.forEach(c=>{
    const g=`${c.date}|${c.meal}`;

    if(g!==group){
      if(group)lines.push('');
      lines.push(`【${fmtDate(c.date)} ${c.meal}】`);
      group=g;
    }

    if(c.type==='added'){
      lines.push(
        `${c.time}　新規枠追加（${statusText(c.to)}）`
      );

    }else if(c.type==='deleted'){
      lines.push(
        `${c.time}　時間枠削除`
      );

    }else{
      lines.push(
        `${c.time}　${statusText(c.from)} → ${statusText(c.to)}`
      );
    }
  });

  postDiscord(
    lines.join('\n'),
    YELLOW
  );
}

function sendErrorDiscord(meal,error,url=''){
  syncNotifyDay();

  if(!notifyState.enabled)return;

  const key=`${meal}|${error}`;
  const now=Date.now();

  if(now-(errorNotifyHistory.get(key)||0)<60000)return;

  errorNotifyHistory.set(key,now);

  const d=new Date();

  const time=
    `${d.getMonth()+1}/${d.getDate()} `+
    `${String(d.getHours()).padStart(2,'0')}:`+
    `${String(d.getMinutes()).padStart(2,'0')}:`+
    `${String(d.getSeconds()).padStart(2,'0')}`;

  let path='';

  try{
    path=new URL(url,location.href).pathname;
  }catch{}

  postDiscord(
    [
      restaurantName(),
      `【${meal}】`,
      `⚠️ ${error}`,
      path?`🌐 ${path}`:'',
      `🕐 ${time}`
    ].filter(Boolean).join('\n'),
    ORANGE
  );
}

function init(){
  refreshBlocks();

  setTimeout(refreshBlocks,300);
  setTimeout(refreshBlocks,1000);

  if(document.body){
    new MutationObserver(ms=>{
      if(ms.some(m=>!panelRoot?.contains(m.target))){
        queueRefresh();
      }
    }).observe(document.body,{
      childList:true,
      subtree:true
    });
  }
}

if(document.readyState==='loading'){
  document.addEventListener(
    'DOMContentLoaded',
    init,
    {once:true}
  );
}else{
  init();
}

setInterval(()=>{
  maintenanceTick();
  renderPanels();
},UI_TICK);

console.log(`[${NAME}] v1.51 起動`);
})();
