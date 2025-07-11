// ==UserScript==
// @name         ⏰️ 41.9 (0-500)
// @namespace    http://tampermonkey.net/
// @version      4.31
// @description  Pre-reloads at 10:52:00 and reloads at 10:59:41.9 with random delay (0–500ms).
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';
  let startedAt = new Date();
  let triggered = { pre: false, main: false };

  function createPanel(id, top, bg, text) {
    let el = document.createElement('div');
    el.id = id;
    el.textContent = text;
    Object.assign(el.style, {
      position: 'fixed',
      top: `${top}px`,
      right: '0px',
      background: bg,
      color: 'white',
      padding: '5px 15px',
      borderRadius: '0 0 0 8px',
      fontSize: '20px',
      fontFamily: 'monospace',
      whiteSpace: 'nowrap',
      zIndex: '9999'
    });
    document.body.appendChild(el);
    return el;
  }

  let clockEl = createPanel('customClock', 0, 'rgba(0,0,0,0.6)', '');
  let statusEl = createPanel('customStart', 45, 'green', formatTime(startedAt));
  let infoEl = createPanel('customInfo', 90, 'navy', '10:59:41.900');

  function formatTime(d) {
    return d.toLocaleTimeString() + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function triggerReload(kind, delay) {
    const label = kind === 'pre' ? '10:52:00.000' : '10:59:41.900';
    const actualDelay = Math.floor(Math.random() * (delay + 1));
    setTimeout(() => {
      statusEl.style.background = 'red';
      statusEl.textContent = formatTime(new Date());
      infoEl.style.background = 'orange';
      infoEl.textContent = `+${actualDelay}ms`;
      location.reload();
    }, actualDelay);
  }

  setInterval(() => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds(), ms = now.getMilliseconds();
    clockEl.textContent = formatTime(now);

    if (!triggered.pre && h === 10 && m === 52 && s === 0 && ms >= 0) {
      triggered.pre = true;
      triggerReload('pre', 2000);
    }

    if (!triggered.main && h === 10 && m === 59 && s === 41 && ms >= 900) {
      triggered.main = true;
      triggerReload('main', 500);
    }
  }, 50);
})();
