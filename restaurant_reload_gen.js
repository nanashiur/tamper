// ==UserScript==
// @name          🍴📱レストラン一般再検索
// @version      4.20
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
  const MARK_ID = '__restaurant_reload_running_v4'; 
  if (document.getElementById(MARK_ID)) return;

  // 状態管理
  const state = {
    lastSearchStartTime: 0,
    isSearchPending: false,
    lastNotificationTime: 0,
    errorCount: 0, 
    autoOpen: localStorage.getItem('autoOpenTimeTabs') !== '0',
    autoF5: localStorage.getItem('autoF520min') !== '0',
    notifyEnabled: localStorage.getItem('notifyEnabled') !== '0',
    searchStatus: localStorage.getItem('searchStatus') || 'L',
    excludedTimes: JSON.parse(localStorage.getItem('excludedTimes') || '[]'),
    waitSec: 15,
    f5WaitSec: Math.floor(Math.random() * (1320 - 1080 + 1)) + 1080,
    nextActionTime: Date.now() + 15000 
  };

  // ★連続エラーの許容回数を5回に変更
  const ERROR_THRESHOLD = 5; 

  // --- ユーティリティ ---
  function getRestaurantInfo() {
    const nameEl = document.querySelector('.box04 .name, .p-restaurantDetail__name');
    const name = nameEl ? nameEl.textContent.trim() : document.title.split('｜')[0].replace(/レストラン空き状況確認|予約・購入|詳細/g, '').trim();
    const dateHid = document.querySelector('#reservationOfDateHid');
    const dateStr = dateHid ? ` [${dateHid.textContent.trim()}]` : '';
    return name + dateStr;
  }

  function sendDiscord(reasonText, isError = true) {
    if (!state.notifyEnabled) return;
    const now = Date.now();
    // エラー時は1分間のクールタイム
    if (isError && now - state.lastNotificationTime < 60000) return;
    
    const colorCode = isError ? 16711680 : 16776960;
    const emoji = isError ? "🚫" : "🔔";
    
    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: "レストラン一般再検索",
        embeds: [{
          title: `${emoji}${getRestaurantInfo()}`,
          description: reasonText,
          color: colorCode,
          timestamp: new Date().toISOString()
        }]
      })
    }).then(() => { if (isError) state.lastNotificationTime = Date.now(); }).catch(e => console.error(e));
  }

  // --- UI構築 ---
  const panels = {};
  function createPanel(top, bg, onClick) {
    const p = document.createElement('div');
    Object.assign(p.style, { position: 'fixed', top: `${top}px`, right: '10px', zIndex: '2147483647', padding: '8px 4px', borderRadius: '10px', fontSize: '11px', fontWeight: '600', cursor: 'pointer', background: bg, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', opacity: '0.9', textAlign: 'center', width: '75px' });
    p.onclick = onClick;
    document.body.appendChild(p);
    return p;
  }

  function updatePanels(isMaintenance = false) {
    if (isMaintenance) {
      panels.main.textContent = "Maint.";
      panels.main.style.background = "#888";
    } else {
      panels.main.textContent = state.searchStatus === 'OFF' ? 'OFF' : `${state.searchStatus} ${state.waitSec}`;
      const colors = { OFF: '#333', L: '#007bff', M: '#ff8c00', S: '#e83e8c' };
      panels.main.style.background = colors[state.searchStatus];
    }
    if (!state.autoF5) {
      panels.f5.style.background = '#333';
      panels.f5.textContent = 'F5 OFF';
    } else {
      const m = Math.floor(state.f5WaitSec / 60), s = state.f5WaitSec % 60;
      panels.f5.style.background = '#6f42c1';
      panels.f5.textContent = `F5 ${m}:${s.toString().padStart(2, '0')}`;
    }
  }

  panels.main = createPanel(10, '#333', () => {
    const nextStatus = { 'OFF': 'L', 'L': 'M', 'M': 'S', 'S': 'OFF' };
    state.searchStatus = nextStatus[state.searchStatus];
    localStorage.setItem('searchStatus', state.searchStatus);
    state.lastNotificationTime = 0; 
    setNextActionTime();
    updatePanels();
  });

  panels.open = createPanel(60, state.autoOpen ? '#28a745' : '#333', () => {
    state.autoOpen = !state.autoOpen;
    localStorage.setItem('autoOpenTimeTabs', state.autoOpen ? '1' : '0');
    panels.open.style.background = state.autoOpen ? '#28a745' : '#333';
    panels.open.textContent = state.autoOpen ? 'TAB ON' : 'TAB OFF';
  });
  panels.open.textContent = state.autoOpen ? 'TAB ON' : 'TAB OFF';

  panels.notify = createPanel(60, state.notifyEnabled ? '#ffc107' : '#333', () => {
    state.notifyEnabled = !state.notifyEnabled;
    localStorage.setItem('notifyEnabled', state.notifyEnabled ? '1' : '0');
    panels.notify.style.background = state.notifyEnabled ? '#ffc107' : '#333';
    panels.notify.style.color = state.notifyEnabled ? '#000' : '#fff';
    panels.notify.textContent = state.notifyEnabled ? '🔔 ON' : '🔕 OFF';
  });
  panels.notify.style.right = '90px';
  panels.notify.textContent = state.notifyEnabled ? '🔔 ON' : '🔕 OFF';
  panels.notify.style.color = state.notifyEnabled ? '#000' : '#fff';

  panels.f5 = createPanel(110, '#333', () => {
    state.autoF5 = !state.autoF5;
    localStorage.setItem('autoF520min', state.autoF5 ? '1' : '0');
    updatePanels();
  });

  // --- 機能ロジック ---
  function setNextActionTime() {
    if (state.searchStatus === 'OFF') return;
    const ranges = { S: [5, 6], M: [15, 11], L: [30, 11] };
    const r = ranges[state.searchStatus];
    state.waitSec = Math.floor(Math.random() * r[1]) + r[0];
    state.nextActionTime = Date.now() + (state.waitSec * 1000);
  }

  function openAllTimeSlots() {
    const targets = [...document.querySelectorAll('h1')].filter(h => /\d{1,2}:\d{2}/.test(h.textContent));
    targets.forEach((t, i) => setTimeout(() => t.click(), i * 250));
  }

  let debounceTimer;
  function addExclusionSwitchesDebounced() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      document.querySelectorAll('tr').forEach(row => {
        const th = row.querySelector('th');
        const tdState = row.querySelector('.state');
        if (!th || !tdState) return;
        
        const timeStr = th.innerText.trim();
        if (!/^\d{1,2}:\d{2}$/.test(timeStr)) return;
        if (tdState.querySelector('.ex-switch')) return;

        const isExcluded = state.excludedTimes.includes(timeStr);
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ex-switch';
        checkbox.checked = !isExcluded;
        checkbox.style.cssText = 'margin-left: 10px; transform: scale(1.1); vertical-align: middle; cursor: pointer; position: relative; z-index: 100;';
        tdState.style.whiteSpace = 'nowrap';
        
        checkbox.onclick = (e) => e.stopPropagation();
        checkbox.onchange = (e) => {
          if (!e.target.checked && !state.excludedTimes.includes(timeStr)) {
            state.excludedTimes.push(timeStr);
          } else if (e.target.checked) {
            state.excludedTimes = state.excludedTimes.filter(t => t !== timeStr);
          }
          localStorage.setItem('excludedTimes', JSON.stringify(state.excludedTimes));
        };
        tdState.appendChild(checkbox);
      });
    }, 200);
  }

  const observer = new MutationObserver(addExclusionSwitchesDebounced);
  observer.observe(document.body, { childList: true, subtree: true });

  // Ajax監視
  if (typeof $ !== "undefined") {
    $(document).on("ajaxSend", (event, xhr, settings) => {
      if (settings.url.includes("ajaxReservationOfDate")) {
        state.lastSearchStartTime = Date.now();
        state.isSearchPending = true;
      }
    });
    $(document).on("ajaxComplete", (event, xhr, settings) => {
      if (settings.url.includes("ajaxReservationOfDate")) {
        state.isSearchPending = false;
        
        // 403や500などのエラーステータスだった場合
        if (xhr.status !== 200) { 
          state.errorCount++;
          if (state.errorCount >= ERROR_THRESHOLD) {
            sendDiscord(`通信エラー連続${state.errorCount}回。制限中。`, true);
          }
          return; 
        }

        // 正常に通信できたらエラーカウントをリセット
        state.errorCount = 0;
        
        const responseHtml = xhr.responseText;
        if (!responseHtml) return;
        
        try {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = responseHtml;
          const availableSlots = [];
          tempDiv.querySelectorAll('tr').forEach(row => {
            if (row.querySelector('.state')?.textContent.includes('空席あり')) {
              const time = row.querySelector('th')?.textContent.trim();
              if (time && !state.excludedTimes.includes(time)) availableSlots.push(time);
            }
          });
          if (availableSlots.length > 0) sendDiscord(`空席発見：${availableSlots.join(', ')}`, false);
        } catch(e) {
          console.error("解析エラー:", e);
        }
      }
    });
    $(document).off("ajaxStop.restaurantReload").on("ajaxStop.restaurantReload", function() {
      if (state.autoOpen) setTimeout(openAllTimeSlots, 300);
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
      state.lastNotificationTime = 0;
    }).css('cursor', 'pointer');
  };
  
  const targetDisp = document.querySelector('#reservationOfDateDisp1');
  if (targetDisp) reloadSP($(targetDisp));
  document.querySelectorAll('section > div > h1:nth-child(1)').forEach(h => reloadSP($(h)));

  // --- メインループ ---
  updatePanels();
  setNextActionTime();

  setInterval(() => {
    const now = Date.now();
    const d = new Date();
    const secTotal = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

    if (secTotal >= 10795 && secTotal <= 18005) { 
      updatePanels(true); 
      return; 
    }

    if (state.searchStatus !== 'OFF' && state.isSearchPending && (now - state.lastSearchStartTime > 120000)) {
      sendDiscord("フリーズ：応答がありません。停止しました。", true); 
      state.searchStatus = 'OFF'; 
      updatePanels(); 
      return;
    }

    if (state.autoF5) { 
      state.f5WaitSec--; 
      updatePanels(); 
      if (state.f5WaitSec <= 0) location.reload(); 
    }

    if (state.searchStatus === 'OFF') return;

    state.waitSec = Math.ceil((state.nextActionTime - now) / 1000);
    updatePanels();

    if (now >= state.nextActionTime) {
      document.querySelector('#reservationOfDateDisp1')?.click();
      setNextActionTime();
    }
  }, 1000);

  const mark = document.createElement('div'); 
  mark.id = MARK_ID; 
  document.body.appendChild(mark);
})();
