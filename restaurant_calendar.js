// ==UserScript==
// @name         🍴💻️レストラン週間モニター
// @version      1.62
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
const AUTO_PREFIX='tdr_weekly_restaurant_auto_',OLD_AUTO_KEY='tdr_weekly_restaurant_auto',NOTIFY_KEY='tdr_weekly_restaurant_notify';
const MEALS=['朝食','昼食','夕食'];
const PATHS=['/restaurant/weekReservation/','/restaurant/ajaxNextWeekList/','/restaurant/ajaxPreWeekList/'];
const blocks=new Map(),commodityMeal=new Map(),mealStates=new Map(),snapshots=new Map(),unresolved=[],errorNotifyHistory=new Map();

let panelRoot=null,notifyPanel=null,autoHint='',refreshTimer=null,wasMaintenance=isMaintenance(),notifyState=loadNotifyState();

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
  return document.querySelector('.boxRestaurant02 .header h1.heading')
    ?.textContent.replace(/\s+/g,' ').trim()||'レストラン名取得失敗';
}
function getState(meal){
  if(mealStates.has(meal))return mealStates.get(meal);
  const saved=localStorage.getItem(AUTO_PREFIX+meal),old=localStorage.getItem(OLD_AUTO_KEY);
  const s={
    meal,
    enabled:saved!==null?saved!=='0':old!=='0',
    pending:0,
    startedAt:0,
    deadline:0,
    timer:null,
    panel:null,
    error403:false,
    pendingError:false
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
  const now=performance.now(),maintenance=isMaintenance();

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
      s.panel.style.color='#000';
      s.panel.textContent=s.deadline
        ?`${meal} 403 ${Math.max(0,Math.ceil((s.deadline-now)/1000))}`
        :`${meal} 403`;
      return;
    }

    if(s.pendingError){
      s.panel.style.background='#ff8c00';
      s.panel.style.color='#000';
      s.panel.textContent=`${meal} 5分超`;
      return;
    }

    if(s.pending>0){
      s.panel.style.background='#7b2cbf';
      s.panel.style.color='#fff';
      s.panel.textContent=`${meal} 読込 ${Math.floor((now-s.startedAt)/1000)}`;
      return;
    }

    if(s.deadline){
      s.panel.style.background='#1976d2';
      s.panel.style.color='#fff';
      s.panel.textContent=`${meal} ON ${Math.max(0,Math.ceil((s.deadline-now)/1000))}`;
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
    schedule(meal);
    return;
  }

  const link=block.next;
  const display=link.closest('.header')
    ?.nextElementSibling
    ?.querySelector('.date li:first-child .display');

  const jq=window.jQuery||window.$;
  const format=window.webapiFormat;

  if(!display||!jq?.datepicker||!format){
    console.warn(`[${NAME}] ${meal} 日付DOM未検出`);
    schedule(meal);
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
    schedule(meal);
    return;
  }

  const hadNoData=link.classList.contains('hasNoData');
  const before=s.pending;

  display.textContent=prev;
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
    if(d2)d2.textContent=current;
    if(hadNoData)link.classList.add('hasNoData');

    sendErrorDiscord(meal,'ajaxNextWeekList未発火');
    schedule(meal);
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
function has(obj,key){
  return Object.prototype.hasOwnProperty.call(obj,key);
}
function slotStatus(li){
  if(
    li.classList.contains('reservationAble')||
    li.querySelector('a[onclick*="toOrderForWeek"]')||
    li.querySelector('img[alt="予約する"]')
  )return '空席';

  if(
    li.classList.contains('full')||
    li.querySelector('.text')?.textContent.includes('満席')
  )return '満席';

  return '不明';
}

function readCurrentSlots(meal){
  const block=blocks.get(meal);
  if(!block)throw new Error('食事区分DOMなし');

  const dates=[...block.box.querySelectorAll('.timeList .date li .display')]
    .map(e=>e.textContent.trim())
    .filter(Boolean);

  const lists=[...block.box.querySelectorAll('.timeTable .slider .view > ul.cf')];

  if(!dates.length)throw new Error('日付DOMなし');
  if(!lists.length)throw new Error('週間在庫DOMなし');
  if(dates.length!==lists.length)throw new Error(`週間DOM不整合 ${dates.length}/${lists.length}`);

  const slots={};

  lists.forEach((ul,i)=>{
    const date=dates[i];

    [...ul.children].forEach(li=>{
      const time=li.querySelector('.time')?.textContent?.trim();

      // 時間が存在する = 時間枠あり
      if(!time)return;

      slots[`${date}|${time}`]=slotStatus(li);
    });
  });

  return {
    weekStart:dates[0],
    weekEnd:dates[dates.length-1],
    slots
  };
}

function snapshotKey(meta,meal,current){
  const p=new URLSearchParams(meta.body);

  return [
    meal,
    p.get('commodityCD')||'',
    current.weekStart,
    current.weekEnd,
    p.get('adultNum')||'',
    p.get('childNum')||'',
    p.get('childAgeInform')||'',
    p.get('wheelchairCount')||'',
    p.get('stretcherCount')||''
  ].join('|');
}

function compareAndSave(meta,meal,current){
  const key=snapshotKey(meta,meal,current);
  const previous=snapshots.get(key);

  if(!previous){
    snapshots.set(key,current.slots);
    return [];
  }

  const prev=previous;
  const curr=current.slots;
  const changes=[];

  // 1. 時間枠の増減を最優先
  Object.keys(curr).forEach(slot=>{
    if(has(prev,slot))return;

    const [date,time]=slot.split('|');

    changes.push({
      type:'added',
      meal,
      date,
      time,
      to:curr[slot]
    });
  });

  Object.keys(prev).forEach(slot=>{
    if(has(curr,slot))return;

    const [date,time]=slot.split('|');

    changes.push({
      type:'deleted',
      meal,
      date,
      time
    });
  });

  // 2. 両方に存在する時間枠だけ空席・満席を比較
  Object.keys(curr).forEach(slot=>{
    if(!has(prev,slot))return;

    const from=prev[slot];
    const to=curr[slot];

    if(from==='不明'||to==='不明'||from===to)return;

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

  // 状態不明でも時間枠の存在は保持。
  // 前回状態が判明済みなら、その状態だけ保持する。
  const next={};

  Object.keys(curr).forEach(slot=>{
    next[slot]=
      curr[slot]==='不明'&&has(prev,slot)&&prev[slot]!=='不明'
        ?prev[slot]
        :curr[slot];
  });

  snapshots.set(key,next);
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
      pendingTimer:null
    };

    if(meal){
      const s=getState(meal);
      clearTimer(s);

      if(s.pending++===0){
        s.startedAt=performance.now();
        s.pendingError=false;
      }

      renderPanels();
    }

    meta.pendingTimer=setTimeout(()=>{
      const pendingMeal=meal||resolveMeal(commodity)||'食事区分不明';
      const s=mealStates.get(pendingMeal);

      if(s)s.pendingError=true;

      renderPanels();
      sendErrorDiscord(pendingMeal,'Pending 5分超過');
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

      // 公式サイト側のsuccess処理によるDOM更新後に判定
      setTimeout(()=>{
        finishRequest(
          resolved,
          meta,
          this.status,
          text
        );
      },30);

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
    sendErrorDiscord(
      meal,
      status===0?'通信失敗（status 0）':`HTTP ${status}`
    );

  }else if(!text){
    sendErrorDiscord(meal,'空レスポンス');

  }else if(text.includes('paramErrorDiv')){
    sendErrorDiscord(meal,'サイト内部エラー（paramErrorDiv）');

  }else{
    try{
      refreshBlocks();

      const current=readCurrentSlots(meal);
      const changes=compareAndSave(meta,meal,current);

      s.error403=false;

      if(changes.length){
        sendDiscord(changes);
      }

    }catch(e){
      console.error(`[${NAME}] ${meal} 解析失敗`,e);
      sendErrorDiscord(
        meal,
        `Response解析エラー：${e.message||e}`
      );
    }
  }

  if(s.pending>0)s.pending--;

  if(!s.pending){
    s.startedAt=0;
    s.pendingError=false;
    schedule(meal);
  }

  queueRefresh();
  renderPanels();
}

function drainUnresolved(){
  for(let i=unresolved.length-1;i>=0;i--){
    const x=unresolved[i];
    const meal=resolveMeal(x.meta.commodity);

    if(!meal)continue;

    unresolved.splice(i,1);

    setTimeout(()=>{
      finishRequest(
        meal,
        x.meta,
        x.status,
        x.text
      );
    },30);
  }
}

function statusText(status){
  if(status==='空席')return '🟥空席';
  if(status==='満席')return '⬛満席';
  return '状態不明';
}

function postDiscord(description,color){
  syncNotifyDay();

  if(!notifyState.enabled)return;

  const webhook=window.TDR_WEBHOOKS?.restaurant;
  if(!webhook)return;

  fetch(webhook,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
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
      lines.push(
        `【${+c.date.slice(4,6)}/${+c.date.slice(6,8)} ${c.meal}】`
      );
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

async function getPublicIp(){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),IP_TIMEOUT);

  try{
    const r=await fetch(
      'https://api.ipify.org?format=json',
      {
        cache:'no-store',
        signal:controller.signal
      }
    );

    if(!r.ok)throw new Error(`HTTP ${r.status}`);

    const data=await r.json();
    return data.ip||'取得不可';

  }catch(e){
    console.warn(`[${NAME}] IP取得失敗`,e);
    return '取得不可';

  }finally{
    clearTimeout(timer);
  }
}

async function sendErrorDiscord(meal,error){
  syncNotifyDay();

  if(!notifyState.enabled)return;

  const key=`${meal}|${error}`;
  const now=Date.now();

  if(now-(errorNotifyHistory.get(key)||0)<60000)return;
  errorNotifyHistory.set(key,now);

  const ip=await getPublicIp();
  const d=new Date();

  const time=
    `${d.getMonth()+1}/${d.getDate()} `+
    `${String(d.getHours()).padStart(2,'0')}:`+
    `${String(d.getMinutes()).padStart(2,'0')}:`+
    `${String(d.getSeconds()).padStart(2,'0')}`;

  postDiscord(
    [
      restaurantName(),
      `【${meal}】`,
      `⚠️ ${error}`,
      `🌍 IP：${ip}`,
      `🕐 ${time}`
    ].join('\n'),
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

console.log(`[${NAME}] v1.62 起動`);
})();
