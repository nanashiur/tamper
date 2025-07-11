// ==UserScript==
// @name         ⏰️ 41.9 (0-500)
// @namespace    http://tampermonkey.net/
// @version      4.311
// @description  Pre-reloads at 10:52:00 and reloads at 10:59:41.9 with random delay (0–500ms).
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const startTime = new Date();
  const startedText = startTime.toLocaleTimeString() + '.' + String(startTime.getMilliseconds()).padStart(3, '0');

  const createPanel = (top, bg) => {
    const el = document.createElement('div');
    el.style.position = 'fixed';
    el.style.top = `${top}px`;
    el.style.right = '0px';
    el.style.background = bg;
    el.style.color = 'white';
    el.style.padding = '5px 15px';
    el.style.borderRadius = '0 0 0 8px';
    el.style.fontSize = '20px';
    el.style.fontFamily = 'monospace';
    el.style.whiteSpace = 'nowrap';
    el.style.zIndex = '9999';
    document.body.appendChild(el);
    return el;
  };

  const clockPanel = createPanel(0, 'rgba(0,0,0,0.6)');
  const startPanel = createPanel(45, 'green');
  const infoPanel = createPanel(90, 'navy');
  startPanel.textContent = startedText;
  infoPanel.textContent = '10:59:41.900';

  let preReloaded = false;
  let mainReloaded = false;

  const updateClock = () => {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds(), ms = now.getMilliseconds();
    clockPanel.textContent = now.toLocaleTimeString() + '.' + String(ms).padStart(3, '0');

    if (!preReloaded && h === 10 && m === 52 && s === 0) {
      preReloaded = true;
      const delay = Math.floor(Math.random() * 2001);
      setTimeout(() => {
        startPanel.style.background = 'red';
        startPanel.textContent = now.toLocaleTimeString() + '.' + String(ms).padStart(3, '0');
        infoPanel.style.background = 'orange';
        infoPanel.textContent = `+${delay}ms`;
        location.reload();
      }, delay);
    }

    if (!mainReloaded && h === 10 && m === 59 && s === 41 && ms >= 900) {
      mainReloaded = true;
      const delay = Math.floor(Math.random() * 501);
      setTimeout(() => {
        const t = new Date();
        startPanel.style.background = 'red';
        startPanel.textContent = t.toLocaleTimeString() + '.' + String(t.getMilliseconds()).padStart(3, '0');
        infoPanel.style.background = 'orange';
        infoPanel.textContent = `+${delay}ms`;
        location.reload();
      }, delay);
    }
  };

  setInterval(updateClock, 50);
})();
