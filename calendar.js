// ==UserScript==
// @name         📅カレンダー再検索（最小機能版 v4.3）
// @namespace    http://tampermonkey.net/
// @version      4.3
// @description  月見出しクリックで再検索。通信エラー時は時間帯別に自動再検索（0.1s/1s/30s）。0.1秒時は処理だけ即実行し、オーバーレイは1秒表示。
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /* -------- 時間帯別待機秒数 -------- */
  const retryWait = () => {
    const d = new Date();
    const h = d.getHours();
    const m = d.getMinutes();

    // 03:00〜04:58 → 30 秒
    if (h === 3 || (h === 4 && m < 59)) return 30;

    // 10:55〜11:59 → 0.1 秒
    if ((h === 10 && m >= 55) || h === 11) return 0.1;

    // それ以外 → 1 秒
    return 1;
  };

  /* -------- 共通オーバーレイ生成 -------- */
  const createOverlay = (text) => {
    const div = document.createElement('div');
    Object.assign(div.style, {
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(255,0,0,0.5)',
      display: 'flex', justifyContent: 'center', alignItems: 'center',
      color: '#fff', fontSize: '32px'
    });
    div.textContent = text;
    document.body.appendChild(div);
    return div;
  };

  /* -------- カウントダウン（1秒単位） -------- */
  const showCountdown = (sec) => {
    const ov = createOverlay(`再検索まで ${sec} 秒`);
    const t = setInterval(() => {
      if (--sec > 0) {
        ov.textContent = `再検索まで ${sec} 秒`;
      } else {
        clearInterval(t);
        ov.remove();
        triggerReload();
      }
    }, 1000);
  };

  /* -------- 0.1 秒用の短時間オーバーレイ -------- */
  const showQuickOverlay = () => {
    const ov = createOverlay('再検索中…');
    setTimeout(() => ov.remove(), 1000); // 1秒で消す
  };

  /* -------- カレンダー再検索 -------- */
  const triggerReload = () => {
    document.getElementById('boxCalendarSelect')
      ?.dispatchEvent(new Event('change'));
  };

  /* -------- Ajax フック -------- */
  if (window.$?.lifeobs?.ajax) {
    const origAjax = $.lifeobs.ajax;
    $.lifeobs.ajax = (opt) => {
      if (opt.url.endsWith('/hotel/api/queryHotelPriceStock/')) {

        /* ERROR → 再試行スケジュール */
        const origErr = opt.error;
        opt.error = (err) => {
          const wait = retryWait();
          console.log(`[通信エラー] ${wait}s 後に自動再検索`);
          if (wait < 1) {
            showQuickOverlay();                 // 1秒表示
            setTimeout(triggerReload, wait * 1000); // 0.1秒で実行
          } else {
            showCountdown(wait);                // 通常カウントダウン
          }
          origErr?.(err);
        };
      }
      return origAjax(opt);
    };
  }

  /* -------- 月見出し：反転表示＋クリック再検索 -------- */
  const head = document.querySelector(
    '.boxCalendar.month .selectMonth li p.currentMonth'
  );
  if (head) {
    Object.assign(head.style, {
      cursor: 'pointer',
      background: '#0078d7',
      color: '#fff',
      borderRadius: '6px',
      padding: '2px 6px'
    });
    head.addEventListener('click', () => {
      if (!document.querySelector('span.calLoad')) triggerReload();
    });
  }
})();
