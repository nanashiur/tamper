// ==UserScript==
// @name         📅カレンダー再検索
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  スマホ版ホテル空室カレンダーで月の見出しから再検索。通信エラー時は5秒後に自動再検索＋時刻ログ＋音付き
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // 同月のカレンダー再検索を実行
  function executeCalendarReload() {
    const calendarTable = document.querySelector('.boxCalendar.month table');
    const calendarSelect = document.getElementById('boxCalendarSelect');
    if (!calendarTable || !calendarSelect) return;

    const reserveUseDate = document.querySelector('#reserveSearchForm input#reserveUseDate');
    if (reserveUseDate && reserveUseDate.value === '') {
      const defaultInput = document.getElementById('vacancySearchMonthDefault');
      if (defaultInput) defaultInput.value = 'blank';
    }

    const loadingNow = document.querySelectorAll('.boxCalendar.month table tbody tr td dl dd span.calLoad').length > 0;
    const nowTime = new Date().toLocaleTimeString();

    if (!loadingNow) {
      calendarSelect.dispatchEvent(new Event('change'));
      console.log(`[再検索実行] ${nowTime}`);
    } else {
      console.log(`[スキップ] 読み込み中のため再検索せず（${nowTime}）`);
    }
  }

  // カウントダウン表示（通信エラー後）
  function showRetryCountdown(seconds) {
    playBeep();  // 🔔 音を鳴らす

    let count = seconds;
    const countdown = document.createElement('div');
    countdown.textContent = `${count} 秒後に再検索します`;
    countdown.style.position = 'fixed';
    countdown.style.top = '50%';
    countdown.style.left = '50%';
    countdown.style.transform = 'translate(-50%, -50%)';
    countdown.style.background = 'rgba(255, 0, 0, 0.6)';
    countdown.style.color = 'white';
    countdown.style.padding = '20px 30px';
    countdown.style.borderRadius = '12px';
    countdown.style.fontSize = '18px';
    countdown.style.zIndex = '9999';
    document.body.appendChild(countdown);

    const timer = setInterval(() => {
      count--;
      if (count > 0) {
        countdown.textContent = `${count} 秒後に再検索します`;
      } else {
        clearInterval(timer);
        document.body.removeChild(countdown);
        executeCalendarReload();
      }
    }, 1000);
  }

  // ビープ音を再生
  function playBeep() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);     // 音量調整

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  // 見出し（今月）をクリック可能にし、再検索を仕込む
  const currentMonth = document.querySelector('.boxCalendar.month .selectMonth li p.currentMonth');
  if (currentMonth) {
    currentMonth.style.cursor = 'pointer';
    currentMonth.style.backgroundColor = '#0078d7';
    currentMonth.style.color = '#fff';
    currentMonth.style.borderRadius = '6px';
    currentMonth.style.padding = '2px 6px';
    currentMonth.addEventListener('click', () => {
      executeCalendarReload();
    });
  }

  // Ajax通信エラー時の自動処理
  if (window.$ && $.lifeobs && $.lifeobs.ajax) {
    const orig_ajax = $.lifeobs.ajax;
    $.lifeobs.ajax = function (e) {
      if (e.url.endsWith('/hotel/api/queryHotelPriceStock/')) {
        e.error = function (k) {
          const nowTime = new Date().toLocaleTimeString();
          console.log(`[通信エラー] ${nowTime}`);
          window.RecentDaysPriceStockQuery.prototype.afterSystemErrorOccurred(k);
          showRetryCountdown(5);
        };
      }
      return orig_ajax(e);
    };
  }
})();
