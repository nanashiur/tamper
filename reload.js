// ==UserScript==
// @name         ⏰️ 41.9 (0-300)
// @namespace    http://tampermonkey.net/
// @version      4.33
// @description  Pre-reloads at 10:52:00 and reloads at 10:59:41.9 with random delay (0–300ms). Shows countdown, start time, and delay info.
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';
  const main = { h: 10, m: 59, s: 41, ms: 900, max: 300 }, pre = { h: 10, m: 52, s: 0, ms: 0, max: 2000 };
  let trigMain = false, trigPre = false;
  const nowStr = () => new Date().toLocaleTimeString() + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
  const make = (id, top, bg, text) => {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed', top: `${top}px`, right: '0px', background: bg, color: 'white',
      padding: '3px 15px', fontSize: '20px', fontFamily: 'monospace',
      whiteSpace: 'nowrap', zIndex: 9999, borderRadius: '0'
    });
    d.id = id; d.textContent = text;
    d.addEventListener('click', () => { d.style.display = 'none'; });
    document.body.appendChild(d); return d;
  };
  const elClock = make('customClock', 0, 'rgba(0,0,0,0.6)', nowStr());
  const elStart = make('customStart', 39, 'rgba(0,128,0,0.6)', nowStr());
  const elInfo = make('customInfo', 78, 'rgba(0,0,128,0.6)', '10:59:41.930');
  const check = (cfg, triggered, setTrig) => {
    const d = new Date();
    if (triggered()) return;
    if (d.getHours() === cfg.h && d.getMinutes() === cfg.m && d.getSeconds() === cfg.s && d.getMilliseconds() >= cfg.ms) {
      const delay = Math.floor(Math.random() * (cfg.max + 1));
      setTrig(true);
      setTimeout(() => {
        elStart.style.background = 'rgba(255,0,0,0.75)';
        elStart.textContent = nowStr();
        elInfo.style.background = 'rgba(255,165,0,0.75)';
        elInfo.textContent = `+${delay}ms`;
        location.reload();
      }, delay);
    }
  };
  setInterval(() => {
    elClock.textContent = nowStr();
    check(pre, () => trigPre, v => trigPre = v);
    check(main, () => trigMain, v => trigMain = v);
  }, 50);
})();
