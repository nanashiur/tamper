// ==UserScript==
// @name         🍴📱ショーレストラン再検索
// @namespace    http://tampermonkey.net/
// @version      1.30
// @description  SPショーレストラン：日付クリック再検索＋30-40秒ランダム＋ON/OFFパネル＋毎時00分F5＋3-5時停止
// @match        https://reserve.tokyodisneyresort.jp/sp/showrestaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (!document.querySelector('#reservationOfDateHid')) return;

  const MARK_ID = '__showrestaurant_reload_sp';
  if (document.getElementById(MARK_ID)) return;

  /* -------------------------------------------------------------
     再検索処理（完成品と同等）
  ------------------------------------------------------------- */
  const reloadSp = (el) => {
    const prepareDateSp = () => {
      const cur = $("#reservationOfDateHid").html();
      const end = $(".calendarEndDate").val();
      if (cur > end) return;

      const prev = $.datepicker
        .parseDate("yymmdd", cur, {})
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

  /* -------------------------------------------------------------
     日付バー
  ------------------------------------------------------------- */
  reloadSp($('#reservationOfDateDisp1'));

  /* -------------------------------------------------------------
     時間帯 見出し（完成品と同じ思想）
  ------------------------------------------------------------- */
  document.querySelectorAll('section > div > h1').forEach(h1 => {
    reloadSp(h1);
  });

  /* -------------------------------------------------------------
     ON / OFF パネル（完成品そのまま）
  ------------------------------------------------------------- */
  const PANEL_ID = 'tdr-auto-panel-show';
  let autoON = true;
  let nextWait = 0;

  const resetRandom = () => {
    nextWait = Math.floor(Math.random() * 11) + 30; // 30〜40秒
  };
  resetRandom();

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
      resetRandom();
      panel.style.background = '#007bff';
      panel.textContent = 'ON ' + nextWait;
    } else {
      panel.style.background = '#333';
      panel.textContent = 'OFF';
    }
  });

  /* -------------------------------------------------------------
     自動再検索ループ（クリック発火のみ）
  ------------------------------------------------------------- */
  setInterval(() => {
    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();
    const s = now.getSeconds();

    /* 毎時00分00秒 → F5相当リロード */
    if (m === 0 && s === 0) {
      location.reload();
      return;
    }

    /* 3〜5時は自動再検索しない */
    if (h >= 3 && h < 5) return;
    if (!autoON) return;

    nextWait--;

    if (nextWait <= 0) {
      const bar = document.querySelector('#reservationOfDateDisp1');
      if (bar) bar.click();
      resetRandom();
    }

    panel.textContent = 'ON ' + nextWait;
  }, 1000);

  /* -------------------------------------------------------------
     マーカー
  ------------------------------------------------------------- */
  const mark = document.createElement('div');
  mark.id = MARK_ID;
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
