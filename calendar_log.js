// ==UserScript==
// @name         📅 空室在庫ログ
// @namespace    http://tampermonkey.net/
// @version      4.00
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar_log.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar_log.js
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const WEBHOOK_URL = 'https://discord.com/api/webhooks/1484508249943445535/MhUkh4McvQTKXn5gQcFJ8kXMbAvqIebGq--unxE0oreYRTXbUVjsg1rOsZ8AJH7ljGQd';

  const LABEL = { 0: '空室', 1: '満室', 2: '吸収', 3: '非売' };
  const STYLE = {
    0: 'color:red;font-weight:bold',
    1: 'color:black',
    2: 'color:blue',
    3: 'color:green'
  };
  const BTN_COLOR = { 0: 'red', 1: '#000', 2: 'blue', 3: 'green' };

  const pad = x => String(x).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  const td = new Date(),
        p7 = new Date(td),
        p4 = new Date(td);
  p7.setDate(p7.getDate() + 7);
  p4.setMonth(p4.getMonth() + 4);
  const HL = {
    [fmt(td)]: 'background:#000;color:#fff',
    [fmt(p7)]: 'background:#ccc;color:#000',
    [fmt(p4)]: 'background:#0078d7;color:#fff'
  };

  let mode = 0;
  const filters = { 0: true, 1: true, 2: true, 3: true };
  let longTimer = null;
  let notifyEnabled = false;
  const notifyHistory = new Map();

  const makeBtn = (txt, bg) =>
    Object.assign(document.createElement('div'), {
      textContent: txt,
      style: `background:${bg};color:#fff;padding:4px 8px;margin-right:4px;cursor:pointer;border-radius:4px;font-size:12px;user-select:none;text-align:center;`
    });

  const panel = Object.assign(document.createElement('div'), {
    style: 'position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;z-index:99999'
  });

  const btnMain = makeBtn('手動', '#000');
  const btnNotify = makeBtn('通知', '#ff4fa3');

  const updateMain = () => {
    if (mode === 0) { btnMain.textContent = '手動'; btnMain.style.background = '#000'; }
    if (mode === 1) { btnMain.textContent = '短期'; btnMain.style.background = 'orange'; }
    if (mode === 2) { btnMain.textContent = '長期'; btnMain.style.background = 'purple'; }
    if (mode === 3) { btnMain.textContent = '空室'; btnMain.style.background = 'pink'; }
  };

  const updateNotify = () => {
    btnNotify.style.opacity = notifyEnabled ? '1' : '0.35';
  };

  btnMain.onclick = () => {
    hideVacancyPanel();
    clearTimeout(longTimer);
    longTimer = null;
    mode = (mode + 1) % 4;
    updateMain();
    if (mode !== 0) triggerSearch();
  };

  btnNotify.onclick = () => {
    notifyEnabled = !notifyEnabled;
    updateNotify();
  };

  const makeFilter = c => {
    const b = makeBtn(LABEL[c], BTN_COLOR[c]);
    b.onclick = () => { filters[c] = !filters[c]; b.style.opacity = filters[c] ? 1 : 0.3; };
    return b;
  };

  panel.append(btnMain, makeFilter(0), makeFilter(1), makeFilter(2), makeFilter(3), btnNotify);
  document.body.appendChild(panel);
  updateNotify();

  const triggerSearch = () => {
    hideVacancyPanel();
    clearTimeout(longTimer);
    longTimer = null;
    const sel = document.getElementById('boxCalendarSelect');
    if (sel && !document.querySelector('span.calLoad')) {
      sel.dispatchEvent(new Event('change'));
    }
  };

  const tStr = () => {
    const d = new Date();
    return d.toTimeString().slice(0, 8) + '.' + pad(d.getMilliseconds(), 3);
  };

  const nowStr = () => {
    const d = new Date();
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${tStr()}`;
  };

  const dateStr = s => `${s.slice(0, 4)}/${s.slice(4, 6)}/${s.slice(6)}`;

  const stockMark = n => {
    const v = Number(n) || 0;
    if (v <= 0) return '';
    if (v === 1) return '①';
    if (v === 2) return '②';
    if (v === 3) return '③';
    if (v === 4) return '④';
    if (v === 5) return '⑤';
    return '◯';
  };

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const sendDiscord = async content => {
    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content })
      });
    } catch (e) {
      console.error('Discord通知失敗', e);
    }
  };

  const sendDiscordQueue = async list => {
    for (const text of list) {
      await sendDiscord(text);
      await sleep(300);
    }
  };

  if (window.$?.lifeobs?.ajax) {
    const orig = $.lifeobs.ajax;
    $.lifeobs.ajax = opt => {
      if (opt.url.endsWith('/hotel/api/queryHotelPriceStock/')) {
        const ok = opt.success;
        opt.success = resp => {
          const found = logStock(resp);
          ok?.(resp);

          if (mode === 1) {
            triggerSearch();
          } else if (mode === 2) {
            longTimer = setTimeout(() => {
              triggerSearch();
            }, 600000);
          } else if (mode === 3) {
            if (found) {
              mode = 0;
              updateMain();
              showVacancyPanel();
            } else {
              triggerSearch();
            }
          }
        };
      }
      return orig(opt);
    };
  }

  function logStock(resp) {
    const rows = [];
    const notifications = [];
    let minDt = null;
    const infos = resp.ecRoomStockInfos ?? {};

    Object.values(infos).forEach(g =>
      Object.values(g.roomStockInfos ?? {}).forEach(r =>
        Object.entries(r.roomBedStockRangeInfos ?? {}).forEach(([roomCd, b]) =>
          (b.roomBedStockRange ?? []).forEach(d => {
            const dt = dateStr(d.useDate);
            const st = +d.saleStatus;
            const rm = d.remainStockNum ?? 0;
            const pr = d.priceFrameID ?? '??';
            const commodityCd = d.commodityCd ?? roomCd ?? b.currentRoomBedStock?.commodityCd ?? '不明';
            if (!minDt || dt < minDt) minDt = dt;
            if (filters[st]) rows.push({ dt, st, rm, pr, roomCd: commodityCd });
          })
        )
      )
    );

    rows.sort((a, b) => a.dt.localeCompare(b.dt));
    const baseYM = minDt ? minDt.slice(0, 7) : '';
    let vacancy = false;

    console.group(`📋 客室在庫ログ (${tStr()})`);
    rows.forEach(({ dt, st, rm, pr, roomCd }) => {
      if (st === 0 && dt.startsWith(baseYM)) {
        vacancy = true;
        if (notifyEnabled) {
          const key = `${roomCd}__${dt}`;
          const now = Date.now();
          const last = notifyHistory.get(key) ?? 0;
          if (now - last >= 60000) {
            notifyHistory.set(key, now);
            notifications.push(`検知 ${nowStr()}\n　部屋：${roomCd}\n　日付：${dt}　${stockMark(rm)}`);
          }
        }
      }
      const ds = HL[dt] || '', ss = STYLE[st];
      console.log(`%c${dt}%c\t%c${LABEL[st]}　${rm}　${pr}`, ds, '', ss);
    });
    console.groupEnd();

    if (notifications.length) {
      sendDiscordQueue(notifications);
    }

    return vacancy;
  }

  let vacancyPanel = null;

  function showVacancyPanel() {
    if (vacancyPanel) return;
    vacancyPanel = document.createElement('div');
    vacancyPanel.textContent = tStr();
    vacancyPanel.style.cssText = `
      position:fixed;
      left:50%;
      bottom:10%;
      transform:translateX(-50%);
      padding:14px 26px;
      font-size:20px;
      font-weight:bold;
      color:#fff;
      background:rgba(255,105,180,0.75);
      border-radius:14px;
      cursor:pointer;
      z-index:99998;
      user-select:none;
    `;
    vacancyPanel.onclick = hideVacancyPanel;
    document.body.appendChild(vacancyPanel);
  }

  function hideVacancyPanel() {
    vacancyPanel?.remove();
    vacancyPanel = null;
  }

})();
