// ==UserScript==
// @name         ⏳️待合室タイマー
// @namespace    http://tampermonkey.net/
// @version      5.05
// @description  有効期限を中央下に表示、開始時刻を左下パネル・ログに0.000秒形式で表示
// @match        https://reserve.tokyodisneyresort.jp/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/main/refs/heads/machiai.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/main/refs/heads/machiai.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const duration_min = 15;

  if (document.querySelector('#queuePassedLimit_v1')) {
    console.log('既にこのIDのタイマーが起動しています');
    return;
  }

  // 0.000秒までの時刻フォーマット
  const dateFormatWithMs = (date) => {
    const hh = ('0' + date.getHours()).slice(-2);
    const mm = ('0' + date.getMinutes()).slice(-2);
    const ss = ('0' + date.getSeconds()).slice(-2);
    const ms = ('00' + date.getMilliseconds()).slice(-3);
    return `${hh}:${mm}:${ss}.${ms}`;
  };

  // 起動時刻ログ＆パネル
  const now = new Date();
  const startStr = dateFormatWithMs(now);
  console.log(`開始 ${startStr}`);

  const startPanel = document.createElement('div');
  startPanel.style.cssText = `
    position: fixed;
    left: 0;
    bottom: 0;
    padding: 4px;
    background-color: rgba(0,0,0,0.4);
    color: white;
    font-size: 12px;
    z-index: 20000;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
  `;
  startPanel.textContent = `開始 ${startStr}`;
  document.body.appendChild(startPanel);

  const dateFormat = (date, format) => {
    const _fmt = {
      hh: d => ('0' + d.getHours()).slice(-2),
      mm: d => ('0' + d.getMinutes()).slice(-2),
      ss: d => ('0' + d.getSeconds()).slice(-2),
    };
    return format.replace(/hh|mm|ss/g, fmt => _fmt[fmt](date));
  };

  const getHMS = (total_sec) => {
    if (total_sec <= 0) return [0, 0, 0];
    const h = Math.floor(total_sec / 3600);
    const m = Math.floor((total_sec % 3600) / 60);
    const s = Math.floor(total_sec % 60);
    return [h, m, s];
  };

  const acceptedCookie = document.cookie.split('; ').find(row => row.startsWith('QueueITAccepted-'));
  if (!acceptedCookie) {
    console.log('待合室通過のCookieが見つかりませんでした');
    return;
  }

  const container = document.createElement('div');
  container.id = 'queuePassedLimit_v1';
  container.style.cssText = `
    position: fixed !important;
    left: 50% !important;
    bottom: 0 !important;
    transform: translateX(-50%) !important;
    z-index: 20000 !important;
    display: flex;
    flex-direction: column;
    background-color: rgba(0,0,0,0.4);
    color: white;
    font-size: 14px;
    border-radius: 4px;
    padding: 0;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    overflow: hidden;
  `;

  const row = document.createElement('div');
  row.style.cssText = `display: flex; width: 100%; align-items: stretch;`;

  const leftBand = document.createElement('div');
  leftBand.style.cssText = `width: 10px; background: transparent;`;

  const main = document.createElement('div');
  main.style.cssText = `flex-grow: 1; padding: 4px; text-align: center; position: relative;`;

  const rightBand = document.createElement('div');
  rightBand.style.cssText = `width: 10px; background: transparent;`;

  const bottomBand = document.createElement('div');
  bottomBand.style.cssText = `height: 5px; background: transparent; width: 100%;`;

  const meter = document.createElement('div');
  meter.style.cssText = `
    width: 100%;
    height: 5px;
    background: black;
    border-radius: 3px;
    overflow: hidden;
    margin-bottom: 3px;
    position: relative;
  `;

  const meterFill = document.createElement('div');
  meterFill.style.cssText = `
    height: 100%;
    width: 0%;
    background: red;
    position: absolute;
    top: 0;
    left: 0;
  `;

  const tick10 = document.createElement('div');
  tick10.style.cssText = `
    position: absolute;
    left: ${(1 - 10 / duration_min) * 100}%;
    top: 0;
    width: 1px;
    height: 100%;
    background: white;
    opacity: 0.8;
  `;

  const tick5 = document.createElement('div');
  tick5.style.cssText = `
    position: absolute;
    left: ${(1 - 5 / duration_min) * 100}%;
    top: 0;
    width: 1px;
    height: 100%;
    background: white;
    opacity: 0.8;
  `;

  meter.appendChild(meterFill);
  meter.appendChild(tick10);
  meter.appendChild(tick5);

  const text = document.createElement('div');
  text.style.cssText = `line-height: 1.3;`;
  text.innerHTML = '初期化中';

  main.appendChild(meter);
  main.appendChild(text);

  row.appendChild(leftBand);
  row.appendChild(main);
  row.appendChild(rightBand);

  container.appendChild(row);
  container.appendChild(bottomBand);
  document.body.appendChild(container);

  const cookieValue = decodeURIComponent(acceptedCookie.split('=')[1]);
  const searchParams = new URLSearchParams(cookieValue);
  const qIssueTime = searchParams.get('IssueTime');

  if (!qIssueTime) {
    console.log('IssueTimeが見つかりません');
    return;
  }

  const issueDate = new Date(Number(qIssueTime) * 1000);
  const limitDate = new Date(issueDate.getTime());
  limitDate.setMinutes(limitDate.getMinutes() + duration_min);
  const totalMillis = limitDate - issueDate;

  const timerId = setInterval(() => {
    const now = new Date();
    let remain = limitDate - now;
    if (remain < 0) remain = 0;

    const [_, m, s] = getHMS(remain / 1000);
    if (remain > 0) {
      text.innerHTML = `${dateFormat(limitDate, 'hh:mm:ss')}<br>${m}分${s}秒`;
    } else {
      text.innerHTML = `${dateFormat(limitDate, 'hh:mm:ss')}<br>期限切れ`;
    }

    const elapsedRatio = 1 - (remain / totalMillis);
    meterFill.style.width = `${Math.min(100, elapsedRatio * 100)}%`;

    if (remain <= 0) {
      container.style.backgroundColor = 'rgba(255,0,0,0.4)';
      clearInterval(timerId);
    }

    if (remain <= 10 * 60 * 1000) {
      leftBand.style.background = 'rgba(255,0,0,0.5)';
    } else {
      leftBand.style.background = 'transparent';
    }

    if (remain <= 5 * 60 * 1000) {
      rightBand.style.background = 'rgba(255,0,0,0.5)';
    } else {
      rightBand.style.background = 'transparent';
    }

    if (remain <= 3 * 60 * 1000) {
      bottomBand.style.background = 'rgba(255,0,0,0.5)';
    } else {
      bottomBand.style.background = 'transparent';
    }

  }, 1000);

  container.addEventListener('click', () => {
    clearInterval(timerId);
    container.remove();
    startPanel.remove();
  });
})();
