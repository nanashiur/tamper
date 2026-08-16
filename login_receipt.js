// ==UserScript==
// @name         ℹ️仮予約ログインバック
// @version      1.35
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
        return data.ip || 'IP取得不可';
    } catch (e) {
        console.warn(`[${SCRIPT_NAME}] IP取得失敗:`, e);
        return 'IP取得不可';
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

if (document.body) {
    new MutationObserver(checkError).observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
    });
}

if (!currentReceiptNO) return;

let enabled = true;
let remainingMs = WAIT;
let deadline = Date.now() + remainingMs;
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
    background: 'rgba(0,0,0,.82)',
    color: '#fff',
    boxShadow: '0 1px 6px rgba(0,0,0,.35)',
    textAlign: 'center',
    minWidth: '42px',
    userSelect: 'none',
    cursor: 'pointer'
});

document.body.appendChild(panel);

panel.addEventListener('click', () => {
    if (enabled) {
        remainingMs = Math.max(0, deadline - Date.now());
        enabled = false;
        console.log(`[${SCRIPT_NAME}] カウント停止`);
    } else {
        enabled = true;
        deadline = Date.now() + remainingMs;
        console.log(`[${SCRIPT_NAME}] カウント再開`);
    }

    update();
});

function formatRemain(ms) {
    const totalSec = Math.max(0, Math.ceil(ms / 1000));
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;

    return `${min}:${String(sec).padStart(2, '0')}`;
}

function update() {
    if (!enabled) {
        const remainText = formatRemain(remainingMs);

        panel.textContent = remainText;
        panel.title = `カウント停止中 残り${remainText} / クリックで再開`;
        panel.style.background = 'rgba(0,0,0,.45)';
        panel.style.color = '#fff';
        return;
    }

    remainingMs = Math.max(0, deadline - Date.now());

    const remainText = formatRemain(remainingMs);

    panel.textContent = remainText;
    panel.title = '10分後に戻る / クリックで停止';
    panel.style.background = 'rgba(0,0,0,.82)';
    panel.style.color = '#fff';

    if (remainingMs <= 0 && !fired) {
        const back = document.querySelector('p.btnBack.headerBack');

        if (back) {
            fired = true;
            panel.textContent = '戻る';
            console.log(`[${SCRIPT_NAME}] 10分終了。戻ります`);
            back.click();
        }
    }
}

update();
setInterval(update, 200);

})();
