// ==UserScript==
// @name         ℹ️客室情報画面
// @version      1.61
// @match        https://reserve.tokyodisneyresort.jp/online/sp/wv/roominfo*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/roominfo.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/roominfo.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (!location.pathname.startsWith('/online/sp/wv/roominfo')) return;

  const STORAGE_KEY_NOTIFY = 'tdr_roominfo_notify_enabled';
  const LAST_ROOMINFO_KEY = 'tdr_roominfo_last_data';

  const PHASE_25 = '25';
  const PHASE_1 = '1';

  const PHASE_MS = {
    [PHASE_25]: 25 * 60 * 1000,
    [PHASE_1]: 1 * 60 * 1000
  };

  const COLOR_NORMAL = 0x00ff66;
  const COLOR_ERROR = 0xffcc00;

  let timerPhase = PHASE_25;
  let timerEndAt = Date.now() + PHASE_MS[PHASE_25];
  let countdownTimer = null;
  let notifiedThisPage = false;
  let errorNotifiedThisPage = false;
  let autoAgreeRunning = false;
  let autoAdvanceNotified = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  console.log('[ℹ️客室情報画面] v1.61 起動');

  function getDiscordWebhookUrl() {
    return window.TDR_WEBHOOKS?.hotel || '';
  }

  function getNotifyEnabled() {
    const v = localStorage.getItem(STORAGE_KEY_NOTIFY);
    return v === null ? true : v === '1';
  }

  function setNotifyEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY_NOTIFY, enabled ? '1' : '0');
  }

  function resetTimerPhase(phase) {
    timerPhase = phase;
    timerEndAt = Date.now() + PHASE_MS[phase];
  }

  function toggleTimer() {
    resetTimerPhase(timerPhase === PHASE_25 ? PHASE_1 : PHASE_25);
    updateCountdownPanel();

    console.log(
      '[ℹ️客室情報画面] カウントダウン切替:',
      timerPhase === PHASE_25 ? '25分' : '1分'
    );
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
      'background:rgba(0,0,0,.82)',
      'color:#fff',
      'box-shadow:0 1px 6px rgba(0,0,0,.35)',
      'text-align:center',
      'min-width:42px',
      'user-select:none',
      'cursor:pointer'
    ].join(';');

    panel.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleTimer();
    });

    document.body.appendChild(panel);
    return panel;
  }

  function updateCountdownPanel() {
    const panel = createCountdownPanel();
    if (!panel) return;

    const remainMs = Math.max(0, timerEndAt - Date.now());

    panel.textContent = formatRemain(remainMs);
    panel.title = timerPhase === PHASE_25
      ? '25分カウントダウン中 / クリックで1分へ'
      : '1分カウントダウン中 / クリックで25分へ';

    panel.style.background = timerPhase === PHASE_1
      ? 'rgba(180,0,0,.88)'
      : 'rgba(0,0,0,.82)';
    panel.style.color = '#fff';
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

  function makeErrorRoomInfo() {
    const last = getLastRoomInfo();

    return {
      error: true,
      date: last.date || '日程取得不可',
      room: last.room || '客室取得不可'
    };
  }

  async function notifyDiscord(data, note = '', color = COLOR_NORMAL) {
    const webhookUrl = getDiscordWebhookUrl();

    if (!webhookUrl) {
      console.warn('[ℹ️客室情報画面] Discord Webhook未設定: window.TDR_WEBHOOKS.hotel が見つかりません');
      return;
    }

    const lines = [
      `**${data.date || '-'}**`,
      `**${data.room || '-'}**`
    ];

    if (note) {
      lines.push('');
      lines.push(`**${note}**`);
    }

    const payload = {
      username: 'ℹ️客室情報画面',
      embeds: [
        {
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

    if (!getNotifyEnabled()) {
      console.log('[ℹ️客室情報画面] 通知OFFのためエラー通知を送信しません');
      return;
    }

    notifyDiscord(makeErrorRoomInfo(), 'エラー', COLOR_ERROR);
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

  function findNextButton() {
    return [...document.querySelectorAll('a,button,input[type="button"],input[type="submit"]')]
      .find(el => normalize(el.innerText || el.value || '').includes('次へ進む') && isVisible(el));
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

  async function notifyAutoAdvance() {
    if (autoAdvanceNotified) return;
    if (!getNotifyEnabled()) return;

    const data = parseRoomInfo();
    if (!data?.date || !data?.room) return;

    autoAdvanceNotified = true;
    await notifyDiscord(data, '25分経過', COLOR_NORMAL);
  }

  async function autoAgreeAndNext() {
    if (autoAgreeRunning) return;
    autoAgreeRunning = true;

    const cb = findAgreeCheckbox();
    const next = findNextButton();

    if (!cb || !next) {
      console.warn('[ℹ️客室情報画面] 同意チェックまたは次へ進むボタンが見つかりません');
      autoAgreeRunning = false;
      return;
    }

    console.log('[ℹ️客室情報画面] 自動同意チェック実行');

    checkAgree(cb);

    for (let i = 0; i < 20; i++) {
      await sleep(250);

      const btn = findNextButton();
      if (btn && !isButtonDisabled(btn)) {
        await notifyAutoAdvance();
        console.log('[ℹ️客室情報画面] 自動で次へ進みます');
        btn.click();
        return;
      }
    }

    console.warn('[ℹ️客室情報画面] 次へ進むボタンが有効化されませんでした');
    autoAgreeRunning = false;
  }

  function isAgreeScreen() {
    const text = getText();

    return (
      text.includes('同意する') &&
      text.includes('次へ進む') &&
      findAgreeCheckbox() &&
      findNextButton()
    );
  }

  function handleCountdownTick() {
    if (!isAgreeScreen()) {
      removeCountdownPanel();
      return;
    }

    const remainMs = timerEndAt - Date.now();

    if (remainMs > 0) {
      updateCountdownPanel();
      return;
    }

    if (timerPhase === PHASE_25) {
      console.log('[ℹ️客室情報画面] 25分終了。1分カウントダウンへ移行');
      resetTimerPhase(PHASE_1);
      updateCountdownPanel();
      return;
    }

    console.log('[ℹ️客室情報画面] 1分終了。自動進行して25分カウントダウンへ戻ります');
    resetTimerPhase(PHASE_25);
    updateCountdownPanel();
    autoAgreeAndNext();
  }

  function startCountdownWatcher() {
    if (countdownTimer) return;
    if (!isAgreeScreen()) return;

    resetTimerPhase(PHASE_25);
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

    console.log('[ℹ️客室情報画面] 日程:', data.date);
    console.log('[ℹ️客室情報画面] 客室:', data.room);

    if (!getNotifyEnabled()) {
      console.log('[ℹ️客室情報画面] 通知OFFのため送信しません');
      notifiedThisPage = true;
      return;
    }

    notifiedThisPage = true;
    notifyDiscord(data, '仮予約', COLOR_NORMAL);
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
