// ==UserScript==
// @name         📋️日時指定在庫モニター
// @version      1.86
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/?useDate*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/hotel_list.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/hotel_list.js
// @run-at       document-start
// @inject-into  page
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (win.__TDR_DATETIME_STOCK_MONITOR_RUNNING__) {
    console.warn('[DaySearch] すでに起動済みのため停止');
    return;
  }
  win.__TDR_DATETIME_STOCK_MONITOR_RUNNING__ = '1.86';

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

  const HOTEL_ORDER = ['FSH', 'TDH', 'DAH', 'DHM', 'TSH', 'DCH'];

  const IDS = {
    notify: '__datetime_stock_monitor_notify_panel',
    rare: '__datetime_stock_monitor_rare_filter_panel',
    current: '__datetime_stock_monitor_currentday_panel',
    currentMode: '__datetime_stock_monitor_currentday_mode_panel',
    next: '__datetime_stock_monitor_nextday_panel',
    nextMode: '__datetime_stock_monitor_nextday_mode_panel',
    oldAuto: '__daysearch_auto_reload_panel',
    auto: '__datetime_stock_monitor_auto_panel'
  };

  const KEYS = {
    notify: 'datetime_stock_monitor_notify_enabled',
    rare: 'datetime_stock_monitor_rare_filter_enabled_v178',
    currentMode: 'datetime_stock_monitor_currentday_auto_mode_v178',
    nextMode: 'datetime_stock_monitor_nextday_auto_mode_v178',
    snapshot: 'datetime_stock_monitor_notify_snapshot_'
  };

  const OLD_KEYS = [
    'datetime_stock_monitor_auto_mode',
    'datetime_stock_monitor_auto_next_at',
    'daysearch_auto_reload_enabled',
    'daysearch_auto_reload_next_at',
    'datetime_stock_monitor_currentday_auto_mode',
    'datetime_stock_monitor_nextday_auto_mode',
    'datetime_stock_monitor_currentday_auto_mode_v175',
    'datetime_stock_monitor_nextday_auto_mode_v175',
    'datetime_stock_monitor_currentday_auto_mode_v176',
    'datetime_stock_monitor_nextday_auto_mode_v176',
    'datetime_stock_monitor_currentday_auto_mode_v177',
    'datetime_stock_monitor_nextday_auto_mode_v177'
  ];

  const RARE_ROOM_CODES = new Set([
    'HODHMTVD0005N',
    'HODHMIKT0006N',
    'HODHMHOW0005N',
    'HODHMHKQ0005N',
    'HODHMIKQ0006N',
    'HODHMBOQ0004N',
    'HODHMBKT0004N',
    'HODHMBKQ0004N',
    'HODHMTOD0004N',
    'HODHMTKD0004N',
    'HODHMTGD0004N',
    'HOFSHSGA0001N',
    'HOFSHSBT0001N',
    'HOFSHSBA0001N'
  ]);

  const API_AUTO_MODES = {
    manual: { label: '👆️', name: '手動', background: '#111', color: '#fff' },
    short: { label: '🏃‍♀️', name: '短期', background: '#ff9800', color: '#111' },
    long: { label: '🚶', name: '長期', background: '#1976d2', color: '#fff' }
  };

  const API_MODE_ORDER = ['manual', 'short', 'long'];

  const API_KIND = {
    current: {
      offset: 0,
      label: '当日API',
      buttonText: '当',
      top: '42px',
      buttonBackground: '#00838f',
      buttonBorder: '#006064',
      modeId: IDS.currentMode,
      buttonId: IDS.current,
      storageKey: KEYS.currentMode
    },
    next: {
      offset: 1,
      label: '翌日API',
      buttonText: '翌',
      top: '74px',
      buttonBackground: '#6a1b9a',
      buttonBorder: '#4a148c',
      modeId: IDS.nextMode,
      buttonId: IDS.next,
      storageKey: KEYS.nextMode
    }
  };

  const FULL_LABEL = { 0: '空室', 1: '満室', 2: '吸収', 3: '未販' };
  const TITLE_EMOJI = { 0: '🟥', 1: '⬛️', 2: '🟦', 3: '🟩' };
  const LABEL = { 0: '空', 1: '満', 2: '吸', 3: '未' };
  const STYLE = { 0: 'color:red', 1: 'color:inherit', 2: 'color:blue', 3: 'color:green' };
  const DISCORD_COLOR = { 0: 16711680, 1: 1, 2: 255, 3: 32768, error: 0xFFFF00 };

  const PANEL = {
    right: '14px',
    modeRight: '48px',
    minWidth: '28px',
    height: '26px'
  };

  let notifyPanel = null;
  let rarePanel = null;
  let popupElem = null;

  const apiButtonPanels = { current: null, next: null };
  const apiModePanels = { current: null, next: null };
  const apiAutoMode = { current: 'manual', next: 'manual' };
  const apiAutoTimer = { current: 0, next: 0 };
  const discordQueue = [];
  const internalLogs = [];

  let notifyEnabled = false;
  let rareFilterEnabled = false;
  let apiBusy = false;
  let apiBusyKind = '';
  let activeUseDateOverride = '';
  let activeSourceLabel = '';
  let customApiPriorityUntil = 0;
  let lastJsonKey = '';
  let lastJsonAt = 0;
  let webhookStatusLogged = false;
  let discordSending = false;
  let consecutiveErrorCount = 0;
  let fatalErrorCount = 0;
  let cachedIP = 'unknown';
  let lastIPFetchTime = 0;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const pad = (x, len = 2) => String(x).padStart(len, '0');
  const normalize = s => String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[（）]/g, m => m === '（' ? '(' : ')')
    .replace(/\s+/g, ' ')
    .trim();

  const keyText = s => normalize(s).replace(/\s+/g, '');
  const inputValue = (root, sel) => normalize($(sel, root)?.value || '');
  const isStatus = (v, n) => String(v).trim() === String(n);
  const stockText = v => (v === undefined || v === null || v === '') ? '0' : String(v);
  const leftText = (label, stock) => `${label} ${stock}  `;

  const storage = {
    get: key => {
      try { return win.localStorage.getItem(key); } catch { return null; }
    },
    set: (key, value) => {
      try {
        win.localStorage.setItem(key, value);
        return true;
      } catch (e) {
        internalLog(`localStorage保存失敗: ${key} / ${e?.message || e}`, 'warn');
        return false;
      }
    },
    remove: key => {
      try { win.localStorage.removeItem(key); } catch {}
    }
  };

  function nowMs() {
    const a = Number(Date.now?.());
    if (Number.isFinite(a) && a > 0) return Math.floor(a);
    const b = Number(new Date().getTime());
    if (Number.isFinite(b) && b > 0) return Math.floor(b);
    try {
      const origin = Number(win.performance?.timeOrigin);
      const now = Number(win.performance?.now?.());
      if (Number.isFinite(origin) && Number.isFinite(now) && origin > 0) return Math.floor(origin + now);
    } catch {}
    return 0;
  }

  function stableHash(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  const tStrMs = () => {
    const d = new Date();
    return `${d.toTimeString().slice(0, 8)}.${pad(d.getMilliseconds(), 3)}`;
  };

  const tStrFullMs = () => {
    const d = new Date();
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${d.toTimeString().slice(0, 8)}.${pad(d.getMilliseconds(), 3)}`;
  };

  const tStrForTitle = () => {
    const d = new Date();
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${d.toTimeString().slice(0, 8)}`;
  };

  const getClockStr = () => new Date().toTimeString().slice(0, 8);

  function internalLog(message, level = 'info') {
    internalLogs.push({
      at: tStrMs(),
      level,
      message: String(message || '')
    });

    if (internalLogs.length > 100) internalLogs.shift();
  }

  function flushInternalLogs() {
    if (!internalLogs.length) return;

    internalLogs.splice(0).forEach(item => {
      const line = `${item.at} ${item.message}`;
      if (item.level === 'warn') console.warn(line);
      else if (item.level === 'error') console.error(line);
      else console.info(line);
    });
  }

  function toCircled(num) {
    if (num >= 1 && num <= 20) return String.fromCharCode(0x245F + num);
    if (num >= 21 && num <= 35) return String.fromCharCode(0x3251 + num - 21);
    return `(${num})`;
  }

  function getRareRuleHash() {
    return stableHash([...RARE_ROOM_CODES].sort().join('|'));
  }

  function getFilterLabel() {
    return rareFilterEnabled ? 'レア客室' : '全客室';
  }

  function isRareRoomRow(row) {
    return RARE_ROOM_CODES.has(normalize(row?.roomCd || '').toUpperCase());
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randomLongDelayMs() {
    return randomInt(9 * 60 * 1000, 11 * 60 * 1000);
  }

  function ymdAddDays(ymd, days) {
    if (!/^\d{8}$/.test(String(ymd || ''))) return '';
    const d = new Date(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)) + days);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  }

  function getUrlUseDateYmd() {
    try {
      const ymd = normalize(new URL(location.href).searchParams.get('useDate') || '').replace(/[^\d]/g, '');
      return /^\d{8}$/.test(ymd) ? ymd : '';
    } catch {
      return '';
    }
  }

  const getActiveUseDateYmd = () => activeUseDateOverride || getUrlUseDateYmd();
  const getSnapshotDateKey = () => getActiveUseDateYmd() || '';

  function isTargetSpHotelList() {
    try {
      const u = new URL(location.href);
      return u.hostname === 'reserve.tokyodisneyresort.jp' &&
        u.pathname === '/sp/hotel/list/' &&
        !!u.searchParams.get('useDate');
    } catch {
      return false;
    }
  }

  function urlWithUseDate(ymd) {
    try {
      const u = new URL(location.href);
      u.searchParams.set('useDate', ymd);
      return u.href;
    } catch {
      return location.href;
    }
  }

  function pageParam(name, fallback = '') {
    if (name === 'useDate') return getUrlUseDateYmd() || fallback;

    const fromUrl = new URLSearchParams(location.search).get(name);
    if (fromUrl !== null && fromUrl !== undefined && fromUrl !== '') return fromUrl;

    const map = {
      stayingDays: ['input[name="stayingDays"]', '.stayNum', '.otherStaylings'],
      adultNum: ['input[name="adultNum"]', '.adultNum'],
      childNum: ['input[name="childNum"]', '.childNum'],
      roomsNum: ['input[name="roomsNum"]', '.roomsNum', '.otherRoomNums'],
      childAgeBedInform: ['input[name="childAgeBedInform"]', '#s_childAgeBedInform'],
      searchHotelCD: ['#js-searchHotelCD', 'input[name="searchHotelCD"]'],
      searchHotelName: ['input[name="searchHotelName"]'],
      searchRoomName: ['input[name="searchRoomName"]']
    };

    for (const sel of map[name] || [`[name="${name}"]`]) {
      const v = normalize($(sel)?.value || '');
      if (v) return v;
    }
    return fallback;
  }

  function getRequestBodyUseDate(body) {
    try {
      if (!body) return '';

      let params = null;
      if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) params = body;
      else if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const ymd = normalize(body.get('useDate') || '').replace(/[^\d]/g, '');
        return /^\d{8}$/.test(ymd) ? ymd : '';
      } else if (typeof body === 'string') params = new URLSearchParams(body);
      else if (body?.toString && String(body).includes('useDate=')) params = new URLSearchParams(String(body));

      const ymd = normalize(params?.get('useDate') || '').replace(/[^\d]/g, '');
      return /^\d{8}$/.test(ymd) ? ymd : '';
    } catch {
      return '';
    }
  }

  function cleanHeadingText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script,style,input,img,.message,.roomFullMsg,.icon,.price,.notice,.priceLoding,.detailPrice,.thumb,.btn')
      .forEach(x => x.remove());
    return normalize(clone.textContent || '').replace(/^満室\s*/g, '').replace(/^空室\s*/g, '').trim();
  }

  function getHotelCdFromDiv(el) {
    for (const cd of HOTEL_ORDER) if (el.classList.contains(cd)) return cd;
    const hiddenCd = inputValue(el, '.bedHotelCd') || inputValue(el, '.otherHotelCd') || inputValue(el, '.detailHotelCd');
    return HOTEL_ORDER.find(cd => hiddenCd.includes(cd)) || '';
  }

  function getHotelCdFromApi(groupKey, group) {
    const raw = String(group?.hotelCd || group?.hotelCD || group?.hotelId || group?.hotelID || groupKey || '');
    return HOTEL_ORDER.find(cd => raw.includes(cd)) || raw || 'UNKNOWN';
  }

  function getMaintenanceDelayMs() {
    const d = new Date();
    const h = d.getHours();
    const m = d.getMinutes();

    if (h < 3 || h >= 5) return 0;
    if (h === 4 && m === 59) return 1000;
    if (h === 4 && m >= 55) return 10000;
    return 600000;
  }

  function isBurstTime() {
    const d = new Date();
    const h = d.getHours();
    const m = d.getMinutes();
    return (h === 10 && m === 59) || (h === 11 && m >= 0 && m <= 4);
  }

  const todayYmd = () => {
    const d = new Date();
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  };

  function extractYmdFromScope(scope) {
    const ymd = String(new URLSearchParams(String(scope || '')).get('useDate') || '').replace(/[^\d]/g, '');
    return /^\d{8}$/.test(ymd) ? ymd : '';
  }

  const getSchemaReason = data => data?.schema === SNAPSHOT_SCHEMA ? '' : '旧形式スナップショット';

  function getSavedAtReason(data) {
    const savedAt = Number(data?.savedAt || 0);
    if (!Number.isFinite(savedAt) || savedAt <= 0) return 'savedAt不正';
    const currentMs = nowMs();
    if (!currentMs) return '';
    const ageMs = currentMs - savedAt;
    return ageMs > SNAPSHOT_MAX_AGE_MS ? `1時間超過 ${Math.floor(ageMs / 1000)}秒` : '';
  }

  function getPastStayReason(data) {
    const ymd = data?.useDate || extractYmdFromScope(data?.scope);
    return ymd && ymd < todayYmd() ? `過去宿泊日 ${ymd}` : '';
  }

  const getCleanupReason = data => getSchemaReason(data) || getPastStayReason(data) || getSavedAtReason(data);
  const getCurrentSnapshotDropReason = data => getSchemaReason(data) || getSavedAtReason(data) || (data?.useDate || extractYmdFromScope(data?.scope) ? '' : 'useDate不明');

  function getSnapshotScope() {
    const values = {
      useDate: getSnapshotDateKey(),
      stayingDays: pageParam('stayingDays', '1'),
      roomsNum: pageParam('roomsNum', '1'),
      adultNum: pageParam('adultNum', '2'),
      childNum: pageParam('childNum', '0'),
      searchHotelCD: pageParam('searchHotelCD', ''),
      searchHotelName: pageParam('searchHotelName', ''),
      searchRoomName: pageParam('searchRoomName', ''),
      rareFilter: rareFilterEnabled ? '1' : '0',
      rareRuleHash: rareFilterEnabled ? getRareRuleHash() : ''
    };
    return Object.keys(values).map(k => `${k}=${values[k] || ''}`).join('&');
  }

  function getSnapshotStorageKey() {
    const ymd = getSnapshotDateKey();
    return ymd ? `${KEYS.snapshot}${ymd}_${stableHash(getSnapshotScope())}` : '';
  }

  function cleanupExpiredSnapshots() {
    const currentKey = getSnapshotStorageKey();
    let removed = 0;

    try {
      Object.keys(win.localStorage)
        .filter(k => k.startsWith(KEYS.snapshot))
        .forEach(k => {
          if (currentKey && k === currentKey) return;
          try {
            const data = JSON.parse(win.localStorage.getItem(k) || '{}');
            const reason = getCleanupReason(data);
            if (!reason) return;
            win.localStorage.removeItem(k);
            removed++;
            internalLog(`在庫スナップショット削除: ${reason} / ${k}`);
          } catch {
            win.localStorage.removeItem(k);
            removed++;
            internalLog(`破損スナップショット削除: ${k}`, 'warn');
          }
        });
    } catch {
      return;
    }

    if (removed) internalLog(`在庫スナップショット削除合計: ${removed}件`);
  }

  function initState() {
    OLD_KEYS.forEach(k => storage.remove(k));
    document.getElementById(IDS.auto)?.remove();
    document.getElementById(IDS.oldAuto)?.remove();

    Object.keys(API_KIND).forEach(kind => {
      const saved = storage.get(API_KIND[kind].storageKey);
      apiAutoMode[kind] = API_AUTO_MODES[saved] ? saved : 'manual';
    });

    notifyEnabled = storage.get(KEYS.notify) === '1';
    rareFilterEnabled = storage.get(KEYS.rare) === '1';
  }

  function saveApiAutoState(kind) {
    storage.set(API_KIND[kind].storageKey, apiAutoMode[kind]);
  }

  function nextApiMode(kind) {
    const i = API_MODE_ORDER.indexOf(apiAutoMode[kind]);
    return API_MODE_ORDER[i >= 0 ? (i + 1) % API_MODE_ORDER.length : 0];
  }

  function setApiAutoMode(kind, modeName) {
    if (!API_KIND[kind]) return;

    apiAutoMode[kind] = API_AUTO_MODES[modeName] ? modeName : 'manual';
    saveApiAutoState(kind);
    updateApiModePanel(kind);

    internalLog(`${API_KIND[kind].label} 自動モード: ${API_AUTO_MODES[apiAutoMode[kind]].name}`);

    clearApiAutoTimer(kind);
    if (apiAutoMode[kind] !== 'manual') {
      scheduleApiAuto(kind, { immediate: apiAutoMode[kind] === 'short', reason: 'modeChange' });
    }
  }

  function stopAllApiAuto(reason = '') {
    console.warn(`自動API停止: ${reason || 'エラー多発'}`);
    Object.keys(API_KIND).forEach(kind => setApiAutoMode(kind, 'manual'));
  }

  function makePanel(id, top, onClick, right = PANEL.right) {
    document.getElementById(id)?.remove();

    const el = document.createElement('div');
    el.id = id;
    Object.assign(el.style, {
      position: 'fixed',
      top,
      right,
      zIndex: '2147483647',
      minWidth: PANEL.minWidth,
      height: PANEL.height,
      padding: '1px 3px',
      borderRadius: '5px',
      boxShadow: '0 2px 7px rgba(0,0,0,.35)',
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      fontWeight: 'bold',
      lineHeight: PANEL.height,
      cursor: 'pointer',
      userSelect: 'none',
      textAlign: 'center',
      border: '1px solid rgba(255,255,255,.75)'
    });
    el.addEventListener('click', onClick);
    document.body.appendChild(el);
    return el;
  }

  function showPopup(txt, bgColor, textColor = '#fff') {
    if (!document.body) return;

    if (!popupElem || !document.body.contains(popupElem)) {
      popupElem = document.createElement('div');
      popupElem.style.cssText = [
        'position:fixed',
        'left:50%',
        'bottom:15%',
        'transform:translateX(-50%)',
        'padding:4px 12px',
        'font-size:14px',
        'font-weight:bold',
        'border-radius:20px',
        'z-index:2147483647',
        'user-select:none',
        'cursor:pointer',
        'box-shadow:0 4px 10px rgba(0,0,0,0.5)',
        'text-align:center',
        'white-space:pre-wrap',
        'transition:background-color 0.1s, color 0.1s'
      ].join(';');
      popupElem.onclick = hidePopup;
      document.body.appendChild(popupElem);
    }

    popupElem.innerText = txt;
    popupElem.style.backgroundColor = bgColor;
    popupElem.style.color = textColor;
  }

  function hidePopup() {
    if (popupElem) {
      popupElem.remove();
      popupElem = null;
    }
  }

  function ensurePanels() {
    if (!document.body) return;

    document.getElementById(IDS.auto)?.remove();
    document.getElementById(IDS.oldAuto)?.remove();

    if (!rarePanel || !document.body.contains(rarePanel)) rarePanel = makePanel(IDS.rare, '8px', toggleRareFilter, PANEL.modeRight);
    if (!notifyPanel || !document.body.contains(notifyPanel)) notifyPanel = makePanel(IDS.notify, '8px', toggleNotify, PANEL.right);

    Object.keys(API_KIND).forEach(kind => {
      const cfg = API_KIND[kind];
      if (!apiModePanels[kind] || !document.body.contains(apiModePanels[kind])) {
        apiModePanels[kind] = makePanel(cfg.modeId, cfg.top, () => setApiAutoMode(kind, nextApiMode(kind)), PANEL.modeRight);
      }
      if (!apiButtonPanels[kind] || !document.body.contains(apiButtonPanels[kind])) {
        apiButtonPanels[kind] = makePanel(cfg.buttonId, cfg.top, () => runStockApiOnce(kind, '手動ボタン'), PANEL.right);
      }
    });

    updateRarePanel();
    updateNotifyPanel();
    Object.keys(API_KIND).forEach(kind => {
      updateApiModePanel(kind);
      updateApiButtonPanel(kind);
    });
  }

  function updateRarePanel() {
    if (!rarePanel) return;
    Object.assign(rarePanel.style, rareFilterEnabled ? {
      background: '#f9a825',
      color: '#111',
      borderColor: '#f57f17',
      opacity: '1'
    } : {
      background: '#111',
      color: '#fff',
      borderColor: '#666',
      opacity: '.9'
    });
    rarePanel.textContent = rareFilterEnabled ? '★' : '全';
  }

  function updateNotifyPanel() {
    if (!notifyPanel) return;
    Object.assign(notifyPanel.style, notifyEnabled ? {
      background: '#2e7d32',
      color: '#fff',
      borderColor: '#1b5e20',
      opacity: '1'
    } : {
      background: '#111',
      color: '#fff',
      borderColor: '#666',
      opacity: '.9'
    });
    notifyPanel.textContent = '🔔';
  }

  function updateApiModePanel(kind) {
    const panel = apiModePanels[kind];
    if (!panel) return;
    const mode = API_AUTO_MODES[apiAutoMode[kind]] || API_AUTO_MODES.manual;
    Object.assign(panel.style, {
      background: mode.background,
      color: mode.color,
      borderColor: 'rgba(255,255,255,.75)',
      opacity: '1'
    });
    panel.textContent = mode.label;
  }

  function updateApiButtonPanel(kind) {
    const panel = apiButtonPanels[kind];
    const cfg = API_KIND[kind];
    if (!panel || !cfg) return;

    const isThisBusy = apiBusy && apiBusyKind === kind;

    Object.assign(panel.style, apiBusy ? {
      background: isThisBusy ? '#d50000' : '#7f1d1d',
      color: '#fff',
      borderColor: isThisBusy ? '#ff5252' : '#991b1b',
      opacity: '1'
    } : {
      background: cfg.buttonBackground,
      color: '#fff',
      borderColor: cfg.buttonBorder,
      opacity: '1'
    });

    panel.textContent = isThisBusy ? '取' : cfg.buttonText;
  }

  function toggleRareFilter() {
    rareFilterEnabled = !rareFilterEnabled;
    storage.set(KEYS.rare, rareFilterEnabled ? '1' : '0');
    updateRarePanel();
    internalLog(`レア部屋フィルター: ${rareFilterEnabled ? 'ON' : 'OFF'} / ${getFilterLabel()}`);
  }

  function toggleNotify() {
    notifyEnabled = !notifyEnabled;
    storage.set(KEYS.notify, notifyEnabled ? '1' : '0');
    updateNotifyPanel();
    internalLog(`Discord通知: ${notifyEnabled ? 'ON' : 'OFF'}`);
    logWebhookStatus(true);
  }

  function startPanelTicker() {
    win.setInterval(ensurePanels, 1000);
  }

  function getVacancyDisplayMode() {
    for (const li of $$('.js-showHotelStatus')) {
      const value = String(li.getAttribute('value') || '').trim();
      const a = $('a', li);
      const img = $('img', li);
      const alt = normalize(img?.getAttribute('alt') || '');
      const src = String(img?.getAttribute('src') || '');
      const selected = li.classList.contains('select') || a?.classList.contains('select') || src.includes('_o.');

      if (!selected) continue;
      if (value === 'false' || alt.includes('空き有りのみ') || alt.includes('空室のみ')) return 'emptyOnly';
      if (value === 'true' || alt.includes('すべて')) return 'all';
    }
    return 'all';
  }

  function buildOfficialDomOrder() {
    const byCommodity = new Map();
    const byRoomName = new Map();
    const hotelNames = new Map();
    let globalOrder = 0;

    for (const hotelDiv of $$('.js-hotelDiv')) {
      const hotelCd = getHotelCdFromDiv(hotelDiv);
      if (!hotelCd) continue;

      const hotelOrder = HOTEL_ORDER.indexOf(hotelCd);
      const setHotelName = name => {
        if (name && !hotelNames.has(hotelCd)) hotelNames.set(hotelCd, name);
      };

      setHotelName(inputValue(hotelDiv, '.otherHotelname') || inputValue(hotelDiv, '.detailHotelName'));

      $$('.ecTypeSection', hotelDiv).forEach((ecSection, categoryIndex) => {
        const categoryLabel =
          cleanHeadingText($('.ecRoomTitleBar h1', ecSection)) ||
          cleanHeadingText($('.ecRoomTitleBar h2', ecSection)) ||
          cleanHeadingText($('.ecRoomTitleBar h3', ecSection)) ||
          cleanHeadingText($('h1', ecSection)) ||
          cleanHeadingText($('h2', ecSection)) ||
          cleanHeadingText($('h3', ecSection)) ||
          '';

        $$('.boxRoom.roomSection', ecSection).forEach((roomSection, roomIndex) => {
          setHotelName(inputValue(roomSection, '.otherHotelname') || inputValue(roomSection, '.detailHotelName'));

          const roomName =
            inputValue(roomSection, '.vacancySearchParamName') ||
            inputValue(roomSection, '.otherRoomName') ||
            inputValue(roomSection, '.detailRoomName') ||
            cleanHeadingText($('.subHeader h2', roomSection)) ||
            cleanHeadingText($('h2', roomSection)) ||
            cleanHeadingText($('h4', roomSection));

          if (!roomName) return;

          const roomKey = `${hotelCd}__${keyText(roomName)}`;
          const bedSections = $$('.bedSection', roomSection);

          const makeInfo = (bedSection = null, bedIndex = 0) => {
            if (bedSection) setHotelName(inputValue(bedSection, '.otherHotelname') || inputValue(bedSection, '.detailHotelName'));

            return {
              hotelCd,
              hotelName: hotelNames.get(hotelCd) || '',
              hotelOrder: hotelOrder >= 0 ? hotelOrder : 999,
              categoryIndex,
              roomIndex,
              bedIndex,
              globalOrder: globalOrder++,
              categoryLabel,
              roomName,
              bedTypeName: bedSection
                ? inputValue(bedSection, '.roomBedTypeName') ||
                  inputValue(bedSection, '.otherBedTypeName') ||
                  cleanHeadingText($('.bedTypeName', bedSection)) ||
                  cleanHeadingText($('.tagWrapper', bedSection)) ||
                  ''
                : '',
              commodityCd: bedSection
                ? inputValue(bedSection, '.bedCommodityCD') ||
                  inputValue(bedSection, '.otherCommCd') ||
                  String(bedSection.id || '').replace(/^section_/, '')
                : ''
            };
          };

          if (!bedSections.length) {
            if (!byRoomName.has(roomKey)) byRoomName.set(roomKey, makeInfo());
            return;
          }

          bedSections.forEach((bedSection, bedIndex) => {
            const info = makeInfo(bedSection, bedIndex);
            if (info.commodityCd) byCommodity.set(info.commodityCd, info);
            if (!byRoomName.has(roomKey)) byRoomName.set(roomKey, info);
          });
        });
      });
    }

    return {
      byCommodity,
      byRoomName,
      hotelNames,
      countCommodity: byCommodity.size,
      countRoomName: byRoomName.size,
      createdAt: tStrMs()
    };
  }

  function getCommodityCodesFromDom() {
    const hiddenCodes = $$('.vacancySearchParamCmdCd')
      .map(el => normalize(el.value || ''))
      .filter(Boolean);

    if (hiddenCodes.length) return [...new Set(hiddenCodes)];

    const domOrder = buildOfficialDomOrder();
    return [...domOrder.byCommodity.keys()].filter(Boolean);
  }

  function makeStockApiBody(targetYmd, commodityCodes) {
    const body = new URLSearchParams();
    [
      ['_xhr', ''],
      ['commodityCD', commodityCodes.join(',')],
      ['useDate', targetYmd],
      ['stayingDays', pageParam('stayingDays', '1')],
      ['adultNum', pageParam('adultNum', '2')],
      ['childNum', pageParam('childNum', '0')],
      ['roomsNum', pageParam('roomsNum', '1')],
      ['childAgeBedInform', pageParam('childAgeBedInform', '')],
      ['rrc3005ProcessingType', 'update']
    ].forEach(([k, v]) => body.set(k, v));
    return body;
  }

  function clearApiAutoTimer(kind) {
    if (!apiAutoTimer[kind]) return;
    win.clearTimeout(apiAutoTimer[kind]);
    apiAutoTimer[kind] = 0;
  }

  function getApiRunMode(reason) {
    const text = String(reason || '');
    if (text.includes('短期')) return 'short';
    if (text.includes('長期')) return 'long';
    return 'manual';
  }

  function scheduleApiAuto(kind, option = {}) {
    const cfg = API_KIND[kind];
    if (!cfg) return;

    clearApiAutoTimer(kind);
    if (apiAutoMode[kind] === 'manual') return;

    const maintenanceDelay = getMaintenanceDelayMs();
    if (maintenanceDelay > 0) {
      internalLog(`${cfg.label} メンテナンス時間帯のため待機: ${Math.round(maintenanceDelay / 1000)}秒`);
      apiAutoTimer[kind] = win.setTimeout(() => scheduleApiAuto(kind, { reason: 'maintenanceRetry' }), maintenanceDelay);
      return;
    }

    const delayMs = option.backoffMs && Number.isFinite(Number(option.backoffMs))
      ? Math.max(0, Number(option.backoffMs))
      : apiAutoMode[kind] === 'short'
        ? 0
        : randomLongDelayMs();

    const modeName = API_AUTO_MODES[apiAutoMode[kind]]?.name || apiAutoMode[kind];
    internalLog(`${cfg.label} 自動API: ${modeName} / ${Math.round(delayMs / 1000)}秒後`);

    apiAutoTimer[kind] = win.setTimeout(() => {
      apiAutoTimer[kind] = 0;
      runStockApiOnce(kind, `自動${modeName}`);
    }, delayMs);
  }

  function startInitialApiAuto() {
    const start = () => {
      Object.keys(API_KIND).forEach(kind => {
        if (apiAutoMode[kind] === 'manual') return;
        if (apiAutoMode[kind] === 'short') {
          apiAutoTimer[kind] = win.setTimeout(() => {
            apiAutoTimer[kind] = 0;
            runStockApiOnce(kind, '自動短期');
          }, 1000);
        } else {
          scheduleApiAuto(kind, { reason: 'initialLong' });
        }
      });
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }

  const isCustomApiContext = context => !!context.customApi || context.sourceLabel === '当日API' || context.sourceLabel === '翌日API';
  const isPassiveApiBlocked = context => !isCustomApiContext(context) && nowMs() < customApiPriorityUntil;

  async function getIP() {
    const current = nowMs();
    if (current - lastIPFetchTime < 60000 && cachedIP !== 'unknown') return cachedIP;

    const apis = [
      'https://inet-ip.info/ip',
      'https://www.cloudflare.com/cdn-cgi/trace',
      'https://api.ipify.org'
    ];

    for (const url of apis) {
      try {
        const controller = new AbortController();
        const timer = win.setTimeout(() => controller.abort(), 3000);
        const resp = await win.fetch(url, { signal: controller.signal });
        win.clearTimeout(timer);

        let text = await resp.text();

        if (url.includes('cloudflare')) {
          const match = text.match(/ip=([^\s]+)/);
          if (match) {
            cachedIP = match[1];
            lastIPFetchTime = current;
            return cachedIP;
          }
        } else {
          text = text.trim();
          if (text) {
            cachedIP = text;
            lastIPFetchTime = current;
            return cachedIP;
          }
        }
      } catch {}
    }

    return cachedIP;
  }

  function shouldNotifyErrorCount(count) {
    return [10, 15, 20, 25].includes(count) || count >= 30;
  }

  function handleApiSuccess(sourceLabel = '') {
    if (consecutiveErrorCount || fatalErrorCount) {
      internalLog(`${sourceLabel || 'API'} 成功: エラーカウントリセット`);
    }

    consecutiveErrorCount = 0;
    fatalErrorCount = 0;
    showPopup(getClockStr(), 'rgba(0, 102, 204, 0.9)');
  }

  function handleApiError(errObj, targetYmd, sourceLabel, customMsg = '') {
    consecutiveErrorCount++;

    const count = consecutiveErrorCount;
    const errStatus = errObj?.status || errObj?.statusText || errObj?.name || 'Error';
    const burst = isBurstTime();
    const targetInfoStr = `${sourceLabel || 'API'} / useDate=${targetYmd || getActiveUseDateYmd() || '不明'}`;
    const bgRed = 'rgba(204, 0, 0, 0.9)';
    const bgYellow = 'rgba(255, 204, 0, 0.9)';
    const txtBlack = '#000';

    if (burst) {
      if (count >= 30) {
        const msg = `バーストタイム中ですが連続${count}回拒否されたため、安全のため自動停止します。${customMsg ? `\n${customMsg}` : ''}`;
        showPopup(`🛑バーストブロック検知 ${getClockStr()}`, bgRed);
        sendApiErrorDiscord(errStatus, targetInfoStr, msg, count);
        return { ok: false, status: 0, backoffMs: 0, stopAuto: true };
      }

      if (shouldNotifyErrorCount(count)) {
        sendApiErrorDiscord(errStatus, targetInfoStr, `バーストタイム突撃中 (${count}回目)。1.5秒後に再検索します。${customMsg ? `\n${customMsg}` : ''}`, count);
      }

      showPopup(`⚠️${toCircled(count)} ${getClockStr()}`, bgYellow, txtBlack);
      return { ok: false, status: 0, backoffMs: BURST_ERROR_RETRY_MS, stopAuto: false };
    }

    if (count >= 30) {
      const msg = `完全ブロックの可能性が高いため、当日API・翌日APIを手動モードに変更して停止します。${customMsg ? `\n${customMsg}` : ''}`;
      showPopup(`🛑${toCircled(count)} ${getClockStr()}`, bgRed);
      sendApiErrorDiscord(errStatus, targetInfoStr, msg, count);
      return { ok: false, status: 0, backoffMs: 0, stopAuto: true };
    }

    if (count === 25) {
      const msg = `30分間のロングクールダウンに入ります。${customMsg ? `\n${customMsg}` : ''}`;
      showPopup(`🚫${toCircled(count)} ${getClockStr()}`, bgRed);
      sendApiErrorDiscord(errStatus, targetInfoStr, msg, count);
      return { ok: false, status: 0, backoffMs: LONG_COOLDOWN_MS, stopAuto: false };
    }

    if ([10, 15, 20].includes(count)) {
      const msg = `10分後に現在のモードで自動再開します。${customMsg ? `\n${customMsg}` : ''}`;
      showPopup(`🚫${toCircled(count)} ${getClockStr()}`, bgRed);
      sendApiErrorDiscord(errStatus, targetInfoStr, msg, count);
      return { ok: false, status: 0, backoffMs: NORMAL_COOLDOWN_MS, stopAuto: false };
    }

    showPopup(`⚠️${toCircled(count)} ${getClockStr()}`, bgYellow, txtBlack);
    return { ok: false, status: 0, backoffMs: NORMAL_ERROR_RETRY_MS, stopAuto: false };
  }

  async function sendApiErrorDiscord(errStatus, targetInfoStr, customMsg, count) {
    fatalErrorCount++;

    const ip = await getIP();
    const icon = '🚫'.repeat(Math.min(fatalErrorCount, 10));
    const modeText = Object.entries(API_KIND)
      .map(([kind, cfg]) => `${cfg.label}:${API_AUTO_MODES[apiAutoMode[kind]]?.name || apiAutoMode[kind]}`)
      .join(' / ');

    enqueueDiscord({
      username: SCRIPT_NAME,
      embeds: [{
        title: `${icon} ${errStatus} 通信エラー多発`,
        color: DISCORD_COLOR.error,
        description: [
          `時刻: ${tStrFullMs()} (${ip})`,
          `対象: ${targetInfoStr}`,
          `連続エラー: ${count}回`,
          `モード: ${modeText}`,
          customMsg
        ].filter(Boolean).join('\n')
      }],
      allowed_mentions: { parse: [] }
    });
  }

  async function runStockApiOnce(kind, reason = '手動') {
    const cfg = API_KIND[kind];
    if (!cfg) return false;

    if (apiBusy) {
      internalLog(`${cfg.label}: 通信中のためスキップ / ${reason}`);
      if (apiAutoMode[kind] !== 'manual') scheduleApiAuto(kind, { backoffMs: BURST_ERROR_RETRY_MS, reason: 'busyRetry' });
      return false;
    }

    clearApiAutoTimer(kind);
    customApiPriorityUntil = nowMs() + 15000;
    apiBusy = true;
    apiBusyKind = kind;
    Object.keys(API_KIND).forEach(updateApiButtonPanel);

    let result = { ok: false, status: 0, backoffMs: 0, stopAuto: false };

    try {
      result = await requestStockApiCore(kind, reason);
      return !!result.ok;
    } finally {
      customApiPriorityUntil = nowMs() + 5000;
      apiBusy = false;
      apiBusyKind = '';
      Object.keys(API_KIND).forEach(updateApiButtonPanel);

      if (result.stopAuto) {
        stopAllApiAuto(`${cfg.label} エラー多発`);
      } else if (apiAutoMode[kind] !== 'manual') {
        scheduleApiAuto(kind, { backoffMs: result.backoffMs || 0, reason });
      }
    }
  }

  async function requestStockApiCore(kind, reason = '手動') {
    const cfg = API_KIND[kind];
    const baseYmd = getUrlUseDateYmd();
    const targetYmd = ymdAddDays(baseYmd, cfg.offset);
    const sourceLabel = cfg.label;
    const apiMode = getApiRunMode(reason);
    const maintenanceDelay = getMaintenanceDelayMs();

    if (maintenanceDelay > 0) {
      showPopup(`🛠️${getClockStr()}`, 'rgba(80,80,80,0.9)');
      internalLog(`${sourceLabel}: メンテナンス時間帯のため待機 / ${Math.round(maintenanceDelay / 1000)}秒`);
      return { ok: false, status: 0, backoffMs: maintenanceDelay, stopAuto: false };
    }

    if (!baseYmd || !targetYmd) {
      console.warn(`${sourceLabel}: URLのuseDateが取得できません`);
      showPopup(`🛑日付不明 ${getClockStr()}`, 'rgba(204, 0, 0, 0.9)');
      return { ok: false, status: 0, backoffMs: 0, stopAuto: true };
    }

    const commodityCodes = getCommodityCodesFromDom();
    if (!commodityCodes.length) {
      console.warn(`${sourceLabel}: commodityCDをDOMから取得できません`);
      return handleApiError(
        { statusText: 'NO_COMMODITY' },
        targetYmd,
        sourceLabel,
        'commodityCDをDOMから取得できません。'
      );
    }

    const targetUrl = urlWithUseDate(targetYmd);
    const body = makeStockApiBody(targetYmd, commodityCodes);

    internalLog(`${sourceLabel}発火: URL基準=${baseYmd} / target=${targetYmd} / commodity=${commodityCodes.length} / ${reason}`);

    try {
      const res = await win.fetch(API_URL, {
        method: 'POST',
        mode: 'cors',
        credentials: 'include',
        referrer: targetUrl,
        headers: {
          accept: 'application/json, text/javascript, */*; q=0.01',
          'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'x-requested-with': 'XMLHttpRequest',
          'x-queueit-ajaxpageurl': encodeURIComponent(targetUrl)
        },
        body: body.toString(),
        __tdrStockApi: true
      });

      const txt = await res.text();
      const status = Number(res.status || 0);
      const apiReceivedAt = tStrMs();

      customApiPriorityUntil = nowMs() + 5000;

      if (!res.ok) {
        console.warn(`${sourceLabel}失敗: HTTP ${status}`);
        return handleApiError(
          { status, statusText: `HTTP ${status}` },
          targetYmd,
          sourceLabel,
          `HTTP ${status} が返りました。`
        );
      }

      handleApiSuccess(sourceLabel);

      handleJSON(txt, {
        useDateOverride: targetYmd,
        sourceLabel,
        apiReceivedAt,
        customApi: true,
        apiMode
      });

      return { ok: true, status, backoffMs: 0, stopAuto: false };
    } catch (e) {
      console.warn(`${sourceLabel}通信エラー`, e);
      return handleApiError(e, targetYmd, sourceLabel, 'fetch通信エラーが発生しました。');
    }
  }

  function getDomInfoForRow(row, domOrder) {
    if (!domOrder) return null;
    if (row.roomCd && domOrder.byCommodity.has(row.roomCd)) return domOrder.byCommodity.get(row.roomCd);
    return domOrder.byRoomName.get(`${row.hotelCd}__${keyText(row.roomName)}`) || null;
  }

  function applyDomInfo(rows, domOrder) {
    rows.forEach(r => {
      const info = getDomInfoForRow(r, domOrder);
      if (info) {
        r.domMatched = true;
        r.domOrder = info.globalOrder;
        r.categoryLabel = info.categoryLabel || '';
        r.bedTypeName = info.bedTypeName || '';
      }
      r.hotelName = info?.hotelName || domOrder?.hotelNames?.get(r.hotelCd) || r.hotelCd;
    });
  }

  function sortRows(rows) {
    rows.sort((a, b) =>
      a.hotelOrder - b.hotelOrder ||
      a.domOrder - b.domOrder ||
      a.seq - b.seq
    );
  }

  function patchXHR() {
    if (win.XMLHttpRequest.prototype.__tdrDaySearchPatched) return;
    win.XMLHttpRequest.prototype.__tdrDaySearchPatched = true;

    const oOpen = win.XMLHttpRequest.prototype.open;
    const oSend = win.XMLHttpRequest.prototype.send;

    win.XMLHttpRequest.prototype.open = function (m, url, ...rest) {
      this._tdrDaySearchUrl = String(url || '');
      return oOpen.call(this, m, url, ...rest);
    };

    win.XMLHttpRequest.prototype.send = function (...rest) {
      const url = this._tdrDaySearchUrl || '';
      const bodyYmd = getRequestBodyUseDate(rest[0]);

      if (ENDPOINT.test(url)) {
        this.addEventListener('load', () => handleJSON(this.responseText, {
          sourceLabel: '',
          apiReceivedAt: tStrMs(),
          useDateOverride: bodyYmd || getUrlUseDateYmd(),
          passiveApi: true,
          apiMode: ''
        }));
      }

      return oSend.apply(this, rest);
    };
  }

  function guardFetch() {
    const f = win.fetch;
    if (!f || f.__patched) return;

    const patched = new Proxy(f, {
      apply(t, th, args) {
        const req = args[0];
        const init = args[1];
        const customStockApi = !!init?.__tdrStockApi;
        const url = String(req?.url || req || '');
        const bodyYmd = getRequestBodyUseDate(init?.body);

        let callArgs = args;
        if (customStockApi) {
          const cleanInit = { ...init };
          delete cleanInit.__tdrStockApi;
          callArgs = [req, cleanInit];
        }

        const p = Reflect.apply(t, th, callArgs);

        if (ENDPOINT.test(url) && !customStockApi) {
          p.then(r => r.clone().text().then(txt => handleJSON(txt, {
            sourceLabel: '',
            apiReceivedAt: tStrMs(),
            useDateOverride: bodyYmd || getUrlUseDateYmd(),
            passiveApi: true,
            apiMode: ''
          }))).catch(() => {});
        }

        return p;
      }
    });

    patched.__patched = true;
    win.fetch = patched;
  }

  function isDuplicateJson(txt, context = {}) {
    const ymd = context.useDateOverride || getUrlUseDateYmd() || '';
    const label = context.sourceLabel || '通常API';
    const key = `${ymd}|${label}|${stableHash(txt)}`;
    const currentMs = nowMs();

    if (key === lastJsonKey && currentMs - lastJsonAt < 1500) return true;

    lastJsonKey = key;
    lastJsonAt = currentMs;
    return false;
  }

  function handleJSON(txt, context = {}) {
    if (isPassiveApiBlocked(context)) {
      internalLog(`カスタムAPI優先中のため通常API処理をスキップ: useDate=${context.useDateOverride || getUrlUseDateYmd() || '不明'}`);
      return;
    }

    if (isDuplicateJson(txt, context)) {
      internalLog(`同一APIレスポンスの重複処理をスキップ: ${context.sourceLabel || '通常API'} / useDate=${context.useDateOverride || getUrlUseDateYmd() || '不明'}`);
      return;
    }

    try {
      const json = JSON.parse(txt);
      const rows = [];
      let seq = 0;

      for (const [groupKey, group] of Object.entries(json.ecRoomStockInfos || {})) {
        const hotelCd = getHotelCdFromApi(groupKey, group);
        const hotelOrder = HOTEL_ORDER.indexOf(hotelCd);

        for (const [roomNameKey, room] of Object.entries(group.roomStockInfos || {})) {
          const roomName = normalize(room.roomName || roomNameKey);

          for (const [roomCdKey, info] of Object.entries(room.roomBedStockRangeInfos || {})) {
            const current = info.currentRoomBedStock || {};
            rows.push({
              seq: seq++,
              hotelCd,
              hotelName: '',
              hotelOrder: hotelOrder >= 0 ? hotelOrder : 999,
              roomCd: current.commodityCd || current.roomCd || current.hotelRoomCd || roomCdKey || '',
              roomName,
              saleStatus: current.saleStatus ?? '',
              remainStockNum: stockText(current.remainStockNum),
              domMatched: false,
              domOrder: 999999,
              categoryLabel: '',
              bedTypeName: ''
            });
          }
        }
      }

      win.setTimeout(() => renderRows(rows, {
        ...context,
        apiReceivedAt: context.apiReceivedAt || tStrMs()
      }), DOM_WAIT_MS);
    } catch {}
  }

  function getDiscordWebhookUrl() {
    return win.TDR_WEBHOOKS?.hotel || window.TDR_WEBHOOKS?.hotel || '';
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
    discordQueue.push(payload);
    processDiscordQueue();
  }

  async function processDiscordQueue() {
    if (discordSending || !discordQueue.length) return;

    const webhookUrl = getDiscordWebhookUrl();
    if (!webhookUrl) {
      internalLog('Discord Webhook未設定: window.TDR_WEBHOOKS.hotel を確認してください', 'warn');
      win.setTimeout(processDiscordQueue, 3000);
      return;
    }

    discordSending = true;

    try {
      const res = await win.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(discordQueue[0])
      });

      if (res.status === 429) {
        let retryMs = 1500;
        try {
          const data = await res.json();
          if (Number.isFinite(Number(data.retry_after))) retryMs = Math.ceil(Number(data.retry_after) * 1000);
        } catch {}

        internalLog(`Discord rate limit: ${retryMs}ms待機`, 'warn');
        discordSending = false;
        win.setTimeout(processDiscordQueue, retryMs);
        return;
      }

      if (res.ok) internalLog('Discord通知送信完了');
      else internalLog(`Discord通知失敗: ${res.status}`, 'warn');

      discordQueue.shift();
    } catch (e) {
      internalLog(`Discord通知エラー: ${e?.message || e}`, 'warn');
      discordQueue.shift();
    }

    discordSending = false;
    win.setTimeout(processDiscordQueue, 300);
  }

  function getUseDateText() {
    const raw = getActiveUseDateYmd();
    return /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}` : raw || '日付不明';
  }

  const rowKey = r => r.roomCd ? `${r.hotelCd}|${r.roomCd}` : `${r.hotelCd}|${keyText(r.roomName)}|${r.seq}`;

  function makeNotifySnapshot(rows) {
    const useDate = getSnapshotDateKey();
    const map = new Map();

    rows.forEach(r => {
      const st = Number(r.saleStatus);
      map.set(rowKey(r), {
        key: rowKey(r),
        useDate,
        hotelCd: r.hotelCd,
        hotelName: r.hotelName || r.hotelCd,
        categoryLabel: r.categoryLabel || '',
        roomName: r.roomName || '',
        roomCd: r.roomCd || '',
        saleStatus: Number.isFinite(st) ? st : r.saleStatus,
        remainStockNum: String(r.remainStockNum ?? '0'),
        domOrder: Number.isFinite(Number(r.domOrder)) ? Number(r.domOrder) : 999999,
        seq: Number.isFinite(Number(r.seq)) ? Number(r.seq) : 999999
      });
    });

    return map;
  }

  function loadStoredSnapshot() {
    const key = getSnapshotStorageKey();
    const currentUseDate = getSnapshotDateKey();

    if (!currentUseDate || !key) {
      console.warn('useDate不明のためスナップショット読込を行いません');
      return null;
    }

    const raw = storage.get(key);
    if (!raw) {
      console.info(`前回スナップショットなし: useDate=${currentUseDate} / ${key}`);
      return null;
    }

    try {
      const data = JSON.parse(raw);
      const savedUseDate = data?.useDate || extractYmdFromScope(data?.scope);

      if (!savedUseDate) {
        storage.remove(key);
        console.warn(`useDate不明の古いスナップショット破棄: ${key}`);
        return null;
      }

      if (currentUseDate !== savedUseDate) {
        storage.remove(key);
        console.warn(`日付不一致スナップショット破棄: saved=${savedUseDate} / current=${currentUseDate} / ${key}`);
        return null;
      }

      const reason = getCurrentSnapshotDropReason(data);
      if (reason) {
        storage.remove(key);
        console.info(`現在スナップショット破棄: ${reason} / ${key}`);
        return null;
      }

      const items = Array.isArray(data?.items) ? data.items : [];
      const badItem = items.find(item => item?.useDate && item.useDate !== currentUseDate);

      if (badItem) {
        storage.remove(key);
        console.warn(`明細日付不一致スナップショット破棄: item=${badItem.useDate} / current=${currentUseDate} / ${key}`);
        return null;
      }

      const map = new Map();
      items.forEach(item => {
        if (item?.key) map.set(item.key, item);
      });

      console.info(`前回スナップショット読込: ${map.size}件 / useDate=${currentUseDate} / ${key}`);
      return map;
    } catch {
      storage.remove(key);
      console.warn(`前回スナップショット破損のため削除: ${key}`);
      return null;
    }
  }

  function saveStoredSnapshot(snapshot) {
    const key = getSnapshotStorageKey();
    const useDate = getSnapshotDateKey();

    if (!useDate || !key) {
      console.warn('useDate不明のためスナップショット保存を行いません');
      return;
    }

    const savedAt = nowMs();
    const items = [...snapshot.values()];
    const ok = storage.set(key, JSON.stringify({
      schema: SNAPSHOT_SCHEMA,
      savedAt,
      useDate,
      scope: getSnapshotScope(),
      items
    }));

    if (ok) console.info(`スナップショット保存: ${items.length}件 / useDate=${useDate} / savedAt=${savedAt} / ${key}`);
  }

  function diffSnapshots(prev, curr) {
    const changes = [];

    for (const [key, now] of curr.entries()) {
      const old = prev.get(key);
      if (!old) changes.push({ type: 'add', old, now });
      else if (String(old.saleStatus) !== String(now.saleStatus) || String(old.remainStockNum) !== String(now.remainStockNum)) {
        changes.push({ type: 'change', old, now });
      }
    }

    for (const [key, old] of prev.entries()) {
      if (!curr.has(key)) changes.push({ type: 'remove', old, now: null });
    }

    changes.sort((a, b) => {
      const ar = a.now || a.old;
      const br = b.now || b.old;
      return HOTEL_ORDER.indexOf(ar.hotelCd) - HOTEL_ORDER.indexOf(br.hotelCd) ||
        ar.domOrder - br.domOrder ||
        ar.seq - br.seq;
    });

    return changes;
  }

  function changedKeySet(changes) {
    const set = new Set();
    changes.forEach(c => {
      if (c.now?.key) set.add(c.now.key);
      if (c.old?.key) set.add(c.old.key);
    });
    return set;
  }

  function stockMark(v) {
    const n = Number(v);
    const marks = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤', 6: '⑥', 7: '⑦', 8: '⑧', 9: '⑨', 10: '⑩' };
    return marks[n] || (Number.isFinite(n) && n > 0 ? `(${n})` : '');
  }

  function statusWithStock(row) {
    if (!row) return '';
    const st = Number(row.saleStatus);
    const label = FULL_LABEL[st] || row.saleStatus;
    return st === 0 ? `${label}${stockMark(row.remainStockNum)}` : String(label);
  }

  function statusTransitionText(change) {
    if (change.type === 'add') return `追加→${statusWithStock(change.now)}`;
    if (change.type === 'remove') return `${statusWithStock(change.old)}→削除`;
    return `${statusWithStock(change.old)}→${statusWithStock(change.now)}`;
  }

  function statusWithStockShort(row) {
    if (!row) return '';

    const st = Number(row.saleStatus);

    if (st === 0) {
      return `空${stockMark(row.remainStockNum)}`;
    }

    return FULL_LABEL[st] || row.saleStatus;
  }

  function statusTransitionTextShort(change) {
    if (change.type === 'add') return `追加→${statusWithStockShort(change.now)}`;
    if (change.type === 'remove') return `${statusWithStockShort(change.old)}→削除`;
    return `${statusWithStockShort(change.old)}→${statusWithStockShort(change.now)}`;
  }

  function notifyStatusForChange(change) {
    const st = Number((change.now || change.old)?.saleStatus);
    return Number.isFinite(st) ? st : 0;
  }

  function diffStatusStyle(change) {
    const st = Number((change.now || change.old)?.saleStatus);
    const base = 'font-weight:900;font-size:13px;padding:1px 6px;border-radius:3px;display:inline-block;margin:1px 0;line-height:1.1';

    if (st === 0) return `${base};color:#fff;background:#d50000;`;
    if (st === 1) return `${base};color:#fff;background:#222;`;
    if (st === 2) return `${base};color:#fff;background:#1565c0;`;
    if (st === 3) return `${base};color:#fff;background:#2e7d32;`;

    return `${base};color:#111;background:#ddd;`;
  }

  function handleNotifyDiff(rows, option = {}) {
    const currentUseDate = getSnapshotDateKey();

    if (!currentUseDate) {
      return { status: 'skipped', message: 'useDate不明のため比較・保存・通知を行いません', changes: [], changedKeys: new Set() };
    }

    if (!rows.length && !option.allowEmptySnapshot) {
      return { status: 'skipped', message: '通知比較: 行が0件のため保存・通知しません', changes: [], changedKeys: new Set() };
    }

    logWebhookStatus();

    const currentSnapshot = makeNotifySnapshot(rows);
    const previousSnapshot = loadStoredSnapshot();

    if (!previousSnapshot || !previousSnapshot.size) {
      saveStoredSnapshot(currentSnapshot);
      return { status: 'baseline', message: '通知ベースライン保存。初回のため通知しません', changes: [], changedKeys: new Set() };
    }

    const changes = diffSnapshots(previousSnapshot, currentSnapshot);
    saveStoredSnapshot(currentSnapshot);

    if (!changes.length) {
      return { status: 'none', message: '在庫差分なし', changes: [], changedKeys: new Set() };
    }

    const changedKeys = changedKeySet(changes);
    if (notifyEnabled) sendDiscordDiff(changes);

    return { status: 'changed', message: `在庫差分あり: ${changes.length}件`, changes, changedKeys };
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

    console.info(`対象: ${sourceName}`);
    console.info(`フィルター: ${filterLabel}`);
    console.info(`useDate: ${useDateText}`);

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

  function sendDiscordDiff(changes) {
    changes.forEach(sendDiscordChange);
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

  function rowConsoleStyle(baseStyle, changed) {
    return [
      baseStyle,
      'display:block',
      `padding-left:${ROOM_LOG_INDENT_CH}ch`,
      `text-indent:-${ROOM_LOG_INDENT_CH}ch`,
      'white-space:normal',
      changed ? 'font-weight:900;font-size:13px;background:#fff3b0;' : ''
    ].filter(Boolean).join(';');
  }

  function renderRows(inputRows, context = {}) {
    if (isPassiveApiBlocked(context)) {
      internalLog(`カスタムAPI優先中のため通常APIログをスキップ: useDate=${context.useDateOverride || getUrlUseDateYmd() || '不明'}`);
      return;
    }

    if (isCustomApiContext(context)) customApiPriorityUntil = nowMs() + 5000;

    const prevUseDate = activeUseDateOverride;
    const prevSource = activeSourceLabel;

    activeUseDateOverride = context.useDateOverride || '';
    activeSourceLabel = context.sourceLabel || '';

    try {
      const apiReceivedAt = context.apiReceivedAt || tStrMs();
      const sourceName = activeSourceLabel || '通常API';
      const useDateText = getUseDateText();
      const filterLabel = getFilterLabel();
      const displayMode = getVacancyDisplayMode();
      const originalCount = inputRows.length;
      const domOrder = buildOfficialDomOrder();

      const allRows = inputRows.slice();
      applyDomInfo(allRows, domOrder);
      sortRows(allRows);

      const targetRows = rareFilterEnabled ? allRows.filter(isRareRoomRow) : allRows.slice();
      const allowEmptySnapshot = rareFilterEnabled && allRows.length > 0;

      console.groupCollapsed(
        `%c${apiReceivedAt}`,
        'background:#111;color:#fff;font-weight:900;font-size:13px;padding:1px 6px;border-radius:3px;line-height:1.1;'
      );

      console.info(`対象: ${sourceName}`);
      console.info(`useDate: ${useDateText}`);
      console.info(`フィルター: ${filterLabel}`);
      console.info(`表示モード: ${displayMode === 'emptyOnly' ? '空室のみ' : 'すべて'}`);
      console.info(`DOM読込: bed=${domOrder.countCommodity} / room=${domOrder.countRoomName}`);

      if (rareFilterEnabled) {
        console.info(`レア部屋フィルターON: 対象${targetRows.length}件 / 全${allRows.length}件 / rule=${getRareRuleHash()}`);
      } else {
        console.info(`レア部屋フィルターOFF: 全件対象 ${targetRows.length}件`);
      }

      if (displayMode === 'emptyOnly') {
        console.warn(`空室のみ表示を検知。DOM順ズレ防止のため saleStatus=0 のみ出力します。対象${targetRows.length}件 → 空室のみ表示 / API全${originalCount}件`);
      } else {
        console.info('すべて表示のため、対象ステータスをすべて出力します');
      }

      const diffResult = handleNotifyDiff(targetRows, { allowEmptySnapshot });
      const changedRowKeys = diffResult.changedKeys || new Set();

      const rows = displayMode === 'emptyOnly'
        ? targetRows.filter(r => isStatus(r.saleStatus, 0))
        : targetRows.slice();

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

      let lastHotelCd = '';
      let lastCategoryKey = '';

      rows.forEach(r => {
        if (r.hotelCd !== lastHotelCd) {
          console.log(
            `%c▼ ${r.hotelName}`,
            'color:#fff;background:#455a64;font-weight:700;font-size:12px;padding:1px 6px;border-radius:2px;line-height:1.1;'
          );

          lastHotelCd = r.hotelCd;
          lastCategoryKey = '';
        }

        const categoryKey = `${r.hotelCd}__${r.categoryLabel}`;

        if (SHOW_CATEGORY_HEADER && r.domMatched && r.categoryLabel && categoryKey !== lastCategoryKey) {
          console.log(
            `%c  ◆ ${r.categoryLabel}`,
            'color:#555;font-weight:bold;background:#f2f2f2;padding:1px 4px;line-height:1.1;'
          );

          lastCategoryKey = categoryKey;
        }

        const st = Number(r.saleStatus);
        const label = LABEL[st] ?? '?';
        const left = leftText(label, r.remainStockNum);
        const changed = changedRowKeys.has(rowKey(r));
        const hiddenUnique = `__${r.hotelCd}_${r.roomCd}_${r.seq}__`;

        console.log(
          `%c${left}${r.roomName}%c${hiddenUnique}`,
          rowConsoleStyle(STYLE[st] || 'color:inherit', changed),
          HIDDEN_STYLE
        );
      });

      const unmatched = rows.filter(r => !r.domMatched);

      if (unmatched.length) {
        console.info(`公式DOM順に一致しなかった行: ${unmatched.length}件。該当行のみホテル内末尾側でAPI順表示です。`);
      }

      console.groupEnd();

      logDiffSummary(diffResult, sourceName, useDateText, filterLabel);
    } finally {
      activeUseDateOverride = prevUseDate;
      activeSourceLabel = prevSource;
    }
  }

  if (!isTargetSpHotelList()) {
    console.info('対象外ページのため停止: SPホテル一覧 useDate 付きのみ');
    return;
  }

  patchXHR();
  guardFetch();
  win.setInterval(guardFetch, 1000);

  initState();
  cleanupExpiredSnapshots();

  if (document.body) ensurePanels();
  else document.addEventListener('DOMContentLoaded', ensurePanels, { once: true });

  startPanelTicker();
  startInitialApiAuto();

  internalLog('official DOM-order logger ready / rare room filter / v1.86');
})();
