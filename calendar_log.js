// ==UserScript==
// @name         📅 空室在庫ログ
// @namespace    http://tampermonkey.net/
// @version      4.35
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar_log.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar_log.js
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const WEBHOOK_URL = 'https://discord.com/api/webhooks/1494882197474381835/JIR_jzaAbrFFvj7-qPP8FO8kmWVp6ufX8bmCpOpFRQ4kPZVX_lTTF6knh79I2dLvy6aD';

  const save = (key, val) => localStorage.setItem(`cal_log_${key}`, JSON.stringify(val));
  const load = (key, def) => {
    const v = localStorage.getItem(`cal_log_${key}`);
    return v ? JSON.parse(v) : def;
  };

  const FULL_LABEL = { 0: '空室', 1: '満室', 2: '吸収', 3: '未販' };
  const LABEL = { 0: '空', 1: '満', 2: '吸', 3: '未' };
  
  const STYLE = { 0: 'color:red;font-weight:bold', 1: 'color:inherit', 2: 'color:blue', 3: 'color:green' };
  const BTN_COLOR = { 0: 'red', 1: '#000', 2: 'blue', 3: 'green' };

  const DISCORD_COLOR = {
    0: 16711680, // 赤
    1: 1,        // ほぼ黒
    2: 255,      // 青
    3: 32768     // 緑
  };

  const pad = (x, len = 2) => String(x).padStart(len, '0');
  const tStr = () => { 
    const d = new Date(); 
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${d.toTimeString().slice(0, 8)}.${pad(d.getMilliseconds(), 3)}`; 
  };

  const lastStatusState = new Map();
  const loadedKeys = new Set();

  let mode = load('mode', 0);
  const filters = load('filters', { 0: true, 1: true, 2: true, 3: true });
  let notifyEnabled = load('notify', true);
  let longTimer = null;

  const makeBtn = (txt, bg) => Object.assign(document.createElement('div'), {
    textContent: txt,
    style: `background:${bg};color:#fff;padding:4px 6px;margin-right:3px;cursor:pointer;border-radius:4px;font-size:12px;user-select:none;text-align:center;min-width:24px;line-height:1.2;`
  });

  const panel = Object.assign(document.createElement('div'), {
    style: 'position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;z-index:99999;background:rgba(255,255,255,0.8);padding:2px;border-radius:6px;box-shadow:0 2px 5px rgba(0,0,0,0.2);'
  });

  const btnMain = makeBtn('👆', '#000');
  const btnNotify = makeBtn('🔔', 'purple');

  const updateMain = () => {
    // 0:手動(👆/黒), 1:短期(🐇/赤), 2:長期(🐢/青), 3:空室(👁/ピンク)
    const modes = { 
      0: { t: '👆', c: '#000' }, 
      1: { t: '🐇', c: 'red' }, 
      2: { t: '🐢', c: 'blue' }, 
      3: { t: '👁', c: 'pink' } 
    };
    btnMain.textContent = modes[mode].t; 
    btnMain.style.background = modes[mode].c; 
    save('mode', mode);
  };

  const updateNotify = () => { btnNotify.style.opacity = notifyEnabled ? '1' : '0.25'; save('notify', notifyEnabled); };

  btnMain.onclick = () => { 
    hideVacancyPanel(); 
    clearTimeout(longTimer); 
    longTimer = null; 
    mode = (mode + 1) % 4; 
    updateMain(); 
    if (mode !== 0) triggerSearch(); 
  };
  btnNotify.onclick = () => { notifyEnabled = !notifyEnabled; updateNotify(); };

  const makeFilter = c => {
    const b = makeBtn(LABEL[c], BTN_COLOR[c]);
    const updateF = () => b.style.opacity = filters[c] ? 1 : 0.25;
    b.onclick = () => { filters[c] = !filters[c]; updateF(); save('filters', filters); };
    updateF(); return b;
  };

  panel.append(btnMain, makeFilter(0), makeFilter(1), makeFilter(2), makeFilter(3), btnNotify);
  document.body.appendChild(panel);
  updateMain(); updateNotify();

  const triggerSearch = () => {
    hideVacancyPanel(); clearTimeout(longTimer); longTimer = null;
    const sel = document.getElementById('boxCalendarSelect');
    if (sel && !document.querySelector('span.calLoad')) sel.dispatchEvent(new Event('change'));
  };

  const sendDiscordEmbed = async (dt, roomDispName, rm, st, lastSt, price, priceRank) => {
    const changeTxt = `${FULL_LABEL[lastSt]}→${FULL_LABEL[st]}`;
    const priceStr = price > 0 ? `　価格：${price.toLocaleString()}円` : '';
    const rankStr = priceRank ? `　[${priceRank}]` : '';
    
    const marks = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤' };
    const stockVisual = marks[rm] || '◯';

    const titleStr = `**${tStr()}**\n${dt}　${changeTxt}\n${roomDispName}`;

    const payload = {
      username: "ホテルカレンダー検索",
      embeds: [{
        title: titleStr,
        color: DISCORD_COLOR[st] ?? 1,
        description: st === 0 ? `在庫：${stockVisual}${priceStr}${rankStr}` : undefined
      }]
    };
    try {
      await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) { console.error('Discord通知失敗', e); }
  };

  if (window.$?.lifeobs?.ajax) {
    const orig = $.lifeobs.ajax;
    $.lifeobs.ajax = opt => {
      if (opt.url && opt.url.includes('/hotel/api/queryHotelPriceStock/')) {
        let params = {};
        if (typeof opt.data === 'string') {
          opt.data.split('&').forEach(pair => {
            const [k, v] = pair.split('=');
            params[k] = v;
          });
        } else {
          params = opt.data || {};
        }
        const contextKey = `${params.hotelId || 'default'}_${params.useYearMonth || 'now'}`;
        const ok = opt.success;
        opt.success = resp => {
          const anyVacancyFound = logStock(resp, contextKey);
          ok?.(resp);
          if (mode === 1) triggerSearch();
          else if (mode === 2) {
            const delay = 600000 + (Math.floor(Math.random() * 20001) - 10000);
            longTimer = setTimeout(() => { triggerSearch(); }, delay);
          } else if (mode === 3) {
            if (anyVacancyFound) {
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

  function logStock(resp, contextKey) {
    const infos = resp.ecRoomStockInfos ?? {};
    const isFirstTime = !loadedKeys.has(contextKey);
    const notifications = [];
    let vacancyDetected = false;

    console.group(tStr());

    Object.values(infos).forEach(g => Object.values(g.roomStockInfos ?? {}).forEach(r => {
      const roomName = r.roomName || "不明な客室";
      Object.entries(r.roomBedStockRangeInfos ?? {}).forEach(([roomCd, b]) =>
        (b.roomBedStockRange ?? []).forEach(d => {
          const dt = `${d.useDate.slice(0, 4)}/${d.useDate.slice(4, 6)}/${d.useDate.slice(6)}`;
          const st = +d.saleStatus;
          const rm = d.remainStockNum ?? 0;
          const priceRank = d.priceFrameID || d.priceLevel || '--'; 
          const totalPrice = d.roomPriceTotal || 0;
          const commodityCd = d.commodityCd || roomCd || "不明";
          
          const stateKey = `${contextKey}__${commodityCd}__${dt}`;
          const lastSt = lastStatusState.get(stateKey);

          if (st === 0 && rm > 0) {
            vacancyDetected = true;
          }

          if (!isFirstTime && notifyEnabled) {
            if (lastSt !== undefined && lastSt !== st) {
              notifications.push({ dt, roomDispName: roomName, rm, st, lastSt, price: totalPrice, priceRank });
            }
          }

          lastStatusState.set(stateKey, st);

          if (filters[st]) {
            console.log(`%c${dt}%c\t%c${LABEL[st]}　${rm}　${priceRank}`, '', '', STYLE[st]);
          }
        })
      );
    }));
    console.groupEnd();

    if (notifications.length > 0) {
      notifications.forEach(n => sendDiscordEmbed(n.dt, n.roomDispName, n.rm, n.st, n.lastSt, n.price, n.priceRank));
    }

    loadedKeys.add(contextKey);
    return vacancyDetected;
  }

  let vacancyPanel = null;
  function showVacancyPanel() {
    if (vacancyPanel) return;
    vacancyPanel = document.createElement('div');
    vacancyPanel.innerHTML = '✨ 空室を検知しました ✨<br><span style="font-size:12px;">検索を停止し手動モードに戻りました</span>';
    vacancyPanel.style.cssText = `position:fixed;left:50%;bottom:15%;transform:translateX(-50%);padding:16px 30px;font-size:18px;font-weight:bold;color:#fff;background:purple;border:2px solid #fff;border-radius:14px;cursor:pointer;z-index:99998;user-select:none;box-shadow: 0 4px 20px rgba(0,0,0,0.6);text-align:center;line-height:1.4;`;
    vacancyPanel.onclick = () => { vacancyPanel.remove(); vacancyPanel = null; };
    document.body.appendChild(vacancyPanel);
  }
  function hideVacancyPanel() { vacancyPanel?.remove(); vacancyPanel = null; }
})();
