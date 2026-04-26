// ==UserScript==
// @name         🏨 DHMTGD0004 20260827
// @version      26.08.27.1
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve_DHMTGD0004.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reserve_DHMTGD0004.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (window.__tdr_combined_installed) return;
  window.__tdr_combined_installed = true;

  const STORAGE_FIXED_KEY = 'tdr_fixed_enabled_state';
  const STORAGE_CLICK_KEY = 'auto_click_mode';
  const STORAGE_TIMER_MODE_KEY = 'tdr_11am_timer_mode'; // モード保存用 (0: OFF, 1: 35-45s, 2: 55-59s)
  const START_TIME_KEY = 'auto_click_start';

  let FIXED_ENABLED = localStorage.getItem(STORAGE_FIXED_KEY) === 'true';
  let TIMER_MODE = parseInt(localStorage.getItem(STORAGE_TIMER_MODE_KEY) || '0', 10);

  let randomTriggerSec = 0;
  const generateRandomSec = (mode) => {
    if (mode === 1) {
      randomTriggerSec = Math.floor(Math.random() * 11) + 35; // 35-45秒
    } else if (mode === 2) {
      randomTriggerSec = Math.floor(Math.random() * 5) + 55;  // 55-59秒
    }
    console.log(`[Timer] モード ${mode}: 実行秒数を ${randomTriggerSec}s に設定しました`);
  };

  // 初期決定
  if (TIMER_MODE > 0) generateRandomSec(TIMER_MODE);

  const TARGET       = 'HODHMTGD0004N';
  const FIX_DATE     = '20260827';
  const FIX_PF       = 'M17';
  const SIX_HOURS    = 6 * 60 * 60 * 1000;
  const ALPHA_ON  = 0.85;
  const ALPHA_OFF = 0.35;

  const PARTS = {
    commodityCD:    TARGET,
    searchHotelCD:  TARGET.slice(2,5),
    roomLetterCD:   TARGET.slice(5,8),
    roomMaterialCD: TARGET.slice(2,12)
  };

  const CLICK_MODES = {
    STOP: { label: '停止', color: `rgba(0, 0, 0, ${ALPHA_OFF})`, interval: 1000 },
    FAST: { label: '稼働', color: `rgba(220, 38, 38, ${ALPHA_ON})`, interval: 1000 }
  };

  // 通信書き換え（省略せず維持）
  const isReservePost = (url, m) => /\/hotel\/reserve\/?$/.test(String(url||'')) && String(m||'GET').toUpperCase() === 'POST';
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
  const rewriteQueueHeaderValue = (v) => {
    if (!v) return v;
    const urlStr = v.includes('http') ? v : 'https://reserve.tokyodisneyresort.jp' + (v.startsWith('/') ? '' : '/') + v;
    try {
      const u = new URL(urlStr);
      u.searchParams.set('hotelRoomCd', PARTS.commodityCD);
      return u.href.replace('https://reserve.tokyodisneyresort.jp', '');
    } catch { return v; }
  };

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  const _set  = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(m, u){ this.__u=u; this.__m=m; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function(n, v){
    if (FIXED_ENABLED && n.toLowerCase()==='x-queueit-ajaxpageurl') v = rewriteQueueHeaderValue(v);
    return _set.call(this, n, v);
  };
  XMLHttpRequest.prototype.send = function(b){
    if (FIXED_ENABLED && isReservePost(this.__u, this.__m)) b = rewriteBody(b);
    return _send.call(this, b);
  };

  const appendUI = () => {
    const parent = document.body || document.documentElement;
    const container = document.createElement('div');
    container.id = 'tdr-integrated-panel';
    Object.assign(container.style, {
      position: 'fixed', top: '0', left: '0', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', width: 'fit-content'
    });

    const code = PARTS.searchHotelCD;
    const baseRGB = (code === 'DHM') ? [22,163,74] : (code === 'FSH') ? [236,72,153] : [234,88,12];
    const rgba = (a) => `rgba(${baseRGB[0]}, ${baseRGB[1]}, ${baseRGB[2]}, ${a})`;

    // 1段目: 固定
    const fixedEl = document.createElement('div');
    fixedEl.innerHTML = [PARTS.roomLetterCD, FIX_DATE.slice(4), FIX_PF].join('<br>');
    Object.assign(fixedEl.style, {
      color: '#fff', fontFamily: 'sans-serif', fontWeight: '700', fontSize: '14px',
      padding: '5px 8px', borderRadius: '4px 4px 0 0', lineHeight: '1.2', cursor: 'pointer', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.2)'
    });
    const updateFixedVisual = () => {
      fixedEl.style.background = FIXED_ENABLED ? rgba(ALPHA_ON) : rgba(ALPHA_OFF);
      localStorage.setItem(STORAGE_FIXED_KEY, FIXED_ENABLED);
    };
    fixedEl.addEventListener('click', () => { FIXED_ENABLED = !FIXED_ENABLED; updateFixedVisual(); });
    updateFixedVisual();

    // 2段目: 3段階タイマートグル
    const timerEl = document.createElement('div');
    Object.assign(timerEl.style, {
      color: 'white', padding: '1px 8px', fontSize: '12px', fontWeight: 'bold',
      fontFamily: 'sans-serif', cursor: 'pointer', textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)'
    });
    const updateTimerUI = () => {
      if (TIMER_MODE === 0) {
          timerEl.style.background = `rgba(0, 0, 0, ${ALPHA_OFF})`;
          timerEl.textContent = 'OFF';
      } else if (TIMER_MODE === 1) {
          timerEl.style.background = `rgba(234, 88, 12, ${ALPHA_ON})`; // オレンジ
          timerEl.textContent = `${randomTriggerSec}s`;
      } else if (TIMER_MODE === 2) {
          timerEl.style.background = `rgba(147, 51, 234, ${ALPHA_ON})`; // 紫
          timerEl.textContent = `${randomTriggerSec}s`;
      }
      localStorage.setItem(STORAGE_TIMER_MODE_KEY, TIMER_MODE);
    };
    timerEl.addEventListener('click', () => {
      TIMER_MODE = (TIMER_MODE + 1) % 3; // 0 -> 1 -> 2 -> 0
      if (TIMER_MODE > 0) generateRandomSec(TIMER_MODE);
      updateTimerUI();
    });
    updateTimerUI();

    // 3段目: 連打
    let currentClickMode = localStorage.getItem(STORAGE_CLICK_KEY) || 'STOP';
    let startTime = parseInt(localStorage.getItem(START_TIME_KEY) || Date.now(), 10);
    localStorage.setItem(START_TIME_KEY, startTime);

    const clickEl = document.createElement('div');
    Object.assign(clickEl.style, {
      color: 'white', padding: '4px 8px', fontSize: '13px', fontWeight: 'bold',
      fontFamily: 'sans-serif', cursor: 'pointer', borderRadius: '0 0 4px 4px', textAlign: 'center', backdropFilter: 'blur(4px)'
    });
    const updateClickUI = (isWaiting = false) => {
      if (currentClickMode === 'STOP') {
        clickEl.textContent = CLICK_MODES.STOP.label;
        clickEl.style.background = CLICK_MODES.STOP.color;
      } else if (isWaiting) {
        clickEl.textContent = '待機';
        clickEl.style.background = `rgba(128, 0, 128, ${ALPHA_ON})`;
      } else {
        clickEl.textContent = CLICK_MODES[currentClickMode].label;
        clickEl.style.background = CLICK_MODES[currentClickMode].color;
      }
    };
    clickEl.addEventListener('click', () => {
      currentClickMode = (currentClickMode === 'STOP') ? 'FAST' : 'STOP';
      localStorage.setItem(STORAGE_CLICK_KEY, currentClickMode);
      updateClickUI();
    });

    container.appendChild(fixedEl);
    container.appendChild(timerEl);
    container.appendChild(clickEl);
    parent.appendChild(container);

    (function loop() {
      const now = new Date();
      if (TIMER_MODE > 0) {
        const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
        if (h === 10 && m === 59 && s >= randomTriggerSec && currentClickMode === 'STOP') {
            currentClickMode = 'FAST';
            localStorage.setItem(STORAGE_CLICK_KEY, 'FAST');
            updateClickUI();
        }
      }
      if (Date.now() - startTime >= SIX_HOURS) {
        currentClickMode = 'STOP'; updateClickUI(); clickEl.textContent = '終了'; return;
      }
      let isWaiting = false;
      if (currentClickMode !== 'STOP') {
        const btn = document.querySelector('.js-reserve.button.next');
        if (btn) { btn.click(); isWaiting = false; } else { isWaiting = true; }
      }
      updateClickUI(isWaiting);
      setTimeout(loop, currentClickMode === 'STOP' ? 1000 : 1000);
    })();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appendUI, { once: true });
  else appendUI();
})();
