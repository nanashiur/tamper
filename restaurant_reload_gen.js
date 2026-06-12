// ==UserScript==
// @name          🍴📱レストラン一般再検索
// @version      4.46
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const DISCORD_WEBHOOK_URL = window.TDR_WEBHOOKS?.restaurant || '';

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
    searchStatus: localStorage.getItem('searchStatus') || 'M',
    excludedTimes: JSON.parse(localStorage.getItem('excludedTimes') || '[]'),
    waitSec: 15,
    f5WaitSec: Math.floor(Math.random() * (1320 - 1080 + 1)) + 1080,
    lastClickedMealName: '',
    commodityMealMap: {}
  };

  const ERROR_THRESHOLD = 5;

  function getRestaurantInfo() {
    const nameEl = document.querySelector('.box04 .name, .p-restaurantDetail__name');
    const name = nameEl ? nameEl.textContent.trim() : document.title.split('｜')[0].replace(/レストラン空き状況確認|予約・購入|詳細/g, '').trim();
    const dateHid = document.querySelector('#reservationOfDateHid');
    const dateStr = dateHid ? ` [${dateHid.textContent.trim()}]` : '';
    return name + dateStr;
  }

  function getRestaurantName() {
    const nameEl = document.querySelector('.box04 .name, .p-restaurantDetail__name');
    return nameEl ? nameEl.textContent.trim() : document.title.split('｜')[0].replace(/レストラン空き状況確認|予約・購入|詳細/g, '').trim();
  }

  function getDisplayDate() {
    const dateEl = document.querySelector('#reservationOfDateDisp1');
    const raw = dateEl ? dateEl.textContent.trim() : '';
    return raw.replace(/\s*\((.)\)/, '（$1）');
  }

  function normalizeMealName(text) {
    const t = (text || '').replace(/\s+/g, '').trim();
    if (t.includes('朝食')) return '朝食';
    if (t.includes('昼食')) return '昼食';
    if (t.includes('夕食')) return '夕食';
    return '';
  }

  function refreshCommodityMealMap(root = document) {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('section').forEach(section => {
      const meal = normalizeMealName(section.querySelector('h1.hdg03, h1')?.textContent || '');
      if (!meal) return;
      section.querySelectorAll('.commodityCD').forEach(input => {
        const code = input.value?.trim();
        if (code) state.commodityMealMap[code] = meal;
      });
    });
  }

  function getCommodityFromRow(row) {
    const onclick = row.querySelector('a[onclick*="toOrderForDate"]')?.getAttribute('onclick') || '';
    const m = onclick.match(/toOrderForDate\(\s*["']toOrderForm["']\s*,\s*["']([^"']+)["']/);
    return m ? m[1] : '';
  }

  function getMealNameFromCommodity(commodity) {
    if (!commodity) return '';
    if (state.commodityMealMap[commodity]) return state.commodityMealMap[commodity];
    if (/^XXXRB/.test(commodity)) return '朝食';
    if (/^XXXRL/.test(commodity)) return '昼食';
    if (/^XXXRD/.test(commodity)) return '夕食';
    return '';
  }

  function getMealName(tempDiv) {
    const conditionRows = [...document.querySelectorAll('.conditionBox tr')];
    for (const row of conditionRows) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');
      if (th && td && th.textContent.includes('時間帯')) {
        const meal = normalizeMealName(td.textContent);
        if (meal) return meal;
      }
    }
    const mealVal = document.querySelector('input[name="mealDivInform"]')?.value?.trim();
    const mealFromValue = { '1': '朝食', '2': '昼食', '3': '夕食' }[mealVal];
    if (mealFromValue) return mealFromValue;
    const tempMealVal = tempDiv.querySelector('input[name="mealDivInform"]')?.value?.trim();
    const tempMealFromValue = { '1': '朝食', '2': '昼食', '3': '夕食' }[tempMealVal];
    if (tempMealFromValue) return tempMealFromValue;
    const h1s = [...tempDiv.querySelectorAll('h1.hdg03, h1')];
    for (const h1 of h1s) {
      const meal = normalizeMealName(h1.textContent);
      if (meal) return meal;
    }
    return '';
  }

  function getMealNameFromRow(row, tempDiv) {
    const commodity = getCommodityFromRow(row);
    const mealByCommodity = getMealNameFromCommodity(commodity);
    if (mealByCommodity) return mealByCommodity;
    const section = row.closest('section');
    if (section) {
      const h1 = section.querySelector('h1.hdg03, h1');
      const meal = normalizeMealName(h1?.textContent || '');
      if (meal) return meal;
    }
    const meal = getMealName(tempDiv);
    if (meal) return meal;
    return state.lastClickedMealName || '';
  }

  function getDetectDateTime() {
    const d = new Date();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}:${s}`;
  }

  function buildVacancyMessage(availableSlots, mealName) {
    const restaurantName = getRestaurantName();
    const displayDate = getDisplayDate();
    const lines = [
      `⏱️ 検知日時: ${getDetectDateTime()}`,
      `🏨 ${restaurantName}`,
      `📅 ${displayDate}${mealName ? ` 【${mealName}】` : ''}`
    ];
    availableSlots.forEach(time => lines.push(`⏰ ${time}`));
    return lines.join('\n');
  }

  function sendDiscord(reasonText, isError = true) {
    if (!state.notifyEnabled) return;
    if (!DISCORD_WEBHOOK_URL) return;
    const now = Date.now();
    if (isError && now - state.lastNotificationTime < 60000) return;

    const colorCode = isError ? 16711680 : 16776960;
    const emoji = isError ? "🚫" : "🔔";

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: "レストラン一般再検索",
        embeds: [{
          title: isError ? `${emoji}${getRestaurantInfo()}` : "🔔 空席発見！",
          description: reasonText,
          color: colorCode
        }]
      })
    }).then(() => { if (isError) state.lastNotificationTime = Date.now(); }).catch(e => console.error(e));
  }

  // --- UI構築 ---
  const panels = {};
  function createPanel(top, bg, onClick) {
    const p = document.createElement('div');
    Object.assign(p.style, { position: 'fixed', top: `${top}px`, right: '10px', zIndex: '2147483647', padding: '8px 0', borderRadius: '10px', fontSize: '15px', fontWeight: 'bold', cursor: 'pointer', background: bg, color: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', opacity: '0.9', textAlign: 'center', width: '66px', height: '34px', boxSizing: 'border-box' });
    p.onclick = onClick;
    document.body.appendChild(p);
    return p;
  }

  function updatePanels(isMaintenance = false) {
    if (isMaintenance) {
      panels.main.textContent = "休止";
      panels.main.style.background = "#888";
    } else {
      panels.main.textContent = state.searchStatus === 'OFF' ? 'OFF' : state.waitSec;
      const colors = { OFF: '#333', L: '#007bff', M: '#ff8c00', S: '#e83e8c' };
      panels.main.style.background = colors[state.searchStatus];
    }

    if (!state.autoF5) {
      panels.f5.style.background = '#333';
      panels.f5.textContent = 'OFF';
    } else {
      const m = Math.floor(state.f5WaitSec / 60), s = state.f5WaitSec % 60;
      panels.f5.style.background = '#6f42c1';
      panels.f5.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }

    panels.open.style.background = state.autoOpen ? '#28a745' : '#333';
    panels.open.textContent = '';

    panels.notify.style.background = state.notifyEnabled ? '#ffc107' : '#333';
    panels.notify.style.color = state.notifyEnabled ? '#000' : '#fff';
    panels.notify.textContent = state.notifyEnabled ? '🔔' : '🔕';

    if (panels.reset) {
      panels.reset.textContent = 'RESET';
      panels.reset.style.background = state.excludedTimes.length ? '#8e44ad' : '#000';
    }
  }

  function resetWaitSec() {
    if (state.searchStatus === 'OFF') return;
    const ranges = { S: [5, 6], M: [15, 11], L: [30, 11] };
    const r = ranges[state.searchStatus];
    state.waitSec = Math.floor(Math.random() * r[1]) + r[0];
  }

  panels.main = createPanel(10, '#333', () => {
    const nextStatus = { 'OFF': 'L', 'L': 'M', 'M': 'S', 'S': 'OFF' };
    state.searchStatus = nextStatus[state.searchStatus];
    localStorage.setItem('searchStatus', state.searchStatus);
    state.lastNotificationTime = 0;
    resetWaitSec();
    updatePanels();
  });

  panels.open = createPanel(50, '#333', () => {
    state.autoOpen = !state.autoOpen;
    localStorage.setItem('autoOpenTimeTabs', state.autoOpen ? '1' : '0');
    updatePanels();
    if (state.autoOpen) openAllTimeSlots(); // 手動でONにした瞬間に開く
  });

  panels.notify = createPanel(50, '#333', () => {
    state.notifyEnabled = !state.notifyEnabled;
    localStorage.setItem('notifyEnabled', state.notifyEnabled ? '1' : '0');
    updatePanels();
  });
  panels.notify.style.right = '84px';

  panels.f5 = createPanel(90, '#333', () => {
    state.autoF5 = !state.autoF5;
    localStorage.setItem('autoF520min', state.autoF5 ? '1' : '0');
    updatePanels();
  });

  panels.reset = createPanel(130, '#000', () => {
    state.excludedTimes = [];
    localStorage.setItem('excludedTimes', '[]');
    document.querySelectorAll('.ex-switch').forEach(cb => { cb.checked = true; });
    updatePanels();
  });
  panels.reset.textContent = 'RESET';

  // ★修正：閉じているタブのみを判定して開くロジック
  function openAllTimeSlots() {
    const sections = document.querySelectorAll('section.reservationTime');
    let delay = 0;
    sections.forEach(sec => {
      const h1 = sec.querySelector('h1');
      const contents = sec.querySelector('.contents');
      // contentsが見えない状態（＝閉じている）ならクリックして開く
      if (h1 && contents && contents.style.display === 'none') {
        setTimeout(() => h1.click(), delay * 200);
        delay++;
      }
    });
  }

  function disableClassName(elem, className, prefix = '') {
    $(elem).find(`${prefix}.${className}`).removeClass(className).addClass(`_${className}`);
  }

  function enableClassName(elem, className, prefix = '') {
    $(elem).find(`${prefix}._${className}`).removeClass(`_${className}`).addClass(className);
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
          updatePanels();
        };
        tdState.appendChild(checkbox);
      });
    }, 200);
  }

  const observer = new MutationObserver(addExclusionSwitchesDebounced);
  observer.observe(document.body, { childList: true, subtree: true });

  if (typeof $ !== "undefined") {
    $(document).on("ajaxSend", (event, xhr, settings) => {
      if (settings.url.includes("ajaxReservationOfDate")) {
        refreshCommodityMealMap(document);
        state.lastSearchStartTime = Date.now();
        state.isSearchPending = true;
      }
    });
    $(document).on("ajaxComplete", (event, xhr, settings) => {
      if (settings.url.includes("ajaxReservationOfDate")) {
        state.isSearchPending = false;

        if (xhr.status !== 200) {
          state.errorCount++;
          if (state.errorCount >= ERROR_THRESHOLD) {
            sendDiscord(`通信エラー連続${state.errorCount}回。制限中。`, true);
          }
          return;
        }

        state.errorCount = 0;

        const responseHtml = xhr.responseText;
        if (!responseHtml) return;

        try {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = responseHtml;
          refreshCommodityMealMap(document);
          refreshCommodityMealMap(tempDiv);
          const slotsByMeal = {};
          tempDiv.querySelectorAll('tr').forEach(row => {
            if (row.querySelector('.state')?.textContent.includes('空席あり')) {
              const time = row.querySelector('th')?.textContent.trim();
              if (time && !state.excludedTimes.includes(time)) {
                const meal = getMealNameFromRow(row, tempDiv);
                if (!slotsByMeal[meal]) slotsByMeal[meal] = [];
                if (!slotsByMeal[meal].includes(time)) slotsByMeal[meal].push(time);
              }
            }
          });
          Object.entries(slotsByMeal).forEach(([meal, slots]) => {
            if (slots.length > 0) sendDiscord(buildVacancyMessage(slots, meal), false);
          });
        } catch(e) {
          console.error("解析エラー:", e);
        }
      }
    });
    $(document).off("ajaxStop.restaurantReload").on("ajaxStop.restaurantReload", function() {
      if (state.autoOpen) setTimeout(openAllTimeSlots, 300);
    });
  }

  const reloadSP = (el, individual = false) => {
    $(el).on('click', (e) => {
      e.stopPropagation();
      state.lastClickedMealName = individual ? normalizeMealName($(el).text()) : '';
      refreshCommodityMealMap(document);
      const nextBtn = $('li.next button.nextDateLink');
      const prevBtn = $('li.prev button.preDateLink');
      if (prevBtn.attr('disabled') && nextBtn.attr('disabled')) return;

      const otherSections = $(el).closest('section').siblings('section');
      if (individual) {
        otherSections.each((idx, elem) => {
          disableClassName(elem, 'restaurantCalendarOfDate');
          disableClassName(elem, 'reservationTime');
          disableClassName(elem, 'hState', 'span');
        });
      }

      const cur = $("#reservationOfDateHid").html();
      const prev = $.datepicker.parseDate("yymmdd", cur, {}).addDays(-1);
      $("#reservationOfDateHid").html($.datepicker.formatDate("yymmdd", prev, {}));
      nextBtn.removeClass('hasNoData');
      changeReservationDate('next', nextBtn[0]);
      $.mobile.loading("hide");
      state.lastNotificationTime = 0;
      resetWaitSec();
      updatePanels();

      if (individual) {
        otherSections.each((idx, elem) => {
          enableClassName(elem, 'restaurantCalendarOfDate');
          enableClassName(elem, 'reservationTime');
          enableClassName(elem, 'hState', 'span');
        });
      }
    }).css('cursor', 'pointer');
  };

  const targetDisp = document.querySelector('#reservationOfDateDisp1');
  if (targetDisp) reloadSP($(targetDisp));
  document.querySelectorAll('section > div > h1:nth-child(1)').forEach(h => reloadSP($(h), true));

  // --- メインループ ---
  refreshCommodityMealMap(document);
  resetWaitSec();
  updatePanels();

  // 初期読み込み時にも確実にタブを開く
  if (state.autoOpen) setTimeout(openAllTimeSlots, 1000);

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

    state.waitSec--;
    updatePanels();

    if (state.waitSec <= 0) {
      document.querySelector('#reservationOfDateDisp1')?.click();
      resetWaitSec();
    }
  }, 1000);

  const mark = document.createElement('div');
  mark.id = MARK_ID;
  document.body.appendChild(mark);
})();
