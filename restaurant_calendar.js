// ==UserScript==
// @name         🍴💻️レストラン週間モニター
// @version      4.37
// @match        https://reserve.tokyodisneyresort.jp/restaurant/calendar/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_calendar.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_calendar.js
// @grant        none
// @run-at       document-start
// ==/UserScript==

(()=>{
'use strict';
if(window.__tdr_weekly_restaurant_monitor)return;
window.__tdr_weekly_restaurant_monitor=true;

const NAME='🍴💻️レストラン週間モニター',SCRIPT_STARTED_AT=Date.now();
const UI_TICK=1000,PENDING_ERROR_MS=300000,IP_TIMEOUT=5000,MAX_ERRORS=5,VACANCY_RENOTIFY_MS=3600000,FORCE_LOG_NOISE_MS=600000,START_SNAPSHOT_THRESHOLD_MS=3600000;
const RED=0xFF0000,BLACK=0x000001,BLUE=0x3498DB,ORANGE=0xFFA500,GRAY=0x808080,YELLOW=0xFFD700,GOLD=0xFFD700,PURPLE=0x9B59B6;
const AUTO_MODE_PREFIX='tdr_weekly_restaurant_auto_mode_',AUTO_PREFIX='tdr_weekly_restaurant_auto_',OLD_AUTO_KEY='tdr_weekly_restaurant_auto';
const NOTIFY_KEY='tdr_weekly_restaurant_notify_v3',RESEARCH_NOTIFY_KEY='tdr_weekly_restaurant_research_notify_v1',DATE_SELECT_KEY='tdr_weekly_restaurant_date_select_v1';
const RESEARCH_KEY='tdr_weekly_restaurant_9am_mode_v3',RESEARCH_PREV_AUTO_KEY='tdr_weekly_restaurant_9am_prev_auto_v4',RESEARCH_BASELINE_KEY='tdr_weekly_restaurant_9am_baseline_v3',RESEARCH_857_RUN_KEY='tdr_weekly_restaurant_857_run_date_v3',RESEARCH_900_RUN_KEY='tdr_weekly_restaurant_900_run_date_v3';
const MEALS=['朝食','昼食','夕食'],PATHS=['/restaurant/weekReservation/','/restaurant/ajaxNextWeekList/','/restaurant/ajaxPreWeekList/'];
const blocks=new Map(),commodityMeal=new Map(),mealStates=new Map(),snapshots=new Map(),latestNormalSnapshots=new Map(),lastKnownRanges=new Map(),vacancyHistory=new Map(),unresolved=[],errorNotifyHistory=new Map(),researchBaselineWait=new Set();
const scriptStartSnapshots=new Map(),latestAnySnapshots=new Map();

let panelRoot=null,controlRow=null,notifyPanel=null,researchPanel=null,researchNotifyPanel=null,analysisSendPanel=null,datePanel=null,dateButtons=[];
let autoHint='',researchPhaseHint='',refreshTimer=null,wasMaintenance=isMaintenance(),notifyState=loadNotifyState(),analysisFlashUntil=0,analysisFlashTimer=null;
let researchMode=sessionStorage.getItem(RESEARCH_KEY)==='1',researchWindowActive=false,researchNotifyMode=loadResearchNotifyMode(),researchRound=null,researchPass1Queued=false,researchBaselineSourceLabel='8:57';
let normalLogState=createNormalLogState(Date.now()),am9LogState=createAm9LogState();

function ymd(){const d=new Date();return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;}
function nowText(){const d=new Date();return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;}
function clockHM(){const d=new Date();return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;}
function normalizeYmd(v){const s=String(v||'').trim(),m=s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);if(m)return `${m[1]}${String(+m[2]).padStart(2,'0')}${String(+m[3]).padStart(2,'0')}`;const d=s.replace(/\D/g,'');return d.length>=8?d.slice(0,8):'';}
function fmtDateJa(v){const s=normalizeYmd(v);if(!s)return String(v||'');const y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6,8),dt=new Date(y,m-1,d);return `${y}年${m}月${d}日（${'日月火水木金土'[dt.getDay()]}）`;}
function fmtDateShortJa(v){const s=normalizeYmd(v);if(!s)return String(v||'');const y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6,8),dt=new Date(y,m-1,d);return `${m}月${d}日（${'日月火水木金土'[dt.getDay()]}）`;}
function fmtResearchRange(start,end){const s=normalizeYmd(start),e=normalizeYmd(end);if(!s||!e)return `${start}～${end}`;const sy=+s.slice(0,4),sm=+s.slice(4,6),sd=+s.slice(6,8),ey=+e.slice(0,4),em=+e.slice(4,6),ed=+e.slice(6,8),sdt=new Date(sy,sm-1,sd),edt=new Date(ey,em-1,ed);return sy===ey?`${sy}年${sm}月${sd}日（${'日月火水木金土'[sdt.getDay()]}）～${em}月${ed}日（${'日月火水木金土'[edt.getDay()]}）`:`${fmtDateJa(s)}～${fmtDateJa(e)}`;}
function shortMD(v){const s=normalizeYmd(v);if(s)return `${+s.slice(4,6)}/${+s.slice(6,8)}`;const raw=String(v||'').trim(),m=raw.match(/(\d{1,2})\D+(\d{1,2})$/);return m?`${+m[1]}/${+m[2]}`:raw||'取得失敗';}
function analysisDate(v){const d=normalizeYmd(v);return d?`${d.slice(0,4)}/${d.slice(4,6)}/${d.slice(6,8)}`:String(v||'不明');}
function analysisShortDate(v){const d=normalizeYmd(v);return d?`${d.slice(4,6)}/${d.slice(6,8)}`:String(v||'不明');}
function analysisDateTime(ts){const d=new Date(ts);return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;}
function analysisTime(ts){const d=new Date(ts);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;}
function analysisGap(ms){if(ms===null||ms===undefined)return '不明';const min=Math.floor(ms/60000);if(min<60)return `${min}分`;const h=Math.floor(min/60),m=min%60;return m?`${h}時間${m}分`:`${h}時間`;}
function isMaintenance(){const h=new Date().getHours();return h>=3&&h<5;}
function existingMeals(){return [...blocks.keys()];}
function has(obj,key){return Object.prototype.hasOwnProperty.call(obj,key);}
function randomWaitMs(mode){return mode==='long'?(Math.floor(Math.random()*21)+110)*1000:(Math.floor(Math.random()*21)+50)*1000;}
function isReceptionStatus(v){return String(v||'').startsWith('◆受付終了');}
function eventCategory(e){
  const from=e.from||'',to=e.to||'';
  if(isReceptionStatus(from)&&isReceptionStatus(to))return 'receptionInternal';
  if(isReceptionStatus(from)||isReceptionStatus(to))return 'reception';
  return 'market';
}
function eventCounts(events){
  const out={market:0,reception:0,receptionInternal:0};
  events.forEach(e=>out[eventCategory(e)]++);
  return out;
}

function loadResearchNotifyMode(){const v=localStorage.getItem(RESEARCH_NOTIFY_KEY);if(['long','medium','short','off'].includes(v))return v;if(v==='0')return 'off';localStorage.setItem(RESEARCH_NOTIFY_KEY,'long');return 'long';}
function researchNotifyLabel(mode=researchNotifyMode){return mode==='long'?'長期':mode==='medium'?'中期':mode==='short'?'短期':'OFF';}
function researchNotifyEnabled(){return researchNotifyMode!=='off';}
function normalizeAutoMode(v){return ['medium','long','off'].includes(v)?v:'medium';}
function loadAutoMode(meal){const v=localStorage.getItem(AUTO_MODE_PREFIX+meal);if(v)return normalizeAutoMode(v);const old=localStorage.getItem(AUTO_PREFIX+meal),legacy=localStorage.getItem(OLD_AUTO_KEY);const mode=(old!==null?old:legacy)==='0'?'off':'medium';localStorage.setItem(AUTO_MODE_PREFIX+meal,mode);return mode;}
function autoActive(s){return s.mode!=='off'&&!s.forcedStopError&&!researchWindowActive;}

function analysisPeriod(ts,mode=researchNotifyMode){
  const d=new Date(ts),y=d.getFullYear(),m=d.getMonth(),day=d.getDate(),min=d.getHours()*60+d.getMinutes(),at=(o,h,mm=0)=>new Date(y,m,day+o,h,mm,0,0).getTime();
  if(mode==='medium'){
    if(min>=510&&min<1260)return {active:true,startAt:at(0,8,30),endAt:at(0,21)};
    if(min>=1260)return {active:true,startAt:at(0,21),endAt:at(1,8,30)};
    return {active:true,startAt:at(-1,21),endAt:at(0,8,30)};
  }
  if(mode==='short'){
    if(min>=300&&min<510)return {active:true,startAt:at(0,5),endAt:at(0,8,30)};
    if(min>=510&&min<900)return {active:true,startAt:at(0,8,30),endAt:at(0,15)};
    if(min>=900&&min<1260)return {active:true,startAt:at(0,15),endAt:at(0,21)};
    if(min>=1260)return {active:true,startAt:at(0,21),endAt:at(1,3)};
    if(min<180)return {active:true,startAt:at(-1,21),endAt:at(0,3)};
    return {active:false,startAt:at(0,3),endAt:at(0,5)};
  }
  if(min>=510)return {active:true,startAt:at(0,8,30),endAt:at(1,8,30)};
  return {active:true,startAt:at(-1,8,30),endAt:at(0,8,30)};
}
function createNormalLogState(ts){
  const p=analysisPeriod(ts);
  return {active:p.active,periodStartAt:p.startAt,periodEndAt:p.endAt,startAt:ts,mode:researchNotifyMode,restaurant:'',knownMeals:new Set(),meals:{},events:[],errors:[]};
}
function createAm9LogState(){return {startAt:0,endAt:0,restaurant:'',knownMeals:new Set(),comparisons:[],errors:[]};}
function seedNormalMeals(){if(normalLogState.active)existingMeals().forEach(m=>normalLogState.knownMeals.add(m));}
function normalMeal(meal){
  const key=meal||'食事区分不明';
  if(!normalLogState.meals[key])normalLogState.meals[key]={success:0,errors:0,ranges:new Set()};
  return normalLogState.meals[key];
}
function syncNormalLogMode(now=Date.now()){
  const p=analysisPeriod(now);
  normalLogState.mode=researchNotifyMode;
  normalLogState.periodStartAt=p.startAt;
  normalLogState.periodEndAt=p.endAt;
  if(!normalLogState.active&&p.active){normalLogState=createNormalLogState(now);seedNormalMeals();}
  else if(normalLogState.active&&!p.active)normalLogState.active=false;
}
function prepareNormalLog(now=Date.now()){rollNormalLogPeriod(now);return normalLogState.active&&!isMaintenance();}
function recordNormalSuccess(meal,current){
  if(!prepareNormalLog())return;
  const m=normalMeal(meal);
  normalLogState.restaurant=restaurantName();
  normalLogState.knownMeals.add(meal);
  m.success++;
  m.ranges.add(`${analysisDate(current.weekStart)}-${analysisDate(current.weekEnd)}`);
}
function recordNormalError(meal,error){
  if(!prepareNormalLog())return;
  const m=normalMeal(meal),at=Date.now();
  normalLogState.restaurant=restaurantName();
  normalLogState.knownMeals.add(meal||'食事区分不明');
  m.errors++;
  normalLogState.errors.push({at,meal:meal||'食事区分不明',error:String(error)});
}
function recordNormalChanges(changes){
  if(!changes?.length||!prepareNormalLog())return;
  const at=Date.now();
  normalLogState.restaurant=restaurantName();
  changes.forEach(c=>{
    normalLogState.knownMeals.add(c.meal);
    normalLogState.events.push({
      at,meal:c.meal,date:c.date,time:c.time,type:c.type,
      from:c.from||'',to:c.to||'',
      vacancy:c.vacancy?{count:c.vacancy.count,prevVacancyGapMs:c.vacancy.prevVacancyGapMs}:null
    });
  });
}
function recordAm9Error(meal,error,phase){
  if(!am9LogState.startAt)am9LogState.startAt=Date.now();
  am9LogState.restaurant=restaurantName();
  am9LogState.knownMeals.add(meal||'食事区分不明');
  am9LogState.errors.push({at:Date.now(),meal:meal||'食事区分不明',error:String(error),phase});
}
function buildAllSlotComparisons(prev,curr){
  return [...new Set([...Object.keys(prev),...Object.keys(curr)])].sort((a,b)=>a.localeCompare(b)).map(slot=>{
    const [date,time]=slot.split('|');
    return {date,time,from:has(prev,slot)?prev[slot]:'枠なし',to:has(curr,slot)?curr[slot]:'枠なし'};
  });
}
function recordAm9Comparison(meal,base,current,phase){
  if(!am9LogState.startAt)am9LogState.startAt=Date.now();
  am9LogState.restaurant=restaurantName();
  am9LogState.knownMeals.add(meal);
  am9LogState.comparisons.push({
    meal,phase,baseSource:base.source||'不明',baseAt:base.savedAt||null,compareAt:Date.now(),
    weekStart:current.weekStart,weekEnd:current.weekEnd,
    rows:buildAllSlotComparisons(base.slots,current.slots)
  });
}
function snapshotRangesText(map){
  const ranges=new Set();
  map.forEach(v=>ranges.add(`${analysisDate(v.weekStart)}-${analysisDate(v.weekEnd)}`));
  return ranges.size===1?[...ranges][0]:ranges.size?[...ranges].join(','):'未取得';
}
function statusForLog(s){return s||'不明';}

function buildFullStateLines(title,map){
  const lines=[title];
  if(!map.size){lines.push('取得なし','');return lines;}
  MEALS.forEach(meal=>{
    const v=map.get(meal);
    if(!v)return;
    lines.push(`【${meal}】`,`監視期間=${analysisDate(v.weekStart)}-${analysisDate(v.weekEnd)}`);
    Object.keys(v.slots).sort((a,b)=>a.localeCompare(b)).forEach(k=>{
      const [date,time]=k.split('|');
      lines.push(`${analysisShortDate(date)}|${time}|${statusForLog(v.slots[k])}`);
    });
    lines.push('');
  });
  return lines;
}
function formatNormalEventLine(e){
  const tail=['通常'];
  if(e.type==='added'){
    const parts=[analysisTime(e.at),analysisShortDate(e.date),e.time,'新規追加',statusForLog(e.to)];
    if(e.to==='空席'&&e.vacancy){
      if(e.vacancy.count<=1)parts.push('初回');
      else{
        parts.push(`再出現#${e.vacancy.count}`);
        if(e.vacancy.prevVacancyGapMs!==null)parts.push(`前回空席から${analysisGap(e.vacancy.prevVacancyGapMs)}`);
      }
    }
    if(eventCategory(e)==='reception')parts.push('受付終了化');
    if(eventCategory(e)==='receptionInternal')parts.push('受付終了状態変化');
    return [...parts,...tail].join('|');
  }
  if(e.type==='deleted'){
    const parts=[analysisTime(e.at),analysisShortDate(e.date),e.time,'削除',statusForLog(e.from)];
    if(eventCategory(e)==='reception')parts.push('受付終了化');
    if(eventCategory(e)==='receptionInternal')parts.push('受付終了状態変化');
    return [...parts,...tail].join('|');
  }
  const parts=[analysisTime(e.at),analysisShortDate(e.date),e.time,`${statusForLog(e.from)}→${statusForLog(e.to)}`];
  if(e.to==='空席'&&e.vacancy){
    if(e.vacancy.count<=1)parts.push('初回');
    else{
      parts.push(`再出現#${e.vacancy.count}`);
      if(e.vacancy.prevVacancyGapMs!==null)parts.push(`前回空席から${analysisGap(e.vacancy.prevVacancyGapMs)}`);
    }
  }
  if(eventCategory(e)==='reception')parts.push('受付終了化');
  if(eventCategory(e)==='receptionInternal')parts.push('受付終了状態変化');
  return [...parts,...tail].join('|');
}
function buildNormalLogBody(state,endAt){
  const lines=[];
  const meals=[...new Set([...MEALS.filter(m=>state.knownMeals.has(m)),...state.knownMeals])];
  meals.forEach(meal=>{
    const m=state.meals[meal]||{success:0,errors:0,ranges:new Set()};
    const events=state.events.filter(e=>e.meal===meal).sort((a,b)=>a.at-b.at);
    const counts=eventCounts(events);
    lines.push(`【${meal}】`);
    lines.push(`監視期間=${m.ranges.size?[...m.ranges].join(','):'未取得'}`);
    lines.push(`読込成功=${m.success}`);
    lines.push(`読込内訳=通常:${m.success}`);
    lines.push(`エラー=${m.errors}`);
    lines.push(`変化=${counts.market}`);
    if(counts.reception)lines.push(`受付終了化=${counts.reception}`);
    if(counts.receptionInternal)lines.push(`受付終了状態変化=${counts.receptionInternal}`);
    events.forEach(e=>lines.push(formatNormalEventLine(e)));
    lines.push('');
  });
  if(!meals.length)lines.push('【差分】','記録なし','');

  if(endAt-SCRIPT_STARTED_AT>=START_SNAPSHOT_THRESHOLD_MS)
    lines.push(...buildFullStateLines('【参考：スクリプト開始時点の全枠状態】',scriptStartSnapshots));

  lines.push(...buildFullStateLines('【参考：出力時点の全枠状態】',latestAnySnapshots));

  if(state.errors.length){
    lines.push('【エラー詳細】');
    [...state.errors].sort((a,b)=>a.at-b.at).forEach(e=>lines.push(`${analysisTime(e.at)}|${e.meal}|${e.error}`));
  }
  return lines;
}
function researchBaseLabel(source){return source==='直前通常'?'直前通常':source==='8:57'?'8:57':source==='pass1'?'1周目':source==='pass2'?'2周目':source||'不明';}
function buildAm9LogBody(state){
  const lines=['【AM9全枠状態比較】'];
  if(!state.comparisons.length)lines.push('比較データなし');
  state.comparisons.forEach(r=>{
    const pair=r.phase==='pass1'?`${researchBaseLabel(r.baseSource)}→1周目`:`${researchBaseLabel(r.baseSource)}→2周目`;
    lines.push(`【${r.meal}｜${pair}】`,`調査期間=${analysisDate(r.weekStart)}-${analysisDate(r.weekEnd)}`,`基準=${researchBaseLabel(r.baseSource)} ${r.baseAt?analysisTime(r.baseAt):'時刻不明'}`,`比較=${r.phase==='pass1'?'1周目':'2周目'} ${analysisTime(r.compareAt)}`);
    r.rows.forEach(x=>lines.push(`${analysisShortDate(x.date)}|${x.time}|${statusForLog(x.from)}→${statusForLog(x.to)}`));
    lines.push('');
  });
  lines.push('【AM9エラー】');
  if(!state.errors.length)lines.push('なし');
  else state.errors.forEach(e=>lines.push(`${analysisTime(e.at)}|${e.meal}|${e.phase}|${e.error}`));
  return lines;
}
function splitLines(lines,max=3000){
  const out=[];let cur='';
  for(const line of lines){
    const next=cur?`${cur}\n${line}`:line;
    if(next.length>max&&cur){out.push(cur);cur=line;}
    else cur=next;
  }
  if(cur)out.push(cur);
  return out.length?out:[''];
}
function csvCell(v){return `"${String(v??'').replace(/"/g,'""')}"`;}
function csvText(rows){return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');}
function safeFileName(v){return String(v||'').replace(/[\\/:*?"<>|]/g,'_').replace(/\s+/g,' ').trim()||'restaurant';}
function fileStamp(ts=Date.now()){const d=new Date(ts);return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;}
function downloadCsv(filename,rows){
  try{
    const blob=new Blob([csvText(rows)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;a.style.display='none';
    (document.body||document.documentElement).appendChild(a);
    a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    console.log(`[${NAME}] CSV保存：${filename}`);
    return true;
  }catch(e){console.error(`[${NAME}] CSV保存失敗`,e);return false;}
}
function appendSnapshotCsvRows(rows,type,map,common){
  MEALS.forEach(meal=>{
    const v=map.get(meal);
    if(!v)return;
    Object.keys(v.slots).sort((a,b)=>a.localeCompare(b)).forEach(k=>{
      const [date,time]=k.split('|');
      rows.push([
        type,'',analysisDate(date),meal,time,'','',statusForLog(v.slots[k]),'',
        common.output,common.logType,common.logStart,common.logEnd,common.restaurant,
        analysisDate(v.weekStart),analysisDate(v.weekEnd)
      ]);
    });
  });
}
function buildNormalCsvRows(state,mode,endAt){
  const rows=[[
    '種別','検知時刻','日付','食事区分','時間','変更前','変更後','状態','補足',
    '出力','ログ型','ログ開始','ログ終了','レストラン','監視開始','監視終了'
  ]];
  const common={
    output:mode,
    logType:researchNotifyLabel(state.mode),
    logStart:analysisDateTime(state.startAt),
    logEnd:analysisDateTime(endAt),
    restaurant:state.restaurant||restaurantName()
  };

  [...state.events].sort((a,b)=>a.at-b.at).forEach(e=>{
    let type='通常差分',note='';
    const category=eventCategory(e);
    if(category==='reception')type='受付終了化';
    if(category==='receptionInternal')type='受付終了状態変化';

    const from=e.type==='added'?'枠なし':statusForLog(e.from);
    const to=e.type==='deleted'?'枠なし':statusForLog(e.to);

    if(e.to==='空席'&&e.vacancy){
      if(e.vacancy.count<=1)note='初回';
      else{
        note=`再出現#${e.vacancy.count}`;
        if(e.vacancy.prevVacancyGapMs!==null)note+=` / 前回空席から${analysisGap(e.vacancy.prevVacancyGapMs)}`;
      }
    }

    rows.push([
      type,analysisDateTime(e.at),analysisDate(e.date),e.meal,e.time,
      from,to,to,note,
      common.output,common.logType,common.logStart,common.logEnd,common.restaurant,'',''
    ]);
  });

  if(endAt-SCRIPT_STARTED_AT>=START_SNAPSHOT_THRESHOLD_MS)
    appendSnapshotCsvRows(rows,'開始時状態',scriptStartSnapshots,common);

  appendSnapshotCsvRows(rows,'出力時状態',latestAnySnapshots,common);

  const names=[...new Set([...state.knownMeals,...Object.keys(state.meals)])];
  names.forEach(meal=>{
    const m=state.meals[meal]||{success:0,errors:0,ranges:new Set()};
    const events=state.events.filter(e=>e.meal===meal);
    const counts=eventCounts(events);
    rows.push([
      '読込集計','', '',meal,'','','','',
      `読込成功=${m.success} / エラー=${m.errors} / 変化=${counts.market} / 受付終了化=${counts.reception} / 受付終了状態変化=${counts.receptionInternal} / 監視期間=${m.ranges.size?[...m.ranges].join(','):'未取得'}`,
      common.output,common.logType,common.logStart,common.logEnd,common.restaurant,'',''
    ]);
  });

  [...state.errors].sort((a,b)=>a.at-b.at).forEach(e=>rows.push([
    'エラー',analysisDateTime(e.at),'',e.meal,'','','','',e.error,
    common.output,common.logType,common.logStart,common.logEnd,common.restaurant,'',''
  ]));

  return rows;
}
function buildAm9CsvRows(state,endAt){
  const rows=[['種別','ログ開始','ログ終了','レストラン','食事区分','比較','基準時刻','比較時刻','監視開始','監視終了','日付','時間','変更前','変更後','備考']];
  const start=analysisDateTime(state.startAt||endAt),end=analysisDateTime(endAt),restaurant=state.restaurant||restaurantName();
  state.comparisons.forEach(r=>{
    const compare=`${researchBaseLabel(r.baseSource)}→${r.phase==='pass1'?'1周目':'2周目'}`,baseAt=r.baseAt?analysisDateTime(r.baseAt):'';
    r.rows.forEach(x=>rows.push([
      'AM9状態',start,end,restaurant,r.meal,compare,baseAt,analysisDateTime(r.compareAt),
      analysisDate(r.weekStart),analysisDate(r.weekEnd),analysisDate(x.date),x.time,
      statusForLog(x.from),statusForLog(x.to),''
    ]));
  });
  state.errors.forEach(e=>rows.push(['AM9エラー',start,end,restaurant,e.meal,e.phase,'',analysisDateTime(e.at),'','','','','','',e.error]));
  return rows;
}
function downloadNormalCsv(state,mode,endAt){
  const name=`${fileStamp(endAt)}_${safeFileName(state.restaurant||restaurantName())}_通常在庫差分.csv`;
  return downloadCsv(name,buildNormalCsvRows(state,mode,endAt));
}
function downloadAm9Csv(state,endAt){
  const name=`${fileStamp(endAt)}_${safeFileName(state.restaurant||restaurantName())}_AM9状態.csv`;
  return downloadCsv(name,buildAm9CsvRows(state,endAt));
}
function sendStructuredLog(kind,commonHeader,bodyLines,color){
  const webhook=discordWebhook('research');
  if(!webhook){console.warn(`[${NAME}] 解析ログ送信先 restaurantResearch 未設定`);return false;}
  const chunks=splitLines(bodyLines),n=chunks.length;
  (async()=>{
    for(let i=0;i<n;i++){
      const title=`${kind==='diff'?'📊 通常在庫差分ログ':'9️⃣ AM9状態ログ'}${n>1?` ${i+1}/${n}`:''}`;
      const header=[commonHeader[0],`分割=${i+1}/${n}`,...commonHeader.slice(1)];
      const description=`\`\`\`text\n${header.join('\n')}\n\n${chunks[i]}\n\`\`\``;
      try{
        await fetch(webhook,{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          keepalive:true,
          body:JSON.stringify({username:NAME,embeds:[{title,description:description.slice(0,4000),color}]})
        });
      }catch(e){console.error(`[${NAME}] ログ送信失敗`,e);}
    }
  })();
  return true;
}
function sendNormalLogSnapshot(state,mode,endAt){
  if(!state?.active)return false;
  const header=[
    '[TDR_RESTAURANT_HOURLY_LOG]',
    `出力=${mode}`,
    `ログ型=${researchNotifyLabel(state.mode)}`,
    `期間=${analysisDateTime(state.startAt)}-${analysisDateTime(endAt)}`,
    `レストラン=${state.restaurant||restaurantName()}`,
    `調査期間=${snapshotRangesText(latestAnySnapshots)}`
  ];
  const discordOk=sendStructuredLog('diff',header,buildNormalLogBody(state,endAt),BLUE);
  const csvOk=downloadNormalCsv(state,mode,endAt);
  return discordOk||csvOk;
}
function sendAm9StateLog(){
  if(!am9LogState.startAt&&!am9LogState.comparisons.length&&!am9LogState.errors.length)return false;
  am9LogState.endAt=Date.now();
  const state=am9LogState;
  const header=[
    '[TDR_RESTAURANT_AM9_LOG]',
    `期間=${analysisDateTime(state.startAt||state.endAt)}-${analysisDateTime(state.endAt)}`,
    `レストラン=${state.restaurant||restaurantName()}`,
    `調査期間=${snapshotRangesText(latestAnySnapshots)}`
  ];
  const discordOk=sendStructuredLog('am9',header,buildAm9LogBody(state),PURPLE);
  const csvOk=downloadAm9Csv(state,state.endAt);
  const ok=discordOk||csvOk;
  if(ok)am9LogState=createAm9LogState();
  return ok;
}
function resetNormalLogState(now=Date.now()){normalLogState=createNormalLogState(now);seedNormalMeals();}
function flushNormalLog(mode,forceCurrent=false){
  const now=Date.now();
  if(!forceCurrent)rollNormalLogPeriod(now);
  if(!normalLogState.active){console.log(`[${NAME}] 通常在庫差分ログ：送信対象なし`);return false;}
  const old=normalLogState;
  if(!sendNormalLogSnapshot(old,mode,now))return false;
  resetNormalLogState(now);
  console.log(`[${NAME}] 通常在庫差分ログ送信・リセット：${mode}`);
  return true;
}
function flushNormalLogForForceStop(){
  const now=Date.now();
  if(!normalLogState.active)return false;
  const elapsed=now-normalLogState.startAt;
  const marketChanges=normalLogState.events.filter(e=>eventCategory(e)==='market').length;
  if(elapsed<=FORCE_LOG_NOISE_MS&&marketChanges===0){
    console.log(`[${NAME}] 🔶強制停止差分ログ抑制：集計${Math.floor(elapsed/1000)}秒 / 通常在庫変化なし`);
    return false;
  }
  return flushNormalLog('🔶強制停止',true);
}
function rollNormalLogPeriod(now=Date.now()){
  const p=analysisPeriod(now);
  if(normalLogState.active&&now>=normalLogState.periodEndAt){
    const old=normalLogState;
    if(researchNotifyEnabled()&&!sendNormalLogSnapshot(old,'自動',old.periodEndAt))return;
    normalLogState=createNormalLogState(now);
    seedNormalMeals();
    return;
  }
  if(!normalLogState.active&&p.active){normalLogState=createNormalLogState(now);seedNormalMeals();}
}
function normalLogTick(){rollNormalLogPeriod();}
function manualAnalysisFlush(){flushNormalLog('手動');}
function playAnalysisClickSound(){
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)return;
  try{
    const ctx=new AC(),osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type='sine';
    osc.frequency.setValueAtTime(880,ctx.currentTime);
    gain.gain.setValueAtTime(0.08,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.12);
    osc.connect(gain);gain.connect(ctx.destination);
    osc.start(ctx.currentTime);osc.stop(ctx.currentTime+0.12);
    osc.onended=()=>ctx.close().catch(()=>{});
  }catch(e){console.warn(`[${NAME}] 確認音再生失敗`,e);}
}
function handleAnalysisClick(){
  playAnalysisClickSound();
  analysisFlashUntil=Date.now()+1000;
  clearTimeout(analysisFlashTimer);
  if(analysisSendPanel){analysisSendPanel.style.background='#d32f2f';analysisSendPanel.style.color='#fff';}
  analysisFlashTimer=setTimeout(()=>{analysisFlashUntil=0;renderPanels();},1000);
  requestAnimationFrame(()=>requestAnimationFrame(()=>manualAnalysisFlush()));
}

function loadNotifyState(){
  try{
    const v=JSON.parse(localStorage.getItem(NOTIFY_KEY)||'null');
    if(v?.date===ymd()&&['vacancy','all','off'].includes(v.mode))return v;
  }catch{}
  const v={date:ymd(),mode:'vacancy'};
  localStorage.setItem(NOTIFY_KEY,JSON.stringify(v));
  return v;
}
function syncNotifyDay(){
  if(notifyState.date===ymd())return;
  notifyState={date:ymd(),mode:'vacancy'};
  localStorage.setItem(NOTIFY_KEY,JSON.stringify(notifyState));
}
function normalizeMeal(text){const t=String(text||'').replace(/\s+/g,'');return MEALS.find(x=>t.includes(x))||'';}
function getMealFromBox(box){
  const h=box.querySelector('.heading');
  return normalizeMeal([h?.textContent,h?.getAttribute('title'),h?.querySelector('img')?.alt,box.querySelector('img[alt*="朝食"],img[alt*="昼食"],img[alt*="夕食"]')?.alt].filter(Boolean).join(' '));
}
function restaurantName(){return document.querySelector('.boxRestaurant02 .header h1.heading')?.textContent.replace(/\s+/g,' ').trim()||'レストラン名取得失敗';}
function getState(meal){
  if(mealStates.has(meal))return mealStates.get(meal);
  const s={
    meal,mode:loadAutoMode(meal),pending:0,startedAt:0,deadline:0,timer:null,row:null,manual:null,panel:null,
    error403:false,consecutiveErrors:0,forcedStopError:false,pendingError:false
  };
  mealStates.set(meal,s);
  return s;
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
  existingMeals().forEach(m=>normalLogState.knownMeals.add(m));
  if(researchWindowActive)existingMeals().forEach(m=>clearTimer(getState(m)));
  createPanels();
  drainUnresolved();
}
function queueRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(refreshBlocks,100);}
function baseButtonStyle(el){Object.assign(el.style,{height:'32px',padding:'6px 2px',borderRadius:'7px',boxSizing:'border-box',fontSize:'13px',fontWeight:'700',textAlign:'center',cursor:'pointer',userSelect:'none',boxShadow:'0 2px 8px rgba(0,0,0,.25)',border:'1px solid rgba(0,0,0,.2)',fontFamily:'Arial,"Yu Gothic",sans-serif'});}
function compactButtonStyle(el,width,fontSize='14px'){baseButtonStyle(el);Object.assign(el.style,{width:`${width}px`,height:'29px',padding:'4px 0',fontSize,borderRadius:'6px'});}
function createPanels(){
  if(!document.body)return;
  if(!panelRoot){
    panelRoot=document.createElement('div');
    Object.assign(panelRoot.style,{position:'fixed',top:'14px',right:'14px',zIndex:'2147483647',display:'flex',flexDirection:'column',gap:'5px'});
    document.body.appendChild(panelRoot);
  }
  MEALS.forEach((meal,i)=>{
    const s=getState(meal);
    if(!blocks.has(meal)){if(s.row)s.row.style.display='none';return;}
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
      panel.onclick=()=>toggleMeal(meal);
      row.append(manual,panel);
      panelRoot.appendChild(row);
      s.row=row;s.manual=manual;s.panel=panel;
    }
    s.row.style.display='flex';
  });
  if(!controlRow){
    controlRow=document.createElement('div');
    Object.assign(controlRow.style,{order:'10',width:'127px',display:'flex',gap:'3px'});
    analysisSendPanel=document.createElement('div');
    compactButtonStyle(analysisSendPanel,29);
    analysisSendPanel.textContent='📤';
    analysisSendPanel.title='通常在庫差分ログを送信';
    analysisSendPanel.onclick=handleAnalysisClick;
    notifyPanel=document.createElement('div');
    compactButtonStyle(notifyPanel,29);
    notifyPanel.onclick=toggleNotify;
    researchNotifyPanel=document.createElement('div');
    compactButtonStyle(researchNotifyPanel,31,'10px');
    researchNotifyPanel.onclick=toggleResearchNotify;
    researchPanel=document.createElement('div');
    compactButtonStyle(researchPanel,29);
    researchPanel.onclick=toggleResearchMode;
    controlRow.append(analysisSendPanel,notifyPanel,researchNotifyPanel,researchPanel);
    panelRoot.appendChild(controlRow);
  }
  if(!datePanel){
    datePanel=document.createElement('div');
    Object.assign(datePanel.style,{order:'14',width:'127px',display:'flex',flexDirection:'column',gap:'3px'});
    const rows=[
      [['当',0],['翌',1],['3',3],['5',5]],
      [['7',7],['14',14],['21',21],['28',28]],
      [['35',35],['42',42],['49',49],['56',56]],
      [['63',63],['70',70],['77',77],['末','end']]
    ];
    dateButtons=[];
    rows.forEach(items=>{
      const row=document.createElement('div');
      Object.assign(row.style,{display:'flex',gap:'3px'});
      items.forEach(([label,value])=>{
        const b=document.createElement('div');
        baseButtonStyle(b);
        Object.assign(b.style,{width:'29px',height:'29px',padding:'5px 0',background:'#0b1f3a',color:'#fff',fontSize:'12px',borderRadius:'6px'});
        b.textContent=label;
        b.dataset.value=String(value);
        b.title=value==='end'?'3か月後を最終日に含む週を検索':`本日から${value}日後を開始日にして検索`;
        b.onclick=()=>{
          selectDateShortcut(value);
          value==='end'?searchEndWeek():searchOffset(value);
        };
        dateButtons.push(b);
        row.appendChild(b);
      });
      datePanel.appendChild(row);
    });
    panelRoot.appendChild(datePanel);
    renderDateSelection();
  }
  renderPanels();
}
function selectDateShortcut(value){sessionStorage.setItem(DATE_SELECT_KEY,String(value));renderDateSelection();}
function renderDateSelection(){
  const selected=sessionStorage.getItem(DATE_SELECT_KEY)||'';
  dateButtons.forEach(b=>{
    b.style.background=b.dataset.value===selected?'#d32f2f':'#0b1f3a';
    b.style.color='#fff';
  });
}
function setSearchDate(d){
  const y=d.getFullYear(),m=d.getMonth()+1,day=d.getDate();
  const displayDate=`${y}/${m}/${day}`,searchDate=`${y}${String(m).padStart(2,'0')}${String(day).padStart(2,'0')}`;
  const datepicker=document.querySelector('#datepicker'),searchUseDate=document.querySelector('#searchUseDate');
  if(!datepicker||!searchUseDate){console.warn(`[${NAME}] 日付検索：日付入力欄なし`);return;}
  datepicker.value=displayDate;
  datepicker.setAttribute('value',displayDate);
  searchUseDate.value=searchDate;
  searchUseDate.setAttribute('value',searchDate);
  datepicker.dispatchEvent(new Event('input',{bubbles:true}));
  datepicker.dispatchEvent(new Event('change',{bubbles:true}));
  const button=document.querySelector('#detailFormId input[type="image"][alt="検索する"],#detailFormId input[type="image"][onclick*="Restaurant.detail"]');
  if(!button){console.warn(`[${NAME}] 日付検索：検索ボタンなし`);return;}
  console.log(`[${NAME}] 日付検索：${displayDate}`);
  button.click();
}
function searchOffset(days){const d=new Date();d.setDate(d.getDate()+days);setSearchDate(d);}
function addMonthsClamped(date,months){
  const d=new Date(date.getFullYear(),date.getMonth(),1),targetMonth=d.getMonth()+months;
  const targetYear=d.getFullYear()+Math.floor(targetMonth/12),month=((targetMonth%12)+12)%12;
  const lastDay=new Date(targetYear,month+1,0).getDate();
  return new Date(targetYear,month,Math.min(date.getDate(),lastDay));
}
function searchEndWeek(){const end=addMonthsClamped(new Date(),3);end.setDate(end.getDate()-6);setSearchDate(end);}
function sameLocalDate(a,b){return a.getFullYear()===b.getFullYear()&&a.getMonth()===b.getMonth()&&a.getDate()===b.getDate();}
function reservationLeadDays(v){
  const s=normalizeYmd(v);
  if(!s)return null;
  const now=new Date(),target=new Date(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8));
  return Math.round((Date.UTC(target.getFullYear(),target.getMonth(),target.getDate())-Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
}
function reservationLeadLabel(v){
  const s=normalizeYmd(v);
  if(!s)return '';
  const now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()),target=new Date(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8)),days=reservationLeadDays(s);
  if(days===0)return '当日';
  if(days<0)return `${Math.abs(days)}日経過`;
  let text=`${days}日前`;
  const months=(target.getFullYear()-today.getFullYear())*12+target.getMonth()-today.getMonth();
  if(months>0&&sameLocalDate(addMonthsClamped(today,months),target))text+=`（${months}ヶ月前）`;
  return text;
}
function withReservationLead(description,date){const label=reservationLeadLabel(date);return label?`${description}\n\n${label}`:description;}

function savePreviousAuto(){
  const prev={};
  existingMeals().forEach(meal=>prev[meal]=getState(meal).mode);
  sessionStorage.setItem(RESEARCH_PREV_AUTO_KEY,JSON.stringify(prev));
}
function loadPreviousAuto(){try{return JSON.parse(sessionStorage.getItem(RESEARCH_PREV_AUTO_KEY)||'{}');}catch{return {};}}
function loadResearchBaseline(){try{const d=JSON.parse(sessionStorage.getItem(RESEARCH_BASELINE_KEY)||'null');if(d?.date===ymd())return d;}catch{}return {date:ymd(),entries:{}};}
function saveResearchBaselineData(data){sessionStorage.setItem(RESEARCH_BASELINE_KEY,JSON.stringify(data));}
function clearResearchBaseline(){saveResearchBaselineData({date:ymd(),entries:{}});}
function restoreAutoAfterResearch(){
  const prev=loadPreviousAuto();
  existingMeals().forEach(meal=>{
    const s=getState(meal);
    clearTimer(s);
    if(has(prev,meal))s.mode=normalizeAutoMode(prev[meal]);
    if(autoActive(s)&&!s.pending&&!isMaintenance())schedule(meal);
  });
}
function beginResearchWindow(source='8:57'){
  if(!researchMode||researchWindowActive||isMaintenance())return;
  refreshBlocks();
  const pendingBefore=new Set(existingMeals().filter(meal=>getState(meal).pending>0));
  savePreviousAuto();
  researchWindowActive=true;
  researchBaselineSourceLabel=source;
  researchRound=null;
  researchPass1Queued=false;
  researchBaselineWait.clear();
  clearResearchBaseline();
  am9LogState=createAm9LogState();
  am9LogState.startAt=Date.now();
  existingMeals().forEach(m=>clearTimer(getState(m)));
  console.log(`[${NAME}] 9時調査管理開始 / 基準=${source} / 通常自動検索停止`);
  runResearchRound('baseline',pendingBefore);
  renderPanels();
}
function finishResearchModeAuto(){
  sendAm9StateLog();
  if(researchNotifyMode!=='long')flushNormalLog('AM9時調査終了',true);
  researchMode=false;
  researchWindowActive=false;
  researchRound=null;
  researchPass1Queued=false;
  researchBaselineWait.clear();
  sessionStorage.setItem(RESEARCH_KEY,'0');
  restoreAutoAfterResearch();
  sessionStorage.removeItem(RESEARCH_PREV_AUTO_KEY);
  sessionStorage.removeItem(RESEARCH_BASELINE_KEY);
  console.log(`[${NAME}] 9時調査完了 / 自動OFF / 通常監視復帰`);
  renderPanels();
}
function cancelResearchMode(){
  const wasActive=researchWindowActive;
  researchWindowActive=false;
  researchRound=null;
  researchPass1Queued=false;
  researchBaselineWait.clear();
  if(wasActive)restoreAutoAfterResearch();
  sessionStorage.removeItem(RESEARCH_PREV_AUTO_KEY);
  sessionStorage.removeItem(RESEARCH_BASELINE_KEY);
  sessionStorage.removeItem(RESEARCH_857_RUN_KEY);
  sessionStorage.removeItem(RESEARCH_900_RUN_KEY);
  am9LogState=createAm9LogState();
}
function saveResearchBase(meal,meta,current,source){
  const data=loadResearchBaseline(),key=snapshotKey(meta,meal,current);
  data.entries[meal]={source,key,weekStart:current.weekStart,weekEnd:current.weekEnd,slots:current.slots,savedAt:Date.now()};
  saveResearchBaselineData(data);
  snapshots.set(key,current.slots);
  seedVacancyHistory(meal,current);
  console.log(`[${NAME}] ${meal} 9時調査基準保存：${source}`);
}
function saveLatestNormal(meal,meta,current){
  latestNormalSnapshots.set(meal,{
    source:'直前通常',key:snapshotKey(meta,meal,current),weekStart:current.weekStart,weekEnd:current.weekEnd,
    slots:{...current.slots},savedAt:Date.now()
  });
}
function saveLatestNormalAsResearchBase(meal){
  const last=latestNormalSnapshots.get(meal);
  if(!last)return false;
  const data=loadResearchBaseline();
  data.entries[meal]={source:'直前通常',key:last.key,weekStart:last.weekStart,weekEnd:last.weekEnd,slots:{...last.slots},savedAt:last.savedAt};
  saveResearchBaselineData(data);
  snapshots.set(last.key,last.slots);
  console.warn(`[${NAME}] ${meal} 9時基準取得失敗 / 直前通常スナップショットを保険使用`);
  return true;
}
function ensureResearchFallback(meal){
  const data=loadResearchBaseline();
  if(data.entries?.[meal])return true;
  return saveLatestNormalAsResearchBase(meal);
}
function toggleResearchMode(){
  refreshBlocks();
  if(!researchMode){
    researchMode=true;
    researchRound=null;
    researchPass1Queued=false;
    researchBaselineWait.clear();
    sessionStorage.setItem(RESEARCH_KEY,'1');
    sessionStorage.removeItem(RESEARCH_857_RUN_KEY);
    sessionStorage.removeItem(RESEARCH_900_RUN_KEY);
    const d=new Date(),min=d.getHours()*60+d.getMinutes();
    if(min>=537&&min<540){
      sessionStorage.setItem(RESEARCH_857_RUN_KEY,ymd());
      beginResearchWindow(d.getMinutes()===57?'8:57':`${clockHM()}緊急`);
    }else if(min>=540)console.log(`[${NAME}] 9時調査 ON / 本日の9時調査は実行せず翌日8:57待機`);
    else console.log(`[${NAME}] 9時調査 ON / 通常自動検索を継続し8:57待機`);
  }else{
    researchMode=false;
    sessionStorage.setItem(RESEARCH_KEY,'0');
    cancelResearchMode();
    console.log(`[${NAME}] 9時調査モード OFF`);
  }
  renderPanels();
}
function toggleMeal(meal){
  if(researchWindowActive||!blocks.has(meal))return;
  const s=getState(meal);
  if(s.forcedStopError){
    s.forcedStopError=false;
    s.consecutiveErrors=0;
    s.error403=false;
    s.pendingError=false;
    if(s.mode==='off')s.mode='medium';
    localStorage.setItem(AUTO_MODE_PREFIX+meal,s.mode);
    if(!s.pending&&!isMaintenance())schedule(meal);
    renderPanels();
    return;
  }
  s.mode=s.mode==='medium'?'long':s.mode==='long'?'off':'medium';
  localStorage.setItem(AUTO_MODE_PREFIX+meal,s.mode);
  clearTimer(s);
  if(autoActive(s)&&!s.pending&&!isMaintenance())schedule(meal);
  renderPanels();
}
function manualFire(meal){if(!blocks.has(meal))return;const s=getState(meal);if(s.pending||isMaintenance())return;fireSameWeek(meal,true,'');}
function toggleNotify(){
  syncNotifyDay();
  notifyState.mode=notifyState.mode==='vacancy'?'all':notifyState.mode==='all'?'off':'vacancy';
  localStorage.setItem(NOTIFY_KEY,JSON.stringify(notifyState));
  renderPanels();
}
function toggleResearchNotify(){
  const order=['long','medium','short','off'],i=order.indexOf(researchNotifyMode);
  researchNotifyMode=order[(i+1)%order.length];
  localStorage.setItem(RESEARCH_NOTIFY_KEY,researchNotifyMode);
  syncNormalLogMode();
  console.log(`[${NAME}] 調査通知：${researchNotifyLabel()}`);
  renderPanels();
}
function clearTimer(s){if(s.timer)clearTimeout(s.timer);s.timer=null;s.deadline=0;}
function schedule(meal){
  const s=getState(meal);
  clearTimer(s);
  if(!blocks.has(meal)||!autoActive(s)||isMaintenance())return;
  const wait=randomWaitMs(s.mode);
  s.deadline=performance.now()+wait;
  s.timer=setTimeout(()=>{
    s.timer=null;s.deadline=0;
    if(blocks.has(meal))fireSameWeek(meal,false,'');
  },wait);
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
    if(maintenance){s.panel.style.background='#777';s.panel.style.color='#fff';s.panel.textContent=`${meal} メンテ`;return;}
    if(s.forcedStopError){s.panel.style.background='#ff0000';s.panel.style.color='#fff';s.panel.textContent=`${meal} STOP`;s.panel.title=`エラー${MAX_ERRORS}回連続 / 自動読込強制停止 / クリックで再開`;return;}
    if(s.error403){s.panel.style.background='#ff0000';s.panel.style.color='#fff';s.panel.textContent=s.deadline?`${meal} 403 ${Math.max(0,Math.ceil((s.deadline-now)/1000))}`:`${meal} 403`;return;}
    if(s.pendingError){s.panel.style.background='#ff0000';s.panel.style.color='#fff';s.panel.textContent=`${meal} 5分超`;return;}
    if(s.pending>0){s.panel.style.background='#7b2cbf';s.panel.style.color='#fff';s.panel.textContent=`${meal} 読込 ${Math.floor((now-s.startedAt)/1000)}`;return;}
    if(researchWindowActive){
      s.panel.style.background='#555';s.panel.style.color='#fff';
      s.panel.textContent=researchRound?`${meal} ${researchRoundLabel(researchRound.phase)}`:`${meal} 待機`;
      s.panel.title='9時調査管理中 / 通常自動読込停止';
      return;
    }
    s.panel.title=`${meal} 自動読込：中期 → 長期 → OFF`;
    if(s.mode==='off'){s.panel.style.background='#000';s.panel.style.color='#fff';s.panel.textContent=`${meal} OFF`;return;}
    const sec=s.deadline?` ${Math.max(0,Math.ceil((s.deadline-now)/1000))}`:'';
    if(s.mode==='medium'){
      s.panel.style.background='#ff9800';s.panel.style.color='#000';s.panel.textContent=`${meal} 中${sec}`;
    }else{
      s.panel.style.background='#1976d2';s.panel.style.color='#fff';s.panel.textContent=`${meal} 長${sec}`;
    }
  });
  if(analysisSendPanel){
    analysisSendPanel.style.background=Date.now()<analysisFlashUntil?'#d32f2f':'#198754';
    analysisSendPanel.style.color='#fff';
    analysisSendPanel.textContent='📤';
  }
  if(notifyPanel){
    if(notifyState.mode==='vacancy'){
      notifyPanel.style.background='#ffd600';notifyPanel.style.color='#000';notifyPanel.textContent='🔔';notifyPanel.title='空席通知';
    }else if(notifyState.mode==='all'){
      notifyPanel.style.background='#d32f2f';notifyPanel.style.color='#fff';notifyPanel.textContent='📢';notifyPanel.title='全通知';
    }else{
      notifyPanel.style.background='#000';notifyPanel.style.color='#fff';notifyPanel.textContent='🔕';notifyPanel.title='通知OFF';
    }
  }
  if(researchNotifyPanel){
    if(researchNotifyMode==='long'){
      researchNotifyPanel.style.background='#1976d2';researchNotifyPanel.style.color='#fff';researchNotifyPanel.textContent='🔬長';researchNotifyPanel.title='長期：08:30 → 翌08:30';
    }else if(researchNotifyMode==='medium'){
      researchNotifyPanel.style.background='#ff9800';researchNotifyPanel.style.color='#000';researchNotifyPanel.textContent='🔬中';researchNotifyPanel.title='中期';
    }else if(researchNotifyMode==='short'){
      researchNotifyPanel.style.background='pink';researchNotifyPanel.style.color='#000';researchNotifyPanel.textContent='🔬短';researchNotifyPanel.title='短期';
    }else{
      researchNotifyPanel.style.background='#000';researchNotifyPanel.style.color='#fff';researchNotifyPanel.textContent='🔬×';researchNotifyPanel.title='調査通知・自動差分ログ OFF';
    }
  }
  if(researchPanel){
    researchPanel.style.background=researchMode?'#d32f2f':'#000';
    researchPanel.style.color='#fff';
    researchPanel.textContent='9️⃣';
    researchPanel.title=researchMode?(researchWindowActive?'9時調査 ON / 調査管理中':'9時調査 ON / 8:57まで通常自動検索継続'):'9時調査 OFF';
  }
  renderDateSelection();
}
function researchRoundLabel(phase){return phase==='baseline'?'基準':phase==='pass1'?'1周':phase==='pass2'?'2周':'調査';}
function maintenanceTick(){
  const maintenance=isMaintenance();
  if(maintenance===wasMaintenance)return;
  wasMaintenance=maintenance;
  if(maintenance){
    mealStates.forEach(clearTimer);
    console.log(`[${NAME}] メンテナンス停止`);
  }else{
    refreshBlocks();
    if(!researchWindowActive)existingMeals().forEach(meal=>{
      const s=getState(meal);
      if(autoActive(s)&&!s.pending)fireSameWeek(meal,false,'');
    });
    console.log(`[${NAME}] メンテナンス終了・再開`);
  }
  renderPanels();
}

function recordError(meal,error,count=true,notify=true){
  const s=getState(meal);
  if(count&&!s.forcedStopError){
    s.consecutiveErrors++;
    console.warn(`[${NAME}] ${meal} 連続エラー ${s.consecutiveErrors}/${MAX_ERRORS}：${error}`);
    if(s.consecutiveErrors>=MAX_ERRORS){forceStopError(meal,error);return true;}
  }
  if(notify)sendErrorDiscord(meal,error);
  renderPanels();
  return false;
}
function reportError(meal,error,researchPhase='',count=true){
  if(researchPhase)recordAm9Error(meal,error,researchPhase);
  else recordNormalError(meal,error);
  const stopped=recordError(meal,error,count,!researchPhase);
  if(researchPhase&&!stopped)sendResearchErrorDiscord(meal,researchPhase,error);
  return stopped;
}
function resetErrors(meal){
  const s=getState(meal);
  if(s.consecutiveErrors)console.log(`[${NAME}] ${meal} 正常読込 / 連続エラー ${s.consecutiveErrors} → 0`);
  s.consecutiveErrors=0;s.error403=false;s.pendingError=false;
}
function currentSearchRange(meal){
  const block=blocks.get(meal);
  if(block){
    const dates=[...block.box.querySelectorAll('.timeList .date li .display')].map(e=>e.textContent.trim()).filter(Boolean);
    if(dates.length)return `${shortMD(dates[0])}～${shortMD(dates[dates.length-1])}`;
  }
  const last=lastKnownRanges.get(meal);
  return last?`${shortMD(last.weekStart)}～${shortMD(last.weekEnd)}`:'取得失敗';
}
function forceStopError(meal,lastError){
  const s=getState(meal);
  if(s.forcedStopError)return;
  s.forcedStopError=true;
  clearTimer(s);
  console.warn(`[${NAME}] ${meal} エラー${MAX_ERRORS}回連続 / 自動読込強制停止（保存なし）`);
  sendForceStopDiscord(meal,lastError,currentSearchRange(meal));
  flushNormalLogForForceStop();
  renderPanels();
}
function fireSameWeek(meal,manual=false,researchPhase=''){
  const s=getState(meal);
  if((!manual&&!autoActive(s))||s.pending||isMaintenance())return false;
  refreshBlocks();
  const block=blocks.get(meal);
  if(!block){clearTimer(s);console.log(`[${NAME}] ${meal} 対象DOMなしのため読込スキップ`);return false;}
  const link=block.next,display=link.closest('.header')?.nextElementSibling?.querySelector('.date li:first-child .display'),jq=window.jQuery||window.$,format=window.webapiFormat;
  if(!display||!jq?.datepicker||!format){
    console.warn(`[${NAME}] ${meal} 日付DOM未検出`);
    reportError(meal,'日付DOM未検出',researchPhase);
    if(!manual&&autoActive(s))schedule(meal);
    return false;
  }
  const current=display.textContent.trim();
  let prev;
  try{
    const d=jq.datepicker.parseDate(format,current,{});
    d.setDate(d.getDate()-7);
    prev=jq.datepicker.formatDate(format,d,{});
  }catch(e){
    console.warn(`[${NAME}] ${meal} 日付変換失敗`,e);
    reportError(meal,'日付変換失敗',researchPhase);
    if(!manual&&autoActive(s))schedule(meal);
    return false;
  }
  const hadNoData=link.classList.contains('hasNoData'),before=s.pending;
  display.textContent=prev;
  link.classList.remove('hasNoData');
  autoHint=meal;
  researchPhaseHint=researchPhase;
  let fireError='';
  try{link.click();}
  catch(e){console.error(`[${NAME}] ${meal} 発火失敗`,e);fireError='発火エラー';}
  finally{autoHint='';researchPhaseHint='';}
  if(s.pending===before){
    const d2=block.box.querySelector('.timeList .date li:first-child .display');
    if(d2)d2.textContent=current;
    if(hadNoData)link.classList.add('hasNoData');
    reportError(meal,fireError||'ajaxNextWeekList未発火',researchPhase);
    if(!manual&&autoActive(s))schedule(meal);
    return false;
  }
  return true;
}

function researchTick(){
  if(!researchMode||isMaintenance())return;
  const d=new Date(),date=ymd(),h=d.getHours(),m=d.getMinutes();
  if(h===8&&m===57&&sessionStorage.getItem(RESEARCH_857_RUN_KEY)!==date){
    sessionStorage.setItem(RESEARCH_857_RUN_KEY,date);
    beginResearchWindow('8:57');
  }
  if(h===9&&m===0&&sessionStorage.getItem(RESEARCH_900_RUN_KEY)!==date){
    sessionStorage.setItem(RESEARCH_900_RUN_KEY,date);
    if(!researchWindowActive){
      console.log(`[${NAME}] 9:00時点で調査管理未開始のため本日の9時調査は実行しません`);
      return;
    }
    if(researchRound)researchPass1Queued=true;
    else runResearchRound('pass1');
  }
}
function runResearchRound(phase,pendingBefore=new Set()){
  refreshBlocks();
  const meals=existingMeals();
  if(!researchMode||!researchWindowActive||!meals.length)return;
  researchRound={phase,pending:new Set(meals)};
  console.log(`[${NAME}] 9時調査 ${researchRoundLabel(phase)} 読込開始`);
  meals.forEach(meal=>{
    const s=getState(meal);
    if(phase==='baseline'&&pendingBefore.has(meal)&&s.pending>0){
      researchBaselineWait.add(meal);
      console.log(`[${NAME}] ${meal} 8:57直前の通常通信完了待ち`);
      return;
    }
    if(s.pending){
      recordAm9Error(meal,'既存通信がPending中',phase);
      sendResearchErrorDiscord(meal,phase,'既存通信がPending中');
      if(phase==='baseline')ensureResearchFallback(meal);
      markResearchDone(meal,phase);
      return;
    }
    if(!fireSameWeek(meal,true,phase)){
      if(phase==='baseline')ensureResearchFallback(meal);
      markResearchDone(meal,phase);
    }
  });
  finishResearchRoundIfReady();
}
function triggerWaitingResearchBaseline(meal){
  if(!researchBaselineWait.has(meal))return false;
  if(!researchMode||!researchWindowActive||researchRound?.phase!=='baseline'){researchBaselineWait.delete(meal);return false;}
  const s=getState(meal);
  if(s.pending)return false;
  researchBaselineWait.delete(meal);
  setTimeout(()=>{
    if(!researchMode||!researchWindowActive||researchRound?.phase!=='baseline')return;
    if(!fireSameWeek(meal,true,'baseline')){
      ensureResearchFallback(meal);
      markResearchDone(meal,'baseline');
    }
  },50);
  return true;
}
function markResearchDone(meal,phase){
  if(!researchRound||researchRound.phase!==phase)return;
  researchRound.pending.delete(meal);
  finishResearchRoundIfReady();
}
function finishResearchRoundIfReady(){
  if(!researchRound||researchRound.pending.size)return;
  const phase=researchRound.phase;
  researchRound=null;
  console.log(`[${NAME}] 9時調査 ${researchRoundLabel(phase)} 読込完了`);
  if(!researchMode||!researchWindowActive){renderPanels();return;}
  if(phase==='baseline'&&researchPass1Queued){
    researchPass1Queued=false;
    setTimeout(()=>runResearchRound('pass1'),100);
    renderPanels();
    return;
  }
  if(phase==='pass1'){
    setTimeout(()=>runResearchRound('pass2'),100);
    renderPanels();
    return;
  }
  if(phase==='pass2')setTimeout(finishResearchModeAuto,100);
  renderPanels();
}
function researchCompare(meal,meta,current,phase){
  const data=loadResearchBaseline(),base=data.entries?.[meal],key=snapshotKey(meta,meal,current);
  if(!base||base.key!==key){
    const error=!base?'比較基準スナップショットなし':'比較基準と検索条件が一致しません';
    recordAm9Error(meal,error,phase);
    sendResearchErrorDiscord(meal,phase,error);
    data.entries[meal]={source:phase,key,weekStart:current.weekStart,weekEnd:current.weekEnd,slots:current.slots,savedAt:Date.now()};
    saveResearchBaselineData(data);
    snapshots.set(key,current.slots);
    seedVacancyHistory(meal,current);
    return;
  }
  recordAm9Comparison(meal,base,current,phase);
  const changes=trackVacancyTransitions(compareSlotMaps(base.slots,current.slots,meal));
  sendResearchResult(meal,current,changes,phase==='pass1'?1:2);
  data.entries[meal]={source:phase,key,weekStart:current.weekStart,weekEnd:current.weekEnd,slots:current.slots,savedAt:Date.now()};
  saveResearchBaselineData(data);
  snapshots.set(key,current.slots);
}

function bodyString(body){if(typeof body==='string')return body;if(body instanceof URLSearchParams)return body.toString();return '';}
function watched(url){try{return PATHS.includes(new URL(url,location.href).pathname);}catch{return false;}}
function slotStatus(li){
  if(li.classList.contains('reservationAble')||li.querySelector('a[onclick*="toOrderForWeek"]')||li.querySelector('img[alt="予約する"]'))return '空席';
  const text=li.querySelector('.text')?.textContent?.replace(/\s+/g,'')||'';
  if(text.includes('受付終了')){
    if(li.classList.contains('full'))return '◆受付終了[満席]';
    if(li.classList.contains('disabled'))return '◆受付終了[時間切れ]';
    return '◆受付終了';
  }
  if(li.classList.contains('full')||text.includes('満席'))return '満席';
  return '不明';
}
function readCurrentSlots(meal){
  const block=blocks.get(meal);
  if(!block)throw new Error('対象食事区分なし');
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
      if(time)slots[`${date}|${time}`]=slotStatus(li);
    });
  });
  return {weekStart:dates[0],weekEnd:dates[dates.length-1],slots};
}
function snapshotKey(meta,meal,current){
  const p=new URLSearchParams(meta.body);
  return [
    meal,p.get('commodityCD')||'',current.weekStart,current.weekEnd,
    p.get('adultNum')||'',p.get('childNum')||'',p.get('childAgeInform')||'',
    p.get('wheelchairCount')||'',p.get('stretcherCount')||''
  ].join('|');
}
function compareSlotMaps(prev,curr,meal){
  const changes=[];
  Object.keys(curr).forEach(slot=>{
    if(has(prev,slot))return;
    const [date,time]=slot.split('|');
    changes.push({type:'added',meal,date,time,to:curr[slot]});
  });
  Object.keys(prev).forEach(slot=>{
    if(has(curr,slot))return;
    const [date,time]=slot.split('|');
    changes.push({type:'deleted',meal,date,time,from:prev[slot]});
  });
  Object.keys(curr).forEach(slot=>{
    if(!has(prev,slot))return;
    const from=prev[slot],to=curr[slot];
    if(from==='不明'||to==='不明'||from===to)return;
    const [date,time]=slot.split('|');
    changes.push({type:'changed',meal,date,time,from,to});
  });
  return changes;
}
function seedVacancyHistory(meal,current){
  const now=Date.now();
  Object.entries(current.slots).forEach(([slot,status])=>{
    if(status!=='空席')return;
    const [date,time]=slot.split('|'),key=vacancyKey({meal,date,time});
    if(!vacancyHistory.has(key))vacancyHistory.set(key,{count:1,lastFullAt:null,lastVacancyAt:now});
  });
}
function compareAndSave(meta,meal,current){
  const key=snapshotKey(meta,meal,current),previous=snapshots.get(key);
  if(!previous){
    snapshots.set(key,current.slots);
    seedVacancyHistory(meal,current);
    return [];
  }
  const changes=compareSlotMaps(previous,current.slots,meal),next={};
  Object.keys(current.slots).forEach(slot=>{
    next[slot]=current.slots[slot]==='不明'&&has(previous,slot)&&previous[slot]!=='不明'?previous[slot]:current.slots[slot];
  });
  snapshots.set(key,next);
  return changes;
}
function vacancyKey(c){return `${restaurantName()}|${c.date}|${c.meal}|${c.time}`;}
function trackVacancyTransitions(changes){
  const now=Date.now();
  return changes.map(c=>{
    const key=vacancyKey(c),h=vacancyHistory.get(key)||{count:0,lastFullAt:null,lastVacancyAt:null};
    if(c.type==='changed'&&c.to!=='空席'){
      h.lastFullAt=now;
      vacancyHistory.set(key,h);
      return c;
    }
    const vacancyEvent=(c.type==='changed'&&c.to==='空席')||(c.type==='added'&&c.to==='空席');
    if(!vacancyEvent)return c;
    const prevVacancyGapMs=h.lastVacancyAt===null?null:now-h.lastVacancyAt;
    h.count++;
    const gapMs=h.lastFullAt===null?null:now-h.lastFullAt;
    const notify=h.count===1||(gapMs!==null&&gapMs>=VACANCY_RENOTIFY_MS);
    h.lastVacancyAt=now;
    h.lastFullAt=null;
    vacancyHistory.set(key,h);
    return {...c,vacancy:{count:h.count,gapMs,prevVacancyGapMs,notify}};
  });
}
function saveFullSnapshots(meal,current){
  const copy={weekStart:current.weekStart,weekEnd:current.weekEnd,slots:{...current.slots},savedAt:Date.now()};
  latestAnySnapshots.set(meal,copy);
  if(!scriptStartSnapshots.has(meal))scriptStartSnapshots.set(meal,{...copy,slots:{...copy.slots}});
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
    const meta={body:str,commodity,pendingTimer:null,errorCounted:false,researchPhase:researchPhaseHint||''};
    if(meal){
      const s=getState(meal);
      clearTimer(s);
      if(s.pending++===0){s.startedAt=performance.now();s.pendingError=false;}
      renderPanels();
    }
    meta.pendingTimer=setTimeout(()=>{
      const pendingMeal=meal||resolveMeal(commodity);
      if(pendingMeal){
        const s=getState(pendingMeal);
        s.pendingError=true;
        requestError(pendingMeal,meta,'Pending 5分超過');
      }else{
        recordNormalError('食事区分不明','Pending 5分超過');
        sendErrorDiscord('食事区分不明','Pending 5分超過');
      }
      renderPanels();
    },PENDING_ERROR_MS);
    this.addEventListener('loadend',()=>{
      clearTimeout(meta.pendingTimer);
      let text='';
      try{text=this.responseText||'';}catch{}
      const resolved=meal||resolveMeal(commodity);
      if(!resolved){
        unresolved.push({meta,status:this.status,text});
        queueRefresh();
        return;
      }
      setTimeout(()=>finishRequest(resolved,meta,this.status,text),30);
    },{once:true});
  }
  return nativeSend.call(this,body);
};
function requestError(meal,meta,error){
  const count=!meta.errorCounted;
  meta.errorCounted=true;
  reportError(meal,error,meta.researchPhase,count);
}
function finishRequest(meal,meta,status,text){
  const s=getState(meal);
  if(status!==403)s.error403=false;
  if(status===403){
    s.error403=true;
    requestError(meal,meta,'HTTP 403');
  }else if(status<200||status>=300)requestError(meal,meta,status===0?'通信失敗（status 0）':`HTTP ${status}`);
  else if(!text)requestError(meal,meta,'空レスポンス');
  else if(text.includes('paramErrorDiv'))requestError(meal,meta,'サイト内部エラー（paramErrorDiv）');
  else{
    try{
      refreshBlocks();
      if(!blocks.has(meal)){
        clearTimer(s);
        console.log(`[${NAME}] ${meal} 対象DOMなしのため解析スキップ`);
      }else{
        const current=readCurrentSlots(meal);
        lastKnownRanges.set(meal,{weekStart:current.weekStart,weekEnd:current.weekEnd});
        saveFullSnapshots(meal,current);
        if(meta.researchPhase==='baseline')saveResearchBase(meal,meta,current,researchBaselineSourceLabel);
        else if(meta.researchPhase==='pass1'||meta.researchPhase==='pass2')researchCompare(meal,meta,current,meta.researchPhase);
        else{
          recordNormalSuccess(meal,current);
          const changes=trackVacancyTransitions(compareAndSave(meta,meal,current));
          saveLatestNormal(meal,meta,current);
          recordNormalChanges(changes);
          if(changes.length)sendChangesDiscord(changes);
        }
        resetErrors(meal);
      }
    }catch(e){
      console.error(`[${NAME}] ${meal} 解析失敗`,e);
      requestError(meal,meta,`Response解析エラー：${e.message||e}`);
    }
  }
  if(meta.researchPhase==='baseline'&&researchMode&&researchWindowActive)ensureResearchFallback(meal);
  if(s.pending>0)s.pending--;
  if(!s.pending){
    s.startedAt=0;
    s.pendingError=false;
    if(!triggerWaitingResearchBaseline(meal)&&autoActive(s)&&blocks.has(meal))schedule(meal);
  }
  markResearchDone(meal,meta.researchPhase);
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

function sortChanges(changes){return [...changes].sort((a,b)=>a.date.localeCompare(b.date)||MEALS.indexOf(a.meal)-MEALS.indexOf(b.meal)||a.time.localeCompare(b.time));}
function groupDateMeal(changes){
  const map=new Map();
  sortChanges(changes).forEach(c=>{
    const key=`${c.date}|${c.meal}`;
    if(!map.has(key))map.set(key,{date:c.date,meal:c.meal,changes:[]});
    map.get(key).changes.push(c);
  });
  return [...map.values()];
}
function buildTitle(icon,date,meal){return [`${icon}${nowText()}`,`${fmtDateJa(date)} 【${meal}】`,restaurantName()].join('\n');}
function buildResearchTitle(icon,current,meal){return [`${icon}${nowText()}`,`調査期間：${fmtResearchRange(current.weekStart,current.weekEnd)} 【${meal}】`,restaurantName()].join('\n');}
function buildTimeOnlyDescription(changes){
  const times=sortChanges(changes).map(c=>c.time),lines=[];
  for(let i=0;i<times.length;i+=2)lines.push(times.slice(i,i+2).join(' '));
  return lines.join('\n');
}
function displayStatus(s){return String(s||'不明').startsWith('◆受付終了')?'◆受付終了':s;}
function buildAddedDescription(changes){
  return sortChanges(changes).map(c=>{
    const st=displayStatus(c.to),icon=st==='空席'?'🔴':st==='満席'?'⚫️':st==='◆受付終了'?'◆':'';
    return `${c.time}　🔵新規（${icon}${st}）`;
  }).join('\n');
}
function buildDeletedDescription(changes){return sortChanges(changes).map(c=>`${c.time}　🔷削除`).join('\n');}
function buildReceptionDescription(changes){return sortChanges(changes).map(c=>`${c.time}　${displayStatus(c.to)}`).join('\n');}
function formatGap(ms){const min=Math.floor(ms/60000);if(min<60)return `${min}分`;const h=Math.floor(min/60),m=min%60;return m?`${h}時間${m}分`:`${h}時間`;}
function buildVacancyFilteredDescription(changes){
  return sortChanges(changes).map(c=>{
    const v=c.vacancy;
    if(!v||v.count<=1)return `${c.time}　🆕初回空席`;
    return `${c.time}　🔄再出現 ${v.count}回目（満席化から${formatGap(v.gapMs)}）`;
  }).join('\n');
}
function commodityForMeal(meal){return blocks.get(meal)?.commodity||'';}
function timeMinutes(v){const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);return m?+m[1]*60 + +m[2]:null;}
function timeInRange(v,start,end){const t=timeMinutes(v),a=timeMinutes(start),b=timeMinutes(end);return t!==null&&t>=a&&t<=b;}
function believeRange(date){const key=normalizeYmd(date);return key&&key<='20260914'?['18:20','20:10']:['17:50','19:50'];}
function vacancyCategory(c){
  if(!((c.type==='changed'&&c.to==='空席')||(c.type==='added'&&c.to==='空席')))return null;
  const name=restaurantName(),commodity=commodityForMeal(c.meal),days=reservationLeadDays(c.date),time=c.time||'',range=believeRange(c.date);
  if(name.includes('ベッラヴィスタ')){
    if(c.meal==='朝食')return 'special';
    if(c.meal==='夕食'&&['18:50','19:00','19:10'].includes(time))return 'special';
  }
  if(name.includes('オチェーアノ')&&c.meal==='夕食'&&/OCEZB/i.test(commodity)&&timeInRange(time,range[0],range[1]))return 'special';
  if(name.includes('ベッラヴィスタ')&&c.meal==='夕食'&&timeInRange(time,range[0],range[1]))return 'believe';
  if(name.includes('オチェーアノ')&&c.meal==='夕食'&&/OCEZA/i.test(commodity)&&timeInRange(time,range[0],range[1]))return 'believe';
  if(name.includes('ベッラヴィスタ')&&days!==null&&days>=11)return 'rare';
  if(name.includes('ハイピリオン')&&days!==null&&/HPL(?:3001|3002|3005|3006)/i.test(commodity)&&days>=7)return 'rare';
  if(name.includes('ハイピリオン')&&days!==null&&/HPL(?:4001|4002|4003|4004)/i.test(commodity)&&days>=4)return 'rare';
  if(name.includes('シェフ・ミッキー')&&days!==null&&days>=4)return 'rare';
  if(name.includes('チックタック')&&days!==null&&days>=4)return 'rare';
  if(name.includes('ドリーマーズ')&&days!==null&&days>=11)return 'rare';
  return null;
}
function buildCategoryDescription(changes,category){
  const label=category==='special'?'⭐️特レア空席':category==='believe'?'💫ビリーヴ時間帯':'🟡レア空席';
  return sortChanges(changes).map(c=>`${c.time}　${label}${c.type==='added'?'（新規枠）':''}`).join('\n');
}
function useResearchChannel(){return researchWindowActive||researchNotifyEnabled();}
function discordWebhook(target){return target==='research'?window.TDR_WEBHOOKS?.restaurantResearch:window.TDR_WEBHOOKS?.restaurant;}
function postDiscord(title,description,color,target='auto'){
  const actual=target==='auto'?(useResearchChannel()?'research':'normal'):target,webhook=discordWebhook(actual);
  if(!webhook){console.warn(`[${NAME}] Discord通知先未設定：${actual==='research'?'restaurantResearch':'restaurant'}`);return;}
  fetch(webhook,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    keepalive:true,
    body:JSON.stringify({username:NAME,embeds:[{title:title.slice(0,256),description:description.slice(0,4000),color}]})
  }).catch(e=>console.error(`[${NAME}] Discord通知失敗`,e));
}
function postCriticalDiscord(title,description,color){
  postDiscord(title,description,color,'normal');
  if(useResearchChannel()&&discordWebhook('research')!==discordWebhook('normal'))postDiscord(title,description,color,'research');
}
function sendCategoryDiscord(changes,category){
  const icon=category==='special'?'⭐️':category==='believe'?'💫':'🟡';
  const color=category==='special'?GOLD:category==='believe'?PURPLE:YELLOW;
  groupDateMeal(changes).forEach(g=>postCriticalDiscord(buildTitle(icon,g.date,g.meal),withReservationLead(buildCategoryDescription(g.changes,category),g.date),color));
}
function sendChangesDiscord(changes){
  syncNotifyDay();
  const categorized={special:[],believe:[],rare:[]},taken=new Set();
  changes.forEach(c=>{
    const cat=vacancyCategory(c);
    if(cat){categorized[cat].push(c);taken.add(c);}
  });
  ['special','believe','rare'].forEach(cat=>{if(categorized[cat].length)sendCategoryDiscord(categorized[cat],cat);});
  const added=changes.filter(c=>c.type==='added'&&!taken.has(c)),deleted=changes.filter(c=>c.type==='deleted');
  groupDateMeal(added).forEach(g=>postDiscord(buildTitle('🔵',g.date,g.meal),withReservationLead(buildAddedDescription(g.changes),g.date),BLUE));
  groupDateMeal(deleted).forEach(g=>postDiscord(buildTitle('🔷',g.date,g.meal),withReservationLead(buildDeletedDescription(g.changes),g.date),BLUE));
  if(notifyState.mode==='off')return;
  if(notifyState.mode==='all'){
    groupDateMeal(changes.filter(c=>c.type==='changed'&&c.to==='空席'&&!taken.has(c))).forEach(g=>postDiscord(buildTitle('🔴',g.date,g.meal),withReservationLead(buildTimeOnlyDescription(g.changes),g.date),RED));
    groupDateMeal(changes.filter(c=>c.type==='changed'&&c.to==='満席')).forEach(g=>postDiscord(buildTitle('⚫️',g.date,g.meal),withReservationLead(buildTimeOnlyDescription(g.changes),g.date),BLACK));
    groupDateMeal(changes.filter(c=>c.type==='changed'&&String(c.to).startsWith('◆受付終了'))).forEach(g=>postDiscord(buildTitle('◆',g.date,g.meal),withReservationLead(buildReceptionDescription(g.changes),g.date),GRAY));
    return;
  }
  const vacancy=changes.filter(c=>c.type==='changed'&&c.to==='空席'&&c.vacancy?.notify&&!taken.has(c));
  groupDateMeal(vacancy).forEach(g=>postDiscord(buildTitle('🔴',g.date,g.meal),withReservationLead(buildVacancyFilteredDescription(g.changes),g.date),RED));
}
function sendResearchResult(meal,current,changes,pass){
  const prefix=`AM9時調査 ${pass}周目`;
  if(!changes.length){
    postDiscord(buildResearchTitle('⚪️',current,meal),`${prefix}\n差分なし`,GRAY,'research');
    return;
  }
  const categorized={special:[],believe:[],rare:[]},taken=new Set();
  changes.forEach(c=>{
    const cat=vacancyCategory(c);
    if(cat){categorized[cat].push(c);taken.add(c);}
  });
  ['special','believe','rare'].forEach(cat=>{if(categorized[cat].length)sendCategoryDiscord(categorized[cat],cat);});
  const added=changes.filter(c=>c.type==='added'&&!taken.has(c));
  const deleted=changes.filter(c=>c.type==='deleted');
  const vacancy=changes.filter(c=>c.type==='changed'&&c.to==='空席'&&!taken.has(c));
  const full=changes.filter(c=>c.type==='changed'&&c.to==='満席');
  const closed=changes.filter(c=>c.type==='changed'&&String(c.to).startsWith('◆受付終了'));
  groupDateMeal(added).forEach(g=>postDiscord(buildResearchTitle('🔵',current,g.meal),withReservationLead(`${prefix}\n変化日：${fmtDateShortJa(g.date)}\n${buildAddedDescription(g.changes)}`,g.date),BLUE,'research'));
  groupDateMeal(deleted).forEach(g=>postDiscord(buildResearchTitle('🔷',current,g.meal),withReservationLead(`${prefix}\n変化日：${fmtDateShortJa(g.date)}\n${buildDeletedDescription(g.changes)}`,g.date),BLUE,'research'));
  groupDateMeal(vacancy).forEach(g=>postDiscord(buildResearchTitle('🔴',current,g.meal),withReservationLead(`${prefix}\n変化日：${fmtDateShortJa(g.date)}\n${buildTimeOnlyDescription(g.changes)}`,g.date),RED,'research'));
  groupDateMeal(full).forEach(g=>postDiscord(buildResearchTitle('⚫️',current,g.meal),withReservationLead(`${prefix}\n変化日：${fmtDateShortJa(g.date)}\n${buildTimeOnlyDescription(g.changes)}`,g.date),BLACK,'research'));
  groupDateMeal(closed).forEach(g=>postDiscord(buildResearchTitle('◆',current,g.meal),withReservationLead(`${prefix}\n変化日：${fmtDateShortJa(g.date)}\n${buildReceptionDescription(g.changes)}`,g.date),GRAY,'research'));
}

async function getPublicIp(){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),IP_TIMEOUT);
  try{
    const r=await fetch('https://api.ipify.org?format=json',{cache:'no-store',signal:controller.signal});
    if(!r.ok)throw new Error(`HTTP ${r.status}`);
    const data=await r.json();
    return data.ip||'取得失敗';
  }catch(e){
    console.warn(`[${NAME}] IP取得失敗`,e);
    return '取得失敗';
  }finally{clearTimeout(timer);}
}
async function sendErrorDiscord(meal,error){
  const key=`${meal}|${error}`,now=Date.now();
  if(now-(errorNotifyHistory.get(key)||0)<60000)return;
  errorNotifyHistory.set(key,now);
  const ip=await getPublicIp();
  postDiscord([`🟠${nowText()}`,restaurantName(),`【${meal}】`].join('\n'),[`エラー：${error}`,`公開IP：${ip}`].join('\n'),ORANGE);
}
async function sendResearchErrorDiscord(meal,phase,error){
  const ip=await getPublicIp(),label=phase==='baseline'?`${researchBaselineSourceLabel}基準`:phase==='pass1'?'1周目':phase==='pass2'?'2周目':'';
  postDiscord([`🟠${nowText()}`,restaurantName(),`【${meal}】`].join('\n'),[`AM9時調査 ${label}`,`読込エラー：${error}`,`公開IP：${ip}`].join('\n'),ORANGE,'research');
}
async function sendForceStopDiscord(meal,lastError,range){
  const ip=await getPublicIp();
  postCriticalDiscord([`🔶${nowText()}`,restaurantName(),`【${meal}】`].join('\n'),[
    `検索期間：${range}`,
    `エラーが${MAX_ERRORS}回連続しました。`,
    '安全のため自動読込を停止しました。',
    `最後のエラー：${lastError}`,
    `公開IP：${ip}`
  ].join('\n'),ORANGE);
}
function snapshotText(){
  if(!snapshots.size)return 'スナップショットなし';
  const out=[];
  snapshots.forEach((slots,key)=>{
    const p=key.split('|'),meal=p[0],start=p[2],end=p[3];
    out.push(`=== ${meal}｜${start}～${end} ===`);
    Object.keys(slots).sort().forEach(k=>out.push(`${k} = ${slots[k]}`));
    out.push('');
  });
  return out.join('\n').trim();
}
window.SNAPSHOT=()=>{
  const text=snapshotText();
  console.log(text);
  if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).then(()=>console.log(`[${NAME}] スナップショットをクリップボードへコピーしました`)).catch(()=>{});
  return text;
};

function init(){
  refreshBlocks();
  setTimeout(refreshBlocks,300);
  setTimeout(refreshBlocks,1000);
  if(researchMode){
    const d=new Date(),min=d.getHours()*60+d.getMinutes();
    if(min>=537&&min<540){
      sessionStorage.setItem(RESEARCH_857_RUN_KEY,ymd());
      setTimeout(()=>beginResearchWindow(d.getMinutes()===57?'8:57':`${clockHM()}緊急`),200);
    }
  }
  if(document.body)new MutationObserver(ms=>{
    if(ms.some(m=>!panelRoot?.contains(m.target)))queueRefresh();
  }).observe(document.body,{childList:true,subtree:true});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();

setInterval(()=>{
  maintenanceTick();
  researchTick();
  normalLogTick();
  renderPanels();
},UI_TICK);

console.log(`[${NAME}] v4.37 起動`);
})();
