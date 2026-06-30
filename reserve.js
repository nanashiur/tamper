// ==UserScript==
// @name         🏨11時予約
// @version      2.15
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/?useDate*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  // ================================================================
  // 【手動設定エリア】
  // 入力した項目だけ手動値を優先
  // 空欄の項目は AUTO(localStorage) から補完
  //
  // 例：
  // const TARGET_MANUAL   = 'HODAHRDD0001N';
  // const FIX_DATE_MANUAL = '20260101';
  // const FIX_PF_MANUAL   = 'M10';
  // ================================================================
  const TARGET_MANUAL   = '';
  const FIX_DATE_MANUAL = '';
  const FIX_PF_MANUAL   = '';

  const SHARED_DATA_KEY = 'tdr_11am_reserve_data';
  // ================================================================

  const CHECK_INTERVAL_STOP_MS = 1000;
  const CHECK_INTERVAL_PENDING_MS = 150;
  const CHECK_INTERVAL_READY_MS = 50;

  const CONSECUTIVE_ERROR_LIMIT = 9;
  const RESERVE_ERROR_STATUSES = new Set([403, 435]);

  const isMaintenanceTime = (d = new Date()) => {
    const h = d.getHours();
    return h >= 3 && h < 5;
  };

  const cleanValue = (v) => {
    if (v === undefined || v === null) return '';
    return String(v).trim();
  };

  const loadReserveData = () => {
    let auto = {};

    try {
      const raw = localStorage.getItem(SHARED_DATA_KEY);
      if (raw) auto = JSON.parse(raw) || {};
    } catch (e) {
      console.error('共有データ読込失敗:', e);
    }

    const manualTarget = cleanValue(TARGET_MANUAL);
    const manualDate   = cleanValue(FIX_DATE_MANUAL);
    const manualPf     = cleanValue(FIX_PF_MANUAL);

    const autoTarget = cleanValue(auto.TARGET);
    const autoDate   = cleanValue(auto.FIX_DATE);
    const autoPf     = cleanValue(auto.FIX_PF);

    const TARGET   = manualTarget || autoTarget;
    const FIX_DATE = manualDate   || autoDate;
    const FIX_PF   = manualPf     || autoPf;

    const hasManual = !!(manualTarget || manualDate || manualPf);
    const allManual = !!(manualTarget && manualDate && manualPf);

    if (TARGET && FIX_DATE && FIX_PF) {
      return {
        source: allManual ? 'MANUAL' : hasManual ? 'MIX' : 'AUTO',
        TARGET,
        FIX_DATE,
        FIX_PF
      };
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

  let isNotified = false;
  let IS_FORCED_STOP = false;

  let clickCyclePending = false;

  let consecutiveErrorCount = 0;
  let totalErrorCount = 0;
  let errorPopupEl = null;

  const lockClickCycle = () => {
    clickCyclePending = true;
  };

  const clearClickCycle = () => {
    clickCyclePending = false;
  };

  const canClickReserve = () => {
    return !clickCyclePending;
  };

  const getHotelWebhook = () => {
    return window.TDR_WEBHOOKS?.hotel || '';
  };

  const getPanelPopupPosition = () => {
    const panel = document.getElementById('tdr-integrated-panel');

    if (!panel) {
      return {
        top: 72,
        left: 8
      };
    }

    const rect = panel.getBoundingClientRect();

    return {
      top: Math.ceil(rect.bottom + 6),
      left: Math.ceil(rect.left)
    };
  };

  const showErrorPopup = () => {
    if (errorPopupEl) errorPopupEl.remove();

    const pos = getPanelPopupPosition();

    errorPopupEl = document.createElement('div');

    errorPopupEl.innerHTML = [
      `<div>${consecutiveErrorCount}/${CONSECUTIVE_ERROR_LIMIT}</div>`,
      `<div>${totalErrorCount}</div>`
    ].join('');

    Object.assign(errorPopupEl.style, {
      position: 'fixed',
      top: `${pos.top}px`,
      left: `${pos.left}px`,
      zIndex: '2147483647',
      background: 'rgba(127, 29, 29, 0.92)',
      color: '#fff',
      padding: '5px 7px',
      borderRadius: '6px',
      fontSize: '12px',
      fontWeight: '700',
      fontFamily: 'sans-serif',
      lineHeight: '1.25',
      boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
      cursor: 'pointer',
      userSelect: 'none',
      textAlign: 'center'
    });

    errorPopupEl.addEventListener('click', () => {
      errorPopupEl.remove();
      errorPopupEl = null;
    });

    (document.body || document.documentElement).appendChild(errorPopupEl);
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
    const description =
      `reserve/403・435を **${count}回連続** で検知しました。\n` +
      `通算reserveエラー回数: **${totalErrorCount}回**\n\n` +
      `**【ステータス】: ${statusMsg}**`;

    fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '🏨11時予約',
        embeds: [{
          title: 'reserveエラー監視',
          color: 16776960,
          description,
          timestamp: new Date().toISOString()
        }]
      })
    }).catch(e => console.error('Discord通知失敗:', e));
  };

  const STORAGE_FIXED_KEY = 'tdr_fixed_enabled_state';
  const STORAGE_CLICK_KEY = 'auto_click_mode';
  const STORAGE_TIMER_ON_MODE_KEY = 'tdr_11am_timer_on_mode';
  const STORAGE_TIMER_OFF_KEY = 'tdr_11am_timer_off_enabled';
  const STORAGE_TIMER_TRIGGER_TIME_KEY = 'tdr_11am_timer_trigger_time';
  const STORAGE_RELOAD_ENABLED_KEY = 'tdr_10am_reload_enabled';
  const STORAGE_RELOAD_DATE_KEY = 'tdr_1030_reload_date';
  const START_TIME_KEY = 'auto_click_start';

  const getTodayKey = () => {
    const d = new Date();

    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('');
  };

  const saveTimerTriggerTime = (mode, sec) => {
    if (!mode || !Number.isInteger(sec)) {
      localStorage.setItem(STORAGE_TIMER_TRIGGER_TIME_KEY, 'OFF');
      return;
    }

    localStorage.setItem(
      STORAGE_TIMER_TRIGGER_TIME_KEY,
      `10時59分${sec}秒`
    );
  };

  const reloadSec = Math.floor(Math.random() * 60);

  const checkTenReload = () => {
    if (localStorage.getItem(STORAGE_RELOAD_ENABLED_KEY) !== 'true') return;

    const today = getTodayKey();

    if (localStorage.getItem(STORAGE_RELOAD_DATE_KEY) === today) return;

    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();

    if (h === 10 && m === 30 && s >= reloadSec) {
      localStorage.setItem(STORAGE_RELOAD_DATE_KEY, today);
      location.reload();
    }
  };

  if (localStorage.getItem(STORAGE_FIXED_KEY) === null) {
    localStorage.setItem(STORAGE_FIXED_KEY, 'true');
  }

  if (localStorage.getItem(STORAGE_TIMER_ON_MODE_KEY) === null) {
    localStorage.setItem(STORAGE_TIMER_ON_MODE_KEY, '1');
  }

  if (localStorage.getItem(STORAGE_RELOAD_ENABLED_KEY) === null) {
    localStorage.setItem(STORAGE_RELOAD_ENABLED_KEY, 'false');
  }

  let FIXED_ENABLED = localStorage.getItem(STORAGE_FIXED_KEY) === 'true';
  let TIMER_ON_MODE = parseInt(localStorage.getItem(STORAGE_TIMER_ON_MODE_KEY) || '0', 10);
  let TIMER_OFF_ENABLED = localStorage.getItem(STORAGE_TIMER_OFF_KEY) === 'true';
  let RELOAD_ENABLED = localStorage.getItem(STORAGE_RELOAD_ENABLED_KEY) === 'true';

  let randomTriggerSec = 0;

  const generateRandomSec = (mode) => {
    if (mode === 1) {
      randomTriggerSec = Math.floor(Math.random() * 15) + 40; // 40〜54秒
      saveTimerTriggerTime(mode, randomTriggerSec);
    } else if (mode === 2) {
      randomTriggerSec = Math.floor(Math.random() * 31) + 20; // 20〜50秒
      saveTimerTriggerTime(mode, randomTriggerSec);
    } else {
      randomTriggerSec = 0;
      saveTimerTriggerTime(0, null);
    }
  };

  if (TIMER_ON_MODE > 0) {
    generateRandomSec(TIMER_ON_MODE);
  } else {
    saveTimerTriggerTime(0, null);
  }

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

  const isNoticePost = (url, m) => {
    return /\/common\/notice\/?$/.test(String(url || '')) &&
      String(m || 'GET').toUpperCase() === 'POST';
  };

  const isNotice403 = (url, m, status) => {
    return isNoticePost(url, m) && status === 403;
  };

  const rewriteReserveBody = (orig) => {
    const p = new URLSearchParams(typeof orig === 'string' ? orig : '');

    p.set('commodityCD', PARTS.commodityCD);
    p.set('searchHotelCD', PARTS.searchHotelCD);
    p.set('roomLetterCD', PARTS.roomLetterCD);
    p.set('roomMaterialCD', PARTS.roomMaterialCD);
    p.set('useDate', FIX_DATE);
    p.set('hotelPriceFrameID', FIX_PF);

    return p.toString();
  };

  const rewriteNoticeBody = (orig) => {
    const p = new URLSearchParams(typeof orig === 'string' ? orig : '');

    p.set('commodityCD', TARGET);
    p.set('date', FIX_DATE);

    return p.toString();
  };

  const _open = XMLHttpRequest.prototype.open;

  XMLHttpRequest.prototype.open = function(m, u) {
    this.__u = u;
    this.__m = m;

    this.addEventListener('loadend', () => {
      const status = this.status;
      const reservePostResult = isReservePost(this.__u, this.__m);
      const notice403Result = isNotice403(this.__u, this.__m, status);

      if (reservePostResult || notice403Result) {
        clearClickCycle();
      }

      if (reservePostResult && RESERVE_ERROR_STATUSES.has(status)) {
        consecutiveErrorCount++;
        totalErrorCount++;
        showErrorPopup();

        const now = Date.now();
        const d = new Date(now);
        const h = d.getHours();
        const min = d.getMinutes();
        const isCriticalTime = (h === 10 && min === 59) || (h === 11 && min < 5);

        if (consecutiveErrorCount >= CONSECUTIVE_ERROR_LIMIT) {
          TIMER_OFF_ENABLED = localStorage.getItem(STORAGE_TIMER_OFF_KEY) === 'true';

          if (!TIMER_OFF_ENABLED && isCriticalTime) {
            sendDiscordNotification(consecutiveErrorCount, false);
          } else {
            IS_FORCED_STOP = true;
            localStorage.setItem(STORAGE_CLICK_KEY, 'STOP');
            sendDiscordNotification(consecutiveErrorCount, true);
          }
        }
      } else if (reservePostResult && status === 200) {
        if (consecutiveErrorCount > 0) {
          consecutiveErrorCount = 0;
          isNotified = false;
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
    const reservePost =
      FIXED_ENABLED &&
      DATA_SOURCE !== 'ERROR' &&
      isReservePost(this.__u, this.__m);

    const noticePost =
      FIXED_ENABLED &&
      DATA_SOURCE !== 'ERROR' &&
      isNoticePost(this.__u, this.__m);

    if (reservePost) {
      b = rewriteReserveBody(b);
    } else if (noticePost) {
      b = rewriteNoticeBody(b);
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

    const reloadPanel = document.createElement('div');

    reloadPanel.id = 'tdr-1030-reload-panel';

    Object.assign(reloadPanel.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      zIndex: '2147483647',
      color: '#fff',
      padding: '2px 5px',
      fontSize: '10px',
      fontWeight: '700',
      fontFamily: 'sans-serif',
      lineHeight: '1',
      textAlign: 'center',
      cursor: 'pointer',
      borderRadius: '0 0 0 4px',
      backdropFilter: 'blur(4px)',
      userSelect: 'none'
    });

    const updateReloadPanel = () => {
      RELOAD_ENABLED = localStorage.getItem(STORAGE_RELOAD_ENABLED_KEY) === 'true';

      reloadPanel.textContent = RELOAD_ENABLED ? 'ON' : 'OFF';

      reloadPanel.style.background = RELOAD_ENABLED
        ? `rgba(220, 38, 38, ${ALPHA_ON})`
        : `rgba(0, 0, 0, ${ALPHA_OFF})`;
    };

    reloadPanel.addEventListener('click', () => {
      RELOAD_ENABLED = !RELOAD_ENABLED;
      localStorage.setItem(STORAGE_RELOAD_ENABLED_KEY, RELOAD_ENABLED ? 'true' : 'false');
      updateReloadPanel();
    });

    updateReloadPanel();

    const code = PARTS.searchHotelCD;

    const HOTEL_COLORS = {
      DHM: [22, 163, 74],
      FSH: [236, 72, 153],
      TDH: [234, 179, 8],
      DAH: [37, 99, 235],
      TSH: [234, 88, 12],
      DCH: [14, 165, 233]
    };

    const baseRGB = DATA_SOURCE === 'ERROR'
      ? [0, 0, 0]
      : HOTEL_COLORS[code] || [234, 88, 12];

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
        saveTimerTriggerTime(0, null);
      } else {
        timerOnEl.style.background = TIMER_ON_MODE === 1
          ? `rgba(234, 88, 12, ${ALPHA_ON})`
          : `rgba(147, 51, 234, ${ALPHA_ON})`;

        timerOnEl.textContent = `${randomTriggerSec}s`;
        saveTimerTriggerTime(TIMER_ON_MODE, randomTriggerSec);
      }

      localStorage.setItem(STORAGE_TIMER_ON_MODE_KEY, TIMER_ON_MODE);
    };

    timerOnEl.addEventListener('click', () => {
      TIMER_ON_MODE = (TIMER_ON_MODE + 1) % 3;
      generateRandomSec(TIMER_ON_MODE);
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

    let currentClickMode = 'STOP';
    localStorage.setItem(STORAGE_CLICK_KEY, 'STOP');

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

    const updateClickUI = (isWaiting = false, isBurst = false, isMaint = false) => {
      if (DATA_SOURCE === 'ERROR') {
        clickEl.textContent = 'ERR';
        clickEl.style.background = `rgba(0, 0, 0, ${ALPHA_ON})`;
      } else if (IS_FORCED_STOP) {
        clickEl.textContent = CLICK_MODES.FORCED.label;
        clickEl.style.background = CLICK_MODES.FORCED.color;
      } else if (isMaint) {
        clickEl.textContent = '保守';
        clickEl.style.background = `rgba(75, 85, 99, ${ALPHA_ON})`;
      } else if (currentClickMode === 'STOP') {
        clickEl.textContent = '停止';
        clickEl.style.background = CLICK_MODES.STOP.color;
      } else if (clickCyclePending) {
        clickEl.textContent = '通信';
        clickEl.style.background = `rgba(128, 0, 128, ${ALPHA_ON})`;
      } else if (isBurst) {
        clickEl.textContent = '全開';
        clickEl.style.background = 'rgba(255, 0, 0, 1)';
      } else if (isWaiting) {
        clickEl.textContent = '待機';
        clickEl.style.background = `rgba(14, 116, 144, ${ALPHA_ON})`;
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
        consecutiveErrorCount = 0;
        clearClickCycle();
      }

      currentClickMode = currentClickMode === 'STOP' ? 'FAST' : 'STOP';
      localStorage.setItem(STORAGE_CLICK_KEY, currentClickMode);
      updateClickUI(false, false, isMaintenanceTime());
    });

    container.appendChild(fixedEl);
    container.appendChild(timerOnEl);
    container.appendChild(timerOffEl);
    container.appendChild(clickEl);
    parent.appendChild(container);
    parent.appendChild(reloadPanel);

    (function loop() {
      checkTenReload();

      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      const s = now.getSeconds();
      const isMaint = isMaintenanceTime(now);

      const isBurstTime =
        (h === 10 && m === 59 && s >= 50) ||
        (h === 11 && m === 0 && s <= 20);

      TIMER_OFF_ENABLED = localStorage.getItem(STORAGE_TIMER_OFF_KEY) === 'true';

      if (TIMER_OFF_ENABLED && h === 11 && m === 0 && s >= 35) {
        if (currentClickMode === 'FAST') {
          currentClickMode = 'STOP';
          localStorage.setItem(STORAGE_CLICK_KEY, 'STOP');
          updateClickUI(false, isBurstTime, isMaint);
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
        updateClickUI(false, isBurstTime, isMaint);
      }

      let isWaiting = false;

      if (
        currentClickMode !== 'STOP' &&
        !IS_FORCED_STOP &&
        DATA_SOURCE !== 'ERROR' &&
        !isMaint
      ) {
        const btn = document.querySelector('.js-reserve.button.next');

        if (btn) {
          if (canClickReserve()) {
            lockClickCycle();
            btn.disabled = false;
            btn.classList.remove('is-disabled');
            btn.click();
            isWaiting = false;
          }
        } else {
          isWaiting = true;
        }
      }

      updateClickUI(isWaiting, isBurstTime, isMaint);

      const nextInterval =
        currentClickMode === 'STOP' || IS_FORCED_STOP || DATA_SOURCE === 'ERROR' || isMaint
          ? CHECK_INTERVAL_STOP_MS
          : clickCyclePending
            ? CHECK_INTERVAL_PENDING_MS
            : CHECK_INTERVAL_READY_MS;

      setTimeout(loop, nextInterval);
    })();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', appendUI, { once: true });
  } else {
    appendUI();
  }
})();
