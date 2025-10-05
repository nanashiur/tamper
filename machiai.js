// ==UserScript==
// @name         ⏳️待合室タイマー
// @namespace    http://tampermonkey.net/
// @version      6.04
// @description  左下に開始時刻と有効期限を表示（黒の半透明・フォント12px・スリム表示・残り時間は中央寄せ・5分/10分目盛り復活）
// @match        https://reserve.tokyodisneyresort.jp/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/waitingroom_limit.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/waitingroom_limit.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const duration_min = 15;

  // 多重起動防止（このIDがあれば終了）
  if (document.querySelector('#queuePassedLimit_v1')) {
    console.log('既にこのIDのタイマーが起動しています');
    return;
  }

  // hh:mm:ss.mmm
  const formatWithMs = (d) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
  };
  // hh:mm:ss
  const formatHMS = (d) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  };

  // 開始時刻（ログ＋表示）
  const start = new Date();
  const startStrMs = formatWithMs(start);
  console.log(`開始 ${startStrMs}`);

  // QueueIT Cookie
  const acceptedCookie = document.cookie.split('; ').find(row => row.startsWith('QueueITAccepted-'));
  if (!acceptedCookie) {
    console.log('待合室通過のCookieが見つかりませんでした');
    return;
  }

  // 左下パネル（開始／有効期限）
  const container = document.createElement('div');
  container.id = 'queuePassedLimit_v1';
  container.style.cssText = `
    position: fixed !important;
    left: 0 !important;
    bottom: 0 !important;
    z-index: 20000 !important;
    display: flex;
    flex-direction: column;
    background-color: rgba(0,0,0,0.4);
    color: white;
    font-size: 12px;
    border-radius: 0 6px 0 0;
    padding: 6px;
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    line-height: 1.4;
    font-family: sans-serif;
    max-width: 70vw;
  `;

  // 上段：開始
  const startRow = document.createElement('div');
  startRow.textContent = `開始 ${startStrMs}`;
  startRow.style.cssText = `margin-bottom: 3px; text-align: left; white-space: nowrap;`;

  // 進捗メーター
  const meter = document.createElement('div');
  meter.style.cssText = `
    width: 100%;
    height: 4px;
    background: black;
    border-radius: 2px;
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

  // ▼ 目盛り復活：10分（2/3）、5分（1/3）
  const tick10 = document.createElement('div'); // 10分残し位置
  tick10.style.cssText = `
    position: absolute;
    left: ${(1 - 10 / duration_min) * 100}%;
    top: 0;
    width: 1px;
    height: 100%;
    background: white;
    opacity: 0.85;
  `;
  const tick5 = document.createElement('div'); // 5分残し位置
  tick5.style.cssText = `
    position: absolute;
    left: ${(1 - 5 / duration_min) * 100}%;
    top: 0;
    width: 1px;
    height: 100%;
    background: white;
    opacity: 0.85;
  `;

  meter.appendChild(meterFill);
  meter.appendChild(tick10);
  meter.appendChild(tick5);

  // 下段：有効期限＋残り（中央寄せ）
  const timeDisplay = document.createElement('div');
  timeDisplay.innerHTML = '初期化中';
  timeDisplay.style.cssText = `text-align: center;`;

  const block = document.createElement('div');
  block.appendChild(meter);
  block.appendChild(timeDisplay);

  container.appendChild(startRow);
  container.appendChild(block);
  document.body.appendChild(container);

  // 期限計算
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

  const tick = () => {
    const now = new Date();
    let remain = limitDate - now;
    if (remain < 0) remain = 0;

    const m = Math.floor(remain / 60000);
    const s = Math.floor((remain % 60000) / 1000);
    const limitStr = formatHMS(limitDate);

    if (remain > 0) {
      timeDisplay.innerHTML = `有効期限 ${limitStr}<br>(残り ${m}分${s}秒)`;
    } else {
      timeDisplay.innerHTML = `有効期限 ${limitStr}<br>(期限切れ)`;
    }

    meterFill.style.width = `${Math.min(100, (1 - remain / totalMillis) * 100)}%`;

    if (remain <= 0) {
      container.style.backgroundColor = 'rgba(255,0,0,0.4)';
      clearInterval(timerId);
    }
  };

  const timerId = setInterval(tick, 1000);
  tick();

  // クリックで閉じる
  container.addEventListener('click', () => {
    clearInterval(timerId);
    container.remove();
  });
})();
