// ==UserScript==
// @name         📅カレンダー再検索
// @namespace    http://tampermonkey.net/
// @version      3.4
// @description  スマホ版TDRホテルカレンダーで再検索。◯や数字表示で空室を音通知、通信エラーは時間帯別に自動再検索＋カウントダウン付き
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ✅ カレンダー再検索実行
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

  // ✅ 時間帯に応じた待機秒数
  function getRetryWaitSeconds() {
    const now = new Date();
    const hour = now.getHours();

    if (hour >= 3 && hour < 5) return 30;
    if (hour === 11) return 1;
    return 5;
  }

  // ✅ カウントダウン表示（通信エラー時）
  function showRetryCountdown(seconds) {
    playBeep();

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

  // ✅ ビープ音（短く高音）
  function playBeep() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  }

  // ✅ 月の見出しクリック → 再検索
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

  // ✅ Ajax通信にフック（空室検出＋エラー処理）
  if (window.$ && $.lifeobs && $.lifeobs.ajax) {
    const orig_ajax = $.lifeobs.ajax;

    $.lifeobs.ajax = function (e) {
      if (e.url.endsWith('/hotel/api/queryHotelPriceStock/')) {

        const originalSuccess = e.success;

        e.success = function (response) {
          const nowTime = new Date().toLocaleTimeString();
          let hasVacancy = false;

          if (response && Array.isArray(response.priceStock)) {
            response.priceStock.forEach((item, idx) => {
              console.log(`[${idx}] typeof=${typeof item.stockCount}, value=`, item.stockCount);
            });

            hasVacancy = response.priceStock.some(item => {
              const count = item.stockCount;
              if (!count) return false;
              const s = String(count).trim();
              return /^[◯○①②③④⑤⑥⑦⑧⑨1-9]$/.test(s);
            });
          }

          if (hasVacancy) {
            console.log(`[空室検出] ${nowTime}`);
            playBeep();
          } else {
            console.log(`[満室] ${nowTime}`);
          }

          if (typeof originalSuccess === 'function') {
            originalSuccess(response);
          }
        };

        // 通信エラー処理
        e.error = function (k) {
          const nowTime = new Date().toLocaleTimeString();
          console.log(`[通信エラー] ${nowTime}`);
          window.RecentDaysPriceStockQuery.prototype.afterSystemErrorOccurred(k);
          showRetryCountdown(getRetryWaitSeconds());
        };
      }

      return orig_ajax(e);
    };
  }
})();
