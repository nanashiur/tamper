// ==UserScript==
// @name         🏨 DHMTGD0004 set00
// @version      26.08.29.2
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

  const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1494882197474381835/JIR_jzaAbrFFvj7-qPP8FO8kmWVp6ufX8bmCpOpFRQ4kPZVX_lTTF6knh79I2dLvy6aD';
  
  const errorHistory = []; 
  let isNotified = false;
  let IS_FORCED_STOP = false; 

  const sendDiscordNotification = (count) => {
    if (isNotified) return;
    isNotified = true;
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: "超高速予約スクリプト",
        embeds: [{
          title: "403エラー",
          color: 16762880, // オレンジ寄りの黄色 (Amber: #FFBF00)
          description: `直近2分間に **${count}回** の403(Forbidden)を検知したため、動作を強制停止しました。`,
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

  let FIXED_ENABLED = localStorage.getItem(STORAGE_FIXED_KEY) === 'true';
  let TIMER_ON_MODE = parseInt(localStorage.getItem(STORAGE_TIMER_ON_MODE_KEY) || '0', 10);
  let TIMER_OFF_ENABLED = localStorage.getItem(STORAGE_TIMER_OFF_KEY) === 'true';
  
  let randomTriggerSec = 0;
  const generateRandomSec = (mode) => {
    if (mode === 1) randomTriggerSec = Math.floor(Math.random() * 6) + 30;
    else if (mode === 2) randomTriggerSec = Math.floor(Math.random() * 4) + 55;
  };
  if (TIMER_ON_MODE > 0) generateRandomSec(TIMER_ON_MODE);

  const TARGET       = 'HODHMTGD0004N';
  const FIX_DATE     = '20260829'; 
  const FIX_PF       = 'M19';
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
    STOP: { label: '停止', color: `rgba(0, 0, 0, ${ALPHA_OFF})` },
    FAST: { label: '稼働', color: `rgba(220, 38, 38, ${ALPHA_ON})` },
    // --- 色更新: 黄色寄りのオレンジ (アンバー/山吹色) ---
    FORCED: { label: '強制', color: `rgba(255, 191, 0, 1)` } 
  };

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

  const _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u){ 
    this.__u=u; this.__m=m; 
    this.addEventListener('loadend', () => {
      if (this.status === 403) {
        const now = Date.now();
        errorHistory.push(now);
        while (errorHistory.length > 0 && errorHistory[0] < now - 120000) {
          errorHistory.shift();
        }
        if (errorHistory.length >= 20) {
          IS_FORCED_STOP = true;
          localStorage.setItem(STORAGE_CLICK_KEY, 'STOP');
          sendDiscordNotification(errorHistory.length);
        }
      }
    });
    return _open.apply(this, arguments); 
  };
  
  const _send = XMLHttpRequest.prototype.send;
  const _set  = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function(n, v){ return _set.call(this, n, v); };
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
    
    const fixedEl = document.createElement('div');
    fixedEl.innerHTML = [PARTS.roomLetterCD, FIX_DATE.slice(4), FIX_PF].join('<br>');
    Object.assign(fixedEl.style, { color: '#fff', padding: '5px 8px', fontSize: '14px', fontWeight: '700', fontFamily: 'sans-serif', textAlign: 'center', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.2)'});
    const updateFixedVisual = () => { fixedEl.style.background = FIXED_ENABLED ? rgba(ALPHA_ON) : rgba(ALPHA_OFF); localStorage.setItem(STORAGE_FIXED_KEY, FIXED_ENABLED); };
    fixedEl.addEventListener('click', () => { FIXED_ENABLED = !FIXED_ENABLED; updateFixedVisual(); });
    updateFixedVisual();

    const timerOnEl = document.createElement('div');
    Object.assign(timerOnEl.style, { color: 'white', padding: '1px 8px', fontSize: '12px', fontWeight: 'bold', fontFamily: 'sans-serif', textAlign: 'center', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)' });
    const updateTimerOnUI = () => {
      if (TIMER_ON_MODE === 0) { timerOnEl.style.background = `rgba(0, 0, 0, ${ALPHA_OFF})`; timerOnEl.textContent = 'OFF'; }
      else { timerOnEl.style.background = TIMER_ON_MODE === 1 ? `rgba(234, 88, 12, ${ALPHA_ON})` : `rgba(147, 51, 234, ${ALPHA_ON})`; timerOnEl.textContent = `${randomTriggerSec}s`; }
      localStorage.setItem(STORAGE_TIMER_ON_MODE_KEY, TIMER_ON_MODE);
    };
    timerOnEl.addEventListener('click', () => { TIMER_ON_MODE = (TIMER_ON_MODE + 1) % 3; if (TIMER_ON_MODE > 0) generateRandomSec(TIMER_ON_MODE); updateTimerOnUI(); });
    updateTimerOnUI();

    const timerOffEl = document.createElement('div');
    Object.assign(timerOffEl.style, { color: 'white', padding: '1px 8px', fontSize: '12px', fontWeight: 'bold', fontFamily: 'sans-serif', textAlign: 'center', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)' });
    const updateTimerOffUI = () => { timerOffEl.style.background = TIMER_OFF_ENABLED ? `rgba(59, 130, 246, ${ALPHA_ON})` : `rgba(0, 0, 0, ${ALPHA_OFF})`; timerOffEl.textContent = TIMER_OFF_ENABLED ? 'STOP' : 'OFF'; localStorage.setItem(STORAGE_TIMER_OFF_KEY, TIMER_OFF_ENABLED); };
    timerOffEl.addEventListener('click', () => { TIMER_OFF_ENABLED = !TIMER_OFF_ENABLED; updateTimerOffUI(); });
    updateTimerOffUI();

    let currentClickMode = localStorage.getItem(STORAGE_CLICK_KEY) || 'STOP';
    let startTime = parseInt(localStorage.getItem(START_TIME_KEY) || Date.now(), 10);
    localStorage.setItem(START_TIME_KEY, startTime);

    const clickEl = document.createElement('div');
    Object.assign(clickEl.style, { color: 'white', padding: '4px 8px', fontSize: '13px', fontWeight: 'bold', fontFamily: 'sans-serif', cursor: 'pointer', borderRadius: '0 0 4px 4px', textAlign: 'center', backdropFilter: 'blur(4px)' });
    const updateClickUI = (isWaiting = false, isBurst = false) => {
      if (IS_FORCED_STOP) {
        clickEl.textContent = CLICK_MODES.FORCED.label;
        clickEl.style.background = CLICK_MODES.FORCED.color;
      } else if (currentClickMode === 'STOP') {
        clickEl.textContent = '停止';
        clickEl.style.background = CLICK_MODES.STOP.color;
      } else if (isBurst) {
        clickEl.textContent = '全開';
        clickEl.style.background = `rgba(255, 0, 0, 1)`; 
      } else if (isWaiting) {
        clickEl.textContent = '待機';
        clickEl.style.background = `rgba(128, 0, 128, ${ALPHA_ON})`; 
      } else {
        clickEl.textContent = '稼働';
        clickEl.style.background = CLICK_MODES.FAST.color;
      }
    };
    clickEl.addEventListener('click', () => {
      if (IS_FORCED_STOP) { IS_FORCED_STOP = false; isNotified = false; errorHistory.length = 0; }
      currentClickMode = (currentClickMode === 'STOP') ? 'FAST' : 'STOP';
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
      const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
      const isBurstTime = (h === 10 && m === 59 && s >= 50) || (h === 11 && m === 0 && s <= 20);

      if (TIMER_OFF_ENABLED && h === 11 && m === 0 && s >= 35) {
        if (currentClickMode === 'FAST') { currentClickMode = 'STOP'; localStorage.setItem(STORAGE_CLICK_KEY, 'STOP'); updateClickUI(); }
      }
      if (TIMER_ON_MODE > 0 && h === 10 && m === 59 && s >= randomTriggerSec && currentClickMode === 'STOP' && !IS_FORCED_STOP) {
        currentClickMode = 'FAST'; localStorage.setItem(STORAGE_CLICK_KEY, 'FAST'); updateClickUI();
      }

      let isWaiting = false;
      if (currentClickMode !== 'STOP' && !IS_FORCED_STOP) {
        const btn = document.querySelector('.js-reserve.button.next');
        if (btn) { btn.click(); isWaiting = false; } else { isWaiting = true; }
      }
      updateClickUI(isWaiting, isBurstTime);

      let nextInterval = (currentClickMode === 'STOP' || IS_FORCED_STOP) ? 1000 : (isBurstTime ? 1000 : Math.random() * 1000 + 1500);
      setTimeout(loop, nextInterval);
    })();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appendUI, { once: true });
  else appendUI();
})();
