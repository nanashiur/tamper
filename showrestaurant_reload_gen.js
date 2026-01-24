// ==UserScript==
// @name         🍴📱ショーレストラン再検索
// @namespace    http://tampermonkey.net/
// @version      1.01
// @description  SPショーレストラン：前日再検索＋35-45秒ランダム自動再読込＋ON/OFFパネル
// @match        https://reserve.tokyodisneyresort.jp/sp/showrestaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  /* =============================================================
     前提チェック（SPショーレストラン）
  ============================================================= */
  if (!document.querySelector('#reservationOfDateHid')) return;

  const markingElemId = '__showrestaurant_current_day_update_sp';
  if (document.getElementById(markingElemId)) return;

  /* =============================================================
     SPショーレストラン 再検索本体
     ※ 完成品ブックマークレットと同じ流れ
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
     日付バー（最重要）
  ============================================================= */
  restaurantReloadSp($('#reservationOfDateDisp1'));

  /* =============================================================
     各ショーレストラン 見出し（日付クリック再読込）
     ※ ブックマークレット完全踏襲
  ============================================================= */
  const headerSelector =
    '.js-accordion > section > header > div > h1:nth-child(1)';

  document.querySelectorAll(headerSelector).forEach(h1 => {
    restaurantReloadSp(h1);
    h1.style.cursor = 'pointer';
  });

  /* =============================================================
     ON / OFF パネル（完全流用）
  ============================================================= */
  let autoON = true;
  let nextWait = 0;

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
     ランダム自動再読込
  ============================================================= */
  setInterval(() => {
    if (!autoON) return;

    nextWait--;

    if (nextWait <= 0) {
      const bar = document.querySelector('#reservationOfDateDisp1');
      if (bar) bar.click();
      resetRandomInterval();
    }

    panel.textContent = 'ON ' + nextWait;
  }, 1000);

  /* =============================================================
     実行済みマーカー
  ============================================================= */
  const mark = document.createElement('div');
  mark.id = markingElemId;
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
