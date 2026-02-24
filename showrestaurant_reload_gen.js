// ==UserScript==
// @name         🍴📱ショーレストラン再検索
// @namespace    http://tampermonkey.net/
// @version      1.60
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
     メンテ時間判定（そのまま）
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
     SP 再検索本体（変更なし）
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

  restaurantReloadSp($('#reservationOfDateDisp1'));
  document.querySelectorAll('section > div > h1:nth-child(1)').forEach(h1 => {
    restaurantReloadSp(h1);
  });

  /* =====================
     自動再検索トグル（永続）
  ===================== */
  let autoSearch = localStorage.getItem('show_autoSearch') !== '0';
  let wait = Math.floor(Math.random() * 11) + 30;

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed', top: '10px', right: '10px',
    zIndex: 9999999, padding: '8px 12px',
    borderRadius: '10px', fontWeight: '600',
    background: autoSearch ? '#007bff' : '#333',
    color: '#fff', cursor: 'pointer'
  });
  document.body.appendChild(panel);

  panel.onclick = () => {
    autoSearch = !autoSearch;
    localStorage.setItem('show_autoSearch', autoSearch ? '1' : '0');
    panel.style.background = autoSearch ? '#007bff' : '#333';
  };

  /* =====================
     自動F5トグル（永続）
  ===================== */
  let autoF5 = localStorage.getItem('show_autoF5') !== '0';

  const f5Panel = document.createElement('div');
  Object.assign(f5Panel.style, {
    position: 'fixed', top: '60px', right: '10px',
    zIndex: 9999999, padding: '8px 12px',
    borderRadius: '10px', fontWeight: '600',
    background: autoF5 ? '#dc3545' : '#333',
    color: '#fff', cursor: 'pointer'
  });
  f5Panel.textContent = autoF5 ? 'F5 ON' : 'F5 OFF';
  document.body.appendChild(f5Panel);

  f5Panel.onclick = () => {
    autoF5 = !autoF5;
    localStorage.setItem('show_autoF5', autoF5 ? '1' : '0');
    f5Panel.style.background = autoF5 ? '#dc3545' : '#333';
    f5Panel.textContent = autoF5 ? 'F5 ON' : 'F5 OFF';
  };

  /* =====================
     メインループ
  ===================== */
  let lastReloadKey = null;

  setInterval(() => {

    const n = new Date();

    /* --- メンテ中 --- */
    if (isMaintenanceTime()) {
      panel.textContent = 'MAINT';
      return;
    }

    /* --- 自動再検索 --- */
    if (autoSearch) {
      wait--;
      if (wait <= 0) {
        document.querySelector('#reservationOfDateDisp1')?.click();
        wait = Math.floor(Math.random() * 11) + 30;
      }
      panel.textContent = 'ON ' + wait;
    } else {
      panel.textContent = 'OFF';
    }

    /* --- F5制御 --- */
    if (!autoF5) return;

    if (n.getHours() === 5 && n.getMinutes() === 0 && n.getSeconds() === 5) {
      location.reload();
      return;
    }

    if (n.getSeconds() === 0 && [10,30,50].includes(n.getMinutes())) {
      const key = n.getHours() + ':' + n.getMinutes();
      if (lastReloadKey !== key) {
        lastReloadKey = key;
        location.reload();
      }
    }

  }, 1000);

  const mark = document.createElement('div');
  mark.id = '__showrestaurant_reload';
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
