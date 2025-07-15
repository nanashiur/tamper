// ==UserScript==
// @name         🏨空室ロガー
// @namespace    http://tampermonkey.net/
// @version      3.00
// @description  連続検索／空室が出るまで検索／色分けログ／日付ハイライト／出力フィルタ
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/log.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/log.js
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /* ---------- ラベル & 色 ---------- */
  const LABEL = { 0:'空室', 1:'満室', 2:'吸収', 3:'非売' };
  const STYLE = {
    0:'color:red;font-weight:bold',
    1:'color:black',
    2:'color:blue',
    3:'color:green'
  };
  const BTN_COLOR = { 0:'red', 1:'#000', 2:'blue', 3:'green' };

  /* ---------- 日付ハイライト ---------- */
  const pad2 = v => String(v).padStart(2,'0');
  const fmt  = d => `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())}`;
  const today = new Date(), plus7 = new Date(today), plus4m = new Date(today);
  plus7.setDate(today.getDate()+7);
  plus4m.setMonth(today.getMonth()+4);
  const HL = {
    [fmt(today)] :'background:#000;color:#fff',
    [fmt(plus7)] :'background:#ccc;color:#000',
    [fmt(plus4m)]:'background:#0078d7;color:#fff'
  };

  /* ---------- 状態管理 ---------- */
  // mode: 0 = 手動検索, 1 = 連続検索, 2 = 空室検索
  let mode = 0;
  const filters = {0:true,1:true,2:true,3:true};

  /* ---------- パネル ---------- */
  const makeBtn = (txt,bg)=>Object.assign(document.createElement('div'),{
    textContent:txt,
    style:`background:${bg};color:#fff;padding:4px 8px;margin-right:4px;
           cursor:pointer;border-radius:4px;font-size:12px;user-select:none;text-align:center;`
  });

  const panel = Object.assign(document.createElement('div'),{
    style:'position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;z-index:99999'
  });

  const btnMain = makeBtn('手動検索','#000');
  const updMain = () => {
    if(mode===0){ btnMain.textContent='手動検索';  btnMain.style.background='#000';   }
    if(mode===1){ btnMain.textContent='連続検索';  btnMain.style.background='orange';}
    if(mode===2){ btnMain.textContent='空室検索';  btnMain.style.background='red';   }
  };
  btnMain.onclick = () => {
    mode = (mode+1)%3;
    updMain();
    if(mode!==0) triggerSearch();
  };

  const makeFilter = c=>{
    const b = makeBtn(LABEL[c], BTN_COLOR[c]);
    b.onclick = ()=>{ filters[c]=!filters[c]; b.style.opacity = filters[c]?1:0.3; };
    return b;
  };

  panel.append(btnMain, makeFilter(0), makeFilter(1), makeFilter(2), makeFilter(3));
  document.body.appendChild(panel);
  updMain();

  /* ---------- 検索発火 ---------- */
  const triggerSearch = () => {
    const sel = document.getElementById('boxCalendarSelect');
    if(sel && !document.querySelector('span.calLoad')){
      sel.dispatchEvent(new Event('change'));
    }
  };

  const timeStr = () => {
    const d = new Date();
    return d.toTimeString().slice(0,8)+'.'+String(d.getMilliseconds()).padStart(3,'0');
  };

  /* ---------- オーバーレイ ---------- */
  const showVacancyOverlay = dates => {
    const ov = document.createElement('div');
    Object.assign(ov.style,{
      position:'fixed',inset:0,zIndex:999999,
      display:'flex',justifyContent:'center',alignItems:'center',
      background:'rgba(255,0,0,0.85)',color:'#fff',
      fontSize:'48px',fontWeight:'bold'
    });
    ov.textContent = `空室: ${dates.join(', ')}`;
    document.body.appendChild(ov);
    setTimeout(()=>ov.remove(),500);
  };

  /* ---------- Ajax フック ---------- */
  if(window.$?.lifeobs?.ajax){
    const orig = $.lifeobs.ajax;
    $.lifeobs.ajax = opt=>{
      if(opt.url.endsWith('/hotel/api/queryHotelPriceStock/')){
        const ok = opt.success;
        opt.success = resp=>{
          const found = logStock(resp);
          ok?.(resp);

          if(mode===1){ triggerSearch(); }
          else if(mode===2){
            if(found.vacant){
              showVacancyOverlay(found.dates);
              mode = 0; updMain();
            }else{
              triggerSearch();
            }
          }
        };
      }
      return orig(opt);
    };
  }

  /* ---------- ログ ---------- */
  const dateStr = s=>`${s.slice(0,4)}/${s.slice(4,6)}/${s.slice(6)}`;
  const logStock = resp=>{
    const rows=[], infos = resp.ecRoomStockInfos ?? {};
    Object.values(infos).forEach(g=>
      Object.values(g.roomStockInfos ?? {}).forEach(r=>
        Object.values(r.roomBedStockRangeInfos ?? {}).forEach(b=>
          (b.roomBedStockRange ?? []).forEach(d=>{
            const st = +d.saleStatus, dt = dateStr(d.useDate);
            if(filters[st]) rows.push({dt,st,rm:d.remainStockNum ?? 0});
          })
        )
      )
    );
    rows.sort((a,b)=>a.dt.localeCompare(b.dt));

    let baseYM = '';
    for(const {dt} of rows){
      if(dt.endsWith('/01')){ baseYM = dt.slice(0,7); break; }
    }
    if(!baseYM && rows.length) baseYM = rows[0].slice(0,7);

    const vacDates = [];
    rows.forEach(({dt,st})=>{
      const ym = dt.slice(0,7);
      if(st===0 && ym===baseYM){ vacDates.push(dt); }
    });
    const vacancyFound = vacDates.length>0;

    console.group(`📋 客室在庫ログ (${timeStr()})`);
    rows.forEach(({dt,st,rm})=>{
      const ds = HL[dt] || '', ss = STYLE[st];
      console.log(`%c${dt}%c\t%c${LABEL[st]}\t${rm}`, ds,'',ss);
    });
    console.groupEnd();

    return {vacant:vacancyFound, dates:vacDates};
  };
})();
