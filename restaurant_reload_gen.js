// ==UserScript==
// @name         🍴📱レストラン一般再検索
// @version      4.75
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = '🍴📱レストラン一般再検索';
  const MARK_ID = '__restaurant_reload_running_v4';
  const SNAPSHOT_STORAGE_KEY = 'restaurantDiffSnapshotsV2';
  if (document.getElementById(MARK_ID)) return;

  sessionStorage.removeItem('restaurantReservationPendingV1');

  const configuredWebhook = window.TDR_WEBHOOKS?.restaurant || '';
  if (configuredWebhook) localStorage.setItem('restaurantDiscordWebhookCache', configuredWebhook);
  const DISCORD_WEBHOOK_URL = configuredWebhook || localStorage.getItem('restaurantDiscordWebhookCache') || '';

  const ACCESS_DENIED_NOTIFY_COOLDOWN = 300000;
  const PUBLIC_IP_TIMEOUT = 4000;
  const AJAX_BATCH_SETTLE_MS = 500;
  const ERROR_RELOAD_NOTIFY_THRESHOLD = 3;
  const FREEZE_TIMEOUT_MS = 120000;
  const FREEZE_RELOAD_DELAY_MS = 60000;
  const ORANGE_ERROR_RELOAD_DELAY_MS = 60000;
  const AUTO_RESERVE_NOTIFY_COOLDOWN = 30000;
  const RED = 0xFF0000;
  const BLACK = 1;
  const BLUE = 0x3498DB;
  const ORANGE = 0xFFA500;
  const PURPLE = 0x800080;

  function isAccessDeniedPage() {
    const title = document.title || '';
    const bodyText = document.body?.innerText || '';
    return /Access Denied/i.test(title) ||
      /Access Denied/i.test(bodyText) ||
      /You don't have permission to access/i.test(bodyText) ||
      /Reference\s+#/i.test(bodyText);
  }

  function getAccessDeniedReference() {
    const match = (document.body?.innerText || '').match(/Reference\s+#([^\s]+)/i);
    return match ? match[1] : '取得できませんでした';
  }

  function isOrangeErrorPage() {
    const bodyText = document.body?.innerText || '';
    return /オンライン予約・購入サイトからのお知らせ/.test(bodyText) &&
      (/アクセスが集中しておりアクセスしにくい状態/.test(bodyText) || /This site is temporarily busy or unavailable/i.test(bodyText)) &&
      (/しばらく時間をおいてから再度アクセス/.test(bodyText) || /Please try back again later/i.test(bodyText));
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
    const lastTime = Number(localStorage.getItem('accessDeniedLastNotifyTime') || '0');
    const lastReference = localStorage.getItem('accessDeniedLastReference') || '';
    const currentReference = reference || location.href;

    if (currentReference === lastReference && now - lastTime < ACCESS_DENIED_NOTIFY_COOLDOWN) return false;

    localStorage.setItem('accessDeniedLastNotifyTime', String(now));
    localStorage.setItem('accessDeniedLastReference', currentReference);
    return true;
  }

  async function handleAccessDeniedPage() {
    const reference = getAccessDeniedReference();
    if (!DISCORD_WEBHOOK_URL || !shouldNotifyAccessDenied(reference)) return;

    const ip = await getPublicIp();
    const d = new Date();
    const detectedAt = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
    const errorReloadCount = Math.max(0, Number(localStorage.getItem('errorReloadCount')) || 0);

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        username: SCRIPT_NAME,
        embeds: [{
          title: `🔶${detectedAt}`,
          description: [
            'Access Deniedを検出しました。',
            `公開IP：${ip}`,
            `Reference：${reference}`,
            `エラーF5：${errorReloadCount}回`,
            `URL：${location.href}`
          ].join('\n'),
          color: ORANGE
        }]
      })
    }).catch(console.error);
  }

  function handleOrangeErrorPage() {
    setTimeout(() => location.reload(), ORANGE_ERROR_RELOAD_DELAY_MS);
    if (!DISCORD_WEBHOOK_URL) return;

    (async () => {
      const ip = await getPublicIp();
      const d = new Date();
      const detectedAt = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
      const errorReloadCount = Math.max(0, Number(localStorage.getItem('errorReloadCount')) || 0);

      fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          username: SCRIPT_NAME,
          embeds: [{
            title: `🟠${detectedAt}`,
            description: [
              'オレンジエラーを検出しました。',
              `公開IP：${ip}`,
              `エラーF5：${errorReloadCount}回`,
              `URL：${location.href}`,
              '60秒後に強制再読み込みします'
            ].join('\n'),
            color: ORANGE
          }]
        })
      }).catch(console.error);
    })();
  }

  if (isAccessDeniedPage()) {
    const mark = document.createElement('div');
    mark.id = MARK_ID;
    document.body?.appendChild(mark);
    handleAccessDeniedPage();
    return;
  }

  if (isOrangeErrorPage()) {
    const mark = document.createElement('div');
    mark.id = MARK_ID;
    document.body?.appendChild(mark);
    handleOrangeErrorPage();
    return;
  }

  if (!document.querySelector('#reservationOfDateHid')) return;

  function loadNotifyMode() {
    const saved = localStorage.getItem('notifyMode');
    if (saved === 'ALL' || saved === 'VACANCY' || saved === 'OFF') return saved;
    return localStorage.getItem('notifyEnabled') === '0' ? 'OFF' : 'ALL';
  }

  function loadSnapshotMap() {
    try {
      const raw = sessionStorage.getItem(SNAPSHOT_STORAGE_KEY);
      if (!raw) return new Map();
      const data = JSON.parse(raw);
      return data && typeof data === 'object' && !Array.isArray(data)
        ? new Map(Object.entries(data))
        : new Map();
    } catch {
      return new Map();
    }
  }

  function saveSnapshotMap() {
    try {
      sessionStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(Object.fromEntries(state.snapshots)));
    } catch (e) {
      console.error('スナップショット保存失敗:', e);
    }
  }

  function createF5WaitSec() {
    return Math.floor(Math.random() * (1320 - 1080 + 1)) + 1080;
  }

  const state = {
    lastSearchStartTime: 0,
    isSearchPending: false,
    lastNotificationTime: 0,
    autoOpen: localStorage.getItem('autoOpenTimeTabs') !== '0',
    autoF5: localStorage.getItem('autoF520min') !== '0',
    autoReserve: localStorage.getItem('autoReserveClick') === '1',
    notifyMode: loadNotifyMode(),
    searchStatus: localStorage.getItem('searchStatus') || 'M',
    excludedTimes: JSON.parse(localStorage.getItem('excludedTimes') || '[]'),
    autoReserveNotifyHistory: JSON.parse(localStorage.getItem('autoReserveNotifyHistory') || '{}'),
    waitSec: 15,
    f5WaitSec: createF5WaitSec(),
    lastClickedMealName: '',
    commodityMealMap: {},
    autoReserveLockUntil: 0,
    errorReloadCount: Math.max(0, Number(localStorage.getItem('errorReloadCount')) || 0),
    errorReloadScheduled: false,
    freezeReloadScheduled: false,
    suppressReloadClick: false,
    snapshots: loadSnapshotMap(),
    ajaxPendingCount: 0,
    ajaxStatuses: [],
    ajaxBatchSlots: {},
    ajaxBatchMeals: new Set(),
    ajaxBatchFinalizeTimer: null
  };

  function getRestaurantName() {
    const nameEl = document.querySelector('.box04 .name, .p-restaurantDetail__name');
    return nameEl
      ? nameEl.textContent.trim()
      : document.title.split('｜')[0].replace(/レストラン空き状況確認|予約・購入|詳細/g, '').trim();
  }

  function getDisplayDate() {
    const raw = document.querySelector('#reservationOfDateDisp1')?.textContent.trim() || '';
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
    if (!root?.querySelectorAll) return;

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
    for (const row of document.querySelectorAll('.conditionBox tr')) {
      const th = row.querySelector('th');
      const td = row.querySelector('td');

      if (th && td && th.textContent.includes('時間帯')) {
        const meal = normalizeMealName(td.textContent);
        if (meal) return meal;
      }
    }

    const mealMap = { '1': '朝食', '2': '昼食', '3': '夕食' };
    const mealVal = document.querySelector('input[name="mealDivInform"]')?.value?.trim();
    if (mealMap[mealVal]) return mealMap[mealVal];

    const tempMealVal = tempDiv?.querySelector?.('input[name="mealDivInform"]')?.value?.trim();
    if (mealMap[tempMealVal]) return mealMap[tempMealVal];

    for (const h1 of tempDiv?.querySelectorAll?.('h1.hdg03, h1') || []) {
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
      const meal = normalizeMealName(section.querySelector('h1.hdg03, h1')?.textContent || '');
      if (meal) return meal;
    }

    return getMealName(tempDiv) || state.lastClickedMealName || '';
  }

  function getDetectDateTime() {
    const d = new Date();
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  }

  function statusFromRow(row) {
    const text = (row.querySelector('.state')?.textContent || '').replace(/\s+/g, '').trim();
    if (!text) return '';
    if (text.includes('空席あり')) return '空席';
    if (text.includes('満席')) return '満席';
    if (text.includes('締切') || text.includes('受付終了')) return '締切';
    return '不明';
  }

  function getMealNameFromAjaxSettings(settings) {
    try {
      let data = settings?.data;
      let commodity = '';

      if (typeof data === 'string') {
        const params = new URLSearchParams(data);
        commodity =
          params.get('commodityCD') ||
          params.get('commodityCd') ||
          params.get('commodityCdList') ||
          '';
      } else if (data && typeof data === 'object') {
        commodity =
          data.commodityCD ||
          data.commodityCd ||
          data.commodityCdList ||
          '';
      }

      if (!commodity && settings?.url) {
        const u = new URL(settings.url, location.href);
        commodity =
          u.searchParams.get('commodityCD') ||
          u.searchParams.get('commodityCd') ||
          '';
      }

      return getMealNameFromCommodity(String(commodity || '').trim());
    } catch {
      return '';
    }
  }

  function parseSlotsByMeal(tempDiv, fallbackMeal = '') {
    const result = {};

    tempDiv.querySelectorAll('tr').forEach(row => {
      const time = row.querySelector('th')?.textContent?.trim() || '';
      if (!/^\d{1,2}:\d{2}$/.test(time)) return;

      const status = statusFromRow(row);
      if (!status) return;

      const meal = getMealNameFromRow(row, tempDiv) || fallbackMeal;
      if (!meal) return;

      if (!result[meal]) result[meal] = {};
      result[meal][time] = status;
    });

    if (fallbackMeal && !Object.prototype.hasOwnProperty.call(result, fallbackMeal)) {
      result[fallbackMeal] = {};
    }

    return result;
  }

  function mergeBatchSlots(slotsByMeal) {
    Object.entries(slotsByMeal).forEach(([meal, slots]) => {
      if (!meal) return;
      state.ajaxBatchMeals.add(meal);
      state.ajaxBatchSlots[meal] = {
        ...(state.ajaxBatchSlots[meal] || {}),
        ...slots
      };
    });
  }

  function snapshotKey(meal) {
    return `${getRestaurantName()}|${getDisplayDate()}|${meal}`;
  }

  function statusText(status) {
    if (status === '空席') return '🔴空席';
    if (status === '満席') return '⚫満席';
    if (status === '締切') return '締切';
    return '状態不明';
  }

  function sendSnapshotDiscord(icon, mealName, lines, color, notifyType = 'FORCE') {
    if (notifyType === 'VACANCY' && state.notifyMode === 'OFF') return;
    if (notifyType === 'FULL' && state.notifyMode !== 'ALL') return;
    if (!DISCORD_WEBHOOK_URL || !lines.length) return;

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: SCRIPT_NAME,
        embeds: [{
          title: `${icon}${getDetectDateTime()}\n${getRestaurantName()}\n${getDisplayDate()}${mealName ? ` 【${mealName}】` : ''}`,
          description: lines.join('\n'),
          color
        }]
      })
    }).catch(console.error);
  }

  function compareAndNotifySnapshot(mealName, currentSlots) {
    const key = snapshotKey(mealName);
    const previous = state.snapshots.get(key);

    if (!previous) {
      state.snapshots.set(key, { ...currentSlots });
      saveSnapshotMap();
      return;
    }

    const added = [];
    const deleted = [];
    const vacancy = [];
    const full = [];

    Object.keys(currentSlots).forEach(time => {
      if (!Object.prototype.hasOwnProperty.call(previous, time)) {
        added.push({ time, to: currentSlots[time] });
      }
    });

    Object.keys(previous).forEach(time => {
      if (!Object.prototype.hasOwnProperty.call(currentSlots, time)) {
        deleted.push({ time, from: previous[time] });
      }
    });

    Object.keys(currentSlots).forEach(time => {
      if (!Object.prototype.hasOwnProperty.call(previous, time)) return;

      const from = previous[time];
      const to = currentSlots[time];

      if (from === to || from === '不明' || to === '不明') return;
      if (to === '空席') vacancy.push({ time, from, to });
      else if (to === '満席') full.push({ time, from, to });
    });

    const next = {};

    Object.keys(currentSlots).forEach(time => {
      next[time] =
        currentSlots[time] === '不明' &&
        Object.prototype.hasOwnProperty.call(previous, time) &&
        previous[time] !== '不明'
          ? previous[time]
          : currentSlots[time];
    });

    state.snapshots.set(key, next);
    saveSnapshotMap();

    const visibleAdded = added.filter(x => !state.excludedTimes.includes(x.time));
    const visibleDeleted = deleted.filter(x => !state.excludedTimes.includes(x.time));
    const visibleVacancy = vacancy.filter(x => !state.excludedTimes.includes(x.time));
    const visibleFull = full.filter(x => !state.excludedTimes.includes(x.time));

    if (visibleAdded.length) {
      sendSnapshotDiscord(
        '🔵',
        mealName,
        visibleAdded.sort((a, b) => a.time.localeCompare(b.time)).map(x => `${x.time}　🔵新規（${statusText(x.to)}）`),
        BLUE
      );
    }

    if (visibleDeleted.length) {
      sendSnapshotDiscord(
        '🔷',
        mealName,
        visibleDeleted.sort((a, b) => a.time.localeCompare(b.time)).map(x => `${x.time}　🔷削除`),
        BLUE
      );
    }

    if (visibleVacancy.length) {
      sendSnapshotDiscord(
        '🔴',
        mealName,
        visibleVacancy.sort((a, b) => a.time.localeCompare(b.time)).map(x => `${x.time}　🔴空席`),
        RED,
        'VACANCY'
      );
    }

    if (visibleFull.length) {
      sendSnapshotDiscord(
        '⚫',
        mealName,
        visibleFull.sort((a, b) => a.time.localeCompare(b.time)).map(x => `${x.time}　⚫満席`),
        BLACK,
        'FULL'
      );
    }
  }

  function processSnapshotBatch(batchSlots, batchMeals) {
    batchMeals.forEach(meal => {
      compareAndNotifySnapshot(meal, batchSlots[meal] || {});
    });
  }

  function shouldNotifyAutoReserve(time, mealName) {
    const now = Date.now();
    const key = `${getRestaurantName()}|${getDisplayDate()}|${mealName || ''}|${time}`;

    Object.keys(state.autoReserveNotifyHistory).forEach(k => {
      if (now - state.autoReserveNotifyHistory[k] > AUTO_RESERVE_NOTIFY_COOLDOWN) {
        delete state.autoReserveNotifyHistory[k];
      }
    });

    const last = state.autoReserveNotifyHistory[key] || 0;

    if (now - last <= AUTO_RESERVE_NOTIFY_COOLDOWN) {
      localStorage.setItem('autoReserveNotifyHistory', JSON.stringify(state.autoReserveNotifyHistory));
      return false;
    }

    state.autoReserveNotifyHistory[key] = now;
    localStorage.setItem('autoReserveNotifyHistory', JSON.stringify(state.autoReserveNotifyHistory));
    return true;
  }

  function sendAutoReserveDiscord(time, mealName) {
    if (!DISCORD_WEBHOOK_URL) return;

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        username: SCRIPT_NAME,
        embeds: [{
          title: `🟣${getDetectDateTime()}\n${getRestaurantName()}\n${getDisplayDate()}${mealName ? ` 【${mealName}】` : ''}`,
          description: ['自動予約クリック試行', time].join('\n'),
          color: PURPLE
        }]
      })
    }).catch(console.error);
  }

  function resetErrorReloadCount() {
    if (!state.errorReloadCount) return;
    state.errorReloadCount = 0;
    localStorage.setItem('errorReloadCount', '0');
  }

  function formatErrorStatuses(statuses) {
    return [...new Set(statuses)]
      .map(status => status === 0 ? '通信エラー 0' : `HTTP ${status}`)
      .join(' / ');
  }

  async function sendErrorReloadLimitDiscord(statuses, errorReloadCount) {
    if (!DISCORD_WEBHOOK_URL) return;

    const ip = await getPublicIp();
    const errorText = formatErrorStatuses(statuses);

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        username: SCRIPT_NAME,
        embeds: [{
          title: `🟠${getDetectDateTime()}`,
          description: [
            `通信エラーによるF5再読み込みが${errorReloadCount}回目に達しました。`,
            getRestaurantName(),
            getDisplayDate(),
            `エラー：${errorText}`,
            `エラーF5：${errorReloadCount}回目`,
            `公開IP：${ip}`
          ].join('\n'),
          color: ORANGE
        }]
      })
    }).catch(console.error);
  }

  async function sendFreezeDiscord() {
    if (!DISCORD_WEBHOOK_URL) return;

    const ip = await getPublicIp();

    fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        username: SCRIPT_NAME,
        embeds: [{
          title: `🟠${getDetectDateTime()}`,
          description: [
            'フリーズ：応答がありません。',
            getRestaurantName(),
            getDisplayDate(),
            'Pending：120秒超',
            `公開IP：${ip}`,
            '60秒後に強制再読み込みします'
          ].join('\n'),
          color: ORANGE
        }]
      })
    }).catch(console.error);
  }

  function handleFreeze() {
    if (state.freezeReloadScheduled) return;

    state.freezeReloadScheduled = true;
    state.searchStatus = 'OFF';
    state.isSearchPending = false;
    state.ajaxPendingCount = 0;

    if (state.ajaxBatchFinalizeTimer) {
      clearTimeout(state.ajaxBatchFinalizeTimer);
      state.ajaxBatchFinalizeTimer = null;
    }

    updatePanels();
    sendFreezeDiscord();

    setTimeout(() => {
      state.f5WaitSec = createF5WaitSec();
      location.reload();
    }, FREEZE_RELOAD_DELAY_MS);
  }

  function scheduleErrorReload(statuses, countAsError = true) {
    if (state.errorReloadScheduled) return;

    state.errorReloadScheduled = true;

    if (countAsError) {
      state.errorReloadCount++;
      localStorage.setItem('errorReloadCount', String(state.errorReloadCount));
    }

    const uniqueStatuses = [...new Set(statuses)];
    const errorText = formatErrorStatuses(uniqueStatuses);
    const popupId = '__restaurant_error_popup';

    let popup = document.getElementById(popupId);

    if (!popup) {
      popup = document.createElement('div');
      popup.id = popupId;

      Object.assign(popup.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: '2147483647',
        minWidth: '280px',
        padding: '24px 30px',
        borderRadius: '14px',
        background: '#dc3545',
        color: '#fff',
        boxShadow: '0 4px 20px rgba(0,0,0,0.45)',
        fontSize: '22px',
        fontWeight: 'bold',
        lineHeight: '1.6',
        textAlign: 'center',
        pointerEvents: 'none'
      });

      document.body.appendChild(popup);
    }

    popup.innerHTML = countAsError
      ? [`🚫 ${errorText} エラー`, `エラーリロード ${state.errorReloadCount}回目`, '10秒後に再読み込みします'].join('<br>')
      : [`🚫 ${errorText} エラー`, 'AJAX 200混在のためカウントをリセット', 'エラーカウント 0回', '10秒後に再読み込みします'].join('<br>');

    if (countAsError && state.errorReloadCount >= ERROR_RELOAD_NOTIFY_THRESHOLD) {
      sendErrorReloadLimitDiscord(uniqueStatuses, state.errorReloadCount);
    }

    setTimeout(() => location.reload(), 10000);
  }

  function finalizeAjaxBatch() {
    state.ajaxBatchFinalizeTimer = null;
    if (state.ajaxPendingCount > 0) return;

    const statuses = state.ajaxStatuses.slice();
    const batchSlots = state.ajaxBatchSlots;
    const batchMeals = new Set(state.ajaxBatchMeals);

    state.ajaxStatuses = [];
    state.ajaxBatchSlots = {};
    state.ajaxBatchMeals = new Set();
    state.isSearchPending = false;
    updatePanels();

    if (!statuses.length) return;

    const hasSuccess = statuses.includes(200);
    const errorStatuses = statuses.filter(status => status !== 200);

    if (hasSuccess) resetErrorReloadCount();

    if (errorStatuses.length) {
      scheduleErrorReload(errorStatuses, !hasSuccess);
      return;
    }

    processSnapshotBatch(batchSlots, batchMeals);
  }

  function scheduleAjaxBatchFinalize() {
    clearTimeout(state.ajaxBatchFinalizeTimer);
    state.ajaxBatchFinalizeTimer = setTimeout(finalizeAjaxBatch, AJAX_BATCH_SETTLE_MS);
  }

  function isVisible(el) {
    return !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));
  }

  function clickConsentNext(dialog, attempt = 0) {
    const nextBtn =
      dialog.querySelector('#btnNext') ||
      [...dialog.querySelectorAll('button, a, input[type="button"], input[type="submit"]')].find(el =>
        (el.textContent || el.value || '').replace(/\s+/g, '').trim().includes('次へ')
      );

    if (!nextBtn) return;

    const disabled =
      nextBtn.disabled ||
      nextBtn.getAttribute('disabled') !== null ||
      nextBtn.classList.contains('nextDisabled') ||
      nextBtn.classList.contains('ui-disabled') ||
      nextBtn.closest('.ui-disabled');

    if (!disabled) {
      nextBtn.click();
      return;
    }

    const checkbox = dialog.querySelector('#accept') || dialog.querySelector('input[type="checkbox"]');

    if (checkbox?.checked && attempt >= 10) {
      nextBtn.disabled = false;
      nextBtn.removeAttribute('disabled');
      nextBtn.classList.remove('nextDisabled', 'ui-disabled');
      nextBtn.click();
      return;
    }

    if (attempt < 30) setTimeout(() => clickConsentNext(dialog, attempt + 1), 100);
  }

  function handleConsentDialog(attempt = 0) {
    const dialog =
      document.querySelector('#noticeMessage') ||
      [...document.querySelectorAll('.ui-dialog, .ui-popup, [role="dialog"], [data-role="dialog"], #jqmDialog')].find(el => {
        const text = (el.textContent || '').replace(/\s+/g, '');
        return isVisible(el) && text.includes('同意する') && text.includes('次へ');
      });

    if (!dialog || !isVisible(dialog)) {
      if (attempt < 30) setTimeout(() => handleConsentDialog(attempt + 1), 100);
      return;
    }

    const checkbox = dialog.querySelector('#accept') || dialog.querySelector('input[type="checkbox"]');
    const label =
      dialog.querySelector('label[for="accept"]') ||
      [...dialog.querySelectorAll('label')].find(el => (el.textContent || '').includes('同意する'));

    if (checkbox && !checkbox.checked) {
      if (label) label.click();
      else checkbox.click();

      checkbox.checked = true;
      checkbox.setAttribute('checked', 'checked');
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));

      if (window.jQuery) {
        try {
          const $cb = jQuery(checkbox);
          $cb.prop('checked', true);
          if ($cb.checkboxradio) $cb.checkboxradio('refresh');
          $cb.trigger('change');
        } catch (e) {
          console.error(e);
        }
      }
    }

    setTimeout(() => clickConsentNext(dialog), 200);
  }

  function stopAutomationForReservation() {
    state.searchStatus = 'OFF';
    state.autoReserve = false;
    localStorage.setItem('searchStatus', 'OFF');
    localStorage.setItem('autoReserveClick', '0');
    updatePanels();
  }

  function tryAutoReserveClick(attempt = 0) {
    if (!state.autoReserve || Date.now() < state.autoReserveLockUntil) return;

    refreshCommodityMealMap(document);

    for (const row of document.querySelectorAll('section.reservationTime tr')) {
      const stateText = row.querySelector('.state')?.textContent || '';
      const time = row.querySelector('th')?.textContent?.trim();
      const link = row.querySelector('td.btn a[onclick*="toOrderForDate"]');

      if (
        !stateText.includes('空席あり') ||
        !time ||
        state.excludedTimes.includes(time) ||
        !link
      ) {
        continue;
      }

      state.autoReserveLockUntil = Date.now() + 3000;

      const meal = getMealNameFromRow(row, document);
      const notify = shouldNotifyAutoReserve(time, meal);

      if (notify) sendAutoReserveDiscord(time, meal);

      setTimeout(() => {
        stopAutomationForReservation();
        link.click();
      }, notify ? 80 : 0);

      return;
    }

    if (attempt < 5) {
      setTimeout(() => tryAutoReserveClick(attempt + 1), 100);
    }
  }

  const panels = {};

  function createPanel(top, bg, onClick) {
    const p = document.createElement('div');

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
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
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

  function updatePanels(isMaintenance = false) {
    if (isMaintenance) {
      panels.main.textContent = '休止';
      panels.main.style.background = '#888';
    } else {
      const colors = {
        OFF: '#333',
        L: '#007bff',
        M: '#ff8c00',
        S: '#e83e8c'
      };

      panels.main.textContent =
        state.isSearchPending
          ? '読込中'
          : state.searchStatus === 'OFF'
            ? 'OFF'
            : state.waitSec;

      panels.main.style.background = colors[state.searchStatus];
    }

    if (!state.autoF5) {
      panels.f5.style.background = '#333';
      panels.f5.textContent = 'OFF';
    } else {
      const m = Math.floor(state.f5WaitSec / 60);
      const s = state.f5WaitSec % 60;
      panels.f5.style.background = '#6f42c1';
      panels.f5.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }

    panels.open.style.background = state.autoOpen ? '#28a745' : '#333';
    panels.open.textContent = 'TAB';
    panels.reserve.style.background = state.autoReserve ? '#dc3545' : '#333';
    panels.reserve.textContent = '👆️';

    if (state.notifyMode === 'ALL') {
      panels.notify.style.background = '#ffc107';
      panels.notify.style.color = '#000';
      panels.notify.textContent = '全';
    } else if (state.notifyMode === 'VACANCY') {
      panels.notify.style.background = 'pink';
      panels.notify.style.color = '#000';
      panels.notify.textContent = '空';
    } else {
      panels.notify.style.background = '#333';
      panels.notify.style.color = '#fff';
      panels.notify.textContent = 'OFF';
    }

    if (panels.reset) {
      panels.reset.textContent = 'リセット';
      panels.reset.style.background = state.excludedTimes.length ? '#8e44ad' : '#000';
    }
  }

  function resetWaitSec() {
    if (state.searchStatus === 'OFF') return;

    const ranges = {
      S: [1, 5],
      M: [10, 11],
      L: [25, 11]
    };

    const r = ranges[state.searchStatus];
    state.waitSec = Math.floor(Math.random() * r[1]) + r[0];
  }

  panels.main = createPanel(10, '#333', () => {
    const nextStatus = {
      OFF: 'L',
      L: 'M',
      M: 'S',
      S: 'OFF'
    };

    state.searchStatus = nextStatus[state.searchStatus];
    localStorage.setItem('searchStatus', state.searchStatus);
    state.lastNotificationTime = 0;
    resetWaitSec();
    updatePanels();
  });

  panels.notify = createPanel(50, '#333', () => {
    const nextNotifyMode = {
      ALL: 'VACANCY',
      VACANCY: 'OFF',
      OFF: 'ALL'
    };

    state.notifyMode = nextNotifyMode[state.notifyMode] || 'ALL';
    localStorage.setItem('notifyMode', state.notifyMode);
    updatePanels();
  });

  panels.reset = createPanel(90, '#000', () => {
    state.excludedTimes = [];
    localStorage.setItem('excludedTimes', '[]');

    document.querySelectorAll('.ex-switch').forEach(cb => {
      cb.checked = true;
    });

    updatePanels();
  });

  panels.f5 = createPanel(10, '#333', () => {
    state.autoF5 = !state.autoF5;
    localStorage.setItem('autoF520min', state.autoF5 ? '1' : '0');
    updatePanels();
  });
  panels.f5.style.right = '84px';

  panels.open = createPanel(50, '#333', () => {
    state.autoOpen = !state.autoOpen;
    localStorage.setItem('autoOpenTimeTabs', state.autoOpen ? '1' : '0');
    updatePanels();

    if (state.autoOpen) openAllTimeSlots();
  });
  panels.open.style.right = '84px';

  panels.reserve = createPanel(90, '#333', () => {
    state.autoReserve = !state.autoReserve;
    localStorage.setItem('autoReserveClick', state.autoReserve ? '1' : '0');
    updatePanels();
  });
  panels.reserve.style.right = '84px';

  function openAllTimeSlots() {
    let delay = 0;

    document.querySelectorAll('section.reservationTime').forEach(sec => {
      const h1 = sec.querySelector('h1');
      const contents = sec.querySelector('.contents');

      if (h1 && contents && contents.style.display === 'none') {
        setTimeout(() => {
          state.suppressReloadClick = true;

          try {
            h1.click();
          } finally {
            state.suppressReloadClick = false;
          }
        }, delay * 200);

        delay++;
      }
    });
  }

  function disableClassName(elem, className, prefix = '') {
    $(elem)
      .find(`${prefix}.${className}`)
      .removeClass(className)
      .addClass(`_${className}`);
  }

  function enableClassName(elem, className, prefix = '') {
    $(elem)
      .find(`${prefix}._${className}`)
      .removeClass(`_${className}`)
      .addClass(className);
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

        if (
          !/^\d{1,2}:\d{2}$/.test(timeStr) ||
          tdState.querySelector('.ex-switch')
        ) {
          return;
        }

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.className = 'ex-switch';
        checkbox.checked = !state.excludedTimes.includes(timeStr);
        checkbox.style.cssText = 'margin-left:10px;transform:scale(1.1);vertical-align:middle;cursor:pointer;position:relative;z-index:100;';
        tdState.style.whiteSpace = 'nowrap';

        checkbox.onclick = e => e.stopPropagation();

        checkbox.onchange = e => {
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

  new MutationObserver(addExclusionSwitchesDebounced).observe(document.body, {
    childList: true,
    subtree: true
  });

  document.addEventListener('click', e => {
    const target = e.target instanceof Element ? e.target : e.target?.parentElement;
    const link = target?.closest?.('a[onclick*="toOrderForDate"]');

    if (!link) return;

    stopAutomationForReservation();
    setTimeout(() => handleConsentDialog(), 150);
  }, true);

  if (typeof $ !== 'undefined') {
    $(document).on('ajaxSend', (event, xhr, settings) => {
      if (!String(settings.url || '').includes('ajaxReservationOfDate')) return;
      if (state.errorReloadScheduled || state.freezeReloadScheduled) return;

      refreshCommodityMealMap(document);

      if (state.ajaxBatchFinalizeTimer) {
        clearTimeout(state.ajaxBatchFinalizeTimer);
        state.ajaxBatchFinalizeTimer = null;
      }

      if (state.ajaxPendingCount === 0 && state.ajaxStatuses.length === 0) {
        state.lastSearchStartTime = Date.now();
        state.ajaxBatchSlots = {};
        state.ajaxBatchMeals = new Set();
      }

      xhr.__tdrMealName =
        getMealNameFromAjaxSettings(settings) ||
        state.lastClickedMealName ||
        '';

      state.ajaxPendingCount++;
      state.isSearchPending = true;
      updatePanels();
    });

    $(document).on('ajaxComplete', (event, xhr, settings) => {
      if (!String(settings.url || '').includes('ajaxReservationOfDate')) return;
      if (state.errorReloadScheduled || state.freezeReloadScheduled) return;

      state.ajaxStatuses.push(xhr.status);
      state.ajaxPendingCount = Math.max(0, state.ajaxPendingCount - 1);

      if (xhr.status === 200) {
        const responseHtml = xhr.responseText;

        if (responseHtml) {
          try {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = responseHtml;

            refreshCommodityMealMap(document);
            refreshCommodityMealMap(tempDiv);

            const fallbackMeal =
              xhr.__tdrMealName ||
              getMealNameFromAjaxSettings(settings) ||
              state.lastClickedMealName ||
              '';

            const slotsByMeal = parseSlotsByMeal(tempDiv, fallbackMeal);
            mergeBatchSlots(slotsByMeal);

            const hasVacancy = Object.values(slotsByMeal).some(slots =>
              Object.entries(slots).some(([time, status]) =>
                status === '空席' &&
                !state.excludedTimes.includes(time)
              )
            );

            if (hasVacancy && state.autoReserve) {
              setTimeout(() => tryAutoReserveClick(), 0);
            }
          } catch (e) {
            console.error('解析エラー:', e);
          }
        } else if (xhr.__tdrMealName) {
          mergeBatchSlots({
            [xhr.__tdrMealName]: {}
          });
        }
      }

      if (state.ajaxPendingCount === 0) {
        scheduleAjaxBatchFinalize();
      }
    });

    $(document)
      .off('ajaxStop.restaurantReload')
      .on('ajaxStop.restaurantReload', () => {
        if (state.autoOpen) setTimeout(openAllTimeSlots, 300);
      });
  }

  const reloadSP = (el, individual = false) => {
    $(el)
      .on('click', e => {
        if (state.suppressReloadClick) return;

        e.stopPropagation();

        state.lastClickedMealName =
          individual
            ? normalizeMealName($(el).text())
            : '';

        refreshCommodityMealMap(document);

        const nextBtn = $('li.next button.nextDateLink');
        const prevBtn = $('li.prev button.preDateLink');

        if (prevBtn.attr('disabled') && nextBtn.attr('disabled')) return;

        const otherSections = $(el)
          .closest('section')
          .siblings('section');

        if (individual) {
          otherSections.each((idx, elem) => {
            disableClassName(elem, 'restaurantCalendarOfDate');
            disableClassName(elem, 'reservationTime');
            disableClassName(elem, 'hState', 'span');
          });
        }

        const cur = $('#reservationOfDateHid').html();
        const prev = $.datepicker
          .parseDate('yymmdd', cur, {})
          .addDays(-1);

        $('#reservationOfDateHid').html(
          $.datepicker.formatDate('yymmdd', prev, {})
        );

        nextBtn.removeClass('hasNoData');
        changeReservationDate('next', nextBtn[0]);
        $.mobile.loading('hide');

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
      })
      .css('cursor', 'pointer');
  };

  const targetDisp = document.querySelector('#reservationOfDateDisp1');

  if (targetDisp) {
    reloadSP($(targetDisp));
  }

  document
    .querySelectorAll('section > div > h1:nth-child(1)')
    .forEach(h => {
      reloadSP($(h), true);
    });

  refreshCommodityMealMap(document);
  resetWaitSec();
  updatePanels();

  if (state.autoOpen) {
    setTimeout(openAllTimeSlots, 1000);
  }

  setInterval(() => {
    const now = Date.now();
    const d = new Date();
    const secTotal =
      d.getHours() * 3600 +
      d.getMinutes() * 60 +
      d.getSeconds();

    if (
      state.errorReloadScheduled ||
      state.freezeReloadScheduled
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
      now - state.lastSearchStartTime > FREEZE_TIMEOUT_MS
    ) {
      handleFreeze();
      return;
    }

    if (state.autoF5) {
      state.f5WaitSec--;
      updatePanels();

      if (state.f5WaitSec <= 0) {
        location.reload();
        return;
      }
    }

    if (state.isSearchPending) {
      updatePanels();
      return;
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
