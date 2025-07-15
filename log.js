// ==UserScript==
// @name         🧪TDR客室データテスター (loop + filter + highlight)
// @namespace    http://tampermonkey.net/
// @version      1.8.2
// @description  連続検索・色分けログ・フィルタ・日付ハイライト（反転は日付のみ）
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/log.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/log.js
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /* ---------- 表示ラベル & スタイル ---------- */
  const LABEL = { 0: '空室', 1: '満室', 2: '吸収', 3: '販無' };
  const STYLE = {
    0: 'color:red;font-weight:bold',
    1: 'color:black',
    2: 'color:blue',
    3: 'color:green'
  };
  const BTN_COLOR = { 1: '#000', 2: 'blue', 3: 'green' };

  /* ---------- 反転させる日付 ---------- */
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;

  const today  = new Date();
  const plus7  = new Date(today);  plus7.setDate (plus7.getDate () + 7);
  const plus4M = new Date(today);  plus4M.setMonth(plus4M.getMonth() + 4);

  const SPECIAL = new Set([fmt(today), fmt(plus4M), fmt(plus7)]);

  /* ---------- ヘルパ ---------- */
  const dateStr = d => `${d.slice(0, 4)}/${d.slice(4, 6)}/${d.slice(6)}`;
  const nowStr  = () => {
    const t = new Date();
    return t.toTimeString().slice(0, 8) + '.' + String(t.getMilliseconds()).padStart(3, '0');
  };

  /* ---------- 操作用パネル ---------- */
  const filters   = { 1: true, 2: true, 3: true };
  let   searching = false;

  const mkBtn = (txt, bg) => Object.assign(document.createElement('div'), {
    textContent: txt,
    style: `
      background:${bg};color:#fff;padding:4px 8px;margin-right:4px;
      cursor:pointer;border-radius:4px;font-size:12px;user-select:none;text-align:center;
    `
  });

  const panel = Object.assign(document.createElement('div'), {
    style: 'position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;z-index:99999'
  });

  const btnSearch = mkBtn('検索開始', '#0078d7');
  btnSearch.onclick = () => {
    searching = !searching;
    btnSearch.textContent      = searching ? '検索中' : '検索開始';
    btnSearch.style.background = searching ? 'red' : '#0078d7';
    if (searching) triggerSearch();
  };

  const mkFilterBtn = code => {
    const b = mkBtn(LABEL[code], BTN_COLOR[code]);
    b.onclick = () => {
      filters[code] = !filters[code];
      b.style.opacity = filters[code] ? '1' : '0.3';
    };
    return b;
  };

  panel.append(btnSearch, mkFilterBtn(1), mkFilterBtn(2), mkFilterBtn(3));
  document.body.appendChild(panel);

  /* ---------- 検索トリガ ---------- */
  const triggerSearch = () => {
    const sel = document.getElementById('boxCalendarSelect');
    if (sel && !document.querySelector('span.calLoad')) {
      sel.dispatchEvent(new Event('change'));
    }
  };

  /* ---------- Ajax フック ---------- */
  if (window.$?.lifeobs?.ajax) {
    const origAjax = $.lifeobs.ajax;
    $.lifeobs.ajax = opt => {
      if (opt.url.endsWith('/hotel/api/queryHotelPriceStock/')) {
        const origSuccess = opt.success;
        opt.success = resp => {
          logStock(resp);
          origSuccess?.(resp);
          if (searching) triggerSearch();
        };
      }
      return origAjax(opt);
    };
  }

  /* ---------- ログ出力 ---------- */
  const logStock = resp => {
    const rows = [];
    const infos = resp.ecRoomStockInfos ?? {};

    Object.values(infos).forEach(g =>
      Object.values(g.roomStockInfos ?? {}).forEach(r =>
        Object.values(r.roomBedStockRangeInfos ?? {}).forEach(b =>
          (b.roomBedStockRange ?? []).forEach(d => {
            const st = Number(d.saleStatus);
            if (st === 0 || filters[st]) {
              rows.push({
                date: dateStr(d.useDate),
                sale: st,
                remain: d.remainStockNum ?? 0
              });
            }
          })
        )
      )
    );

    rows.sort((a, b) => a.date.localeCompare(b.date));

    console.group(`📋 客室在庫ログ (${nowStr()})`);
    rows.forEach(({ date, sale, remain }) => {
      const dateStyle = SPECIAL.has(date) ? 'background:#000;color:#fff' : '';
      const saleStyle = STYLE[sale];
      console.log(`%c${date}%c\t%c${LABEL[sale]}\t${remain}`,
                  dateStyle, '', saleStyle);
    });
    console.groupEnd();
  };
})();
