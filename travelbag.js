// ==UserScript==
// @name         TDR トラベルバッグ オプション
// @version      0.07
// @match        https://reserve.tokyodisneyresort.jp/online/travelbag/edit/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/travelbag.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/travelbag.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const VERSION = '0.07';
    const PANEL_ID = '__tdr_travelbag_option_panel';

    let autoEnabled = false;
    let fireTimer = null;
    let countdownTimer = null;
    let nextFireAt = 0;

    // ========================================
    // 二重起動防止
    // ========================================
    if (document.getElementById(PANEL_ID)) {
        return;
    }

    // ========================================
    // adultNum取得
    // ========================================
    function getAdultNum() {
        if (typeof window.jQuery === 'undefined') {
            console.warn('[TDR TravelBag] jQuery が見つかりません');
            return null;
        }

        const $adultNum = window.jQuery('select[name="adultNum"]');

        if ($adultNum.length === 0) {
            console.warn('[TDR TravelBag] adultNum が見つかりません');
            return null;
        }

        return $adultNum;
    }

    // ========================================
    // 電話番号取得
    // TDR_CONFIG.phone を優先
    // 旧 TDR_WEBHOOKS.phone にも対応
    // 取得失敗時は 090
    // ========================================
    function getPhoneNumber() {
        const configPhone = window.TDR_CONFIG?.phone;

        if (
            typeof configPhone === 'string' &&
            configPhone.trim()
        ) {
            return configPhone.trim();
        }

        const legacyPhone = window.TDR_WEBHOOKS?.phone;

        if (
            typeof legacyPhone === 'string' &&
            legacyPhone.trim()
        ) {
            return legacyPhone.trim();
        }

        console.warn(
            '[TDR TravelBag] 電話番号をConfigから取得できないため090を使用します'
        );

        return '090';
    }

    // ========================================
    // 在庫状況を発火・リロード
    // 人数は変更しない
    // ========================================
    function fireStockReload() {
        const $adultNum = getAdultNum();

        if (!$adultNum) {
            return;
        }

        console.log(
            '[TDR TravelBag] 在庫状況リロード:',
            new Date().toLocaleTimeString()
        );

        $adultNum.trigger('change');
    }

    // ========================================
    // 手動発火
    // ・大人人数を1名
    // ・電話番号をConfigから入力
    // ・同意するをON
    // ・在庫状況をリロード
    // ========================================
    function manualReload() {
        const $adultNum = getAdultNum();

        if (!$adultNum) {
            return;
        }

        // 大人人数を1名に設定
        $adultNum.val('1');

        // 電話番号をConfigから取得して設定
        const phoneNumber = getPhoneNumber();

        window.jQuery('input[name="telNum"]').val(phoneNumber);

        // 「同意する」をON
        const agree = document.getElementById('agree');

        if (agree && !agree.checked) {
            agree.click();
        }

        console.log(
            '[TDR TravelBag] 1名設定・電話番号入力・同意ON・在庫状況リロード:',
            new Date().toLocaleTimeString()
        );

        // 人数更新を発火して在庫状況をリロード
        $adultNum.trigger('change');
    }

    // ========================================
    // 次の毎分59.5秒を予約
    // ========================================
    function scheduleNextFire() {
        clearTimeout(fireTimer);

        if (!autoEnabled) {
            return;
        }

        const now = new Date();

        const next = new Date(now);
        next.setSeconds(59, 500);

        // 今分の59.500秒をすでに過ぎている場合は
        // 次の分の59.500秒を予約
        if (now.getTime() >= next.getTime()) {
            next.setMinutes(next.getMinutes() + 1);
        }

        nextFireAt = next.getTime();

        console.log(
            '[TDR TravelBag] 次回自動発火:',
            next.toLocaleTimeString(),
            '.500'
        );

        fireTimer = setTimeout(function () {
            if (!autoEnabled) {
                return;
            }

            autoButton.textContent = '00';

            fireStockReload();

            // 発火後、現在時刻から次の59.500秒を再計算
            scheduleNextFire();

        }, Math.max(0, nextFireAt - Date.now()));
    }

    // ========================================
    // カウントダウン表示
    // ========================================
    function updateCountdown() {
        if (!autoEnabled) {
            autoButton.textContent = 'OFF';
            return;
        }

        const remainingMs = nextFireAt - Date.now();

        if (remainingMs <= 0) {
            autoButton.textContent = '00';
            return;
        }

        const remainingSeconds = Math.min(
            59,
            Math.ceil(remainingMs / 1000)
        );

        autoButton.textContent =
            String(remainingSeconds).padStart(2, '0');
    }

    function startCountdown() {
        clearInterval(countdownTimer);

        updateCountdown();

        countdownTimer = setInterval(function () {
            updateCountdown();
        }, 200);
    }

    function stopCountdown() {
        clearInterval(countdownTimer);
        countdownTimer = null;

        autoButton.textContent = 'OFF';
    }

    // ========================================
    // パネル本体
    // ========================================
    const panel = document.createElement('div');

    panel.id = PANEL_ID;

    Object.assign(panel.style, {
        position: 'fixed',
        top: '10px',
        right: '10px',
        display: 'flex',
        gap: '4px',
        zIndex: '2147483647'
    });

    // ========================================
    // 手動「1名」ボタン
    // ========================================
    const manualButton = document.createElement('button');

    manualButton.type = 'button';
    manualButton.textContent = '1名';

    Object.assign(manualButton.style, {
        width: '64px',
        height: '42px',
        border: 'none',
        borderRadius: '6px',
        background: '#1976d2',
        color: '#fff',
        fontSize: '15px',
        fontWeight: 'bold',
        cursor: 'pointer'
    });

    manualButton.addEventListener('click', function () {
        manualReload();
    });

    // ========================================
    // 自動 ON / OFF ボタン
    // ========================================
    const autoButton = document.createElement('button');

    autoButton.type = 'button';
    autoButton.textContent = 'OFF';

    Object.assign(autoButton.style, {
        width: '64px',
        height: '42px',
        border: 'none',
        borderRadius: '6px',
        background: '#777',
        color: '#fff',
        fontSize: '15px',
        fontWeight: 'bold',
        cursor: 'pointer'
    });

    autoButton.addEventListener('click', function () {
        autoEnabled = !autoEnabled;

        if (autoEnabled) {
            autoButton.style.background = '#198754';

            console.log('[TDR TravelBag] 自動発火 ON');

            scheduleNextFire();
            startCountdown();

        } else {
            autoButton.style.background = '#777';

            clearTimeout(fireTimer);
            fireTimer = null;
            nextFireAt = 0;

            stopCountdown();

            console.log('[TDR TravelBag] 自動発火 OFF');
        }
    });

    // ========================================
    // パネル表示
    // ========================================
    panel.appendChild(manualButton);
    panel.appendChild(autoButton);

    document.body.appendChild(panel);

    console.log(`[TDR TravelBag] v${VERSION} 起動`);
})();
