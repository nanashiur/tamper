// ==UserScript==
// @name         ℹ️レストラン予約情報入力
// @version      1.04
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

  const PHASE_25 = '25';
  const PHASE_1 = '1';

  const PHASE_MS = {
    [PHASE_25]: 25 * 60 * 1000,
    [PHASE_1]: 1 * 60 * 1000
  };

  let timerPhase = PHASE_25;
  let timerEndAt = Date.now() + PHASE_MS[PHASE_25];
  let countdownTimer = null;
  let notifiedThisPage = false;
  let autoAgreeRunning = false;

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  console.log(`[${SCRIPT_NAME}] v1.04 起動`);

  function getDiscordWebhookUrl() {
    return window.TDR_WEBHOOKS?.restaurant || '';
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
      `[${SCRIPT_NAME}] カウントダウン切替:`,
      timerPhase === PHASE_25 ? '25分' : '1分'
    );
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

    const lines = [
      `**${data.dateTime || '-'}**`,
      `**${data.restaurant || '-'}**`
    ];

    if (comment) {
      lines.push('');
      lines.push(comment);
    }

    const payload = {
      username: SCRIPT_NAME,
      embeds: [
        {
          description: lines.join('\n'),
          color: 0x00ff66
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
        body: JSON.stringify(payload)
      });

      console.log(`[${SCRIPT_NAME}] Discord通知送信:`, res.status);
    } catch (e) {
      console.warn(`[${SCRIPT_NAME}] Discord通知失敗:`, e);
      console.warn(`[${SCRIPT_NAME}] fetchで失敗しました。必要な場合のみGM_xmlhttpRequest版に切り替えてください。`);
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

    setNativeValue(input, '090');

    console.log(`[${SCRIPT_NAME}] 電話番号を仮入力: 090`);
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

    const cb = findAgreeCheckbox();
    const next = findNextButton();

    if (!cb || !next) {
      console.warn(`[${SCRIPT_NAME}] 同意チェックまたは次へボタンが見つかりません`);
      autoAgreeRunning = false;
      return;
    }

    const data = parseRestaurantInfo();

    if (data && !data.error && getNotifyEnabled()) {
      await notifyDiscord(data, '25分経過');
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

    const remainMs = timerEndAt - Date.now();

    if (remainMs > 0) {
      updateCountdownPanel();
      return;
    }

    if (timerPhase === PHASE_25) {
      console.log(`[${SCRIPT_NAME}] 25分終了。1分カウントダウンへ移行`);
      resetTimerPhase(PHASE_1);
      updateCountdownPanel();
      return;
    }

    console.log(`[${SCRIPT_NAME}] 1分終了。自動進行して25分カウントダウンへ戻ります`);
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

  function tryRestaurantNotify() {
    const data = parseRestaurantInfo();

    if (data?.error) {
      console.warn(`[${SCRIPT_NAME}] エラー画面のため通知しません`);
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
    notifyDiscord(data, '仮予約');
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
