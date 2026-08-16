// ==UserScript==
// @name         ℹ️客室情報画面
// @version      2.38
// @match        https://reserve.tokyodisneyresort.jp/online/sp/wv/roominfo*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/roominfo.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/roominfo.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const PAGE_MODE = getPageMode();
  if (PAGE_MODE === 'other') return;

  if (window.__tdr_roominfo_installed) return;
  window.__tdr_roominfo_installed = true;

  const STORAGE_KEY_NOTIFY = 'tdr_roominfo_notify_enabled';
  const STORAGE_KEY_NOTIFY_DATE = 'tdr_roominfo_notify_date';
  const LAST_ROOMINFO_KEY = 'tdr_roominfo_last_data';
  const STORAGE_TIMER_TRIGGER_TIME_KEY = 'tdr_11am_timer_trigger_time';

  const IP_API_URL = 'https://api.ipify.org?format=json';

  const COLOR_START = 0x00ff66;
  const COLOR_START_LOAD = 0x66ff99;
  const COLOR_CONTINUE = 0x009933;
  const COLOR_ERROR = 0xff9900;

  const COUNTDOWN_MINUTES = 10;

  let timerEndAt = Date.now() + getCountdownMs();
  let countdownTimer = null;
  let countdownEnabled = true;
  let notifiedThisPage = false;
  let errorNotifiedThisPage = false;
  let autoActionRunning = false;
  let publicIpCache = null;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SCRIPT_START_DATE = new Date();
  const SCRIPT_START_TIME_TEXT = formatTimeText(SCRIPT_START_DATE);

  console.log('[ℹ️客室情報画面] v2.38 起動:', PAGE_MODE, `${getCountdownMinutes()}分`);

  function getPageMode() {
    const path = location.pathname.replace(/\/+$/, '');

    if (path === '/online/sp/wv/roominfo/next') return 'next';
    if (path === '/online/sp/wv/roominfo/back') return 'normal';
    if (path === '/online/sp/wv/roominfo') return 'normal';

    return 'other';
  }

  function getCurrentPath() {
    return location.pathname.replace(/\/+$/, '');
  }

  function getCountdownMinutes() {
    return COUNTDOWN_MINUTES;
  }

  function getCountdownMs() {
    return getCountdownMinutes() * 60 * 1000;
  }

  function getTodayKey() {
    const d = new Date();

    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('');
  }

  function canAutoPressBack() {
    return PAGE_MODE === 'next' &&
      getCurrentPath() === '/online/sp/wv/roominfo/next';
  }

  function canAutoPressNext() {
    const path = getCurrentPath();

    return PAGE_MODE === 'normal' && (
      path === '/online/sp/wv/roominfo' ||
      path === '/online/sp/wv/roominfo/back'
    );
  }

  function getDiscordWebhookUrl() {
    return window.TDR_WEBHOOKS?.hotel || '';
  }

  function getNotifyEnabled() {
    const today = getTodayKey();
    const savedDate = localStorage.getItem(STORAGE_KEY_NOTIFY_DATE);

    if (savedDate !== today) {
      localStorage.setItem(STORAGE_KEY_NOTIFY, '1');
      localStorage.setItem(STORAGE_KEY_NOTIFY_DATE, today);
      return true;
    }

    const v = localStorage.getItem(STORAGE_KEY_NOTIFY);
    return v === null ? true : v === '1';
  }

  function setNotifyEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY_NOTIFY, enabled ? '1' : '0');
    localStorage.setItem(STORAGE_KEY_NOTIFY_DATE, getTodayKey());
  }

  function resetTimer() {
    timerEndAt = Date.now() + getCountdownMs();
  }

  function toggleCountdown() {
    countdownEnabled = !countdownEnabled;

    if (countdownEnabled) {
      resetTimer();
      console.log('[ℹ️客室情報画面] カウントON');
    } else {
      console.log('[ℹ️客室情報画面] カウントOFF');
    }

    updateCountdownPanel();
  }

  function normalize(s) {
    return String(s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .replace(/\n+/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function esc(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getText() {
    return document.body ? document.body.innerText || '' : '';
  }

  function formatTimeText(d) {
    return `${d.getHours()}時${String(d.getMinutes()).padStart(2, '0')}分${String(d.getSeconds()).padStart(2, '0')}秒`;
  }

  function getLoadTimeText() {
    const saved = String(localStorage.getItem(STORAGE_TIMER_TRIGGER_TIME_KEY) || '').trim();
    return saved && saved !== 'OFF' ? saved : '不明';
  }

  function isStartTimeInLoadWindow() {
    const d = SCRIPT_START_DATE;
    const h = d.getHours();
    const m = d.getMinutes();
    const s = d.getSeconds();

    return (
      (h === 10 && m === 59 && s >= 40) ||
      (h === 11 && m === 0 && s <= 40)
    );
  }

  function getLoadSuffix() {
    return isStartTimeInLoadWindow()
      ? `　（読込：${getLoadTimeText()}）`
      : '';
  }

  function getOpenNotifyNote() {
    const path = getCurrentPath();
    const suffix = getLoadSuffix();

    if (path === '/online/sp/wv/roominfo') {
      return `仮予約 開始：${SCRIPT_START_TIME_TEXT}${suffix}`;
    }

    if (path === '/online/sp/wv/roominfo/back') {
      return `仮予約 継続：${SCRIPT_START_TIME_TEXT}${suffix}`;
    }

    return '';
  }

  function getOpenNotifyColor() {
    const path = getCurrentPath();

    if (path === '/online/sp/wv/roominfo' && isStartTimeInLoadWindow()) {
      return COLOR_START_LOAD;
    }

    if (path === '/online/sp/wv/roominfo/back') {
      return COLOR_CONTINUE;
    }

    return COLOR_START;
  }

  function getErrorNotifyLines() {
    return [
      'エラー',
      `開始：${SCRIPT_START_TIME_TEXT}${getLoadSuffix()}`
    ];
  }

  function isErrorPage(text) {
    return (
      text.includes('まことに申し訳ございません') ||
      text.includes('処理を中断させていただきました') ||
      text.includes('はじめからお手続きをお願いします')
    );
  }

  function formatRemain(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  async function getPublicIpText() {
    if (publicIpCache !== null) return publicIpCache;

    try {
      const res = await fetch(IP_API_URL, { cache: 'no-store' });
      const json = await res.json();

      publicIpCache = json?.ip || '不明';
      return publicIpCache;
    } catch (e) {
      console.warn('[ℹ️客室情報画面] IP取得失敗:', e);
      publicIpCache = '不明';
      return publicIpCache;
    }
  }

  function makeEmbedTitle(data) {
    const date = data.date || '-';
    let room = data.room || '-';
    const maxLen = 250;
    const fixedLen = date.length + 1;

    if (fixedLen + room.length > maxLen) {
      room = room.slice(0, Math.max(1, maxLen - fixedLen - 1)) + '…';
    }

    return `${date}\n${room}`;
  }

  function createTogglePanel() {
    if (!document.body) return;
    if (document.getElementById('tdr-roominfo-notify-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tdr-roominfo-notify-panel';
    panel.style.cssText = [
      'position:fixed',
      'right:6px',
      'top:66px',
      'z-index:2147483647',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
      'font-size:14px',
      'font-weight:bold',
      'border-radius:7px',
      'box-shadow:0 1px 5px rgba(0,0,0,.3)',
      'overflow:hidden',
      'user-select:none',
      'background:#fff'
    ].join(';');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = [
      'border:0',
      'padding:4px 7px',
      'font:inherit',
      'cursor:pointer',
      'min-width:32px',
      'line-height:1.2'
    ].join(';');

    function render() {
      const on = getNotifyEnabled();
      btn.textContent = '🔔';
      btn.style.background = on ? '#ffd400' : '#000';
      btn.style.color = on ? '#000' : '#fff';
      btn.title = on ? '通知ON' : '通知OFF';
    }

    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      setNotifyEnabled(!getNotifyEnabled());
      render();
      console.log('[ℹ️客室情報画面] 通知設定:', getNotifyEnabled() ? 'ON' : 'OFF');
    });

    panel.appendChild(btn);
    document.body.appendChild(panel);
    render();
  }

  function createCountdownPanel() {
    if (!document.body) return null;

    let panel = document.getElementById('tdr-roominfo-countdown-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'tdr-roominfo-countdown-panel';
    panel.style.cssText = [
      'position:fixed',
      'right:6px',
      'top:96px',
      'z-index:2147483647',
      'font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
      'font-size:15px',
      'font-weight:900',
      'line-height:1',
      'padding:5px 7px',
      'border-radius:7px',
      'background:rgba(255,140,0,.90)',
      'color:#000',
      'box-shadow:0 1px 6px rgba(0,0,0,.35)',
      'text-align:center',
      'min-width:42px',
      'user-select:none',
      'cursor:pointer'
    ].join(';');

    panel.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleCountdown();
    });

    document.body.appendChild(panel);
    return panel;
  }

  function updateCountdownPanel() {
    const panel = createCountdownPanel();
    if (!panel) return;

    if (!countdownEnabled) {
      panel.textContent = 'OFF';
      panel.title = 'カウントOFF / クリックでON';
      panel.style.background = 'rgba(0,0,0,.45)';
      panel.style.color = '#fff';
      return;
    }

    const remainMs = Math.max(0, timerEndAt - Date.now());
    const min = getCountdownMinutes();

    panel.textContent = formatRemain(remainMs);
    panel.title = PAGE_MODE === 'next'
      ? `${min}分後に戻る / クリックでOFF`
      : `${min}分後に次へ進む / クリックでOFF`;

    panel.style.background = 'rgba(255,140,0,.90)';
    panel.style.color = '#000';
  }

  function removeCountdownPanel() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }

    const panel = document.getElementById('tdr-roominfo-countdown-panel');
    if (panel) panel.remove();
  }

  function extractBetween(text, label, stopLabels) {
    const stops = stopLabels
      .map(x => esc(x) + '\\s*[:：]')
      .join('|');

    const re = new RegExp(
      esc(label) + '\\s*[:：]\\s*([\\s\\S]*?)(?=\\s*(?:' + stops + ')|$)'
    );

    const m = text.match(re);
    return m ? normalize(m[1]) : '';
  }

  function parseRoomInfo() {
    const text = getText();

    if (isErrorPage(text)) return { error: true };
    if (!text.includes('ホテル客室情報')) return null;

    const date = extractBetween(text, '日程', [
      '泊数',
      '部屋数',
      '人数',
      'ホテル客室情報'
    ]);

    const room = extractBetween(text, '客室', [
      'ベッドタイプ',
      '追加ベッド',
      'ベッド',
      '定員',
      '部屋割り'
    ]);

    if (!date || !room) return null;

    const data = { error: false, date, room };
    sessionStorage.setItem(LAST_ROOMINFO_KEY, JSON.stringify(data));
    return data;
  }

  function getLastRoomInfo() {
    try {
      return JSON.parse(sessionStorage.getItem(LAST_ROOMINFO_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function makeStoredRoomInfo() {
    const last = getLastRoomInfo();

    return {
      date: last.date || '日程取得不可',
      room: last.room || '客室取得不可'
    };
  }

  async function notifyDiscord(data, noteLines = '', color = COLOR_START) {
    const webhookUrl = getDiscordWebhookUrl();

    if (!webhookUrl) {
      console.warn('[ℹ️客室情報画面] Discord Webhook未設定: window.TDR_WEBHOOKS.hotel が見つかりません');
      return;
    }

    const ip = await getPublicIpText();

    const notes = Array.isArray(noteLines)
      ? noteLines
      : noteLines
        ? [noteLines]
        : [];

    const lines = [];

    notes.forEach(note => lines.push(note));
    lines.push(`IP：${ip}`);

    const payload = {
      username: 'ℹ️客室情報画面',
      embeds: [
        {
          title: makeEmbedTitle(data),
          description: lines.join('\n'),
          color
        }
      ],
      allowed_mentions: {
        parse: []
      }
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        keepalive: true
      });

      console.log('[ℹ️客室情報画面] Discord通知送信:', res.status);
    } catch (e) {
      console.warn('[ℹ️客室情報画面] Discord通知失敗:', e);
      console.warn('[ℹ️客室情報画面] fetchで失敗しました。必要な場合のみGM_xmlhttpRequest版に切り替えてください。');
    }
  }

  function tryErrorNotify() {
    if (errorNotifiedThisPage) return;

    const text = getText();
    if (!isErrorPage(text)) return;

    errorNotifiedThisPage = true;

    console.warn('[ℹ️客室情報画面] エラーページを検出');
    notifyDiscord(makeStoredRoomInfo(), getErrorNotifyLines(), COLOR_ERROR);
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function findAgreeCheckbox() {
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    if (!boxes.length) return null;

    const matched = boxes.find(cb => {
      const id = cb.id;
      const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;

      const text = normalize([
        cb.closest('label')?.innerText,
        label?.innerText,
        cb.parentElement?.innerText,
        cb.closest('li,div,p,section')?.innerText
      ].join(' '));

      return text.includes('同意する');
    });

    return matched || (getText().includes('同意する') ? boxes[0] : null);
  }

  function findNormalNextButton() {
    if (!canAutoPressNext()) return null;

    return [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')]
      .find(el => normalize(el.innerText || el.value || '').includes('次へ進む') && isVisible(el));
  }

  function findNextModeBackButton() {
    if (!canAutoPressBack()) return null;

    const primary = document.querySelector('a.back.prevSubmit.ui-link');

    if (primary && normalize(primary.innerText || primary.value || '').includes('戻る') && isVisible(primary)) {
      return primary;
    }

    return [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')]
      .find(el => normalize(el.innerText || el.value || '').includes('戻る') && isVisible(el));
  }

  function isButtonDisabled(el) {
    return !el ||
      el.disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('ui-disabled') ||
      !!el.closest('.ui-disabled');
  }

  function checkAgree(cb) {
    if (!cb) return false;

    if (!cb.checked) cb.click();
    if (!cb.checked) cb.checked = true;

    cb.dispatchEvent(new Event('input', { bubbles: true }));
    cb.dispatchEvent(new Event('change', { bubbles: true }));

    if (window.jQuery) {
      try {
        window.jQuery(cb).trigger('change');
        window.jQuery(cb).checkboxradio?.('refresh');
      } catch (_) {}
    }

    return cb.checked;
  }

  async function autoAction() {
    if (autoActionRunning) return;
    autoActionRunning = true;

    if (!countdownEnabled) {
      autoActionRunning = false;
      return;
    }

    if (PAGE_MODE === 'next') {
      if (!canAutoPressBack()) {
        console.warn('[ℹ️客室情報画面] 安全停止: nextモード以外では自動で戻るを押しません');
        autoActionRunning = false;
        return;
      }

      for (let i = 0; i < 20; i++) {
        const btn = findNextModeBackButton();

        if (btn && !isButtonDisabled(btn)) {
          console.log('[ℹ️客室情報画面] nextモード: 自動で戻ります');
          btn.click();
          return;
        }

        await sleep(250);
      }

      console.warn('[ℹ️客室情報画面] nextモードの戻るボタンが見つかりません');
      autoActionRunning = false;
      return;
    }

    if (!canAutoPressNext()) {
      console.warn('[ℹ️客室情報画面] 安全停止: 通常モード以外では自動で次へ進みません');
      autoActionRunning = false;
      return;
    }

    const cb = findAgreeCheckbox();
    const next = findNormalNextButton();

    if (!cb || !next) {
      console.warn('[ℹ️客室情報画面] 同意チェックまたは次へ進むボタンが見つかりません');
      autoActionRunning = false;
      return;
    }

    console.log('[ℹ️客室情報画面] 自動同意チェック実行');

    checkAgree(cb);

    for (let i = 0; i < 20; i++) {
      await sleep(250);

      const btn = findNormalNextButton();
      if (btn && !isButtonDisabled(btn)) {
        console.log('[ℹ️客室情報画面] 自動で次へ進みます');
        btn.click();
        return;
      }
    }

    console.warn('[ℹ️客室情報画面] 次へ進むボタンが有効化されませんでした');
    autoActionRunning = false;
  }

  function isCountdownTargetScreen() {
    const text = getText();

    if (PAGE_MODE === 'next') {
      return canAutoPressBack() && !!findNextModeBackButton();
    }

    return (
      canAutoPressNext() &&
      text.includes('同意する') &&
      text.includes('次へ進む') &&
      findAgreeCheckbox() &&
      findNormalNextButton()
    );
  }

  function handleCountdownTick() {
    if (!isCountdownTargetScreen()) {
      removeCountdownPanel();
      return;
    }

    if (!countdownEnabled) {
      updateCountdownPanel();
      return;
    }

    const remainMs = timerEndAt - Date.now();

    if (remainMs > 0) {
      updateCountdownPanel();
      return;
    }

    console.log(
      PAGE_MODE === 'next'
        ? `[ℹ️客室情報画面] ${getCountdownMinutes()}分終了。自動で戻ります`
        : `[ℹ️客室情報画面] ${getCountdownMinutes()}分終了。自動で次へ進みます`
    );

    resetTimer();
    updateCountdownPanel();
    autoAction();
  }

  function startCountdownWatcher() {
    if (countdownTimer) return;
    if (!isCountdownTargetScreen()) return;

    resetTimer();
    updateCountdownPanel();

    countdownTimer = setInterval(handleCountdownTick, 500);
  }

  function tryRoomNotify() {
    const data = parseRoomInfo();

    if (data?.error) {
      tryErrorNotify();
      return;
    }

    if (!data?.date || !data?.room) return;
    if (notifiedThisPage) return;

    const note = getOpenNotifyNote();

    if (!note) {
      notifiedThisPage = true;
      console.log('[ℹ️客室情報画面] 通常通知対象外:', getCurrentPath());
      return;
    }

    console.log('[ℹ️客室情報画面] 日程:', data.date);
    console.log('[ℹ️客室情報画面] 客室:', data.room);

    if (!getNotifyEnabled()) {
      console.log('[ℹ️客室情報画面] 通知OFFのため送信しません');
      notifiedThisPage = true;
      return;
    }

    notifiedThisPage = true;
    notifyDiscord(data, note, getOpenNotifyColor());
  }

  function tick() {
    createTogglePanel();
    tryErrorNotify();
    tryRoomNotify();
    startCountdownWatcher();
  }

  function main() {
    tick();

    const observer = new MutationObserver(tick);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });

    setInterval(tick, 1000);
  }

  if (document.body) {
    main();
  } else {
    window.addEventListener('DOMContentLoaded', main, { once: true });
  }
})();
