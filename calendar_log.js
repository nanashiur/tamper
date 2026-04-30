// ==UserScript==
// @name         📅 空室在庫ログ
// @version      4.62
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
  const LABEL = { 0: '空', 1: '満', 2: '吸', 3: '未' };
  const STYLE = { 0: 'color:red;font-weight:bold', 1: 'color:inherit', 2: 'color:blue', 3: 'color:green' };
  
  const BTN_COLOR = { 0: 'red', 1: '#000', 2: 'blue', 3: 'green' };
  const MODE_STYLE = {
    0: { t: '👆', c: '#000', f: '#fff' },
    1: { t: '🐇', c: 'orange', f: '#fff' }, 
    2: { t: '🐢', c: 'purple', f: '#fff' }, 
    3: { t: '👁', c: 'pink', f: '#000' }
  };

  const DISCORD_COLOR = { 0: 16711680, 1: 1, 2: 255, 3: 32768, error: 0x000000 };

  const pad = (x, len = 2) => String(x).padStart(len, '0');
  const tStr = () => { 
    const d = new Date(); 
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${d.toTimeString().slice(0, 8)}.${pad(d.getMilliseconds(), 3)}`; 
  };

  const lastStatusState = new Map();
  const loadedKeys = new Set();
  let errorTimestamps = [];

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
    hideVacancyPanel(); clearTimeout(longTimer); longTimer = null;
    mode = (mode + 1) % 4; updateMain(); if (mode !== 0) triggerSearch(); 
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
  initMonthClick();

  const triggerSearch = () => {
    hideVacancyPanel(); clearTimeout(longTimer); longTimer = null;
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

  const sendDiscord = async (payload) => {
    try {
      await fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    } catch (e) { console.error('Discord通知失敗', e); }
  };

  const handleErrorCount = () => {
    const now = Date.now();
    errorTimestamps.push(now);
    errorTimestamps = errorTimestamps.filter(t => now - t < 60000);

    const d = new Date();
    const h = d.getHours();
    const m = d.getMinutes();

    // バーストタイム判定 (10:59:00 ~ 11:04:59)
    const isBurstTime = (h === 10 && m === 59) || (h === 11 && m >= 0 && m <= 4);

    if (errorTimestamps.length >= 15) {
      const msg = `⚠️ 通信エラー多発 (1分間に${errorTimestamps.length}回)`;
      const payload = {
        username: "📅 空室在庫ログ",
        embeds: [{ 
            title: msg, 
            color: DISCORD_COLOR.error, 
            description: `時刻: ${tStr()}\n状況: ${isBurstTime ? "不必要タイム(10:59-11:04)内のため監視を続行します" : "安全のため自動巡回を停止しました"}` 
        }]
      };
      sendDiscord(payload);

      if (!isBurstTime) {
        mode = 0;
        updateMain();
        errorTimestamps = [];
        return true; 
      }
    }
    return false; 
  };

  if (window.$?.lifeobs?.ajax) {
    const orig = $.lifeobs.ajax;
    $.lifeobs.ajax = opt => {
      if (opt.url && opt.url.includes('/hotel/api/queryHotelPriceStock/')) {
        let params = {};
        if (typeof opt.data === 'string') {
          opt.data.split('&').forEach(pair => { const [k, v] = pair.split('='); params[k] = v; });
        } else { params = opt.data || {}; }
        const contextKey = `${params.hotelId || 'default'}_${params.useYearMonth || 'now'}`;
        
        const ok = opt.success;
        opt.success = resp => {
          const anyFound = logStock(resp, contextKey);
          ok?.(resp);
          initMonthClick();
          if (mode === 1) triggerSearch();
          else if (mode === 2) {
            longTimer = setTimeout(triggerSearch, 600000 + (Math.floor(Math.random() * 20001) - 10000));
          } else if (mode === 3) {
            if (anyFound) { mode = 0; updateMain(); showVacancyPanel(); } else { triggerSearch(); }
          }
        };

        const err = opt.error;
        opt.error = k => {
          const stopped = handleErrorCount();
          if (window.RecentDaysPriceStockQuery?.prototype?.afterSystemErrorOccurred) {
             window.RecentDaysPriceStockQuery.prototype.afterSystemErrorOccurred(k);
          }
          
          if (!stopped && mode !== 0) {
            setTimeout(triggerSearch, 1500); // 待機時間を1.5秒に変更
          }
          err?.(k);
        };
      }
      return orig(opt);
    };
  }

  function logStock(resp, contextKey) {
    const infos = resp.ecRoomStockInfos ?? {};
    const isFirstTime = !loadedKeys.has(contextKey);
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

          if (st === 0 && rm > 0) vacancyDetected = true;
          if (!isFirstTime && notifyEnabled && lastSt !== undefined && lastSt !== st) {
            const changeTxt = `${FULL_LABEL[lastSt]}→${FULL_LABEL[st]}`;
            const marks = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤' };
            const payload = {
              username: "📅 空室在庫ログ",
              embeds: [{
                title: `**${tStr()}**\n${dt}　${changeTxt}\n${roomName}`,
                color: DISCORD_COLOR[st] ?? 1,
                description: st === 0 ? `在庫：${marks[rm] || '◯'}　価格：${totalPrice.toLocaleString()}円　[${priceRank}]` : undefined
              }]
            };
            sendDiscord(payload);
          }
          lastStatusState.set(stateKey, st);
          if (filters[st]) console.log(`%c${dt}%c\t%c${LABEL[st]}　${rm}　${priceRank}`, '', '', STYLE[st]);
        })
      );
    }));
    console.groupEnd();
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
