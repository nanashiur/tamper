// ==UserScript==
// @name         🏨 DHMTGD0004 20260826
// @version      26.08.26.1
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

  // --- ストレージキー ---
  const STORAGE_FIXED_KEY = 'tdr_fixed_enabled_state';
  const STORAGE_CLICK_KEY = 'auto_click_mode';
  const STORAGE_TIMER_KEY = 'tdr_11am_timer_enabled';
  const START_TIME_KEY = 'auto_click_start';

  // --- 状態管理 ---
  let FIXED_ENABLED = localStorage.getItem(STORAGE_FIXED_KEY) === 'true';
  let TIMER_ENABLED = localStorage.getItem(STORAGE_TIMER_KEY) === 'true';
  let randomTriggerSec = null; 

  const TARGET       = 'HODHMTGD0004N';
  const FIX_DATE     = '20260826'; 
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

  // ==========================================
  // 1. 通信書き換えロジック
  // ==========================================
  const isReservePost = (url, m) => /\/hotel\/reserve\/?$/.test(String(url||'')) && String(m||'GET').toUpperCase() === 'POST';
  const toSendableString = (body) => {
    if (body == null) return '';
    if (body instanceof URLSearchParams) return body.toString();
    if (typeof body === 'string') return body;
    try { return String(body); } catch { return body; }
  };
  const rewriteBody = (orig) => {
    const sendable = toSendableString(orig);
    if (sendable !== orig && typeof sendable !== 'string') return orig;
    const txt = (typeof sendable === 'string') ? sendable : '';
    if (!txt) return orig;
    const p = new URLSearchParams(txt);
    p.set('commodityCD', PARTS.commodityCD);
    p.set('searchHotelCD', PARTS.searchHotelCD);
    p.set('roomLetterCD', PARTS.roomLetterCD);
    p.set('roomMaterialCD', PARTS.roomMaterialCD);
    p.set('useDate', FIX_DATE);
    p.set('hotelPriceFrameID', FIX_PF);
    return p.toString();
  };
  const HDR = 'x-queueit-ajaxpageurl';
  const BASE = 'https://reserve.tokyodisneyresort.jp';
  const isEncoded = (s) => /%[0-9A-F]{2}/i.test(s);
  const rewriteQueueHeaderValue = (value) => {
    if (!value) return value;
    return value.split(/\s*,\s*/).map(v => {
      let orig = v, decoded = v;
      for (let i=0;i<2;i++){ try{ const d=decodeURIComponent(decoded); if(d===decoded)break; decoded=d; }catch{break;} }
      const urlStr = decoded.startsWith('http') ? decoded : BASE + decoded;
      let u; try { u = new URL(urlStr); } catch { return orig; }
      u.searchParams.set('hotelRoomCd', PARTS.commodityCD);
      const out = u.href.startsWith(BASE) ? u.href.slice(BASE.length) : u.href;
      return isEncoded(orig) ? encodeURIComponent(out) : out;
    }).join(', ');
  };

  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;
  const _set  = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url){ this.__u=url; this.__m=method; this.__hdrs={}; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function(name, value){
    const key = String(name||''); let val=value;
    if (FIXED_ENABLED && key.toLowerCase()===HDR) val = rewriteQueueHeaderValue(value);
    this.__hdrs[key.toLowerCase()] = val;
    return _set.call(this, key, val);
  };
  XMLHttpRequest.prototype.send = function(body){
    try{ if (FIXED_ENABLED && isReservePost(this.__u, this.__m)){
      body = rewriteBody(body);
      if (!(HDR in (this.__hdrs||{}))){
        const loc = location.pathname + location.search;
        const v = rewriteQueueHeaderValue(isEncoded(loc) ? loc : encodeURIComponent(loc));
        try { _set.call(this, HDR, v); } catch {}
      }
    }}catch{}
    return _send.call(this, body);
  };
  if (window.fetch){
    const _fetch = window.fetch;
    window.fetch = function(input, init){
      try{
        const url = (typeof input==='string') ? input : (input&&input.url);
        const method = (init&&init.method) || (input&&input.method) || 'GET';
        if (FIXED_ENABLED && isReservePost(url, method) && init){
          if ('body' in init) init = Object.assign({}, init, { body: rewriteBody(init.body) });
          if (init.headers){
            const h = new Headers(init.headers);
            if (h.has(HDR)) h.set(HDR, rewriteQueueHeaderValue(h.get(HDR)));
            else {
              const loc = location.pathname + location.search;
              const v = rewriteQueueHeaderValue(isEncoded(loc) ? loc : encodeURIComponent(loc));
              h.set(HDR, v);
            }
            init.headers = h;
          }
        }
      }catch{}
      return _fetch(input, init);
    };
  }

  // ==========================================
  // 2. UIデザイン
  // ==========================================
  const appendUI = () => {
    const parent = document.body || document.documentElement;
    const container = document.createElement('div');
    container.id = 'tdr-integrated-panel';
    Object.assign(container.style, {
      position: 'fixed', top: '0', left: '0', zIndex: '2147483647',
      display: 'flex', flexDirection: 'column', width: 'fit-content'
    });

    const code = PARTS.searchHotelCD;
    const baseRGB = (code === 'DHM') ? [22,163,74] : (code === 'FSH') ? [236,72,153] : (code === 'TDH') ? [234,88,12] : [0,0,0];
    const rgba = (a) => `rgba(${baseRGB[0]}, ${baseRGB[1]}, ${baseRGB[2]}, ${a})`;
    
    const fixedEl = document.createElement('div');
    fixedEl.innerHTML = [PARTS.roomLetterCD, FIX_DATE.slice(4), FIX_PF].join('<br>');
    Object.assign(fixedEl.style, {
      color: '#fff', fontFamily: 'sans-serif', fontWeight: '700', fontSize: '14px',
      padding: '5px 8px', borderRadius: '4px 4px 0 0', lineHeight: '1.2', cursor: 'pointer', userSelect: 'none',
      textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.2)'
    });
    const updateFixedVisual = () => {
      fixedEl.style.background = FIXED_ENABLED ? rgba(ALPHA_ON) : rgba(ALPHA_OFF);
      localStorage.setItem(STORAGE_FIXED_KEY, FIXED_ENABLED);
    };
    fixedEl.addEventListener('click', () => { FIXED_ENABLED = !FIXED_ENABLED; updateFixedVisual(); });
    updateFixedVisual();

    let currentClickMode = localStorage.getItem(STORAGE_CLICK_KEY) || 'STOP';
    let startTime = localStorage.getItem(START_TIME_KEY) || Date.now();
    localStorage.setItem(START_TIME_KEY, startTime);

    const clickEl = document.createElement('div');
    Object.assign(clickEl.style, {
      color: 'white', padding: '4px 8px', fontSize: '13px', fontWeight: 'bold',
      fontFamily: 'sans-serif', cursor: 'pointer', userSelect: 'none',
      textAlign: 'center', borderBottom: '1px solid rgba(255,255,255,0.2)', backdropFilter: 'blur(4px)'
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

    const timerEl = document.createElement('div');
    timerEl.textContent = '11時';
    Object.assign(timerEl.style, {
      color: 'white', padding: '4px 8px', fontSize: '13px', fontWeight: 'bold',
      fontFamily: 'sans-serif', cursor: 'pointer', userSelect: 'none',
      borderRadius: '0 0 4px 4px', textAlign: 'center', backdropFilter: 'blur(4px)'
    });
    const updateTimerUI = () => {
      // 11時タイマーをオレンジ色に変更、文字は白を維持
      if (TIMER_ENABLED) {
          timerEl.style.background = `rgba(234, 88, 12, ${ALPHA_ON})`; // Deep Orange
      } else {
          timerEl.style.background = `rgba(0, 0, 0, ${ALPHA_OFF})`;
      }
      localStorage.setItem(STORAGE_TIMER_KEY, TIMER_ENABLED);
    };
    timerEl.addEventListener('click', () => {
      TIMER_ENABLED = !TIMER_ENABLED;
      randomTriggerSec = null; 
      updateTimerUI();
    });
    updateTimerUI();

    container.appendChild(fixedEl);
    container.appendChild(clickEl);
    container.appendChild(timerEl);
    parent.appendChild(container);

    (function loop() {
      const now = new Date();
      
      if (TIMER_ENABLED) {
        const h = now.getHours();
        const m = now.getMinutes();
        const s = now.getSeconds();

        if (h === 10 && m === 59) {
            if (randomTriggerSec === null) {
                randomTriggerSec = Math.floor(Math.random() * 11) + 40; 
                console.log(`[Timer] 今日は 10:59:${randomTriggerSec} に稼働します`);
            }
            if (s >= randomTriggerSec && currentClickMode === 'STOP') {
                currentClickMode = 'FAST';
                localStorage.setItem(STORAGE_CLICK_KEY, 'FAST');
                updateClickUI();
            }
        } else if (h === 11) {
            randomTriggerSec = null; 
        }
      }

      if (Date.now() - startTime >= SIX_HOURS) {
        currentClickMode = 'STOP';
        localStorage.setItem(STORAGE_CLICK_KEY, 'STOP');
        updateClickUI();
        clickEl.textContent = '終了';
        return;
      }

      let isWaiting = false;
      if (currentClickMode !== 'STOP') {
        const btn = document.querySelector('.js-reserve.button.next');
        if (btn) {
          btn.click();
          isWaiting = false;
        } else {
          isWaiting = true;
        }
      }
      updateClickUI(isWaiting);
      setTimeout(loop, currentClickMode === 'STOP' ? 1000 : CLICK_MODES[currentClickMode].interval);
    })();
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appendUI, { once: true });
  else appendUI();
})();
