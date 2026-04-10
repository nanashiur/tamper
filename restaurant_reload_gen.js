// ==UserScript==
// @name          🍴📱レストラン一般再検索
// @version      3.03
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  // --- Discord Webhook ---
  const DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/1484508249943445535/MhUkh4McvQTKXn5gQcFJ8kXMbAvqIebGq--unxE0oreYRTXbUVjsg1rOsZ8AJH7ljGQd';

  if (!document.querySelector('#reservationOfDateHid')) return;

  const MARK_ID = '__restaurant_reload_running';
  if (document.getElementById(MARK_ID)) return;

  // --- 異常検知ルーチン変数 ---
  let lastSearchStartTime = 0;
  let isSearchPending = false;
  let isErrorReported = false;

  function sendDiscord(title, message) {
    if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith('http')) return;
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: "TDR予約監視アラート",
        embeds: [{ title, description: message, color: 16711680, timestamp: new Date().toISOString() }]
      })
    }).catch(e => console.error(e));
  }

  /* ============================
      Ajax通信監視ルーチン
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
        // ❌ 403検知：通知のみ行い、autoONは維持する
        if (xhr.status === 403) {
          if (!isErrorReported) {
            sendDiscord("🚫 403エラー検知", "通信が拒否されました(403)。自動検索は継続します。");
            isErrorReported = true;
          }
        }
      }
    });
  }

  /* ============================
      基本機能
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
      UI制御パネル
  ============================ */
  let autoON = localStorage.getItem('autoSearch') === '1';
  let autoOpen = localStorage.getItem('autoOpenTimeTabs') !== '0';
  let autoF5 = localStorage.getItem('autoF520min') !== '0';
  let waitSec = 15;

  const createPanel = (top, text, bg, onClick) => {
    const p = document.createElement('div');
    Object.assign(p.style, { position: 'fixed', top: top+'px', right: '10px', zIndex: '2147483647', padding: '8px 12px', borderRadius: '10px', fontSize: '14px', fontWeight: '600', cursor: 'pointer', background: bg, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', opacity: '0.9' });
    p.textContent = text; p.onclick = onClick;
    document.body.appendChild(p);
    return p;
  };

  const panel = createPanel(10, autoON ? 'ON' : 'OFF', autoON ? '#007bff' : '#333', () => {
    autoON = !autoON; localStorage.setItem('autoSearch', autoON ? '1' : '0');
    panel.style.background = autoON ? '#007bff' : '#333'; panel.textContent = autoON ? 'ON' : 'OFF';
  });

  const openPanel = createPanel(60, autoOpen ? 'TAB ON' : 'TAB OFF', autoOpen ? '#28a745' : '#333', () => {
    autoOpen = !autoOpen; localStorage.setItem('autoOpenTimeTabs', autoOpen ? '1' : '0');
    openPanel.style.background = autoOpen ? '#28a745' : '#333'; openPanel.textContent = autoOpen ? 'TAB ON' : 'TAB OFF';
  });

  const f5Panel = createPanel(110, autoF5 ? 'F5 ON' : 'F5 OFF', autoF5 ? '#dc3545' : '#333', () => {
    autoF5 = !autoF5; localStorage.setItem('autoF520min', autoF5 ? '1' : '0');
    f5Panel.style.background = autoF5 ? '#dc3545' : '#333'; f5Panel.textContent = autoF5 ? 'F5 ON' : 'F5 OFF';
  });

  /* ============================
      メイン監視ループ
  ============================ */
  setInterval(() => {
    const now = Date.now();
    const d = new Date();
    const secTotal = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

    // 🌀 無限読み込み監視 (120秒タイムアウト)：通知のみ行いautoONは止める
    if (autoON && isSearchPending && (now - lastSearchStartTime > 120000)) {
      if (!isErrorReported) {
        sendDiscord("🌀 無限読み込み検知", "応答が120秒間ありません。");
        isErrorReported = true;
        autoON = false; // 無限ロード時はループを止める
      }
      panel.textContent = "FREEZE";
      panel.style.background = "#ff8c00";
      return;
    }

    if (secTotal >= 10795 && secTotal <= 18305) { panel.textContent = 'MAINT'; return; }
    
    if (autoF5) {
      if (d.getHours() === 5 && d.getMinutes() === 0 && d.getSeconds() === 5) location.reload();
      if (d.getSeconds() === 0 && [10, 30, 50].includes(d.getMinutes())) location.reload();
    }

    if (!autoON) { 
      if (panel.textContent !== 'OFF' && panel.textContent !== 'MAINT' && panel.textContent !== 'FREEZE') {
        panel.textContent = 'OFF';
        panel.style.background = '#333';
      }
      return; 
    }

    waitSec--;
    panel.textContent = 'ON ' + waitSec;
    if (waitSec <= 0) {
      const bar = document.querySelector('#reservationOfDateDisp1');
      if (bar) bar.click();
      waitSec = Math.floor(Math.random() * 6) + 15;
    }
  }, 1000);

  const mark = document.createElement('div');
  mark.id = MARK_ID;
  document.body.appendChild(mark);

})();
