// ==UserScript==
// @name         🟦 Auto Click Blue Reservation Button
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Clicks the blue reservation button with toggle. Shows status and stops after 35 minutes.
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/blue.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/blue.js
// @grant        none
// ==/UserScript==

(function(){
  'use strict';
  const startTime = Date.now();
  let stopped = false;
  let isPaused = false;

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.top = '0px';
  container.style.left = '0px';
  container.style.zIndex = '9999';
  document.body.appendChild(container);

  const shadow = container.attachShadow({mode: 'open'});

  const el = document.createElement('div');
  el.style.background = 'rgba(60, 100, 255, 0.6)';
  el.style.color = 'white';
  el.style.padding = '3px 6px';
  el.style.borderRadius = '6px';
  el.style.fontSize = '16px';
  el.style.fontFamily = 'monospace';
  el.style.whiteSpace = 'nowrap';
  el.style.display = 'block';
  el.style.border = 'none';
  el.textContent = '稼働中';
  shadow.appendChild(el);

  el.addEventListener('click', () => {
    if (stopped) return;
    isPaused = !isPaused;
    if (isPaused) {
      el.style.background = 'rgba(0, 0, 0, 0.7)';
      el.textContent = '停止中';
      el.style.border = 'none';
    }
  });

  function flashBorder() {
    el.style.border = '2px solid #0033cc';
    setTimeout(() => { el.style.border = 'none'; }, 100);
  }

  function clickAndSchedule() {
    if (stopped) return;

    const now = Date.now();
    if (now - startTime >= 2100000) {
      console.log('🛑 スクリプトは35分経過したため終了します');
      el.style.background = 'rgba(0, 0, 0, 0.7)';
      el.textContent = '終了';
      el.style.border = 'none';
      stopped = true;
      return;
    }

    if (!isPaused) {
      const button = document.querySelector('.js-reserve.button.next');
      if (button) {
        button.click();
        if (now - startTime < 60000) {
          const timeStr = new Date().toLocaleTimeString() + '.' +
                          String(new Date().getMilliseconds()).padStart(3, '0');
          console.log('🟦 ボタンを押した時刻: ' + timeStr);
        }
        el.style.background = 'rgba(60, 100, 255, 0.6)';
        el.textContent = '稼働中';
        flashBorder();
      } else {
        el.style.background = 'rgba(128, 0, 255, 0.6)';
        el.textContent = '待機中';
        el.style.border = 'none';
      }
    }

    const elapsed = (now - startTime) / 1000;
    let nextInterval;
    if (elapsed < 10) {
      nextInterval = 400;
    } else if (elapsed < 20) {
      nextInterval = 1000;
    } else if (elapsed < 30) {
      nextInterval = 1500;
    } else if (elapsed < 60) {
      nextInterval = 2000;
    } else {
      nextInterval = 3000;
    }

    setTimeout(clickAndSchedule, nextInterval);
  }

  clickAndSchedule();
})();
