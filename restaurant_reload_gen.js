// ==UserScript==
// @name         🍴📱レストラン一般再検索
// @version      2.8
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

  function getNow() {
    const d = new Date();
    return {
      h: d.getHours(),
      m: d.getMinutes(),
      s: d.getSeconds(),
      sec: d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()
    };
  }

  function isMaintenanceBlock() {
    const t = getNow().sec;
    return t >= (2 * 3600 + 59 * 60 + 55) && t <= (5 * 3600 + 5);
  }

  function isMaintenanceEndReload() {
    const n = getNow();
    return n.h === 5 && n.m === 0 && n.s === 5;
  }

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

  if (typeof $ !== "undefined") {
    $(document).off("ajaxStop.restaurantReload");
    $(document).on("ajaxStop.restaurantReload", function () {
      if (autoOpen) {
        setTimeout(openAllTimeSlots, 300);
      }
    });
  }

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
    });

    $(el).css('cursor', 'pointer');
  };

  reloadSP($('#reservationOfDateDisp1'));
  document.querySelectorAll('section > div > h1:nth-child(1)')
    .forEach(h => reloadSP(h));

  /* ============================
     自動再検索トグル（永続）
  ============================ */
  let autoON = localStorage.getItem('autoSearch') === '1';
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
    background: autoON ? '#007bff' : '#333',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    opacity: '0.9'
  });
  panel.textContent = autoON ? 'ON' : 'OFF';
  document.body.appendChild(panel);

  panel.onclick = () => {
    autoON = !autoON;
    localStorage.setItem('autoSearch', autoON ? '1' : '0');
    panel.style.background = autoON ? '#007bff' : '#333';
    panel.textContent = autoON ? 'ON' : 'OFF';
  };

  /* ============================
     TAB自動展開トグル（永続）
  ============================ */
  let autoOpen = localStorage.getItem('autoOpenTimeTabs') !== '0';

  const openPanel = document.createElement('div');
  Object.assign(openPanel.style, {
    position: 'fixed',
    top: '60px',
    right: '10px',
    zIndex: '2147483647',
    padding: '8px 12px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    background: autoOpen ? '#28a745' : '#333',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    opacity: '0.9'
  });
  openPanel.textContent = autoOpen ? 'TAB ON' : 'TAB OFF';
  document.body.appendChild(openPanel);

  openPanel.onclick = () => {
    autoOpen = !autoOpen;
    localStorage.setItem('autoOpenTimeTabs', autoOpen ? '1' : '0');
    openPanel.style.background = autoOpen ? '#28a745' : '#333';
    openPanel.textContent = autoOpen ? 'TAB ON' : 'TAB OFF';
  };

  /* ============================
     20分ごとF5トグル（永続）
  ============================ */
  let autoF5 = localStorage.getItem('autoF520min') !== '0';

  const f5Panel = document.createElement('div');
  Object.assign(f5Panel.style, {
    position: 'fixed',
    top: '110px',
    right: '10px',
    zIndex: '2147483647',
    padding: '8px 12px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
    background: autoF5 ? '#dc3545' : '#333',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    opacity: '0.9'
  });
  f5Panel.textContent = autoF5 ? 'F5 ON' : 'F5 OFF';
  document.body.appendChild(f5Panel);

  f5Panel.onclick = () => {
    autoF5 = !autoF5;
    localStorage.setItem('autoF520min', autoF5 ? '1' : '0');
    f5Panel.style.background = autoF5 ? '#dc3545' : '#333';
    f5Panel.textContent = autoF5 ? 'F5 ON' : 'F5 OFF';
  };

  /* ============================
     自動ループ
  ============================ */
  let lastMinuteReload = null;

  setInterval(() => {

    const now = getNow();

    if (autoF5 && isMaintenanceEndReload()) {
      location.reload();
      return;
    }

    if (isMaintenanceBlock()) {
      panel.textContent = 'MAINT';
      panel.style.background = '#666';
      return;
    }

    if (autoF5 && now.s === 0 && [10,30,50].includes(now.m)) {

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

  const mark = document.createElement('div');
  mark.id = MARK_ID;
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
