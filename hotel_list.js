// ==UserScript==
// @name         📋️日時指定在庫モニター
// @version      1.87
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/?useDate*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/hotel_list.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/hotel_list.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;

  if (win.__TDR_DATETIME_STOCK_MONITOR_RUNNING__) {
    console.warn('[DaySearch] すでに起動済みのため停止');
    return;
  }
  win.__TDR_DATETIME_STOCK_MONITOR_RUNNING__ = '1.87';

  const SCRIPT_NAME = '📋️日時指定在庫モニター';
  const API_URL = 'https://reserve.tokyodisneyresort.jp/sp/hotel/api/queryHotelPriceStock/';
  const ENDPOINT = /\/sp\/hotel\/api\/queryHotelPriceStock\/?/;
  const SNAPSHOT_SCHEMA = 'sp-url-useDate-only-v1.79';
  const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
  const DOM_WAIT_MS = 700;

  const BURST_ERROR_RETRY_MS = 1500;
  const NORMAL_ERROR_RETRY_MS = 3000;
  const NORMAL_COOLDOWN_MS = 10 * 60 * 1000;
  const LONG_COOLDOWN_MS = 30 * 60 * 1000;

  const SHOW_CATEGORY_HEADER = true;
  const ROOM_LOG_INDENT_CH = 6;
  const HIDDEN_STYLE = 'color:transparent;font-size:0;line-height:0';

  const LS_PREFIX = 'tdr_datetime_stock_monitor_';
  const LS_NOTIFY = `${LS_PREFIX}notify`;
  const LS_RARE = `${LS_PREFIX}rare`;
  const LS_MODE_CURRENT = `${LS_PREFIX}mode_current`;
  const LS_MODE_NEXT = `${LS_PREFIX}mode_next`;

  const MODE = {
    manual: { label: '👆️手動', short: '👆️', bg: '#666' },
    short: { label: '🏃‍♀️短期', short: '🏃‍♀️', bg: '#e91e63' },
    long: { label: '🚶長期', short: '🚶', bg: '#1976d2' }
  };

  const API_KIND = {
    current: { label: '当日API', short: '当', modeKey: LS_MODE_CURRENT },
    next: { label: '翌日API', short: '翌', modeKey: LS_MODE_NEXT }
  };

  const DISCORD_COLOR = {
    empty: 0x00b050,
    full: 0x808080,
    unsold: 0xf6c343,
    change: 0x3498db,
    error: 0xff3333
  };

  const TITLE_EMOJI = {
    empty: '🔔',
    full: '⚫',
    unsold: '🟡',
    change: '🔄',
    error: '⚠️'
  };

  const RARE_ROOM_KEYWORDS = [
    'グランドシャトー',
    'ラ・リベリュール',
    'スペチアーレ',
    'コンシェルジュ',
    'テラス',
    'バルコニー',
    'ハーバービュー',
    'ハーバーグランドビュー',
    'パークビュー',
    'パークグランドビュー',
    'アトラクションビュー',
    'アクセシブルルーム',
    'ファンタジーシャトー・スプリングスサイド',
    'ファンタジーシャトー スプリングスサイド',
    'ファンタジーシャトー・ローズコートサイド',
    'ファンタジーシャトー ローズコートサイド',
    'トランドルベッド',
    'アルコーヴベッド',
    'キャラクター',
    '美女と野獣',
    'ティンカーベル',
    'アリス',
    'ミニー',
    'ミッキー',
    'ドナルド'
  ];

  let notifyEnabled = readBool(LS_NOTIFY, true);
  let rareFilterEnabled = readBool(LS_RARE, false);

  let apiAutoMode = {
    current: readMode(LS_MODE_CURRENT, 'manual'),
    next: readMode(LS_MODE_NEXT, 'manual')
  };

  let apiTimers = {
    current: null,
    next: null
  };

  let apiBusy = {
    current: false,
    next: false
  };

  let customApiPriorityUntil = 0;
  let lastResponseSignature = '';
  let lastResponseAt = 0;

  let panelRoot = null;
  let notifyBtn = null;
  let rareBtn = null;
  let currentApiBtn = null;
  let nextApiBtn = null;
  let currentModeBtn = null;
  let nextModeBtn = null;

  let popupElem = null;
  let consecutiveErrorCount = 0;
  let fatalErrorCount = 0;
  let cachedIP = '';
  let lastIPFetchTime = 0;
  let webhookStatusLogged = false;

  const discordQueue = [];
  let discordSending = false;

  const internalLogs = [];

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $$(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function normalize(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  function readBool(key, defaultValue) {
    const v = localStorage.getItem(key);
    if (v === null) return defaultValue;
    return v === '1';
  }

  function writeBool(key, value) {
    localStorage.setItem(key, value ? '1' : '0');
  }

  function readMode(key, defaultValue) {
    const v = localStorage.getItem(key);
    return MODE[v] ? v : defaultValue;
  }

  function writeMode(key, value) {
    if (!MODE[value]) value = 'manual';
    localStorage.setItem(key, value);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function pad3(n) {
    return String(n).padStart(3, '0');
  }

  function tStrMs(date = new Date()) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${pad3(date.getMilliseconds())}`;
  }

  function tStrSec(date = new Date()) {
    return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function tStrForTitle(date = new Date()) {
    return `${pad2(date.getMonth() + 1)}/${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  }

  function getClockStr(date = new Date()) {
    return `${pad2(date.getHours())}時${pad2(date.getMinutes())}分${pad2(date.getSeconds())}秒`;
  }

  function toCircled(num) {
    const n = Number(num);
    const map = {
      0: '⓪',
      1: '①',
      2: '②',
      3: '③',
      4: '④',
      5: '⑤',
      6: '⑥',
      7: '⑦',
      8: '⑧',
      9: '⑨',
      10: '⑩'
    };
    return map[n] || String(num);
  }

  function getUseDateText(date = null) {
    const target = date || getUseDateFromUrl();
    if (!target) return '';
    return target.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1/$2/$3');
  }

  function getUseDateFromUrl() {
    const params = new URLSearchParams(location.search);
    return normalize(params.get('useDate'));
  }

  function addDateYmd(ymd, days) {
    const m = String(ymd || '').match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return ymd;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  }

  function getFilterLabel() {
    return rareFilterEnabled ? 'レア客室' : '全客室';
  }

  function internalLog(message, level = 'info') {
    internalLogs.push({ at: tStrMs(), level, message: String(message || '') });
    if (internalLogs.length > 100) internalLogs.shift();
  }

  function flushInternalLogs() {
    if (!internalLogs.length) return;

    internalLogs.splice(0).forEach(item => {
      const line = `${item.at} ${item.message}`;
      if (item.level === 'warn') {
        console.warn(line);
      } else if (item.level === 'error') {
        console.error(line);
      } else {
        console.info(line);
      }
    });
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  function safeCloneJson(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return obj;
    }
  }

  function isEndpointUrl(url) {
    return ENDPOINT.test(String(url || ''));
  }

  function getDiscordWebhookUrl() {
    return normalize(win.TDR_WEBHOOKS && win.TDR_WEBHOOKS.hotel);
  }

  function logWebhookStatus(force = false) {
    if (webhookStatusLogged && !force) return;

    const webhookUrl = getDiscordWebhookUrl();

    if (!webhookUrl && notifyEnabled) {
      internalLog('Discord Webhook未読込: window.TDR_WEBHOOKS.hotel が見つかりません', 'warn');
    }

    webhookStatusLogged = true;
  }

  function enqueueDiscord(payload) {
    if (!notifyEnabled) return;

    const webhookUrl = getDiscordWebhookUrl();
    if (!webhookUrl) {
      logWebhookStatus(true);
      return;
    }

    discordQueue.push({ webhookUrl, payload });
    flushDiscordQueue();
  }

  async function flushDiscordQueue() {
    if (discordSending) return;
    discordSending = true;

    while (discordQueue.length) {
      const item = discordQueue.shift();

      try {
        const res = await win.fetch(item.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload)
        });

        if (!res.ok) {
          internalLog(`Discord送信失敗: HTTP ${res.status}`, 'warn');
        } else {
          internalLog('Discord送信OK');
        }
      } catch (e) {
        internalLog(`Discord送信エラー: ${e && e.message ? e.message : e}`, 'warn');
      }

      await sleep(500);
    }

    discordSending = false;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isMaintenanceTime(date = new Date()) {
    const h = date.getHours();
    return h >= 3 && h <= 4;
  }

  function getMaintenanceDelayMs(date = new Date()) {
    const h = date.getHours();
    const m = date.getMinutes();

    if (h !== 4) return 10 * 60 * 1000;
    if (m >= 59) return 1000;
    if (m >= 55) return 10 * 1000;
    return 10 * 60 * 1000;
  }

  function isBurstTime(date = new Date()) {
    const h = date.getHours();
    const m = date.getMinutes();
    return (h === 10 && m === 59) || (h === 11 && m >= 0 && m <= 4);
  }

  function showPopup(message, type = 'info', timeoutMs = 0) {
    if (!popupElem) {
      popupElem = document.createElement('div');
      popupElem.id = '__tdr_datetime_stock_popup';
      popupElem.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:24px',
        'transform:translateX(-50%)',
        'z-index:2147483647',
        'padding:8px 14px',
        'border-radius:999px',
        'font-size:13px',
        'font-weight:bold',
        'color:#fff',
        'box-shadow:0 2px 10px rgba(0,0,0,.35)',
        'cursor:pointer',
        'max-width:90vw',
        'white-space:pre-line',
        'text-align:center'
      ].join(';');
      popupElem.addEventListener('click', hidePopup);
      document.documentElement.appendChild(popupElem);
    }

    const bg = type === 'error'
      ? '#d32f2f'
      : type === 'warn'
        ? '#f9a825'
        : type === 'success'
          ? '#1976d2'
          : '#333';

    popupElem.style.background = bg;
    popupElem.style.color = type === 'warn' ? '#111' : '#fff';
    popupElem.textContent = message;
    popupElem.style.display = 'block';

    if (timeoutMs > 0) {
      setTimeout(hidePopup, timeoutMs);
    }
  }

  function hidePopup() {
    if (popupElem) {
      popupElem.style.display = 'none';
    }
  }

  async function getIP() {
    const now = Date.now();

    if (cachedIP && now - lastIPFetchTime < 10 * 60 * 1000) {
      return cachedIP;
    }

    const candidates = [
      'https://inet-ip.info/ip',
      'https://www.cloudflare.com/cdn-cgi/trace',
      'https://api.ipify.org'
    ];

    for (const url of candidates) {
      try {
        const res = await win.fetch(url, { cache: 'no-store' });
        const text = await res.text();

        let ip = '';

        if (url.includes('cloudflare')) {
          const m = text.match(/^ip=(.+)$/m);
          ip = m ? normalize(m[1]) : '';
        } else {
          ip = normalize(text);
        }

        if (ip) {
          cachedIP = ip;
          lastIPFetchTime = now;
          return ip;
        }
      } catch (e) {
        // ignore
      }
    }

    return '';
  }

  function shouldNotifyErrorCount(count) {
    return count === 10 || count === 15 || count === 20 || count === 25 || count >= 30;
  }

  function stopAllApiAuto(reason = '') {
    setApiAutoMode('current', 'manual');
    setApiAutoMode('next', 'manual');
    clearApiAutoTimer('current');
    clearApiAutoTimer('next');

    if (reason) {
      internalLog(`全API自動停止: ${reason}`, 'warn');
    }

    updateApiButtonPanel();
  }

  function handleApiSuccess(kind) {
    if (consecutiveErrorCount > 0 || fatalErrorCount > 0) {
      internalLog(`API成功のためエラーカウントリセット: 連続${consecutiveErrorCount} / 通算${fatalErrorCount}`);
    }

    consecutiveErrorCount = 0;
    fatalErrorCount = 0;
    showPopup(`${API_KIND[kind]?.label || 'API'} 成功 ${getClockStr()}`, 'success', 1600);
  }

  async function handleApiError(kind, error) {
    if (isMaintenanceTime()) {
      const delayMs = getMaintenanceDelayMs();
      internalLog(`${API_KIND[kind]?.label || 'API'} メンテ時間のため待機: ${Math.ceil(delayMs / 1000)}秒`, 'warn');
      return { stopAuto: false, backoffMs: delayMs };
    }

    consecutiveErrorCount += 1;
    fatalErrorCount += 1;

    const count = consecutiveErrorCount;
    const burst = isBurstTime();
    const message = error && error.message ? error.message : String(error || 'APIエラー');

    internalLog(`${API_KIND[kind]?.label || 'API'} エラー: 連続${count} / 通算${fatalErrorCount} / ${message}`, 'warn');

    if (burst) {
      if (count >= 30) {
        showPopup(`バーストブロック検知 ${count}回\n自動API停止`, 'error');
        await sendApiErrorDiscord(kind, error, 'バーストブロック検知');
        return { stopAuto: true, backoffMs: 0 };
      }

      showPopup(`APIエラー ${count}回目\n1.5秒後に再検索`, 'warn', 1300);

      if (shouldNotifyErrorCount(count)) {
        await sendApiErrorDiscord(kind, error, 'バースト中エラー');
      }

      return { stopAuto: false, backoffMs: BURST_ERROR_RETRY_MS };
    }

    if (count >= 30) {
      showPopup(`APIエラー ${count}回\n自動API停止`, 'error');
      await sendApiErrorDiscord(kind, error, 'エラー多発停止');
      return { stopAuto: true, backoffMs: 0 };
    }

    if (count === 25) {
      showPopup(`APIエラー ${count}回\n30分クールダウン`, 'error');
      await sendApiErrorDiscord(kind, error, '25回エラー');
      return { stopAuto: false, backoffMs: LONG_COOLDOWN_MS };
    }

    if (count === 10 || count === 15 || count === 20) {
      showPopup(`APIエラー ${count}回\n10分クールダウン`, 'error');
      await sendApiErrorDiscord(kind, error, `${count}回エラー`);
      return { stopAuto: false, backoffMs: NORMAL_COOLDOWN_MS };
    }

    showPopup(`APIエラー ${count}回目\n3秒後に再検索`, 'warn', 2500);
    return { stopAuto: false, backoffMs: NORMAL_ERROR_RETRY_MS };
  }

  async function sendApiErrorDiscord(kind, error, title) {
    if (!notifyEnabled) return;

    const ip = await getIP();
    const message = error && error.message ? error.message : String(error || 'APIエラー');

    enqueueDiscord({
      username: SCRIPT_NAME,
      embeds: [{
        title: `⚠️ **${tStrForTitle()}**\n${title}\n${API_KIND[kind]?.label || 'API'} / 連続${consecutiveErrorCount}回 / 通算${fatalErrorCount}回`,
        description: [
          `IP: ${ip || '取得失敗'}`,
          `理由: ${message}`
        ].join('\n'),
        color: DISCORD_COLOR.error
      }],
      allowed_mentions: { parse: [] }
    });
  }

  function patchXHR() {
    if (win.XMLHttpRequest.__tdrDatetimeStockPatched) return;
    win.XMLHttpRequest.__tdrDatetimeStockPatched = true;

    const XHR = win.XMLHttpRequest;
    const originalOpen = XHR.prototype.open;
    const originalSend = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      this.__tdrStockUrl = url;
      this.__tdrStockMethod = method;
      return originalOpen.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      if (isEndpointUrl(this.__tdrStockUrl)) {
        this.addEventListener('load', () => {
          try {
            const json = safeJsonParse(this.responseText);
            if (!json) return;

            if (Date.now() < customApiPriorityUntil) {
              internalLog('カスタムAPI優先中のため通常API処理をスキップ');
              return;
            }

            handleJSON(json, {
              sourceName: '通常API',
              customApi: false,
              apiMode: 'manual',
              useDate: getUseDateFromUrl()
            });
          } catch (e) {
            internalLog(`XHR処理エラー: ${e && e.message ? e.message : e}`, 'warn');
          }
        });
      }

      return originalSend.apply(this, arguments);
    };

    internalLog('XMLHttpRequest hook ready');
  }

  function guardFetch() {
    if (!win.fetch || win.fetch.__tdrDatetimeStockPatched) return;

    const originalFetch = win.fetch.bind(win);

    function patchedFetch(input, init = {}) {
      const url = typeof input === 'string' ? input : input && input.url;

      return originalFetch(input, init).then(async res => {
        try {
          if (init && init.__tdrStockApi) {
            return res;
          }

          if (!isEndpointUrl(url)) {
            return res;
          }

          if (Date.now() < customApiPriorityUntil) {
            internalLog('カスタムAPI優先中のため通常API処理をスキップ');
            return res;
          }

          const clone = res.clone();
          const json = await clone.json();

          handleJSON(json, {
            sourceName: '通常API',
            customApi: false,
            apiMode: 'manual',
            useDate: getUseDateFromUrl()
          });
        } catch (e) {
          internalLog(`fetch処理エラー: ${e && e.message ? e.message : e}`, 'warn');
        }

        return res;
      });
    }

    patchedFetch.__tdrDatetimeStockPatched = true;
    win.fetch = patchedFetch;

    internalLog('fetch hook ready');
  }

  function handleJSON(json, context = {}) {
    const signature = JSON.stringify({
      useDate: context.useDate || getUseDateFromUrl(),
      sourceName: context.sourceName || '',
      json
    }).slice(0, 5000);

    const now = Date.now();

    if (signature === lastResponseSignature && now - lastResponseAt < 1000) {
      internalLog('同一APIレスポンス重複スキップ');
      return;
    }

    lastResponseSignature = signature;
    lastResponseAt = now;

    const receivedAt = tStrMs();

    setTimeout(() => {
      try {
        renderRows(json, {
          ...context,
          receivedAt
        });
      } catch (e) {
        console.error('[DaySearch] renderRows error', e);
      }
    }, DOM_WAIT_MS);
  }

  function flattenObjects(value, out = []) {
    if (!value) return out;

    if (Array.isArray(value)) {
      value.forEach(v => flattenObjects(v, out));
      return out;
    }

    if (typeof value === 'object') {
      out.push(value);
      Object.keys(value).forEach(k => {
        const v = value[k];
        if (v && typeof v === 'object') {
          flattenObjects(v, out);
        }
      });
    }

    return out;
  }

  function firstValue(obj, keys) {
    for (const k of keys) {
      if (obj && obj[k] != null && normalize(obj[k]) !== '') {
        return obj[k];
      }
    }
    return '';
  }

  function toIntOrNull(value) {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function parseApiRows(json) {
    const objects = flattenObjects(json);
    const rows = [];

    objects.forEach((obj, idx) => {
      const saleStatusRaw = firstValue(obj, [
        'saleStatus',
        'stockStatus',
        'vacancyStatus',
        'status'
      ]);

      const hasSaleStatus = saleStatusRaw !== '';
      const commodityCD = normalize(firstValue(obj, [
        'commodityCD',
        'commodityCd',
        'bedCommodityCD',
        'bedCommodityCd',
        'otherCommodityCD',
        'otherCommCd',
        'roomCommodityCD'
      ]));

      const roomCd = normalize(firstValue(obj, [
        'roomCd',
        'roomCD',
        'hotelRoomCd',
        'hotelRoomCD',
        'roomCode',
        'roomTypeCd'
      ]));

      const roomName = normalize(firstValue(obj, [
        'roomName',
        'roomNameJa',
        'roomTypeName',
        'guestRoomName',
        'bedRoomName',
        'hotelRoomName',
        'name'
      ]));

      const hotelName = normalize(firstValue(obj, [
        'hotelName',
        'searchHotelName',
        'hotelDisplayName',
        'hotelShortName'
      ]));

      const categoryLabel = normalize(firstValue(obj, [
        'categoryLabel',
        'categoryName',
        'roomCategoryName',
        'gradeName',
        'viewName',
        'bedTypeName'
      ]));

      if (!hasSaleStatus && !commodityCD && !roomCd) return;
      if (!hasSaleStatus && !roomName) return;

      const saleStatus = normalize(saleStatusRaw);
      const remainStockNum = toIntOrNull(firstValue(obj, [
        'remainStockNum',
        'stockNum',
        'vacancyNum',
        'remainNum',
        'roomStockNum'
      ]));

      rows.push({
        index: idx,
        commodityCD,
        roomCd,
        roomName,
        hotelName,
        categoryLabel,
        saleStatus,
        remainStockNum,
        raw: obj
      });
    });

    return dedupeRows(rows);
  }

  function dedupeRows(rows) {
    const seen = new Set();
    const result = [];

    rows.forEach(row => {
      const key = [
        row.commodityCD,
        row.roomCd,
        row.roomName,
        row.hotelName,
        row.categoryLabel,
        row.saleStatus,
        row.remainStockNum
      ].join('|');

      if (seen.has(key)) return;
      seen.add(key);
      result.push(row);
    });

    return result;
  }

  function buildOfficialDomOrder() {
    const byCommodity = new Map();
    const byRoomName = new Map();

    const hiddenCodes = $$('.vacancySearchParamCmdCd');
    hiddenCodes.forEach((el, idx) => {
      const block = el.closest('li, article, section, .room, .box, .card, .hotelRoom, .roomInfo') || el.parentElement;
      const commodityCD = normalize(el.value);
      const roomName = extractRoomNameFromBlock(block);
      const hotelName = extractHotelNameFromBlock(block);
      const categoryLabel = extractCategoryFromBlock(block);

      if (commodityCD && !byCommodity.has(commodityCD)) {
        byCommodity.set(commodityCD, {
          index: idx,
          commodityCD,
          roomName,
          hotelName,
          categoryLabel,
          element: block
        });
      }

      if (roomName && !byRoomName.has(roomName)) {
        byRoomName.set(roomName, {
          index: idx,
          commodityCD,
          roomName,
          hotelName,
          categoryLabel,
          element: block
        });
      }
    });

    if (!byCommodity.size) {
      const candidates = $$('li, article, section, .room, .box, .card, .hotelRoom, .roomInfo');
      candidates.forEach((el, idx) => {
        const roomName = extractRoomNameFromBlock(el);
        if (!roomName) return;

        const commodityCD = normalize(
          $('.bedCommodityCD, .vacancySearchParamCmdCd, input[name*="commodity"], input[name*="Commodity"]', el)?.value
        );

        const hotelName = extractHotelNameFromBlock(el);
        const categoryLabel = extractCategoryFromBlock(el);

        if (commodityCD && !byCommodity.has(commodityCD)) {
          byCommodity.set(commodityCD, {
            index: idx,
            commodityCD,
            roomName,
            hotelName,
            categoryLabel,
            element: el
          });
        }

        if (!byRoomName.has(roomName)) {
          byRoomName.set(roomName, {
            index: idx,
            commodityCD,
            roomName,
            hotelName,
            categoryLabel,
            element: el
          });
        }
      });
    }

    return {
      byCommodity,
      byRoomName,
      countCommodity: byCommodity.size,
      countRoomName: byRoomName.size
    };
  }

  function extractRoomNameFromBlock(block) {
    if (!block) return '';

    const selectors = [
      '.roomName',
      '.room-name',
      '.hotelRoomName',
      '.heading',
      'h2',
      'h3',
      'h4',
      '.title',
      '.name'
    ];

    for (const selector of selectors) {
      const el = $(selector, block);
      const text = normalize(el && el.textContent);
      if (isLikelyRoomName(text)) return text;
    }

    const lines = normalize(block.textContent).split(/(?=ホテル|スタンダード|スーペリア|デラックス|スペチアーレ|コンシェルジュ|グランドシャトー)/);
    return normalize(lines.find(isLikelyRoomName) || '');
  }

  function extractHotelNameFromBlock(block) {
    if (!block) return '';

    const text = normalize(block.textContent);

    const hotels = [
      'ファンタジースプリングスホテル',
      '東京ディズニーシー・ホテルミラコスタ',
      'ディズニーアンバサダーホテル',
      '東京ディズニーランドホテル',
      '東京ディズニーセレブレーションホテル',
      '東京ディズニーリゾート・トイ・ストーリーホテル'
    ];

    return hotels.find(h => text.includes(h)) || '';
  }

  function extractCategoryFromBlock(block) {
    if (!block) return '';

    const selectors = [
      '.category',
      '.roomCategory',
      '.room-category',
      '.grade',
      '.view',
      '.type'
    ];

    for (const selector of selectors) {
      const el = $(selector, block);
      const text = normalize(el && el.textContent);
      if (text) return text;
    }

    return '';
  }

  function isLikelyRoomName(text) {
    if (!text) return false;
    if (text.length < 4) return false;
    return /ルーム|スイート|サイド|ビュー|アルコーヴ|テラス|バルコニー|客室|ベッド/.test(text);
  }

  function getCommodityCodesFromDom() {
    const hiddenCodes = $$('.vacancySearchParamCmdCd')
      .map(el => normalize(el.value || ''))
      .filter(Boolean);

    if (hiddenCodes.length) return [...new Set(hiddenCodes)];

    const domOrder = buildOfficialDomOrder();
    return [...domOrder.byCommodity.keys()].filter(Boolean);
  }

  function applyDomOrder(rows, domOrder) {
    return rows.map((row, idx) => {
      const byCommodity = row.commodityCD ? domOrder.byCommodity.get(row.commodityCD) : null;
      const byRoomName = row.roomName ? domOrder.byRoomName.get(row.roomName) : null;
      const dom = byCommodity || byRoomName || null;

      return {
        ...row,
        domIndex: dom ? dom.index : 100000 + idx,
        roomName: row.roomName || dom?.roomName || '',
        hotelName: row.hotelName || dom?.hotelName || '',
        categoryLabel: row.categoryLabel || dom?.categoryLabel || ''
      };
    }).sort((a, b) => a.domIndex - b.domIndex || a.index - b.index);
  }

  function isRareRoom(row) {
    const text = `${row.hotelName} ${row.categoryLabel} ${row.roomName}`;
    return RARE_ROOM_KEYWORDS.some(k => text.includes(k));
  }

  function statusKind(row) {
    const s = String(row?.saleStatus ?? '');

    if (s === '0') return 'empty';
    if (s === '1') return 'full';
    if (s === '3') return 'unsold';

    return 'change';
  }

  function statusText(row) {
    const kind = statusKind(row);

    if (kind === 'empty') {
      if (row.remainStockNum != null) return `空${toCircled(row.remainStockNum)}`;
      return '空';
    }

    if (kind === 'full') return '満室';
    if (kind === 'unsold') return '未販売';

    return `状態${row.saleStatus}`;
  }

  function statusTextLong(row) {
    const kind = statusKind(row);

    if (kind === 'empty') {
      if (row.remainStockNum != null) return `空室${toCircled(row.remainStockNum)}`;
      return '空室';
    }

    if (kind === 'full') return '満室';
    if (kind === 'unsold') return '未販売';

    return `状態${row.saleStatus}`;
  }

  function rowStyle(row) {
    const kind = statusKind(row);

    if (kind === 'empty') {
      return 'color:#0b8f08;font-weight:bold;';
    }

    if (kind === 'full') {
      return 'color:#777;';
    }

    if (kind === 'unsold') {
      return 'color:#b26a00;font-weight:bold;';
    }

    return 'color:#333;';
  }

  function diffStatusStyle(change) {
    const status = notifyStatusForChange(change);

    if (status === 'empty') {
      return 'color:#0b8f08;font-weight:bold;';
    }

    if (status === 'full') {
      return 'color:#777;font-weight:bold;';
    }

    if (status === 'unsold') {
      return 'color:#b26a00;font-weight:bold;';
    }

    return 'color:#1565c0;font-weight:bold;';
  }

  function snapshotKey(useDateText, filterLabel) {
    const safeDate = String(useDateText || '').replace(/[^\d]/g, '');
    const filter = filterLabel === 'レア客室' ? 'rare' : 'all';
    return `${LS_PREFIX}snapshot_${SNAPSHOT_SCHEMA}_${safeDate}_${filter}`;
  }

  function rowSnapshot(row) {
    return {
      key: rowKey(row),
      hotelName: row.hotelName || '',
      categoryLabel: row.categoryLabel || '',
      roomName: row.roomName || '',
      commodityCD: row.commodityCD || '',
      roomCd: row.roomCd || '',
      saleStatus: String(row.saleStatus ?? ''),
      remainStockNum: row.remainStockNum
    };
  }

  function rowKey(row) {
    return [
      row.commodityCD || '',
      row.roomCd || '',
      row.hotelName || '',
      row.categoryLabel || '',
      row.roomName || ''
    ].join('|');
  }

  function compareAndStoreSnapshot(useDateText, filterLabel, rows) {
    const key = snapshotKey(useDateText, filterLabel);
    const now = Date.now();
    const currentRows = rows.map(rowSnapshot);

    let oldData = null;

    try {
      oldData = JSON.parse(localStorage.getItem(key) || 'null');
    } catch (e) {
      oldData = null;
    }

    localStorage.setItem(key, JSON.stringify({
      schema: SNAPSHOT_SCHEMA,
      createdAt: now,
      rows: currentRows
    }));

    if (!oldData || !Array.isArray(oldData.rows)) {
      return {
        status: 'baseline',
        message: '初回スナップショット作成'
      };
    }

    if (oldData.schema !== SNAPSHOT_SCHEMA) {
      return {
        status: 'baseline',
        message: 'スナップショット形式更新のため基準作成'
      };
    }

    if (now - Number(oldData.createdAt || 0) > SNAPSHOT_MAX_AGE_MS) {
      return {
        status: 'baseline',
        message: '前回スナップショットが古いため基準作成'
      };
    }

    const oldMap = new Map(oldData.rows.map(r => [r.key, r]));
    const changes = [];

    currentRows.forEach(nowRow => {
      const oldRow = oldMap.get(nowRow.key);
      if (!oldRow) return;

      const oldSig = `${oldRow.saleStatus}|${oldRow.remainStockNum}`;
      const nowSig = `${nowRow.saleStatus}|${nowRow.remainStockNum}`;

      if (oldSig !== nowSig) {
        changes.push({
          old: oldRow,
          now: nowRow
        });
      }
    });

    if (!changes.length) {
      return { status: 'none', changes: [] };
    }

    changes.forEach(sendDiscordChange);

    return {
      status: 'changed',
      changes
    };
  }

  function notifyStatusForChange(change) {
    const now = change.now;
    const old = change.old;

    if (now && String(now.saleStatus) === '0') return 'empty';
    if (now && String(now.saleStatus) === '1') return 'full';
    if (now && String(now.saleStatus) === '3') return 'unsold';

    if (old && String(old.saleStatus) === '0') return 'full';

    return 'change';
  }

  function statusTransitionText(change) {
    const oldText = change.old ? statusTextLong(change.old) : 'なし';
    const nowText = change.now ? statusTextLong(change.now) : 'なし';
    return `${oldText} → ${nowText}`;
  }

  function statusTransitionTextShort(change) {
    const oldText = change.old ? statusText(change.old) : 'なし';
    const nowText = change.now ? statusText(change.now) : 'なし';
    return `${oldText}→${nowText}`;
  }

  function sendDiscordChange(change) {
    const status = notifyStatusForChange(change);
    const base = change.now || change.old;

    enqueueDiscord({
      username: SCRIPT_NAME,
      embeds: [{
        title: `${TITLE_EMOJI[status] || '🔔'} **${tStrForTitle()}**\n${getUseDateText()} ${statusTransitionText(change)}\n${base.roomName || ''}`,
        color: DISCORD_COLOR[status] || DISCORD_COLOR.error
      }],
      allowed_mentions: { parse: [] }
    });
  }

  function logDiffSummary(diffResult, sourceName, useDateText, filterLabel) {
    if (!diffResult) return;

    const title = diffResult.status === 'changed'
      ? `在庫差分 / ${diffResult.changes.length}件`
      : '在庫差分 / なし';

    const groupFn = diffResult.status === 'changed'
      ? console.group.bind(console)
      : console.groupCollapsed.bind(console);

    groupFn(title);

    if (diffResult.status === 'changed') {
      diffResult.changes.forEach(change => {
        const base = change.now || change.old;
        const style = diffStatusStyle(change);
        const line = `${statusTransitionTextShort(change)}　${base?.roomName || ''}`;

        console.log(`%c${line}`, style);
      });

      if (!notifyEnabled) {
        console.info('Discord通知OFFのため送信しません');
      }
    } else if (diffResult.status === 'none') {
      console.info('在庫差分なし');
    } else if (diffResult.status === 'baseline') {
      console.info(diffResult.message);
    } else if (diffResult.status === 'skipped') {
      console.warn(diffResult.message);
    }

    console.groupEnd();
  }

  function renderRows(json, context = {}) {
    const sourceName = context.sourceName || '通常API';
    const useDate = context.useDate || getUseDateFromUrl();
    const useDateText = getUseDateText(useDate);
    const filterLabel = getFilterLabel();
    const displayMode = 'all';

    const domOrder = buildOfficialDomOrder();
    const allRowsRaw = parseApiRows(json);
    const allRows = applyDomOrder(allRowsRaw, domOrder);
    const targetRows = rareFilterEnabled ? allRows.filter(isRareRoom) : allRows;
    const rows = targetRows;

    const apiReceivedAt = context.receivedAt || tStrMs();

    const diffResult = compareAndStoreSnapshot(useDateText, filterLabel, targetRows);

    console.groupCollapsed(
      `%c${apiReceivedAt}`,
      'background:#111;color:#fff;font-weight:900;font-size:13px;padding:1px 6px;border-radius:3px;line-height:1.1;'
    );

    console.info(`対象: ${sourceName}`);
    console.info(`useDate: ${useDateText}`);
    console.info(`フィルター: ${filterLabel}`);
    console.info(`表示モード: ${displayMode === 'emptyOnly' ? '空室のみ' : 'すべて'}`);
    console.info(`DOM読込: bed=${domOrder.countCommodity} / room=${domOrder.countRoomName}`);
    console.info(`ログ集計: 表示${rows.length}件 / 対象${targetRows.length}件 / 全${allRows.length}件`);
    flushInternalLogs();
    console.groupEnd();

    const isShortMode = context.customApi && context.apiMode === 'short';
    const roomGroupFn = isShortMode && typeof console.groupCollapsed === 'function'
      ? console.groupCollapsed.bind(console)
      : console.group.bind(console);

    const dateTitleStyle = sourceName === '翌日API'
      ? 'background:#6a1b9a;color:#fff;font-weight:900;padding:1px 6px;border-radius:3px;line-height:1.1;'
      : 'color:inherit;font-weight:700;';

    roomGroupFn(
      `%c${useDateText}%c / ${filterLabel} / 表示${rows.length}件`,
      dateTitleStyle,
      'color:inherit;font-weight:normal;'
    );

    console.info(`対象: ${sourceName}`);
    console.info(`対象${targetRows.length}件 / 全${allRows.length}件`);

    logRoomRows(rows);

    console.groupEnd();

    logDiffSummary(diffResult, sourceName, useDateText, filterLabel);

    updateApiButtonPanel();
  }

  function logRoomRows(rows) {
    let lastHotel = null;
    let lastCategory = null;

    rows.forEach(r => {
      const hotelName = r.hotelName || 'ホテル不明';
      const categoryLabel = r.categoryLabel || '';

      if (hotelName !== lastHotel) {
        console.log(
          `%c▼ ${hotelName}`,
          'color:#fff;background:#455a64;font-weight:700;font-size:12px;padding:1px 6px;border-radius:2px;line-height:1.1;'
        );
        lastHotel = hotelName;
        lastCategory = null;
      }

      if (SHOW_CATEGORY_HEADER && categoryLabel && categoryLabel !== lastCategory) {
        console.log(
          `%c  ◆ ${categoryLabel}`,
          'color:#555;font-weight:bold;background:#f2f2f2;padding:1px 4px;line-height:1.1;'
        );
        lastCategory = categoryLabel;
      }

      const status = statusText(r);
      const hiddenPrefix = ''.padStart(ROOM_LOG_INDENT_CH, '　');
      console.log(
        `%c${hiddenPrefix}%c${status}　${r.roomName || '(客室名不明)'}`,
        HIDDEN_STYLE,
        rowStyle(r)
      );
    });

    if (!rows.length) {
      console.info('表示対象なし');
    }
  }

  function createBodyForStockApi(useDate) {
    const params = new URLSearchParams();

    const pageParams = new URLSearchParams(location.search);
    pageParams.forEach((value, key) => {
      if (value != null && value !== '') {
        params.set(key, value);
      }
    });

    params.set('useDate', useDate);

    const commodityCodes = getCommodityCodesFromDom();

    if (commodityCodes.length) {
      commodityCodes.forEach(code => {
        params.append('commodityCD', code);
      });
    }

    const hiddenInputs = $$('input[type="hidden"]');
    hiddenInputs.forEach(input => {
      const name = normalize(input.name);
      const value = normalize(input.value);

      if (!name || value === '') return;

      if (name === 'useDate') return;
      if (/commodity/i.test(name)) return;

      if (!params.has(name)) {
        params.set(name, value);
      }
    });

    return params;
  }

  async function requestStockApiCore(kind, reason = '') {
    const cfg = API_KIND[kind];
    if (!cfg) return null;

    const baseUseDate = getUseDateFromUrl();
    const targetUseDate = kind === 'next' ? addDateYmd(baseUseDate, 1) : baseUseDate;
    const targetUrl = new URL(location.href);
    targetUrl.searchParams.set('useDate', targetUseDate);

    const body = createBodyForStockApi(targetUseDate);

    customApiPriorityUntil = Date.now() + 5000;

    internalLog(`${cfg.label}発火: URL基準=${baseUseDate} / target=${targetUseDate} / commodity=${getCommodityCodesFromDom().length}`);

    const res = await win.fetch(API_URL, {
      method: 'POST',
      mode: 'cors',
      credentials: 'include',
      referrer: targetUrl.toString(),
      headers: {
        accept: 'application/json, text/javascript, */*; q=0.01',
        'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        'x-queueit-ajaxpageurl': encodeURIComponent(targetUrl.toString())
      },
      body: body.toString(),
      __tdrStockApi: true
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = await res.json();

    handleJSON(json, {
      sourceName: cfg.label,
      customApi: true,
      apiMode: apiAutoMode[kind],
      useDate: targetUseDate,
      reason
    });

    return json;
  }

  async function runApi(kind, reason = 'manual') {
    const cfg = API_KIND[kind];
    if (!cfg) return;

    if (apiBusy[kind]) {
      internalLog(`${cfg.label} 実行中のためスキップ`, 'warn');
      return;
    }

    clearApiAutoTimer(kind);
    apiBusy[kind] = true;
    updateApiButtonPanel();

    try {
      await requestStockApiCore(kind, reason);
      handleApiSuccess(kind);

      if (apiAutoMode[kind] !== 'manual') {
        scheduleApiAuto(kind, { reason });
      }
    } catch (e) {
      const result = await handleApiError(kind, e);

      if (result.stopAuto) {
        stopAllApiAuto(`${cfg.label} エラー多発`);
      } else if (apiAutoMode[kind] !== 'manual') {
        scheduleApiAuto(kind, { backoffMs: result.backoffMs || 0, reason });
      }
    } finally {
      apiBusy[kind] = false;
      updateApiButtonPanel();
    }
  }

  function scheduleApiAuto(kind, options = {}) {
    const cfg = API_KIND[kind];
    if (!cfg) return;

    clearApiAutoTimer(kind);

    const mode = apiAutoMode[kind];
    if (mode === 'manual') return;

    let delayMs = Number(options.backoffMs || 0);

    if (!delayMs) {
      if (mode === 'short') {
        delayMs = 0;
      } else if (mode === 'long') {
        delayMs = randomInt(9 * 60 * 1000, 11 * 60 * 1000);
      }
    }

    if (isMaintenanceTime()) {
      delayMs = getMaintenanceDelayMs();
      internalLog(`${cfg.label} メンテ待機: ${Math.ceil(delayMs / 1000)}秒`);
    } else {
      internalLog(`${cfg.label} 自動API: ${MODE[mode].label.replace(/[👆️🏃‍♀️🚶]/g, '').trim() || MODE[mode].label} / ${Math.ceil(delayMs / 1000)}秒後`);
    }

    apiTimers[kind] = setTimeout(() => {
      apiTimers[kind] = null;
      runApi(kind, 'auto');
    }, delayMs);

    updateApiButtonPanel();
  }

  function clearApiAutoTimer(kind) {
    if (apiTimers[kind]) {
      clearTimeout(apiTimers[kind]);
      apiTimers[kind] = null;
    }
  }

  function randomInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  function setApiAutoMode(kind, mode) {
    if (!API_KIND[kind]) return;
    if (!MODE[mode]) mode = 'manual';

    apiAutoMode[kind] = mode;
    writeMode(API_KIND[kind].modeKey, mode);

    if (mode === 'manual') {
      clearApiAutoTimer(kind);
    } else {
      scheduleApiAuto(kind, { reason: 'mode-change' });
    }

    updateApiButtonPanel();
  }

  function cycleApiMode(kind) {
    const current = apiAutoMode[kind];

    const next = current === 'manual'
      ? 'short'
      : current === 'short'
        ? 'long'
        : 'manual';

    setApiAutoMode(kind, next);
  }

  function initPanel() {
    if (panelRoot || !document.documentElement) return;

    panelRoot = document.createElement('div');
    panelRoot.id = '__tdr_datetime_stock_panel';
    panelRoot.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'z-index:2147483647',
      'display:flex',
      'flex-wrap:wrap',
      'gap:4px',
      'width:144px',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
      'font-size:12px',
      'line-height:1'
    ].join(';');

    notifyBtn = createPanelButton('');
    rareBtn = createPanelButton('');
    currentApiBtn = createPanelButton('当');
    nextApiBtn = createPanelButton('翌');
    currentModeBtn = createPanelButton('');
    nextModeBtn = createPanelButton('');

    notifyBtn.addEventListener('click', () => {
      notifyEnabled = !notifyEnabled;
      writeBool(LS_NOTIFY, notifyEnabled);
      webhookStatusLogged = false;
      logWebhookStatus(true);
      updateApiButtonPanel();
    });

    rareBtn.addEventListener('click', () => {
      rareFilterEnabled = !rareFilterEnabled;
      writeBool(LS_RARE, rareFilterEnabled);
      updateApiButtonPanel();
      internalLog(`レア客室フィルター: ${rareFilterEnabled ? 'ON' : 'OFF'}`);
    });

    currentApiBtn.addEventListener('click', () => runApi('current', 'button'));
    nextApiBtn.addEventListener('click', () => runApi('next', 'button'));

    currentModeBtn.addEventListener('click', () => cycleApiMode('current'));
    nextModeBtn.addEventListener('click', () => cycleApiMode('next'));

    panelRoot.appendChild(notifyBtn);
    panelRoot.appendChild(rareBtn);
    panelRoot.appendChild(currentApiBtn);
    panelRoot.appendChild(nextApiBtn);
    panelRoot.appendChild(currentModeBtn);
    panelRoot.appendChild(nextModeBtn);

    document.documentElement.appendChild(panelRoot);

    updateApiButtonPanel();
  }

  function createPanelButton(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = [
      'border:none',
      'border-radius:4px',
      'padding:6px 0',
      'width:68px',
      'min-height:28px',
      'font-size:13px',
      'font-weight:bold',
      'color:#fff',
      'box-shadow:0 1px 4px rgba(0,0,0,.35)',
      'cursor:pointer'
    ].join(';');
    return btn;
  }

  function updateButton(btn, text, bg, color = '#fff') {
    if (!btn) return;
    btn.textContent = text;
    btn.style.background = bg;
    btn.style.color = color;
  }

  function updateApiButtonPanel() {
    updateButton(
      notifyBtn,
      notifyEnabled ? '🔔ON' : '🔔OFF',
      notifyEnabled ? '#fdd835' : '#666',
      notifyEnabled ? '#111' : '#fff'
    );

    updateButton(
      rareBtn,
      rareFilterEnabled ? '★レア' : '全',
      rareFilterEnabled ? '#ff9800' : '#607d8b',
      '#fff'
    );

    const currentBusy = apiBusy.current;
    const nextBusy = apiBusy.next;

    updateButton(
      currentApiBtn,
      currentBusy ? '当…' : '当',
      currentBusy ? '#ff1744' : nextBusy ? '#7f1d1d' : '#2e7d32',
      '#fff'
    );

    updateButton(
      nextApiBtn,
      nextBusy ? '翌…' : '翌',
      nextBusy ? '#ff1744' : currentBusy ? '#7f1d1d' : '#6a1b9a',
      '#fff'
    );

    updateButton(
      currentModeBtn,
      `当${MODE[apiAutoMode.current].short}`,
      MODE[apiAutoMode.current].bg,
      '#fff'
    );

    updateButton(
      nextModeBtn,
      `翌${MODE[apiAutoMode.next].short}`,
      MODE[apiAutoMode.next].bg,
      '#fff'
    );
  }

  function waitForBody() {
    if (document.documentElement) {
      initPanel();
      return;
    }

    setTimeout(waitForBody, 50);
  }

  function boot() {
    patchXHR();
    guardFetch();
    waitForBody();

    logWebhookStatus();
    internalLog('official DOM-order logger ready / rare room filter / v1.87');

    if (apiAutoMode.current !== 'manual') {
      scheduleApiAuto('current', { reason: 'boot' });
    }

    if (apiAutoMode.next !== 'manual') {
      scheduleApiAuto('next', { reason: 'boot' });
    }
  }

  boot();
})();
