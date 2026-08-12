// ==UserScript==
// @name         ℹ️仮予約ログインバック
// @version      1.02
// @match        https://reserve.tokyodisneyresort.jp/online/sp/login/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/login_receipt.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/login_receipt.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
'use strict';

let errorNotified = false;

function checkError() {
    if (errorNotified || !document.body?.innerText.includes('まことに申し訳ございません。')) return;

    errorNotified = true;

    const webhook = window.TDR_WEBHOOKS?.hotel;
    if (!webhook) {
        console.error('[仮予約ログインバック] Webhook取得失敗');
        return;
    }

    fetch(webhook, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
            embeds: [{
                title: '⚠️ 仮予約ログインエラー',
                description: '「まことに申し訳ございません。」画面を検知しました。',
                color: 15094016
            }]
        })
    }).catch(e => console.error('[仮予約ログインバック] 通知失敗', e));
}

checkError();

new MutationObserver(checkError).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
});

if (!new URLSearchParams(location.search).has('receiptNO')) return;

const WAIT = 5 * 60 * 1000;
let enabled = true;
let deadline = Date.now() + WAIT;
let fired = false;

const panel = document.createElement('div');
Object.assign(panel.style, {
    position: 'fixed',
    top: '50px',
    right: '10px',
    zIndex: '999999',
    minWidth: '82px',
    padding: '8px 12px',
    textAlign: 'center',
    background: '#e65100',
    color: '#fff',
    fontSize: '16px',
    fontWeight: 'bold',
    borderRadius: '6px',
    cursor: 'pointer',
    userSelect: 'none'
});
document.body.appendChild(panel);

panel.addEventListener('click', () => {
    enabled = !enabled;
    fired = false;
    if (enabled) deadline = Date.now() + WAIT;
    update();
});

function update() {
    if (!enabled) {
        panel.textContent = 'OFF';
        panel.style.background = '#777';
        return;
    }

    const remain = Math.max(0, deadline - Date.now());
    const sec = Math.ceil(remain / 1000);
    const min = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');

    panel.textContent = `ON ${min}:${s}`;
    panel.style.background = '#e65100';

    if (remain <= 0 && !fired) {
        const back = document.querySelector('p.btnBack.headerBack');
        if (back) {
            fired = true;
            panel.textContent = '戻る';
            back.click();
        }
    }
}

update();
setInterval(update, 200);
})();
