// ==UserScript==
// @name         🍴📱レストラン一般再検索
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  SP：前日再検索＋35-45秒ランダム＋ON/OFF（デフォルトON）＋3-5時停止＋5:00:01全リロード
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
     時刻判定（3:00〜4:59:59 停止 / 5:00:01 リロード）
  ========================================================= */
  function getNowSec() {
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }

  function isMaintenanceTime() {
    const t = getNowSec();
    return t >= 3 * 3600 && t < 5 * 3600;
  }

  function isReloadTime() {
    return getNowSec() === (5 * 3600 + 1);
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
  setInterval(() => {

    // 5:00:01 全リロード
    if (isReloadTime()) {
      location.reload();
      return;
    }

    // 3〜5時 停止
    if (isMaintenanceTime()) {
      panel.textContent = 'MAINT';
      panel.style.background = '#666';
      return;
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
