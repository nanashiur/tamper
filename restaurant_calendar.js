// ==UserScript==
// @name         🍴💻️レストラン週間モニター
// @version      2.12
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
const WAIT=60000,UI_TICK=1000,PENDING_ERROR_MS=300000,IP_TIMEOUT=5000,MAX_ERRORS=5;
const RED=0xFF0000,BLACK=0x000001,BLUE=0x007BFF,GREEN=0x28A745,ORANGE=0xFFA500;
const AUTO_PREFIX='tdr_weekly_restaurant_auto_',OLD_AUTO_KEY='tdr_weekly_restaurant_auto';
const NOTIFY_KEY='tdr_weekly_restaurant_notify_v2',OLD_NOTIFY_KEY='tdr_weekly_restaurant_notify',OLD_NOTIFY_MODE_KEY='tdr_weekly_restaurant_notify_mode';
const MEALS=['朝食','昼食','夕食'];
const PATHS=['/restaurant/weekReservation/','/restaurant/ajaxNextWeekList/','/restaurant/ajaxPreWeekList/'];
const blocks=new Map(),commodityMeal=new Map(),mealStates=new Map(),snapshots=new Map(),unresolved=[],errorNotifyHistory=new Map();

let panelRoot=null,notifyPanel=null,autoHint='',refreshTimer=null,wasMaintenance=isMaintenance(),notifyState=loadNotifyState();

function ymd(){
  const d=new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}

function nowText(){
  const d=new Date();
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function fmtDateJa(v){
  const y=+v.slice(0,4),m=+v.slice(4,6),d=+v.slice(6,8),dt=new Date(y,m-1,d);
  return `${y}年${m}月${d}日（${'日月火水木金土'[dt.getDay()]}）`;
}

function isMaintenance(){
  const h=new Date().getHours();
  return h>=3&&h<5;
}

function loadNotifyState(){
  try{
    const v=JSON.parse(localStorage.getItem(NOTIFY_KEY)||'null');
    if(v?.date===ymd()&&['all','vacancy','off'].includes(v.mode))return v;
  }catch{}

  let mode='all';

  try{
    const old=JSON.parse(localStorage.getItem(OLD_NOTIFY_KEY)||'null');
    if(old?.date===ymd()){
      if(old.enabled===false)mode='off';
      else if(localStorage.getItem(OLD_NOTIFY_MODE_KEY)==='noFull')mode='vacancy';
    }
  }catch{}

  const v={date:ymd(),mode};
  localStorage.setItem(NOTIFY_KEY,JSON.stringify(v));
  return v;
}

function syncNotifyDay(){
  if(notifyState.date!==ymd()){
    notifyState={date:ymd(),mode:'all'};
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
    row:null,
    manual:null,
    panel:null,
    error403:false,
    consecutiveErrors:0,
    forcedStopError:false,
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

function baseButtonStyle(el){
  Object.assign(el.style,{
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
      if(s.row)s.row.style.display='none';
      return;
    }

    if(!s.row){
      const row=document.createElement('div');
      Object.assign(row.style,{order:String(i),display:'flex',gap:'5px'});

      const manual=document.createElement('div');
      baseButtonStyle(manual);
      Object.assign(manual.style,{
        width:'32px',
        background:'#444',
        color:'#fff',
        fontSize:'18px',
        padding:'3px 0'
      });
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

      s.row=row;
      s.manual=manual;
      s.panel=panel;
    }

    s.row.style.display='flex';
  });

  if(!notifyPanel){
    notifyPanel=document.createElement('div');
    baseButtonStyle(notifyPanel);
    Object.assign(notifyPanel.style,{order:'10',width:'127px'});
    notifyPanel.title='通知モード：全通知 → 空席通知 → OFF';
    notifyPanel.onclick=toggleNotify;
    panelRoot.appendChild(notifyPanel);
  }

  renderPanels();
}

function toggleMeal(meal){
  const s=getState(meal);
  s.enabled=!s.enabled;

  if(s.enabled){
    s.consecutiveErrors=0;
    s.forcedStopError=false;
    s.error403=false;
    s.pendingError=false;
  }

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

  notifyState.mode=
    notifyState.mode==='all'
      ?'vacancy'
      :notifyState.mode==='vacancy'
        ?'off'
        :'all';

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
    fireSameWeek(meal,false);
  },WAIT);
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
      s.panel.style.background='#777';
      s.panel.style.color='#fff';
      s.panel.textContent=`${meal} メンテ`;
      return;
    }

    if(s.forcedStopError){
      s.panel.style.background='#ff8c00';
      s.panel.style.color='#000';
      s.panel.textContent=`${meal} STOP`;
      s.panel.title=`エラー${MAX_ERRORS}回連続 / 自動読込強制停止 / クリックで再開`;
      return;
    }

    s.panel.title=`${meal} 自動監視 ON / OFF`;

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

    if(!s.enabled){
      s.panel.style.background='#555';
      s.panel.style.color='#fff';
      s.panel.textContent=`${meal} OFF`;
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
    if(notifyState.mode==='all'){
      notifyPanel.style.background='#ffc107';
      notifyPanel.style.color='#000';
      notifyPanel.textContent='📢 全通知';

    }else if(notifyState.mode==='vacancy'){
      notifyPanel.style.background='#ff0000';
      notifyPanel.style.color='#fff';
      notifyPanel.textContent='🔴 空席通知';

    }else{
      notifyPanel.style.background='#333';
      notifyPanel.style.color='#fff';
      notifyPanel.textContent='🔕 OFF';
    }
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
      if(s?.enabled&&!s.pending)fireSameWeek(meal,false);
    });

    console.log(`[${NAME}] メンテナンス終了・再開`);
  }

  renderPanels();
}

function recordError(meal,error,count=true){
  const s=getState(meal);

  if(count&&!s.forcedStopError){
    s.consecutiveErrors++;

    console.warn(
      `[${NAME}] ${meal} 連続エラー ${s.consecutiveErrors}/${MAX_ERRORS}：${error}`
    );

    if(s.consecutiveErrors>=MAX_ERRORS){
      forceStopError(meal,error);
      return;
    }
  }

  sendErrorDiscord(meal,error);
  renderPanels();
}

function resetErrors(meal){
  const s=getState(meal);

  if(s.consecutiveErrors){
    console.log(
      `[${NAME}] ${meal} 正常読込 / 連続エラー ${s.consecutiveErrors} → 0`
    );
  }

  s.consecutiveErrors=0;
  s.forcedStopError=false;
  s.error403=false;
  s.pendingError=false;
}

function forceStopError(meal,lastError){
  const s=getState(meal);

  if(s.forcedStopError)return;

  s.forcedStopError=true;
  s.enabled=false;

  clearTimer(s);

  localStorage.setItem(
    AUTO_PREFIX+meal,
    '0'
  );

  console.warn(
    `[${NAME}] ${meal} エラー${MAX_ERRORS}回連続 / 自動読込強制停止`
  );

  sendForceStopDiscord(
    meal,
    lastError
  );

  renderPanels();
}

function fireSameWeek(meal,manual=false){
  const s=getState(meal);

  if((!manual&&!s.enabled)||s.pending||isMaintenance())return;

  refreshBlocks();

  const block=blocks.get(meal);

  if(!block){
    if(!manual)schedule(meal);
    return;
  }

  const link=block.next;

  const display=
    link.closest('.header')
      ?.nextElementSibling
      ?.querySelector('.date li:first-child .display');

  const jq=window.jQuery||window.$;
  const format=window.webapiFormat;

  if(!display||!jq?.datepicker||!format){
    console.warn(`[${NAME}] ${meal} 日付DOM未検出`);
    recordError(meal,'日付DOM未検出');
    if(!manual&&s.enabled)schedule(meal);
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
    recordError(meal,'日付変換失敗');
    if(!manual&&s.enabled)schedule(meal);
    return;
  }

  const hadNoData=link.classList.contains('hasNoData');
  const before=s.pending;

  display.textContent=prev;
  link.classList.remove('hasNoData');
  autoHint=meal;

  let fireError='';

  try{
    link.click();

  }catch(e){
    console.error(`[${NAME}] ${meal} 発火失敗`,e);
    fireError='発火エラー';

  }finally{
    autoHint='';
  }

  if(s.pending===before){
    const d2=block.box.querySelector('.timeList .date li:first-child .display');

    if(d2)d2.textContent=current;
    if(hadNoData)link.classList.add('hasNoData');

    recordError(
      meal,
      fireError||'ajaxNextWeekList未発火'
    );

    if(!manual&&s.enabled)schedule(meal);
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

  const dates=[
    ...block.box.querySelectorAll('.timeList .date li .display')
  ].map(e=>e.textContent.trim()).filter(Boolean);

  const lists=[
    ...block.box.querySelectorAll('.timeTable .slider .view > ul.cf')
  ];

  if(!dates.length)throw new Error('日付DOMなし');
  if(!lists.length)throw new Error('週間在庫DOMなし');

  if(dates.length!==lists.length){
    throw new Error(`週間DOM不整合 ${dates.length}/${lists.length}`);
  }

  const slots={};

  lists.forEach((ul,i)=>{
    const date=dates[i];

    [...ul.children].forEach(li=>{
      const time=li.querySelector('.time')?.textContent?.trim();

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

  const next={};

  Object.keys(curr).forEach(slot=>{
    next[slot]=
      curr[slot]==='不明'&&
      has(prev,slot)&&
      prev[slot]!=='不明'
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
      pendingTimer:null,
      errorCounted:false
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
      const pendingMeal=meal||resolveMeal(commodity);

      if(pendingMeal){
        const s=getState(pendingMeal);
        s.pendingError=true;

        if(!meta.errorCounted){
          meta.errorCounted=true;
          recordError(
            pendingMeal,
            'Pending 5分超過'
          );
        }

      }else{
        sendErrorDiscord(
          '食事区分不明',
          'Pending 5分超過'
        );
      }

      renderPanels();

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

function requestError(meal,meta,error){
  const count=!meta.errorCounted;
  meta.errorCounted=true;
  recordError(meal,error,count);
}

function finishRequest(meal,meta,status,text){
  const s=getState(meal);

  if(status!==403){
    s.error403=false;
  }

  if(status===403){
    s.error403=true;

    requestError(
      meal,
      meta,
      'HTTP 403'
    );

  }else if(status<200||status>=300){
    requestError(
      meal,
      meta,
      status===0
        ?'通信失敗（status 0）'
        :`HTTP ${status}`
    );

  }else if(!text){
    requestError(
      meal,
      meta,
      '空レスポンス'
    );

  }else if(text.includes('paramErrorDiv')){
    requestError(
      meal,
      meta,
      'サイト内部エラー（paramErrorDiv）'
    );

  }else{
    try{
      refreshBlocks();

      const current=readCurrentSlots(meal);

      const changes=compareAndSave(
        meta,
        meal,
        current
      );

      resetErrors(meal);

      if(changes.length){
        sendChangesDiscord(changes);
      }

    }catch(e){
      console.error(
        `[${NAME}] ${meal} 解析失敗`,
        e
      );

      requestError(
        meal,
        meta,
        `Response解析エラー：${e.message||e}`
      );
    }
  }

  if(s.pending>0)s.pending--;

  if(!s.pending){
    s.startedAt=0;
    s.pendingError=false;

    if(s.enabled){
      schedule(meal);
    }
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

function sortChanges(changes){
  return [...changes].sort(
    (a,b)=>
      a.date.localeCompare(b.date)||
      MEALS.indexOf(a.meal)-MEALS.indexOf(b.meal)||
      a.time.localeCompare(b.time)
  );
}

function groupDateMeal(changes){
  const map=new Map();

  sortChanges(changes).forEach(c=>{
    const key=`${c.date}|${c.meal}`;

    if(!map.has(key)){
      map.set(key,{
        date:c.date,
        meal:c.meal,
        changes:[]
      });
    }

    map.get(key).changes.push(c);
  });

  return [...map.values()];
}

function buildTitle(icon,date,meal){
  return [
    `${icon}${nowText()}`,
    restaurantName(),
    `${fmtDateJa(date)} 【${meal}】`
  ].join('\n');
}

function buildTimeOnlyDescription(changes){
  const times=sortChanges(changes).map(c=>c.time);
  const lines=[];

  for(let i=0;i<times.length;i+=2){
    lines.push(
      times.slice(i,i+2).join(' ')
    );
  }

  return lines.join('\n');
}

function buildAddedDescription(changes){
  return sortChanges(changes)
    .map(c=>{
      const state=
        c.to==='空席'
          ?'🔴空席'
          :c.to==='満席'
            ?'⚫️満席'
            :'状態不明';

      return `${c.time}　🔵新規（${state}）`;
    })
    .join('\n');
}

function buildDeletedDescription(changes){
  return sortChanges(changes)
    .map(c=>`${c.time}　🟢削除`)
    .join('\n');
}

function postDiscord(title,description,color){
  const webhook=window.TDR_WEBHOOKS?.restaurant;

  if(!webhook)return;

  fetch(webhook,{
    method:'POST',
    headers:{
      'Content-Type':'application/json'
    },
    keepalive:true,
    body:JSON.stringify({
      username:NAME,
      embeds:[{
        title:title.slice(0,256),
        description:description.slice(0,4000),
        color
      }]
    })
  }).catch(e=>{
    console.error(
      `[${NAME}] Discord通知失敗`,
      e
    );
  });
}

function sendChangesDiscord(changes){
  syncNotifyDay();

  const added=changes.filter(c=>c.type==='added');
  const deleted=changes.filter(c=>c.type==='deleted');
  let normal=changes.filter(c=>c.type==='changed');

  if(notifyState.mode==='off'){
    normal=[];

  }else if(notifyState.mode==='vacancy'){
    normal=normal.filter(c=>c.to==='空席');
  }

  groupDateMeal(added).forEach(group=>{
    postDiscord(
      buildTitle(
        '🔵',
        group.date,
        group.meal
      ),
      buildAddedDescription(
        group.changes
      ),
      BLUE
    );
  });

  groupDateMeal(deleted).forEach(group=>{
    postDiscord(
      buildTitle(
        '🟢',
        group.date,
        group.meal
      ),
      buildDeletedDescription(
        group.changes
      ),
      GREEN
    );
  });

  const vacancy=normal.filter(c=>c.to==='空席');
  const full=normal.filter(c=>c.to==='満席');

  groupDateMeal(vacancy).forEach(group=>{
    postDiscord(
      buildTitle(
        '🔴',
        group.date,
        group.meal
      ),
      buildTimeOnlyDescription(
        group.changes
      ),
      RED
    );
  });

  groupDateMeal(full).forEach(group=>{
    postDiscord(
      buildTitle(
        '⚫️',
        group.date,
        group.meal
      ),
      buildTimeOnlyDescription(
        group.changes
      ),
      BLACK
    );
  });
}

async function getPublicIp(){
  const controller=new AbortController();

  const timer=setTimeout(
    ()=>controller.abort(),
    IP_TIMEOUT
  );

  try{
    const r=await fetch(
      'https://api.ipify.org?format=json',
      {
        cache:'no-store',
        signal:controller.signal
      }
    );

    if(!r.ok){
      throw new Error(
        `HTTP ${r.status}`
      );
    }

    const data=await r.json();

    return data.ip||'取得失敗';

  }catch(e){
    console.warn(
      `[${NAME}] IP取得失敗`,
      e
    );

    return '取得失敗';

  }finally{
    clearTimeout(timer);
  }
}

async function sendErrorDiscord(meal,error){
  const key=`${meal}|${error}`;
  const now=Date.now();

  if(
    now-
    (
      errorNotifyHistory.get(key)||
      0
    )<
    60000
  ){
    return;
  }

  errorNotifyHistory.set(
    key,
    now
  );

  const ip=await getPublicIp();

  postDiscord(
    [
      `🟠${nowText()}`,
      restaurantName(),
      `【${meal}】`
    ].join('\n'),
    [
      `エラー：${error}`,
      `公開IP：${ip}`
    ].join('\n'),
    ORANGE
  );
}

async function sendForceStopDiscord(meal,lastError){
  const ip=await getPublicIp();

  postDiscord(
    [
      `🔶${nowText()}`,
      restaurantName(),
      `【${meal}】`
    ].join('\n'),
    [
      `エラーが${MAX_ERRORS}回連続しました。`,
      '安全のため自動読込を停止しました。',
      `最後のエラー：${lastError}`,
      `公開IP：${ip}`
    ].join('\n'),
    ORANGE
  );
}

function snapshotText(){
  if(!snapshots.size){
    return 'スナップショットなし';
  }

  const out=[];

  snapshots.forEach((slots,key)=>{
    const p=key.split('|');
    const meal=p[0];
    const start=p[2];
    const end=p[3];

    out.push(
      `=== ${meal}｜${start}～${end} ===`
    );

    Object.keys(slots)
      .sort()
      .forEach(k=>{
        out.push(
          `${k} = ${slots[k]}`
        );
      });

    out.push('');
  });

  return out.join('\n').trim();
}

window.SNAPSHOT=()=>{
  const text=snapshotText();

  console.log(text);

  if(navigator.clipboard?.writeText){
    navigator.clipboard
      .writeText(text)
      .then(()=>{
        console.log(
          `[${NAME}] スナップショットをクリップボードへコピーしました`
        );
      })
      .catch(()=>{});
  }

  return text;
};

function init(){
  refreshBlocks();

  setTimeout(
    refreshBlocks,
    300
  );

  setTimeout(
    refreshBlocks,
    1000
  );

  if(document.body){
    new MutationObserver(ms=>{
      if(
        ms.some(
          m=>!panelRoot?.contains(m.target)
        )
      ){
        queueRefresh();
      }
    }).observe(
      document.body,
      {
        childList:true,
        subtree:true
      }
    );
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

console.log(
  `[${NAME}] v2.12 起動`
);
})();
