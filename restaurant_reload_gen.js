// ==UserScript==
// @name         🍴📱レストラン一般再検索
// @namespace    http://tampermonkey.net/
// @version      2.4
// @description  SP：前日再検索＋35-45秒ランダム＋ON/OFF（デフォルトON）＋メンテ停止＋定時F5
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (!document.querySelector('#reservationOfDateHid')) return;

  const MARK_ID = '__restaurant_reload_running';
  if (document.getElementById(MARK_ID)) return;

  /* =========================================================
     時刻ユーティリティ
  ========================================================= */
  function getNow() {
    const d = new Date();
    return {
      h: d.getHours(),
      m: d.getMinutes(),
      s: d.getSeconds(),
      sec: d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
    };
  }

  // 02:59:55 ～ 05:00:05 完全停止
  function isMaintenanceBlock() {
    const t = getNow().sec;
    return t >= (2 * 3600 + 59 * 60 + 55) && t <= (5 * 3600 + 5);
  }

  // 05:00:05 ちょうど
  function isMaintenanceEndReload() {
    const n = getNow();
    return n.h === 5 && n.m === 0 && n.s === 5;
  }

  /* =========================================================
     時刻タブ自動展開（15秒後）
  ========================================================= */
  function openAllTimeSlots() {
    const targets = [...document.querySelectorAll('h1')]
      .filter(h => /\d{1,2}:\d{2}/.test(h.textContent));

    let i = 0;
    (function clickNext() {
      if (i >= targets.length) return;
      try { targets[i].click(); } catch (e) {}
      i++;
      setTimeout(clickNext, 250);
    })();
  }

  /* =========================================================
     再検索処理（SP）
  ========================================================= */
  const reloadSP = (el) => {
    const nextBtn = $('li.next button.nextDateLink');
    const prevBtn = $('li.prev button.preDateLink');

    const prepareDate = () => {
      const cur = $("#reservationOfDateHid").html();
      const end = $(".calendarEndDate").val();
      if (cur > end) return;

      const prev = $.datepicker.parseDate("yymmdd", cur, {}).addDays(-1);
      $("#reservationOfDateHid").html(
        $.datepicker.formatDate("yymmdd", prev, {})
      );
    };

    $(el).on('click', (e) => {
      if (isMaintenanceBlock()) return;

      e.stopPropagation();
      if (prevBtn.attr('disabled') && nextBtn.attr('disabled')) return;

      prepareDate();
      nextBtn.removeClass('hasNoData');
      changeReservationDate('next', nextBtn[0]);
      $.mobile.loading("hide");

      setTimeout(openAllTimeSlots, 15000);
    });

    $(el).css('cursor', 'pointer');
  };

  reloadSP($('#reservationOfDateDisp1'));
  document.querySelectorAll('section > div > h1:nth-child(1)')
    .forEach(h => reloadSP(h));

  /* =========================================================
     ON / OFF パネル（デフォルト ON）
  ========================================================= */
  let autoON = true;
  let waitSec = 0;

  function resetWait() {
    waitSec = Math.floor(Math.random() * 11) + 35;
  }
  resetWait();

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
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    opacity: '0.9'
  });
  panel.textContent = 'ON';
  document.body.appendChild(panel);

  panel.onclick = () => {
    autoON = !autoON;
    if (autoON) {
      resetWait();
      panel.style.background = '#007bff';
    } else {
      panel.style.background = '#333';
      panel.textContent = 'OFF';
    }
  };

  /* =========================================================
     自動ループ（1秒監視）
  ========================================================= */
  let lastMinuteReload = null;

  setInterval(() => {
    const now = getNow();

    // ② メンテ明け 05:00:05 F5
    if (isMaintenanceEndReload()) {
      location.reload();
      return;
    }

    // ① 完全停止時間
    if (isMaintenanceBlock()) {
      panel.textContent = 'MAINT';
      panel.style.background = '#666';
      return;
    }

    // ③ 毎時10分おき F5
    if (now.s === 0 && now.m % 10 === 0) {
      const key = now.h + ':' + now.m;
      if (lastMinuteReload !== key) {
        lastMinuteReload = key;
        location.reload();
        return;
      }
    }

    if (!autoON) {
      panel.textContent = 'OFF';
      return;
    }

    waitSec--;
    panel.textContent = 'ON ' + waitSec;

    if (waitSec <= 0) {
      const bar = document.querySelector('#reservationOfDateDisp1');
      if (bar) bar.click();
      resetWait();
    }

  }, 1000);

  /* =========================================================
     マーカー
  ========================================================= */
  const mark = document.createElement('div');
  mark.id = MARK_ID;
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
