// ==UserScript==
// @name         📅カレンダー再検索
// @namespace    http://tampermonkey.net/
// @version      4.6
// @description  月見出しクリックで再検索。通信エラー時は時間帯別に自動再検索（0.1s / 1s / 30s）。
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

  /* -------- オーバーレイ表示 -------- */
  const createOverlay = (txt) => {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position:'fixed', inset:0, zIndex:9999,
      background:'rgba(255,0,0,0.5)',
      display:'flex', justifyContent:'center', alignItems:'center',
      color:'#fff', fontSize:'32px'
    });
    div.textContent = txt;
    document.body.appendChild(div);
    return div;
  };

  const countdownOverlay = (sec) => {
    const ov = createOverlay(`再検索まで ${sec} 秒`);
    const id = setInterval(() => {
      if (--sec > 0) {
        ov.textContent = `再検索まで ${sec} 秒`;
      } else {
        clearInterval(id);
        ov.remove();
        triggerReload();
      }
    }, 1000);
  };

  const quickOverlay = () => {
    const ov = createOverlay('再検索中…');
    setTimeout(() => ov.remove(), 1000); // 1秒だけ表示
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
        const baseErr = opt.error;
        opt.error = (err) => {
          const wait = retryWait();
          console.log(`[通信エラー] ${wait}s 後に再検索`);
          if (wait < 1) {               // 0.1 秒
            quickOverlay();
            setTimeout(triggerReload, wait * 1000);
          } else {
            countdownOverlay(wait);     // 1 秒 or 30 秒
          }
          baseErr?.(err);
        };
      }
      return baseAjax(opt);
    };
  }

  /* -------- 今月見出し：通常表示のまま、クリックで再検索のみ -------- */
  const head = document.querySelector(
    '.boxCalendar.month .selectMonth li p.currentMonth'
  );
  if (head) {
    // スタイルは変更せず（通常表示）
    head.addEventListener('click', () => {
      if (!document.querySelector('span.calLoad')) triggerReload();
    });
  }
})();
