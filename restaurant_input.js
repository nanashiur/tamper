// ==UserScript==
// @name         ℹ️レストラン予約情報入力
// @version      1.09
// @match        https://reserve.tokyodisneyresort.jp/online/sp/restaurant/input*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_input.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_input.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  if (!location.pathname.includes('/restaurant/input')) return;

  const SCRIPT_NAME = 'ℹ️レストラン予約情報入力';
  const STORAGE_KEY_NOTIFY = 'tdr_restaurant_input_notify_enabled';
  const STORAGE_KEY_NOTIFY_DATE = 'tdr_restaurant_input_notify_date';
  const PHONE_FALLBACK = '090';

  const COLOR_NORMAL = 0x00ff66;
  const COLOR_ERROR = 0xffcc00;

  let timerEndAt = Date.now() + getCountdownMs();
  let countdownTimer = null;
  let countdownEnabled = true;
  let notifiedThisPage = false;
  let errorNotifiedThisPage = false;
  let autoAgreeRunning = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SCRIPT_START_DATE = new Date();
  const SCRIPT_START_TIME_TEXT = formatTimeText(SCRIPT_START_DATE);

  console.log(`[${SCRIPT_NAME}] v1.09 起動: ${getCountdownMinutes()}分`);

  function getDiscordWebhookUrl() {
    return window.TDR_WEBHOOKS?.restaurant || '';
  }

  function getPhoneNumber() {
    const phone = String(window.TDR_WEBHOOKS?.phone || '')
      .replace(/[^\d]/g, '')
      .trim();

    return phone || PHONE_FALLBACK;
  }

  function getIpText() {
    return String(window.TDR_WEBHOOKS?.ip || '').trim() || 'IP未設定';
  }

  function getCountdownMinutes() {
    return 10;
  }

  function getCountdownMs() {
    return getCountdownMinutes() * 60 * 1000;
  }

  function isIndexBackPage() {
    return location.pathname.includes('/restaurant/input/indexBack');
  }

  function formatTimeText(d) {
    return `${d.getHours()}時${String(d.getMinutes()).padStart(2, '0')}分${String(d.getSeconds()).padStart(2, '0')}秒`;
  }

  function getOpenNote() {
    return isIndexBackPage()
      ? `仮予約 継続：${SCRIPT_START_TIME_TEXT}`
      : `仮予約 開始：${SCRIPT_START_TIME_TEXT}`;
  }

  function getTodayKey() {
    const d = new Date();

    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    ].join('');
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
      console.log(`[${SCRIPT_NAME}] カウントON`);
    } else {
      console.log(`[${SCRIPT_NAME}] カウントOFF`);
    }

    updateCountdownPanel();
  }

  function normalize(s) {
    return String(s || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .replace(/\n+/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function getText() {
    return document.body ? document.body.innerText || '' : '';
  }

  function isErrorPage(text) {
    return (
      text.includes('まことに申し訳ございません') ||
      text.includes('処理に失敗しました') ||
      text.includes('ＴＯＰページから再度お手続きをお願いします') ||
      text.includes('TOPページから再度お手続きをお願いします') ||
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
    if (document.getElementById('tdr-restaurant-input-notify-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tdr-restaurant-input-notify-panel';
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
      console.log(`[${SCRIPT_NAME}] 通知設定:`, getNotifyEnabled() ? 'ON' : 'OFF');
    });

    panel.appendChild(btn);
    document.body.appendChild(panel);
    render();
  }

  function createCountdownPanel() {
    if (!document.body) return null;

    let panel = document.getElementById('tdr-restaurant-input-countdown-panel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'tdr-restaurant-input-countdown-panel';
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
    panel.title = `${min}分後に次へ進む / クリックでOFF`;
    panel.style.background = 'rgba(0,0,0,.82)';
    panel.style.color = '#fff';
  }

  function removeCountdownPanel() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }

    const panel = document.getElementById('tdr-restaurant-input-countdown-panel');
    if (panel) panel.remove();
  }

  function extractValue(text, label, stopLabels) {
    const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    const stops = stopLabels
      .map(s => esc(s) + '\\s*[:：]')
      .join('|');

    const re = new RegExp(
      esc(label) +
      '\\s*[:：]\\s*([\\s\\S]*?)(?=\\s*(?:' + stops + ')|$)'
    );

    const m = text.match(re);
    return m ? normalize(m[1]).replace(/\n/g, ' ').trim() : '';
  }

  function parseRestaurantInfo() {
    const text = normalize(getText());

    if (isErrorPage(text)) return { error: true };

    if (
      !text.includes('レストラン予約情報の入力') &&
      !text.includes('レストラン予約情報') &&
      !text.includes('レストラン名') &&
      !text.includes('ご利用日時')
    ) {
      return null;
    }

    const stopLabels = [
      'レストラン名',
      'ご利用日時',
      'ご利用日',
      '利用日',
      '予約日時',
      '予約日',
      'ご利用人数',
      '利用人数',
      '人数',
      '大人',
      '子ども',
      'お子様',
      '車イスでのテーブル着席希望台数',
      'ストレッチャー利用台数',
      'お客様情報',
      '電話番号',
      'お名前',
      'メールアドレス',
      '確認事項',
      '同意する'
    ];

    const restaurant = extractValue(text, 'レストラン名', stopLabels);
    const dateTime =
      extractValue(text, 'ご利用日時', stopLabels) ||
      extractValue(text, '予約日時', stopLabels);

    if (!restaurant && !dateTime) return null;

    return {
      error: false,
      restaurant,
      dateTime
    };
  }

  async function notifyDiscord(data, comment = '') {
    const webhookUrl = getDiscordWebhookUrl();

    if (!webhookUrl) {
      console.warn(`[${SCRIPT_NAME}] Discord Webhook未設定: window.TDR_WEBHOOKS.restaurant が見つかりません`);
      return;
    }

    const payload = {
      username: SCRIPT_NAME,
      embeds: [
        {
          title: [
            data.dateTime || '-',
            data.restaurant || '-'
          ].join('\n'),
          description: comment ? `**${comment}**` : '',
          color: COLOR_NORMAL,
          footer: {
            text: `IP: ${getIpText()}`
          }
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

      console.log(`[${SCRIPT_NAME}] Discord通知送信:`, res.status);
    } catch (e) {
      console.warn(`[${SCRIPT_NAME}] Discord通知失敗:`, e);
      console.warn(`[${SCRIPT_NAME}] fetchで失敗しました。必要な場合のみGM_xmlhttpRequest版に切り替えてください。`);
    }
  }

  async function notifyErrorDiscord() {
    const webhookUrl = getDiscordWebhookUrl();

    if (!webhookUrl) {
      console.warn(`[${SCRIPT_NAME}] Discord Webhook未設定: window.TDR_WEBHOOKS.restaurant が見つかりません`);
      return;
    }

    const payload = {
      username: SCRIPT_NAME,
      embeds: [
        {
          title: 'エラー画面を検知',
          description: [
            '**まことに申し訳ございません。**',
            '**処理に失敗しました。**',
            '**TOPページから再度お手続きをお願いします。**',
            '',
            `path: ${location.pathname}`
          ].join('\n'),
          color: COLOR_ERROR,
          footer: {
            text: `IP: ${getIpText()}`
          }
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

      console.log(`[${SCRIPT_NAME}] エラー画面Discord通知送信:`, res.status);
    } catch (e) {
      console.warn(`[${SCRIPT_NAME}] エラー画面Discord通知失敗:`, e);
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function cssEscape(s) {
    return window.CSS?.escape
      ? CSS.escape(s)
      : String(s).replace(/["\\]/g, '\\$&');
  }

  function findPhoneInput() {
    const inputs = [...document.querySelectorAll('input')]
      .filter(el => {
        const type = String(el.type || 'text').toLowerCase();
        return (
          ['text', 'tel', 'number', ''].includes(type) &&
          !el.disabled &&
          !el.readOnly &&
          isVisible(el)
        );
      });

    const byAttr = inputs.find(el => {
      const s = normalize([
        el.type,
        el.name,
        el.id,
        el.className,
        el.placeholder,
        el.getAttribute('autocomplete'),
        el.getAttribute('aria-label')
      ].join(' '));

      return /tel|phone|電話/.test(s);
    });

    if (byAttr) return byAttr;

    const byRow = inputs.find(el => {
      const text = normalize([
        el.closest('tr')?.innerText,
        el.closest('li')?.innerText,
        el.closest('dl')?.innerText,
        el.closest('div')?.innerText,
        el.parentElement?.innerText
      ].join(' '));

      return text.includes('電話番号');
    });

    if (byRow) return byRow;

    if (getText().includes('電話番号')) {
      return inputs[0] || null;
    }

    return null;
  }

  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');

    if (desc?.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

    if (window.jQuery) {
      try {
        window.jQuery(el).val(value).trigger('input').trigger('change').trigger('keyup');
      } catch (_) {}
    }
  }

  function autoFillPhoneNumber() {
    const input = findPhoneInput();
    if (!input) return false;

    if (normalize(input.value)) return false;

    const phone = getPhoneNumber();
    setNativeValue(input, phone);

    console.log(
      `[${SCRIPT_NAME}] 電話番号を入力:`,
      phone === PHONE_FALLBACK ? `${PHONE_FALLBACK} / fallback` : '設定値'
    );

    return true;
  }

  function findAgreeCheckbox() {
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
    if (!boxes.length) return null;

    const matched = boxes.find(cb => {
      const id = cb.id;
      const label = id ? document.querySelector(`label[for="${cssEscape(id)}"]`) : null;

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
      .find(el => {
        const text = normalize(
          el.innerText ||
          el.value ||
          el.getAttribute('aria-label') ||
          ''
        );

        return (
          (
            text === '次へ' ||
            text.includes('次へ進む') ||
            text.includes('次へ')
          ) &&
          isVisible(el)
        );
      });
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

  async function autoAgreeAndNext() {
    if (autoAgreeRunning) return;
    autoAgreeRunning = true;

    if (!countdownEnabled) {
      autoAgreeRunning = false;
      return;
    }

    const cb = findAgreeCheckbox();
    const next = findNextButton();

    if (!cb || !next) {
      console.warn(`[${SCRIPT_NAME}] 同意チェックまたは次へボタンが見つかりません`);
      autoAgreeRunning = false;
      return;
    }

    autoFillPhoneNumber();

    console.log(`[${SCRIPT_NAME}] 自動同意チェック実行`);

    checkAgree(cb);

    for (let i = 0; i < 20; i++) {
      await sleep(250);

      const btn = findNextButton();
      if (btn && !isButtonDisabled(btn)) {
        console.log(`[${SCRIPT_NAME}] 自動で次へ進みます`);
        btn.click();
        return;
      }
    }

    console.warn(`[${SCRIPT_NAME}] 次へボタンが有効化されませんでした`);
    autoAgreeRunning = false;
  }

  function isAgreeScreen() {
    const text = getText();

    return (
      text.includes('同意する') &&
      text.includes('次へ') &&
      findAgreeCheckbox() &&
      findNextButton()
    );
  }

  function handleCountdownTick() {
    if (!isAgreeScreen()) {
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

    console.log(`[${SCRIPT_NAME}] ${getCountdownMinutes()}分終了。自動で次へ進みます`);

    resetTimer();
    updateCountdownPanel();
    autoAgreeAndNext();
  }

  function startCountdownWatcher() {
    if (countdownTimer) return;
    if (!isAgreeScreen()) return;

    resetTimer();
    updateCountdownPanel();

    countdownTimer = setInterval(handleCountdownTick, 500);
  }

  function tryRestaurantNotify() {
    const data = parseRestaurantInfo();

    if (data?.error) {
      if (!errorNotifiedThisPage) {
        errorNotifiedThisPage = true;
        console.warn(`[${SCRIPT_NAME}] エラー画面を検知。強制通知します`);
        notifyErrorDiscord();
      }
      return;
    }

    if (!data) return;
    if (notifiedThisPage) return;

    console.log(`[${SCRIPT_NAME}] ご利用日時:`, data.dateTime || '-');
    console.log(`[${SCRIPT_NAME}] レストラン名:`, data.restaurant || '-');

    if (!getNotifyEnabled()) {
      console.log(`[${SCRIPT_NAME}] 通知OFFのため送信しません`);
      notifiedThisPage = true;
      return;
    }

    notifiedThisPage = true;
    notifyDiscord(data, getOpenNote());
  }

  function tick() {
    createTogglePanel();
    autoFillPhoneNumber();
    tryRestaurantNotify();
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
