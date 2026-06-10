// ==UserScript==
// @name         🏨11時予約
// @version      1.10
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/?useDate*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const TARGET_MANUAL   = '';
  const FIX_DATE_MANUAL = '';
  const FIX_PF_MANUAL   = '';

  const SHARED_DATA_KEY = 'tdr_11am_reserve_data';

  const loadReserveData = () => {
    const manualComplete = TARGET_MANUAL && FIX_DATE_MANUAL && FIX_PF_MANUAL;

    if (manualComplete) {
      return {
        source: 'MANUAL',
        TARGET: TARGET_MANUAL,
        FIX_DATE: FIX_DATE_MANUAL,
        FIX_PF: FIX_PF_MANUAL
      };
    }

    try {
      const raw = localStorage.getItem(SHARED_DATA_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.TARGET && data.FIX_DATE && data.FIX_PF) {
          return {
            source: 'AUTO',
            TARGET: String(data.TARGET),
            FIX_DATE: String(data.FIX_DATE),
            FIX_PF: String(data.FIX_PF)
          };
        }
      }
    } catch (e) {
      console.error('共有データ読込失敗:', e);
    }

    return {
      source: 'ERROR',
      TARGET: '',
      FIX_DATE: '',
      FIX_PF: ''
    };
  };

  const reserveData = loadReserveData();

  const TARGET = reserveData.TARGET;
  const FIX_DATE = reserveData.FIX_DATE;
  const FIX_PF = reserveData.FIX_PF;
  const DATA_SOURCE = reserveData.source;

  if (window.__tdr_11am_reserve_installed) return;
  window.__tdr_11am_reserve_installed = true;

  const errorHistory = [];
  let isNotified = false;
  let IS_FORCED_STOP = false;

  const getHotelWebhook = () => {
    return window.TDR_WEBHOOKS?.hotel || '';
  };

  const sendDiscordNotification = (count, forced = true) => {
    if (isNotified) return;

    const webhook = getHotelWebhook();
    if (!webhook) {
      console.warn('ホテル用Webhookが未設定です');
      return;
    }

    isNotified = true;

    const statusMsg = forced ? '動作を停止しました。' : '重要時間帯のため動作を続行します。';
    const description = `直近2分間に **${count}回** の403を検知しました。\n\n**【ステータス】: ${statusMsg}**`;

    fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '🏨11時予約',
        embeds: [{
          title: '403エラー監視',
          color: 16762880,
          description: description,
          timestamp: new Date().toISOString()
        }]
      })
    }).catch(e => console.error('Discord通知失敗:', e));
  };

  const STORAGE_FIXED_KEY = 'tdr_fixed_enabled_state';
  const STORAGE_CLICK_KEY = 'auto_click_mode';
  const STORAGE_TIMER_ON_MODE_KEY = 'tdr_11am_timer_on_mode';
  const STORAGE_TIMER_OFF_KEY = 'tdr_11am_timer_off_enabled';
  const START_TIME_KEY = 'auto_click_start';

  if (localStorage.getItem(STORAGE_FIXED_KEY) === null) localStorage.setItem(STORAGE_FIXED_KEY, 'true');
  if (localStorage.getItem(STORAGE_TIMER_ON_MODE_KEY) === null) localStorage.setItem(STORAGE_TIMER_ON_MODE_KEY, '1');

  let FIXED_ENABLED = localStorage.getItem(STORAGE_FIXED_KEY) === 'true';
  let TIMER_ON_MODE = parseInt(localStorage.getItem(STORAGE_TIMER_ON_MODE_KEY) || '0', 10);
  let TIMER_OFF_ENABLED = localStorage.getItem(STORAGE_TIMER_OFF_KEY) === 'true';

  let randomTriggerSec = 0;

  const generateRandomSec = (mode) => {
    if (mode === 1) randomTriggerSec = Math.floor(Math.random() * 6) + 30;
    else if (mode === 2) randomTriggerSec = Math.floor(Math.random() * 4) + 55;
  };

  if (TIMER_ON_MODE > 0) generateRandomSec(TIMER_ON_MODE);

  const ALPHA_ON = 0.85;
  const ALPHA_OFF = 0.35;

  const PARTS = {
    commodityCD: TARGET,
    searchHotelCD: TARGET.slice(2, 5),
    roomLetterCD: TARGET.slice(5, 8),
    roomMaterialCD: TARGET.slice(2, 12)
  };

  const CLICK_MODES = {
    STOP: { label: '停止', color: `rgba(0, 0, 0, ${ALPHA_OFF})` },
    FAST: { label: '稼働', color: `rgba(220, 38, 38, ${ALPHA_ON})` },
    FORCED: { label: '強制', color: 'rgba(255, 191, 0, 1)' }
  };

  const isReservePost = (url, m) => {
    return /\/hotel\/reserve\/?$/.test(String(url || '')) &&
      String(m || 'GET').toUpperCase() === 'POST';
  };

  const rewriteBody = (orig) => {
    const p = new URLSearchParams(typeof orig === 'string' ? orig : '');
    p.set('commodityCD', PARTS.commodityCD);
    p.set('searchHotelCD', PARTS.searchHotelCD);
    p.set('roomLetterCD', PARTS.roomLetterCD);
    p.set('roomMaterialCD', PARTS.roomMaterialCD);
    p.set('useDate', FIX_DATE);
    p.set('hotelPriceFrameID', FIX_PF);
    return p.toString();
  };

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u) {
    this.__u = u;
    this.__m = m;

    this.addEventListener('loadend', () => {
      if (this.status === 403) {
        const now = Date.now();
        const d = new Date(now);
        const h = d.getHours();
        const min = d.getMinutes();
        const isCriticalTime = (h === 10 && min === 59) || (h === 11 && min < 5);

        errorHistory.push(now);

        while (errorHistory.length > 0 && errorHistory[0] < now - 120000) {
          errorHistory.shift();
        }

        if (errorHistory.length >= 20) {
          TIMER_OFF_ENABLED = localStorage.getItem(STORAGE_TIMER_OFF_KEY) === 'true';

          if (!TIMER_OFF_ENABLED && isCriticalTime) {
            sendDiscordNotification(errorHistory.length, false);
          } else {
            IS_FORCED_STOP = true;
            localStorage.setItem(STORAGE_CLICK_KEY, 'STOP');
            sendDiscordNotification(errorHistory.length, true);
          }
        }
      }
    });

    return _open.apply(this, arguments);
  };

  const _send = XMLHttpRequest.prototype.send;
  const _set = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.setRequestHeader = function(n, v) {
    return _set.call(this, n, v);
  };

  XMLHttpRequest.prototype.send = function(b) {
    if (FIXED_ENABLED && DATA_SOURCE !== 'ERROR' && isReservePost(this.__u, this.__m)) {
      b = rewriteBody(b);
    }

    return _send.call(this, b);
  };

  const appendUI = () => {
    const parent = document.body || document.documentElement;
    const container = document.createElement('div');

    container.id = 'tdr-integrated-panel';

    Object.assign(container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      width: 'fit-content'
    });

    const code = PARTS.searchHotelCD;

    const baseRGB = DATA_SOURCE === 'ERROR'
      ? [0, 0, 0]
      : code === 'DHM'
        ? [22, 163, 74]
        : code === 'FSH'
          ? [236, 72, 153]
          : [234, 88, 12];

    const rgba = (a) => `rgba(${baseRGB[0]}, ${baseRGB[1]}, ${baseRGB[2]}, ${a})`;

    const fixedEl = document.createElement('div');

    fixedEl.innerHTML = DATA_SOURCE === 'ERROR'
      ? 'ERR'
      : [PARTS.roomLetterCD, FIX_DATE.slice(4), FIX_PF].join('<br>');

    Object.assign(fixedEl.style, {
      color: '#fff',
      padding: '3px 6px',
      fontSize: '12px',
      fontWeight: '700',
      fontFamily: 'sans-serif',
      textAlign: 'center',
      cursor: 'pointer',
      lineHeight: '1.15',
      borderBottom: '1px solid rgba(255,255,255,0.2)'
    });

    const updateFixedVisual = () => {
      fixedEl.style.background = FIXED_ENABLED ? rgba(ALPHA_ON) : rgba(ALPHA_OFF);
      localStorage.setItem(STORAGE_FIXED_KEY, FIXED_ENABLED);
    };

    fixedEl.addEventListener('click', () => {
      FIXED_ENABLED = !FIXED_ENABLED;
      updateFixedVisual();
    });

    updateFixedVisual();

    const timerOnEl = document.createElement('div');

    Object.assign(timerOnEl.style, {
      color: 'white',
      padding: '1px 6px',
      fontSize: '11px',
      fontWeight: 'bold',
      fontFamily: 'sans-serif',
      textAlign: 'center',
      cursor: 'pointer',
      borderBottom: '1px solid rgba(255,255,255,0.2)',
      backdropFilter: 'blur(4px)'
    });

    const updateTimerOnUI = () => {
      if (TIMER_ON_MODE === 0) {
        timerOnEl.style.background = `rgba(0, 0, 0, ${ALPHA_OFF})`;
        timerOnEl.textContent = 'OFF';
      } else {
        timerOnEl.style.background = TIMER_ON_MODE === 1
          ? `rgba(234, 88, 12, ${ALPHA_ON})`
          : `rgba(147, 51, 234, ${ALPHA_ON})`;
        timerOnEl.textContent = `${randomTriggerSec}s`;
      }

      localStorage.setItem(STORAGE_TIMER_ON_MODE_KEY, TIMER_ON_MODE);
    };

    timerOnEl.addEventListener('click', () => {
      TIMER_ON_MODE = (TIMER_ON_MODE + 1) % 3;
      if (TIMER_ON_MODE > 0) generateRandomSec(TIMER_ON_MODE);
      updateTimerOnUI();
    });

    updateTimerOnUI();

    const timerOffEl = document.createElement('div');

    Object.assign(timerOffEl.style, {
      color: 'white',
      padding: '1px 6px',
      fontSize: '11px',
      fontWeight: 'bold',
      fontFamily: 'sans-serif',
      textAlign: 'center',
      cursor: 'pointer',
      borderBottom: '1px solid rgba(255,255,255,0.2)',
      backdropFilter: 'blur(4px)'
    });

    const updateTimerOffUI = () => {
      TIMER_OFF_ENABLED = localStorage.getItem(STORAGE_TIMER_OFF_KEY) === 'true';

      timerOffEl.style.background = TIMER_OFF_ENABLED
        ? `rgba(59, 130, 246, ${ALPHA_ON})`
        : `rgba(0, 0, 0, ${ALPHA_OFF})`;

      timerOffEl.textContent = TIMER_OFF_ENABLED ? 'STOP' : 'OFF';
    };

    timerOffEl.addEventListener('click', () => {
      TIMER_OFF_ENABLED = !TIMER_OFF_ENABLED;
      localStorage.setItem(STORAGE_TIMER_OFF_KEY, TIMER_OFF_ENABLED);
      updateTimerOffUI();
    });

    updateTimerOffUI();

    let currentClickMode = localStorage.getItem(STORAGE_CLICK_KEY) || 'STOP';
    const startTime = parseInt(localStorage.getItem(START_TIME_KEY) || Date.now(), 10);
    localStorage.setItem(START_TIME_KEY, startTime);

    const clickEl = document.createElement('div');

    Object.assign(clickEl.style, {
      color: 'white',
      padding: '3px 6px',
      fontSize: '12px',
      fontWeight: 'bold',
      fontFamily: 'sans-serif',
      cursor: 'pointer',
      borderRadius: '0 0 4px 4px',
      textAlign: 'center',
      backdropFilter: 'blur(4px)'
    });

    const updateClickUI = (isWaiting = false, isBurst = false) => {
      if (DATA_SOURCE === 'ERROR') {
        clickEl.textContent = 'ERR';
        clickEl.style.background = `rgba(0, 0, 0, ${ALPHA_ON})`;
      } else if (IS_FORCED_STOP) {
        clickEl.textContent = CLICK_MODES.FORCED.label;
        clickEl.style.background = CLICK_MODES.FORCED.color;
      } else if (currentClickMode === 'STOP') {
        clickEl.textContent = '停止';
        clickEl.style.background = CLICK_MODES.STOP.color;
      } else if (isBurst) {
        clickEl.textContent = '全開';
        clickEl.style.background = 'rgba(255, 0, 0, 1)';
      } else if (isWaiting) {
        clickEl.textContent = '待機';
        clickEl.style.background = `rgba(128, 0, 128, ${ALPHA_ON})`;
      } else {
        clickEl.textContent = '稼働';
        clickEl.style.background = CLICK_MODES.FAST.color;
      }
    };

    clickEl.addEventListener('click', () => {
      if (DATA_SOURCE === 'ERROR') return;

      if (IS_FORCED_STOP) {
        IS_FORCED_STOP = false;
        isNotified = false;
        errorHistory.length = 0;
      }

      currentClickMode = currentClickMode === 'STOP' ? 'FAST' : 'STOP';
      localStorage.setItem(STORAGE_CLICK_KEY, currentClickMode);
      updateClickUI();
    });

    container.appendChild(fixedEl);
    container.appendChild(timerOnEl);
    container.appendChild(timerOffEl);
    container.appendChild(clickEl);
    parent.appendChild(container);

    (function loop() {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const s = now.getSeconds();

      const isBurstTime =
        (h === 10 && m === 59 && s >= 50) ||
        (h === 11 && m === 0 && s <= 20);

      TIMER_OFF_ENABLED = localStorage.getItem(STORAGE_TIMER_OFF_KEY) === 'true';

      if (TIMER_OFF_ENABLED && h === 11 && m === 0 && s >= 35) {
        if (currentClickMode === 'FAST') {
          currentClickMode = 'STOP';
          localStorage.setItem(STORAGE_CLICK_KEY, 'STOP');
          updateClickUI();
        }
      }

      if (
        TIMER_ON_MODE > 0 &&
        h === 10 &&
        m === 59 &&
        s >= randomTriggerSec &&
        currentClickMode === 'STOP' &&
        !IS_FORCED_STOP &&
        DATA_SOURCE !== 'ERROR'
      ) {
        currentClickMode = 'FAST';
        localStorage.setItem(STORAGE_CLICK_KEY, 'FAST');
        updateClickUI();
      }

      let isWaiting = false;

      if (currentClickMode !== 'STOP' && !IS_FORCED_STOP && DATA_SOURCE !== 'ERROR') {
        const btn = document.querySelector('.js-reserve.button.next');

        if (btn) {
          btn.disabled = false;
          btn.classList.remove('is-disabled');
          btn.click();
          isWaiting = false;
        } else {
          isWaiting = true;
        }
      }

      updateClickUI(isWaiting, isBurstTime);

      const nextInterval =
        currentClickMode === 'STOP' || IS_FORCED_STOP || DATA_SOURCE === 'ERROR'
          ? 1000
          : isBurstTime
            ? 1000
            : Math.random() * 1000 + 1500;

      setTimeout(loop, nextInterval);
    })();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', appendUI, { once: true });
  } else {
    appendUI();
  }
})();
