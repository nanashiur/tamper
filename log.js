// ==UserScript==
// @name         🏨客室ロガー
// @namespace    http://tampermonkey.net/
// @version      3.03            // ← 空室発見オーバーレイを復活
// @description  連続検索 / 空室検索 / 色分けログ / 日付ハイライト / 出力フィルタ
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
  const pad=x=>String(x).padStart(2,'0');
  const fmt=d=>`${d.getFullYear()}/${pad(d.getMonth()+1)}/${pad(d.getDate())}`;
  const td=new Date(), p7=new Date(td), p4=new Date(td);
  p7.setDate(p7.getDate()+7); p4.setMonth(p4.getMonth()+4);
  const HL = {
    [fmt(td)] :'background:#000;color:#fff',
    [fmt(p7)] :'background:#ccc;color:#000',
    [fmt(p4)] :'background:#0078d7;color:#fff'
  };

  /* ---------- 検索対象月 ---------- */
  const BASE_YM = fmt(new Date()).slice(0,7);   // 例 "2025/07"

  /* ---------- 状態管理 ---------- */
  // mode: 0=停止, 1=連続検索, 2=空室検索
  let mode = 0;
  const filters = {0:true,1:true,2:true,3:true};

  /* ---------- UI ---------- */
  const makeBtn = (txt,bg)=>Object.assign(document.createElement('div'),{
    textContent:txt,
    style:`background:${bg};color:#fff;padding:4px 8px;margin-right:4px;
           cursor:pointer;border-radius:4px;font-size:12px;user-select:none;text-align:center;`
  });

  const panel = Object.assign(document.createElement('div'),{
    style:'position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;z-index:99999'
  });

  // 検索モード ボタン
  const btnMain = makeBtn('手動検索','#000');
  const updateMain = () => {
    if(mode===0){btnMain.textContent='手動検索';  btnMain.style.background='#000';  }
    if(mode===1){btnMain.textContent='連続検索';  btnMain.style.background='orange';}
    if(mode===2){btnMain.textContent='空室検索';  btnMain.style.background='red';   }
  };
  btnMain.onclick = () => {
    mode = (mode+1)%3;          // 0→1→2→0…
    updateMain();
    if(mode!==0) triggerSearch();
  };

  // フィルタボタン
  const makeFilter = c=>{
    const b=makeBtn(LABEL[c],BTN_COLOR[c]);
    b.onclick=()=>{filters[c]=!filters[c]; b.style.opacity = filters[c]?1:0.3;};
    return b;
  };

  panel.append(btnMain, makeFilter(0), makeFilter(1), makeFilter(2), makeFilter(3));
  document.body.appendChild(panel);

  /* ---------- 検索発火 ---------- */
  const triggerSearch = () => {
    const sel=document.getElementById('boxCalendarSelect');
    if(sel && !document.querySelector('span.calLoad')){
      sel.dispatchEvent(new Event('change'));
    }
  };

  const tStr = () => {
    const d=new Date(); return d.toTimeString().slice(0,8)+'.'+pad(d.getMilliseconds());
  };

  /* ---------- 空室オーバーレイ ---------- */
  const showVacancyOverlay = dates => {
    const ov = Object.assign(document.createElement('div'), {
      textContent: `空室発見: ${dates.join(', ')}`,
      style: `position:fixed;inset:0;z-index:100000;
              display:flex;justify-content:center;align-items:center;
              font-size:40px;font-weight:bold;color:#fff;background:rgba(255,0,0,0.8)`
    });
    document.body.appendChild(ov);
    setTimeout(()=>ov.remove(),500);
  };

  /* ---------- Ajax フック ---------- */
  if(window.$?.lifeobs?.ajax){
    const orig=$.lifeobs.ajax;
    $.lifeobs.ajax = opt=>{
      if(opt.url.endsWith('/hotel/api/queryHotelPriceStock/')){
        const origOK=opt.success;
        opt.success = resp=>{
          const {found, dates} = logStock(resp);   // 空室判定 & 日付一覧
          origOK?.(resp);

          if(mode===1){ triggerSearch(); }
          else if(mode===2){
            if(found){
              showVacancyOverlay(dates);
              mode=0; updateMain();
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
    const rows=[], infos=resp.ecRoomStockInfos??{};
    const vacancyDates=new Set();

    Object.values(infos).forEach(g=>
      Object.values(g.roomStockInfos??{}).forEach(r=>
        Object.values(r.roomBedStockRangeInfos??{}).forEach(b=>
          (b.roomBedStockRange??[]).forEach(d=>{
            const st=+d.saleStatus, dt=dateStr(d.useDate), ym = dt.slice(0,7);
            /* ---------- 空室検出：フィルタ無視 & 当月のみ ---------- */
            if(st===0 && ym===BASE_YM) vacancyDates.add(dt);

            /* ---------- ログ出力：フィルタ尊重 ---------- */
            if(filters[st]) rows.push({dt,st,rm:d.remainStockNum??0});
          })
        )
      )
    );
    rows.sort((a,b)=>a.dt.localeCompare(b.dt));

    console.group(`📋 客室在庫ログ (${tStr()})`);
    rows.forEach(({dt,st,rm})=>{
      const ds=HL[dt]||'', ss=STYLE[st];
      console.log(`%c${dt}%c\t%c${LABEL[st]}\t${rm}`, ds,'',ss);
    });
    console.groupEnd();
    return {found: vacancyDates.size>0, dates:[...vacancyDates]};
  };
})();
