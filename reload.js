// ==UserScript==
// @name         ⏰️ 39.00 (0-700)
// @namespace    http://tampermonkey.net/
// @version      4.64
// @description  Pre-reloads at 10:52:00 and reloads at 10:59:39.00 with random delay (0–700ms). Shows countdown, start time, and delay info.
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/reload.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';
  const main = { h: 10, m: 59, s: 39, ms: 0, max: 700 };
  const pre  = { h: 10, m: 52, s: 0,  ms: 0, max: 2000 };
  let trigMain = false, trigPre = false;
  let reloadEnabled = true;

  const nowStr = () => new Date().toLocaleTimeString() + '.' + String(new Date().getMilliseconds()).padStart(3, '0');
  const make = (id, top, bg, txt) => {
    const d = document.createElement('div');
    Object.assign(d.style, {
      position: 'fixed', right: '0px', top: `${top}px`,
      background: bg, color: 'white',
      padding: '3px 10px',
      fontSize: '18px', lineHeight: '18px',
      height: '24px', boxSizing: 'border-box',
      borderRadius: '0px', whiteSpace: 'nowrap',
      zIndex: 99999, cursor: 'pointer'
    });
    d.id = id; d.textContent = txt;
    d.onclick = () => d.remove();
    document.body.appendChild(d);
    return d;
  };

  const elClock = make('customClock', 0,  'rgba(0,0,0,0.6)', nowStr());
  const elStart = make('customStart', 24, 'rgba(0,128,0,0.6)', nowStr());
  const elInfo  = make('customInfo',  48, 'rgba(0,0,128,0.6)', '10:59:39.700');

  const toggleReload = () => {
    reloadEnabled = !reloadEnabled;
    const op = reloadEnabled ? '1' : '0.2';
    elClock.style.opacity = op;
    elStart.style.opacity = op;
    elInfo .style.opacity = op;
  };
  elClock.onclick = elStart.onclick = elInfo.onclick = toggleReload;

  const check = (cfg, triggered, setTrig) => {
    if (!reloadEnabled) return;
    const d = new Date();
    if (triggered()) return;
    if (d.getHours() === cfg.h && d.getMinutes() === cfg.m && d.getSeconds() === cfg.s && d.getMilliseconds() >= cfg.ms) {
      const delay = Math.floor(Math.random() * (cfg.max + 1));
      setTrig(true);
      setTimeout(() => {
        elStart.style.background = 'rgba(255,0,0,0.75)';
        elStart.textContent = nowStr();
        elInfo.style.background = 'rgba(255,165,0,0.75)';
        elInfo.textContent = nowStr();
        location.reload();
      }, delay);
    }
  };

  setInterval(() => {
    elClock.textContent = nowStr();
    check(pre,  () => trigPre,  v => trigPre  = v);
    check(main, () => trigMain, v => trigMain = v);
  }, 50);
})();
