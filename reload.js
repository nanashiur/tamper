// ==UserScript==
// @name         ⏰️ 42.4 (0-500)
// @namespace    http://tampermonkey.net/
// @version      4.10
// @description  Pre-reloads at 10:52:00 with 0–2000ms delay, reloads at 10:59:42.4 with 0–500ms delay. Shows delay info in a separate panel.
// @match        https://reserve.tokyodisneyresort.jp/sp/hotel/list/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/main/reload.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/main/reload.js
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';
    var scriptStartTime = new Date();
    var preReloadDone = false;
    var mainReloadDone = false;

    function getFormattedTime(date) {
        return date.toLocaleTimeString() + '.' + String(date.getMilliseconds()).padStart(3, '0');
    }

    console.log(`⏰️ Script started at: ${getFormattedTime(scriptStartTime)}`);

    var elClock = document.createElement('div');
    elClock.id = 'customClock';
    elClock.style.position = 'fixed';
    elClock.style.top = '0px';
    elClock.style.right = '0px';
    elClock.style.background = 'rgba(0, 0, 0, 0.45)';
    elClock.style.color = 'white';
    elClock.style.padding = '5px 15px';
    elClock.style.borderRadius = '10px';
    elClock.style.fontSize = '20px';
    elClock.style.fontFamily = 'monospace';
    elClock.style.whiteSpace = 'nowrap';
    elClock.style.zIndex = '9999';
    document.body.appendChild(elClock);

    var elStart = document.createElement('div');
    elStart.id = 'customStartTime';
    elStart.style.position = 'fixed';
    elStart.style.top = '45px';
    elStart.style.right = '0px';
    elStart.style.background = 'rgba(0, 128, 0, 0.5)';
    elStart.style.color = 'white';
    elStart.style.padding = '5px 15px';
    elStart.style.borderRadius = '10px';
    elStart.style.fontSize = '20px';
    elStart.style.fontFamily = 'monospace';
    elStart.style.whiteSpace = 'nowrap';
    elStart.style.zIndex = '9999';
    elStart.textContent = getFormattedTime(scriptStartTime);
    document.body.appendChild(elStart);

    var elDelay = document.createElement('div');
    elDelay.id = 'customDelayInfo';
    elDelay.style.position = 'fixed';
    elDelay.style.top = '90px';
    elDelay.style.right = '0px';
    elDelay.style.background = 'rgba(128, 0, 128, 0.45)'; // 紫
    elDelay.style.color = 'white';
    elDelay.style.padding = '5px 15px';
    elDelay.style.borderRadius = '10px';
    elDelay.style.fontSize = '20px';
    elDelay.style.fontFamily = 'monospace';
    elDelay.style.whiteSpace = 'nowrap';
    elDelay.style.zIndex = '9999';
    elDelay.textContent = 'Delay: --- ms';
    document.body.appendChild(elDelay);

    function updateClock() {
        let now = new Date();
        elClock.textContent = getFormattedTime(now);

        // 準備リロード
        if (
            now.getHours() === 10 &&
            now.getMinutes() === 52 &&
            now.getSeconds() === 0 &&
            now.getMilliseconds() >= 0 &&
            !preReloadDone
        ) {
            preReloadDone = true;
            let randomDelay = Math.floor(Math.random() * 2001);
            console.log(`🔄 Pre-reload scheduled with ${randomDelay} ms delay at: ${getFormattedTime(now)}`);
            elDelay.textContent = `Pre-reload delay: ${randomDelay} ms`;
            setTimeout(() => {
                let reloadTime = new Date();
                console.log(`🔄 Pre-reload triggered at: ${getFormattedTime(reloadTime)}`);
                elStart.textContent = getFormattedTime(reloadTime);
                elStart.style.background = 'rgba(255, 165, 0, 0.75)';
                location.reload();
            }, randomDelay);
        }

        // 本リロード
        if (
            now.getHours() === 10 &&
            now.getMinutes() === 59 &&
            now.getSeconds() === 42 &&
            now.getMilliseconds() >= 400 &&
            !mainReloadDone
        ) {
            mainReloadDone = true;
            let randomDelay = Math.floor(Math.random() * 501);
            console.log(`🔄 Main reload scheduled with ${randomDelay} ms delay at: ${getFormattedTime(now)}`);
            elDelay.textContent = `Main reload delay: ${randomDelay} ms`;
            setTimeout(() => {
                let reloadTime = new Date();
                console.log(`🔄 Main reload triggered at: ${getFormattedTime(reloadTime)}`);
                elStart.textContent = getFormattedTime(reloadTime);
                elStart.style.background = 'rgba(255, 0, 0, 0.75)';
                location.reload();
            }, randomDelay);
        }
    }

    setInterval(updateClock, 50);
})();
