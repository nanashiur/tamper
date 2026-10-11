// ==UserScript==
// @name         ⏳️待合室時刻表示
// @version      1.07
// @match        https://reserve-q.tokyodisneyresort.jp/*
// @updateURL    https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/waitingroom_support.js
// @downloadURL  https://raw.githubusercontent.com/nanashiur/tamper/refs/heads/main/waitingroom_support.js
// @run-at       document-idle
// @sandbox      raw
// @grant        none
// @noframes
// ==/UserScript==

// 確認画面の「すすむ」だけを自動クリックする独立処理。
(function () {
  'use strict';

  const key = '__tdrWaitingroomAutoConfirm_v1';
  if (window[key]) return;
  window[key] = true;

  let currentModal = null;
  let clicked = false;
  let scheduled = false;

  function isDisplayed(element) {
    if (!element || !element.isConnected || !element.getClientRects().length) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
  }

  function checkConfirmDialog() {
    const modal = document.getElementById('divConfirmRedirectModal');
    if (modal !== currentModal) {
      currentModal = modal;
      clicked = false;
    }
    if (!isDisplayed(modal) || modal.getAttribute('aria-hidden') === 'true') {
      clicked = false;
      return;
    }

    const button = modal.querySelector('button#buttonConfirmRedirect');
    if (clicked || !isDisplayed(button) || button.matches(':disabled')
      || button.getAttribute('aria-disabled') === 'true' || button.closest('[inert]')) return;

    // ボタンの処理によるDOM変化より先に記録し、同じ表示への連打を防ぐ。
    clicked = true;
    button.click();
  }

  function scheduleCheck() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      checkConfirmDialog();
    });
  }

  const observer = new MutationObserver(scheduleCheck);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['id', 'style', 'class', 'hidden', 'disabled', 'aria-hidden', 'aria-disabled', 'inert'],
  });
  // 背景タブでも判定する。復帰時とCSSだけでの表示変化も補完する。
  window.setInterval(checkConfirmDialog, 1000);
  document.addEventListener('visibilitychange', scheduleCheck);
  window.addEventListener('pageshow', scheduleCheck);
  window.addEventListener('focus', scheduleCheck);
  checkConfirmDialog();
})();

// 以下はベースの時刻表示コードを変更せず維持する。
(function (d) {
  if (d.getElementById('expectedServiceTimeActual') || !d.querySelector('span#MainPart_lbExpectedServiceTime')) {
    return;
  }
  const insertAfter = (elem, posElem) => {
    posElem.parentElement.insertBefore(elem, posElem.nextSibling);
  };
  const match = window.queueViewModel.queueViewSession.match(/&sets=(\d+)$/);
  let sets;
  if (match) {
    sets = Number(match[1]);
  }
  const commonCSS = 'text-align:center; font-weight:bold; color:blue; margin-top:10px;';
  let pos1 = d.querySelector('span#MainPart_lbExpectedServiceTimeTimeZonePostfix');
  if (!pos1) {
    pos1 = d.querySelector('span#MainPart_lbExpectedServiceTime');
  }
  const area1 = d.createElement('div');
  area1.setAttribute('id', 'expectedServiceTimeActual');
  area1.style.cssText = commonCSS;
  area1.innerHTML = '（詳細な推定時刻: 次回のデータ更新待ち）';
  insertAfter(area1, pos1);

  const pos2 = d.querySelector('span#MainPart_lbWhichIsIn');
  const area2 = d.createElement('div');
  area2.setAttribute('id', 'whichIsInDetail');
  area2.style.cssText = commonCSS;
  area2.innerHTML = '（詳細な待ち時間: 次回のデータ更新待ち）';
  insertAfter(area2, pos2);

  const pos3 = d.querySelector('div.warning-box');
  const area3 = d.createElement('div');
  area3.setAttribute('id', 'progressPercent');
  area3.style.cssText = `${commonCSS};font-size:16px;`;
  area3.innerHTML = '（進行度: 次回のデータ更新待ち）';
  pos3.append(area3);

  const area4 = d.createElement('div');
  area4.setAttribute('id', 'totalWaitTime');
  area4.style.cssText = commonCSS;
  insertAfter(area4, area2);

  d.querySelector('#footer-direct-link').style.display = 'block';
  const el_id = d.getElementById('hlLinkToQueueTicket2');
  if (el_id) {
    el_id.style.opacity = '0';
    el_id.addEventListener('click', () => {
      el_id.style.opacity = el_id.style.opacity ? '' : '0';
    });
  }

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function () {
    const dateFormat = (date, format) => {
      const _fmt = {
        hh: date => { return ('0' + date.getHours()).slice(-2) },
        mm: date => { return ('0' + date.getMinutes()).slice(-2) },
        ss: date => { return ('0' + date.getSeconds()).slice(-2) },
        dd: date => { return ('0' + date.getDate()).slice(-2) },
        yyyy: date => { return date.getFullYear() + '' },
        MM: date => { return ('0' + (date.getMonth() + 1)).slice(-2) },
      };
      const _priority = ['dd', 'yyyy', 'MM', 'hh', 'mm', 'ss'];
      return _priority.reduce((res, fmt) => res.replace(fmt, _fmt[fmt](date)), format);
    };
    const getHMS = (total_sec) => {
      const hours = Math.floor(total_sec / 60 / 60);
      const minutes = Math.floor((total_sec - hours * 60 * 60) / 60);
      const seconds = Math.floor(total_sec - (hours * 60 + minutes) * 60);
      return [hours, minutes, seconds];
    };

    this.addEventListener('load', () => {
      const expectedServiceTimeActual = d.getElementById('expectedServiceTimeActual');
      const whichIsInDetail = d.getElementById('whichIsInDetail');
      const progressPercent = d.getElementById('progressPercent');
      const totalWaitTime = d.getElementById('totalWaitTime');

      try {
        const now = new Date();
        const res = JSON.parse(this.responseText);
        const isRedirectToTarget = res.isRedirectToTarget;
        let mod_progress;
        
        if (res.ticket) {
          const { progress, expectedServiceTimeUTC } = res.ticket;
          mod_progress = progress;

          if (expectedServiceTimeUTC) {
            const expectTime = new Date(expectedServiceTimeUTC.endsWith('Z') ? expectedServiceTimeUTC : expectedServiceTimeUTC + 'Z');

            const [hours, minutes, seconds] = getHMS((expectTime - now) / 1000);
            const fontColor = hours >= 2 ? 'red' : 'blue';
            expectedServiceTimeActual.style.color = fontColor;
            whichIsInDetail.style.color = fontColor;


            if (progress < 1) {
              expectedServiceTimeActual.innerHTML = `${dateFormat(expectTime, 'yyyy/MM/dd hh:mm:ss')}`;
              whichIsInDetail.innerHTML = (hours ? `${hours} 時間 ` : '') + `${minutes} 分 ${seconds} 秒`;
            } else {
              expectedServiceTimeActual.innerHTML = '';
              whichIsInDetail.innerHTML = '';
            }
          } else {
            expectedServiceTimeActual.innerHTML = '詳細な推定時刻: 不明(データ無し)';
            whichIsInDetail.innerHTML = '詳細な待ち時間: 不明(データ無し)';
          }
        }

        if (isRedirectToTarget) {
          mod_progress = 1;
        }

        if (sets) {
          const [total_hours, total_minutes, total_seconds] = getHMS((now.getTime() - sets) / 1000);
          const fontColor = total_hours >= 1 ? 'red' : 'blue';
          totalWaitTime.style.fontWeight = 'normal';
          totalWaitTime.innerHTML = `ここまでの合計待ち時間：<br><span style="color:${fontColor};font-weight:bold;">${total_hours} 時間 ${total_minutes} 分 ${total_seconds} 秒</span>`;
        }

        progressPercent.innerHTML = `進行度: ${(mod_progress * 100).toFixed()}%`;
      } catch (err) {}
    });
    origOpen.apply(this, arguments);
  };
})(document);