// ==UserScript==
// @name         🟦 Auto Click Blue Reservation Button
// @namespace    http://tampermonkey.net/
// @version      3.2
// @description  Auto-clicks the blue reservation button with toggle. Auto-pause after 60 s, auto-stop after 35 min.
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/blue.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/blue.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';
  const startTime = Date.now();
  let stopped  = false;
  let isPaused = false;

  /* ---------- パネル ---------- */
  const container = Object.assign(document.createElement('div'), {
    style: 'position:fixed;top:0;left:0;z-index:9999;'
  });
  document.body.appendChild(container);
  const shadow = container.attachShadow({ mode: 'open' });

  const el = document.createElement('div');
  Object.assign(el.style, {
    background : 'rgba(60,100,255,.6)',
    color      : 'white',
    padding    : '3px 6px',
    borderRadius: '6px',
    fontSize   : '16px',
    fontFamily : 'monospace',
    whiteSpace : 'nowrap',
    display    : 'block',
    border     : 'none'
  });
  el.textContent = '稼働中';
  shadow.appendChild(el);

  /* ---------- 手動トグル ---------- */
  el.addEventListener('click', () => {
    if (stopped) return;
    isPaused = !isPaused;
    if (isPaused) {
      el.style.background = 'rgba(255,140,0,.8)'; // オレンジ
      el.textContent      = '停止中';
      el.style.border     = 'none';
    } else {
      el.style.background = 'rgba(60,100,255,.6)';
      el.textContent      = '稼働中';
    }
  });

  /* ---------- 60 秒で自動ポーズ ---------- */
  setTimeout(() => {
    if (stopped || isPaused) return;
    isPaused            = true;
    el.style.background = 'rgba(255,140,0,.8)'; // オレンジ
    el.textContent      = '停止中';
    el.style.border     = 'none';
    console.log('⏸️ 自動ポーズ: 60秒経過');
  }, 60000);

  /* ---------- 枠線点滅 ---------- */
  const flash = () => {
    el.style.border = '2px solid #0033cc';
    setTimeout(() => (el.style.border = 'none'), 100);
  };

  /* ---------- メインループ ---------- */
  (function loop () {
    if (stopped) return;

    const now = Date.now();

    /* 35 分で終了 */
    if (now - startTime >= 2100000) {
      el.style.background = 'rgba(0,0,0,.7)';
      el.textContent      = '終了';
      el.style.border     = 'none';
      console.log('🛑 35分経過: スクリプト終了');
      stopped = true;
      return;
    }

    if (!isPaused) {
      const btn = document.querySelector('.js-reserve.button.next');
      if (btn) {
        btn.click();
        el.style.background = 'rgba(60,100,255,.6)';
        el.textContent      = '稼働中';
        flash();
      } else {
        el.style.background = 'rgba(128,0,255,.6)';
        el.textContent      = '待機中';
        el.style.border     = 'none';
      }
    }

    const elapsed = (now - startTime) / 1000;
    const interval =
      elapsed < 10 ? 400 :
      elapsed < 20 ? 1000 :
      elapsed < 30 ? 1500 :
      elapsed < 60 ? 2000 : 3000;

    setTimeout(loop, interval);
  })();
})();
