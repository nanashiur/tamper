// ==UserScript==
// @name         🍴📱レストラン一般再検索（スマホ）
// @namespace    http://tampermonkey.net/
// @version      2.101
// @description  SP：前日再検索＋35-45秒ランダム自動＋ON/OFFパネル＋時刻タブ15秒後自動展開
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (!document.querySelector('#reservationOfDateHid')) return;

  const markingElemId = '__restaurant_current_day_update_sp';
  if (document.getElementById(markingElemId)) return;

  /* -------------------------------------------------------------
     時刻タブ（15:00〜など）の自動展開
  ------------------------------------------------------------- */
  function openAllTimeSlots() {
    const h1s = [...document.querySelectorAll('h1')];
    const triggers = h1s.filter(h1 =>
      /\d{1,2}:\d{2}/.test(h1.textContent)
    );

    let i = 0;
    function clickNext() {
      if (i >= triggers.length) return;
      try { triggers[i].click(); } catch (e) {}
      i++;
      setTimeout(clickNext, 250);
    }
    clickNext();
  }

  /* -------------------------------------------------------------
     再検索処理（SP）
  ------------------------------------------------------------- */
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

    $(el).on('click', (event) => {
      event.stopPropagation();

      if (prevBtn.attr('disabled') && nextBtn.attr('disabled')) return;

      prepareDateSp();
      nextBtn.removeClass('hasNoData');
      changeReservationDate('next', nextBtn[0]);
      $.mobile.loading("hide");

      // ★ 15秒後 時刻タブの自動展開
      setTimeout(openAllTimeSlots, 15000);
    });

    // ★ pointer 再現
    $(el).css('cursor', 'pointer');
  };

  /* -------------------------------------------------------------
     日付バー
  ------------------------------------------------------------- */
  restaurantReloadSp($('#reservationOfDateDisp1'));

  /* -------------------------------------------------------------
     朝食 / 昼食 / 夕食 見出し
  ------------------------------------------------------------- */
  const headerSelector = 'section > div > h1:nth-child(1)';
  document.querySelectorAll(headerSelector).forEach(h1 => {
    restaurantReloadSp(h1);
    h1.style.cursor = 'pointer';
  });

  /* -------------------------------------------------------------
     ON/OFF パネル
  ------------------------------------------------------------- */
  const PANEL_ID = 'tdr-auto-panel';
  let autoON = false;
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
    lineHeight: '1',
    cursor: 'pointer',
    userSelect: 'none',
    background: '#333',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    opacity: '0.9'
  });
  panel.textContent = 'OFF';
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

  /* -------------------------------------------------------------
     自動ループ（35〜45秒ランダム）
  ------------------------------------------------------------- */
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

  /* -------------------------------------------------------------
     マーカー
  ------------------------------------------------------------- */
  const mark = document.createElement('div');
  mark.id = markingElemId;
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
