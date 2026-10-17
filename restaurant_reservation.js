// ==UserScript==
// @name         🍴🕙️レストラン予約
// @version      0.21
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reservation.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reservation.js
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/check/*
// @run-at       document-start
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  const pageUseDate = new URLSearchParams(location.search).get('useDate');
  if (!pageUseDate?.trim()) return;

  const stockRequests = new Map();
  const xhrInfo = new WeakMap();
  const xhrProto = unsafeWindow.XMLHttpRequest.prototype;
  const originalOpen = xhrProto.open;
  const originalSend = xhrProto.send;
  const originalHeader = xhrProto.setRequestHeader;

  function stockContext() {
    return ['nameCdHid', 'contentsCdHid', 'adultNumHid', 'childNumHid', 'childAgeInformHid']
      .map(id => document.getElementById(id)?.value ?? '').join('|');
  }

  function captureStockRequest(method, address, body, contentType = '') {
    try {
      const url = new URL(address, location.href);
      if (url.origin !== location.origin || !/\/ajaxReservationOfDate\/?$/.test(url.pathname)) return;
      method = String(method).toUpperCase();
      if (!['GET', 'POST'].includes(method)) return;
      if (method === 'POST' && (typeof body !== 'string' || !/application\/x-www-form-urlencoded/i.test(contentType))) return;
      const params = method === 'GET' ? new URLSearchParams(url.search) : new URLSearchParams(body);
      const dateKeys = [...params].filter(([key, value]) => /date/i.test(key) && /^\d{8}$/.test(value)).map(([key]) => key);
      if (dateKeys.length !== 1) return;
      const keyParams = new URLSearchParams(params);
      keyParams.delete(dateKeys[0]);
      keyParams.delete('_');
      const key = `${method}|${url.pathname}|${keyParams}`;
      stockRequests.set(key, { method, url: url.href, params: params.toString(), dateKey: dateKeys[0], context: stockContext() });
      if (stockRequests.size > 20) stockRequests.delete(stockRequests.keys().next().value);
    } catch { /* 通常の通信には影響させない。 */ }
  }

  xhrProto.open = function(method, url, ...rest) {
    xhrInfo.set(this, { method, url, contentType: '' });
    return originalOpen.call(this, method, url, ...rest);
  };
  xhrProto.setRequestHeader = function(name, value) {
    const info = xhrInfo.get(this);
    if (info && String(name).toLowerCase() === 'content-type') info.contentType = String(value);
    return originalHeader.call(this, name, value);
  };
  xhrProto.send = function(body) {
    const info = xhrInfo.get(this);
    if (info) captureStockRequest(info.method, info.url, body, info.contentType);
    return originalSend.call(this, body);
  };

  function nextStockDate(raw) {
    if (!/^\d{8}$/.test(raw)) throw new Error('表示日付を取得できません。');
    const date = new Date(Date.UTC(+raw.slice(0, 4), +raw.slice(4, 6) - 1, +raw.slice(6, 8)));
    if (date.toISOString().slice(0, 10).replace(/-/g, '') !== raw) throw new Error('表示日付が不正です。');
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10).replace(/-/g, '');
  }

  function parseStockResponse(html, nameCd) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const rows = [];
    for (const tr of doc.querySelectorAll('tr')) {
      const time = tr.querySelector('th')?.textContent.trim();
      const state = tr.querySelector('.state')?.textContent.replace(/\s+/g, ' ').trim();
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || '') || !state) continue;
      const handler = tr.querySelector('[onclick*="toOrderForDate"]')?.getAttribute('onclick') || '';
      const call = handler.match(/toOrderForDate\s*\(\s*((?:(?:'[^']*'|"[^"]*")\s*,\s*){6}(?:'[^']*'|"[^"]*"))\s*\)/);
      const args = call ? [...call[1].matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] ?? m[2]) : [];
      rows.push({ time, state, key: args[2] || '—', nameCd: args[4] || nameCd || '—', commodityCD: args[1] || '—' });
    }
    const notices = [...doc.querySelectorAll('.boxEmpty01.reservationTime p')]
      .map(p => p.textContent.replace(/\s+/g, ' ').trim())
      .filter(text => /以降.*予約開始/.test(text));
    return { rows, notices };
  }

  function formatStockOutput(rows, notices, date, nameCd) {
    const lines = [`利用日：${date.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1/$2/$3')}`, `nameCd: ${nameCd || '—'}`];
    const groups = new Map();
    for (const row of rows) {
      const key = `${row.nameCd}|${row.commodityCD}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    for (const group of groups.values()) {
      lines.push('', `nameCd: ${group[0].nameCd}　commodityCD: ${group[0].commodityCD}`, '時刻　 在庫状況　 KEY');
      group.sort((a, b) => a.time.localeCompare(b.time));
      for (const row of group) lines.push(`${row.time}　${row.state}　${row.key}`);
    }
    for (const notice of new Set(notices)) lines.push('', `受付開始前：${notice}`);
    return lines.join('\n');
  }

  function startPanel() {

  function getTargetUseDate(timestamp = new Date().getTime()) {
    const today = new Date(timestamp + 9 * 60 * 60 * 1000);
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth() + 3;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const target = new Date(Date.UTC(year, month, Math.min(today.getUTCDate(), lastDay)));
    return target.toISOString().slice(0, 10).replace(/-/g, '');
  }

  // 一般枠のコード。KEYは対象日の実際の予約ボタンで確認して入力する。
  // 未確認のKEYは空欄のままにし、送信を無効にする。
  const SETS = [
    // セット1
    { get useDate() { return getTargetUseDate(); }, time: '0910', openNumKey: '17',
      commodityCD: 'XXXRBBVLZA004', nameCd: 'RBVL0', contentsCd: '03' },
    // セット2
    { get useDate() { return getTargetUseDate(); }, time: '1320', openNumKey: '9',
      commodityCD: 'XSS03RHPL3002', nameCd: 'RHPL3', contentsCd: '03' },
    // セット3
    { get useDate() { return getTargetUseDate(); }, time: '1330', openNumKey: '10',
      commodityCD: 'XSS03RHPL3002', nameCd: 'RHPL3', contentsCd: '03' },
    // セット4
    { get useDate() { return getTargetUseDate(); }, time: '1500', openNumKey: '1',
      commodityCD: 'XSS03RHPL4002', nameCd: 'RHPL4', contentsCd: '03' },
    // セット5
    { get useDate() { return getTargetUseDate(); }, time: '1520', openNumKey: '3',
      commodityCD: 'XSS03RHPL4002', nameCd: 'RHPL4', contentsCd: '03' },
    // セット6
    { get useDate() { return getTargetUseDate(); }, time: '1630', openNumKey: '10',
      commodityCD: 'XSS03RHPL4004', nameCd: 'RHPL4', contentsCd: '03' },
    // セット7
    { get useDate() { return getTargetUseDate(); }, time: '1700', openNumKey: '31',
      commodityCD: 'XSS03RHPL3006', nameCd: 'RHPL3', contentsCd: '03' },
    // セット8
    { get useDate() { return getTargetUseDate(); }, time: '1150', openNumKey: '48',
      commodityCD: 'XXXRLCANZA004', nameCd: 'RCAN0', contentsCd: '03' }
  ];
  const page = unsafeWindow;
  const PANEL_ID = 'tdr-restaurant-reservation-panel';
  if (document.getElementById(PANEL_ID)) return;
  let selected = 0;
  let busy = false;
  const nowMs = () => new Date().getTime();
  const startedAt = nowMs();
  const jstDay = new Date(startedAt + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const scheduledAt = new Date(`${jstDay}T10:00:00+09:00`).getTime();
  let autoDone = startedAt >= scheduledAt;
  let autoMessage = autoDone ? '本日の10:00は経過済み' : '';

  const style = document.createElement('style');
  style.textContent = `
    #${PANEL_ID}{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;
      box-sizing:border-box;width:390px;max-width:calc(100vw - 24px);padding:10px 12px;
      border:1px solid #967a20;border-radius:10px;background:#fffdf4;color:#292929;
      box-shadow:0 3px 12px #0003;font:14px/1.5 sans-serif;text-align:left}
    #${PANEL_ID} button{font:inherit;cursor:pointer;border:1px solid #ab913d;border-radius:5px;
      padding:5px;background:#fffdf4;color:#292929;margin:0;box-shadow:none}
    #${PANEL_ID} button:disabled{opacity:.45;cursor:default}
    #${PANEL_ID} .tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;margin-bottom:8px}
    #${PANEL_ID} .tabs button{flex:1;font-size:12px;white-space:nowrap}
    #${PANEL_ID} button[aria-selected=true]{background:#ead99b;font-weight:bold}
    #${PANEL_ID} .values{overflow-wrap:anywhere}
    #${PANEL_ID} .codes{font-size:12px;white-space:nowrap;overflow-x:auto}
    #${PANEL_ID} .when{font-size:17px;font-weight:bold;margin-bottom:4px}
    #${PANEL_ID} .actions{display:flex;gap:6px;margin-top:8px}
    #${PANEL_ID} .book{flex:1;background:#c5a641;color:#fff;font-weight:bold}
    #${PANEL_ID} .status{font-size:12px;margin-top:4px}
    #${PANEL_ID} .auto-row{display:flex;align-items:center;gap:8px;margin-top:8px}
    #${PANEL_ID} .auto-toggle{flex:none;white-space:nowrap}
    #${PANEL_ID} .auto-row .status{margin:0;min-width:0}
  `;
  document.head.append(style);
  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.setAttribute('aria-label', 'レストラン予約設定');
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  tabs.setAttribute('role', 'tablist');
  function targetLabel(target) {
    const code = { RBVL0: 'BVL', RHPL3: 'HPL', RHPL4: 'HPL', RCAN0: 'CAN' }[target.nameCd] || target.nameCd;
    return `${code} ${target.time.replace(/^(\d{2})(\d{2})$/, '$1:$2')}`;
  }

  const buttons = SETS.map((target, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = targetLabel(target);
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => { selected = index; render(); });
    tabs.append(button);
    return button;
  });
  const values = document.createElement('div');
  values.className = 'values';
  const when = document.createElement('div');
  when.className = 'when';
  const codes = document.createElement('div');
  codes.className = 'codes';
  values.append(when, codes);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const book = document.createElement('button');
  book.type = 'button';
  book.className = 'book';
  book.textContent = '予約する';
  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  const nextStock = document.createElement('button');
  nextStock.type = 'button';
  nextStock.textContent = '翌日在庫取得';
  nextStock.title = '表示中の日付の翌日を照会し、コンソールに出力';
  const stockStatus = document.createElement('div');
  stockStatus.className = 'status';
  stockStatus.setAttribute('role', 'status');
  actions.append(book, nextStock);
  const autoRow = document.createElement('div');
  autoRow.className = 'auto-row';
  const autoEnabled = document.createElement('button');
  autoEnabled.type = 'button';
  autoEnabled.className = 'auto-toggle';
  let autoArmed = !autoDone;
  autoEnabled.disabled = autoDone;
  autoEnabled.setAttribute('aria-label', '10:00の自動実行');
  autoEnabled.title = '10:00の自動実行 ON/OFF';
  const autoStatus = document.createElement('div');
  autoStatus.className = 'status';
  autoRow.append(autoEnabled, autoStatus);
  panel.append(tabs, values, autoRow, actions, status, stockStatus);
  document.body.append(panel);

  nextStock.addEventListener('click', async () => {
    if (nextStock.disabled) return;
    nextStock.disabled = true;
    stockStatus.textContent = '翌日の在庫を取得中…';
    try {
      const currentDate = document.getElementById('reservationOfDateHid')?.textContent.trim() ||
        new URLSearchParams(location.search).get('useDate') || '';
      const targetDate = nextStockDate(currentDate);
      const nameCd = document.getElementById('nameCdHid')?.value || new URLSearchParams(location.search).get('nameCd') || '';
      const requests = [...stockRequests.values()].filter(request =>
        request.context === stockContext() && new URLSearchParams(request.params).get(request.dateKey) === currentDate);
      if (!requests.length) throw new Error('照会情報がありません。時間帯を一度開いてから再度押してください。');
      const allRows = [];
      const notices = [];
      const failures = [];
      for (const request of requests) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20000);
        try {
          const params = new URLSearchParams(request.params);
          params.set(request.dateKey, targetDate);
          params.delete('_');
          const url = new URL(request.url);
          const options = { method: request.method, credentials: 'same-origin', redirect: 'error',
            cache: 'no-store', signal: controller.signal,
            headers: { 'Accept': 'text/html, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' } };
          if (request.method === 'GET') url.search = params.toString();
          else {
            options.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
            options.body = params.toString();
          }
          const response = await fetch(url.href, options);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const result = parseStockResponse(await response.text(), nameCd);
          if (!result.rows.length && !result.notices.length) throw new Error('時間帯データなし（満席とは判定しません）');
          allRows.push(...result.rows);
          notices.push(...result.notices);
        } catch (error) {
          failures.push(error.name === 'AbortError' ? 'タイムアウト' : error.message);
        } finally { window.clearTimeout(timeout); }
      }
      const unique = [...new Map(allRows.map(row => [JSON.stringify(row), row])).values()];
      console.group(`翌日在庫（画面で照会済みの時間帯 ${requests.length}件）`);
      console.log(formatStockOutput(unique, notices, targetDate, nameCd));
      failures.forEach(message => console.warn(message));
      console.groupEnd();
      stockStatus.textContent = `${targetDate}：${unique.length}枠を出力` +
        (notices.length ? `／受付開始前：${[...new Set(notices)].join(' / ')}` : '') +
        (failures.length ? `／未取得 ${failures.length}件（コンソール参照）` : '（照会済みの時間帯）');
    } catch (error) {
      stockStatus.textContent = error.message;
      console.warn('翌日在庫取得:', error.message);
    } finally { nextStock.disabled = false; }
  });

  function ready(target) {
    return Object.values(target).every(value => typeof value === 'string' && value.trim()) &&
      /^\d{8}$/.test(target.useDate) && /^(?:[01]\d|2[0-3])[0-5]\d$/.test(target.time) &&
      /^\d+$/.test(target.openNumKey);
  }

  function render() {
    const target = SETS[selected];
    buttons.forEach((button, index) => {
      button.setAttribute('aria-selected', String(index === selected));
      button.disabled = busy;
    });
    const date = target.useDate.replace(/^(\d{4})(\d{2})(\d{2})$/, '$1/$2/$3');
    const time = target.time.replace(/^(\d{2})(\d{2})$/, '$1:$2');
    when.textContent = `${date || '日付未設定'}　${time || '時刻未設定'}　KEY ${target.openNumKey || '—'}`;
    codes.textContent = `nameCd: ${target.nameCd || '—'}　commodityCD: ${target.commodityCD || '—'}`;
    const available = !!document.getElementById('toOrderForm') && typeof page.toOrderForDate === 'function';
    const oldWrapper = !!page.__tdrCanna1021TestInstalled;
    book.disabled = busy || !ready(target) || !available || oldWrapper;
    status.textContent = busy ? '入力画面へ移動中…' : oldWrapper ? '旧テストスクリプトを無効にして再読み込みしてください。' :
      !target.openNumKey && target.time && target.commodityCD ? 'KEY未設定：対象日の予約ボタンから確認してください。' :
      !ready(target) ? '未設定のセットです。' : !available ? '予約画面の読み込み待ち' : '';
    const remainingMs = scheduledAt - nowMs();
    autoEnabled.textContent = autoArmed ? '自動実行 ON' : '自動実行 OFF';
    autoEnabled.setAttribute('aria-pressed', String(autoArmed));
    autoStatus.hidden = !autoDone && (!autoArmed || remainingMs > 10 * 60 * 1000);
    autoStatus.textContent = autoDone ? autoMessage :
      autoStatus.hidden ? '' :
      `${targetLabel(target)}：10:00まで ${Math.max(0, Math.ceil(remainingMs / 1000))}秒`;
  }

  function isVisibleNotice(dialog) {
    return !!(dialog && dialog.isConnected &&
      (dialog.offsetWidth || dialog.offsetHeight || dialog.getClientRects().length));
  }

  function clickNoticeNext(dialog, attempt = 0) {
    if (!isVisibleNotice(dialog)) return;
    const checkbox = dialog.querySelector('#accept, input[name="accept"]');
    const next = dialog.querySelector('#btnNext');
    if (!checkbox?.checked || !next) return;
    const disabled = next.disabled || next.getAttribute('disabled') !== null ||
      next.classList.contains('nextDisabled') || next.classList.contains('ui-disabled') ||
      next.closest('.ui-disabled');
    if (!disabled) {
      next.click();
      return;
    }
    if (attempt >= 10 && !next.parentElement?.closest('.ui-disabled')) {
      next.disabled = false;
      next.removeAttribute('disabled');
      next.classList.remove('nextDisabled', 'ui-disabled');
      next.click();
      return;
    }
    if (attempt < 30) window.setTimeout(() => clickNoticeNext(dialog, attempt + 1), 100);
  }

  function handleNoticeDialog(attempt = 0) {
    const dialog = document.querySelector('#noticeMessage');
    const checkbox = dialog?.querySelector('#accept, input[name="accept"]');
    if (!isVisibleNotice(dialog) || !checkbox || !dialog.querySelector('#btnNext')) {
      if (attempt < 30) window.setTimeout(() => handleNoticeDialog(attempt + 1), 100);
      return;
    }
    if (!checkbox.checked) {
      const label = dialog.querySelector('label[for="accept"]');
      if (label) label.click();
      else checkbox.click();
      checkbox.checked = true;
      checkbox.setAttribute('checked', 'checked');
      checkbox.dispatchEvent(new Event('input', { bubbles: true }));
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      if (page.jQuery) {
        try {
          const control = page.jQuery(checkbox);
          control.prop('checked', true);
          if (control.checkboxradio) control.checkboxradio('refresh');
          control.trigger('change');
        } catch (error) {
          console.error(error);
        }
      }
    }
    window.setTimeout(() => clickNoticeNext(dialog), 200);
  }

  function submitSelected() {
    render();
    if (book.disabled) return false;
    const target = { ...SETS[selected] };
    busy = true;
    render();
    try {
      // サイト既存のnotice確認とフォーム送信を使用する。
      page.toOrderForDate('toOrderForm', target.commodityCD, target.openNumKey,
        target.useDate, target.nameCd, target.contentsCd, target.time);
      window.setTimeout(() => handleNoticeDialog(), 150);
    } catch (error) {
      window.alert(`予約入力への移動に失敗しました: ${error.message}`);
    } finally {
      window.setTimeout(() => { busy = false; render(); }, 6500);
    }
    return true;
  }

  book.addEventListener('click', () => {
    render();
    if (book.disabled) return;
    autoDone = true;
    autoEnabled.disabled = true;
    autoArmed = false;
    autoMessage = '手動実行のため自動実行は終了';
    submitSelected();
  });

  function checkAuto() {
    if (autoDone) return;
    const remaining = scheduledAt - nowMs();
    if (remaining > 0) {
      window.setTimeout(checkAuto, Math.min(1000, Math.max(10, remaining > 1000 ? remaining - 1000 : 10)));
      return;
    }
    autoDone = true;
    const enabled = autoArmed;
    autoArmed = false;
    autoEnabled.disabled = true;
    if (!enabled) autoMessage = '自動実行OFFのため未実行';
    else if (remaining < -1000) autoMessage = '10:00から1秒超の遅延のため未実行';
    else {
      autoMessage = `${targetLabel(SETS[selected])}：自動実行済み`;
      if (!submitSelected()) autoMessage = '予約ボタンが無効のため未実行';
    }
    render();
  }
  autoEnabled.addEventListener('click', () => {
    if (autoDone || autoEnabled.disabled) return;
    autoArmed = !autoArmed;
    render();
  });
  render();
  checkAuto();
  window.setInterval(render, 1000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPanel, { once: true });
  else startPanel();
})();
