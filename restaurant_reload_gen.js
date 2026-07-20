// ==UserScript==
// @name          🍴📱レストラン一般再検索
// @version      4.61
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const MARK_ID = '__restaurant_reload_running_v4';
  if (document.getElementById(MARK_ID)) return;

  const configuredWebhook = window.TDR_WEBHOOKS?.restaurant || '';
  if (configuredWebhook) {
    localStorage.setItem('restaurantDiscordWebhookCache', configuredWebhook);
  }

  const DISCORD_WEBHOOK_URL =
    configuredWebhook ||
    localStorage.getItem('restaurantDiscordWebhookCache') ||
    '';

  const ACCESS_DENIED_NOTIFY_COOLDOWN = 300000;
  const PUBLIC_IP_TIMEOUT = 4000;
  const AJAX_BATCH_SETTLE_MS = 500;
  const ERROR_RELOAD_NOTIFY_THRESHOLD = 3;

  function isAccessDeniedPage() {
    const title = document.title || '';
    const bodyText = document.body?.innerText || '';
    return (
      /Access Denied/i.test(title) ||
      /Access Denied/i.test(bodyText) ||
      /You don't have permission to access/i.test(bodyText) ||
      /Reference\s+#/i.test(bodyText)
    );
  }

  function getAccessDeniedReference() {
    const bodyText = document.body?.innerText || '';
    const match = bodyText.match(/Reference\s+#([^\s]+)/i);
    return match ? match[1] : '取得できませんでした';
  }

  async function getPublicIp() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUBLIC_IP_TIMEOUT);

    try {
      const response = await fetch('https://api.ipify.org?format=json', {
        cache: 'no-store',
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.ip || '取得失敗';
    } catch (e) {
      console.error('公開IP取得失敗:', e);
      return '取得失敗';
    } finally {
      clearTimeout(timer);
    }
  }

  function shouldNotifyAccessDenied(reference) {
    const now = Date.now();
    const lastTime = Number(
      localStorage.getItem('accessDeniedLastNotifyTime') || '0'
    );
    const lastReference =
      localStorage.getItem('accessDeniedLastReference') || '';
    const currentReference = reference || location.href;

    if (
      currentReference === lastReference &&
      now - lastTime < ACCESS_DENIED_NOTIFY_COOLDOWN
    ) {
      return false;
    }

    localStorage.setItem(
      'accessDeniedLastNotifyTime',
      String(now)
    );
    localStorage.setItem(
      'accessDeniedLastReference',
      currentReference
    );
    return true;
  }

  async function handleAccessDeniedPage() {
    const reference = getAccessDeniedReference();
    if (!DISCORD_WEBHOOK_URL) return;
    if (!shouldNotifyAccessDenied(reference)) return;

    const ip = await getPublicIp();
    const d = new Date();
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    const detectedAt =
      `${d.getMonth() + 1}/${d.getDate()} ${h}:${m}:${s}`;

    const errorReloadCount = Math.max(
      0,
      Number(localStorage.getItem('errorReloadCount')) || 0
    );

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        username: 'レストラン一般再検索',
        embeds: [{
          title: `🚫${detectedAt}`,
          description: [
            'Access Deniedを検出しました。',
            `🌐 公開IP：${ip}`,
            `📋 Reference：${reference}`,
            `🔢 エラーF5：${errorReloadCount}回`,
            `📍 URL：${location.href}`
          ].join('\n'),
          color: 16711680
        }]
      })
    }).catch(e => console.error(e));
  }

  if (isAccessDeniedPage()) {
    const mark = document.createElement('div');
    mark.id = MARK_ID;
    document.body?.appendChild(mark);
    handleAccessDeniedPage();
    return;
  }

  if (!document.querySelector('#reservationOfDateHid')) return;

  // 状態管理
  const state = {
    lastSearchStartTime: 0,
    isSearchPending: false,
    lastNotificationTime: 0,
    autoOpen:
      localStorage.getItem('autoOpenTimeTabs') !== '0',
    autoF5:
      localStorage.getItem('autoF520min') !== '0',
    autoReserve:
      localStorage.getItem('autoReserveClick') === '1',
    notifyEnabled:
      localStorage.getItem('notifyEnabled') !== '0',
    searchStatus:
      localStorage.getItem('searchStatus') || 'M',
    excludedTimes:
      JSON.parse(
        localStorage.getItem('excludedTimes') || '[]'
      ),
    autoReserveNotifyHistory:
      JSON.parse(
        localStorage.getItem(
          'autoReserveNotifyHistory'
        ) || '{}'
      ),
    waitSec: 15,
    f5WaitSec:
      Math.floor(
        Math.random() * (1320 - 1080 + 1)
      ) + 1080,
    lastClickedMealName: '',
    commodityMealMap: {},
    autoReserveLockUntil: 0,
    errorReloadCount: Math.max(
      0,
      Number(
        localStorage.getItem('errorReloadCount')
      ) || 0
    ),
    errorReloadScheduled: false,
    ajaxPendingCount: 0,
    ajaxStatuses: [],
    ajaxBatchFinalizeTimer: null
  };

  const AUTO_RESERVE_NOTIFY_COOLDOWN = 30000;

  function getRestaurantInfo() {
    const nameEl = document.querySelector(
      '.box04 .name, .p-restaurantDetail__name'
    );

    const name = nameEl
      ? nameEl.textContent.trim()
      : document.title
          .split('｜')[0]
          .replace(
            /レストラン空き状況確認|予約・購入|詳細/g,
            ''
          )
          .trim();

    const dateHid =
      document.querySelector('#reservationOfDateHid');

    const dateStr = dateHid
      ? ` [${dateHid.textContent.trim()}]`
      : '';

    return name + dateStr;
  }

  function getRestaurantName() {
    const nameEl = document.querySelector(
      '.box04 .name, .p-restaurantDetail__name'
    );

    return nameEl
      ? nameEl.textContent.trim()
      : document.title
          .split('｜')[0]
          .replace(
            /レストラン空き状況確認|予約・購入|詳細/g,
            ''
          )
          .trim();
  }

  function getDisplayDate() {
    const dateEl =
      document.querySelector('#reservationOfDateDisp1');

    const raw = dateEl
      ? dateEl.textContent.trim()
      : '';

    return raw.replace(/\s*\((.)\)/, '（$1）');
  }

  function normalizeMealName(text) {
    const t = (text || '')
      .replace(/\s+/g, '')
      .trim();

    if (t.includes('朝食')) return '朝食';
    if (t.includes('昼食')) return '昼食';
    if (t.includes('夕食')) return '夕食';

    return '';
  }

  function refreshCommodityMealMap(root = document) {
    if (!root || !root.querySelectorAll) return;

    root.querySelectorAll('section').forEach(section => {
      const meal = normalizeMealName(
        section.querySelector(
          'h1.hdg03, h1'
        )?.textContent || ''
      );

      if (!meal) return;

      section
        .querySelectorAll('.commodityCD')
        .forEach(input => {
          const code = input.value?.trim();

          if (code) {
            state.commodityMealMap[code] = meal;
          }
        });
    });
  }

  function getCommodityFromRow(row) {
    const onclick =
      row
        .querySelector(
          'a[onclick*="toOrderForDate"]'
        )
        ?.getAttribute('onclick') || '';

    const m = onclick.match(
      /toOrderForDate\(\s*["']toOrderForm["']\s*,\s*["']([^"']+)["']/
    );

    return m ? m[1] : '';
  }

  function getMealNameFromCommodity(commodity) {
    if (!commodity) return '';

    if (state.commodityMealMap[commodity]) {
      return state.commodityMealMap[commodity];
    }

    if (/^XXXRB/.test(commodity)) return '朝食';
    if (/^XXXRL/.test(commodity)) return '昼食';
    if (/^XXXRD/.test(commodity)) return '夕食';

    return '';
  }

  function getMealName(tempDiv) {
    const conditionRows = [
      ...document.querySelectorAll(
        '.conditionBox tr'
      )
    ];

    for (const row of conditionRows) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');

      if (
        th &&
        td &&
        th.textContent.includes('時間帯')
      ) {
        const meal =
          normalizeMealName(td.textContent);

        if (meal) return meal;
      }
    }

    const mealVal =
      document
        .querySelector(
          'input[name="mealDivInform"]'
        )
        ?.value?.trim();

    const mealFromValue = {
      '1': '朝食',
      '2': '昼食',
      '3': '夕食'
    }[mealVal];

    if (mealFromValue) return mealFromValue;

    const tempMealVal =
      tempDiv
        .querySelector(
          'input[name="mealDivInform"]'
        )
        ?.value?.trim();

    const tempMealFromValue = {
      '1': '朝食',
      '2': '昼食',
      '3': '夕食'
    }[tempMealVal];

    if (tempMealFromValue) {
      return tempMealFromValue;
    }

    const h1s = [
      ...tempDiv.querySelectorAll(
        'h1.hdg03, h1'
      )
    ];

    for (const h1 of h1s) {
      const meal =
        normalizeMealName(h1.textContent);

      if (meal) return meal;
    }

    return '';
  }

  function getMealNameFromRow(row, tempDiv) {
    const commodity =
      getCommodityFromRow(row);

    const mealByCommodity =
      getMealNameFromCommodity(commodity);

    if (mealByCommodity) {
      return mealByCommodity;
    }

    const section = row.closest('section');

    if (section) {
      const h1 =
        section.querySelector(
          'h1.hdg03, h1'
        );

      const meal = normalizeMealName(
        h1?.textContent || ''
      );

      if (meal) return meal;
    }

    const meal = getMealName(tempDiv);

    if (meal) return meal;

    return state.lastClickedMealName || '';
  }

  function getDetectDateTime() {
    const d = new Date();
    const h =
      d.getHours()
        .toString()
        .padStart(2, '0');

    const m =
      d.getMinutes()
        .toString()
        .padStart(2, '0');

    const s =
      d.getSeconds()
        .toString()
        .padStart(2, '0');

    return (
      `${d.getMonth() + 1}/` +
      `${d.getDate()} ` +
      `${h}:${m}:${s}`
    );
  }

  function formatSlotLines(availableSlots) {
    const groups = {};

    availableSlots.forEach(time => {
      const hour = time.split(':')[0];

      if (!groups[hour]) {
        groups[hour] = [];
      }

      groups[hour].push(time);
    });

    return Object.keys(groups)
      .sort(
        (a, b) =>
          Number(a) - Number(b)
      )
      .map(
        hour =>
          `⏰ ${groups[hour].join(' ')}`
      );
  }

  function buildVacancyMessage(
    availableSlots,
    mealName
  ) {
    const restaurantName =
      getRestaurantName();

    const displayDate =
      getDisplayDate();

    const lines = [
      `🍴 ${restaurantName}`,
      `📅 ${displayDate}${
        mealName
          ? ` 【${mealName}】`
          : ''
      }`
    ];

    lines.push(
      ...formatSlotLines(availableSlots)
    );

    return lines.join('\n');
  }

  function buildAutoReserveMessage(
    time,
    mealName
  ) {
    const restaurantName =
      getRestaurantName();

    const displayDate =
      getDisplayDate();

    return [
      `🍴 ${restaurantName}`,
      `📅 ${displayDate}${
        mealName
          ? ` 【${mealName}】`
          : ''
      }`,
      '🖱️ 自動予約クリック試行',
      `⏰ ${time}`
    ].join('\n');
  }

  function shouldNotifyAutoReserve(
    time,
    mealName
  ) {
    const now = Date.now();

    const key =
      `${getRestaurantName()}|` +
      `${getDisplayDate()}|` +
      `${mealName || ''}|` +
      `${time}`;

    Object.keys(
      state.autoReserveNotifyHistory
    ).forEach(k => {
      if (
        now -
          state.autoReserveNotifyHistory[k] >
        AUTO_RESERVE_NOTIFY_COOLDOWN
      ) {
        delete state
          .autoReserveNotifyHistory[k];
      }
    });

    const last =
      state.autoReserveNotifyHistory[key] ||
      0;

    if (
      now - last <=
      AUTO_RESERVE_NOTIFY_COOLDOWN
    ) {
      localStorage.setItem(
        'autoReserveNotifyHistory',
        JSON.stringify(
          state.autoReserveNotifyHistory
        )
      );

      return false;
    }

    state.autoReserveNotifyHistory[key] =
      now;

    localStorage.setItem(
      'autoReserveNotifyHistory',
      JSON.stringify(
        state.autoReserveNotifyHistory
      )
    );

    return true;
  }

  function sendDiscord(
    reasonText,
    isError = true
  ) {
    if (!state.notifyEnabled) return;
    if (!DISCORD_WEBHOOK_URL) return;

    const now = Date.now();

    if (
      isError &&
      now - state.lastNotificationTime <
        60000
    ) {
      return;
    }

    const colorCode =
      isError ? 16711680 : 16776960;

    const emoji =
      isError ? '🚫' : '🔔';

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username:
          'レストラン一般再検索',
        embeds: [{
          title: isError
            ? `${emoji}${getRestaurantInfo()}`
            : `🔔${getDetectDateTime()}`,
          description: reasonText,
          color: colorCode
        }]
      })
    })
      .then(() => {
        if (isError) {
          state.lastNotificationTime =
            Date.now();
        }
      })
      .catch(e => console.error(e));
  }

  function sendAutoReserveDiscord(
    time,
    mealName
  ) {
    // 自動予約通知は通常通知ON/OFFを見ない
    if (!DISCORD_WEBHOOK_URL) return;

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      keepalive: true,
      body: JSON.stringify({
        username:
          'レストラン一般再検索',
        embeds: [{
          title:
            `✅${getDetectDateTime()}`,
          description:
            buildAutoReserveMessage(
              time,
              mealName
            ),
          color: 5763719
        }]
      })
    }).catch(e => console.error(e));
  }

  function resetErrorReloadCount() {
    if (
      state.errorReloadCount === 0
    ) {
      return;
    }

    state.errorReloadCount = 0;

    localStorage.setItem(
      'errorReloadCount',
      '0'
    );
  }

  function formatErrorStatuses(statuses) {
    return [...new Set(statuses)]
      .map(status => {
        return status === 0
          ? '通信エラー 0'
          : `HTTP ${status}`;
      })
      .join(' / ');
  }

  async function sendErrorReloadLimitDiscord(
    statuses,
    errorReloadCount
  ) {
    if (!DISCORD_WEBHOOK_URL) return;

    const ip = await getPublicIp();

    const errorText =
      formatErrorStatuses(statuses);

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      keepalive: true,
      body: JSON.stringify({
        username:
          'レストラン一般再検索',
        embeds: [{
          title:
            `🚫${getDetectDateTime()}`,
          description: [
            `通信エラーによるF5再読み込みが${errorReloadCount}回目に達しました。`,
            `🍴 ${getRestaurantName()}`,
            `📅 ${getDisplayDate()}`,
            `⚠️ エラー：${errorText}`,
            `🔢 エラーF5：${errorReloadCount}回目`,
            `🌐 公開IP：${ip}`
          ].join('\n'),
          color: 16711680
        }]
      })
    }).catch(e => console.error(e));
  }

  function scheduleErrorReload(
    statuses,
    countAsError = true
  ) {
    if (state.errorReloadScheduled) {
      return;
    }

    state.errorReloadScheduled = true;

    if (countAsError) {
      state.errorReloadCount++;

      localStorage.setItem(
        'errorReloadCount',
        String(state.errorReloadCount)
      );
    }

    const uniqueStatuses = [
      ...new Set(statuses)
    ];

    const errorText =
      formatErrorStatuses(
        uniqueStatuses
      );

    const popupId =
      '__restaurant_error_popup';

    let popup =
      document.getElementById(popupId);

    if (!popup) {
      popup =
        document.createElement('div');

      popup.id = popupId;

      Object.assign(popup.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform:
          'translate(-50%, -50%)',
        zIndex: '2147483647',
        minWidth: '280px',
        padding: '24px 30px',
        borderRadius: '14px',
        background: '#dc3545',
        color: '#fff',
        boxShadow:
          '0 4px 20px rgba(0,0,0,0.45)',
        fontSize: '22px',
        fontWeight: 'bold',
        lineHeight: '1.6',
        textAlign: 'center',
        pointerEvents: 'none'
      });

      document.body.appendChild(popup);
    }

    popup.innerHTML = countAsError
      ? [
          `🚫 ${errorText} エラー`,
          `エラーリロード ${state.errorReloadCount}回目`,
          '10秒後に再読み込みします'
        ].join('<br>')
      : [
          `🚫 ${errorText} エラー`,
          'AJAX 200混在のためカウントをリセット',
          'エラーカウント 0回',
          '10秒後に再読み込みします'
        ].join('<br>');

    if (
      countAsError &&
      state.errorReloadCount >=
        ERROR_RELOAD_NOTIFY_THRESHOLD
    ) {
      sendErrorReloadLimitDiscord(
        uniqueStatuses,
        state.errorReloadCount
      );
    }

    setTimeout(() => {
      location.reload();
    }, 10000);
  }

  function finalizeAjaxBatch() {
    state.ajaxBatchFinalizeTimer = null;

    if (
      state.ajaxPendingCount > 0
    ) {
      return;
    }

    const statuses =
      state.ajaxStatuses.slice();

    state.ajaxStatuses = [];
    state.isSearchPending = false;

    if (statuses.length === 0) {
      return;
    }

    const hasSuccess =
      statuses.includes(200);

    const errorStatuses =
      statuses.filter(
        status => status !== 200
      );

    if (hasSuccess) {
      resetErrorReloadCount();
    }

    if (errorStatuses.length > 0) {
      scheduleErrorReload(
        errorStatuses,
        !hasSuccess
      );
    }
  }

  function scheduleAjaxBatchFinalize() {
    clearTimeout(
      state.ajaxBatchFinalizeTimer
    );

    state.ajaxBatchFinalizeTimer =
      setTimeout(
        finalizeAjaxBatch,
        AJAX_BATCH_SETTLE_MS
      );
  }

  function isVisible(el) {
    return !!(
      el &&
      (
        el.offsetWidth ||
        el.offsetHeight ||
        el.getClientRects().length
      )
    );
  }

  function clickConsentNext(
    dialog,
    attempt = 0
  ) {
    const nextBtn =
      dialog.querySelector('#btnNext') ||
      [
        ...dialog.querySelectorAll(
          'button, a, ' +
          'input[type="button"], ' +
          'input[type="submit"]'
        )
      ].find(el => {
        const text =
          (
            el.textContent ||
            el.value ||
            ''
          )
            .replace(/\s+/g, '')
            .trim();

        return text.includes('次へ');
      });

    if (!nextBtn) return;

    const disabled =
      nextBtn.disabled ||
      nextBtn.getAttribute(
        'disabled'
      ) !== null ||
      nextBtn.classList.contains(
        'nextDisabled'
      ) ||
      nextBtn.classList.contains(
        'ui-disabled'
      ) ||
      nextBtn.closest('.ui-disabled');

    if (!disabled) {
      nextBtn.click();
      return;
    }

    const checkbox =
      dialog.querySelector('#accept') ||
      dialog.querySelector(
        'input[type="checkbox"]'
      );

    if (
      checkbox?.checked &&
      attempt >= 10
    ) {
      nextBtn.disabled = false;
      nextBtn.removeAttribute(
        'disabled'
      );

      nextBtn.classList.remove(
        'nextDisabled',
        'ui-disabled'
      );

      nextBtn.click();
      return;
    }

    if (attempt < 30) {
      setTimeout(
        () =>
          clickConsentNext(
            dialog,
            attempt + 1
          ),
        100
      );
    }
  }

  function handleConsentDialog(
    attempt = 0
  ) {
    const dialog =
      document.querySelector(
        '#noticeMessage'
      ) ||
      [
        ...document.querySelectorAll(
          '.ui-dialog, ' +
          '.ui-popup, ' +
          '[role="dialog"], ' +
          '[data-role="dialog"], ' +
          '#jqmDialog'
        )
      ].find(el => {
        const text =
          (el.textContent || '')
            .replace(/\s+/g, '');

        return (
          isVisible(el) &&
          text.includes('同意する') &&
          text.includes('次へ')
        );
      });

    if (
      !dialog ||
      !isVisible(dialog)
    ) {
      if (attempt < 30) {
        setTimeout(
          () =>
            handleConsentDialog(
              attempt + 1
            ),
          100
        );
      }

      return;
    }

    const checkbox =
      dialog.querySelector('#accept') ||
      dialog.querySelector(
        'input[type="checkbox"]'
      );

    const label =
      dialog.querySelector(
        'label[for="accept"]'
      ) ||
      [
        ...dialog.querySelectorAll(
          'label'
        )
      ].find(el =>
        (el.textContent || '')
          .includes('同意する')
      );

    if (
      checkbox &&
      !checkbox.checked
    ) {
      if (label) {
        label.click();
      } else {
        checkbox.click();
      }

      checkbox.checked = true;

      checkbox.setAttribute(
        'checked',
        'checked'
      );

      checkbox.dispatchEvent(
        new Event(
          'input',
          { bubbles: true }
        )
      );

      checkbox.dispatchEvent(
        new Event(
          'change',
          { bubbles: true }
        )
      );

      if (window.jQuery) {
        try {
          const $cb =
            jQuery(checkbox);

          $cb.prop(
            'checked',
            true
          );

          if ($cb.checkboxradio) {
            $cb.checkboxradio(
              'refresh'
            );
          }

          $cb.trigger('change');
        } catch (e) {
          console.error(e);
        }
      }
    }

    setTimeout(
      () => clickConsentNext(dialog),
      200
    );
  }

  function tryAutoReserveClick(
    attempt = 0
  ) {
    if (!state.autoReserve) return;

    if (
      Date.now() <
      state.autoReserveLockUntil
    ) {
      return;
    }

    refreshCommodityMealMap(document);

    const rows = [
      ...document.querySelectorAll(
        'section.reservationTime tr'
      )
    ];

    for (const row of rows) {
      const stateText =
        row.querySelector(
          '.state'
        )?.textContent || '';

      const time =
        row.querySelector(
          'th'
        )?.textContent.trim();

      const link =
        row.querySelector(
          'td.btn ' +
          'a[onclick*="toOrderForDate"]'
        );

      if (
        !stateText.includes(
          '空席あり'
        ) ||
        !time ||
        state.excludedTimes.includes(
          time
        ) ||
        !link
      ) {
        continue;
      }

      state.autoReserveLockUntil =
        Date.now() + 3000;

      const meal =
        getMealNameFromRow(
          row,
          document
        );

      const notify =
        shouldNotifyAutoReserve(
          time,
          meal
        );

      if (notify) {
        sendAutoReserveDiscord(
          time,
          meal
        );
      }

      setTimeout(() => {
        link.click();

        setTimeout(
          () =>
            handleConsentDialog(),
          150
        );
      }, notify ? 80 : 0);

      return;
    }

    if (attempt < 5) {
      setTimeout(
        () =>
          tryAutoReserveClick(
            attempt + 1
          ),
        100
      );
    }
  }

  // --- UI構築 ---
  const panels = {};

  function createPanel(
    top,
    bg,
    onClick
  ) {
    const p =
      document.createElement('div');

    Object.assign(p.style, {
      position: 'fixed',
      top: `${top}px`,
      right: '10px',
      zIndex: '2147483647',
      padding: '8px 0',
      borderRadius: '10px',
      fontSize: '15px',
      fontWeight: 'bold',
      cursor: 'pointer',
      background: bg,
      color: '#fff',
      boxShadow:
        '0 2px 8px rgba(0,0,0,0.3)',
      opacity: '0.9',
      textAlign: 'center',
      width: '66px',
      height: '34px',
      boxSizing: 'border-box'
    });

    p.onclick = onClick;

    document.body.appendChild(p);

    return p;
  }

  function updatePanels(
    isMaintenance = false
  ) {
    if (isMaintenance) {
      panels.main.textContent =
        '休止';

      panels.main.style.background =
        '#888';
    } else {
      panels.main.textContent =
        state.searchStatus === 'OFF'
          ? 'OFF'
          : state.waitSec;

      const colors = {
        OFF: '#333',
        L: '#007bff',
        M: '#ff8c00',
        S: '#e83e8c'
      };

      panels.main.style.background =
        colors[state.searchStatus];
    }

    if (!state.autoF5) {
      panels.f5.style.background =
        '#333';

      panels.f5.textContent = 'OFF';
    } else {
      const m =
        Math.floor(
          state.f5WaitSec / 60
        );

      const s =
        state.f5WaitSec % 60;

      panels.f5.style.background =
        '#6f42c1';

      panels.f5.textContent =
        `${m}:` +
        `${s
          .toString()
          .padStart(2, '0')}`;
    }

    panels.open.style.background =
      state.autoOpen
        ? '#28a745'
        : '#333';

    panels.open.textContent = 'TAB';

    panels.reserve.style.background =
      state.autoReserve
        ? '#dc3545'
        : '#333';

    panels.reserve.textContent = '👆️';

    panels.notify.style.background =
      state.notifyEnabled
        ? '#ffc107'
        : '#333';

    panels.notify.style.color =
      state.notifyEnabled
        ? '#000'
        : '#fff';

    panels.notify.textContent =
      state.notifyEnabled
        ? '🔔'
        : '🔕';

    if (panels.reset) {
      panels.reset.textContent =
        'リセット';

      panels.reset.style.background =
        state.excludedTimes.length
          ? '#8e44ad'
          : '#000';
    }
  }

  function resetWaitSec() {
    if (
      state.searchStatus === 'OFF'
    ) {
      return;
    }

    const ranges = {
      S: [5, 6],
      M: [15, 11],
      L: [30, 11]
    };

    const r =
      ranges[state.searchStatus];

    state.waitSec =
      Math.floor(
        Math.random() * r[1]
      ) + r[0];
  }

  panels.main = createPanel(
    10,
    '#333',
    () => {
      const nextStatus = {
        OFF: 'L',
        L: 'M',
        M: 'S',
        S: 'OFF'
      };

      state.searchStatus =
        nextStatus[
          state.searchStatus
        ];

      localStorage.setItem(
        'searchStatus',
        state.searchStatus
      );

      state.lastNotificationTime = 0;

      resetWaitSec();
      updatePanels();
    }
  );

  panels.notify = createPanel(
    50,
    '#333',
    () => {
      state.notifyEnabled =
        !state.notifyEnabled;

      localStorage.setItem(
        'notifyEnabled',
        state.notifyEnabled
          ? '1'
          : '0'
      );

      updatePanels();
    }
  );

  panels.reset = createPanel(
    90,
    '#000',
    () => {
      state.excludedTimes = [];

      localStorage.setItem(
        'excludedTimes',
        '[]'
      );

      document
        .querySelectorAll(
          '.ex-switch'
        )
        .forEach(cb => {
          cb.checked = true;
        });

      updatePanels();
    }
  );

  panels.reset.textContent =
    'リセット';

  panels.f5 = createPanel(
    10,
    '#333',
    () => {
      state.autoF5 =
        !state.autoF5;

      localStorage.setItem(
        'autoF520min',
        state.autoF5
          ? '1'
          : '0'
      );

      updatePanels();
    }
  );

  panels.f5.style.right = '84px';

  panels.open = createPanel(
    50,
    '#333',
    () => {
      state.autoOpen =
        !state.autoOpen;

      localStorage.setItem(
        'autoOpenTimeTabs',
        state.autoOpen
          ? '1'
          : '0'
      );

      updatePanels();

      if (state.autoOpen) {
        openAllTimeSlots();
      }
    }
  );

  panels.open.style.right = '84px';
  panels.open.textContent = 'TAB';

  panels.reserve = createPanel(
    90,
    '#333',
    () => {
      state.autoReserve =
        !state.autoReserve;

      localStorage.setItem(
        'autoReserveClick',
        state.autoReserve
          ? '1'
          : '0'
      );

      updatePanels();
    }
  );

  panels.reserve.style.right = '84px';
  panels.reserve.textContent = '👆️';

  function openAllTimeSlots() {
    const sections =
      document.querySelectorAll(
        'section.reservationTime'
      );

    let delay = 0;

    sections.forEach(sec => {
      const h1 =
        sec.querySelector('h1');

      const contents =
        sec.querySelector(
          '.contents'
        );

      if (
        h1 &&
        contents &&
        contents.style.display ===
          'none'
      ) {
        setTimeout(
          () => h1.click(),
          delay * 200
        );

        delay++;
      }
    });
  }

  function disableClassName(
    elem,
    className,
    prefix = ''
  ) {
    $(elem)
      .find(
        `${prefix}.${className}`
      )
      .removeClass(className)
      .addClass(`_${className}`);
  }

  function enableClassName(
    elem,
    className,
    prefix = ''
  ) {
    $(elem)
      .find(
        `${prefix}._${className}`
      )
      .removeClass(
        `_${className}`
      )
      .addClass(className);
  }

  let debounceTimer;

  function addExclusionSwitchesDebounced() {
    clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      document
        .querySelectorAll('tr')
        .forEach(row => {
          const th =
            row.querySelector('th');

          const tdState =
            row.querySelector(
              '.state'
            );

          if (!th || !tdState) {
            return;
          }

          const timeStr =
            th.innerText.trim();

          if (
            !/^\d{1,2}:\d{2}$/.test(
              timeStr
            )
          ) {
            return;
          }

          if (
            tdState.querySelector(
              '.ex-switch'
            )
          ) {
            return;
          }

          const isExcluded =
            state.excludedTimes.includes(
              timeStr
            );

          const checkbox =
            document.createElement(
              'input'
            );

          checkbox.type =
            'checkbox';

          checkbox.className =
            'ex-switch';

          checkbox.checked =
            !isExcluded;

          checkbox.style.cssText =
            'margin-left: 10px; ' +
            'transform: scale(1.1); ' +
            'vertical-align: middle; ' +
            'cursor: pointer; ' +
            'position: relative; ' +
            'z-index: 100;';

          tdState.style.whiteSpace =
            'nowrap';

          checkbox.onclick = e =>
            e.stopPropagation();

          checkbox.onchange = e => {
            if (
              !e.target.checked &&
              !state.excludedTimes.includes(
                timeStr
              )
            ) {
              state.excludedTimes.push(
                timeStr
              );
            } else if (
              e.target.checked
            ) {
              state.excludedTimes =
                state.excludedTimes.filter(
                  t => t !== timeStr
                );
            }

            localStorage.setItem(
              'excludedTimes',
              JSON.stringify(
                state.excludedTimes
              )
            );

            updatePanels();
          };

          tdState.appendChild(
            checkbox
          );
        });
    }, 200);
  }

  const observer =
    new MutationObserver(
      addExclusionSwitchesDebounced
    );

  observer.observe(
    document.body,
    {
      childList: true,
      subtree: true
    }
  );

  if (typeof $ !== 'undefined') {
    $(document).on(
      'ajaxSend',
      (
        event,
        xhr,
        settings
      ) => {
        if (
          settings.url.includes(
            'ajaxReservationOfDate'
          )
        ) {
          refreshCommodityMealMap(
            document
          );

          if (
            state.ajaxBatchFinalizeTimer
          ) {
            clearTimeout(
              state.ajaxBatchFinalizeTimer
            );

            state.ajaxBatchFinalizeTimer =
              null;
          }

          if (
            state.ajaxPendingCount === 0 &&
            state.ajaxStatuses.length === 0
          ) {
            state.lastSearchStartTime =
              Date.now();
          }

          state.ajaxPendingCount++;
          state.isSearchPending = true;
        }
      }
    );

    $(document).on(
      'ajaxComplete',
      (
        event,
        xhr,
        settings
      ) => {
        if (
          settings.url.includes(
            'ajaxReservationOfDate'
          )
        ) {
          state.ajaxStatuses.push(
            xhr.status
          );

          state.ajaxPendingCount =
            Math.max(
              0,
              state.ajaxPendingCount - 1
            );

          if (
            state.ajaxPendingCount === 0
          ) {
            scheduleAjaxBatchFinalize();
          }

          if (xhr.status !== 200) {
            return;
          }

          const responseHtml =
            xhr.responseText;

          if (!responseHtml) return;

          try {
            const tempDiv =
              document.createElement(
                'div'
              );

            tempDiv.innerHTML =
              responseHtml;

            refreshCommodityMealMap(
              document
            );

            refreshCommodityMealMap(
              tempDiv
            );

            const slotsByMeal = {};

            tempDiv
              .querySelectorAll('tr')
              .forEach(row => {
                const hasVacancy =
                  row
                    .querySelector(
                      '.state'
                    )
                    ?.textContent
                    .includes(
                      '空席あり'
                    );

                if (!hasVacancy) {
                  return;
                }

                const time =
                  row
                    .querySelector(
                      'th'
                    )
                    ?.textContent
                    .trim();

                if (
                  !time ||
                  state.excludedTimes.includes(
                    time
                  )
                ) {
                  return;
                }

                const meal =
                  getMealNameFromRow(
                    row,
                    tempDiv
                  );

                if (
                  !slotsByMeal[meal]
                ) {
                  slotsByMeal[meal] = [];
                }

                if (
                  !slotsByMeal[
                    meal
                  ].includes(time)
                ) {
                  slotsByMeal[
                    meal
                  ].push(time);
                }
              });

            const hasVacancy =
              Object.values(
                slotsByMeal
              ).some(
                slots =>
                  slots.length > 0
              );

            if (hasVacancy) {
              Object.entries(
                slotsByMeal
              ).forEach(
                ([meal, slots]) => {
                  if (
                    slots.length > 0
                  ) {
                    sendDiscord(
                      buildVacancyMessage(
                        slots,
                        meal
                      ),
                      false
                    );
                  }
                }
              );

              if (
                state.autoReserve
              ) {
                setTimeout(
                  () =>
                    tryAutoReserveClick(),
                  0
                );
              }
            }
          } catch (e) {
            console.error(
              '解析エラー:',
              e
            );
          }
        }
      }
    );

    $(document)
      .off(
        'ajaxStop.restaurantReload'
      )
      .on(
        'ajaxStop.restaurantReload',
        function () {
          if (state.autoOpen) {
            setTimeout(
              openAllTimeSlots,
              300
            );
          }
        }
      );
  }

  const reloadSP = (
    el,
    individual = false
  ) => {
    $(el)
      .on('click', e => {
        e.stopPropagation();

        state.lastClickedMealName =
          individual
            ? normalizeMealName(
                $(el).text()
              )
            : '';

        refreshCommodityMealMap(
          document
        );

        const nextBtn =
          $(
            'li.next ' +
            'button.nextDateLink'
          );

        const prevBtn =
          $(
            'li.prev ' +
            'button.preDateLink'
          );

        if (
          prevBtn.attr('disabled') &&
          nextBtn.attr('disabled')
        ) {
          return;
        }

        const otherSections =
          $(el)
            .closest('section')
            .siblings('section');

        if (individual) {
          otherSections.each(
            (idx, elem) => {
              disableClassName(
                elem,
                'restaurantCalendarOfDate'
              );

              disableClassName(
                elem,
                'reservationTime'
              );

              disableClassName(
                elem,
                'hState',
                'span'
              );
            }
          );
        }

        const cur =
          $('#reservationOfDateHid')
            .html();

        const prev =
          $.datepicker
            .parseDate(
              'yymmdd',
              cur,
              {}
            )
            .addDays(-1);

        $('#reservationOfDateHid')
          .html(
            $.datepicker.formatDate(
              'yymmdd',
              prev,
              {}
            )
          );

        nextBtn.removeClass(
          'hasNoData'
        );

        changeReservationDate(
          'next',
          nextBtn[0]
        );

        $.mobile.loading('hide');

        state.lastNotificationTime = 0;

        resetWaitSec();
        updatePanels();

        if (individual) {
          otherSections.each(
            (idx, elem) => {
              enableClassName(
                elem,
                'restaurantCalendarOfDate'
              );

              enableClassName(
                elem,
                'reservationTime'
              );

              enableClassName(
                elem,
                'hState',
                'span'
              );
            }
          );
        }
      })
      .css(
        'cursor',
        'pointer'
      );
  };

  const targetDisp =
    document.querySelector(
      '#reservationOfDateDisp1'
    );

  if (targetDisp) {
    reloadSP($(targetDisp));
  }

  document
    .querySelectorAll(
      'section > div > ' +
      'h1:nth-child(1)'
    )
    .forEach(h => {
      reloadSP($(h), true);
    });

  refreshCommodityMealMap(
    document
  );

  resetWaitSec();
  updatePanels();

  if (state.autoOpen) {
    setTimeout(
      openAllTimeSlots,
      1000
    );
  }

  setInterval(() => {
    const now = Date.now();
    const d = new Date();

    const secTotal =
      d.getHours() * 3600 +
      d.getMinutes() * 60 +
      d.getSeconds();

    if (
      state.errorReloadScheduled
    ) {
      return;
    }

    if (
      secTotal >= 10795 &&
      secTotal <= 18005
    ) {
      updatePanels(true);
      return;
    }

    if (
      state.searchStatus !== 'OFF' &&
      state.isSearchPending &&
      now -
        state.lastSearchStartTime >
        120000
    ) {
      sendDiscord(
        'フリーズ：応答がありません。停止しました。',
        true
      );

      state.searchStatus = 'OFF';

      updatePanels();
      return;
    }

    if (state.autoF5) {
      state.f5WaitSec--;

      updatePanels();

      if (
        state.f5WaitSec <= 0
      ) {
        location.reload();
      }
    }

    if (
      state.searchStatus === 'OFF'
    ) {
      return;
    }

    state.waitSec--;

    updatePanels();

    if (state.waitSec <= 0) {
      document
        .querySelector(
          '#reservationOfDateDisp1'
        )
        ?.click();

      resetWaitSec();
    }
  }, 1000);

  const mark =
    document.createElement('div');

  mark.id = MARK_ID;

  document.body.appendChild(mark);
})();
