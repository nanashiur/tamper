// ==UserScript==
// @name         🏨📅 ホテルカレンダー
// @version      5.36
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/?showWay*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar_log.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar_log.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME = '🏨📅 ホテルカレンダー';
  const SHARED_DATA_KEY = 'tdr_11am_reserve_data';

  const getDiscordWebhookUrl = () => {
    return window.TDR_WEBHOOKS?.hotel || '';
  };

  const save = (key, val) => localStorage.setItem(`cal_log_${key}`, JSON.stringify(val));
  const load = (key, def) => {
    const v = localStorage.getItem(`cal_log_${key}`);
    return v ? JSON.parse(v) : def;
  };

  const FULL_LABEL = { 0: '空室', 1: '満室', 2: '吸収', 3: '未販' };
  const TITLE_EMOJI = { 0: '🟥', 1: '⬛️', 2: '🟦', 3: '🟩', error: '🟧', reserve: '🟪' };
  const LABEL = { 0: '空', 1: '満', 2: '吸', 3: '未' };
  const STYLE = { 0: 'color:red;font-weight:bold', 1: 'color:inherit', 2: 'color:blue', 3: 'color:green' };
  const MARKS = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤' };

  const MODE_CONF = {
    0: { txt: 'OFF', bg: '#333333', fg: '#ffffff', name: '手動' },
    1: { txt: '🏃‍♀️', bg: '#ff69b4', fg: '#ffffff', name: '短期' },
    2: { txt: '🚶', bg: '#007bff', fg: '#ffffff', name: '長期' },
    4: { txt: '中', bg: '#ff8c00', fg: '#ffffff', name: '中期' }
  };

  const DISCORD_COLOR = {
    0: 16711680,
    1: 1,
    2: 255,
    3: 32768,
    error: 0xFFA500,
    reserve: 0x800080
  };

  const pad = (x, len = 2) => String(x).padStart(len, '0');

  const normalizeYearMonth = value => {
    const text = String(value || '').trim();
    const m = text.match(/^(\d{4})[,/年]\s*(\d{1,2})(?:月)?$/) || text.match(/^(\d{4})(\d{2})(?:\d{2})?$/);
    return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}${pad(m[2])}` : '';
  };

  const getRotationMonths = () => {
    const now = new Date();
    return Array.from({ length: 5 }, (_, offset) => {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      return `${date.getFullYear()}${pad(date.getMonth() + 1)}`;
    });
  };

  const tStrSec = () => {
    const d = new Date();
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${d.toTimeString().slice(0, 8)}`;
  };

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

  function notificationUseDateText(raw) {
    if (!/^\d{8}$/.test(raw || '')) return '日付不明';
    const date = new Date(Date.UTC(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)) - 1, Number(raw.slice(6, 8))));
    return `${raw.slice(0, 4)}年${raw.slice(4, 6)}月${raw.slice(6, 8)}日（${"日月火水木金土"[date.getUTCDay()]}）`;
  }

  const getCalendarStartMonthOffset = () => {
    const now = new Date();
    return now.getDate() === 1 && now.getHours() < 11 ? 3 : 4;
  };

  const getTargetUseDate = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 4);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  };

  const getMaxClickableUseDate = () => {
    const d = new Date();
    d.setMonth(d.getMonth() + 4);
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  };

  const getClockStr = () => new Date().toTimeString().slice(0, 8);

  const toCircled = (num) => {
    if (num >= 1 && num <= 20) return String.fromCharCode(0x245F + num);
    if (num >= 21 && num <= 35) return String.fromCharCode(0x3251 + num - 21);
    return `(${num})`;
  };

  const stockMark = n => n > 0 ? (MARKS[n] || toCircled(n)) : '';

  const statusWithStock = (st, rm) => {
    return st === 0
      ? `${FULL_LABEL[st]}${stockMark(rm)}`
      : FULL_LABEL[st];
  };

  let autoVacancyDateClicked = false;
  let reserveProceedStarted = false;
  let reserveProceedClicked = false;

  const isVisibleElement = el => {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
  };

  const clickElementLikeHuman = (el) => {
    const ev = { bubbles: true, cancelable: true, view: window };

    try {
      el.dispatchEvent(new PointerEvent('pointerdown', ev));
      el.dispatchEvent(new MouseEvent('mousedown', ev));
      el.dispatchEvent(new PointerEvent('pointerup', ev));
      el.dispatchEvent(new MouseEvent('mouseup', ev));
    } catch (e) {
      el.dispatchEvent(new MouseEvent('mousedown', ev));
      el.dispatchEvent(new MouseEvent('mouseup', ev));
    }

    el.click();
  };

  const getDisplayedYearMonthRaw = () => {
    const sel = document.getElementById('boxCalendarSelect');

    if (sel) {
      const val = (sel.value || '').trim();
      const text = (sel.options?.[sel.selectedIndex]?.textContent || '').trim();

      let m = val.match(/^(\d{4}),\s*(\d{1,2})$/);
      if (m) return `${m[1]}${pad(m[2])}`;

      m = val.match(/^(\d{4})\/(\d{1,2})$/);
      if (m) return `${m[1]}${pad(m[2])}`;

      m = val.match(/^(\d{4})(\d{2})/);
      if (m) return `${m[1]}${m[2]}`;

      m = text.match(/(\d{4})[\/年](\d{1,2})/);
      if (m) return `${m[1]}${pad(m[2])}`;
    }

    const monthText =
      document.querySelector('.boxCalendar.month .selectMonth li p.currentMonth')?.textContent?.trim() ||
      document.querySelector('.currentMonth')?.textContent?.trim() ||
      '';

    const m = monthText.match(/(\d{4})[\/年](\d{1,2})/);
    if (m) return `${m[1]}${pad(m[2])}`;

    return '';
  };

  // 表示月だけのサイトログを抑制し、在庫ログや警告・エラーは残す。
  const originalConsoleLog = console.log;
  console.log = function (...args) {
    let text = '';
    if (args.length === 1 && typeof args[0] === 'string') {
      text = args[0];
    } else if (args.length === 2 && args.every(v => typeof v === 'string' || typeof v === 'number')) {
      text = args.join(',');
    }
    const match = text.match(/^\s*(\d{4})\s*[,\.]\s*(0?[1-9]|1[0-2])\s*$/);
    if (match && `${match[1]}${pad(match[2])}` === getDisplayedYearMonthRaw()) return;
    return originalConsoleLog.apply(console, args);
  };

  const isClickableVacancyDate = (dtRaw, baseYm = '') => {
    if (!isSelectedAcquireDay(dtRaw)) return false;
    const displayedYm = baseYm || getDisplayedYearMonthRaw();

    if (displayedYm && dtRaw.slice(0, 6) !== displayedYm) {
      return false;
    }

    if (dtRaw > getMaxClickableUseDate()) {
      return false;
    }

    return true;
  };

  const findVacancyDateClickTarget = (foundVacancies) => {
    const displayedYm = getDisplayedYearMonthRaw();

    let sortedVacancies = [...foundVacancies];

    if (displayedYm) {
      sortedVacancies = sortedVacancies.filter(v => v.dtRaw.slice(0, 6) === displayedYm);
    }

    sortedVacancies = sortedVacancies
      .filter(v => v.dtRaw <= getMaxClickableUseDate() && isSelectedAcquireDay(v.dtRaw))
      .sort((a, b) => b.dtRaw.localeCompare(a.dtRaw));

    const primary = [...document.querySelectorAll('.boxCalendar.month dl')];
    const dls = primary.length > 0 ? primary : [...document.querySelectorAll('dl')];

    for (const vacancy of sortedVacancies) {
      const day = String(vacancy.day);

      for (const dl of dls) {
        const dateText = dl.querySelector('dt.calendarDate')?.textContent?.trim();
        if (dateText !== day) continue;

        const calendarImage = dl.querySelector('dd.calendarImage');
        if (!calendarImage) continue;

        const hasNumberVacancy =
          !!calendarImage.querySelector('span.num');

        const hasCircleVacancy =
          !!calendarImage.querySelector('img[src*="ico_maru_02_o.png"]');

        const hasVacancy =
          hasNumberVacancy || hasCircleVacancy;

        if (!hasVacancy) continue;

        return { target: dl, foundVacancy: vacancy };
      }
    }

    return null;
  };

  const sendReserveProceedClickedDiscord = (foundVacancy) => {
    const webhookUrl = getDiscordWebhookUrl();

    if (!webhookUrl) {
      console.warn('Discord Webhook未設定: window.TDR_WEBHOOKS.hotel を確認してください');
      return;
    }

    const payload = {
      username: SCRIPT_NAME,
      embeds: [{
        title: `${TITLE_EMOJI.reserve} **${tStrSec()}**\n${foundVacancy.dt} 予約手続き押下\n${foundVacancy.roomName}`,
        color: DISCORD_COLOR.reserve,
        description: `時刻: ${tStrMs()} (${cachedIP}) ${foundVacancy.totalPrice.toLocaleString()}円 [${foundVacancy.priceRank}]`
      }]
    };

    try {
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      }).catch(e => console.error('予約押下通知エラー', e));
    } catch (e) {
      console.error('予約押下通知エラー', e);
    }
  };

  const findReserveProceedButton = (foundVacancy) => {
    const buttons = [...document.querySelectorAll('button.next, button')];

    for (const btn of buttons) {
      if (!isVisibleElement(btn)) continue;
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;

      const text = (btn.textContent || '').trim();
      const onclick = btn.getAttribute('onclick') || '';

      if (!text.includes('予約手続きに進む')) continue;
      if (!onclick.includes('vacancyReserve')) continue;

      const hasDate = onclick.includes(foundVacancy.dtRaw);
      const hasCommodity = onclick.includes(foundVacancy.commodityCd);
      const hasPriceFrame = foundVacancy.priceRank ? onclick.includes(foundVacancy.priceRank) : true;

      if (hasDate && hasCommodity && hasPriceFrame) {
        return btn;
      }
    }

    for (const btn of buttons) {
      if (!isVisibleElement(btn)) continue;
      if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') continue;

      const text = (btn.textContent || '').trim();
      const onclick = btn.getAttribute('onclick') || '';

      if (text.includes('予約手続きに進む') && onclick.includes('vacancyReserve')) {
        return btn;
      }
    }

    return null;
  };

  const clickReserveProceedButton = (foundVacancy, run) => {
    if (reserveProceedStarted || reserveProceedClicked) return;

    reserveProceedStarted = true;

    const start = Date.now();

    const tryClick = () => {
      if (run !== acquisitionRun) return;
      if (!autoAcquireEnabled || !isClickableVacancyDate(foundVacancy.dtRaw)) { cancelAcquisition(); return; }
      if (reserveProceedClicked) return;

      const btn = findReserveProceedButton(foundVacancy);

      if (btn) {
        reserveProceedClicked = true;

        sendReserveProceedClickedDiscord(foundVacancy);

        clickElementLikeHuman(btn);
        showPopup(`🎯 空室発見\n予約手続き押下`, 'rgba(204, 0, 0, 0.9)');
        return;
      }

      if (Date.now() - start < 1500) {
        setTimeout(tryClick, 50);
      } else {
        cancelAcquisition();
        console.warn('予約手続きボタン未検出', {
          foundVacancy,
          buttons: [...document.querySelectorAll('button.next, button')].map(btn => ({
            text: (btn.textContent || '').trim(),
            onclick: btn.getAttribute('onclick') || '',
            html: btn.outerHTML
          }))
        });

        showPopup(`🎯 空室発見\n予約ボタン未検出`, 'rgba(204, 0, 0, 0.9)');
      }
    };

    setTimeout(tryClick, 200);
  };

  const clickVacancyDate = (foundVacancies, run) => {
    if (autoVacancyDateClicked) return;

    const start = Date.now();

    const tryClick = () => {
      if (run !== acquisitionRun) return;
      if (!autoAcquireEnabled || !foundVacancies.some(v => isClickableVacancyDate(v.dtRaw))) { cancelAcquisition(); return; }
      if (autoVacancyDateClicked) return;

      const result = findVacancyDateClickTarget(foundVacancies);

      if (result?.target) {
        autoVacancyDateClicked = true;
        clickElementLikeHuman(result.target);
        showPopup(`🎯 空室発見\n${result.foundVacancy.dt} 日付クリック`, 'rgba(204, 0, 0, 0.9)');

        clickReserveProceedButton(result.foundVacancy, run);
        return;
      }

      if (Date.now() - start < 5000) {
        setTimeout(tryClick, 100);
      } else {
        cancelAcquisition();
        console.warn('空室日未検出', {
          displayedYm: getDisplayedYearMonthRaw(),
          maxClickableUseDate: getMaxClickableUseDate(),
          foundVacancies,
          calendarDays: [...document.querySelectorAll('.boxCalendar.month dl, dl')].map(dl => ({
            day: dl.querySelector('dt.calendarDate')?.textContent?.trim(),
            image: dl.querySelector('dd.calendarImage')?.innerHTML || '',
            html: dl.outerHTML
          })).filter(x => x.day)
        });

        showPopup(`🎯 空室発見\n日付未検出`, 'rgba(204, 0, 0, 0.9)');
      }
    };

    setTimeout(tryClick, 100);
  };

  const initCalendarStartPlus4 = () => {
    if (!/\/hotel\/list/.test(location.pathname)) return;

    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;

    let tgtY = curY;
    let tgtM = curM + getCalendarStartMonthOffset();
    tgtY += Math.floor((tgtM - 1) / 12);
    tgtM = ((tgtM - 1) % 12) + 1;

    const TARGET_VALUE = `${tgtY},${tgtM}`;
    const TARGET_TEXT  = `${tgtY}/${String(tgtM).padStart(2, '0')}`;

    const MAX_WAIT_NEXT_MS = 15000;
    let armed = false;
    let nextClicked = false;

    document.addEventListener('click', (ev) => {
      const el = ev.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
      if (!el) return;

      const t = (
        (el.textContent || '') + ' ' +
        (el.value || '') + ' ' +
        (el.getAttribute('aria-label') || '') + ' ' +
        (el.title || '')
      ).trim();

      if (!/次へ|次|next/i.test(t) || armed) return;

      armed = true;
      const t0 = Date.now();

      const timer = setInterval(() => {
        const sel = document.getElementById('boxCalendarSelect');

        if (sel && sel.tagName === 'SELECT' && sel.options.length > 1) {
          if (sel.dataset._ymSet === '1') {
            clearInterval(timer);
            return;
          }

          const opts = [...sel.options];

          const target =
            opts.find(o => (o.value || '').trim() === TARGET_VALUE) ||
            opts.find(o => (o.textContent || '').trim() === TARGET_TEXT) ||
            opts.filter(o =>
              new RegExp(`,\\s*${tgtM}$`).test((o.value || '').trim()) ||
              new RegExp(`/0?${tgtM}$`).test((o.textContent || '').trim())
            ).pop();

          if (target) {
            setTimeout(() => {
              sel.value = target.value;
              sel.selectedIndex = opts.indexOf(target);
              sel.dataset._ymSet = '1';
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }, 100);
          }

          clearInterval(timer);
        }

        if (Date.now() - t0 > 10000) clearInterval(timer);
      }, 100);
    }, true);

    const visible = el => !!el && el.offsetParent !== null && el.getClientRects().length > 0;

    const findNextButton = () => {
      const roots = Array.from(document.querySelectorAll('[role="dialog"],[class*="modal"],.ui-dialog'));
      roots.push(document);

      for (const r of roots) {
        const nodes = r.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');

        for (const el of nodes) {
          if (!visible(el) || el.disabled || el.getAttribute('aria-disabled') === 'true') continue;

          const t = (
            (el.textContent || '') + ' ' +
            (el.value || '') + ' ' +
            (el.getAttribute('aria-label') || '') + ' ' +
            (el.title || '')
          ).trim();

          if (/次へ|次|next/i.test(t)) return el;
        }
      }

      return null;
    };

    const clickLikeHuman = (el) => {
      const ev = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new PointerEvent('pointerdown', ev));
      el.dispatchEvent(new MouseEvent('mousedown', ev));
      el.dispatchEvent(new PointerEvent('pointerup', ev));
      el.dispatchEvent(new MouseEvent('mouseup', ev));
      el.click();
    };

    const start = Date.now();

    const probe = setInterval(() => {
      if (Date.now() - start > MAX_WAIT_NEXT_MS || nextClicked) {
        clearInterval(probe);
        return;
      }

      const btn = findNextButton();

      if (btn) {
        nextClicked = true;
        setTimeout(() => clickLikeHuman(btn), 100);
      }
    }, 100);
  };

  let cachedIP = 'unknown';
  let lastIPFetchTime = 0;

  const getIP = async () => {
    const now = Date.now();
    if (now - lastIPFetchTime < 60000 && cachedIP !== 'unknown') {
      return cachedIP;
    }

    const apis = [
      'https://inet-ip.info/ip',
      'https://www.cloudflare.com/cdn-cgi/trace',
      'https://api.ipify.org'
    ];

    for (const url of apis) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
        let text = await resp.text();

        if (url.includes('cloudflare')) {
          const match = text.match(/ip=([^\s]+)/);
          if (match) {
            cachedIP = match[1];
            lastIPFetchTime = now;
            return cachedIP;
          }
        } else {
          text = text.trim();
          if (text) {
            cachedIP = text;
            lastIPFetchTime = now;
            return cachedIP;
          }
        }
      } catch (e) {
        continue;
      }
    }

    return cachedIP;
  };

  getIP();

  const discordQueue = [];
  let isProcessingQueue = false;

  const processDiscordQueue = async () => {
    if (isProcessingQueue || discordQueue.length === 0) return;
    isProcessingQueue = true;

    while (discordQueue.length > 0) {
      const payload = discordQueue[0];
      const webhookUrl = getDiscordWebhookUrl();

      if (!webhookUrl) {
        console.warn('Discord Webhook未設定: window.TDR_WEBHOOKS.hotel を確認してください');
        discordQueue.shift();
        continue;
      }

      try {
        const resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (resp.status === 429) {
          const rateLimitInfo = await resp.json();
          const retryAfter = rateLimitInfo.retry_after || 1;
          console.warn(`Discord Rate Limit: Waiting ${retryAfter}s...`);
          await new Promise(r => setTimeout(r, retryAfter * 1000));
          continue;
        }

        discordQueue.shift();
        await new Promise(r => setTimeout(r, 250));
      } catch (e) {
        console.error('Discord通知送信エラー', e);
        discordQueue.shift();
      }
    }

    isProcessingQueue = false;
  };

  const sendDiscord = (payload) => {
    discordQueue.push(payload);
    processDiscordQueue();
  };

  const lastStateMap = new Map();
  const loadedKeys = new Set();
  let automaticSearchPending = false;
  let dispatchingAutomaticSearch = false;

  // 自動モード中でも、利用者による月変更・再読込は全件ログにする。
  document.addEventListener('change', event => {
    if (event.target?.id === 'boxCalendarSelect' && !dispatchingAutomaticSearch) {
      automaticSearchPending = false;
    }
  }, true);

  let consecutiveErrorCount = 0;
  let fatalErrorCount = 0;

  let mode = load('mode', 2);
  // 旧自動取得モードは取得ONだけを引き継ぎ、検索はOFFに分離する。
  let autoAcquireEnabled = load('autoAcquire', mode === 3) === true;
  if (mode === 3) mode = 0;
  if (!Object.hasOwn(MODE_CONF, mode)) mode = 2;
  let acquisitionRun = 0;
  let acquisitionInProgress = false;
  const cancelAcquisition = () => {
    acquisitionRun++;
    acquisitionInProgress = false;
    autoVacancyDateClicked = false;
    reserveProceedStarted = false;
    reserveProceedClicked = false;
  };
  const savedAcquireDays = load('acquireDays', []);
  const acquireDays = new Set((Array.isArray(savedAcquireDays) ? savedAcquireDays : [])
    .filter(day => Number.isInteger(day) && day >= 1 && day <= 31));
  const isSelectedAcquireDay = dtRaw => acquireDays.size === 0 || acquireDays.has(Number(dtRaw.slice(6, 8)));
  let notifyEnabled = load('notify', false);
  let rotationEnabled = load('rotation', false) === true;
  let maintenanceWaiting = false;
  let forcedStop = false;
  let longTimer = null;
  let nextSearchAt = null;
  let pendingSearchDelay = null;
  let pendingRotationAdvance = false;
  let loadingStartedAt = null;
  let runtimeDisplayTimer = null;
  const loadingRequests = new Set();

  const initMonthClick = () => {
    const isSP = !!document.querySelector('.boxCalendar.month table');
    const monthElem = isSP
      ? document.querySelector('.boxCalendar.month .selectMonth li p.currentMonth')
      : document.querySelector('.boxInputSelect .cal table.vacancyCalTable tbody tr th.heading');

    if (monthElem && !monthElem.dataset.hasListener) {
      monthElem.style.cursor = 'pointer';

      monthElem.addEventListener('click', () => {
        const loading = isSP
          ? document.querySelectorAll('.boxCalendar.month table tbody tr td dl dd span.calLoad').length > 0
          : document.querySelectorAll('.boxInputSelect .cal table.vacancyCalTable tbody tr td dl dd span img.spinner').length > 0;

        if (!loading) {
          document.getElementById('boxCalendarSelect')?.dispatchEvent(new Event('change'));
        }
      });

      monthElem.dataset.hasListener = 'true';
    }
  };

  const makeBtn = (txt, bg, fg = '#fff') => Object.assign(document.createElement('div'), {
    textContent: txt,
    style: `background-color:${bg} !important; color:${fg} !important; padding:4px 6px; cursor:pointer; border-radius:4px; font-size:14px; user-select:none; text-align:center; min-width:26px; line-height:1.2; font-weight:bold; transition:opacity 0.2s;`
  });

  const resetModeRuntime = () => {
    hidePopup();
    forcedStop = false;
    maintenanceWaiting = false;
    automaticSearchPending = false;
    clearSearchWait();
    consecutiveErrorCount = 0;
    fatalErrorCount = 0;
  };

  const panel = Object.assign(document.createElement('div'), {
    style: 'position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:4px;z-index:99999;background:rgba(255,255,255,0.9);padding:6px;border-radius:8px;box-shadow:0 4px 10px rgba(0,0,0,0.3);'
  });

  const row1 = Object.assign(document.createElement('div'), {
    style: 'display:flex; justify-content:flex-start; align-items:center; gap:4px;'
  });

  const row2 = Object.assign(document.createElement('div'), {
    style: 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;position:relative;'
  });

  const btnSearchMode = makeBtn(MODE_CONF[2].txt, MODE_CONF[2].bg, MODE_CONF[2].fg);
  const btnAutoGet = makeBtn('🎯', '#333333', '#ffffff');

  const renderRuntime = () => {
    const buttons = [btnSearchMode, btnAutoGet];
    const isSearchMode = [1, 2, 4].includes(mode);
    const configs = [MODE_CONF[isSearchMode ? mode : 0],
      { txt: '🎯', bg: autoAcquireEnabled ? '#dc3545' : '#333333', fg: '#ffffff' }];
    buttons.forEach((btn, i) => {
      btn.textContent = configs[i].txt;
      btn.style.setProperty('background-color', configs[i].bg, 'important');
      btn.style.setProperty('background-image', 'none', 'important');
      btn.style.setProperty('color', configs[i].fg, 'important');
      btn.style.fontSize = configs[i].txt === 'OFF' ? '12px' : '14px';
    });
    btnAutoGet.style.opacity = '1';
    btnSearchMode.style.opacity = '1';
    btnSearchMode.title = `自動読込：${isSearchMode ? MODE_CONF[mode].name : 'OFF'}（OFF→長期→中期→短期→OFF）`;
    btnAutoGet.title = `自動取得：${autoAcquireEnabled ? 'ON' : 'OFF'}（検索結果の空室を取得）`;
    if (forcedStop && mode === 0) {
      btnSearchMode.textContent = '🛑';
      btnSearchMode.style.setProperty('background-color', '#cc0000', 'important');
      btnSearchMode.title = '連続エラーによる強制停止';
    }

    const loading = loadingRequests.size > 0;
    if (loading || nextSearchAt !== null) {
      const btn = btnSearchMode;
      const seconds = loading
        ? Math.max(0, Math.floor((new Date().getTime() - loadingStartedAt) / 1000))
        : Math.max(0, Math.ceil((nextSearchAt - new Date().getTime()) / 1000));
      const secondsText = Number.isFinite(seconds) ? String(seconds) : '--';
      btn.textContent = secondsText;
      btn.style.fontSize = `${Math.min(14, Number(btn.dataset.counterWidth) / (secondsText.length * 0.65))}px`;
      btn.title = `${MODE_CONF[mode].name}・${loading ? '読み込み中' : '次回読み込みまで'}：${secondsText}秒`;
      if (loading) {
        btn.style.setProperty('background-image', 'linear-gradient(to right, transparent 33.333333%, #7b2cbf 33.333333%)', 'important');
        btn.style.setProperty('color', '#ffffff', 'important');
      } else if (maintenanceWaiting) {
        btn.textContent = '🛠️';
        btn.style.fontSize = '14px';
        btn.style.setProperty('background-color', '#777777', 'important');
        btn.title = `メンテナンス休止：次回確認まで${secondsText}秒`;
      }
    }

    if (!loading && nextSearchAt === null) {
      clearInterval(runtimeDisplayTimer);
      runtimeDisplayTimer = null;
    } else if (runtimeDisplayTimer === null) {
      runtimeDisplayTimer = setInterval(renderRuntime, 200);
    }
  };

  const clearSearchWait = () => {
    clearTimeout(longTimer);
    longTimer = null;
    nextSearchAt = null;
    pendingSearchDelay = null;
    pendingRotationAdvance = false;
    renderRuntime();
  };

  const scheduleSearch = (delay, advanceRotation = false) => {
    clearSearchWait();
    if (!Number.isFinite(delay) || delay < 0) return;
    // 通信とログ処理がすべて終わってから、待機時間を数え始める。
    if (loadingRequests.size > 0) {
      pendingSearchDelay = delay;
      pendingRotationAdvance = advanceRotation;
      return;
    }
    // サイトのdate.jsによるDate.now()の上書きに影響されない数値を使う。
    nextSearchAt = new Date().getTime() + delay;
    longTimer = setTimeout(() => triggerSearch(true, advanceRotation), delay);
    renderRuntime();
  };

  const beginLoading = () => {
    maintenanceWaiting = false;
    clearSearchWait();
    const token = {};
    if (loadingRequests.size === 0) loadingStartedAt = new Date().getTime();
    loadingRequests.add(token);
    renderRuntime();
    return () => {
      if (!loadingRequests.delete(token)) return;
      if (loadingRequests.size === 0) {
        loadingStartedAt = null;
        if (pendingSearchDelay !== null) {
          const delay = pendingSearchDelay;
          const advanceRotation = pendingRotationAdvance;
          pendingSearchDelay = null;
          scheduleSearch(delay, advanceRotation);
        }
      }
      renderRuntime();
    };
  };

  const updateModes = () => {
    renderRuntime();
    save('mode', mode);
    save('autoAcquire', autoAcquireEnabled);
  };

  btnSearchMode.onclick = () => {
    resetModeRuntime();

    if (mode === 1) {
      mode = 0;
    } else if (mode === 2) {
      mode = 4;
    } else if (mode === 4) {
      mode = 1;
    } else {
      mode = 2;
    }

    updateModes();
    if (mode !== 0) triggerSearch();
  };

  btnAutoGet.onclick = () => {
    autoAcquireEnabled = !autoAcquireEnabled;
    cancelAcquisition();
    updateModes();
  };

  row1.append(btnSearchMode, btnAutoGet);

  const btnNotify = makeBtn('🔔', '#333333', '#ffffff');

  const updateNotify = () => {
    btnNotify.textContent = '🔔';
    btnNotify.style.fontSize = '14px';
    btnNotify.style.opacity = '1';
    btnNotify.style.setProperty('background-color', notifyEnabled ? '#ffeb00' : '#333333', 'important');
    btnNotify.style.setProperty('color', notifyEnabled ? '#000000' : '#ffffff', 'important');
    btnNotify.title = `差分通知：${notifyEnabled ? 'ON' : 'OFF'}`;
    save('notify', notifyEnabled);
  };

  btnNotify.onclick = () => {
    notifyEnabled = !notifyEnabled;
    updateNotify();
  };

  row1.appendChild(btnNotify);

  const btnRotation = makeBtn('🔄', '#333333', '#ffffff');
  const updateRotation = () => {
    btnRotation.textContent = '🔄';
    btnRotation.style.fontSize = '14px';
    btnRotation.style.setProperty('background-color', rotationEnabled ? '#00ffff' : '#333333', 'important');
    btnRotation.title = `5ヶ月ローテーション：${rotationEnabled ? 'ON' : 'OFF'}（当月〜4ヶ月後／読込モードの間隔で巡回）`;
    save('rotation', rotationEnabled);
  };
  btnRotation.onclick = () => {
    rotationEnabled = !rotationEnabled;
    updateRotation();
  };
  row1.insertBefore(btnRotation, btnAutoGet);

  const advanceRotationMonth = sel => {
    const months = getRotationMonths();
    const options = months.map(ym => [...sel.options].find(option =>
      !option.disabled && (normalizeYearMonth(option.value) || normalizeYearMonth(option.textContent)) === ym));
    if (options.some(option => !option)) {
      // 未取得の月を監視済み扱いにせず、現在月の監視へ戻す。
      rotationEnabled = false;
      updateRotation();
      const missing = months.filter((_, i) => !options[i]).map(ym => `${ym.slice(0, 4)}/${ym.slice(4)}`).join('・');
      console.warn(`ローテーションOFF：カレンダーに対象月がありません（${missing}）`);
      showPopup(`ローテーションOFF\n選択肢なし：${missing}`, 'rgba(204, 0, 0, 0.9)');
      return;
    }
    const current = months.indexOf(getDisplayedYearMonthRaw());
    const next = options[(current + 1) % months.length];
    sel.value = next.value;
    sel.selectedIndex = [...sel.options].indexOf(next);
  };

  const calendarDaySelector = '.boxCalendar.month dl, .boxInputSelect .cal dl';
  const highlightStyle = document.createElement('style');
  highlightStyle.textContent = `
    dl.cal-log-acquire-day { box-shadow:inset 0 0 0 3px #dc3545 !important; }
    dl.cal-log-acquire-day dt.calendarDate { background-color:#dc3545 !important;color:#ffffff !important; }
    .cal-log-day-picker > summary { list-style:none; }
    .cal-log-day-picker > summary::-webkit-details-marker { display:none; }
  `;
  document.head.appendChild(highlightStyle);
  const updateDayHighlights = () => {
    document.querySelectorAll(calendarDaySelector).forEach(dl => {
      const day = Number(dl.querySelector('dt.calendarDate')?.textContent?.trim());
      dl.classList.toggle('cal-log-acquire-day', acquireDays.has(day));
    });
  };

  const dayPicker = document.createElement('details');
  dayPicker.className = 'cal-log-day-picker';
  dayPicker.style.cssText = 'grid-column:3;min-width:0;';
  const daySummary = document.createElement('summary');
  daySummary.style.cssText = 'box-sizing:border-box;width:100%;padding:4px 0;border-radius:4px;background:#333333;color:#ffffff;cursor:pointer;text-align:center;font-size:11px;line-height:1.5;font-weight:bold;white-space:nowrap;';
  const dayMenu = document.createElement('div');
  dayMenu.style.cssText = 'position:absolute;top:100%;right:0;left:0;margin-top:4px;padding:6px;border-radius:6px;background:#333333;color:#ffffff;box-shadow:0 4px 10px #0005;max-height:60vh;overflow:auto;';
  const dayHelp = document.createElement('div');
  dayHelp.textContent = '取得日（複数選択・各月共通）';
  dayHelp.style.cssText = 'font-size:10px;margin-bottom:4px;';
  const dayGrid = document.createElement('div');
  dayGrid.style.cssText = 'display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px;';
  const updateAcquireDays = () => {
    const days = [...acquireDays].sort((a, b) => a - b);
    daySummary.textContent = days.length ? `${days.length}件▾` : '全日▾';
    daySummary.title = days.length ? `自動取得対象：各月 ${days.join('・')}日` : '自動取得対象：日付指定なし（従来どおり）';
    daySummary.setAttribute('aria-label', daySummary.title);
    dayGrid.querySelectorAll('input').forEach(input => { input.checked = acquireDays.has(Number(input.value)); });
    save('acquireDays', days);
    updateDayHighlights();
  };
  for (let day = 1; day <= 31; day++) {
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:1px;font-size:11px;cursor:pointer;color:#ffffff;';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = String(day);
    input.setAttribute('aria-label', `${day}日`);
    input.style.cssText = 'margin:0;width:13px;height:13px;flex:none;';
    input.onchange = () => {
      if (input.checked) acquireDays.add(day);
      else acquireDays.delete(day);
      updateAcquireDays();
    };
    label.append(input, document.createTextNode(String(day)));
    dayGrid.appendChild(label);
  }
  const clearDays = document.createElement('button');
  clearDays.type = 'button';
  clearDays.textContent = '指定解除（全日）';
  clearDays.style.cssText = 'margin-top:6px;background:#333333;color:#ffffff;border:1px solid #ffffff;border-radius:4px;font-size:11px;cursor:pointer;';
  clearDays.onclick = () => { acquireDays.clear(); updateAcquireDays(); };
  dayMenu.append(dayHelp, dayGrid, clearDays);
  dayPicker.append(daySummary, dayMenu);
  row2.appendChild(dayPicker);
  document.addEventListener('click', event => {
    if (!dayPicker.contains(event.target)) dayPicker.open = false;
  });
  dayPicker.addEventListener('keydown', event => {
    if (event.key === 'Escape') { dayPicker.open = false; daySummary.focus(); }
  });
  let highlightPending = false;
  const highlightObserver = new MutationObserver(records => {
    const calendarSelector = '.boxCalendar.month, .boxInputSelect .cal';
    const changed = records.some(record =>
      (record.target.nodeType === 1 ? record.target : record.target.parentElement)?.closest(calendarSelector) ||
      [...record.addedNodes].some(node => node.nodeType === 1 &&
        (node.matches(calendarSelector) || node.querySelector(calendarSelector))));
    if (!changed || highlightPending) return;
    highlightPending = true;
    requestAnimationFrame(() => { highlightPending = false; updateDayHighlights(); });
  });
  highlightObserver.observe(document.body, { childList: true, subtree: true, characterData: true });

  panel.append(row1, row2);
  document.body.appendChild(panel);

  // 元のボタン幅を固定し、秒数表示でパネルを広げない。
  [btnSearchMode, btnAutoGet, btnNotify, btnRotation].forEach(btn => {
    const width = btnSearchMode.getBoundingClientRect().width;
    btn.dataset.counterWidth = String(Math.max(1, width - 12));
    btn.style.boxSizing = 'border-box';
    btn.style.width = `${width}px`;
    btn.style.minWidth = `${width}px`;
    btn.style.flex = '0 0 auto';
    btn.style.height = `${btn.getBoundingClientRect().height}px`;
    btn.style.whiteSpace = 'nowrap';
    btn.style.overflow = 'hidden';
  });

  updateModes();
  updateNotify();
  updateRotation();
  updateAcquireDays();
  initMonthClick();
  initCalendarStartPlus4();

  let popupElem = null;

  function showPopup(txt, bgColor, textColor = '#fff') {
    if (!popupElem) {
      popupElem = document.createElement('div');
      popupElem.style.cssText = 'position:fixed;left:50%;bottom:15%;transform:translateX(-50%);padding:4px 12px;font-size:14px;font-weight:bold;border-radius:20px;z-index:999999;user-select:none;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,0.5);text-align:center;white-space:pre-wrap;transition:background-color 0.1s, color 0.1s;';
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

  const triggerSearch = (automatic = false, advanceRotation = false) => {
    clearSearchWait();
    if (loadingRequests.size > 0) return;

    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();

    if (h >= 3 && h < 5) {
      maintenanceWaiting = true;
      let interval = 600000;

      if (h === 4 && m === 59) interval = 1000;
      else if (h === 4 && m >= 55) interval = 10000;

      scheduleSearch(interval, advanceRotation);
      return;
    }
    maintenanceWaiting = false;

    const sel = document.getElementById('boxCalendarSelect');
    if (sel && !document.querySelector('span.calLoad')) {
      if (automatic && mode !== 0 && rotationEnabled && advanceRotation) advanceRotationMonth(sel);
      automaticSearchPending = automatic;
      dispatchingAutomaticSearch = automatic;
      try {
        sel.dispatchEvent(new Event('change'));
      } finally {
        dispatchingAutomaticSearch = false;
      }
    }
  };

  const handleFatalError = async (errObj, targetInfoStr, customMsg) => {
    fatalErrorCount++;

    const errStatus = errObj?.status || errObj?.statusText || 'Error';
    const ip = await getIP();
    const icon = '🚫'.repeat(Math.min(fatalErrorCount, 10));

    sendDiscord({
      username: SCRIPT_NAME,
      embeds: [{
        title: `${TITLE_EMOJI.error} ${icon} ${errStatus} 通信エラー多発`,
        color: DISCORD_COLOR.error,
        description: `時刻: ${tStrFullMs()} (${ip})\n対象: ${targetInfoStr}\n${consecutiveErrorCount}回連続でエラーが発生しました。\n${customMsg}`
      }]
    });
  };

  const handleBurstError = async (errObj, targetInfoStr, customMsg) => {
    fatalErrorCount++;

    const errStatus = errObj?.status || errObj?.statusText || 'Error';
    const ip = await getIP();
    const icon = '🚫'.repeat(Math.min(fatalErrorCount, 10));

    sendDiscord({
      username: SCRIPT_NAME,
      embeds: [{
        title: `${TITLE_EMOJI.error} ${icon} ${errStatus} 通信エラー多発`,
        color: DISCORD_COLOR.error,
        description: `時刻: ${tStrFullMs()} (${ip})\n対象: ${targetInfoStr}\n${customMsg}`
      }]
    });
  };

  if (window.$?.lifeobs?.ajax) {
    const orig_ajax = window.$.lifeobs.ajax;

    window.$.lifeobs.ajax = function (opt) {
      let finishLoading = () => {};
      if (opt.url && opt.url.includes('/hotel/api/queryHotelPriceStock/')) {
        let p_ym = '';
        let p_hotel = '';
        let p_room = '';

        if (opt.data) {
          if (typeof opt.data === 'string') {
            try {
              const j = JSON.parse(opt.data);
              p_ym = j.useYearMonth || j.useDate || '';
              p_hotel = j.hotelId || j.searchHotelCD || '';
              p_room = j.roomCd || j.hotelRoomCd || j.commodityCD || '';
            } catch (e) {
              const u = new URLSearchParams(opt.data);
              p_ym = u.get('useYearMonth') || u.get('useDate') || '';
              p_hotel = u.get('hotelId') || u.get('searchHotelCD') || '';
              p_room = u.get('roomCd') || u.get('hotelRoomCd') || u.get('commodityCD') || '';
            }
          } else if (typeof opt.data === 'object') {
            p_ym = opt.data.useYearMonth || opt.data.useDate || '';
            p_hotel = opt.data.hotelId || opt.data.searchHotelCD || '';
            p_room = opt.data.roomCd || opt.data.hotelRoomCd || opt.data.commodityCD || '';
          }
        }

        const curUrl = new URLSearchParams(window.location.search);
        // ローテーションではURLに残った初期月より、実際の要求月を優先する。
        const requestYm = normalizeYearMonth(p_ym) || getDisplayedYearMonthRaw() ||
          normalizeYearMonth(curUrl.get('useYearMonth') || curUrl.get('useDate'));

        p_ym = p_ym || curUrl.get('useYearMonth') || curUrl.get('useDate') || '';
        p_hotel = p_hotel || curUrl.get('searchHotelCD') || curUrl.get('hotelId') || '';
        p_room = p_room || curUrl.get('hotelRoomCd') || curUrl.get('searchRoomName') || curUrl.get('roomCd') || curUrl.get('commodityCD') || '';

        let yearMonthStr = '年月不明';

        if (requestYm) {
          yearMonthStr = `${requestYm.slice(0, 4)}年${requestYm.slice(4, 6)}月`;
        }

        const hotelStr = p_hotel ? `ホテル:${p_hotel}` : '';
        const roomStr = p_room ? `客室:${p_room}` : '';
        const targetInfoStr = `[${yearMonthStr} ${hotelStr} ${roomStr}]`.trim().replace(/ +/g, ' ');
        const contextKey = `${p_hotel || 'default'}_${requestYm || p_ym || 'now'}`;
        // 通信開始時に確定し、応答までのモード変更に左右されないようにする。
        const forceFullLog = !automaticSearchPending || mode === 0;
        automaticSearchPending = false;

        const ok = opt.success;
        finishLoading = beginLoading();

        opt.success = resp => {
          consecutiveErrorCount = 0;
          fatalErrorCount = 0;

          try {
            ok?.(resp);
            initMonthClick();
          } catch (error) {
            finishLoading();
            throw error;
          }

          logStock(resp, contextKey, requestYm, forceFullLog).then(foundVacancies => {
            // 別の月へ手動変更した後の古い応答から、巡回や自動取得を開始しない。
            const displayedYm = getDisplayedYearMonthRaw();
            if (requestYm && displayedYm && requestYm !== displayedYm) return;
            if (autoAcquireEnabled && !acquisitionInProgress && foundVacancies.length > 0) {
              acquisitionInProgress = true;
              clearSearchWait();

              mode = 0;
              updateModes();

              clickVacancyDate(foundVacancies, acquisitionRun);
              return;
            }

            showPopup(getClockStr(), 'rgba(0, 102, 204, 0.9)');

            if (mode === 1) {
              scheduleSearch(0, true);
            } else if (mode === 2) {
              const randomInterval = Math.floor(Math.random() * (360001 - 240000)) + 240000;
              scheduleSearch(randomInterval, true);
            } else if (mode === 4) {
              const randomInterval = Math.floor(Math.random() * (70001 - 50000)) + 50000;
              scheduleSearch(randomInterval, true);
            }
          }).catch(error => console.error('在庫ログ処理エラー', error)).finally(finishLoading);
        };

        const onStockError = function (k) {
          consecutiveErrorCount++;

          if (window.RecentDaysPriceStockQuery?.prototype?.afterSystemErrorOccurred) {
            window.RecentDaysPriceStockQuery.prototype.afterSystemErrorOccurred(k);
          }

          const h = new Date().getHours();
          const m = new Date().getMinutes();
          const isBurstTime = (h === 10 && m === 59) || (h === 11 && m >= 0 && m <= 4);

          const bgRed = 'rgba(204, 0, 0, 0.9)';
          const bgYellow = 'rgba(255, 204, 0, 0.9)';
          const txtBlack = '#000';

          let isCooldown = false;
          let isStop = false;
          let waitTime = 600000;
          let msg = '10分後に現在のモードで自動再開します。';

          if ([10, 15, 20].includes(consecutiveErrorCount)) {
            isCooldown = true;
          } else if (consecutiveErrorCount === 25) {
            isCooldown = true;
            waitTime = 1800000;
            msg = '30分間のロングクールダウンに入ります。';
          } else if (consecutiveErrorCount >= 30) {
            isStop = true;
            msg = '完全ブロックの可能性が高いため、手動モードに変更して停止します。';
          }

          if (isBurstTime) {
            if (consecutiveErrorCount >= 30) {
              handleBurstError(k, targetInfoStr, `バーストタイム中ですが連続${consecutiveErrorCount}回拒否されたため、安全のため自動停止（手動化）しました。`);
              mode = 0;
              forcedStop = true;
              updateModes();
              showPopup(`🛑バーストブロック検知 ${getClockStr()}`, bgRed);
              clearSearchWait();
              return;
            }

            if (isCooldown || isStop) {
              handleBurstError(k, targetInfoStr, `バーストタイム突撃中 (${consecutiveErrorCount}回目)`);
            }

            showPopup(`⚠️${toCircled(consecutiveErrorCount)} ${getClockStr()}`, bgYellow, txtBlack);

            if (mode !== 0) {
              scheduleSearch(1500);
            }
          } else {
            if (isStop) {
              handleFatalError(k, targetInfoStr, msg);

              if (mode !== 0) {
                mode = 0;
                forcedStop = true;
                updateModes();
                showPopup(`🛑${toCircled(consecutiveErrorCount)} ${getClockStr()}`, bgRed);
                clearSearchWait();
              }
            } else if (isCooldown) {
              handleFatalError(k, targetInfoStr, msg);

              if (mode !== 0) {
                showPopup(`🚫${toCircled(consecutiveErrorCount)} ${getClockStr()}`, bgRed);
                scheduleSearch(waitTime);
              }
            } else {
              showPopup(`⚠️${toCircled(consecutiveErrorCount)} ${getClockStr()}`, bgYellow, txtBlack);

              if (mode !== 0) {
                scheduleSearch(3000);
              }
            }
          }
        };

        opt.error = function (k) {
          try {
            return onStockError(k);
          } finally {
            finishLoading();
          }
        };
      }

      try {
        return orig_ajax(opt);
      } catch (error) {
        finishLoading();
        throw error;
      }
    };
  }

  async function logStock(resp, contextKey, requestYm = '', forceFullLog = false) {
    const infos = resp.ecRoomStockInfos ?? {};
    const isFirstTime = !loadedKeys.has(contextKey);
    const showAll = forceFullLog || isFirstTime;
    const foundVacancies = [];
    const nowObj = new Date();
    const targetUseDate = getTargetUseDate();

    const pendingNotifications = [];
    const logTime = tStrMs();
    const logYm = /^\d{6}$/.test(requestYm) ? requestYm : getDisplayedYearMonthRaw();
    const shortYm = /^\d{6}$/.test(logYm) ? `${logYm.slice(2, 4)}/${logYm.slice(4, 6)}` : '年月不明';
    const logRows = [];
    let hasChanges = false;

    for (const g of Object.values(infos)) {
      for (const r of Object.values(g.roomStockInfos ?? {})) {
        const roomName = r.roomName || '不明な客室';

        for (const [roomCd, b] of Object.entries(r.roomBedStockRangeInfos ?? {})) {
          for (const d of (b.roomBedStockRange ?? [])) {
            const dtRaw = d.useDate;
            const useDateObj = new Date(dtRaw.slice(0, 4), dtRaw.slice(4, 6) - 1, dtRaw.slice(6));
            const dt = `${dtRaw.slice(0, 4)}/${dtRaw.slice(4, 6)}/${dtRaw.slice(6)}`;
            const st = +d.saleStatus;
            const rm = d.remainStockNum ?? 0;
            const priceRank = d.priceFrameID || d.priceLevel || '--';
            const totalPrice = d.roomPriceTotal || 0;
            const commodityCd = d.commodityCd || roomCd || '不明';
            const stateKey = `${contextKey}__${commodityCd}__${dt}`;
            const prev = lastStateMap.get(stateKey);

            if (dtRaw === targetUseDate) {
              localStorage.setItem(SHARED_DATA_KEY, JSON.stringify({
                TARGET: commodityCd,
                FIX_DATE: dtRaw,
                FIX_PF: priceRank,
                roomName,
                savedAt: Date.now()
              }));
            }

            if (st === 0 && rm > 0 && isClickableVacancyDate(dtRaw, requestYm)) {
              foundVacancies.push({
                dtRaw,
                dt,
                day: Number(dtRaw.slice(6, 8)),
                commodityCd,
                roomName,
                priceRank,
                rm,
                totalPrice
              });
            }

            if (!isFirstTime && notifyEnabled && prev !== undefined && (prev.st !== st || prev.rm !== rm)) {
              const diffDays = (useDateObj - nowObj) / (1000 * 60 * 60 * 24);
              const isNewSale = (prev.st === 3 && diffDays >= 122);

              if (!isNewSale) {
                const changeTxt = `${statusWithStock(prev.st, prev.rm)}→${statusWithStock(st, rm)}`;

                pendingNotifications.push({
                  st,
                  rm,
                  dt,
                  dtRaw,
                  changeTxt,
                  roomName,
                  totalPrice,
                  priceRank
                });
              }
            }

            const changed = prev === undefined || prev.st !== st || prev.rm !== rm || prev.priceRank !== priceRank;
            if (changed) hasChanges = true;
            lastStateMap.set(stateKey, { st, rm, priceRank });

            if (showAll || changed) {
              logRows.push([`%c${dt}%c\t%c${LABEL[st]} ${rm} ${priceRank}`, '', '', STYLE[st]]);
            }
          }
        }
      }
    }

    if (showAll || hasChanges) {
      if (!isFirstTime && hasChanges) {
        console.group(`%c${logTime}`, 'background:gray;color:white;padding:1px 4px;border-radius:2px;');
      } else {
        console.group(logTime);
      }
      logRows.forEach(row => console.log(...row));
      console.groupEnd();
    } else {
      console.log(`▶${logTime} ${shortYm} 差分なし`);
    }
    loadedKeys.add(contextKey);

    if (pendingNotifications.length > 0) {
      for (const item of pendingNotifications) {
        const price = Number(item.totalPrice);
        const priceText = Number.isFinite(price) && price > 0 ? `　${price.toLocaleString('ja-JP')}円` : '';
        sendDiscord({
          username: SCRIPT_NAME,
          embeds: [{
            title: `${TITLE_EMOJI[item.st] ?? ''}${notificationUseDateText(item.dtRaw)}\n${item.roomName}`,
            color: DISCORD_COLOR[item.st] ?? 1,
            description: `${item.changeTxt}\n${tStrForNotification()}${priceText}`
          }]
        });
      }
    }

    return foundVacancies.sort((a, b) => b.dtRaw.localeCompare(a.dtRaw));
  }
})();
