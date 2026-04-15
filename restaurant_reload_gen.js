// ==UserScript==
// @name          🍴📱レストラン一般再検索
// @version      3.18
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
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
  let isErrorReported = false;

  /* ============================
      レストラン名称取得 (システム上の独立した名称を取得)
  ============================ */
  function getSearchInfo() {
    // ソース内の <p class="name"> にある独立したレストラン名を取得
    const nameEl = document.querySelector('.box04 .name') ||
                   document.querySelector('.p-restaurantDetail__name');

    let fullName = nameEl ? nameEl.textContent.trim() : "";

    if (!fullName) {
      // 予備：タイトルから取得（余計な文言はカット）
      fullName = document.title.split('｜')[0]
                  .replace(/レストラン空き状況確認|予約・購入|東京ディズニーリゾート・オンラインサイト/g, '')
                  .trim();
    }

    // 日付の取得 [20260419]
    const dateHid = document.querySelector('#reservationOfDateHid');
    const dateStr = dateHid ? ` [${dateHid.textContent.trim()}]` : '';

    return (fullName || "レストラン") + dateStr;
  }

  function sendDiscord(title, message) {
    if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith('http')) return;
    const info = getSearchInfo();
    const payload = {
      username: "レストラン一般監視アラート",
      embeds: [{
        title: `${title}：${info}`,
        description: message,
        color: 16711680,
        timestamp: new Date().toISOString()
      }]
    };
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(e => console.error(e));
  }

  /* ============================
      通信監視
  ============================ */
  if (typeof $ !== "undefined") {
    $(document).on("ajaxSend", (event, xhr, settings) => {
      if (settings.url.includes("ajaxReservationOfDate")) {
        lastSearchStartTime = Date.now();
        isSearchPending = true;
        isErrorReported = false;
      }
    });

    $(document).on("ajaxComplete", (event, xhr, settings) => {
      if (settings.url.includes("ajaxReservationOfDate")) {
        isSearchPending = false;
        if (xhr.status === 403 && !isErrorReported) {
          sendDiscord("🚫 403エラー検知", "通信が拒否されました(403)。自動検索は継続します。");
          isErrorReported = true;
        }
      }
    });
  }

  /* ============================
      自動タブ展開
  ============================ */
  function openAllTimeSlots() {
    const targets = [...document.querySelectorAll('h1')].filter(h => /\d{1,2}:\d{2}/.test(h.textContent));
    let i = 0;
    (function clickNext() {
      if (i >= targets.length) return;
      try { targets[i].click(); } catch (e) {}
      i++;
      setTimeout(clickNext, 250);
    })();
  }

  if (typeof $ !== "undefined") {
    $(document).off("ajaxStop.restaurantReload").on("ajaxStop.restaurantReload", function() {
      if (localStorage.getItem('autoOpenTimeTabs') !== '0') {
        setTimeout(openAllTimeSlots, 300);
      }
    });
  }

  const reloadSP = (el) => {
    $(el).on('click', (e) => {
      e.stopPropagation();
      const nextBtn = $('li.next button.nextDateLink');
      const cur = $("#reservationOfDateHid").html();
      const prev = $.datepicker.parseDate("yymmdd", cur, {}).addDays(-1);
      $("#reservationOfDateHid").html($.datepicker.formatDate("yymmdd", prev, {}));
      nextBtn.removeClass('hasNoData');
      changeReservationDate('next', nextBtn[0]);
      $.mobile.loading("hide");
    }).css('cursor', 'pointer');
  };

  reloadSP($('#reservationOfDateDisp1'));
  document.querySelectorAll('section > div > h1:nth-child(1)').forEach(h => reloadSP(h));

  /* ============================
      UIパネル (初期Lモード)
  ============================ */
  let autoOpen = localStorage.getItem('autoOpenTimeTabs') !== '0';
  let autoF5 = localStorage.getItem('autoF520min') !== '0';
  let searchStatus = localStorage.getItem('searchStatus') || 'L';
  let waitSec = 15;
  let f5WaitSec = Math.floor(Math.random() * (1320 - 1080 + 1)) + 1080;

  const createPanel = (top, text, bg, onClick) => {
    const p = document.createElement('div');
    Object.assign(p.style, { position: 'fixed', top: top+'px', right: '10px', zIndex: '2147483647', padding: '8px 4px', borderRadius: '10px', fontSize: '12px', fontWeight: '600', cursor: 'pointer', background: bg, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', opacity: '0.9', textAlign: 'center', width: '75px' });
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
    updateMainPanel();
    waitSec = 1;
  });

  function updateMainPanel() {
    mainPanel.textContent = (searchStatus === 'OFF') ? 'OFF' : `${searchStatus} ${waitSec}`;
    if (searchStatus === 'OFF') mainPanel.style.background = '#333';
    else if (searchStatus === 'L') mainPanel.style.background = '#007bff';
    else if (searchStatus === 'M') mainPanel.style.background = '#ff8c00';
    else if (searchStatus === 'S') mainPanel.style.background = '#e83e8c';
  }
  updateMainPanel();

  const openPanel = createPanel(60, autoOpen ? 'TAB ON' : 'TAB OFF', autoOpen ? '#28a745' : '#333', () => {
    autoOpen = !autoOpen; localStorage.setItem('autoOpenTimeTabs', autoOpen ? '1' : '0');
    openPanel.style.background = autoOpen ? '#28a745' : '#333'; openPanel.textContent = autoOpen ? 'TAB ON' : 'TAB OFF';
  });

  const f5Panel = createPanel(110, 'F5 OFF', '#333', () => {
    autoF5 = !autoF5; localStorage.setItem('autoF520min', autoF5 ? '1' : '0');
    if(!autoF5) { f5Panel.style.background = '#333'; f5Panel.textContent = 'F5 OFF'; }
    else { f5Panel.style.background = '#6f42c1'; }
  });
  if(autoF5) f5Panel.style.background = '#6f42c1';

  /* ============================
      メインループ
  ============================ */
  setInterval(() => {
    const now = Date.now();
    const d = new Date();
    const secTotal = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

    if (searchStatus !== 'OFF' && isSearchPending && (now - lastSearchStartTime > 120000)) {
      if (!isErrorReported) {
        sendDiscord("🌀 無限読み込み検知", "応答が120秒間ありません。");
        isErrorReported = true;
        searchStatus = 'OFF';
      }
      mainPanel.textContent = "FREEZE";
      mainPanel.style.background = "#ff8c00";
      return;
    }

    if (secTotal >= 10795 && secTotal <= 18305) { mainPanel.textContent = 'MAINT'; return; }

    if (autoF5) {
      f5WaitSec--;
      const m = Math.floor(f5WaitSec / 60);
      const s = f5WaitSec % 60;
      f5Panel.textContent = `F5 ${m}:${s.toString().padStart(2, '0')}`;
      if (f5WaitSec <= 0 || (d.getHours() === 5 && d.getMinutes() === 0 && d.getSeconds() === 5)) location.reload();
    }

    if (searchStatus === 'OFF') return;

    waitSec--;
    updateMainPanel();

    if (waitSec <= 0) {
      const bar = document.querySelector('#reservationOfDateDisp1');
      if (bar) bar.click();
      if (searchStatus === 'S') waitSec = Math.floor(Math.random() * 6) + 5;
      else if (searchStatus === 'L') waitSec = Math.floor(Math.random() * 11) + 30;
      else waitSec = Math.floor(Math.random() * 11) + 15;
    }
  }, 1000);

  const mark = document.createElement('div');
  mark.id = MARK_ID;
  document.body.appendChild(mark);

})();
