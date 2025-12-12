// ==UserScript==
// @name         🟦 Auto Click Blue Reservation Button
// @namespace    http://tampermonkey.net/
// @version      4.5
// @description  Interval restored version. Auto-stop at 40s, and 35 min auto-stop after manual restart.
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/blue.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/blue.js
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const scriptStart = Date.now();
    let restartTime = null;
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
    el.style.fontSize = '20px';
    el.style.fontFamily = 'monospace';
    el.style.whiteSpace = 'nowrap';
    el.style.cursor = 'pointer';
    el.textContent = '稼働中';
    shadow.appendChild(el);

    // パネルクリック
    el.addEventListener('click', () => {
        if (stopped) return;

        isPaused = !isPaused;

        if (isPaused) {
            el.style.background = 'rgba(255,140,0,.8)';
            el.textContent = '停止中';
        } else {
            el.style.background = 'rgba(60,100,255,.6)';
            el.textContent = '稼働中';

            // 再稼働時刻
            restartTime = Date.now();
        }
    });

    // 読み込み40秒後の停止（元仕様）
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

    // ★ インターバル計算関数
    function getInterval() {
        const elapsed = (Date.now() - scriptStart) / 1000; // 秒

        if (elapsed < 10) return 400;
        if (elapsed < 20) return 1000;
        if (elapsed < 30) return 1500;
        if (elapsed < 60) return 2000;
        return 3000;
    }

    (function loop() {
        if (stopped) return;

        const now = Date.now();

        // ★ 再稼働後 35分で自動停止
        if (!isPaused && restartTime && now - restartTime >= 2100000) {
            isPaused = true;
            restartTime = null;
            el.style.background = 'rgba(255,140,0,.8)';
            el.textContent = '停止（35分）';
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

        // ★ インターバルは経過時間に応じて変動
        setTimeout(loop, getInterval());
    })();
})();
