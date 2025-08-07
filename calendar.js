// ==UserScript==
// @name         📅カレンダー再検索
// @namespace    http://tampermonkey.net/
// @version      4.5
// @description  月見出しクリックで再検索。通信エラーは時間帯別に自動再検索（0.1s / 1s / 30s）。API無応答30秒でオレンジ警告＋5sビープ。
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar.js
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /* -------- 時間帯別待機秒数 -------- */
  const retryWait = () => {
    const d = new Date();
    const h = d.getHours();
    const m = d.getMinutes();
    if (h === 3 || (h === 4 && m < 59)) return 30;       // 03:00–04:58
    if ((h === 10 && m >= 55) || h === 11) return 0.1;   // 10:55–11:59
    return 1;                                            // その他
  };

  /* -------- オーバーレイ生成 -------- */
  const createOverlay = (txt, bg = 'rgba(255,0,0,0.5)') => {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position:'fixed', inset:0, zIndex:9999,
      background:bg,
      display:'flex', justifyContent:'center', alignItems:'center',
      color:'#fff', fontSize:'32px', fontWeight:'bold', cursor:'pointer'
    });
    div.textContent = txt;
    div.addEventListener('click', () => div.remove());
    document.body.appendChild(div);
    return div;
  };

  /* -------- ビープ音 -------- */
  const beep = () => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o   = ctx.createOscillator();
    const g   = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.value = 0.3;
    o.connect(g); g.connect(ctx.destination);
    o.start(); o.stop(ctx.currentTime + 0.25);
  };

  /* -------- API無応答ウォッチ -------- */
  let watchdogTimer = null;
  let warnInterval  = null;

  const startWatchdog = () => {
    clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      // 30秒無応答
      const ov = createOverlay('応答待機中…', 'rgba(255,140,0,0.8)'); // オレンジ
      warnInterval = setInterval(beep, 5000);                        // 5秒ごと警告音
      ov.addEventListener('click', () => { clearInterval(warnInterval); });
    }, 30000);
  };

  const clearWatchdog = () => {
    clearTimeout(watchdogTimer);
    clearInterval(warnInterval);
  };

  /* -------- カレンダー再検索 -------- */
  const triggerReload = () =>
    document.getElementById('boxCalendarSelect')
      ?.dispatchEvent(new Event('change'));

  /* -------- Ajax フック -------- */
  if (window.$?.lifeobs?.ajax) {
    const baseAjax = $.lifeobs.ajax;
    $.lifeobs.ajax = (opt) => {
      if (opt.url.endsWith('/hotel/api/queryHotelPriceStock/')) {

        /* 成功・失敗どちらでもウォッチドッグ解除 */
        const baseSuc = opt.success;
        opt.success = (resp) => { clearWatchdog(); baseSuc?.(resp); };

        const baseErr = opt.error;
        opt.error   = (err)  => {
          clearWatchdog();
          const wait = retryWait();
          console.log(`[通信エラー] ${wait}s 後に再検索`);
          if (wait < 1) {
            createOverlay('再検索中…').remove(); // 一瞬でもクリック閉じ可
            setTimeout(triggerReload, wait * 1000);
          } else {
            const ov = createOverlay(`再検索まで ${wait} 秒`);
            let sec = wait;
            const id = setInterval(() => {
              if (--sec > 0) ov.textContent = `再検索まで ${sec} 秒`;
              else { clearInterval(id); ov.remove(); triggerReload(); }
            }, 1000);
          }
          baseErr?.(err);
        };

        /* リクエスト送信前にウォッチドッグ開始 */
        startWatchdog();
      }
      return baseAjax(opt);
    };
  }

  /* -------- 今月見出し：反転＋クリック -------- */
  const head = document.querySelector(
    '.boxCalendar.month .selectMonth li p.currentMonth'
  );
  if (head) {
    Object.assign(head.style, {
      cursor:'pointer',
      background:'#0078d7',
      color:'#fff',
      borderRadius:'6px',
      padding:'2px 6px'
    });
    head.addEventListener('click', () => {
      if (!document.querySelector('span.calLoad')) triggerReload();
    });
  }
})();
