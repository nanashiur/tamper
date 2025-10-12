// ==UserScript==
// @name         📱iOSリロード
// @namespace    http://tampermonkey.net/
// @version      1.4
// @description  AM10:59:40.5を0としてカウントダウン。ゼロ後はマイナス継続し、AM11:00で翌日リセット。透過0.5。タップでF5相当のリロード。
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/iOS_reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/iOS_reload.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ===== 設定 =====
  const TARGET_HOUR = 10;
  const TARGET_MIN  = 59;
  const TARGET_SEC  = 40;
  const TARGET_MS   = 500;
  const RESET_HOUR  = 11;
  const UPDATE_INTERVAL_MS = 100;

  function nextTarget(now = new Date()) {
    const t = new Date(now);
    t.setHours(TARGET_HOUR, TARGET_MIN, TARGET_SEC, TARGET_MS);
    if (now.getTime() > t.getTime()) t.setDate(t.getDate() + 1);
    return t;
  }

  function nextReset(now = new Date()) {
    const r = new Date(now);
    r.setHours(RESET_HOUR, 0, 0, 0);
    if (now.getTime() > r.getTime()) r.setDate(r.getDate() + 1);
    return r;
  }

  function formatRemain(ms) {
    const sign = ms < 0 ? '-' : '';
    const abs = Math.abs(ms);
    const totalTenth = Math.floor(abs / 100);
    const tenth = totalTenth % 10;
    const totalSec = Math.floor(totalTenth / 10);
    const sec = totalSec % 60;
    const totalMin = Math.floor(totalSec / 60);
    const min = totalMin % 60;
    const hour = Math.floor(totalMin / 60);
    const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
    return (hour > 0)
      ? `${sign}${hour}:${pad2(min)}:${pad2(sec)}.${tenth}`
      : `${sign}${pad2(min)}:${pad2(sec)}.${tenth}`;
  }

  // ===== パネル生成 =====
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    left: '14px',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: '999999',
    background: 'rgba(10, 42, 102, 0.5)', // ネイビー透過0.5
    color: '#fff',
    padding: '18px 24px',
    borderRadius: '18px',
    fontSize: '22px',
    fontWeight: '800',
    boxShadow: '0 8px 16px rgba(0,0,0,.25)',
    userSelect: 'none',
    WebkitTapHighlightColor: 'transparent',
    textAlign: 'center',
    cursor: 'pointer',
  });

  const timerEl = document.createElement('div');
  timerEl.textContent = '--:--.-';
  panel.appendChild(timerEl);
  document.body.appendChild(panel);

  // ===== カウント更新 =====
  let target = nextTarget();
  let resetTime = nextReset();
  let pressed = false;

  function tick() {
    const now = new Date();
    if (now >= resetTime) {
      target = nextTarget(now);
      resetTime = nextReset(now);
    }
    const diff = target.getTime() - now.getTime();
    timerEl.textContent = formatRemain(diff);
  }

  tick();
  const intervalId = setInterval(tick, UPDATE_INTERVAL_MS);

  // ===== タップ動作 =====
  panel.addEventListener('click', () => {
    if (pressed) return;
    pressed = true;
    panel.style.background = 'rgba(255, 140, 0, 0.5)'; // オレンジ透過0.5
    setTimeout(() => {
      location.reload(); // F5相当
    }, 80);
  });

  window.addEventListener('beforeunload', () => clearInterval(intervalId));
})();
