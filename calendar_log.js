// ==UserScript==
// @name         📅 客室指定在庫モニター
// @version      5.15
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/?showWay*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar_log.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/calendar_log.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const SCRIPT_NAME = '📅 客室指定在庫モニター';
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
  const TITLE_EMOJI = { 0: '🟥', 1: '⬛️', 2: '🟦', 3: '🟩' };
  const LABEL = { 0: '空', 1: '満', 2: '吸', 3: '未' };
  const STYLE = { 0: 'color:red;font-weight:bold', 1: 'color:inherit', 2: 'color:blue', 3: 'color:green' };
  const MARKS = { 1: '①', 2: '②', 3: '③', 4: '④', 5: '⑤' };
  const BTN_BG_COLOR = { 0: 'red', 1: 'black', 2: 'blue', 3: 'green' };

  const MODE_CONF = {
    0: { txt: '👆', bg: '#000', fg: '#fff' },
    1: { txt: '🏃‍♀️', bg: 'orange', fg: '#fff' },
    2: { txt: '🚶', bg: 'purple', fg: '#fff' },
    3: { txt: '👍', bg: 'pink', fg: '#000' }
  };

  const DISCORD_COLOR = { 0: 16711680, 1: 1, 2: 255, 3: 32768, error: 0xFFFF00 };

  const pad = (x, len = 2) => String(x).padStart(len, '0');

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

  const getTargetUseDate = () => {
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

  const initCalendarStartPlus4 = () => {
    if (!/\/hotel\/list/.test(location.pathname)) return;

    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth() + 1;

    let tgtY = curY;
    let tgtM = curM + 4;
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

  let consecutiveErrorCount = 0;
  let fatalErrorCount = 0;

  let mode = load('mode', 2);
  const filters = load('filters', { 0: true, 1: true, 2: true, 3: true });
  let notifyEnabled = load('notify', false);
  let longTimer = null;

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

  const panel = Object.assign(document.createElement('div'), {
    style: 'position:fixed;top:4px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:4px;z-index:99999;background:rgba(255,255,255,0.9);padding:6px;border-radius:8px;box-shadow:0 4px 10px rgba(0,0,0,0.3);'
  });

  const row1 = Object.assign(document.createElement('div'), {
    style: 'display:flex; justify-content:flex-start; align-items:center; gap:4px;'
  });

  const row2 = Object.assign(document.createElement('div'), {
    style: 'display:flex; justify-content:flex-start; align-items:center; gap:4px;'
  });

  const modeBtns = [];

  const updateModes = () => {
    modeBtns.forEach((btn, i) => {
      btn.style.opacity = (mode === i) ? '1' : '0.3';
    });
    save('mode', mode);
  };

  [0, 1, 2, 3].forEach(m => {
    const conf = MODE_CONF[m];
    const btn = makeBtn(conf.txt, conf.bg, conf.fg);

    btn.onclick = () => {
      if (mode === m) return;
      hidePopup();
      clearTimeout(longTimer);
      longTimer = null;
      consecutiveErrorCount = 0;
      fatalErrorCount = 0;
      mode = m;
      updateModes();
      if (mode !== 0) triggerSearch();
    };

    modeBtns.push(btn);
    row1.appendChild(btn);
  });

  const btnNotify = makeBtn('🔔', 'gray', '#fff');

  const updateNotify = () => {
    btnNotify.style.opacity = notifyEnabled ? '1' : '0.3';
    btnNotify.style.setProperty('background-color', notifyEnabled ? 'purple' : 'gray', 'important');
    save('notify', notifyEnabled);
  };

  btnNotify.onclick = () => {
    notifyEnabled = !notifyEnabled;
    updateNotify();
  };

  row1.appendChild(btnNotify);

  const makeFilter = c => {
    const b = makeBtn(LABEL[c], BTN_BG_COLOR[c], '#fff');

    const updateF = () => {
      b.style.opacity = filters[c] ? '1' : '0.3';
    };

    b.onclick = () => {
      filters[c] = !filters[c];
      updateF();
      save('filters', filters);
    };

    updateF();
    return b;
  };

  row2.append(makeFilter(0), makeFilter(1), makeFilter(2), makeFilter(3));

  panel.append(row1, row2);
  document.body.appendChild(panel);

  updateModes();
  updateNotify();
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

  const triggerSearch = () => {
    clearTimeout(longTimer);
    longTimer = null;

    const now = new Date();
    const h = now.getHours();
    const m = now.getMinutes();

    if (h >= 3 && h < 5) {
      let interval = 600000;

      if (h === 4 && m === 59) interval = 1000;
      else if (h === 4 && m >= 55) interval = 10000;

      longTimer = setTimeout(triggerSearch, interval);
      return;
    }

    const sel = document.getElementById('boxCalendarSelect');
    if (sel && !document.querySelector('span.calLoad')) {
      sel.dispatchEvent(new Event('change'));
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
        title: `${icon} ${errStatus} 通信エラー多発`,
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
        title: `${icon} ${errStatus} 通信エラー多発`,
        color: DISCORD_COLOR.error,
        description: `時刻: ${tStrFullMs()} (${ip})\n対象: ${targetInfoStr}\n${customMsg}`
      }]
    });
  };

  if (window.$?.lifeobs?.ajax) {
    const orig_ajax = window.$.lifeobs.ajax;

    window.$.lifeobs.ajax = function (opt) {
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

        p_ym = p_ym || curUrl.get('useYearMonth') || curUrl.get('useDate') || '';
        p_hotel = p_hotel || curUrl.get('searchHotelCD') || curUrl.get('hotelId') || '';
        p_room = p_room || curUrl.get('hotelRoomCd') || curUrl.get('searchRoomName') || curUrl.get('roomCd') || curUrl.get('commodityCD') || '';

        let yearMonthStr = '年月不明';

        if (p_ym && p_ym.length >= 6) {
          yearMonthStr = `${p_ym.slice(0, 4)}年${p_ym.slice(4, 6)}月`;
        }

        const hotelStr = p_hotel ? `ホテル:${p_hotel}` : '';
        const roomStr = p_room ? `客室:${p_room}` : '';
        const targetInfoStr = `[${yearMonthStr} ${hotelStr} ${roomStr}]`.trim().replace(/ +/g, ' ');
        const contextKey = `${p_hotel || 'default'}_${p_ym || 'now'}`;

        const ok = opt.success;

        opt.success = resp => {
          consecutiveErrorCount = 0;
          fatalErrorCount = 0;

          logStock(resp, contextKey).then(anyFound => {
            if (mode === 3 && anyFound) {
              mode = 0;
              updateModes();
              showPopup(`🎯 空室発見!\n${getClockStr()}`, 'rgba(0, 102, 204, 0.9)');
            } else {
              showPopup(getClockStr(), 'rgba(0, 102, 204, 0.9)');
            }
          });

          ok?.(resp);
          initMonthClick();

          if (mode === 1) {
            triggerSearch();
          } else if (mode === 2) {
            const randomInterval = Math.floor(Math.random() * (660001 - 540000)) + 540000;
            longTimer = setTimeout(triggerSearch, randomInterval);
          } else if (mode === 3) {
            triggerSearch();
          }
        };

        opt.error = function (k) {
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
              handleBurstError(k, targetInfoStr, `バーストタイム中ですが連続${consecutiveErrorCount}回拒否されたため、安全のため自動停止（手動👆化）しました。`);
              mode = 0;
              updateModes();
              showPopup(`🛑バーストブロック検知 ${getClockStr()}`, bgRed);
              clearTimeout(longTimer);
              return;
            }

            if (isCooldown || isStop) {
              handleBurstError(k, targetInfoStr, `バーストタイム突撃中 (${consecutiveErrorCount}回目)`);
            }

            showPopup(`⚠️${toCircled(consecutiveErrorCount)} ${getClockStr()}`, bgYellow, txtBlack);

            if (mode !== 0) {
              clearTimeout(longTimer);
              longTimer = setTimeout(triggerSearch, 1500);
            }
          } else {
            if (isStop) {
              handleFatalError(k, targetInfoStr, msg);

              if (mode !== 0) {
                mode = 0;
                updateModes();
                showPopup(`🛑${toCircled(consecutiveErrorCount)} ${getClockStr()}`, bgRed);
                clearTimeout(longTimer);
              }
            } else if (isCooldown) {
              handleFatalError(k, targetInfoStr, msg);

              if (mode !== 0) {
                showPopup(`🚫${toCircled(consecutiveErrorCount)} ${getClockStr()}`, bgRed);
                clearTimeout(longTimer);
                longTimer = setTimeout(triggerSearch, waitTime);
              }
            } else {
              showPopup(`⚠️${toCircled(consecutiveErrorCount)} ${getClockStr()}`, bgYellow, txtBlack);

              if (mode !== 0) {
                clearTimeout(longTimer);
                longTimer = setTimeout(triggerSearch, 3000);
              }
            }
          }
        };
      }

      return orig_ajax(opt);
    };
  }

  async function logStock(resp, contextKey) {
    const infos = resp.ecRoomStockInfos ?? {};
    const isFirstTime = !loadedKeys.has(contextKey);
    let vacancyDetected = false;
    const nowObj = new Date();
    const targetUseDate = getTargetUseDate();

    const pendingNotifications = [];

    console.group(tStrMs());

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

            if (st === 0 && rm > 0) {
              vacancyDetected = true;
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
                  changeTxt,
                  roomName,
                  totalPrice,
                  priceRank
                });
              }
            }

            lastStateMap.set(stateKey, { st, rm });

            if (filters[st]) {
              console.log(`%c${dt}%c\t%c${LABEL[st]} ${rm} ${priceRank}`, '', '', STYLE[st]);
            }
          }
        }
      }
    }

    console.groupEnd();
    loadedKeys.add(contextKey);

    if (pendingNotifications.length > 0) {
      const currentIp = await getIP();

      for (const item of pendingNotifications) {
        sendDiscord({
          username: SCRIPT_NAME,
          embeds: [{
            title: `${TITLE_EMOJI[item.st] ?? ''} **${tStrSec()}**\n${item.dt} ${item.changeTxt}\n${item.roomName}`,
            color: DISCORD_COLOR[item.st] ?? 1,
            description: `時刻: ${tStrMs()} (${currentIp})\n${item.totalPrice.toLocaleString()}円 [${item.priceRank}]`
          }]
        });
      }
    }

    return vacancyDetected;
  }
})();
