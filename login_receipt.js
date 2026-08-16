// ==UserScript==
// @name         ℹ️仮予約ログインバック
// @version      1.24
// @match        https://reserve.tokyodisneyresort.jp/online/sp/login/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/login_receipt.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/login_receipt.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
'use strict';

const SCRIPT_NAME = 'ℹ️仮予約ログインバック';
const RECEIPT_KEY = 'tdr_login_receipt_no';
const RECEIPT_SESSION_KEY = 'tdr_login_receipt_no_session';
const WAIT = 10 * 60 * 1000;

let errorNotified = false;

const currentReceiptNO = new URLSearchParams(location.search).get('receiptNO');

if (currentReceiptNO) {
    localStorage.setItem(RECEIPT_KEY, currentReceiptNO);
    sessionStorage.setItem(RECEIPT_SESSION_KEY, currentReceiptNO);
    console.log(`[${SCRIPT_NAME}] receiptNO保存: ${currentReceiptNO}`);
}

function getReceiptNO() {
    return new URLSearchParams(location.search).get('receiptNO')
        || sessionStorage.getItem(RECEIPT_SESSION_KEY)
        || localStorage.getItem(RECEIPT_KEY)
        || '不明';
}

async function getPublicIp() {
    try {
        const res = await fetch('https://api.ipify.org?format=json');

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        return data.ip || '取得失敗';
    } catch (e) {
        console.warn(`[${SCRIPT_NAME}] IP取得失敗:`, e);
        return '取得失敗';
    }
}

async function checkError() {
    if (
        errorNotified ||
        !document.body?.innerText.includes('まことに申し訳ございません。')
    ) {
        return;
    }

    errorNotified = true;

    const webhook = window.TDR_WEBHOOKS?.hotel;

    if (!webhook) {
        console.error(`[${SCRIPT_NAME}] Webhook取得失敗`);
        return;
    }

    const ip = await getPublicIp();
    const receiptNO = getReceiptNO();

    const payload = {
        username: SCRIPT_NAME,
        embeds: [{
            title: '⚠️ 仮予約ログインエラー',
            description: [
                '「まことに申し訳ございません。」画面を検知しました。',
                '',
                `IP：${ip}`,
                `receiptNO：${receiptNO}`
            ].join('\n'),
            color: 0xff0000
        }],
        allowed_mentions: {
            parse: []
        }
    };

    try {
        const res = await fetch(webhook, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            keepalive: true
        });

        console.log(`[${SCRIPT_NAME}] エラー通知送信:`, res.status);
    } catch (e) {
        console.error(`[${SCRIPT_NAME}] エラー通知失敗:`, e);
    }
}

checkError();

new MutationObserver(checkError).observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
});

if (!currentReceiptNO) return;

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
    background: 'rgba(255,140,0,.9)',
    color: '#000',
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
    panel.title = '10分後に戻る / クリックでOFF';
    panel.style.background = 'rgba(255,140,0,.9)';
    panel.style.color = '#000';

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
