// ==UserScript==
// @name         🍴レストラン予約
// @version      0.11
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reservation.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/restaurant_reservation.js
// @match        https://reserve.tokyodisneyresort.jp/sp/restaurant/check/*
// @run-at       document-end
// @grant        unsafeWindow
// ==/UserScript==

(() => {
  'use strict';

  // 一般枠のコード。KEYは対象日の実際の予約ボタンで確認して入力する。
  // 未確認のKEYは空欄のままにし、送信を無効にする。
  const SETS = [
    // セット1
    { useDate: '20270115', time: '0910', openNumKey: '',
      commodityCD: 'XXXRBBVLZA004', nameCd: 'RBVL0', contentsCd: '03' },
    // セット2
    { useDate: '20270115', time: '1320', openNumKey: '',
      commodityCD: 'XSS03RHPL3002', nameCd: 'RHPL3', contentsCd: '03' },
    // セット3
    { useDate: '20270115', time: '1330', openNumKey: '',
      commodityCD: 'XSS03RHPL3002', nameCd: 'RHPL3', contentsCd: '03' },
    // セット4
    { useDate: '20270115', time: '1500', openNumKey: '',
      commodityCD: 'XSS03RHPL4002', nameCd: 'RHPL4', contentsCd: '03' },
    // セット5
    { useDate: '20270115', time: '1520', openNumKey: '',
      commodityCD: 'XSS03RHPL4002', nameCd: 'RHPL4', contentsCd: '03' },
    // セット6
    { useDate: '20270115', time: '1630', openNumKey: '',
      commodityCD: 'XSS03RHPL4004', nameCd: 'RHPL4', contentsCd: '03' },
    // セット7
    { useDate: '20270115', time: '1700', openNumKey: '',
      commodityCD: 'XSS03RHPL3006', nameCd: 'RHPL3', contentsCd: '03' },
    // セット8
    { useDate: '20270115', time: '1150', openNumKey: '48',
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
    #${PANEL_ID} .when{font-size:17px;font-weight:bold;margin-bottom:4px}
    #${PANEL_ID} .actions{display:flex;gap:6px;margin-top:8px}
    #${PANEL_ID} .book{flex:1;background:#c5a641;color:#fff;font-weight:bold}
    #${PANEL_ID} .status{font-size:12px;margin-top:4px}
  `;
  document.head.append(style);
  const panel = document.createElement('section');
  panel.id = PANEL_ID;
  panel.setAttribute('aria-label', 'レストラン予約設定');
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  tabs.setAttribute('role', 'tablist');
  const buttons = SETS.map((_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `セット${index + 1}`;
    button.setAttribute('role', 'tab');
    button.addEventListener('click', () => { selected = index; render(); });
    tabs.append(button);
    return button;
  });
  const values = document.createElement('div');
  values.className = 'values';
  const when = document.createElement('div');
  when.className = 'when';
  const name = document.createElement('div');
  const commodity = document.createElement('div');
  values.append(when, name, commodity);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const book = document.createElement('button');
  book.type = 'button';
  book.className = 'book';
  book.textContent = '予約する';
  const status = document.createElement('div');
  status.className = 'status';
  status.setAttribute('role', 'status');
  actions.append(book);
  const autoLabel = document.createElement('label');
  const autoEnabled = document.createElement('input');
  autoEnabled.type = 'checkbox';
  autoEnabled.checked = !autoDone;
  autoEnabled.disabled = autoDone;
  autoLabel.append(autoEnabled, ' 10:00に選択中のセットを1回実行（日本時間）');
  const autoStatus = document.createElement('div');
  autoStatus.className = 'status';
  panel.append(tabs, values, autoLabel, autoStatus, actions, status);
  document.body.append(panel);

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
    name.textContent = `nameCd: ${target.nameCd || '—'}`;
    commodity.textContent = `commodityCD: ${target.commodityCD || '—'}`;
    const available = !!document.getElementById('toOrderForm') && typeof page.toOrderForDate === 'function';
    const oldWrapper = !!page.__tdrCanna1021TestInstalled;
    book.disabled = busy || !ready(target) || !available || oldWrapper;
    status.textContent = busy ? '入力画面へ移動中…' : oldWrapper ? '旧テストスクリプトを無効にして再読み込みしてください。' :
      !target.openNumKey && target.time && target.commodityCD ? 'KEY未設定：対象日の予約ボタンから確認してください。' :
      !ready(target) ? '未設定のセットです。' : !available ? '予約画面の読み込み待ち' : '';
    autoStatus.textContent = autoDone ? autoMessage : !autoEnabled.checked ? '自動実行OFF' :
      `セット${selected + 1}：10:00まで ${Math.max(0, Math.ceil((scheduledAt - nowMs()) / 1000))}秒`;
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
    } catch (error) {
      window.alert(`予約入力への移動に失敗しました: ${error.message}`);
    } finally {
      window.setTimeout(() => { busy = false; render(); }, 2000);
    }
    return true;
  }

  book.addEventListener('click', () => {
    render();
    if (book.disabled) return;
    autoDone = true;
    autoEnabled.disabled = true;
    autoEnabled.checked = false;
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
    const enabled = autoEnabled.checked;
    autoEnabled.checked = false;
    autoEnabled.disabled = true;
    if (!enabled) autoMessage = '自動実行OFFのため未実行';
    else if (remaining < -1000) autoMessage = '10:00から1秒超の遅延のため未実行';
    else {
      autoMessage = `セット${selected + 1}：自動実行済み`;
      if (!submitSelected()) autoMessage = '予約ボタンが無効のため未実行';
    }
    render();
  }
  autoEnabled.addEventListener('change', render);
  render();
  checkAuto();
  window.setInterval(render, 1000);
})();
