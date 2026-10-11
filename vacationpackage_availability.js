// ==UserScript==
// @name         🔍️ベッラヴィスタ バケパ空き時間
// @version      1.19
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/main/vacationpackage_availability.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/main/vacationpackage_availability.js
// @match        https://reserve.tokyodisneyresort.jp/online/vp/input/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const INSTALL = '__tdrVpBellavistaLogInstalled';
  if (window[INSTALL]) return;
  window[INSTALL] = true;

  const PREFIX = '[バケパ レストラン]';
  const SOLD_OUT_STYLE = 'background:#d32f2f;color:#fff;font-weight:bold;padding:2px 6px;border-radius:3px;';
  const STORE = 'tdr_vp_restaurant_snapshots_v4';
  const PANEL = 'tdr-vp-bellavista-log-panel';
  const HEADERS = ['確認日時（日本時間）', '対象日', '対象時間枠', 'ステータス', '枠番号'];
  const NO_VACANCY_TEXT = 'お探しの条件で、空きのある商品はございません';
  const pad = n => String(n).padStart(2, '0');
  const signatures = new Map();
  const snapshots = new Map();
  let timer = 0;
  let autoHotelReservation = true;
  let hotelAvailabilityState = '';
  let watchedDateInput = null;
  let hotelReservationClicked = false;
  let reservationAttempts = 0;
  let agreementAttempts = 0;

  function timestamp() {
    return new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').replace('Z', '');
  }

  function readJson(element) {
    try { return JSON.parse(element?.textContent || 'null'); }
    catch { return null; }
  }

  function visible(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    for (let p = element; p; p = p.parentElement) {
      const style = getComputedStyle(p);
      if (p.hidden || style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }

  function isHotelPage() {
    return /^\/online\/vp\/input\/?$|^\/online\/vp\/input\/hotel\/?$/.test(location.pathname);
  }

  function findHotelReservationButton() {
    const candidates = new Set();
    for (const element of document.querySelectorAll('a.reserveHotel, img[alt="予約する"]')) {
      candidates.add(element.matches('img') ? (element.closest('a') || element) : element);
    }
    return [...candidates].find(element => visible(element) && element.getAttribute('aria-disabled') !== 'true');
  }

  function tryInitialHotelReservation() {
    if (!autoHotelReservation || hotelReservationClicked || !isHotelPage()) return;
    const target = findHotelReservationButton();
    if (!target) {
      if (reservationAttempts++ < 20) setTimeout(tryInitialHotelReservation, 500);
      return;
    }
    hotelReservationClicked = true;
    console.info(`${PREFIX} 初回タブ表示：ホテルの予約ボタンを自動クリック`);
    for (const type of ['mousedown', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  }

  function findAgreementCheckbox() {
    const exact = document.querySelector('#agreeCheckbox');
    if (exact && visible(exact)) return exact;
    const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')]
      .filter(visible);
    return checkboxes.find(input => {
      const scope = input.closest('label,td,li,div') || input.parentElement;
      return String(scope?.textContent || '').replace(/\s+/g, '').includes('同意する');
    }) || (checkboxes.length === 1 ? checkboxes[0] : null);
  }

  function tryInitialAgreementCheck() {
    if (!autoHotelReservation) return;
    const checkbox = findAgreementCheckbox();
    if (!checkbox) {
      if (agreementAttempts++ < 20) setTimeout(tryInitialAgreementCheck, 500);
      return;
    }
    if (checkbox.checked) return;
    checkbox.click();
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    console.info(`${PREFIX} 初回タブ表示：同意するに自動チェック`);
  }

  function checkHotelAvailability() {
    if (!isHotelPage()) return;
    const date = dateLabel(document.querySelector('#stayDate, input[name="stayDate"]')?.value);
    if (!date) return;
    const buttons = new Set();
    for (const element of document.querySelectorAll('a.reserveHotel')) {
      buttons.add(element);
    }
    if (!buttons.size) {
      for (const element of document.querySelectorAll('img[alt="予約する"]')) {
        buttons.add(element.closest('a') || element);
      }
    }
    const count = buttons.size;
    const pageText = String(document.body?.innerText || '').replace(/\s+/g, '');
    const noVacancyCount = (pageText.match(new RegExp(NO_VACANCY_TEXT, 'g')) || []).length;
    const soldOut = count === 0 && noVacancyCount > 0;
    const state = count > 0 ? `available:${date}:${count}` : soldOut ? `soldout:${date}` : '';
    if (!state || state === hotelAvailabilityState) return;
    hotelAvailabilityState = state;
    const hotelKey = `ホテル\u0000${date}`;
    if (count === 0 && soldOut) {
      const item = { at: timestamp(), restaurant: 'ホテル', date, code: '', slots: [{ time: '', state: '完売', key: '' }] };
      snapshots.set(hotelKey, item);
      saveSnapshots();
      console.log('%c%s', SOLD_OUT_STYLE, `[バケパ ホテル] 予約可能な客室数：0室／${date}／バケパ売り切れ（空きなし表示：${noVacancyCount}件）`);
      printSnapshot(item);
    } else {
      if (snapshots.delete(hotelKey)) saveSnapshots();
      console.info(`[バケパ ホテル] 予約可能な客室数：${count}室／${date}`);
    }
  }

  function watchDateInput() {
    const input = document.querySelector('#stayDate, input[name="stayDate"]');
    if (!input || input === watchedDateInput) return;
    watchedDateInput = input;
    const refresh = () => {
      hotelAvailabilityState = '';
      setTimeout(checkHotelAvailability, 500);
    };
    input.addEventListener('change', refresh);
    input.addEventListener('input', refresh);
  }

  function dateLabel(value) {
    const m = String(value || '').match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return '';
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() + 1 === Number(m[2]) && d.getUTCDate() === Number(m[3])
      ? `${m[1]}-${m[2]}-${m[3]}` : '';
  }

  function snapshot(box) {
    if (!visible(box)) return null;
    if ([...box.querySelectorAll('tr.loading')].some(visible)) return null;
    const row = [...box.querySelectorAll('tr.timeChoice:not(.loading)')].find(visible);
    if (!row) return null;

    const content = readJson(row.querySelector('.contentData'));
    const selected = readJson(box.querySelector('[id="selectedContentData"]'));
    if (content?.contentsCd !== '03' || selected?.contentsCd !== '03'
      || !content.nameCd || content.nameCd !== selected.nameCd
      || content.materialCd !== selected.materialCd) return null;

    const restaurant = typeof selected.contentName === 'string' ? selected.contentName.trim() : '';
    const date = dateLabel(readJson(box.querySelector('[id="selectedDateData"]'))?.useDate);
    if (!restaurant || !date) return null;

    const slots = new Map();
    for (const element of row.querySelectorAll('.timeData')) {
      const data = readJson(element);
      const m = String(data?.time || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!m) continue;
      const time = `${pad(Number(m[1]))}:${m[2]}`;
      const li = element.closest('li');
      const state = li?.classList.contains('noVacancy') ? '満席'
        : li?.classList.contains('vacancy') ? '空席' : '不明';
      const old = slots.get(time);
      const keys = new Set(old?.keys || []);
      const key = String(data.openNumKey ?? '').trim();
      if (key) keys.add(key);
      slots.set(time, { state: old && old.state !== state ? '不明' : state, keys });
    }
    if (!slots.size) return null;

    const slotsSorted = [...slots]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([time, slot]) => ({ time, state: slot.state, key: [...slot.keys].sort().join('/') }));
    return { restaurant, date, code: String(content.materialCd || ''), slots: slotsSorted };
  }

  function saveSnapshots() {
    try { sessionStorage.setItem(STORE, JSON.stringify([...snapshots.values()])); }
    catch { console.warn(`${PREFIX} 最新結果を一時保存できませんでした。`); }
  }

  function showLatest() {
    if (!snapshots.size) {
      console.warn(`${PREFIX} 記録はありません。`);
      return;
    }
    console.info(`${PREFIX} 手動確認：${snapshots.size}日分`);
    for (const item of [...snapshots.values()].sort((a, b) => a.date.localeCompare(b.date))) printSnapshot(item);
  }

  function printSnapshot(item) {
    console.log('%c%s', 'background:#333;color:#fff;font-weight:bold;padding:2px 6px 2px 0;border-radius:3px', item.at.slice(11));
    console.log('%c%s', 'font-weight:bold', `${item.date.replace(/-/g, '/')} 【バケパ】${item.restaurant} ${item.code}`);
    for (const slot of item.slots) {
      const style = slot.state === '完売' ? SOLD_OUT_STYLE : 'padding-left:6px;' + (slot.state === '空席' ? 'color:red;font-weight:bold;' : slot.state === '不明' ? 'color:gray;' : '');
      const label = slot.time ? `${slot.time} ${slot.state}` : slot.state;
      console.log('%c%s', style, `${label}${slot.key ? ` ${slot.key}` : ''}`);
    }
  }

  function logLatest(item) {
    const at = timestamp();
    const saved = { at, restaurant: item.restaurant, date: item.date, code: item.code, slots: item.slots };
    snapshots.set(`${item.restaurant}\u0000${item.date}`, saved);
    saveSnapshots();
    printSnapshot(saved);
  }

  function scan() {
    const entry = [...document.querySelectorAll('.tblModal02')]
      .map(candidate => ({ candidate, item: snapshot(candidate) }))
      .find(value => value.item);
    if (!entry) return;
    const { candidate: box, item } = entry;
    const signature = JSON.stringify([item.restaurant, item.date, item.code, item.slots]);
    if (signatures.get(box) === signature) return;
    signatures.set(box, signature);
    logLatest(item);
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function safeFileName(name) {
    let value = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100).replace(/[. ]+$/g, '');
    if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)) value = '_' + value;
    return value || 'レストラン';
  }

  function exportCsv() {
    if (!snapshots.size) { console.warn(`${PREFIX} 保存する記録がありません。`); return; }
    const items = [...snapshots.values()].sort((a, b) => a.date.localeCompare(b.date));
    const rows = items.flatMap(item => item.slots.map(slot => [item.at, item.date, slot.time, slot.state, slot.key]));
    const csv = '\uFEFF' + [HEADERS, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    const savedAt = timestamp().slice(0, 19).replace(/[-:]/g, '').replace(' ', '_');
    const restaurants = [...new Set(items.map(item => item.restaurant).filter(name => name !== 'ホテル'))];
    const fileRestaurant = restaurants.length === 1 ? restaurants[0] : restaurants.length > 1 ? 'レストラン複数' : 'ホテル';
    link.download = `${savedAt}_${safeFileName(fileRestaurant)}_vacationpackage.csv`;
    link.hidden = true;
    document.body.appendChild(link);
    try { link.click(); }
    finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000); }
    snapshots.clear();
    signatures.clear();
    try { sessionStorage.removeItem(STORE); } catch {}
  }

  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE) || '[]');
    if (Array.isArray(saved)) {
      for (const item of saved) {
        if (item && typeof item.restaurant === 'string' && typeof item.date === 'string' && Array.isArray(item.slots)) {
          snapshots.set(`${item.restaurant}\u0000${item.date}`, item);
        }
      }
    }
  } catch { snapshots.clear(); }

  function boot() {
    if (document.getElementById(PANEL)) return;
    const panel = document.createElement('div');
    panel.id = PANEL;
    panel.style.cssText = 'position:fixed;right:12px;top:12px;display:flex;flex-direction:column;gap:6px;z-index:2147483647;background:transparent;color:#222;border:0;padding:0;font:13px/1.5 sans-serif;box-shadow:none;';
    const autoButton = document.createElement('button');
    autoButton.type = 'button';
    autoButton.style.cssText = 'padding:4px 8px;cursor:pointer;background:#d32f2f;color:#fff;border:1px solid #a82020;border-radius:4px;';
    const updateAutoButton = () => {
      autoButton.textContent = `自動 ${autoHotelReservation ? 'ON' : 'OFF'}`;
      autoButton.style.background = autoHotelReservation ? '#d32f2f' : '#777';
      autoButton.style.borderColor = autoHotelReservation ? '#a82020' : '#555';
    };
    updateAutoButton();
    autoButton.addEventListener('click', () => {
      autoHotelReservation = !autoHotelReservation;
      updateAutoButton();
    });
    panel.appendChild(autoButton);
    const inspectButton = document.createElement('button');
    inspectButton.type = 'button';
    inspectButton.textContent = '確認';
    inspectButton.style.cssText = 'padding:4px 8px;cursor:pointer;background:#4caf50;color:#fff;border:1px solid #388e3c;border-radius:4px;';
    inspectButton.addEventListener('click', showLatest);
    panel.appendChild(inspectButton);
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '保存';
    button.style.cssText = 'padding:4px 8px;cursor:pointer;background:#d65a8d;color:#fff;border:1px solid #b83f70;border-radius:4px;';
    button.addEventListener('click', exportCsv);
    panel.appendChild(button);
    document.body.appendChild(panel);
    watchDateInput();
    checkHotelAvailability();
    setTimeout(checkHotelAvailability, 1000);
    setTimeout(tryInitialHotelReservation, 1000);
    setTimeout(tryInitialAgreementCheck, 1000);
    setInterval(() => {
      watchDateInput();
      checkHotelAvailability();
    }, 1000);

    const observer = new MutationObserver(mutations => {
      if (mutations.every(mutation => panel.contains(mutation.target))) return;
      watchDateInput();
      checkHotelAvailability();
      for (const box of signatures.keys()) {
        if (!visible(box) || [...box.querySelectorAll('tr.loading')].some(visible)) signatures.delete(box);
      }
      clearTimeout(timer);
      timer = setTimeout(scan, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    scan();
    console.info(`${PREFIX} v1.19 記録開始｜最新結果のみ保存｜CSV保存は右上`);
  }

  if (document.body) boot();
  else document.addEventListener('DOMContentLoaded', boot, { once: true });
})();
