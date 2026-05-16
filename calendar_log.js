// ==UserScript==
// @name         📅 空室在庫ログ
// @version      4.85
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/?showWay*
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
  const TITLE_EMOJI = { 0: '🟥', 1: '⬛️', 2: '🟦', 3: '🟩' };
  const LABEL = { 0: '空', 1: '満', 2: '吸', 3: '未' };
  const STYLE = { 0: 'color:red;font-weight:bold', 1: 'color:inherit', 2: 'color:blue', 3: 'color:green' };
  const MARKS = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤' };
  const BTN_BG_COLOR = { 0: 'red', 1: '#000', 2: 'blue', 3: 'green' };

  const MODE_STYLE = {
    0: { t: '👆', c: '#000', f: '#fff' },
    1: { t: '🐇', c: 'orange', f: '#fff' }, 
    2: { t: '🐢', c: 'purple', f: '#fff' }, 
    3: { t: '👁', c: 'pink', f: '#000' }
  };

  const DISCORD_COLOR = { 0: 16711680, 1: 1, 2: 255, 3: 32768, error: 0xFFFF00 };

  const pad = (x, len = 2) => String(x).padStart(len, '0');
  const tStrSec = () => { 
    const d = new Date(); 
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${d.toTimeString().slice(0, 8)}`; 
  };
  const tStrMs = () => {
    const d = new Date();
    return `${d.toTimeString().slice(0, 8)}.${pad(d.getMilliseconds(), 3)}`;
  };
  const tStrFullMs = () => {
    const d = new Date();
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${d.toTimeString().slice(0, 8)}.${pad(d.getMilliseconds(), 3)}`;
  };

  // --- IP Caching System ---
  let cachedIP = 'unknown';
  let lastIPFetchTime = 0;
  const getIP = async () => {
    const now = Date.now();
    if (now - lastIPFetchTime < 60000 && cachedIP !== 'unknown') {
      return cachedIP;
    }
    const apis = ['https://inet-ip.info/ip', 'https://www.cloudflare.com/cdn-cgi/trace', 'https://api.ipify.org'];
    for (const url of apis) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        let text = await resp.text();
        if (url.includes('cloudflare')) {
          const match = text.match(/ip=([^\s]+)/);
          if (match) { cachedIP = match[1]; lastIPFetchTime = now; return cachedIP; }
        } else {
          text = text.trim();
          if (text) { cachedIP = text; lastIPFetchTime = now; return cachedIP; }
        }
      } catch (e) { continue; }
    }
    return cachedIP;
  };

  // --- Discord Webhook Queue System ---
  const discordQueue = [];
  let isProcessingQueue = false;

  const processDiscordQueue = async () => {
    if (isProcessingQueue || discordQueue.length === 0) return;
    isProcessingQueue = true;

    while (discordQueue.length > 0) {
      const payload = discordQueue[0];
      try {
        const resp = await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (resp.status === 429) {
          const rateLimitInfo = await resp.json();
          const retryAfter = rateLimitInfo.retry_after || 1;
          console.warn(`Discord Rate Limit: Waiting ${retryAfter}s...`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          continue; 
        }
        discordQueue.shift();
        await new Promise(r => setTimeout(r, 250));
      } catch (e) {
        console.error('Discord通知送信エラー', e);
        discordQueue.shift();
      }
    }
    isProcessingQueue = false;
  };

  const sendDiscord = (payload) => {
    discordQueue.push(payload);
    processDiscordQueue();
  };
  // --------------------------------------------------------

  const lastStateMap = new Map();
  const loadedKeys = new Set();
  
  let consecutiveErrorCount = 0; 

  let mode = load('mode', 0);
  const filters = load('filters', { 0: true, 1: true, 2: true, 3: true });
  let notifyEnabled = load('notify', false); 
  let longTimer = null;

  const initMonthClick = () => {
    const isSP = !!document.querySelector('.boxCalendar.month table');
    const monthElem = isSP 
      ? document.querySelector('.boxCalendar.month .selectMonth li p.currentMonth')
      : document.querySelector('.boxInputSelect .cal table.vacancyCalTable tbody tr th.heading');
    if (monthElem && !monthElem.dataset.hasListener) {
      monthElem.style.cursor = 'pointer';
      monthElem.addEventListener('click', () => {
        const loading = isSP 
          ? document.querySelectorAll('.boxCalendar.month table tbody tr td dl dd span.calLoad').length > 0
          : document.querySelectorAll('.boxInputSelect .cal table.vacancyCalTable tbody tr td dl dd span img.spinner').length > 0;
        if (!loading) document.getElementById('boxCalendarSelect')?.dispatchEvent(new Event('change'));
      });
      monthElem.dataset.hasListener = "true";
    }
  };

  const makeBtn = (txt, bg, fg = '#fff') => Object.assign(document.createElement('div'), {
    textContent: txt,
    style: `background:${bg};color:${fg};padding:4px 6px;margin-right:3px;cursor:pointer;border-radius:4px;font-size:12px;user-select:none;text-align:center;min-width:24px;line-height:1.2;`
  });

  const panel = Object.assign(document.createElement('div'), {
    style: 'position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;z-index:99999;background:rgba(255,255,255,0.8);padding:2px;border-radius:6px;box-shadow:0 2px 5px rgba(0,0,0,0.2);'
  });

  const btnMain = makeBtn('👆', '#000');
  const btnNotify = makeBtn('🔔', 'purple');

  const updateMain = () => {
    const s = MODE_STYLE[mode];
    btnMain.textContent = s.t; btnMain.style.background = s.c; btnMain.style.color = s.f;
    save('mode', mode);
  };
  const updateNotify = () => { btnNotify.style.opacity = notifyEnabled ? '1' : '0.25'; save('notify', notifyEnabled); };

  btnMain.onclick = () => { 
    hidePopup(); clearTimeout(longTimer); longTimer = null;
    consecutiveErrorCount = 0; 
    mode = (mode + 1) % 4; updateMain(); if (mode !== 0) triggerSearch(); 
  };
  btnNotify.onclick = () => { notifyEnabled = !notifyEnabled; updateNotify(); };

  const makeFilter = c => {
    const b = makeBtn(LABEL[c], BTN_BG_COLOR[c], '#fff');
    const updateF = () => b.style.opacity = filters[c] ? 1 : 0.25;
    b.onclick = () => { filters[c] = !filters[c]; updateF(); save('filters', filters); };
    updateF(); return b;
  };

  panel.append(btnMain, makeFilter(0), makeFilter(1), makeFilter(2), makeFilter(3), btnNotify);
  document.body.appendChild(panel);
  updateMain(); updateNotify();
  initMonthClick();

  const triggerSearch = () => {
    clearTimeout(longTimer); longTimer = null;
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    if (h >= 3 && h < 5) {
      let interval = 600000; 
      if (h === 4 && m === 59) interval = 1000; 
      else if (h === 4 && m >= 55) interval = 10000; 
      longTimer = setTimeout(triggerSearch, interval);
      return;
    }
    const sel = document.getElementById('boxCalendarSelect');
    if (sel && !document.querySelector('span.calLoad')) sel.dispatchEvent(new Event('change'));
  };

  // 致命的エラー（10回）時の通知（全モード共通で10分後再開のアナウンス）
  const handleFatalError = async (errObj) => {
    const errStatus = errObj?.status || errObj?.statusText || "Error";
    const ip = await getIP();
    
    const payload = {
      username: "📅 空室在庫ログ",
      embeds: [{ 
        title: `🚫 ${errStatus} 通信エラー多発`, 
        color: DISCORD_COLOR.error, 
        description: `時刻: ${tStrFullMs()} (${ip})\n10回連続でエラーが発生しました。\n10分後に現在のモードで自動再開します。` 
      }]
    };
    sendDiscord(payload);
  };

  // バーストタイム用（続行）エラー通知
  const handleBurstError = async (errObj) => {
    const errStatus = errObj?.status || errObj?.statusText || "Error";
    const ip = await getIP();
    const payload = {
      username: "📅 空室在庫ログ",
      embeds: [{ 
        title: `⚠️ ${errStatus} 通信エラー多発`, 
        color: DISCORD_COLOR.error, 
        description: `時刻: ${tStrFullMs()} (${ip})\nバーストタイムのため続行します。` 
      }]
    };
    sendDiscord(payload);
  };

  if (window.$?.lifeobs?.ajax) {
    const orig_ajax = window.$.lifeobs.ajax;
    window.$.lifeobs.ajax = function (opt) {
      if (opt.url && opt.url.includes('/hotel/api/queryHotelPriceStock/')) {
        let params = {};
        if (typeof opt.data === 'string') {
          opt.data.split('&').forEach(pair => { const [k, v] = pair.split('='); params[k] = v; });
        } else { params = opt.data || {}; }
        const contextKey = `${params.hotelId || 'default'}_${params.useYearMonth || 'now'}`;
        
        const ok = opt.success;
        opt.success = resp => {
          consecutiveErrorCount = 0;
          hidePopup(); 
          
          logStock(resp, contextKey).then(anyFound => {
            if (mode === 3 && anyFound) { mode = 0; updateMain(); showPopup("空室"); }
          });
          ok?.(resp);
          initMonthClick();
          if (mode === 1) triggerSearch();
          else if (mode === 2) {
            const randomInterval = Math.floor(Math.random() * (660001 - 540000)) + 540000;
            longTimer = setTimeout(triggerSearch, randomInterval);
          } else if (mode === 3) {
            triggerSearch();
          }
        };

        opt.error = function(k) {
          consecutiveErrorCount++; 

          // サイト標準処理（フリーズ解除の特効薬）は必ず呼ぶ
          if (window.RecentDaysPriceStockQuery?.prototype?.afterSystemErrorOccurred) {
            window.RecentDaysPriceStockQuery.prototype.afterSystemErrorOccurred(k);
          }

          const errStatus = k?.status || "Error";
          const d = new Date();
          const h = d.getHours();
          const m = d.getMinutes();
          // バーストタイム（10:59〜11:04）の判定
          const isBurstTime = (h === 10 && m === 59) || (h === 11 && m >= 0 && m <= 4);

          if (isBurstTime) {
            // ▼▼ バーストタイム仕様（止まらない） ▼▼
            if (consecutiveErrorCount >= 10) {
              handleBurstError(k);
              consecutiveErrorCount = 0; // 通知を出しすぎないためにリセットして再集計
            } else {
              showPopup(`${errStatus} 通信エラー\nバーストタイム突撃中 ${consecutiveErrorCount} 回目`);
            }
            if (mode !== 0) {
              clearTimeout(longTimer);
              longTimer = setTimeout(triggerSearch, 1500); // 1.5秒の高速リトライ
            }
          } else {
            // ▼▼ 通常タイム仕様（10回で10分待機） ▼▼
            if (consecutiveErrorCount < 10) {
              showPopup(`${errStatus} 通信エラー\nリトライ ${consecutiveErrorCount} 回目`);
              if (mode !== 0) {
                clearTimeout(longTimer);
                longTimer = setTimeout(triggerSearch, 3000); // 3秒の安全リトライ
              }
            } else {
              handleFatalError(k);
              consecutiveErrorCount = 0; 

              // 全モード共通：手動(0)以外なら10分間(600,000ms)待機して自動復帰
              if (mode !== 0) {
                const icons = { 1: '🐇', 2: '🐢', 3: '👁' };
                showPopup(`${errStatus} 通信エラー多発\n10分後に再開します (${icons[mode]})`);
                clearTimeout(longTimer);
                longTimer = setTimeout(triggerSearch, 600000);
              }
            }
          }
        };
      }
      return orig_ajax(opt);
    };
  }

  async function logStock(resp, contextKey) {
    const infos = resp.ecRoomStockInfos ?? {};
    const isFirstTime = !loadedKeys.has(contextKey);
    let vacancyDetected = false;
    const nowObj = new Date();
    
    const pendingNotifications = [];

    console.group(tStrMs());
    for (const g of Object.values(infos)) {
      for (const r of Object.values(g.roomStockInfos ?? {})) {
        const roomName = r.roomName || "不明な客室";
        for (const [roomCd, b] of Object.entries(r.roomBedStockRangeInfos ?? {})) {
          for (const d of (b.roomBedStockRange ?? [])) {
            const dtRaw = d.useDate; 
            const useDateObj = new Date(dtRaw.slice(0, 4), dtRaw.slice(4, 6) - 1, dtRaw.slice(6));
            const dt = `${dtRaw.slice(0, 4)}/${dtRaw.slice(4, 6)}/${dtRaw.slice(6)}`;
            const st = +d.saleStatus;
            const rm = d.remainStockNum ?? 0;
            const priceRank = d.priceFrameID || d.priceLevel || '--';
            const totalPrice = d.roomPriceTotal || 0;
            const commodityCd = d.commodityCd || roomCd || "不明";
            const stateKey = `${contextKey}__${commodityCd}__${dt}`;
            const prev = lastStateMap.get(stateKey);

            if (st === 0 && rm > 0) vacancyDetected = true;

            if (!isFirstTime && notifyEnabled && prev !== undefined && (prev.st !== st || prev.rm !== rm)) {
              const diffDays = (useDateObj - nowObj) / (1000 * 60 * 60 * 24);
              const isNewSale = (prev.st === 3 && diffDays >= 122);

              if (!isNewSale) {
                let changeTxt;
                if (prev.st !== st) changeTxt = `${FULL_LABEL[prev.st]}→${FULL_LABEL[st]}`;
                else changeTxt = `${MARKS[prev.rm] || prev.rm}→${MARKS[rm] || rm}`;
                
                pendingNotifications.push({ st, rm, dt, changeTxt, roomName, totalPrice, priceRank });
              }
            }
            lastStateMap.set(stateKey, { st, rm });
            if (filters[st]) console.log(`%c${dt}%c\t%c${LABEL[st]}　${rm}　${priceRank}`, '', '', STYLE[st]);
          }
        }
      }
    }
    console.groupEnd();
    loadedKeys.add(contextKey);

    if (pendingNotifications.length > 0) {
      const currentIp = await getIP();
      for (const item of pendingNotifications) {
        sendDiscord({
          username: "📅 空室在庫ログ",
          embeds: [{
            title: `${TITLE_EMOJI[item.st] ?? ''} **${tStrSec()}**\n${item.dt}　${item.changeTxt}\n${item.roomName}`,
            color: DISCORD_COLOR[item.st] ?? 1,
            description: `時刻: ${tStrMs()} (${currentIp})\n在庫${MARKS[item.rm] || '◯'}　${item.totalPrice.toLocaleString()}円　[${item.priceRank}]`
          }]
        });
      }
    }

    return vacancyDetected;
  }

  let popupElem = null;
  function showPopup(txt) {
    if (popupElem) popupElem.remove();
    popupElem = document.createElement('div');
    popupElem.innerText = txt; 
    popupElem.style.cssText = `position:fixed;left:50%;bottom:15%;transform:translateX(-50%);padding:8px 15px;font-size:18px;font-weight:bold;color:#fff;background:rgba(128, 0, 128, 0.9);border:2px solid #fff;border-radius:12px;cursor:pointer;z-index:999999;user-select:none;box-shadow: 0 6px 30px rgba(0,0,0,0.8);text-align:center;white-space:pre-wrap;`;
    popupElem.onclick = () => { popupElem.remove(); popupElem = null; };
    document.body.appendChild(popupElem);
  }
  function hidePopup() { if (popupElem) { popupElem.remove(); popupElem = null; } }
})();
