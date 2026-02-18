// ==UserScript==
// @name         🍴📱ショーレストラン再検索
// @namespace    http://tampermonkey.net/
// @version      1.51
// @match        https://reserve.tokyodisneyresort.jp/sp/showrestaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (!document.querySelector('#reservationOfDateHid')) return;
  if (document.getElementById('__showrestaurant_reload')) return;

  /* =====================
     メンテ時間判定
  ===================== */
  const isMaintenanceTime = () => {
    const n = new Date();
    const h = n.getHours(), m = n.getMinutes(), s = n.getSeconds();
    if (h === 2 && m === 59 && s >= 55) return true;
    if (h === 3 || h === 4) return true;
    if (h === 5 && m === 0 && s <= 5) return true;
    return false;
  };

  /* =====================
     SP 再検索本体（完成品同等）
  ===================== */
  const restaurantReloadSp = (el) => {

    const prepareDateSp = () => {
      const cur = $("#reservationOfDateHid").html();
      const end = $(".calendarEndDate").val();
      if (cur > end) return;

      const prev = $.datepicker.parseDate("yymmdd", cur, {}).addDays(-1);
      $("#reservationOfDateHid").html(
        $.datepicker.formatDate("yymmdd", prev, {})
      );
    };

    const nextBtn = $('li.next button.nextDateLink');
    const prevBtn = $('li.prev button.preDateLink');

    $(el).on('click', (e) => {
      e.stopPropagation();
      if (isMaintenanceTime()) return;
      if (prevBtn.attr('disabled') && nextBtn.attr('disabled')) return;

      prepareDateSp();
      nextBtn.removeClass('hasNoData');
      changeReservationDate('next', nextBtn[0]);
      $.mobile.loading("hide");
    });

    $(el).css('cursor', 'pointer');
  };

  /* 日付バー */
  restaurantReloadSp($('#reservationOfDateDisp1'));

  /* 朝・昼・夕 見出し */
  document.querySelectorAll('section > div > h1:nth-child(1)').forEach(h1 => {
    restaurantReloadSp(h1);
  });

  /* =====================
     30–40秒 自動クリック
  ===================== */
  let autoON = true;
  let wait = Math.floor(Math.random() * 11) + 30;

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', top: '10px', right: '10px',
    zIndex: 9999999, padding: '8px 12px',
    borderRadius: '10px', fontWeight: '600',
    background: '#007bff', color: '#fff',
    cursor: 'pointer'
  });
  panel.textContent = 'ON ' + wait;
  document.body.appendChild(panel);

  panel.onclick = () => {
    autoON = !autoON;
    panel.style.background = autoON ? '#007bff' : '#333';
    panel.textContent = autoON ? 'ON ' + wait : 'OFF';
  };

  setInterval(() => {
    if (!autoON) return;

    if (isMaintenanceTime()) {
      panel.textContent = 'MAINT';
      return;
    }

    wait--;
    if (wait <= 0) {
      document.querySelector('#reservationOfDateDisp1')?.click();
      wait = Math.floor(Math.random() * 11) + 30;
    }
    panel.textContent = 'ON ' + wait;
  }, 1000);

  /* =====================
     毎10分 F5（メンテ除外）
  ===================== */
  setInterval(() => {
    const n = new Date();
    if (isMaintenanceTime()) return;
    if (n.getSeconds() === 0 && n.getMinutes() % 10 === 0) {
      location.reload();
    }
    if (n.getHours() === 5 && n.getMinutes() === 0 && n.getSeconds() === 5) {
      location.reload();
    }
  }, 1000);

  const mark = document.createElement('div');
  mark.id = '__showrestaurant_reload';
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
