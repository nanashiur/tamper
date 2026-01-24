// ==UserScript==
// @name         🍴📱ショーレストラン再検索
// @namespace    http://tampermonkey.net/
// @version      1.40
// @description  SPショーレストラン：30-40秒ランダム再検索（クリック発火）＋ON/OFFパネル＋3-5時停止＋毎時00分F5（3・4時除外）
// @match        https://reserve.tokyodisneyresort.jp/sp/showrestaurant/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/showrestaurant_reload_gen.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (!document.querySelector('#reservationOfDateHid')) return;

  const MARK_ID = '__showrestaurant_reload_sp';
  if (document.getElementById(MARK_ID)) return;

  /* =========================
     設定
  ========================= */
  let autoON = true;
  let nextWait = 0;

  const resetRandomInterval = () => {
    nextWait = Math.floor(Math.random() * 11) + 30; // 30〜40秒
  };
  resetRandomInterval();

  /* =========================
     メンテナンス判定（3-5時）
  ========================= */
  const isMaintenanceTime = () => {
    const h = new Date().getHours();
    return h >= 3 && h < 5;
  };

  /* =========================
     再検索（クリック発火）
  ========================= */
  const triggerReload = () => {
    if (isMaintenanceTime()) return;
    const bar = document.querySelector('#reservationOfDateDisp1');
    if (bar) bar.click();
  };

  /* =========================
     毎時00分00秒 F5（3・4時除外）
  ========================= */
  const checkHourlyReload = () => {
    const now = new Date();
    const h = now.getHours();

    if (
      h !== 3 && h !== 4 &&
      now.getMinutes() === 0 &&
      now.getSeconds() === 0
    ) {
      location.reload();
    }
  };

  setInterval(checkHourlyReload, 1000);

  /* =========================
     ON / OFF パネル
  ========================= */
  const panel = document.createElement('div');
  Object.assign(panel.style, {
    position: 'fixed',
    top: '10px',
    right: '10px',
    zIndex: '2147483647',
    padding: '8px 12px',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: '600',
    lineHeight: '1',
    cursor: 'pointer',
    userSelect: 'none',
    background: '#007bff',
    color: '#fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    opacity: '0.9'
  });

  panel.textContent = 'ON ' + nextWait;
  document.body.appendChild(panel);

  panel.addEventListener('click', () => {
    autoON = !autoON;
    if (autoON) {
      resetRandomInterval();
      panel.style.background = '#007bff';
      panel.textContent = 'ON ' + nextWait;
    } else {
      panel.style.background = '#333';
      panel.textContent = 'OFF';
    }
  });

  /* =========================
     自動ループ（クリック再検索）
  ========================= */
  setInterval(() => {
    if (!autoON) return;

    if (isMaintenanceTime()) {
      panel.textContent = 'MAINT';
      return;
    }

    nextWait--;
    if (nextWait <= 0) {
      triggerReload();
      resetRandomInterval();
    }
    panel.textContent = 'ON ' + nextWait;
  }, 1000);

  /* =========================
     マーカー
  ========================= */
  const mark = document.createElement('div');
  mark.id = MARK_ID;
  mark.style.display = 'none';
  document.body.appendChild(mark);

})();
