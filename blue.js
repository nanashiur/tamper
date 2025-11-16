// ==UserScript==
// @name         🟦 Auto Click Blue Reservation Button
// @namespace    http://tampermonkey.net/
// @version      4.1
// @description  Auto-clicks the blue reservation button with toggle. Auto-pause after 40 s, auto-stop after 35 min.
// @match        https://reserve.tokyudisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/blue.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/blue.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const startTime = Date.now();
    let stopped = false;
    let isPaused = false;

    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '175px';
    container.style.right = '0';
    container.style.zIndex = '2147483647';
    document.body.appendChild(container);

    const shadow = container.attachShadow({ mode: 'open' });

    const el = document.createElement('div');
    el.style.background = 'rgba(60,100,255,.6)';
    el.style.color = 'white';
    el.style.padding = '3px 15px';
    el.style.borderRadius = '0px';
    el.style.fontSize = '20px';
    el.style.fontFamily = 'monospace';
    el.style.whiteSpace = 'nowrap';
    el.style.display = 'block';
    el.style.border = 'none';
    el.style.cursor = 'pointer';
    el.textContent = '稼働中';
    shadow.appendChild(el);

    el.addEventListener('click', () => {
        if (stopped) return;
        isPaused = !isPaused;
        if (isPaused) {
            el.style.background = 'rgba(255,140,0,.8)';
            el.textContent = '停止中';
        } else {
            el.style.background = 'rgba(60,100,255,.6)';
            el.textContent = '稼働中';
        }
    });

    setTimeout(() => {
        if (stopped || isPaused) return;
        isPaused = true;
        el.style.background = 'rgba(255,140,0,.8)';
        el.textContent = '停止中';
    }, 40000);

    const flash = () => {
        el.style.border = '2px solid #0033cc';
        setTimeout(() => (el.style.border = 'none'), 100);
    };

    (function loop() {
        if (stopped) return;

        const now = Date.now();

        if (now - startTime >= 2100000) {
            el.style.background = 'rgba(0,0,0,.7)';
            el.textContent = '終了';
            el.style.border = 'none';
            stopped = true;
            return;
        }

        if (!isPaused) {
            const btn = document.querySelector('.js-reserve.button.next');
            if (btn) {
                btn.click();
                el.style.background = 'rgba(60,100,255,.6)';
                el.textContent = '稼働中';
                flash();
            } else {
                el.style.background = 'rgba(128,0,255,.6)';
                el.textContent = '待機中';
                el.style.border = 'none';
            }
        }

        setTimeout(loop, 2000);
    })();

})();
