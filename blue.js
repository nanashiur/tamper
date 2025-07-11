// ==UserScript==
// @name         🟦 Auto Click Blue Reservation Button
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Clicks the blue reservation button, shows time on each check, and stops after 35 minutes.
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @grant        none
// ==/UserScript==

(function(){
  'use strict';
  const startTime = Date.now();
  let stopped = false;

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
  el.style.display = 'none';
  shadow.appendChild(el);

  function getNowTimeString() {
    const now = new Date();
    return now.toLocaleTimeString() + '.' + String(now.getMilliseconds()).padStart(3, '0');
  }

  function showTimeDisplay(text, background) {
    el.textContent = text;
    el.style.background = background;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 400);
  }

  function clickAndSchedule() {
    if (stopped) return;

    const now = Date.now();
    if (now - startTime >= 2100000) {  // ← 35分 = 35 × 60 × 1000 = 2100000ms
      console.log('🛑 スクリプトは35分経過したため停止しました');
      stopped = true;
      return;
    }

    const button = document.querySelector('.js-reserve.button.next');
    const timeString = getNowTimeString();

    if (button) {
      button.click();
      if (now - startTime < 60000) {
        console.log('🟦 ボタンを押した時刻: ' + timeString);
      }
      showTimeDisplay(timeString, 'rgba(60, 100, 255, 0.6)');
    } else {
      showTimeDisplay(timeString, 'rgba(128, 0, 255, 0.6)');
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
