// ==UserScript==
// @name         🍴📱ショーレストラン再検索
// @namespace    http://tampermonkey.net/
// @version      1.02
// @description  SPショーレストラン：前日再検索＋35-45秒ランダム自動再読込＋ON/OFFパネル＋3-5時停止＋5:00:01全体再読込
// @match        https://reserve.tokyodisneyresort.jp/sp/showrestaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (!document.querySelector('#reservationOfDateHid')) return;

  const markingElemId = '__showrestaurant_current_day_update_sp';
  if (document.getElementById(markingElemId)) return;

  /* =============================================================
     再検索処理（SPショーレストラン）
  ============================================================= */
  const restaurantReloadSp = (el) => {

    const prepareDateSp = () => {
      const current = $("#reservationOfDateHid").html();
      const end = $(".calendarEndDate").val();
      if (current > end) return;

      const prev = $.datepicker
        .parseDate("yymmdd", current, {})
        .addDays(-1);

      $("#reservationOfDateHid").html(
        $.datepicker.formatDate("yymmdd", prev, {})
      );
    };

    const nextBtn = $('li.next button.nextDateLink');
    const prevBtn = $('li.prev button.preDateLink');

    $(el).on('click', (e) => {
      e.stopPropagation();
      if (prevBtn.attr('disabled') && nextBtn.attr('disabled')) return;

      prepareDateSp();
      nextBtn.removeClass('hasNoData');
      changeReservationDate('next', nextBtn[0]);
      $.mobile.loading("hide");
    });

    $(el).css('cursor', 'pointer');
  };

  /* =============================================================
     日付バー / 見出し
  ============================================================= */
  restaurantReloadSp($('#reservationOfDateDisp1'));

  const headerSelector =
    '.js-accordion > section > header > div > h1:nth-child(1)';

  document.querySelectorAll(headerSelector).forEach(h1 => {
    restaurantReloadSp(h1);
    h1.style.cursor = 'pointer';
  });

  /* =============================================================
     ON / OFF パネル
  ============================================================= */
  let autoON = true;
  let nextWait = 0;
  let reloadedAt5 = false;

  const resetRandomInterval = () => {
    nextWait = Math.floor(Math.random() * 11) + 35; // 35〜45秒
  };
  resetRandomInterval();

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    top: '10px',
    right: '10px',
    zIndex: '2147483647',
    padding: '8px 12px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    userSelect: 'none',
    background: '#007bff',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    opacity: '0.9'
  });

  panel.textContent = 'ON ' + nextWait;
  document.body.appendChild(panel);

  panel.addEventListener('click', () => {
    autoON = !autoON;

    if (autoON) {
      resetRandomInterval();
      panel.style.background = '#007bff';
      panel.textContent = 'ON ' + nextWait;
    } else {
      panel.style.background = '#333';
      panel.textContent = 'OFF';
    }
  });

  /* =============================================================
     自動制御ループ
  ============================================================= */
  setInterval(() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();

    /* ---- 3:00〜4:59 停止 ---- */
    if (h >= 3 && h < 5) {
      panel.textContent = 'STOP';
      return;
    }

    /* ---- 5:00:01 全体リロード（1回のみ） ---- */
    if (h === 5 && m === 0 && s === 1 && !reloadedAt5) {
      reloadedAt5 = true;
      location.reload();
      return;
    }

    /* ---- 通常動作 ---- */
    if (!autoON) {
      panel.textContent = 'OFF';
      return;
    }

    nextWait--;

    if (nextWait <= 0) {
      const bar = document.querySelector('#reservationOfDateDisp1');
      if (bar) bar.click();
      resetRandomInterval();
    }

    panel.textContent = 'ON ' + nextWait;

  }, 1000);

  /* =============================================================
     マーカー
  ============================================================= */
  const mark = document.createElement('div');
  mark.id = markingElemId;
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
