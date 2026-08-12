// ==UserScript==
// @name         ℹ️仮予約ログインバック
// @version      1.03
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
    right: '6px',
    top: '96px',
    zIndex: '2147483647',
    fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
    fontSize: '15px',
    fontWeight: '900',
    lineHeight: '1',
    padding: '5px 7px',
    borderRadius: '7px',
    background: '#e65100',
    color: '#fff',
    boxShadow: '0 1px 6px rgba(0,0,0,.35)',
    textAlign: 'center',
    minWidth: '42px',
    userSelect: 'none',
    cursor: 'pointer'
});
document.body.appendChild(panel);

panel.addEventListener('click', () => {
    enabled = !enabled;
    fired = false;

    if (enabled) {
        deadline = Date.now() + WAIT;
    }

    update();
});

function update() {
    if (!enabled) {
        panel.textContent = 'OFF';
        panel.title = 'カウントOFF / クリックでON';
        panel.style.background = 'rgba(0,0,0,.45)';
        panel.style.color = '#fff';
        return;
    }

    const remain = Math.max(0, deadline - Date.now());
    const sec = Math.ceil(remain / 1000);
    const min = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');

    panel.textContent = `${min}:${s}`;
    panel.title = '5分後に戻る / クリックでOFF';
    panel.style.background = '#e65100';
    panel.style.color = '#fff';

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
