// ==UserScript==
// @name         🏨📋️日付指定在庫モニター
// @version      2.10
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/hotel_list.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/hotel_list.js
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  const win = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  if (win.__TDR_DATETIME_STOCK_MONITOR_RUNNING__) {
    console.warn('[DaySearch] すでに起動済みのため停止');
    return;
  }
  win.__TDR_DATETIME_STOCK_MONITOR_RUNNING__ = '2.10';
  const SCRIPT_NAME = '🏨📋️日付指定在庫モニター';
  const API_URL = 'https://reserve.tokyodisneyresort.jp/sp/hotel/api/queryHotelPriceStock/';
  const ENDPOINT = /\/sp\/hotel\/api\/queryHotelPriceStock\/?/;
  const SNAPSHOT_SCHEMA = 'sp-search-scope-v1.99';
  const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
  const DOM_WAIT_MS = 700;
  const ACQUIRE_PRICE_OPTIONS = Array.from({ length: 17 }, (_, i) => String((i + 7) * 10000));
  const BURST_ERROR_RETRY_MS = 1500;
  const NORMAL_ERROR_RETRY_MS = 3000;
  const NORMAL_COOLDOWN_MS = 20 * 60 * 1000;
  const SHOW_CATEGORY_HEADER = true;
  const ROOM_LOG_INDENT_CH = 6;
  const HIDDEN_STYLE = 'color:transparent;font-size:0;line-height:0';
  const HOTEL_ORDER = ['FSH', 'TDH', 'DAH', 'DHM', 'TSH', 'DCH'];
  const IDS = {
    csv: '__datetime_stock_monitor_csv_panel',
    notify: '__datetime_stock_monitor_notify_panel',
    acquire: '__datetime_stock_monitor_acquire_panel',
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
    acquire: 'datetime_stock_monitor_acquire_enabled',
    priceMin: 'datetime_stock_monitor_price_min',
    priceMax: 'datetime_stock_monitor_price_max',
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
    manual: { label: 'OFF', name: 'OFF', background: '#333333', color: '#ffffff' },
    short: { label: '短期', name: '短期', background: '#ff69b4', color: '#ffffff' },
    medium: { label: '中期', name: '中期', background: '#ff8c00', color: '#ffffff' },
    long: { label: '長期', name: '長期', background: '#007bff', color: '#ffffff' }
  };
  const API_MODE_ORDER = ['long', 'medium', 'short', 'manual'];
  const API_KIND = {
    current: {
      offset: 0,
      label: '当日API',
      buttonText: '当',
      column: '3',
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
      column: '4',
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
  const PANEL = { id: '__datetime_stock_monitor_panels', minWidth: '24px', apiWidth: '44px', height: '26px' };
  let panelContainer = null;
  let csvPanel = null;
  let notifyPanel = null;
  let acquirePanel = null;
  const acquirePrice = { min: '', max: '' };
  const acquirePriceSelects = { min: null, max: null };
  // Restore acquisition only within the same tab session.
  let acquireEnabled = false;
  let acquireEpoch = 0;
  let acquireRequestNo = 0;
  let latestAcquireResponse = 0;
  let acquireCycle = null;
  let acquireErrorCount = 0;
  let rarePanel = null;
  let popupElem = null;
  const apiButtonPanels = { current: null, next: null };
  const apiModePanels = { current: null, next: null };
  const apiAutoMode = { current: 'manual', next: 'manual' };
  const apiAutoTimer = { current: 0, next: 0 };
  const apiAutoNextAt = { current: 0, next: 0 };
  const apiAutoNotBefore = { current: 0, next: 0 };
  const apiAutoDeferred = { current: null, next: null };
  const discordQueues = { hotel: [], research: [] };
  const internalLogs = [];
  const NOTIFY_MODES = {
    off: { label: 'OFF（差分はホテル調査）', icon: '🔕', key: '' },
    hotel: { label: 'ON（差分はホテル調査＋ホテル通知）', icon: '🔔', key: 'hotel' },
    research: { label: 'ホテル調査', icon: '📊', key: 'hotel_research_00' }
  };
  const NOTIFY_MODE_ORDER = ['off', 'hotel'];
  let notifyMode = 'off';
  let notifyEnabled = false;
  let rareFilterEnabled = false;
  let apiBusy = false;
  let apiBusyKind = '';
  let apiBusyStartAt = 0;
  const passiveApiLoads = { current: new Set(), next: new Set() };
  let activeUseDateOverride = '';
  let activeSourceLabel = '';
  let customApiPriorityUntil = 0;
  let lastJsonKey = '';
  let lastJsonAt = 0;
  let webhookStatusLogged = false;
  const discordSending = { hotel: false, research: false };
  let consecutiveErrorCount = 0;
  let lastApiSuccessTime = '';
  let lastApiErrorTime = '';
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
  const tStrForNotification = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tokyo', year: '2-digit', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date()).map(p => [p.type, p.value]));
    return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}時${parts.minute}分${parts.second}秒`;
  };
  const apiEventTime = () => tStrForNotification().split(' ')[1];
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
    return rareFilterEnabled ? 'レア' : '全室';
  }
  function isRareRoomRow(row) {
    return RARE_ROOM_CODES.has(normalize(row?.roomCd || '').toUpperCase());
  }
  function getApiBusyElapsedText(kind) {
    const starts = [...passiveApiLoads[kind]].map(load => load.startedAt);
    if (apiBusy && apiBusyKind === kind) starts.push(apiBusyStartAt);
    if (!starts.length) return '';
    return String(Math.max(0, Math.floor((nowMs() - Math.min(...starts)) / 1000)));
  }
  function hasApiLoading(kind) {
    if (!kind) return Object.keys(API_KIND).some(key => hasApiLoading(key));
    return (apiBusy && apiBusyKind === kind) || passiveApiLoads[kind].size > 0;
  }
  function resumeDeferredApiAuto() {
    if (hasApiLoading()) return;
    Object.keys(API_KIND).forEach(kind => {
      const option = apiAutoDeferred[kind];
      if (option) scheduleApiAuto(kind, option);
      updateApiModePanel(kind);
    });
  }
  function beginPassiveApiLoading(useDate) {
    const baseYmd = getUrlUseDateYmd();
    const kind = baseYmd && Object.keys(API_KIND).find(key => ymdAddDays(baseYmd, API_KIND[key].offset) === useDate);
    if (!kind) return () => {};
    const load = { startedAt: nowMs() };
    passiveApiLoads[kind].add(load);
    clearApiAutoTimer(kind);
    apiAutoDeferred[kind] = apiAutoMode[kind] === 'manual' ? null : {};
    updateApiModePanel(kind);
    return () => {
      passiveApiLoads[kind].delete(load);
      resumeDeferredApiAuto();
      updateApiModePanel(kind);
    };
  }
  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function randomLongDelayMs() {
    return randomInt(160 * 1000, 200 * 1000);
  }
  function randomMediumDelayMs() {
    return randomInt(50 * 1000, 70 * 1000);
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
      return u.protocol === 'https:' && u.hostname === 'reserve.tokyodisneyresort.jp' &&
        u.pathname.startsWith('/sp/hotel/list/') && !!(u.searchParams.get('useDate') || '').trim();
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
    if (h < 3 || h >= 5) return 0;
    const resumeAt = new Date(d.getTime());
    resumeAt.setHours(5, 0, 0, 0);
    return resumeAt.getTime() - d.getTime();
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
    return ageMs > SNAPSHOT_MAX_AGE_MS ? `3600秒超過 ${Math.floor(ageMs / 1000)}秒` : '';
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
      keyword: pageParam('keyword', ''),
      hotelRoomCd: pageParam('hotelRoomCd', ''),
      searchHotelDiv: pageParam('searchHotelDiv', ''),
      searchLayer: pageParam('searchLayer', ''),
      hotelSearchDetail: pageParam('hotelSearchDetail', ''),
      checkPointStr: pageParam('checkPointStr', ''),
      childAgeBedInform: pageParam('childAgeBedInform', ''),
      commodityCodes: getCommodityCodesFromDom().sort().join(','),
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
    const savedNotify = storage.get(KEYS.notify);
    notifyMode = savedNotify === 'hotel' || savedNotify === '1' ? 'hotel' : 'off';
    notifyEnabled = notifyMode !== 'off';
    try { acquireEnabled = win.sessionStorage.getItem(KEYS.acquire) === '1'; } catch { acquireEnabled = false; }
    for (const bound of ['min', 'max']) {
      let value = '';
      try { value = win.sessionStorage.getItem(bound === 'min' ? KEYS.priceMin : KEYS.priceMax); } catch {}
      acquirePrice[bound] = ACQUIRE_PRICE_OPTIONS.includes(value) ? value : '';
    }
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
    apiAutoDeferred[kind] = null;
    apiAutoNotBefore[kind] = 0;
    if (apiAutoMode[kind] !== 'manual') {
      scheduleApiAuto(kind, { reason: 'modeChange' });
    }
    updateApiModePanel(kind);
  }
  function stopAllApiAuto(reason = '') {
    console.warn(`自動API停止: ${reason || 'エラー多発'}`);
    Object.keys(API_KIND).forEach(kind => setApiAutoMode(kind, 'manual'));
  }
  function makePanel(id, row, column, onClick) {
    document.getElementById(id)?.remove();
    const el = document.createElement('div');
    el.id = id;
    Object.assign(el.style, {
      gridRow: row,
      gridColumn: column,
      justifySelf: 'end',
      boxSizing: 'border-box',
      minWidth: Number(column) >= 3 ? PANEL.apiWidth : PANEL.minWidth,
      width: Number(column) >= 3 ? PANEL.apiWidth : 'auto',
      height: PANEL.height,
      padding: '0 2px',
      borderRadius: '5px',
      boxShadow: '0 2px 7px rgba(0,0,0,.35)',
      fontFamily: 'Arial, sans-serif',
      fontSize: '15px',
      fontWeight: 'bold',
      lineHeight: '24px',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
      cursor: 'pointer',
      userSelect: 'none',
      textAlign: 'center',
      border: '1px solid rgba(255,255,255,.75)'
    });
    el.addEventListener('click', onClick);
    panelContainer.appendChild(el);
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
    if (!panelContainer || !document.body.contains(panelContainer)) {
      document.getElementById(PANEL.id)?.remove();
      panelContainer = document.createElement('div');
      panelContainer.id = PANEL.id;
      Object.assign(panelContainer.style, {
        position: 'fixed', top: '0px', right: '1px', zIndex: '2147483647',
        display: 'grid', gridTemplateColumns: 'repeat(4, max-content)',
        gridTemplateRows: 'repeat(4, 26px)', gap: '1px'
      });
      document.body.appendChild(panelContainer);
    }
    document.getElementById(IDS.auto)?.remove();
    document.getElementById(IDS.oldAuto)?.remove();
    if (!rarePanel || !document.body.contains(rarePanel)) rarePanel = makePanel(IDS.rare, '1', '1', toggleRareFilter);
    if (!notifyPanel || !document.body.contains(notifyPanel)) notifyPanel = makePanel(IDS.notify, '1', '2', toggleNotify);
    if (!acquirePanel || !document.body.contains(acquirePanel)) {
      acquirePanel = makePanel(IDS.acquire, '2', '2', toggleAcquire);
    }
    if (!csvPanel || !document.body.contains(csvPanel)) {
      csvPanel = makePanel(IDS.csv, '2', '1', () => exportHotelCsv(false));
      csvPanel.textContent = '📥';
      csvPanel.title = '本日・全タブの通常CSVを保存（差分）';
      Object.assign(csvPanel.style, { background: '#29b6f6', color: '#000000' });
    }
    Object.keys(API_KIND).forEach(kind => {
      const cfg = API_KIND[kind];
      if (!apiModePanels[kind] || !document.body.contains(apiModePanels[kind])) {
        apiModePanels[kind] = makePanel(cfg.modeId, '1', cfg.column, () => setApiAutoMode(kind, nextApiMode(kind)));
      }
      if (!apiButtonPanels[kind] || !document.body.contains(apiButtonPanels[kind])) {
        apiButtonPanels[kind] = makePanel(cfg.buttonId, '2', cfg.column, () => runStockApiOnce(kind, '手動ボタン'));
      }
    });
    ensureAcquirePricePanels();
    updateRarePanel();
    updateNotifyPanel();
    updateAcquirePanel();
    Object.keys(API_KIND).forEach(kind => {
      updateApiModePanel(kind);
      updateApiButtonPanel(kind);
    });
  }
  function ensureAcquirePricePanels() {
    for (const bound of ['min', 'max']) {
      const labelText = bound === 'min' ? '最小' : '最大';
      let select = acquirePriceSelects[bound];
      if (!select || !document.body.contains(select)) {
        select = document.createElement('select');
        select.id = '__datetime_stock_monitor_price_' + bound;
        select.setAttribute('aria-label', '自動取得の' + labelText + '金額');
        Object.assign(select.style, {
          gridRow: bound === 'min' ? '3' : '4', gridColumn: '2', justifySelf: 'end',
          width: '46px', height: PANEL.height, padding: '0', margin: '0',
          boxSizing: 'border-box', font: 'bold 11px Arial, sans-serif',
          background: '#ffffff', color: '#000000', borderRadius: '4px'
        });
        for (const value of ['', ...ACQUIRE_PRICE_OPTIONS]) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value ? (Number(value) / 10000) + '万' : '--';
          select.appendChild(option);
        }
        select.addEventListener('change', () => {
          acquirePrice[bound] = ACQUIRE_PRICE_OPTIONS.includes(select.value) ? select.value : '';
          try { win.sessionStorage.setItem(bound === 'min' ? KEYS.priceMin : KEYS.priceMax, acquirePrice[bound]); } catch {}
          acquireEpoch++; // Require an API request started after the price change.
          ensureAcquirePricePanels();
        });
        panelContainer.appendChild(select);
        acquirePriceSelects[bound] = select;
      }
      select.value = acquirePrice[bound];
      const reversed = acquirePrice.min && acquirePrice.max && Number(acquirePrice.min) > Number(acquirePrice.max);
      select.setCustomValidity(reversed ? '最小値が最大値を超えています（自動取得対象なし）' : '');
      select.title = reversed ? '最小値が最大値を超えています（自動取得対象なし）' : labelText + '金額（-- は指定なし）';
    }
  }
  function updateRarePanel() {
    if (!rarePanel) return;
    Object.assign(rarePanel.style, rareFilterEnabled ? {
      background: '#f9a825',
      color: '#fff',
      borderColor: '#f57f17',
      opacity: '1'
    } : {
      background: '#333333',
      color: '#fff',
      borderColor: '#666',
      opacity: '1'
    });
    rarePanel.textContent = rareFilterEnabled ? '★' : '全';
  }
  function updateNotifyPanel() {
    if (!notifyPanel) return;
    Object.assign(notifyPanel.style, notifyEnabled ? {
      background: '#ffeb00',
      color: '#000000',
      borderColor: '#ffeb00',
      opacity: '1'
    } : {
      background: '#333333',
      color: '#ffffff',
      borderColor: '#666',
      opacity: '1'
    });
    notifyPanel.textContent = NOTIFY_MODES[notifyMode].icon;
    notifyPanel.title = `通知先: ${NOTIFY_MODES[notifyMode].label}`;
  }
  function updateApiModePanel(kind) {
    const panel = apiModePanels[kind];
    if (!panel) return;
    const mode = API_AUTO_MODES[apiAutoMode[kind]] || API_AUTO_MODES.manual;
    const elapsed = getApiBusyElapsedText(kind);
    const maintenance = apiAutoMode[kind] !== 'manual' && getMaintenanceDelayMs() > 0;
    Object.assign(panel.style, {
      background: elapsed
        ? `linear-gradient(to right, ${mode.background} 0%, ${mode.background} 20%, #7b2cbf 20%, #7b2cbf 100%)`
        : maintenance ? '#777777' : mode.background,
      color: elapsed ? '#ffffff' : mode.color,
      borderColor: 'rgba(255,255,255,.75)',
      opacity: '1'
    });
    panel.title = maintenance ? 'メンテナンス休止（5時再開）' : mode.name;
    panel.textContent = elapsed || (maintenance ? 'メンテ' : apiAutoMode[kind] === 'manual'
      ? 'OFF'
      : String(Math.max(0, Math.ceil((apiAutoNextAt[kind] - nowMs()) / 1000))));
  }
  function updateApiButtonPanel(kind) {
    const panel = apiButtonPanels[kind];
    const cfg = API_KIND[kind];
    if (!panel || !cfg) return;
    Object.assign(panel.style, {
      background: cfg.buttonBackground,
      color: '#fff',
      borderColor: cfg.buttonBorder,
      opacity: '1'
    });
    panel.textContent = cfg.buttonText;
  }
  function updateAcquirePanel() {
    if (!acquirePanel) return;
    Object.assign(acquirePanel.style, {
      background: acquireEnabled ? '#dc3545' : '#333333',
      color: '#ffffff', borderColor: acquireEnabled ? '#dc3545' : '#666', opacity: '1'
    });
    acquirePanel.textContent = acquireEnabled ? '🎯' : '⏸️';
    acquirePanel.title = acquireEnabled ? '自動取得ON（最新APIの空室を取得）' : '自動取得OFF';
  }
  function saveAcquireState() {
    try { win.sessionStorage.setItem(KEYS.acquire, acquireEnabled ? '1' : '0'); } catch (error) { internalLog('自動取得状態を保存できません', 'warn'); }
  }
  function toggleAcquire() {
    // An unfinished booking request must not be replaced by another room.
    if (!acquireEnabled && acquireCycle) {
      internalLog('自動取得: 前回の予約通信が未完了のためONにできません', 'warn');
      return;
    }
    acquireEnabled = !acquireEnabled;
    saveAcquireState();
    acquireEpoch++;
    acquireErrorCount = 0;
    updateAcquirePanel();
    internalLog('自動取得: ' + (acquireEnabled ? 'ON / 次のAPI応答を待機' : 'OFF'));
  }
  function stopAcquire(reason) {
    acquireEnabled = false;
    saveAcquireState();
    acquireEpoch++;
    updateAcquirePanel();
    internalLog('自動取得停止: ' + reason, 'warn');
  }
  function captureAcquireApiContext() {
    return acquireEnabled ? {
      acquireEpoch,
      acquireRequestNo: ++acquireRequestNo,
      acquirePageUrl: location.href,
      acquireCodes: getCommodityCodesFromDom().sort().join(',')
    } : {};
  }
  function validAcquireDate(raw) {
    if (!/^\d{8}$/.test(raw)) return false;
    const d = new Date(Date.UTC(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8)));
    return d.toISOString().slice(0, 10).replace(/-/g, '') === raw;
  }
  function isAcquirePriceAllowed(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return false;
    const price = Number(value);
    return Number.isFinite(price) && price > 0 &&
      (!acquirePrice.min || price >= Number(acquirePrice.min)) &&
      (!acquirePrice.max || price <= Number(acquirePrice.max));
  }
  function tryAutoAcquire(rows, context) {
    if (!acquireEnabled || acquireCycle || getMaintenanceDelayMs() > 0 ||
        context.acquireEpoch !== acquireEpoch || !context.acquireRequestNo ||
        context.acquireRequestNo !== latestAcquireResponse ||
        context.acquirePageUrl !== location.href) return;
    const codes = getCommodityCodesFromDom().sort();
    if (context.acquireCodes !== codes.join(',')) return;
    const row = rows.find(r => String(r.saleStatus) === '0' &&
      isAcquirePriceAllowed(r.roomPriceTotal) &&
      /^HO[A-Z0-9]{10,}$/.test(r.apiCommodityCd) && codes.includes(r.apiCommodityCd) &&
      validAcquireDate(r.priceUseDate) && r.priceUseDate === context.useDateOverride &&
      /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(r.priceFrameID));
    if (!row) return;
    const button = document.querySelector('.js-reserve.button.next');
    if (!button) {
      internalLog('自動取得: 予約ボタンがないため次のAPI応答を待機', 'warn');
      return;
    }
    const cycle = {
      commodityCd: row.apiCommodityCd, useDate: row.priceUseDate,
      priceFrameID: row.priceFrameID, roomName: row.roomName, roomPriceTotal: row.roomPriceTotal,
      pageUrl: location.href,
      noticeSent: false, reserveSent: false, watchdog: 0
    };
    acquireCycle = cycle;
    cycle.watchdog = win.setTimeout(() => {
      if (acquireCycle === cycle) stopAcquire('予約処理が60秒以内に完了しませんでした');
      // Keep the lock: an unknown result must not cause another booking attempt.
    }, 60000);
    internalLog('自動取得: ' + cycle.commodityCd + ' / ' + cycle.useDate + ' / ' + cycle.priceFrameID);
    const disabled = button.disabled;
    const hadDisabledClass = button.classList.contains('is-disabled');
    try {
      button.disabled = false;
      button.classList.remove('is-disabled');
      button.click();
      sendAcquireClickedNotification(cycle);
    } catch {
      stopAcquire('予約ボタンの操作に失敗しました');
    } finally {
      button.disabled = disabled;
      if (hadDisabledClass) button.classList.add('is-disabled');
    }
  }
  function sendAcquireClickedNotification(cycle) {
    // Reservation-button notifications always go to hotel, even when normal notifications are OFF.
    const webhookUrl = getDiscordWebhookUrl('hotel');
    if (!webhookUrl) {
      internalLog('自動予約押下通知: ホテル通知のWebhookが未設定です', 'warn');
      return;
    }
    const price = Number(cycle.roomPriceTotal);
    const priceText = Number.isFinite(price) && price > 0 ? '　' + price.toLocaleString('ja-JP') + '円' : '';
    const payload = {
      username: SCRIPT_NAME,
      embeds: [{
        title: '🟪' + notificationUseDateText(cycle.useDate) + '\n' + cycle.roomName,
        description: '自動予約ボタン押下\n' + tStrForNotification() + priceText + ' [' + cycle.priceFrameID + ']',
        color: 0x800080
      }],
      allowed_mentions: { parse: [] }
    };
    try {
      win.fetch(webhookUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), keepalive: true
      }).then(res => {
        internalLog('自動予約押下通知: HTTP ' + res.status, res.ok ? 'info' : 'warn');
      }).catch(() => internalLog('自動予約押下通知: 通信エラー', 'warn'));
    } catch {
      internalLog('自動予約押下通知: 送信できませんでした', 'warn');
    }
  }
  function acquirePostKind(url, method) {
    if (String(method || '').toUpperCase() !== 'POST') return '';
    try {
      const u = new URL(url, location.href);
      if (u.origin !== location.origin) return '';
      if (/\/hotel\/reserve\/?$/.test(u.pathname)) return 'reserve';
      if (/\/common\/notice\/?$/.test(u.pathname)) return 'notice';
    } catch {}
    return '';
  }
  function rewriteAcquireBody(body, kind, cycle) {
    let params;
    const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
    if (isForm) {
      params = new FormData();
      for (const [key, value] of body.entries()) params.append(key, value);
    } else if (typeof body === 'string' || body instanceof URLSearchParams) {
      params = new URLSearchParams(body);
    } else {
      throw new Error('Unsupported reservation body');
    }
    params.set('commodityCD', cycle.commodityCd);
    if (kind === 'reserve') {
      params.set('searchHotelCD', cycle.commodityCd.slice(2, 5));
      params.set('roomLetterCD', cycle.commodityCd.slice(5, 8));
      params.set('roomMaterialCD', cycle.commodityCd.slice(2, 12));
      params.set('useDate', cycle.useDate);
      params.set('hotelPriceFrameID', cycle.priceFrameID);
    } else {
      params.set('date', cycle.useDate);
    }
    return isForm ? params : params.toString();
  }
  function finishAcquireRequest(cycle, kind, status) {
    if (acquireCycle !== cycle) return;
    if (kind === 'notice' && status === 200) return; // Wait for the following reserve POST.
    win.clearTimeout(cycle.watchdog);
    acquireCycle = null;
    acquireEpoch++; // A retry requires an API request started after this result.
    if (status === 403 && acquireEnabled && ++acquireErrorCount < 9) {
      internalLog('自動取得: HTTP 403 / ' + acquireErrorCount + '回 / 次のAPI応答を待機', 'warn');
      return;
    }
    stopAcquire(kind === 'reserve' && status === 200
      ? '予約送信への応答を受信（HTTP 200）'
      : 'HTTP ' + status + ' / エラー回数 ' + acquireErrorCount);
  }
  function toggleRareFilter() {
    rareFilterEnabled = !rareFilterEnabled;
    storage.set(KEYS.rare, rareFilterEnabled ? '1' : '0');
    updateRarePanel();
    internalLog(`レア部屋フィルター: ${rareFilterEnabled ? 'ON' : 'OFF'} / ${getFilterLabel()}`);
  }
  function toggleNotify() {
    notifyMode = NOTIFY_MODE_ORDER[(NOTIFY_MODE_ORDER.indexOf(notifyMode) + 1) % NOTIFY_MODE_ORDER.length];
    notifyEnabled = notifyMode !== 'off';
    storage.set(KEYS.notify, notifyMode);
    updateNotifyPanel();
    internalLog(`Discord通知: ${NOTIFY_MODES[notifyMode].label}`);
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
    if (apiAutoTimer[kind]) win.clearTimeout(apiAutoTimer[kind]);
    apiAutoTimer[kind] = 0;
    apiAutoNextAt[kind] = 0;
  }
  function getApiRunMode(reason) {
    const text = String(reason || '');
    if (text.includes('短期')) return 'short';
    if (text.includes('中期')) return 'medium';
    if (text.includes('長期')) return 'long';
    return 'manual';
  }
  function scheduleApiAuto(kind, option = {}) {
    const cfg = API_KIND[kind];
    if (!cfg) return;
    clearApiAutoTimer(kind);
    apiAutoDeferred[kind] = null;
    if (apiAutoMode[kind] === 'manual') {
      apiAutoNotBefore[kind] = 0;
      updateApiModePanel(kind);
      return;
    }
    if (Number(option.backoffMs) > 0 && Number.isFinite(Number(option.backoffMs))) {
      apiAutoNotBefore[kind] = nowMs() + Number(option.backoffMs);
    }
    if (hasApiLoading()) {
      apiAutoDeferred[kind] = { reason: option.reason, ready: option.ready };
      updateApiModePanel(kind);
      return;
    }
    const maintenanceDelay = getMaintenanceDelayMs();
    if (maintenanceDelay > 0) {
      internalLog(`${cfg.label} メンテナンス時間帯のため待機: ${Math.round(maintenanceDelay / 1000)}秒`);
      apiAutoNextAt[kind] = nowMs() + maintenanceDelay;
      apiAutoTimer[kind] = win.setTimeout(() => {
        apiAutoNotBefore[kind] = 0;
        scheduleApiAuto(kind, { ready: true, reason: 'maintenanceEnd' });
      }, maintenanceDelay);
      updateApiModePanel(kind);
      return;
    }
    const delayMs = apiAutoNotBefore[kind] > nowMs()
      ? apiAutoNotBefore[kind] - nowMs()
      : option.ready || apiAutoMode[kind] === 'short'
        ? 0
        : apiAutoMode[kind] === 'medium'
          ? randomMediumDelayMs()
          : randomLongDelayMs();
    const modeName = API_AUTO_MODES[apiAutoMode[kind]]?.name || apiAutoMode[kind];
    internalLog(`${cfg.label} 自動API: ${modeName} / ${Math.round(delayMs / 1000)}秒後`);
    apiAutoNextAt[kind] = nowMs() + delayMs;
    apiAutoTimer[kind] = win.setTimeout(() => {
      apiAutoTimer[kind] = 0;
      apiAutoNextAt[kind] = 0;
      if (hasApiLoading()) {
        apiAutoDeferred[kind] = { ready: true };
        updateApiModePanel(kind);
        return;
      }
      runStockApiOnce(kind, `自動${modeName}`);
    }, delayMs);
    updateApiModePanel(kind);
  }
  function startInitialApiAuto() {
    const start = () => {
      Object.keys(API_KIND).forEach(kind => {
        if (apiAutoMode[kind] === 'manual') return;
        scheduleApiAuto(kind, { backoffMs: apiAutoMode[kind] === 'short' ? 1000 : 0, reason: 'initial' });
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
  function handleApiSuccess(sourceLabel = '') {
    lastApiSuccessTime = apiEventTime();
    if (consecutiveErrorCount) {
      internalLog(`${sourceLabel || 'API'} 成功: エラーカウントリセット`);
    }
    consecutiveErrorCount = 0;
    showPopup(getClockStr(), 'rgba(0, 102, 204, 0.9)');
  }
  function handleApiError(errObj, targetYmd, sourceLabel, customMsg = '') {
    consecutiveErrorCount++;
    lastApiErrorTime = apiEventTime();
    const count = consecutiveErrorCount;
    const errStatus = errObj?.status || errObj?.statusText || errObj?.name || 'Error';
    const useDate = targetYmd || getActiveUseDateYmd() || '';
    const bgOrange = 'rgba(255, 152, 0, 0.9)';
    if (count >= 25) {
      const msg = `当日API・翌日APIをOFFに変更して停止します。${customMsg ? `\n${customMsg}` : ''}`;
      showPopup(`🔶${toCircled(count)} ${getClockStr()}`, bgOrange);
      sendApiErrorDiscord(errStatus, useDate, sourceLabel, msg, count);
      return { ok: false, status: 0, backoffMs: 0, stopAuto: true };
    }
    if ([10, 15, 20].includes(count)) {
      const msg = `1200秒後に現在のモードで自動再開します。${customMsg ? `\n${customMsg}` : ''}`;
      showPopup(`🟧${toCircled(count)} ${getClockStr()}`, bgOrange);
      sendApiErrorDiscord(errStatus, useDate, sourceLabel, msg, count);
      return { ok: false, status: 0, backoffMs: NORMAL_COOLDOWN_MS, stopAuto: false };
    }
    showPopup(`⚠️${toCircled(count)} ${getClockStr()}`, 'rgba(255, 204, 0, 0.9)', '#000');
    return { ok: false, status: 0, backoffMs: isBurstTime() ? BURST_ERROR_RETRY_MS : NORMAL_ERROR_RETRY_MS, stopAuto: false };
  }
  async function sendApiErrorDiscord(errStatus, targetYmd, sourceLabel, customMsg, count) {
    const stopped = count >= 25;
    const dateText = /^\d{8}$/.test(targetYmd)
      ? `${targetYmd.slice(0, 4)}年${targetYmd.slice(4, 6)}月${targetYmd.slice(6, 8)}日`
      : '日付不明';
    const kindText = sourceLabel === API_KIND.next.label ? '翌日' : sourceLabel === API_KIND.current.label ? '当日' : 'API';
    // Snapshot event times before awaiting the IP lookup.
    const successLine = lastApiSuccessTime ? `${lastApiSuccessTime}　成功` : '成功記録なし';
    const errorLine = `${lastApiErrorTime}　エラー${count}回目`;
    const modeText = Object.entries(API_KIND)
      .map(([kind, cfg]) => `${cfg.label}:${API_AUTO_MODES[apiAutoMode[kind]]?.name || apiAutoMode[kind]}`)
      .join(' / ');
    const ip = await getIP();
    enqueueDiscord({
      username: SCRIPT_NAME,
      embeds: [{
        title: `${stopped ? '🔶' : '🟧'}${dateText}（${kindText}）\n${stopped ? '強制停止' : '20分停止'}（${count}回エラー）`,
        color: 0xFF9800,
        description: [
          successLine,
          errorLine,
          `HTTP ${errStatus}`,
          `IP: ${ip}`,
          `モード: ${modeText}`,
          customMsg
        ].filter(Boolean).join('\n')
      }],
      allowed_mentions: { parse: [] }
    }, true);
  }
  async function runStockApiOnce(kind, reason = '手動') {
    const cfg = API_KIND[kind];
    if (!cfg) return false;
    if (hasApiLoading()) {
      internalLog(`${cfg.label}: 通信中のためスキップ / ${reason}`);
      if (apiAutoMode[kind] !== 'manual') scheduleApiAuto(kind, { ready: true, reason: 'busyRetry' });
      return false;
    }
    clearApiAutoTimer(kind);
    apiAutoDeferred[kind] = null;
    customApiPriorityUntil = nowMs() + 15000;
    apiBusy = true;
    apiBusyKind = kind;
    apiBusyStartAt = nowMs();
    updateApiModePanel(kind);
    let result = { ok: false, status: 0, backoffMs: 0, stopAuto: false };
    try {
      result = await requestStockApiCore(kind, reason);
      return !!result.ok;
    } finally {
      customApiPriorityUntil = nowMs() + 5000;
      apiBusy = false;
      apiBusyKind = '';
      apiBusyStartAt = 0;
      updateApiModePanel(kind);
      apiAutoDeferred[kind] = null;
      if (result.stopAuto) {
        stopAllApiAuto(`${cfg.label} エラー多発`);
      } else {
        const cooldown = result.backoffMs === NORMAL_COOLDOWN_MS;
        if (cooldown) {
          const resumeAt = nowMs() + NORMAL_COOLDOWN_MS;
          Object.keys(API_KIND).forEach(key => { apiAutoNotBefore[key] = resumeAt; });
        }
        resumeDeferredApiAuto();
        if (result.ok) apiAutoNotBefore[kind] = 0;
        if (cooldown) {
          Object.keys(API_KIND).forEach(key => scheduleApiAuto(key, { reason: 'errorCooldown' }));
        } else if (apiAutoMode[kind] !== 'manual') {
          scheduleApiAuto(kind, { backoffMs: result.backoffMs || 0, reason });
        }
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
    const acquireContext = captureAcquireApiContext();
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
      await handleJSON(txt, {
        ...acquireContext,
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
      this._tdrDaySearchMethod = m;
      return oOpen.call(this, m, url, ...rest);
    };
    win.XMLHttpRequest.prototype.send = function (...rest) {
      const url = this._tdrDaySearchUrl || '';
      const kind = acquirePostKind(url, this._tdrDaySearchMethod);
      const cycle = kind && acquireCycle;
      if (cycle) {
        if (!acquireEnabled || cycle.pageUrl !== location.href || cycle[kind + 'Sent'] ||
            (kind === 'notice' && cycle.reserveSent)) {
          stopAcquire('停止中または重複した予約送信を中止しました');
          throw new Error('Auto acquisition request cancelled');
        }
        try {
          rest[0] = rewriteAcquireBody(rest[0], kind, cycle);
        } catch (e) {
          stopAcquire('予約送信形式を確認できないため中止しました');
          throw e;
        }
        cycle[kind + 'Sent'] = true;
        this.addEventListener('loadend', () => finishAcquireRequest(cycle, kind, this.status), { once: true });
      }
      const acquireContext = ENDPOINT.test(url) ? captureAcquireApiContext() : {};
      const bodyYmd = getRequestBodyUseDate(rest[0]);
      let finishLoading = () => {};
      let processing = Promise.resolve();
      const onLoadEnd = () => processing.finally(finishLoading);
      if (ENDPOINT.test(url)) {
        finishLoading = beginPassiveApiLoading(bodyYmd || getUrlUseDateYmd());
        this.addEventListener('loadend', onLoadEnd, { once: true });
        this.addEventListener('load', () => {
          if (this.status < 200 || this.status >= 300) return;
          processing = Promise.resolve(handleJSON(this.responseText, {
            ...acquireContext,
            sourceLabel: '',
            apiReceivedAt: tStrMs(),
            useDateOverride: bodyYmd || getUrlUseDateYmd(),
            passiveApi: true,
            apiMode: ''
          }));
        }, { once: true });
      }
      try {
        return oSend.apply(this, rest);
      } catch (e) {
        this.removeEventListener('loadend', onLoadEnd);
        if (cycle) finishAcquireRequest(cycle, kind, 0);
        finishLoading();
        throw e;
      }
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
        const passiveStockApi = ENDPOINT.test(url) && !customStockApi;
        const acquireContext = passiveStockApi ? captureAcquireApiContext() : {};
        const finishLoading = passiveStockApi
          ? beginPassiveApiLoading(bodyYmd || getUrlUseDateYmd())
          : () => {};
        let p;
        try {
          p = Reflect.apply(t, th, callArgs);
        } catch (e) {
          finishLoading();
          throw e;
        }
        if (passiveStockApi) {
          p.then(r => r.ok ? r.clone().text().then(txt => handleJSON(txt, {
            ...acquireContext,
            sourceLabel: '',
            apiReceivedAt: tStrMs(),
            useDateOverride: bodyYmd || getUrlUseDateYmd(),
            passiveApi: true,
            apiMode: ''
          })) : undefined).catch(() => {}).finally(finishLoading);
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
  // IndexedDB append transactions are shared by tabs; console snapshots remain separate.
  const CSV_DB_NAME = 'tdr-hotel-list-csv-v1';
  const CSV_AM11_DB_NAME = 'tdr-hotel-list-am11-csv-v1';
  const csvTabId = win.crypto?.randomUUID?.() || `${nowMs()}-${Math.random().toString(36).slice(2)}`;
  const csvBaselines = new Map();
  const csvAutoCompleted = new Set();
  const csvDbPromises = { normal: null, am11: null };
  const csvWriteQueues = { normal: Promise.resolve(), am11: Promise.resolve() };
  let csvAutoTimer = 0;
  const csvExportBusy = { normal: false, am11: false };
  let csvStorageWarned = false;
  function csvFailure(error) {
    internalLog(`CSV記録・保存失敗: ${error?.message || error}`, 'warn');
    if (!csvStorageWarned) {
      csvStorageWarned = true;
      console.warn('CSVを保存できません。ブラウザの保存容量・設定を確認してください。');
      showPopup('CSV保存エラー', '#c62828');
    }
  }
  function csvDayInfo(ms) {
    const d = new Date(ms + 9 * 60 * 60 * 1000);
    const year = d.getUTCFullYear(), month = d.getUTCMonth(), day = d.getUTCDate();
    const dayKey = `${year}${pad(month + 1)}${pad(day)}`;
    const midnight = new Date(`${year}-${pad(month + 1)}-${pad(day)}T00:00:00+09:00`).getTime();
    const target = new Date(0);
    target.setUTCFullYear(year, month + 4, day);
    // No same calendar day exists in the target month: do not guess a stay date.
    const targetYmd = target.getUTCDate() === day
      ? `${target.getUTCFullYear()}${pad(target.getUTCMonth() + 1)}${pad(day)}` : '';
    return { dayKey, midnight, targetYmd, start: midnight + 39540 * 1000, end: midnight + 39900 * 1000,
      time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}` };
  }
  function openHotelCsvDb(kind = 'normal') {
    if (!csvDbPromises[kind]) csvDbPromises[kind] = new Promise((resolve, reject) => {
      if (!win.indexedDB) return reject(new Error('IndexedDB未対応'));
      const request = win.indexedDB.open(kind === 'am11' ? CSV_AM11_DB_NAME : CSV_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('responses', { keyPath: 'id', autoIncrement: true }).createIndex('day', 'day');
        db.createObjectStore('exports', { keyPath: 'day' });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); csvDbPromises[kind] = null; };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    }).catch(error => { csvDbPromises[kind] = null; throw error; });
    return csvDbPromises[kind];
  }
  function csvTransaction(db, stores, mode, action) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error || new Error('CSV transaction aborted'));
      tx.onerror = () => {}; // onabort reports the final transaction outcome.
      try { action(tx, value => { result = value; }); } catch (error) { tx.abort(); reject(error); }
    });
  }
  function appendHotelCsv(kind, record, onFailure = () => {}) {
    const write = (async () => {
      const db = await openHotelCsvDb(kind);
      await csvTransaction(db, ['responses'], 'readwrite', tx => tx.objectStore('responses').add(record));
    })().catch(error => { onFailure(); csvFailure(error); });
    csvWriteQueues[kind] = Promise.all([csvWriteQueues[kind], write]).then(() => {});
  }
  function recordHotelCsv(inputRows, context, receivedMs) {
    try {
      const useDate = String(context.useDateOverride || getUrlUseDateYmd() || '');
      if (!/^\d{8}$/.test(useDate)) return;
      const day = csvDayInfo(receivedMs);
      const full = receivedMs >= day.start && receivedMs <= day.end;
      const rare = rareFilterEnabled;
      // A mismatched row date is not evidence for this request's stay date.
      const rows = inputRows.filter(row => (!row.priceUseDate || row.priceUseDate === useDate) && (!rare || isRareRoomRow(row)))
        .map(row => ({ ...row }));
      if (!rows.length) return;
      const domOrder = buildOfficialDomOrder();
      applyDomInfo(rows, domOrder);
      sortRows(rows);
      const params = new URLSearchParams(location.search);
      const search = Object.fromEntries(['stayingDays', 'roomsNum', 'adultNum', 'childNum', 'searchHotelCD', 'searchRoomName',
        'keyword', 'hotelRoomCd', 'childAgeBedInform'].map(key => [key, params.get(key) || '']));
      const scope = `${day.dayKey}|${useDate}|${rare}|${JSON.stringify(search)}|${getCommodityCodesFromDom().sort().join(',')}`;
      const previous = csvBaselines.get(scope);
      const next = new Map(previous || []);
      const changed = [];
      rows.forEach(row => {
        const key = `${row.hotelCd}|${row.roomCd}|${row.roomName}`;
        const value = `${row.saleStatus}|${row.remainStockNum}`;
        if (!previous || previous.get(key) !== value) changed.push(row);
        next.set(key, value);
      });
      const packRows = selected => selected.map(row => ({ hotelCd: row.hotelCd, hotelName: row.hotelName || row.hotelCd,
        roomCd: row.roomCd, roomName: row.roomName, category: row.categoryLabel || '',
        status: String(row.saleStatus), stock: row.remainStockNum, price: row.roomPriceTotal ?? '', rank: row.priceFrameID || '' }));
      const record = { day: day.dayKey, receivedMs, time: day.time, useDate, tabId: csvTabId,
        source: context.sourceLabel || '通常API', rare: rare ? 'レア' : '全室', search: JSON.stringify(search) };
      if (changed.length) appendHotelCsv('normal', { ...record, mode: previous ? '差分' : '初回', rows: packRows(changed) }, () => csvBaselines.delete(scope));
      if (full && useDate === day.targetYmd) appendHotelCsv('am11', { ...record, mode: '全室', rows: packRows(rows) });
      csvBaselines.set(scope, next);
    } catch (error) { csvFailure(error); }
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+@\t\r]/.test(text) || /^-(?!\d+(?:\.\d+)?$)/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function buildHotelCsv(records) {
    const lines = [['取得日', '応答受信時刻', '宿泊日', 'ホテルコード', 'ホテル名', 'カテゴリ',
      '客室コード', '客室名', 'ステータスコード', '残室数', '料金', '価格ランク', 'タブID', '応答ID', 'API', 'フィルター', '記録種別', '検索条件']];
    const lastSearchByTab = new Map();
    records.sort((a, b) => a.receivedMs - b.receivedMs || a.id - b.id).forEach(record => {
      record.rows.forEach(row => {
        const search = lastSearchByTab.get(record.tabId) === record.search ? '' : record.search;
        lastSearchByTab.set(record.tabId, record.search);
        lines.push([record.day, record.time, record.useDate, row.hotelCd, row.hotelName, row.category,
          row.roomCd, row.roomName, row.status, row.stock, row.price, row.rank, record.tabId, record.id,
          record.source, record.rare, record.mode, search]);
      });
    });
    return '\uFEFF' + lines.map(line => line.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  function downloadHotelCsv(text, filename) {
    const url = win.URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    try { link.click(); } finally {
      link.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 60000);
    }
  }
  async function exportHotelCsv(automatic, dayKey = csvDayInfo(nowMs()).dayKey) {
    const kind = automatic ? 'am11' : 'normal';
    if (csvExportBusy[kind] || (automatic && csvAutoCompleted.has(dayKey))) return;
    csvExportBusy[kind] = true;
    let db, claimed = false;
    try {
      await csvWriteQueues[kind];
      db = await openHotelCsvDb(kind);
      let records = await csvTransaction(db, ['responses'], 'readonly', (tx, done) => {
        const request = tx.objectStore('responses').index('day').getAll(dayKey);
        request.onsuccess = () => done(request.result);
      });
      if (!records.length) {
        if (!automatic) showPopup('本日のCSVデータなし', '#37474f');
        return;
      }
      if (automatic) {
        claimed = await csvTransaction(db, ['exports'], 'readwrite', (tx, done) => {
          const store = tx.objectStore('exports'), request = store.get(dayKey);
          request.onsuccess = () => {
            const old = request.result;
            if (old?.done) { csvAutoCompleted.add(dayKey); return done(false); }
            if (old?.leaseUntil > nowMs()) return done(false);
            store.put({ day: dayKey, owner: csvTabId, leaseUntil: nowMs() + 60000, done: false });
            done(true);
          };
        });
        if (!claimed) return;
      }
      const saveTime = csvDayInfo(nowMs()).time.slice(0, 8).replace(/:/g, '');
      const filename = automatic ? `${dayKey}_110500_hotel_AM11.csv` : `${dayKey}_${saveTime}_hotel.csv`;
      downloadHotelCsv(buildHotelCsv(records), filename);
      if (automatic) await csvTransaction(db, ['exports'], 'readwrite', tx => {
        tx.objectStore('exports').put({ day: dayKey, owner: csvTabId, done: true });
      });
      if (automatic) csvAutoCompleted.add(dayKey);
      internalLog(`CSVダウンロード開始: ${filename} / ${records.length}応答`);
    } catch (error) {
      if (claimed && db) await csvTransaction(db, ['exports'], 'readwrite', tx => tx.objectStore('exports').delete(dayKey)).catch(() => {});
      csvFailure(error);
    } finally { csvExportBusy[kind] = false; }
  }
  function startHotelCsvAutoSave() {
    openHotelCsvDb('normal').catch(csvFailure);
    openHotelCsvDb('am11').catch(csvFailure);
    const tick = () => {
      const ms = nowMs(), day = csvDayInfo(ms);
      // Let writes from other tabs at the 11:05 boundary settle before taking the snapshot.
      if (ms >= day.end + 2000) exportHotelCsv(true, day.dayKey);
      const delay = ms < day.end + 2000 ? Math.min(60000, day.end + 2000 - ms) : 60000;
      csvAutoTimer = win.setTimeout(tick, delay);
    };
    if (csvAutoTimer) win.clearTimeout(csvAutoTimer);
    tick();
  }

  function handleJSON(txt, context = {}) {
    const receivedMs = nowMs();
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
              apiCommodityCd: normalize(current.commodityCd || ''),
              priceFrameID: normalize(current.priceFrameID || current.priceLevel || ''),
              priceUseDate: String(current.useDate || ''),
              roomPriceTotal: current.roomPriceTotal,
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
      recordHotelCsv(rows, context, receivedMs);
      if (isPassiveApiBlocked(context)) {
        internalLog(`カスタムAPI優先中のため通常API処理をスキップ: useDate=${context.useDateOverride || getUrlUseDateYmd() || '不明'}`);
        return;
      }
      if (isDuplicateJson(txt, context)) {
        internalLog(`同一APIレスポンスの重複処理をスキップ: ${context.sourceLabel || '通常API'} / useDate=${context.useDateOverride || getUrlUseDateYmd() || '不明'}`);
        return;
      }
      if (context.acquireEpoch === acquireEpoch && context.acquireRequestNo) {
        latestAcquireResponse = Math.max(latestAcquireResponse, context.acquireRequestNo);
      }
      return new Promise(resolve => win.setTimeout(() => {
        try {
          renderRows(rows, {
            ...context,
            apiReceivedAt: context.apiReceivedAt || tStrMs()
          });
        } finally {
          resolve();
        }
      }, DOM_WAIT_MS));
    } catch {}
  }
  function getDiscordWebhookUrl(mode = notifyMode) {
    const key = NOTIFY_MODES[mode]?.key;
    return key ? win.TDR_WEBHOOKS?.[key] || window.TDR_WEBHOOKS?.[key] || '' : '';
  }
  function logWebhookStatus(force = false) {
    if (webhookStatusLogged && !force) return;
    for (const mode of ['research', 'hotel']) {
      if (!getDiscordWebhookUrl(mode)) internalLog(`Discord Webhook未読込: ${mode === 'hotel' ? 'ホテル通知' : 'ホテル調査'}`, 'warn');
    }
    webhookStatusLogged = true;
  }
  function enqueueDiscord(payload, important = false) {
    const destinations = important ? ['hotel'] : notifyEnabled ? ['research', 'hotel'] : ['research'];
    destinations.forEach(mode => {
      discordQueues[mode].push({ payload, mode });
      processDiscordQueue(mode);
    });
  }
  async function processDiscordQueue(mode) {
    const discordQueue = discordQueues[mode];
    if (discordSending[mode] || !discordQueue.length) return;
    const item = discordQueue[0];
    const webhookUrl = getDiscordWebhookUrl(item.mode);
    if (!webhookUrl) {
      internalLog(`Discord Webhook未設定: ${NOTIFY_MODES[item.mode].label} の設定を確認してください`, 'warn');
      win.setTimeout(() => processDiscordQueue(mode), 3000);
      return;
    }
    discordSending[mode] = true;
    try {
      const res = await win.fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.payload)
      });
      if (res.status === 429) {
        let retryMs = 1500;
        try {
          const data = await res.json();
          if (Number.isFinite(Number(data.retry_after))) retryMs = Math.ceil(Number(data.retry_after) * 1000);
        } catch {}
        internalLog(`Discord rate limit: ${retryMs}ms待機`, 'warn');
        discordSending[mode] = false;
        win.setTimeout(() => processDiscordQueue(mode), retryMs);
        return;
      }
      if (res.ok) internalLog('Discord通知送信完了');
      else internalLog(`Discord通知失敗: ${res.status}`, 'warn');
      if (discordQueue[0] === item) discordQueue.shift();
    } catch (e) {
      internalLog(`Discord通知エラー: ${e?.message || e}`, 'warn');
      if (discordQueue[0] === item) discordQueue.shift();
    }
    discordSending[mode] = false;
    win.setTimeout(() => processDiscordQueue(mode), 300);
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
        roomPriceTotal: r.priceUseDate === useDate && Number.isFinite(Number(r.roomPriceTotal)) && Number(r.roomPriceTotal) > 0
          ? Number(r.roomPriceTotal) : null,
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
      internalLog(`前回スナップショットなし: useDate=${currentUseDate} / ${key}`);
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
        internalLog(`現在スナップショット破棄: ${reason} / ${key}`);
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
      internalLog(`前回スナップショット読込: ${map.size}件 / useDate=${currentUseDate} / ${key}`);
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
    if (ok) internalLog(`スナップショット保存: ${items.length}件 / useDate=${useDate} / savedAt=${savedAt} / ${key}`);
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
    // A partial response does not establish that omitted rooms were deleted.
    saveStoredSnapshot(new Map([...previousSnapshot, ...currentSnapshot]));
    if (!changes.length) {
      return { status: 'none', message: '差分なし', changes: [], changedKeys: new Set() };
    }
    const changedKeys = changedKeySet(changes);
    sendDiscordDiff(changes);
    return { status: 'changed', message: `差分あり: ${changes.length}件`, changes, changedKeys };
  }
  function logDiffSummary(diffResult, sourceName, useDateText, filterLabel, option = {}) {
    if (!diffResult) return;
    const title = diffResult.status === 'changed'
      ? `差分 / ${diffResult.changes.length}件`
      : '差分 / なし';
    const groupFn = diffResult.status === 'changed'
      ? console.group.bind(console)
      : console.groupCollapsed.bind(console);
    const compactTitle = `${filterLabel}差分${diffResult.status === 'changed' ? `${diffResult.changes.length}件` : 'なし'}`;
    groupFn(option.compact ? `${option.apiReceivedAt} / ${useDateText} / ${compactTitle}` : title);
    if (diffResult.status === 'changed') {
      diffResult.changes.forEach(change => {
        const base = change.now || change.old;
        const style = diffStatusStyle(change);
        const line = `${statusTransitionTextShort(change)}　${base?.roomName || ''}`;
        console.log(`%c${line}`, style);
      });
      if (!notifyEnabled && !option.compact) {
        console.info('差分はホテル調査へ送信');
      }
    } else if (diffResult.status === 'none') {
      if (!option.compact) console.info('差分なし');
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
  function notificationUseDateText(raw) {
    if (!/^\d{8}$/.test(raw || '')) return '日付不明';
    const date = new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8))));
    return `${raw.slice(0, 4)}年${raw.slice(4, 6)}月${raw.slice(6, 8)}日（${"日月火水木金土"[date.getUTCDay()]}）`;
  }
  function sendDiscordChange(change) {
    if (change.type === 'remove') return;
    const status = notifyStatusForChange(change);
    const base = change.now || change.old;
    const price = Number(change.now?.roomPriceTotal);
    const priceText = Number.isFinite(price) && price > 0 ? `　${price.toLocaleString('ja-JP')}円` : '';
    enqueueDiscord({
      username: SCRIPT_NAME,
      embeds: [{
        title: `${TITLE_EMOJI[status] || '🔔'}${notificationUseDateText(base.useDate)}\n${base.roomName || ''}`,
        description: `${statusTransitionText(change)}\n${tStrForNotification()}${priceText}`,
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
      const autoRead = context.customApi && ['long', 'medium', 'short'].includes(context.apiMode);
      const domOrder = buildOfficialDomOrder();
      const allRows = inputRows.slice();
      applyDomInfo(allRows, domOrder);
      sortRows(allRows);
      tryAutoAcquire(allRows, context);
      const targetRows = rareFilterEnabled ? allRows.filter(isRareRoomRow) : allRows.slice();
      const allowEmptySnapshot = rareFilterEnabled && allRows.length > 0;
      if (autoRead) {
        const diffResult = handleNotifyDiff(targetRows, { allowEmptySnapshot });
        if (diffResult.status === 'changed' || diffResult.status === 'none') {
          logDiffSummary(diffResult, sourceName, useDateText, filterLabel, { compact: true, apiReceivedAt });
        } else if (diffResult.status === 'skipped') {
          console.warn(diffResult.message);
        }
        return;
      }
      console.groupCollapsed(
        `%c${apiReceivedAt}`,
        'background:#111;color:#fff;font-weight:900;font-size:13px;padding:1px 6px;border-radius:3px;line-height:1.1;'
      );
      console.info(`対象: ${sourceName}`);
      console.info(`useDate: ${useDateText}`);
      console.info(`フィルター: ${filterLabel}`);
      console.info('表示モード: 全室・全ステータス');
      console.info(`DOM読込: bed=${domOrder.countCommodity} / room=${domOrder.countRoomName}`);
      if (rareFilterEnabled) {
        console.info(`レア部屋フィルターON: 対象${targetRows.length}件 / 全${allRows.length}件 / rule=${getRareRuleHash()}`);
      } else {
        console.info(`レア部屋フィルターOFF: 全件対象 ${targetRows.length}件`);
      }
      const diffResult = handleNotifyDiff(targetRows, { allowEmptySnapshot });
      const changedRowKeys = diffResult.changedKeys || new Set();
      const rows = allRows.slice();
      console.info(`ログ集計: 表示${rows.length}件 / 対象${targetRows.length}件 / 全${allRows.length}件`);
      flushInternalLogs();
      console.groupEnd();
      const roomGroupFn = console.group.bind(console);
      const dateTitleStyle = sourceName === '翌日API'
        ? 'background:#6a1b9a;color:#fff;font-weight:900;padding:1px 6px;border-radius:3px;line-height:1.1;'
        : 'color:inherit;font-weight:700;';
      roomGroupFn(
        `%c${useDateText}%c / 全室 / 表示${rows.length}件`,
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
    console.info('対象外ページのため停止: 宿泊日指定のSPホテル一覧のみ');
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
  startHotelCsvAutoSave();
  startInitialApiAuto();
  internalLog('official DOM-order logger ready / rare room filter / v2.10');
})();
