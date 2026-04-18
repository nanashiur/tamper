// ==UserScript==
// @name          🍴📱レストラン一般再検索
// @version      3.34
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1484508249943445535/MhUkh4McvQTKXn5gQcFJ8kXMbAvqIebGq--unxE0oreYRTXbUVjsg1rOsZ8AJH7ljGQd';

  if (!document.querySelector('#reservationOfDateHid')) return;
  const MARK_ID = '__restaurant_reload_running';
  if (document.getElementById(MARK_ID)) return;

  let lastSearchStartTime = 0;
  let isSearchPending = false;
  let lastNotificationTime = 0; 

  let autoOpen = localStorage.getItem('autoOpenTimeTabs') !== '0';
  let autoF5 = localStorage.getItem('autoF520min') !== '0';
  let notifyEnabled = localStorage.getItem('notifyEnabled') !== '0';
  let searchStatus = localStorage.getItem('searchStatus') || 'L'; 

  function getRestaurantName() {
    const nameEl = document.querySelector('.box04 .name, .p-restaurantDetail__name');
    return nameEl ? nameEl.textContent.trim() : document.title.split('｜')[0].replace(/レストラン空き状況確認|予約・購入|詳細/g, '').trim();
  }

  function getTargetDate() {
    const dateHid = document.querySelector('#reservationOfDateHid');
    return dateHid ? ` [${dateHid.textContent.trim()}]` : '';
  }

  // 通知実行
  function sendDiscord(reasonText, isError = true) {
    if (!notifyEnabled) return;
    const now = Date.now();
    
    // エラー（赤）の場合は1分間のクールタイムを適用
    if (isError && now - lastNotificationTime < 60000) return;

    const colorCode = isError ? 16711680 : 16776960; // 赤 or 黄
    const emoji = isError ? "🚫" : "🔔";

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: "レストラン一般再検索",
        embeds: [{
          title: `${emoji}${getRestaurantName()}${getTargetDate()}`,
          description: reasonText,
          color: colorCode,
          timestamp: new Date().toISOString()
        }]
      })
    }).then(() => { 
      if (isError) lastNotificationTime = Date.now(); 
    }).catch(e => console.error(e));
  }

  if (typeof $ !== "undefined") {
    $(document).on("ajaxSend", (event, xhr, settings) => {
      if (settings.url.includes("ajaxReservationOfDate")) {
        lastSearchStartTime = Date.now();
        isSearchPending = true;
      }
    });

    $(document).on("ajaxComplete", (event, xhr, settings) => {
      if (settings.url.includes("ajaxReservationOfDate")) {
        isSearchPending = false;
        if (xhr.status === 403) {
          sendDiscord("制限中。継続します。", true);
          return;
        }
        const responseHtml = xhr.responseText;
        if (!responseHtml) return;
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = responseHtml;
        const availableSlots = [];
        tempDiv.querySelectorAll('tr').forEach(row => {
          if (row.querySelector('.state')?.textContent.includes('空席あり')) {
            const time = row.querySelector('th')?.textContent.trim();
            if (time) availableSlots.push(time);
          }
        });
        if (availableSlots.length > 0) {
          sendDiscord(`空席発見：${availableSlots.join(', ')}`, false);
        }
      }
    });
  }

  // --- UI パネル関連 ---
  const createPanel = (top, text, bg, onClick) => {
    const p = document.createElement('div');
    Object.assign(p.style, { position: 'fixed', top: top+'px', right: '10px', zIndex: '2147483647', padding: '8px 4px', borderRadius: '10px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', background: bg, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', opacity: '0.9', textAlign: 'center', width: '75px' });
    p.textContent = text; p.onclick = onClick;
    document.body.appendChild(p);
    return p;
  };

  const mainPanel = createPanel(10, searchStatus, '#333', () => {
    if (searchStatus === 'OFF') searchStatus = 'L';
    else if (searchStatus === 'L') searchStatus = 'M';
    else if (searchStatus === 'M') searchStatus = 'S';
    else searchStatus = 'OFF';
    localStorage.setItem('searchStatus', searchStatus);
    lastNotificationTime = 0; updateMainPanel(); waitSec = 1; 
  });

  function updateMainPanel() {
    mainPanel.textContent = (searchStatus === 'OFF') ? 'OFF' : `${searchStatus} ${waitSec}`;
    const colors = { OFF: '#333', L: '#007bff', M: '#ff8c00', S: '#e83e8c' };
    mainPanel.style.background = colors[searchStatus];
  }

  const openPanel = createPanel(60, autoOpen ? 'TAB ON' : 'TAB OFF', autoOpen ? '#28a745' : '#333', () => {
    autoOpen = !autoOpen; localStorage.setItem('autoOpenTimeTabs', autoOpen ? '1' : '0');
    openPanel.style.background = autoOpen ? '#28a745' : '#333'; openPanel.textContent = autoOpen ? 'TAB ON' : 'TAB OFF';
  });

  const notifyPanel = createPanel(60, notifyEnabled ? '🔔 ON' : '🔕 OFF', notifyEnabled ? '#ffc107' : '#333', () => {
    notifyEnabled = !notifyEnabled; localStorage.setItem('notifyEnabled', notifyEnabled ? '1' : '0');
    notifyPanel.style.background = notifyEnabled ? '#ffc107' : '#333'; 
    notifyPanel.style.color = notifyEnabled ? '#000' : '#fff';
    notifyPanel.textContent = notifyEnabled ? '🔔 ON' : '🔕 OFF';
  });
  notifyPanel.style.right = '90px';

  const f5Panel = createPanel(110, 'F5 OFF', '#333', () => {
    autoF5 = !autoF5; localStorage.setItem('autoF520min', autoF5 ? '1' : '0'); updateF5Panel();
  });
  function updateF5Panel() {
    if (!autoF5) { f5Panel.style.background = '#333'; f5Panel.textContent = 'F5 OFF'; }
    else { 
      const m = Math.floor(f5WaitSec / 60), s = f5WaitSec % 60;
      f5Panel.style.background = '#6f42c1'; f5Panel.textContent = `F5 ${m}:${s.toString().padStart(2, '0')}`;
    }
  }

  function openAllTimeSlots() {
    const targets = [...document.querySelectorAll('h1')].filter(h => /\d{1,2}:\d{2}/.test(h.textContent));
    targets.forEach((t, i) => setTimeout(() => t.click(), i * 250));
  }
  if (typeof $ !== "undefined") {
    $(document).off("ajaxStop.restaurantReload").on("ajaxStop.restaurantReload", function() {
      if (localStorage.getItem('autoOpenTimeTabs') !== '0') setTimeout(openAllTimeSlots, 300);
    });
  }
  const reloadSP = (el) => {
    $(el).on('click', (e) => {
      e.stopPropagation();
      const nextBtn = $('li.next button.nextDateLink');
      const cur = $("#reservationOfDateHid").html();
      const prev = $.datepicker.parseDate("yymmdd", cur, {}).addDays(-1);
      $("#reservationOfDateHid").html($.datepicker.formatDate("yymmdd", prev, {}));
      nextBtn.removeClass('hasNoData'); changeReservationDate('next', nextBtn[0]);
      $.mobile.loading("hide"); lastNotificationTime = 0;
    }).css('cursor', 'pointer');
  };
  reloadSP($('#reservationOfDateDisp1'));
  document.querySelectorAll('section > div > h1:nth-child(1)').forEach(h => reloadSP(h));

  let waitSec = 15;
  let f5WaitSec = Math.floor(Math.random() * (1320 - 1080 + 1)) + 1080;
  updateMainPanel(); updateF5Panel();

  setInterval(() => {
    const now = Date.now(), d = new Date(), secTotal = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
    if (searchStatus !== 'OFF' && isSearchPending && (now - lastSearchStartTime > 120000)) {
      sendDiscord("フリーズ：停止。", true); searchStatus = 'OFF'; updateMainPanel(); return;
    }
    if (secTotal >= 10795 && secTotal <= 18305) return;
    if (autoF5) { f5WaitSec--; updateF5Panel(); if (f5WaitSec <= 0) location.reload(); }
    if (searchStatus === 'OFF') return;
    waitSec--; updateMainPanel();
    if (waitSec <= 0) {
      document.querySelector('#reservationOfDateDisp1')?.click();
      const ranges = { S: [5, 6], M: [15, 11], L: [30, 11] };
      const r = ranges[searchStatus]; waitSec = Math.floor(Math.random() * r[1]) + r[0];
    }
  }, 1000);

  const mark = document.createElement('div'); mark.id = MARK_ID; document.body.appendChild(mark);
})();
