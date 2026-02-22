// ==UserScript==
// @name         🛋️ 部屋更新
// @namespace    http://tampermonkey.net/
// @version      1.6
// @match        https://reserve.tokyodisneyresort.jp/online/hotel/update/
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/room_update.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/room_update.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const startTime = Date.now();
  let running = sessionStorage.getItem('tdr-run') === '1'; // 初期: 停止
  let clicked = false;

  function clickPriorityButton() {
    if (clicked || !running) return;

    const reserveImg = Array.from(document.querySelectorAll('img[alt="予約する"]'))
      .find(img => img.closest('a,button'));
    if (reserveImg) {
      reserveImg.closest('a,button')?.click();
      clicked = true;

      // ★追加：予約ボタンを押したら停止状態へ
      running = false;
      sessionStorage.setItem('tdr-run', '0');
      const panel = document.getElementById('tdr-panel');
      const status = document.getElementById('tdr-status');
      if (panel && status) {
        status.textContent = '停止中';
        panel.style.background = 'rgba(0,0,0,0.85)';
      }

      console.log('[🛋️ 部屋更新] 「予約する」ボタンをクリック');
      return;
    }

    const searchBtn = document.getElementById('searchHotel');
    if (searchBtn) {
      searchBtn.click();
      clicked = true;
      console.log('[🛋️ 部屋更新] 検索ボタンをクリック');
    }
  }

  function createPanel() {
    if (document.getElementById('tdr-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'tdr-panel';
    Object.assign(panel.style, {
      position: 'fixed',
      top: '0',
      right: '0',
      background: running ? 'rgba(180,0,0,0.9)' : 'rgba(0,0,0,0.85)',
      color: '#fff',
      padding: '6px 10px',
      font: 'bold 13px monospace',
      borderRadius: '0 0 0 10px',
      zIndex: '99999',
      cursor: 'pointer',
      userSelect: 'none',
      lineHeight: '1.2',
      boxShadow: '0 2px 8px rgba(0,0,0,.3)'
    });

    const status = document.createElement('div');
    const clock  = document.createElement('div');
    status.id = 'tdr-status';
    clock.id  = 'tdr-clock';

    status.textContent = running ? '稼働中' : '停止中';
    clock.textContent  = '00:00:00';

    panel.appendChild(status);
    panel.appendChild(clock);
    document.body.appendChild(panel);

    panel.addEventListener('click', () => {
      running = !running;
      sessionStorage.setItem('tdr-run', running ? '1' : '0');

      status.textContent = running ? '稼働中' : '停止中';
      panel.style.background = running
        ? 'rgba(180,0,0,0.9)'
        : 'rgba(0,0,0,0.85)';

      if (running && !clicked) {
        clickPriorityButton();
      }
    });

    setInterval(() => {
      const elapsed = Date.now() - startTime;
      const h = Math.floor(elapsed / 3600000);
      const m = Math.floor((elapsed % 3600000) / 60000);
      const s = Math.floor((elapsed % 60000) / 1000);
      clock.textContent = [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
    }, 100);
  }

  const wait = setInterval(() => {
    if (document.body) {
      createPanel();
      if (running) clickPriorityButton();
      clearInterval(wait);
    }
  }, 200);

})();
